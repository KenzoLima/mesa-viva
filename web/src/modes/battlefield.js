// Campo de batalha: câmera em tela cheia que reconhece QUALQUER carta sozinha, sem cadastro.
// Lê o nome impresso na carta (OCR com tesseract.js, inglês e português), acha a carta no catálogo
// inteiro (NameMatcher), acha o contorno real da carta em volta do nome (cardDetector), contorna de
// amarelo e faz a criatura surgir em pé sobre ela.
// Entre uma leitura e outra, o CardTracker segue a carta quadro a quadro (fluxo óptico),
// então o contorno e a criatura ficam presos nela mesmo girando ou aproximando a câmera.

import * as THREE from 'three';
import { createWorker } from 'tesseract.js';
import { makeCreature, addLights } from '../creatures.js';
import { NameMatcher, findCardsInLine } from '../recognition/nameMatcher.js';
import { GraySampler, CardTracker, cardRectFromTitle, grayFrame } from '../recognition/cardTracker.js';
import { detectCardQuad } from '../recognition/cardDetector.js';

const LOST_AFTER = 5; // segundos sem ver a carta até a criatura sumir
const MAX_SIDE = 1600; // resolução do quadro enviado ao OCR
const OUTLINE = '#ffd23f'; // amarelo do contorno da carta reconhecida
const PULSE = 0.7; // segundos do "flash" do contorno quando a carta é reconhecida
const CREATURE_SIZE = 0.62; // altura da criatura em relação à largura da carta (na tela)
const FEET_AT = 0.6; // onde ficam os pés: 0 = topo da carta, 1 = base
const DETECT_WIDTH = 640; // resolução usada para achar o contorno da carta

function ocrLines(data) {
  if (data.lines?.length) return data.lines;
  return (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
}

const centerOf = (q) => ({ x: q.reduce((s, p) => s + p.x, 0) / q.length, y: q.reduce((s, p) => s + p.y, 0) / q.length });

/** O ponto p está dentro do quad aumentado k vezes em volta do centro? */
function insideScaled(q, p, k) {
  const c = centerOf(q);
  const s = q.map((v) => ({ x: c.x + (v.x - c.x) * k, y: c.y + (v.y - c.y) * k }));
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = s[i];
    const b = s[(i + 1) % 4];
    const z = Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    if (!z) continue;
    if (sign && z !== sign) return false;
    sign = z;
  }
  return true;
}

const AX = new THREE.Vector3();
const AY = new THREE.Vector3();
const AZ = new THREE.Vector3();
const BASIS = new THREE.Matrix4();

/**
 * Orientação 3D da carta a partir do contorno na tela (q = [topo-esq, topo-dir, base-dir, base-esq]).
 * Resolve a pose de um retângulo 63x88 em projeção quase ortográfica; a perspectiva (lado mais
 * curto = mais longe) decide para que lado ela inclina. Devolve o quaternion da criatura:
 * "para cima" = normal da carta, frente (+Z do modelo) = topo da carta, ou seja, de costas para
 * quem está na base da carta, acompanhando quando a carta gira ou quando você anda em volta.
 */
