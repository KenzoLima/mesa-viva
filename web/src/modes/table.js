// Modo Mesa: detecção de plano com WebXR (Chrome no Android, com ARCore).
// Porta da cena "Mesa" do Unity (TableCalibrationController + CalibrationScreenView + TableAreaVisualizer),
// seguindo o PLANO §3.5 e o checklist do MESA_GUIA:
//   procurar a mesa (grade dourada + barra) → tocar no centro → ajustar (arrastar, alça, girar 90°,
//   trocar lados, de que lado você está, tamanho) → confirmar (âncora; a área pisca e some).
// Depois de confirmada, cada toque na mesa invoca a criatura da carta escolhida, presa à âncora da mesa.

import * as THREE from 'three';
import { XREstimatedLight } from 'three/addons/webxr/XREstimatedLight.js';
import { makeCreature, addLights } from '../creatures.js';
import {
  TableFrame, CalibrationStateMachine, State, Seat, StableFlag, ScanProgress, polygonAreaXZ, creatureHeight,
} from '../table/tableFrame.js';

const GOLD = 0xd4af37;
const GOLD_TEXT = '#e6c27a';
const LIFT = 0.002; // desenho da área um pouco acima do plano, para não brigar com a profundidade
const HANDLE_OFFSET = 0.07;
const MIN_TABLE_AREA = 0.15; // m², igual ao Unity
const DRAG_THRESHOLD = 0.015; // abaixo disso o toque é toque, não arrasto

export async function isTableModeSupported() {
  try {
    return !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar')));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- geometria auxiliar

const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);

/** Mesa → matriz de mundo: X = direita, Y = cima, -Z = frente (do jogador para o oponente). */
function frameMatrix(frame, m = new THREE.Matrix4()) {
  const r = frame.right;
  const f = frame.forward;
  m.makeBasis(new THREE.Vector3(r.x, 0, r.z), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-f.x, 0, -f.z));
  m.setPosition(frame.center.x, frame.center.y, frame.center.z);
  return m;
}

/** Matriz da âncora → TableFrame (a âncora guarda a pose da mesa confirmada). */
function frameFromMatrix(m, width, depth) {
  const pos = new THREE.Vector3().setFromMatrixPosition(m);
  const back = new THREE.Vector3().setFromMatrixColumn(m, 2);
  return new TableFrame({ x: pos.x, y: pos.y, z: pos.z }, { x: -back.x, y: 0, z: -back.z }, width, depth);
}

/** Coordenada da mesa (x direita, y frente) → local do grupo da mesa. */
const local = (t, h = 0) => new THREE.Vector3(t.x, h, -t.y);

function rayFromPose(pose) {
  const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
  const origin = new THREE.Vector3().setFromMatrixPosition(m);
  const dir = new THREE.Vector3(0, 0, -1).transformDirection(m);
  return { origin, dir };
}

// ---------------------------------------------------------------- visuais

function makeReticle() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.95, depthWrite: false });
  g.add(new THREE.Mesh(new THREE.RingGeometry(0.04, 0.05, 40).rotateX(-Math.PI / 2), mat));
  g.add(new THREE.Mesh(new THREE.CircleGeometry(0.006, 16).rotateX(-Math.PI / 2), mat));
  g.matrixAutoUpdate = false;
  g.visible = false;
  return g;
}

