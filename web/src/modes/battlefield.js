// Campo de batalha: câmera em tela cheia que reconhece QUALQUER carta sozinha, sem cadastro.
// Lê o nome impresso na carta (OCR com tesseract.js, modelo de português: lê inglês e português), acha a carta no catálogo
// inteiro (NameMatcher), acha o contorno real da carta em volta do nome (cardDetector), contorna de
// amarelo e faz a criatura surgir em pé sobre ela.
// Entre uma leitura e outra, o CardTracker segue a carta quadro a quadro (fluxo óptico),
// então o contorno e a criatura ficam presos nela mesmo girando ou aproximando a câmera.
// Cada leitura usa o quadro girado (0°, 180°, às vezes 90°/270°): lê também a carta de ponta-cabeça
// e a carta virada de lado. Virar a carta 90° em relação a como ela surgiu faz a criatura atacar.

import * as THREE from 'three';
import { getOcrReaders } from '../recognition/ocr.js';
import { makeCreature, addLights } from '../creatures.js';
import { NameMatcher, findCardsInLine, mergeRowLines } from '../recognition/nameMatcher.js';
import { GraySampler, CardTracker, cardRectFromTitle, grayFrame } from '../recognition/cardTracker.js';
import { detectCardQuad } from '../recognition/cardDetector.js';
import { rotationFor, fromRotated, drawRotated } from '../recognition/orientation.js';
import { cardPose, cardYaw, TapWatcher, AY, AZ } from '../recognition/cardTurn.js';

// Segundos sem ver a carta até a criatura morrer (a carta saiu da mesa). Menos que isso pega a
// câmera tremida ou a mão passando na frente: o OCR leva 1-3 s para reencontrar a carta.
const LOST_AFTER = 3.5;
const MAX_SIDE = 1600; // resolução do quadro enviado ao OCR
const OUTLINE = '#ffd23f'; // amarelo do contorno da carta reconhecida
const PULSE = 0.7; // segundos do "flash" do contorno quando a carta é reconhecida
const CREATURE_SIZE = 0.62; // altura da criatura em relação à largura da carta (na tela)
const FEET_AT = 0.5; // onde ficam os pés: 0 = topo da carta, 1 = base (no centro da carta)
const DETECT_WIDTH = 640; // resolução usada para achar o contorno da carta
const STRIKE = '#ff5a2a'; // cor do contorno no ataque (carta virada)
const STRIKE_FLASH = 0.5; // segundos do flash do ataque

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

function quadArea(q) {
  let s = 0;
  for (let i = 0; i < q.length; i++) s += q[i].x * q[(i + 1) % q.length].y - q[(i + 1) % q.length].x * q[i].y;
  return Math.abs(s / 2);
}

/** Os dois contornos estão na mesma carta física (um tem o centro dentro do outro)? */
const sameSpot = (a, b, k = 1) => insideScaled(a, centerOf(b), k) || insideScaled(b, centerOf(a), k);

/**
 * Entre dois contornos na mesma carta física, qual fica: o bem maior (o outro é um pedaço da carta,
 * como a caixa de texto achada a partir de uma linha mal lida); com tamanhos parecidos, o mais antigo.
 */
const outranks = (a, b) => {
  const qa = a.tracker.quadVideo();
  const qb = b.tracker.quadVideo();
  if (quadArea(qa) > quadArea(qb) * 1.5) return true;
  if (quadArea(qb) > quadArea(qa) * 1.5) return false;
  return a.id < b.id;
};

const BASIS = new THREE.Matrix4();

const UP = new THREE.Vector3();
const FWD = new THREE.Vector3();
const SIDE = new THREE.Vector3();

/**
 * Pose da criatura: em pé, com a cabeça sempre para o alto da tela (o celular fica em pé e a mesa
 * embaixo), inclinada só o quanto a carta está inclinada, e girando junto com a carta no plano da mesa.
 * Usar a normal da carta crua deitava a criatura de lado sempre que o contorno saía um pouco torto.
 * Frente (+Z do modelo) = TOPO da carta: a criatura fica de costas para quem jogou a carta, olhando
 * para o campo do oponente, e gira junto quando a carta gira.
 */
