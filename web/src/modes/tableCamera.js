// Modo Mesa com a câmera PARADA: PC (webcam), iPhone e Androids sem ARCore. Não precisa de WebXR.
// A câmera fica num suporte apontada para a mesa (a montagem recomendada no PLANO §2). Você põe uma
// folha A4 (ou um playmat, ou uma carta) no centro da mesa e toca nos 4 cantos dela; o "imã" encaixa os
// cantos na borda do papel e a pose da câmera sai do retângulo de tamanho conhecido (PLANO §5.2, método 2).
// Depois, o mesmo fluxo do modo WebXR: ajustar a área, confirmar e tocar na mesa para invocar.
// Se a câmera se mexer, a imagem inteira muda e o app pede para recalibrar.

import * as THREE from 'three';
import { addLights } from '../creatures.js';
import { TableFrame, Seat } from '../table/tableFrame.js';
import {
  REFERENCES, calibrateFromRect, refineCorners, coverIntrinsics, coverTransform, videoToView, viewToVideo,
  projectionMatrix, cameraWorldMatrix, rayFromView, projectToView, imageShift, cameraMoved, edgePixels, orderCorners,
} from '../table/cameraPose.js';
import {
  HANDLE_OFFSET, v3, frameMatrix, makeArea, setAreaOpacity, disposeTree, makeTableRig, fitShadowCatcher,
  animateAreaFade, RecognizedCreatures,
} from '../table/tableVisuals.js';
import { CardWatch } from '../table/cardWatch.js';
import { TableCards, planScans, scanOrder, coverage, BlockMemory } from '../table/tableCards.js';
import { TableCardScanner, blockSignature, signatureChange } from '../table/cardScanner.js';

const GOLD = '#d4af37';
const CORNER_GRAB = 28; // px na tela para agarrar um canto
const DRAG_PX = 6; // abaixo disso o toque é toque, não arrasto
const SHIFT_SIZE = [80, 45]; // imagem pequena para notar a câmera mexida (1 px aqui ≈ 16 px num vídeo de 1280)
const SHIFT_EVERY = 1; // segundos entre uma checagem e outra
const SHIFT_STRIKES = 2; // checagens seguidas para avisar (uma mão passando não basta)
const SHIFT_REFRESH = 10; // segundos: renova a imagem de referência enquanto a câmera está parada
const MIN_EDGES = 60; // com menos bordas que isso (mesa lisa e vazia) não dá para saber
const REF_KEY = 'mesaviva.mesaRef';
const WATCH_EVERY = 0.25; // s: o vigia de giro olha as cartas 4 vezes por segundo
const REF_PHRASE = {
  a4: 'uma folha A4',
  letter: 'uma folha tamanho carta',
  playmat: 'o playmat',
  card: 'uma carta em pé, virada para você,',
};
const REF_SHORT = { a4: 'a folha', letter: 'a folha', playmat: 'o playmat', card: 'a carta' };

export function isCameraTableSupported() {
  return !!navigator.mediaDevices?.getUserMedia;
}

function grayOf(ctx, w, h) {
  const px = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
  return out;
}

/**
 * view: contêiner em tela cheia (recebe o vídeo e os toques).
 * ui: os mesmos controles do modo WebXR + { referenceRow, reference, corners }.
 * Retorna uma função que encerra o modo.
 */