function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(212,175,55,0.10)';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(230,194,122,0.85)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 62, 62);
  ctx.fillStyle = 'rgba(230,194,122,0.9)';
  ctx.beginPath();
  ctx.arc(32, 32, 2.5, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Grade dourada dos planos detectados (PlaneScanVisualizer + RunicGrid), quando o aparelho dá 'plane-detection'. */
class PlaneGrid {
  constructor(scene) {
    this.scene = scene;
    this.meshes = new Map(); // XRPlane → { mesh, changed }
    this.material = new THREE.MeshBasicMaterial({
      map: gridTexture(), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
    });
    this.visible = true;
  }

  /** Atualiza a partir do quadro; retorna a área do maior plano horizontal (ou null sem a API). */
  update(xrFrame, refSpace) {
    const planes = xrFrame.detectedPlanes;
    if (!planes) return null;
    let largest = 0;
    for (const [plane, entry] of this.meshes) {
      if (!planes.has(plane)) {
        this.scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        this.meshes.delete(plane);
      }
    }
    for (const plane of planes) {
      if (plane.orientation && plane.orientation !== 'horizontal') continue;
      const pose = xrFrame.getPose(plane.planeSpace, refSpace);
      if (!pose) continue;
      const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
      // Só planos com a normal para cima (mesa, chão), não o teto.
      if (new THREE.Vector3(0, 1, 0).transformDirection(m).y < 0.9) continue;
      let entry = this.meshes.get(plane);
      if (!entry || entry.changed !== plane.lastChangedTime) {
        const geo = this.#geometry(plane.polygon);
        if (entry) {
          entry.mesh.geometry.dispose();
          entry.mesh.geometry = geo;
        } else {
          const mesh = new THREE.Mesh(geo, this.material);
          mesh.matrixAutoUpdate = false;
          mesh.renderOrder = -1;
          this.scene.add(mesh);
          entry = { mesh };
          this.meshes.set(plane, entry);
        }
        entry.changed = plane.lastChangedTime;
        entry.area = polygonAreaXZ(plane.polygon);
      }
      entry.mesh.matrix.copy(m);
      entry.mesh.visible = this.visible;
      largest = Math.max(largest, entry.area);
    }
    return largest;
  }

  #geometry(polygon) {
    const contour = polygon.map((p) => new THREE.Vector2(p.x, p.z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const pos = [];
    const uv = [];
    for (const p of polygon) {
      pos.push(p.x, 0, p.z);
      uv.push(p.x / 0.1, p.z / 0.1); // uma célula da grade a cada 10 cm
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(tris.flat());
    return geo;
  }

  setVisible(v) {
    this.visible = v;
    for (const { mesh } of this.meshes.values()) mesh.visible = v;
  }

  dispose() {
    for (const { mesh } of this.meshes.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.clear();
    this.material.map.dispose();
    this.material.dispose();
  }
}

function labelMesh(text, width) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.font = '600 84px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = GOLD_TEXT;
  ctx.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  mat.userData.base = 1;
  // PlaneGeometry fica em XY; deitada, o "para cima" do texto aponta para a frente (-Z local).
  return new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4).rotateX(-Math.PI / 2), mat);
}

/** Área de jogo (TableAreaVisualizer): borda, grade de 10 cm, linha do meio, seta, VOCÊ/OPONENTE e alça. */
function makeArea(width, depth) {
  const g = new THREE.Group();
  const w = width / 2;
  const d = depth / 2;
  const lineMat = (opacity) => {
    const m = new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity, depthWrite: false });
    m.userData.base = opacity;
    return m;
  };
  const segs = (pairs, mat) => {
    const pts = pairs.flatMap(([a, b]) => [a.x, a.y, a.z, b.x, b.y, b.z]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(geo, mat);
  };
  const corners = [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, y]) => local({ x, y }, LIFT));
  g.add(segs(corners.map((c, i) => [c, corners[(i + 1) % 4]]), lineMat(1)));
  const inner = [];
  for (let x = -w + 0.1; x < w - 0.01; x += 0.1) inner.push([local({ x, y: -d }, LIFT), local({ x, y: d }, LIFT)]);
  for (let y = -d + 0.1; y < d - 0.01; y += 0.1) inner.push([local({ x: -w, y }, LIFT), local({ x: w, y }, LIFT)]);
  g.add(segs(inner, lineMat(0.22)));
  g.add(segs([[local({ x: -w, y: 0 }, LIFT * 2), local({ x: w, y: 0 }, LIFT * 2)]], lineMat(1)));

  // Véu translúcido para a área "existir" mesmo onde a grade é fina.
  const veilMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });
  veilMat.userData.base = 0.07;
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2), veilMat);
  veil.position.y = LIFT * 0.5;
  g.add(veil);

  // Seta do seu lado apontando para o oponente.
  const arrowMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  arrowMat.userData.base = 0.85;
  const s = Math.min(width, depth) * 0.08;
  const shape = new THREE.Shape();
  shape.moveTo(0, s);
  shape.lineTo(s * 0.8, -s * 0.4);
  shape.lineTo(s * 0.25, -s * 0.4);
  shape.lineTo(s * 0.25, -s * 1.1);
  shape.lineTo(-s * 0.25, -s * 1.1);
  shape.lineTo(-s * 0.25, -s * 0.4);
  shape.lineTo(-s * 0.8, -s * 0.4);
  shape.closePath();
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), arrowMat);
  arrow.position.copy(local({ x: 0, y: -d * 0.22 }, LIFT * 2));
  g.add(arrow);

  const labelW = Math.min(0.24, width * 0.42);
  const me = labelMesh('VOCÊ', labelW);
  me.position.copy(local({ x: 0, y: -d * 0.62 }, LIFT * 2));
  const opp = labelMesh('OPONENTE', labelW);
  opp.position.copy(local({ x: 0, y: d * 0.55 }, LIFT * 2));
  g.add(me, opp);

  // Alça de rotação além da borda do oponente.
  const handleMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 1, depthWrite: false });
  handleMat.userData.base = 1;
  const handle = new THREE.Group();
  handle.add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.004, 24), handleMat));
  handle.add(new THREE.Mesh(new THREE.RingGeometry(0.03, 0.036, 32).rotateX(-Math.PI / 2), handleMat));
  handle.position.copy(local({ x: 0, y: d + HANDLE_OFFSET }, LIFT * 2));
  handle.name = 'handle';
  g.add(handle, segs([[local({ x: 0, y: d }, LIFT), local({ x: 0, y: d + HANDLE_OFFSET - 0.036 }, LIFT)]], lineMat(0.8)));
  return g;
}