function creaturePose(q) {
  cardPose(q); // preenche AY (normal) e AZ (topo da carta)
  // nz = 1: câmera olhando a carta de cima; 0: de lado. Limitado para a criatura nunca sumir de perfil.
  const nz = THREE.MathUtils.clamp(Math.abs(AY.z), 0.35, 0.9);
  UP.set(0, Math.sqrt(1 - nz * nz), nz);
  FWD.copy(AZ).addScaledVector(UP, -AZ.dot(UP));
  if (FWD.lengthSq() < 1e-6) FWD.set(0, nz, -Math.sqrt(1 - nz * nz));
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
  let running = true;
  // Leitores de OCR já aquecidos pelo menu; o segundo (outro modo de leitura) entra quando ficar pronto
  // e roda em paralelo, dobrando a frequência de leituras.
  // (Só começa a ler depois que tudo abaixo estiver montado.)
  const extraReaders = [];
  let startReader = (r) => extraReaders.push(r);
  const firstReader = await getOcrReaders((r) => startReader(r));

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
    // Nome embaixo do lado mais baixo NA TELA (na carta de ponta-cabeça, a base da carta fica em cima).
    const sides = [onCard(q, 0.5, 0), onCard(q, 1, 0.5), onCard(q, 0.5, 1), onCard(q, 0, 0.5)];
    const bottom = sides.reduce((lo, p) => (p.y > lo.y ? p : lo));
    return { x: feet.x, y: feet.y, size: width * CREATURE_SIZE, bottom, quad: q, rot: creaturePose(q) };
  };
  const sampler = new GraySampler();

  // Uma entrada por carta FÍSICA na mesa: dá para ter várias cópias da mesma carta ou token.
  const onField = new Map(); // id -> { card, creature, label, tracker, lastSeen, ... }
  if (import.meta.env.DEV) window.__battlefield = onField; // inspeção no navegador durante o desenvolvimento
  const misses = new Map(); // oracleId -> leituras seguidas em que o contorno não foi achado
  let nextId = 1;
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

  const detectSampler = document.createElement('canvas');
  let readerCount = 0;
  async function ocrLoop(reader) {
    // Canvas próprios de cada leitor: os dois rodam ao mesmo tempo.
    const grab = document.createElement('canvas');
    const ocrCanvas = document.createElement('canvas');
    const ocrCtx = ocrCanvas.getContext('2d');
    const ocrTurned = document.createElement('canvas');
    // Leitores fora de fase: enquanto um lê o quadro em pé, o outro lê de ponta-cabeça.
    let pass = readerCount++;
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
      // Giro desta leitura. Com carta perdida (a mão passou na frente ao virá-la), lê de lado mais vezes.
      const lost = [...onField.values()].some((e) => !e.tracker.ok);
      const rot = rotationFor(pass++, lost);
      if (rot) drawRotated(ocrCanvas, rot, ocrTurned);
      /** Ponto do quadro girado (pixels do vídeo) de volta para o vídeo. */
      const unturn = (p) => fromRotated(p, rot, video.videoWidth, video.videoHeight);
      let detect = null; // quadro maior, só gerado se o OCR achar alguma carta
      let data;
      try {
        ({ data } = await reader.worker.recognize(rot ? ocrTurned : ocrCanvas, {}, { blocks: true, text: true }));
      } catch (err) {
        console.warn('OCR falhou neste quadro', err);
        continue;
      }
      if (!running) break;

      if (import.meta.env.DEV) window.__bfOcr = { psm: reader.psm, rot, lines: ocrLines(data).map((l) => `${l.confidence | 0} ${l.text.trim()}`), misses };
      const found = [];
      // O modo esparso quebra uma linha em pedaços; junta os da mesma altura antes de procurar nomes.
      for (const line of mergeRowLines(ocrLines(data))) {
        // A confiança da linha cai quando o OCR junta texto de duas cartas; o filtro fino é por palavra.
        if (line.confidence < 20) continue;
        found.push(...findCardsInLine(matcher, line));
      }
      if (import.meta.env.DEV) window.__bfOcr.found = found.map((m) => `${m.anchor} ${m.card.name} (${m.text})`);
      for (const m of found) {
        // Caixa SÓ das palavras do nome (ou da linha de tipo do token), em pixels do grab GIRADO.
        const { x0, y0, x1, y1 } = m.bbox;
        const center = unturn({ x: (x0 + x1) / 2 / k, y: (y0 + y1) / 2 / k });
        // Texto impresso dentro de OUTRA carta já presa (regras, citação): não é carta nova.
        if ([...onField.values()].some((e) => e.card.oracleId !== m.card.oracleId && e.tracker.ok
          && insideScaled(e.tracker.quadVideo(), center, 0.95))) continue;
        const entry = findEntry(m.card, center);
        if (entry?.tracker.ok) {
          entry.lastSeen = elapsed; // já está presa na carta
          continue;
        }
        if (!detect) {
          // Quadro de detecção girado igual ao do OCR: o nome fica em pé e o cardDetector acha a carta
          // normalmente. Os cantos voltam para o vídeo na ordem da carta (topo da carta primeiro).
          const ds = DETECT_WIDTH / video.videoWidth;
          const ctx = drawRotated(grab, rot, detectSampler, ds / k);
          detect = grayFrame(ctx.getImageData(0, 0, detectSampler.width, detectSampler.height).data,
            detectSampler.width, detectSampler.height, ds);
        }
        const f = detect.scale / k; // pixels do grab -> pixels do quadro de detecção
        const quad = detectCardQuad(detect, { x0: x0 * f, y0: y0 * f, x1: x1 * f, y1: y1 * f }, { anchor: m.anchor });
        if (quad) {
          misses.delete(m.card.oracleId);
          const vq = quad.map((p) => unturn({ x: p.x / detect.scale, y: p.y / detect.scale }));
          // Uma criatura por carta FÍSICA: se o contorno cai numa carta já presa, é a mesma carta.
          const other = [...onField.values()].find((e) => e !== entry && e.tracker.ok && sameSpot(e.tracker.quadVideo(), vq));
          if (other) {
            const bigger = quadArea(vq) > quadArea(other.tracker.quadVideo()) * 1.5;
            if (!bigger || m.anchor !== 'title') {
              if (other.card.oracleId === m.card.oracleId) other.lastSeen = elapsed;
              continue;
            }
            // A carta presa era só um pedaço desta (a caixa de texto): o nome lido agora manda.
            if (other.card.oracleId === m.card.oracleId) {
              summon(m.card, { quad: vq }, snapshot, other);
              continue;
            }
            dismiss(other);
          }
          summon(m.card, { quad: vq }, snapshot, entry);
          continue;
        }
        // Sem bordas claras (carta cortada, mão na frente): espera a próxima leitura antes de chutar
        // o contorno pelo tamanho do nome, que é bem menos preciso. Só com leitura limpa (a linha é o nome
        // e nada mais, bem lido): um nome achado no meio do texto de regras nunca vira criatura sem contorno.
        const n = (misses.get(m.card.oracleId) ?? 0) + 1;
        misses.set(m.card.oracleId, n);
        // Nome que também é habilidade ("Vigilance", "Flash") nunca: é quase sempre a linha da caixa de texto.
        const trusty = m.anchor === 'title' && m.strict && !m.keyword && m.score >= 0.95
          && m.text.replace(/[^\p{L}]/gu, '').length >= 6;
        if (n >= 2 && trusty) {
          const r = cardRectFromTitle({ x0: x0 / k, y0: y0 / k, x1: x1 / k, y1: y1 / k });
          const corners = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
          summon(m.card, rot ? { quad: corners.map(unturn), rough: true } : { rect: r }, snapshot, entry);
        }
      }
      refreshStatus();
    }
  }

  function dismiss(e) {
    scene.remove(e.creature);
    e.label.remove();
    e.spinner?.remove();
    onField.delete(e.id);
  }

  // Criaturas morrendo: já saíram do campo (a carta pode voltar e invocar outra), mas continuam na
  // cena até a animação de morte acabar.
  const dying = new Set();

  /** A carta saiu da mesa: a criatura morre no último lugar onde a carta estava. */
  function kill(e) {
    dismiss(e);
    if (e.creature.userData.loading) return; // ainda nem apareceu
    e.creature.userData.die();
    scene.add(e.creature);
    dying.add(e.creature);
  }

  function summon(card, start, snapshot, entry) {
    const tracker = new CardTracker(snapshot, start);
    if (!tracker.valid) return;
    if (!entry) {
      const choice = resolver.resolve(card);
      const creature = makeCreature(choice, { height: 1, waitForModel: true });
      const p = placement(tracker.quadVideo());
      creature.quaternion.copy(p.rot); // em pé sobre a carta, de costas para quem a colocou
      creature.scale.setScalar(p.size);
      creature.position.set(p.x, -p.y, 0);
      creature.userData.spawn();
      scene.add(creature);
      const label = document.createElement('div');
      label.className = 'bf-label';
      label.textContent = `${card.displayName} · ${resolver.label(choice.modelId)}`;
      // Círculo girando sobre a carta enquanto o modelo 3D da criatura baixa.
      const spinner = document.createElement('div');
      spinner.className = 'bf-loading';
      spinner.setAttribute('role', 'status');
      spinner.setAttribute('aria-label', `Carregando ${card.displayName}`);
      labels.append(label, spinner);
      // O giro de agora é a referência: virar a carta 90° a partir daqui faz a criatura atacar.
      const taps = new TapWatcher();
      taps.update(cardYaw(p.quad), 0);
      entry = { id: nextId++, creature, label, spinner, card, place: p, quad: p.quad, seenAt: elapsed, taps };
      onField.set(entry.id, entry);
    }
    entry.tracker = tracker;
    entry.lastSeen = elapsed;
    entry.recognizedAt = elapsed; // dispara o flash do contorno
  }

  /** Contorno amarelo da carta: brilha forte ao ser reconhecida e fica fixo enquanto a vê. */
  function drawOutline(e) {
    const age = elapsed - (e.recognizedAt ?? -99);
    const strikeAge = elapsed - (e.strikeAt ?? -99);
    const strike = strikeAge < STRIKE_FLASH ? 1 - strikeAge / STRIKE_FLASH : 0;
    const pulse = Math.max(age < PULSE ? 1 - age / PULSE : 0, strike);
    const color = strike ? STRIKE : OUTLINE;
    const visible = e.tracker.ok || elapsed - e.lastSeen < 0.4;
    if (!visible && !pulse) return;
    const q = e.quad;
    octx.save();
    octx.globalAlpha = e.tracker.ok ? 1 : 0.4;
    octx.strokeStyle = color;
    octx.lineJoin = 'round';
    octx.shadowColor = color;
    octx.shadowBlur = 10 + 20 * pulse;
    octx.lineWidth = 3 + 7 * pulse;
    octx.beginPath();
    q.forEach((p, i) => (i ? octx.lineTo(p.x, p.y) : octx.moveTo(p.x, p.y)));
    octx.closePath();
    octx.stroke();
    if (pulse) {
      octx.fillStyle = color;
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
        // Carta virada 90° em relação a como surgiu: a criatura ataca com o golpe mais forte.
        if (e.taps.update(cardYaw(e.quad), dt) && e.creature.userData.attack()) e.strikeAt = elapsed;
      }
      // Duas entradas presas na mesma carta física (o quadro do OCR é de 1-3 s atrás, ou uma linha
      // de tipo/regras lida como nome): uma carta só tem uma criatura. Fica a da carta inteira.
      const twin = e.tracker.ok && [...onField.values()].find((o) => o !== e && o.tracker.ok
        && sameSpot(o.tracker.quadVideo(), e.tracker.quadVideo(), 0.8) && outranks(o, e));
      if (twin) {
        dismiss(e); // cópia da mesma carta física: some sem morrer
        refreshStatus();
        continue;
      }
      if (elapsed - e.lastSeen > LOST_AFTER) {
        kill(e);
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
      if (e.spinner) {
        if (c.userData.loading) {
          // No meio da carta, do tamanho de ~1/3 da largura dela.
          const mid = onCard(p.quad, 0.5, 0.5);
          const size = Math.max(28, Math.min(80, p.size * 0.55));
          e.spinner.style.width = e.spinner.style.height = `${size}px`;
          e.spinner.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
          e.spinner.style.borderWidth = `${Math.max(3, size / 11)}px`;
          e.spinner.style.translate = `${mid.x}px ${mid.y}px`;
        } else {
          e.spinner.remove();
          e.spinner = null;
        }
      }
    }
    for (const c of dying) {
      c.userData.update(dt);
      if (c.userData.gone) {
        scene.remove(c);
        dying.delete(c);
      }
    }
    renderer.render(scene, camera);
  });

  refreshStatus();
  startReader = (r) => { if (running) ocrLoop(r); };
  [firstReader, ...extraReaders].forEach(startReader);

  return () => {
    running = false;
    renderer.setAnimationLoop(null);
    window.removeEventListener('resize', resize);
    stream.getTracks().forEach((t) => t.stop());
    // Os leitores de OCR ficam vivos: voltar ao campo de batalha é instantâneo.
    for (const e of onField.values()) e.spinner?.remove();
    renderer.dispose();
    video.remove();
    labels.remove();
    outline.remove();
    renderer.domElement.remove();
  };
}