export async function startCameraTableMode({ view, ui, catalog, resolver, onEnd }) {
  const video = document.createElement('video');
  for (const a of ['playsinline', 'muted', 'autoplay']) video.setAttribute(a, '');
  video.playsInline = true;
  video.muted = true;
  video.className = 'bf-video';
  const marks = document.createElement('canvas');
  marks.className = 'bf-outline';
  view.prepend(video, marks);

  ui.status.textContent = 'Abrindo a câmera…';
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    // 4K quando der: na mesa as cartas do lado de lá aparecem pequenas, e o nome só é lido com resolução.
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
  });
  video.srcObject = stream;
  await video.play();
  for (let i = 0; i < 50 && !video.videoWidth; i++) await new Promise((r) => setTimeout(r, 100));
  const VW = video.videoWidth;
  const VH = video.videoHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'bf-canvas';
  marks.before(renderer.domElement);

  const scene = new THREE.Scene();
  addLights(scene);
  const camera = new THREE.PerspectiveCamera();
  camera.matrixAutoUpdate = false;
  const { tableRoot, shadowCatcher } = makeTableRig(scene);

  const listeners = new AbortController();
  const { signal } = listeners;

  // ---------------- estado
  let state = 'corners'; // 'corners' → 'adjusting' → 'confirmed'
  let refKey = 'a4';
  try { refKey = localStorage.getItem(REF_KEY) ?? 'a4'; } catch { /* sem armazenamento */ }
  if (!REFERENCES[refKey]) refKey = 'a4';
  ui.reference.value = refKey;
  let clicks = []; // cantos em pixels do VÍDEO
  let cal = null;
  let k = null; // intrínsecas na tela
  let frame = null;
  let area = null;
  let areaSize = '';
  let sizeScale = Number(ui.size.value) || 1;
  let seat = Seat.NearCamera;
  let fade = null;
  let notice = null;
  let clock = 0;
  let viewW = 1;
  let viewH = 1;
  let pointer = null; // { id, start, mode: 'corner' | 'rotate' | 'move' | 'tap', index, offset, moved }
  // Câmera mexida
  const small = document.createElement('canvas');
  [small.width, small.height] = SHIFT_SIZE;
  const smallCtx = small.getContext('2d', { willReadFrequently: true });
  let reference = null; // { img, idx, at }
  let noise = 0.5;
  let shiftTimer = 0;
  let shiftStrikes = 0;
  let moved = false;

  function takeReference() {
    const img = smallGray();
    const idx = edgePixels(img, SHIFT_SIZE[0], SHIFT_SIZE[1], 3);
    reference = idx.length >= MIN_EDGES ? { img, idx, at: clock } : null;
  }

  /** Checa se a câmera se mexeu (só depois de confirmar). Não bloqueia nada: só avisa. */
  function checkCamera() {
    if (!reference) {
      takeReference();
      return;
    }
    const shift = imageShift(reference.img, smallGray(), SHIFT_SIZE[0], SHIFT_SIZE[1], 3, reference.idx);
    if (clock - reference.at < 2.5 && !shift.dx && !shift.dy) noise = Math.max(noise, shift.zero); // ruído do sensor
    shiftStrikes = cameraMoved(shift, noise) ? shiftStrikes + 1 : 0;
    const nowMoved = shiftStrikes >= SHIFT_STRIKES;
    if (nowMoved !== moved) {
      moved = nowMoved;
      renderStatus();
    }
    // Parada e alinhada: absorve cartas novas, a folha tirada da mesa e a luz mudando.
    if (!moved && !shift.dx && !shift.dy && clock - reference.at > SHIFT_REFRESH) takeReference();
  }

  const MESSAGES = {
    corners: () => `Ponha ${REF_PHRASE[refKey]} no centro da mesa e toque nos 4 cantos (${Math.min(clicks.length, 4)}/4)`,
    adjusting: () => 'Arraste os cantos dourados até a borda, mova ou gire a área e confirme',
    confirmed: () => (ui.recognize.checked
      ? 'Ponha as cartas na mesa: cada uma vira a criatura dela. Vire a carta para atacar'
      : 'Reconhecimento das cartas pausado'),
  };

  function renderStatus() {
    let text;
    let level = 'ok';
    if (moved && state === 'confirmed') {
      text = `A câmera se mexeu: ponha ${REF_SHORT[refKey]} de volta no centro e toque em Recalibrar`;
      level = 'error';
    } else if (notice && clock < notice.until) {
      ({ text, level } = notice);
    } else {
      text = MESSAGES[state]();
    }
    if (ui.status.textContent !== text) ui.status.textContent = text;
    ui.status.dataset.level = level;
  }

  function say(text, seconds = 2.5, level = 'ok') {
    notice = { text, level, until: clock + seconds };
    renderStatus();
  }

  function refreshUi() {
    const adjusting = state === 'adjusting';
    ui.progress.hidden = true;
    ui.retry.hidden = true;
    ui.referenceRow.hidden = state === 'confirmed';
    ui.adjust.hidden = !adjusting;
    ui.sizeRow.hidden = !adjusting;
    ui.confirm.hidden = !adjusting;
    ui.corners.hidden = state !== 'adjusting' && !(state === 'corners' && clicks.length);
    ui.recalibrate.hidden = state !== 'confirmed';
    ui.recognizeRow.hidden = state !== 'confirmed';
    for (const b of ui.seats) b.setAttribute('aria-pressed', String(b.dataset.seat === seat));
    renderStatus();
  }

  function go(next) {
    state = next;
    notice = null;
    refreshUi();
  }

  // ---------------- geometria da tela
  function resize() {
    viewW = view.clientWidth || window.innerWidth;
    viewH = view.clientHeight || window.innerHeight;
    renderer.setSize(viewW, viewH, false);
    const dpr = window.devicePixelRatio || 1;
    marks.width = Math.round(viewW * dpr);
    marks.height = Math.round(viewH * dpr);
    applyCamera();
  }

  function applyCamera() {
    if (!cal) return;
    k = coverIntrinsics(cal, VW, VH, viewW, viewH);
    camera.projectionMatrix.fromArray(projectionMatrix(k));
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.matrix.fromArray(cameraWorldMatrix(cal));
    camera.matrixWorldNeedsUpdate = true;
  }

  const cover = () => coverTransform(VW, VH, viewW, viewH);
  const toView = (p) => videoToView(p, cover());
  const toVideo = (p) => viewToVideo(p, cover());

  /** Ponto da tela → ponto da mesa (mundo), ou null. */
  function tableHit(p) {
    if (!cal || !frame) return null;
    const { origin, direction } = rayFromView(p, k, cal);
    const hit = frame.raycast(origin, direction);
    return hit ? v3(hit) : null;
  }

  function setFrame(f) {
    frame = f;
    const key = `${f.width.toFixed(3)}x${f.depth.toFixed(3)}`;
    if (key !== areaSize) {
      if (area) {
        tableRoot.remove(area);
        disposeTree(area);
      }
      area = makeArea(f.width, f.depth);
      areaSize = key;
      tableRoot.add(area);
      fitShadowCatcher(shadowCatcher, f);
    }
    frameMatrix(f, tableRoot.matrix);
    tableRoot.matrixWorldNeedsUpdate = true;
    tableRoot.visible = true;
    if (state !== 'confirmed') setAreaOpacity(area, 1);
  }

  /** Lê o quadro inteiro em cinza (para o "imã"). */
  function fullGray() {
    const c = document.createElement('canvas');
    c.width = VW;
    c.height = VH;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, VW, VH);
    return { data: grayOf(ctx, VW, VH), width: VW, height: VH };
  }

  function smallGray() {
    smallCtx.drawImage(video, 0, 0, SHIFT_SIZE[0], SHIFT_SIZE[1]);
    return grayOf(smallCtx, SHIFT_SIZE[0], SHIFT_SIZE[1]);
  }

  /** Encaixa os cantos e calibra. snap = usar o "imã". */
  function calibrate({ snap = true } = {}) {
    if (clicks.length < 4) return false;
    if (snap) {
      try {
        const { corners, snapped } = refineCorners(fullGray(), clicks, { search: Math.max(8, Math.round(VW / 140)) });
        clicks = corners;
        if (snapped < 4) say(`Não achei a borda em ${4 - snapped} canto${snapped === 3 ? '' : 's'}: arraste até o canto certo`, 3.5, 'warn');
      } catch (err) {
        console.warn('Imã dos cantos falhou', err);
      }
    } else {
      clicks = orderCorners(clicks);
    }
    const ref = REFERENCES[refKey];
    const next = calibrateFromRect(clicks, VW, VH, { width: ref.width, height: ref.height, autoOrient: refKey !== 'card' });
    if (!next?.ok) {
      say('Não deu para calcular a mesa com esses cantos: confira se estão nos 4 cantos do papel', 4, 'error');
      return false;
    }
    cal = next;
    applyCamera();
    reference = null; // nova pose: a referência da "câmera mexida" é tirada ao confirmar
    moved = false;
    noise = 0.5;
    return true;
  }

  function startAdjusting() {
    if (!calibrate()) {
      go('corners');
      return;
    }
    if (!frame) {
      seat = Seat.NearCamera;
      setFrame(new TableFrame({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }).scaled(sizeScale));
    } else {
      setFrame(frame);
    }
    go('adjusting');
  }

  // ---------------- botões
  ui.reference.addEventListener('change', () => {
    refKey = ui.reference.value;
    try { localStorage.setItem(REF_KEY, refKey); } catch { /* sem armazenamento */ }
    if (clicks.length === 4 && state === 'adjusting') calibrate({ snap: false });
    renderStatus();
  }, { signal });
  ui.size.addEventListener('input', () => {
    sizeScale = Math.min(1.6, Math.max(0.5, Number(ui.size.value)));
    if (frame && state === 'adjusting') setFrame(frame.scaled(sizeScale));
  }, { signal });
  ui.rotate.addEventListener('click', () => {
    if (state !== 'adjusting') return;
    seat = null;
    setFrame(frame.rotatedBy(90));
    refreshUi();
  }, { signal });
  ui.flip.addEventListener('click', () => {
    if (state !== 'adjusting') return;
    seat = null;
    setFrame(frame.flipped());
    refreshUi();
  }, { signal });
  for (const b of ui.seats) {
    b.addEventListener('click', () => {
      if (state !== 'adjusting') return;
      seat = b.dataset.seat;
      setFrame(TableFrame.forSeat(seat, frame.center, cal.camWorld, frame.width, frame.depth));
      refreshUi();
    }, { signal });
  }
  ui.corners.addEventListener('click', () => {
    forgetCards();
    clicks = [];
    cal = null;
    frame = null;
    tableRoot.visible = false;
    go('corners');
  }, { signal });
  ui.confirm.addEventListener('click', () => {
    if (state !== 'adjusting') return;
    go('confirmed');
    fade = { t: 0, mode: 'confirm' };
    takeReference();
    shiftStrikes = 0;
    moved = false;
  }, { signal });
  ui.recalibrate.addEventListener('click', () => {
    fade = null;
    reference = null;
    forgetCards(); // a mesa vai mudar: as cartas são lidas de novo depois de confirmar
    if (moved) {
      // A pose antiga não vale mais: marca os cantos de novo. A área (relativa à folha) é mantida.
      moved = false;
      clicks = [];
      cal = null;
      tableRoot.visible = false;
      go('corners');
      return;
    }
    setFrame(frame);
    go('adjusting');
  }, { signal });
  ui.recognize.addEventListener('change', () => {
    if (!ui.recognize.checked) forgetCards();
    renderStatus();
  }, { signal });
  ui.exit.addEventListener('click', () => stop(), { signal });
  window.addEventListener('resize', resize, { signal });

  // ---------------- toques: cantos, área, alça e invocação
  const local = (e) => {
    const r = view.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function nearestCorner(p) {
    let best = -1;
    let bestD = CORNER_GRAB;
    clicks.forEach((c, i) => {
      const v = toView(c);
      const d = Math.hypot(v.x - p.x, v.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  view.addEventListener('pointerdown', (e) => {
    if (e.target !== view && !view.contains(e.target)) return;
    const p = local(e);
    pointer = { id: e.pointerId, start: p, mode: 'tap', moved: false };
    if (state !== 'confirmed') {
      const i = nearestCorner(p);
      if (i >= 0) Object.assign(pointer, { mode: 'corner', index: i });
    }
    if (pointer.mode === 'tap' && state === 'adjusting') {
      const hit = tableHit(p);
      const handle = projectToView(v3(frame.handlePosition(HANDLE_OFFSET)), k, cal);
      if (handle && Math.hypot(handle.x - p.x, handle.y - p.y) < 34) pointer.mode = 'rotate';
      else if (hit && frame.contains(hit)) Object.assign(pointer, { mode: 'move', offset: hit.clone().sub(v3(frame.center)) });
    }
    try { view.setPointerCapture?.(e.pointerId); } catch { /* ponteiro sintético ou já solto */ }
  }, { signal });

  view.addEventListener('pointermove', (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    const p = local(e);
    if (!pointer.moved && Math.hypot(p.x - pointer.start.x, p.y - pointer.start.y) > DRAG_PX) pointer.moved = true;
    if (!pointer.moved) return;
    if (pointer.mode === 'corner') {
      clicks[pointer.index] = toVideo(p);
      if (clicks.length === 4 && state === 'adjusting') calibrate({ snap: false });
    } else if (pointer.mode === 'rotate') {
      const hit = tableHit(p);
      if (hit) {
        seat = null;
        const d = hit.clone().sub(v3(frame.center));
        setFrame(frame.withForward({ x: d.x, y: 0, z: d.z }));
      }
    } else if (pointer.mode === 'move') {
      const hit = tableHit(p);
      if (hit) {
        const c = hit.clone().sub(pointer.offset);
        setFrame(frame.recentered({ x: c.x, y: frame.center.y, z: c.z }));
      }
    }
  }, { signal });

  const endPointer = (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    const p = local(e);
    const { mode, moved: wasDrag } = pointer;
    pointer = null;
    if (mode === 'corner' && wasDrag) {
      // Soltou um canto: o "imã" encaixa de novo.
      if (clicks.length === 4) {
        if (state === 'adjusting') calibrate();
        else startAdjusting();
      }
      return;
    }
    if (wasDrag || e.type === 'pointercancel') return;
    tap(p);
  };
  view.addEventListener('pointerup', endPointer, { signal });
  view.addEventListener('pointercancel', endPointer, { signal });

  function tap(p) {
    if (state === 'corners') {
      if (clicks.length >= 4) return;
      clicks.push(toVideo(p));
      if (clicks.length === 4) startAdjusting();
      else refreshUi();
      return;
    }
    const hit = tableHit(p);
    // As criaturas vêm das cartas reconhecidas; o toque só serve para ajustar a área.
    if (state === 'adjusting' && hit) setFrame(frame.recentered(hit));
  }

  // ---------------- desenho dos cantos (2D, por cima)
  const ctx2d = marks.getContext('2d');
  function drawMarks() {
    const dpr = window.devicePixelRatio || 1;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, viewW, viewH);
    if (state === 'confirmed' || !clicks.length) return;
    const pts = (clicks.length === 4 ? orderCorners(clicks) : clicks).map(toView);
    ctx2d.lineWidth = 2;
    ctx2d.strokeStyle = GOLD;
    if (pts.length === 4) {
      ctx2d.beginPath();
      pts.forEach((q, i) => (i ? ctx2d.lineTo(q.x, q.y) : ctx2d.moveTo(q.x, q.y)));
      ctx2d.closePath();
      ctx2d.stroke();
    }
    for (const q of pts) {
      ctx2d.beginPath();
      ctx2d.arc(q.x, q.y, 11, 0, Math.PI * 2);
      ctx2d.fillStyle = '#120e16aa';
      ctx2d.fill();
      ctx2d.stroke();
      ctx2d.beginPath();
      ctx2d.arc(q.x, q.y, 2, 0, Math.PI * 2);
      ctx2d.fillStyle = GOLD;
      ctx2d.fill();
    }
  }

  // ---------------- reconhecimento das cartas na mesa
  // Lê o vídeo de tempos em tempos (OCR); cada carta vira um lugar na mesa e ganha a criatura dela.
  const cards = new TableCards();
  const recognized = new RecognizedCreatures(tableRoot, resolver, (t) => say(t, 3));
  let scanner = null;
  let scans = 0;

  const watch = new CardWatch(cards, recognized);
  let watchTimer = 0;

  function forgetCards() {
    memory?.clear();
    cards.clear();
    recognized.clear();
    watch.clear();
    ui.scanInfo.textContent = '';
  }

  /** Ponto da mesa → pixel do VÍDEO (ou null se atrás da câmera). */
  function tableToVideo(pos) {
    if (!cal || !frame) return null;
    return projectToView(frame.tableToWorld(pos), { fx: cal.f, fy: cal.f, cx: cal.cx, cy: cal.cy }, cal);
  }

  /** O lugar da mesa aparece no vídeo (com folga da borda)? */
  function tableVisible(pos) {
    const q = tableToVideo(pos);
    return !!q && q.x > VW * 0.03 && q.x < VW * 0.97 && q.y > VH * 0.03 && q.y < VH * 0.97;
  }

  let order = [];
  let jobIndex = 0;
  const memory = new BlockMemory(); // blocos parados não passam de novo pelo OCR
  let grayCache = null;
  let skipped = 0;
  let planFor = '';
  let lastScan = null; // resumo da última leitura terminada (depuração)
  let smallHint = '';

  /**
   * Menor altura de carta (px do vídeo) na área de jogo. Abaixo de ~140 px o nome não é lido
   * (medido: 108 px não lê, 216 px lê); aí o app avisa para subir/aproximar a câmera.
   */
  function smallestCardPx() {
    let min = Infinity;
    const W = frame.width / 2;
    const D = frame.depth / 2;
    for (const [x, y] of [[-W, D], [0, D], [W, D], [-W, 0], [W, 0], [0, -D]]) {
      const a = tableToVideo({ x, y: y + 0.044 });
      const b = tableToVideo({ x, y: y - 0.044 });
      if (a && b) min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
    }
    return min;
  }

  async function scanLoop() {
    while (!stopped) {
      if (state !== 'confirmed' || !ui.recognize.checked || moved || !cal || !frame) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      try {
        if (!scanner) {
          ui.scanInfo.textContent = 'preparando a leitura…';
          scanner = await new TableCardScanner(catalog).ready();
        }
        const calAtScan = cal;
        // A mesa é lida por blocos (seu lado, lado do oponente, cartas viradas), um por vez.
        const key = `${cal.f}|${frame.center.x}|${frame.center.z}|${frame.forward.x}|${frame.width}`;
        if (planFor !== key) {
          order = scanOrder(planScans(frame, tableVisible));
          jobIndex = 0;
          planFor = key;
          smallHint = smallestCardPx() < 140
            ? ` · longe da câmera as cartas ficam pequenas demais para ler: ${VW >= 3000 ? 'aproxime a câmera ou aponte-a mais de cima' : 'aproxime a câmera ou use uma câmera 4K'}`
            : '';
        }
        if (!order.length) {
          ui.scanInfo.textContent = 'a área de jogo não aparece na câmera';
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        const job = order[jobIndex++ % order.length];
        // Cinza do quadro reaproveitado por meio segundo enquanto os blocos parados são pulados.
        if (!grayCache || clock - grayCache.at > 0.5) grayCache = { src: scanner.gray(video, VW, VH), at: clock };
        const src = grayCache.src;
        const sig = blockSignature(src, job, tableToVideo);
        if (!memory.needsRead(job, sig, clock, signatureChange)) {
          skipped++;
          await new Promise((r) => setTimeout(r, 60));
          continue; // nada mudou nesse bloco desde a última leitura
        }
        const known = [...cards.entries.values()].map((e) => ({ center: e.pos, yaw: e.yaw }));
        const detections = await scanner.scan(src, job, tableToVideo, known);
        memory.remember(job, sig, clock, (scanner.last?.unresolved ?? 0) > 0);
        grayCache = null; // o OCR demorou: a próxima leitura usa um quadro novo
        scans++;
        lastScan = scanner.last;
        // Recalibrou durante a leitura: a posição calculada já não vale.
        if (stopped || state !== 'confirmed' || cal !== calAtScan || !ui.recognize.checked) continue;
        // Só conta como sumida a carta que ESTE bloco teria lido.
        const couldRead = (pos, e) => coverage(job, pos, e, tableVisible);
        recognized.apply(cards.update(detections, clock, couldRead));
        const n = cards.entries.size;
        ui.scanInfo.textContent = (n ? `${n} carta${n > 1 ? 's' : ''} na mesa` : 'nenhuma carta lida ainda') + smallHint;
      } catch (err) {
        console.warn('Leitura das cartas falhou', err);
        ui.scanInfo.textContent = 'a leitura falhou; tentando de novo';
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }

  // ---------------- quadro a quadro
  const timer = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(timer.getDelta(), 0.1);
    clock += dt;
    if (fade && area && animateAreaFade(area, fade, dt)) fade = null;
    if (notice && clock >= notice.until) {
      notice = null;
      renderStatus();
    }
    if (state === 'confirmed') {
      shiftTimer += dt;
      if (shiftTimer >= SHIFT_EVERY) {
        shiftTimer = 0;
        checkCamera();
      }
    }
    // Vigia das cartas já reconhecidas: virar para atacar na hora, sem esperar o OCR.
    if (state === 'confirmed' && ui.recognize.checked && !moved && cards.entries.size) {
      watchTimer += dt;
      if (watchTimer >= WATCH_EVERY) {
        watchTimer = 0;
        watch.tick(video, VW, VH, tableToVideo, clock);
      }
    }
    recognized.update(dt);
    drawMarks();
    if (cal) renderer.render(scene, camera);
    else renderer.clear();
  });

  resize();
  refreshUi();
  // Só no `npm run dev`: deixa os testes no navegador lerem o estado (o build de produção remove).
  if (import.meta.env?.DEV) {
    view.__mesaDebug = () => ({ state, clicks, cal, frame, moved, k, noise, creatureRot: [...recognized.byId.values()].map((c) => +(c.rotation.y * 180 / Math.PI).toFixed(0)), watchBest: [...watch.trackers.values()].map((t) => t.tracker.lastBest), edges: reference?.idx.length ?? 0, cards: [...cards.entries.values()], scans, lastLines: scanner?.lastLines, lastScan, skipped, videoSize: [VW, VH], smallestCardPx: frame && cal ? smallestCardPx() : null });
    view.__mesaShift = () => reference && imageShift(reference.img, smallGray(), SHIFT_SIZE[0], SHIFT_SIZE[1], 3, reference.idx);
  }

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    listeners.abort();
    ui.recognizeRow.hidden = true;
    renderer.setAnimationLoop(null);
    for (const t of stream.getTracks()) t.stop();
    if (area) disposeTree(area); // as criaturas não: a geometria dos modelos é compartilhada pelo cache
    renderer.dispose();
    renderer.domElement.remove();
    video.remove();
    marks.remove();
    ui.referenceRow.hidden = true;
    ui.corners.hidden = true;
    onEnd?.();
  }
  scanLoop();
  return stop;
}