function setAreaOpacity(area, k) {
  area.traverse((o) => {
    const m = o.material;
    if (m?.userData.base !== undefined) m.opacity = m.userData.base * k;
  });
  area.visible = k > 0.001;
}

function disposeTree(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    o.material?.map?.dispose();
    o.material?.dispose();
  });
}

// ---------------------------------------------------------------- modo

const MESSAGES = {
  starting: 'Iniciando a câmera…',
  lost: 'Rastreamento perdido: aponte para a mesa',
  [State.Scanning]: 'Mova o celular devagar sobre a mesa…',
  [State.NoTableHint]: 'Não encontrei a mesa. Acenda uma luz, use um playmat ou uma toalha com textura e evite superfícies lisas ou brilhantes.',
  [State.AwaitingCenterTap]: 'Toque no centro da mesa',
  [State.Adjusting]: 'Arraste para mover, use a alça para girar e confirme',
  [State.Confirmed]: 'Toque na mesa para invocar a criatura escolhida',
};

/**
 * ui: { overlay, status, progress, sizeRow, size, adjust, rotate, flip, seats, confirm,
 *       retry, recalibrate, cardSelect, exit }
 * pickCard(): a carta que o próximo toque invoca.
 */
export async function startTableMode({ ui, resolver, pickCard, onEnd }) {
  // A sessão é pedida antes de qualquer outra coisa: o navegador só aceita logo depois do toque.
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay', 'anchors', 'plane-detection', 'light-estimation', 'local-floor'],
    domOverlay: { root: ui.overlay },
  });

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  // Luz: a padrão até a estimativa do ARCore chegar (PLANO §5.4).
  const defaultLights = new THREE.Group();
  addLights(defaultLights);
  scene.add(defaultLights);
  // Só quando o aparelho concedeu 'light-estimation' (sem isso o pedido da sonda de luz falha).
  if (session.enabledFeatures?.includes('light-estimation')) {
    const xrLight = new XREstimatedLight(renderer);
    xrLight.addEventListener('estimationstart', () => {
      scene.add(xrLight);
      defaultLights.visible = false;
      if (xrLight.environment) scene.environment = xrLight.environment;
    });
    xrLight.addEventListener('estimationend', () => {
      scene.remove(xrLight);
      defaultLights.visible = true;
      scene.environment = null;
    });
  }

  const reticle = makeReticle();
  scene.add(reticle);
  const planeGrid = new PlaneGrid(scene);

  // Tudo que pertence à mesa fica neste grupo, que segue a âncora depois de confirmar.
  const tableRoot = new THREE.Group();
  tableRoot.matrixAutoUpdate = false;
  tableRoot.visible = false;
  scene.add(tableRoot);
  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.32 }),
  );
  shadowCatcher.receiveShadow = true;
  tableRoot.add(shadowCatcher);
  // Luz só para as sombras (o "shadow catcher" é o maior ganho de realismo por esforço).
  const shadowLight = new THREE.DirectionalLight(0xffffff, 0.5);
  shadowLight.castShadow = true;
  shadowLight.shadow.mapSize.set(1024, 1024);
  Object.assign(shadowLight.shadow.camera, { left: -0.7, right: 0.7, top: 0.7, bottom: -0.7, near: 0.05, far: 3 });
  shadowLight.shadow.bias = -0.0005;
  shadowLight.position.set(0.25, 1, 0.35);
  tableRoot.add(shadowLight, shadowLight.target);

  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  const refSpace = await session.requestReferenceSpace('local');
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const hitSource = await session.requestHitTestSource({ space: viewerSpace });
  // Hit-test no ponto tocado (não só no centro da tela). Se o aparelho não tiver, usa o anel do centro.
  const touchHitSource = await session
    .requestHitTestSourceForTransientInput?.({ profile: 'generic-touchscreen' })
    .catch(() => null);

  // Toques nos botões do overlay não viram "select" no mundo (o evento sobe até o overlay).
  const listeners = new AbortController();
  const { signal } = listeners;
  ui.overlay.addEventListener('beforexrselect', (e) => {
    if (e.target.closest?.('button, select, input, label, .xr-panel')) e.preventDefault();
  }, { signal });

  // ---------------- estado
  let frame = null;
  let area = null;
  let areaSize = '';
  let sizeScale = Number(ui.size.value) || 1;
  let seat = Seat.NearCamera;
  let anchor = null;
  let anchorPending = false;
  let fade = null; // { t, mode: 'confirm' | 'flash' }
  const creatures = [];
  const hitPos = new THREE.Vector3();
  const hitMatrix = new THREE.Matrix4();
  const camPos = new THREE.Vector3();
  let hasHit = false;
  let started = false;
  let notice = null; // { text, until }
  const touchHits = new Map(); // XRInputSource → THREE.Vector3 (último hit horizontal desse toque)
  let drag = null; // { source, mode: 'rotate' | 'move' | 'none', start, moved }
  const lost = new StableFlag(0.6);
  const scan = new ScanProgress(MIN_TABLE_AREA);
  let clockTime = 0;

  const sm = new CalibrationStateMachine(15, (_, next) => {
    notice = null; // um aviso da etapa anterior não vale na nova
    refreshUi(next);
  });

  function refreshUi(state = sm.state) {
    const adjusting = state === State.Adjusting;
    ui.adjust.hidden = !adjusting;
    ui.sizeRow.hidden = !adjusting;
    ui.confirm.hidden = !adjusting;
    ui.retry.hidden = state !== State.NoTableHint;
    ui.recalibrate.hidden = state !== State.Confirmed;
    ui.cardSelect.hidden = state !== State.Confirmed;
    ui.progress.hidden = !(state === State.Scanning || state === State.NoTableHint);
    for (const b of ui.seats) b.setAttribute('aria-pressed', String(b.dataset.seat === seat));
    planeGrid.setVisible(state === State.Scanning || state === State.NoTableHint || state === State.AwaitingCenterTap);
    renderStatus();
  }

  function renderStatus() {
    let text;
    let level = 'ok';
    if (!started) text = MESSAGES.starting;
    else if (lost.value) { text = MESSAGES.lost; level = 'error'; }
    else if (notice && clockTime < notice.until) { text = notice.text; level = notice.level; }
    else { text = MESSAGES[sm.state]; if (sm.state === State.NoTableHint) level = 'warn'; }
    if (ui.status.textContent !== text) ui.status.textContent = text;
    ui.status.dataset.level = level;
  }

  function say(text, seconds = 2.5, level = 'ok') {
    notice = { text, until: clockTime + seconds, level };
    renderStatus();
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
      shadowCatcher.scale.set((f.width + 0.5) / 2, 1, (f.depth + 0.5) / 2);
    }
    frameMatrix(f, tableRoot.matrix);
    tableRoot.matrixWorldNeedsUpdate = true;
    tableRoot.visible = true;
    if (sm.state !== State.Confirmed) setAreaOpacity(area, 1);
  }

  /** Raio do toque até o plano da mesa já calibrada. */
  function touchOnTable(source, xrFrame) {
    if (!frame || !xrFrame) return null;
    const pose = xrFrame.getPose(source.targetRaySpace, refSpace);
    if (!pose) return null;
    const { origin, dir } = rayFromPose(pose);
    const p = frame.raycast(origin, dir);
    return p ? v3(p) : null;
  }

  function vibrate(ms) {
    try { navigator.vibrate?.(ms); } catch { /* sem vibração */ }
  }

  // ---------------- botões
  ui.size.addEventListener('input', () => {
    sizeScale = Math.min(1.6, Math.max(0.5, Number(ui.size.value)));
    if (frame && sm.state === State.Adjusting) setFrame(frame.scaled(sizeScale));
  }, { signal });
  ui.rotate.addEventListener('click', () => {
    if (sm.state !== State.Adjusting) return;
    seat = null;
    setFrame(frame.rotatedBy(90));
    refreshUi();
  }, { signal });
  ui.flip.addEventListener('click', () => {
    if (sm.state !== State.Adjusting) return;
    seat = null;
    setFrame(frame.flipped());
    refreshUi();
  }, { signal });
  for (const b of ui.seats) {
    b.addEventListener('click', () => {
      if (sm.state !== State.Adjusting) return;
      seat = b.dataset.seat;
      setFrame(TableFrame.forSeat(seat, frame.center, camPos, frame.width, frame.depth));
      refreshUi();
    }, { signal });
  }
  ui.confirm.addEventListener('click', () => {
    if (!sm.confirm()) {
      if (lost.value) say(MESSAGES.lost, 2, 'error');
      return;
    }
    anchorPending = true;
    fade = { t: 0, mode: 'confirm' };
    for (const c of creatures) tableRoot.attach(c); // criaturas de antes voltam a seguir a mesa
    vibrate(20);
  }, { signal });
  ui.recalibrate.addEventListener('click', () => {
    anchor?.delete?.();
    anchor = null;
    anchorPending = false;
    fade = null;
    // As criaturas ficam onde estão no mundo enquanto a mesa é refeita.
    tableRoot.updateMatrixWorld(true);
    for (const c of creatures) scene.attach(c);
    tableRoot.visible = false;
    frame = null;
    sm.recalibrate(scan.found);
  }, { signal });
  ui.retry.addEventListener('click', () => {
    scan.reset();
    sm.retryScan();
  }, { signal });
  ui.exit.addEventListener('click', () => session.end(), { signal });

  // ---------------- toques no mundo: toque, arrasto da área e alça
  session.addEventListener('selectstart', (e) => {
    drag = { source: e.inputSource, mode: 'none', start: null, moved: false };
    if (sm.state !== State.Adjusting || sm.trackingLost) return;
    const p = touchOnTable(e.inputSource, e.frame);
    if (!p) return;
    const handle = v3(frame.handlePosition(HANDLE_OFFSET));
    const grab = Math.max(0.05, 0.07 * camPos.distanceTo(handle));
    if (p.distanceTo(handle) <= grab) drag.mode = 'rotate';
    else if (frame.contains(p)) drag.mode = 'move';
    drag.start = p;
    drag.offset = p.clone().sub(v3(frame.center));
  });
  // O "select" chega antes do "selectend", então o select ainda vê o arrasto.
  session.addEventListener('selectend', () => { drag = null; });

  session.addEventListener('select', (e) => {
    if (drag?.moved) return; // foi arrasto, não toque
    if (sm.state === State.Confirmed) return summon(e);

    const touched = touchHits.get(e.inputSource);
    const onPlane = !!touched || hasHit;
    const point = touched ?? hitPos;
    const result = sm.tap(onPlane);
    if (result === 'centerSet') {
      seat = Seat.NearCamera;
      setFrame(TableFrame.forSeat(seat, point, camPos).scaled(sizeScale));
      refreshUi();
    } else if (result === 'recentered') {
      const p = touchOnTable(e.inputSource, e.frame) ?? point;
      setFrame(frame.recentered(p));
    } else if (result === 'invalid') {
      vibrate([40, 40, 40]);
      say('Toque sobre a mesa detectada (onde aparece o anel dourado)', 2.5, 'warn');
    }
  });

  function summon(e) {
    const p = touchOnTable(e.inputSource, e.frame) ?? touchHits.get(e.inputSource) ?? (hasHit ? hitPos.clone() : null);
    if (!p || !frame.isOnTable(p, 0.05)) return;
    const side = frame.sideOf(p);
    if (side === 'outside') {
      vibrate([40, 40, 40]);
      fade = { t: 0, mode: 'flash' };
      say('Fora da mesa: toque dentro da área', 2.5, 'warn');
      return;
    }
    const card = pickCard();
    if (!card) {
      say('Escolha uma carta para invocar', 2.5, 'warn');
      return;
    }
    const choice = resolver.resolve(card);
    const creature = makeCreature(choice, { height: creatureHeight(card.power) });
    const t = frame.worldToTable(p);
    creature.position.copy(local(t));
    // Do seu lado a criatura olha para o oponente (-Z local); do lado dele, para você.
    creature.rotation.y = side === 'near' ? Math.PI : 0;
    creature.userData.spawn();
    tableRoot.add(creature);
    creatures.push(creature);
    vibrate(15);
    say(`${card.displayName} → ${resolver.label(choice.modelId)} (${side === 'near' ? 'seu lado' : 'lado do oponente'})`, 3);
  }

  // ---------------- quadro a quadro
  const clock = new THREE.Clock();
  const tmp = new THREE.Matrix4();
  const up = new THREE.Vector3();
  renderer.setAnimationLoop((_, xrFrame) => {
    const dt = Math.min(clock.getDelta(), 0.1);
    clockTime += dt;
    hasHit = false;
    if (xrFrame) {
      const viewerPose = xrFrame.getViewerPose(refSpace);
      if (viewerPose) {
        camPos.setFromMatrixPosition(tmp.fromArray(viewerPose.transform.matrix));
        if (!viewerPose.emulatedPosition) started = true;
      }
      const isLost = !viewerPose || viewerPose.emulatedPosition;
      const wasLost = lost.value === true;
      if (started && lost.update(isLost, dt)) {
        if (wasLost && !lost.value) say('Rastreando bem', 1.2);
        renderStatus();
      }

      // Anel do centro da tela: só superfícies horizontais (normal para cima), não paredes.
      const pose = xrFrame.getHitTestResults(hitSource)[0]?.getPose(refSpace);
      if (pose) {
        hitMatrix.fromArray(pose.transform.matrix);
        up.set(0, 1, 0).transformDirection(hitMatrix);
        if (up.y > 0.9) {
          hasHit = true;
          hitPos.setFromMatrixPosition(hitMatrix);
          reticle.matrix.copy(hitMatrix);
        }
      }
      // Hit-test de cada dedo na tela.
      if (touchHitSource) {
        touchHits.clear();
        for (const r of xrFrame.getHitTestResultsForTransientInput(touchHitSource)) {
          const hp = r.results[0]?.getPose(refSpace);
          if (!hp) continue;
          const m = new THREE.Matrix4().fromArray(hp.transform.matrix);
          if (new THREE.Vector3(0, 1, 0).transformDirection(m).y > 0.9) touchHits.set(r.inputSource, new THREE.Vector3().setFromMatrixPosition(m));
        }
      }

      const planeArea = planeGrid.update(xrFrame, refSpace);
      scan.update(dt, { hasHit, planeArea });
      if (!ui.progress.hidden) ui.progress.style.setProperty('--p', scan.value.toFixed(3));
      sm.tick(dt, scan.found, started && !lost.value);

      // Arrasto: alça gira, dentro da área move.
      if (drag && drag.mode !== 'none' && sm.state === State.Adjusting && !sm.trackingLost) {
        const p = touchOnTable(drag.source, xrFrame);
        if (p) {
          if (!drag.moved && p.distanceTo(drag.start) > DRAG_THRESHOLD) drag.moved = true;
          if (drag.moved) {
            if (drag.mode === 'rotate') {
              const dir = p.clone().sub(v3(frame.center));
              seat = null;
              setFrame(frame.withForward({ x: dir.x, y: 0, z: dir.z }));
            } else {
              const c = p.clone().sub(drag.offset);
              setFrame(frame.recentered({ x: c.x, y: frame.center.y, z: c.z }));
            }
          }
        }
      }

      // Confirmou: cria a âncora na pose da mesa. Daí em diante, a âncora é a verdade (corrige o drift).
      if (anchorPending && frame) {
        anchorPending = false;
        if (xrFrame.createAnchor) {
          const q = new THREE.Quaternion().setFromRotationMatrix(frameMatrix(frame, tmp));
          const c = frame.center;
          xrFrame.createAnchor(new XRRigidTransform({ x: c.x, y: c.y, z: c.z }, { x: q.x, y: q.y, z: q.z, w: q.w }), refSpace)
            .then((a) => {
              if (sm.state === State.Confirmed && !anchor) anchor = a;
              else a.delete();
            })
            .catch((err) => console.warn('Âncora da mesa não criada; a mesa fica solta no mundo', err));
        }
      }
      if (anchor && xrFrame.trackedAnchors?.has(anchor)) {
        const ap = xrFrame.getPose(anchor.anchorSpace, refSpace);
        if (ap) {
          tableRoot.matrix.fromArray(ap.transform.matrix);
          tableRoot.matrixWorldNeedsUpdate = true;
          frame = frameFromMatrix(tableRoot.matrix, frame.width, frame.depth);
        }
      }
    }

    // Confirmar: a área pisca e some. Toque fora: aparece de relance.
    if (fade && area) {
      fade.t += dt;
      if (fade.mode === 'confirm') {
        const blink = fade.t < 0.6 ? 0.55 + 0.45 * Math.cos(fade.t * Math.PI * 2 / 0.2) : 1;
        const out = fade.t < 0.6 ? 1 : Math.max(0, 1 - (fade.t - 0.6) / 0.6);
        setAreaOpacity(area, blink * out);
        if (fade.t >= 1.2) fade = null;
      } else {
        setAreaOpacity(area, fade.t < 0.2 ? fade.t / 0.2 : Math.max(0, 1 - (fade.t - 1) / 0.5));
        if (fade.t >= 1.5) fade = null;
      }
    }

    reticle.visible = hasHit && started && !lost.value && sm.state !== State.Confirmed && sm.state !== State.Adjusting;
    if (notice && clockTime >= notice.until) {
      notice = null;
      renderStatus();
    }
    // Rastreamento perdido: as criaturas congelam (PLANO §5.3).
    if (!lost.value) {
      for (const c of creatures) {
        c.userData.update(dt);
        if (!c.userData.shadowed && !c.userData.loading) {
          c.traverse((o) => { if (o.isMesh) o.castShadow = true; });
          c.userData.shadowed = true;
        }
      }
    }
    renderer.render(scene, camera);
  });

  refreshUi(State.Scanning);

  session.addEventListener('end', () => {
    listeners.abort();
    anchor?.delete?.();
    hitSource.cancel();
    touchHitSource?.cancel();
    renderer.setAnimationLoop(null);
    planeGrid.dispose();
    if (area) disposeTree(area); // as criaturas não: a geometria dos modelos é compartilhada pelo cache
    renderer.dispose();
    renderer.domElement.remove();
    onEnd?.();
  });
}