function cardPose(q) {
  const mid = (p1, p2) => ({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
  const len = (p1, p2) => Math.hypot(p2.x - p1.x, p2.y - p1.y);
  // Eixos da carta na cena (y para cima): u = esquerda→direita, v = topo→base.
  const l = mid(q[0], q[3]), r = mid(q[1], q[2]), t = mid(q[0], q[1]), b = mid(q[3], q[2]);
  const u = { x: (r.x - l.x) / 63, y: -(r.y - l.y) / 63 };
  const v = { x: (b.x - t.x) / 88, y: -(b.y - t.y) / 88 };
  const uu = u.x * u.x + u.y * u.y, vv = v.x * v.x + v.y * v.y, uv = u.x * v.x + u.y * v.y;
  const sum = uu + vv;
  const s2 = (sum + Math.sqrt(Math.max(0, sum * sum - 4 * (uu * vv - uv * uv)))) / 2 || 1;
  let vz = Math.sqrt(Math.max(0, 1 - vv / s2));
  let uz = Math.sqrt(Math.max(0, 1 - uu / s2));
  // A borda mais perto da câmera aparece maior.
  if (len(q[3], q[2]) < len(q[0], q[1])) vz = -vz;
  if (Math.abs(vz) > 1e-3) uz = -uv / s2 / vz;
  else if (len(q[1], q[2]) < len(q[0], q[3])) uz = -uz;
  const s = Math.sqrt(s2);
  AX.set(u.x / s, u.y / s, uz).normalize(); // direita da carta
  AZ.set(-v.x / s, -v.y / s, -vz).normalize(); // topo da carta = para onde a criatura olha
  AY.crossVectors(AZ, AX).normalize(); // normal da carta = "para cima" da criatura
  if (AY.z < 0) AY.negate();
  AX.crossVectors(AY, AZ).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(BASIS.makeBasis(AX, AY, AZ));
}

const UP = new THREE.Vector3();
const FWD = new THREE.Vector3();
const SIDE = new THREE.Vector3();

/**
 * Pose da criatura: em pé, com a cabeça sempre para o alto da tela (o celular fica em pé e a mesa
 * embaixo), inclinada só o quanto a carta está inclinada, e girando junto com a carta no plano da mesa.
 * Usar a normal da carta crua deitava a criatura de lado sempre que o contorno saía um pouco torto.
 */
function creaturePose(q) {
  cardPose(q); // preenche AY (normal) e AZ (topo da carta)
  // nz = 1: câmera olhando a carta de cima; 0: de lado. Limitado para a criatura nunca sumir de perfil.
  const nz = THREE.MathUtils.clamp(Math.abs(AY.z), 0.35, 0.9);
  UP.set(0, Math.sqrt(1 - nz * nz), nz);
  FWD.copy(AZ).addScaledVector(UP, -AZ.dot(UP));
  if (FWD.lengthSq() < 1e-6) FWD.set(0, -nz, Math.sqrt(1 - nz * nz));
  FWD.normalize();
  SIDE.crossVectors(UP, FWD).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(BASIS.makeBasis(SIDE, UP, FWD));
}

export async function startBattlefield(view, { catalog, resolver, onStatus }) {
  const video = document.createElement('video');
  // iPhone: sem playsinline o vídeo abre no player nativo, e sem muted/autoplay ele não toca.
  for (const a of ['playsinline', 'muted', 'autoplay']) video.setAttribute(a, '');
  video.playsInline = true;
  video.muted = true;
  video.className = 'bf-video';
  const labels = document.createElement('div');
  labels.className = 'bf-labels';
  const outline = document.createElement('canvas');
  outline.className = 'bf-outline';
  view.prepend(video, outline, labels);

  onStatus('Abrindo a câmera…');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  video.srcObject = stream;
  await video.play();
  // O iPhone às vezes demora para informar o tamanho do vídeo.
  for (let i = 0; i < 50 && !video.videoWidth; i++) await new Promise((r) => setTimeout(r, 100));

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.domElement.className = 'bf-canvas';
  view.insertBefore(renderer.domElement, labels);
  const scene = new THREE.Scene();
  addLights(scene);
  // Câmera ortográfica em pixels da tela: (x, -y) = ponto da tela.
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -2000, 2000);
  const octx = outline.getContext('2d');
  const resize = () => {
    const w = view.clientWidth;
    const h = view.clientHeight;
    renderer.setSize(w, h);
    const dpr = window.devicePixelRatio || 1;
    outline.width = Math.round(w * dpr);
    outline.height = Math.round(h * dpr);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    camera.right = w;
    camera.bottom = -h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  onStatus('Preparando o reconhecimento de cartas…');
  const matcher = new NameMatcher(catalog);
  const worker = await createWorker(['eng', 'por'], 1);
  // Alterna o modo do OCR a cada leitura: o automático (3) lê melhor o nome em versalete dos tokens;
  // o de texto esparso (11) lê melhor o nome das cartas normais e não junta texto de cartas vizinhas.
  const PSM = ['3', '11'];
  let pass = 0;

  /** Converte pontos do vídeo para a tela (o vídeo usa object-fit: cover). */
  const toScreen = (pts) => {
    const vw = view.clientWidth;
    const vh = view.clientHeight;
    const s = Math.max(vw / video.videoWidth, vh / video.videoHeight);
    const ox = (vw - video.videoWidth * s) / 2;
    const oy = (vh - video.videoHeight * s) / 2;
    return pts.map((p) => ({ x: p.x * s + ox, y: p.y * s + oy }));
  };
  /** Ponto (u, v) da carta na tela: u = 0 esquerda → 1 direita, v = 0 topo → 1 base. */
  const onCard = (q, u, v) => {
    const top = { x: q[0].x + (q[1].x - q[0].x) * u, y: q[0].y + (q[1].y - q[0].y) * u };
    const bot = { x: q[3].x + (q[2].x - q[3].x) * u, y: q[3].y + (q[2].y - q[3].y) * u };
    return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
  };
  /** Onde a criatura fica: em pé sobre a carta (pés um pouco abaixo do centro), do tamanho da carta. */
  const placement = (quadVideo) => {
    const q = toScreen(quadVideo);
    const feet = onCard(q, 0.5, FEET_AT);
    // Largura da carta na altura dos pés (na perspectiva, a parte de trás aparece menor).
    const width = Math.hypot(onCard(q, 1, FEET_AT).x - onCard(q, 0, FEET_AT).x, onCard(q, 1, FEET_AT).y - onCard(q, 0, FEET_AT).y);
    return { x: feet.x, y: feet.y, size: width * CREATURE_SIZE, bottom: onCard(q, 0.5, 1), quad: q, rot: creaturePose(q) };
  };
  const sampler = new GraySampler();

  // Uma entrada por carta FÍSICA na mesa: dá para ter várias cópias da mesma carta ou token.
  const onField = new Map(); // id -> { card, creature, label, tracker, lastSeen, ... }
  if (import.meta.env.DEV) window.__battlefield = onField; // inspeção no navegador durante o desenvolvimento
  const misses = new Map(); // oracleId -> leituras seguidas em que o contorno não foi achado
  let nextId = 1;
  let running = true;
  let elapsed = 0;

  /**
   * A carta já em campo que corresponde a este texto lido (center em pixels do vídeo):
   * a cópia cujo contorno contém o texto, senão uma cópia que se perdeu (para reencontrá-la).
   * null = é uma carta nova (outra cópia, em outro lugar da mesa).
   */
  function findEntry(card, center) {
    const same = [...onField.values()].filter((e) => e.card.oracleId === card.oracleId);
    const here = same.find((e) => insideScaled(e.tracker.quadVideo(), center, 1.3));
    if (here) return here;
    return same.filter((e) => !e.tracker.ok).sort((a, b) => b.lastSeen - a.lastSeen)[0] ?? null;
  }

  const grab = document.createElement('canvas');
  const ocrCanvas = document.createElement('canvas');
  const ocrCtx = ocrCanvas.getContext('2d');
  const detectSampler = document.createElement('canvas');
  const detectCtx = detectSampler.getContext('2d', { willReadFrequently: true });
  async function ocrLoop() {
    while (running) {
      if (!video.videoWidth) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      const k = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
      grab.width = Math.round(video.videoWidth * k);
      grab.height = Math.round(video.videoHeight * k);
      grab.getContext('2d').drawImage(video, 0, 0, grab.width, grab.height);
      // Cinza do MESMO quadro: a carta achada pelo OCR é seguida deste quadro até o atual.
      const snapshot = sampler.sample(grab, video.videoWidth, video.videoHeight);
      // Para o OCR, tapa as cartas que já estão presas: o texto delas atrapalha a leitura das novas
      // (o Tesseract monta o layout com tudo junto). O grab fica limpo para achar contornos.
      ocrCanvas.width = grab.width;
      ocrCanvas.height = grab.height;
      ocrCtx.drawImage(grab, 0, 0);
      ocrCtx.fillStyle = '#808080';
      for (const e of onField.values()) {
        if (!e.tracker.ok) continue;
        ocrCtx.beginPath();
        e.tracker.quadVideo().forEach((p, i) => (i ? ocrCtx.lineTo(p.x * k, p.y * k) : ocrCtx.moveTo(p.x * k, p.y * k)));
        ocrCtx.fill();
      }
      let detect = null; // quadro maior, só gerado se o OCR achar alguma carta
      let data;
      try {
        await worker.setParameters({ tessedit_pageseg_mode: PSM[pass++ % PSM.length] });
        ({ data } = await worker.recognize(ocrCanvas, {}, { blocks: true, text: true }));
      } catch (err) {
        console.warn('OCR falhou neste quadro', err);
        continue;
      }
      if (!running) break;

      if (import.meta.env.DEV) window.__bfOcr = { psm: PSM[(pass - 1) % PSM.length], lines: ocrLines(data).map((l) => `${l.confidence | 0} ${l.text.trim()}`), misses };
      const found = [];
      for (const line of ocrLines(data)) {
        // A confiança da linha cai quando o OCR junta texto de duas cartas; o filtro fino é por palavra.
        if (line.confidence < 20) continue;
        found.push(...findCardsInLine(matcher, line));
      }
      if (import.meta.env.DEV) window.__bfOcr.found = found.map((m) => `${m.anchor} ${m.card.name} (${m.text})`);
      for (const m of found) {
        // Caixa SÓ das palavras do nome (ou da linha de tipo do token), em pixels do grab.
        const { x0, y0, x1, y1 } = m.bbox;
        const center = { x: (x0 + x1) / 2 / k, y: (y0 + y1) / 2 / k };
        // Texto impresso dentro de OUTRA carta já presa (regras, citação): não é carta nova.
        if ([...onField.values()].some((e) => e.card.oracleId !== m.card.oracleId && e.tracker.ok
          && insideScaled(e.tracker.quadVideo(), center, 0.95))) continue;
        const entry = findEntry(m.card, center);
        if (entry?.tracker.ok) {
          entry.lastSeen = elapsed; // já está presa na carta
          continue;
        }
        if (!detect) {
          const ds = DETECT_WIDTH / video.videoWidth;
          detectSampler.width = DETECT_WIDTH;
          detectSampler.height = Math.round(video.videoHeight * ds);
          detectCtx.drawImage(grab, 0, 0, detectSampler.width, detectSampler.height);
          detect = grayFrame(detectCtx.getImageData(0, 0, detectSampler.width, detectSampler.height).data,
            detectSampler.width, detectSampler.height, ds);
        }
        const f = detect.scale / k; // pixels do grab -> pixels do quadro de detecção
        const quad = detectCardQuad(detect, { x0: x0 * f, y0: y0 * f, x1: x1 * f, y1: y1 * f }, { anchor: m.anchor });
        if (quad) {
          misses.delete(m.card.oracleId);
          summon(m.card, { quad: quad.map((p) => ({ x: p.x / detect.scale, y: p.y / detect.scale })) }, snapshot, entry);
          continue;
        }
        // Sem bordas claras (carta cortada, mão na frente): espera a próxima leitura antes de chutar
        // o contorno pelo tamanho do nome, que é bem menos preciso. Só com leitura limpa (a linha é o nome
        // e nada mais, bem lido): um nome achado no meio do texto de regras nunca vira criatura sem contorno.
        const n = (misses.get(m.card.oracleId) ?? 0) + 1;
        misses.set(m.card.oracleId, n);
        const trusty = m.anchor === 'title' && m.strict && m.score >= 0.95 && m.text.replace(/[^\p{L}]/gu, '').length >= 6;
        if (n >= 3 && trusty) {
          summon(m.card, { rect: cardRectFromTitle({ x0: x0 / k, y0: y0 / k, x1: x1 / k, y1: y1 / k }) }, snapshot, entry);
        }
      }
      refreshStatus();
    }
  }

  function summon(card, start, snapshot, entry) {
    const tracker = new CardTracker(snapshot, start);
    if (!tracker.valid) return;
    if (!entry) {
      const choice = resolver.resolve(card);
      const creature = makeCreature(choice, { height: 1 });
      const p = placement(tracker.quadVideo());
      creature.quaternion.copy(p.rot); // em pé sobre a carta, de costas para quem a colocou
      creature.scale.setScalar(p.size);
      creature.position.set(p.x, -p.y, 0);
      creature.userData.spawn();
      scene.add(creature);
      const label = document.createElement('div');
      label.className = 'bf-label';
      label.textContent = `${card.displayName} · ${resolver.label(choice.modelId)}`;
      labels.append(label);
      entry = { id: nextId++, creature, label, card, place: p, quad: p.quad, seenAt: elapsed };
      onField.set(entry.id, entry);
    }
    entry.tracker = tracker;
    entry.lastSeen = elapsed;
    entry.recognizedAt = elapsed; // dispara o flash do contorno
  }

  /** Contorno amarelo da carta: brilha forte ao ser reconhecida e fica fixo enquanto a vê. */
  function drawOutline(e) {
    const age = elapsed - (e.recognizedAt ?? -99);
    const pulse = age < PULSE ? 1 - age / PULSE : 0;
    const visible = e.tracker.ok || elapsed - e.lastSeen < 0.4;
    if (!visible && !pulse) return;
    const q = e.quad;
    octx.save();
    octx.globalAlpha = e.tracker.ok ? 1 : 0.4;
    octx.strokeStyle = OUTLINE;
    octx.lineJoin = 'round';
    octx.shadowColor = OUTLINE;
    octx.shadowBlur = 10 + 20 * pulse;
    octx.lineWidth = 3 + 7 * pulse;
    octx.beginPath();
    q.forEach((p, i) => (i ? octx.lineTo(p.x, p.y) : octx.moveTo(p.x, p.y)));
    octx.closePath();
    octx.stroke();
    if (pulse) {
      octx.fillStyle = OUTLINE;
      octx.globalAlpha = 0.18 * pulse;
      octx.fill();
    }
    octx.restore();
  }

  function refreshStatus() {
    const count = new Map();
    for (const e of onField.values()) count.set(e.card.displayName, (count.get(e.card.displayName) ?? 0) + 1);
    const names = [...count].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n));
    onStatus(names.length
      ? `Em campo: ${names.join(', ')}`
      : 'Aponte a câmera para suas cartas, com o nome bem visível');
  }

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    elapsed += dt;
    const frame = onField.size && video.videoWidth ? sampler.sample(video, video.videoWidth, video.videoHeight) : null;
    octx.clearRect(0, 0, view.clientWidth, view.clientHeight);
    for (const [id, e] of onField) {
      if (frame && e.tracker.track(frame)) {
        e.lastSeen = elapsed;
        e.place = placement(e.tracker.quadVideo());
        e.quad = e.place.quad;
      }
      // Duas entradas presas na mesma carta física (o quadro do OCR é de 1-3 s atrás): fica a mais antiga.
      const twin = e.tracker.ok && [...onField.values()].find((o) => o !== e && o.id < e.id
        && o.card.oracleId === e.card.oracleId && o.tracker.ok
        && insideScaled(o.tracker.quadVideo(), centerOf(e.tracker.quadVideo()), 0.4));
      if (twin || elapsed - e.lastSeen > LOST_AFTER) {
        scene.remove(e.creature);
        e.label.remove();
        onField.delete(id);
        refreshStatus();
        continue;
      }
      drawOutline(e);
      // O rastreador já é estável: só um filtro leve para tirar o tremor de 1 pixel.
      const c = e.creature;
      const p = e.place;
      const ease = 1 - Math.exp(-dt * 25);
      c.position.x += (p.x - c.position.x) * ease;
      c.position.y += (-p.y - c.position.y) * ease;
      c.quaternion.slerp(p.rot, 1 - Math.exp(-dt * 12));
      c.scale.setScalar(c.scale.x + (p.size - c.scale.x) * (1 - Math.exp(-dt * 4)));
      c.userData.update(dt);
      e.label.style.transform = `translate(${p.bottom.x}px, ${p.bottom.y + 8}px) translateX(-50%)`;
    }
    renderer.render(scene, camera);
  });

  refreshStatus();
  ocrLoop();

  return () => {
    running = false;
    renderer.setAnimationLoop(null);
    window.removeEventListener('resize', resize);
    stream.getTracks().forEach((t) => t.stop());
    worker.terminate();
    renderer.dispose();
    video.remove();
    labels.remove();
    outline.remove();
    renderer.domElement.remove();
  };
}
