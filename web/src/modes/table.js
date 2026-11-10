// Modo Mesa: detecção de plano com WebXR (Chrome no Android, com ARCore).
// Porta do fluxo da cena "Mesa" do Unity: escanear → tocar no centro → ajustar tamanho → confirmar.
// Depois de confirmada, cada toque na mesa invoca a criatura da carta escolhida.

import * as THREE from 'three';
import { makeCreature, addLights } from '../creatures.js';
import { TableFrame, CalibrationStateMachine, State } from '../table/tableFrame.js';

const GOLD = 0xd4af37;

export async function isTableModeSupported() {
  try {
    return !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar')));
  } catch {
    return false;
  }
}

function makeReticle() {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.04, 0.05, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: GOLD }),
  );
  ring.matrixAutoUpdate = false;
  ring.visible = false;
  return ring;
}

/** Grade dourada da mesa (como o TableAreaVisualizer): borda + linhas a cada 10 cm + linha do meio. */
function makeTableGrid(frame) {
  const pts = [];
  const push = (a, b) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const lift = 0.002;
  const c = frame.corners(lift);
  for (let i = 0; i < 4; i++) push(c[i], c[(i + 1) % 4]);
  const w = frame.width / 2;
  const d = frame.depth / 2;
  for (let x = -w + 0.1; x < w - 0.01; x += 0.1) push(frame.tableToWorld({ x, y: -d }, lift), frame.tableToWorld({ x, y: d }, lift));
  for (let y = -d + 0.1; y < d - 0.01; y += 0.1) push(frame.tableToWorld({ x: -w, y }, lift), frame.tableToWorld({ x: w, y }, lift));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const grid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.35 }));
  const mid = new THREE.BufferGeometry().setFromPoints([
    frame.tableToWorld({ x: -w, y: 0 }, lift * 2), frame.tableToWorld({ x: w, y: 0 }, lift * 2),
  ].map((p) => new THREE.Vector3(p.x, p.y, p.z)));
  grid.add(new THREE.Line(mid, new THREE.LineBasicMaterial({ color: GOLD })));
  return grid;
}

/**
 * ui: { overlay, status, sizeRow, size, confirm, recalibrate, cardSelect, exit }
 * pickCard(): a carta que o próximo toque invoca.
 */
export async function startTableMode({ ui, resolver, pickCard, onEnd }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
  addLights(scene);
  const reticle = makeReticle();
  scene.add(reticle);

  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay', 'plane-detection', 'light-estimation'],
    domOverlay: { root: ui.overlay },
  });
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  const refSpace = await session.requestReferenceSpace('local');
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const hitSource = await session.requestHitTestSource({ space: viewerSpace });

  // Toques nos botões do overlay não devem virar "select" no mundo.
  for (const el of ui.overlay.querySelectorAll('button, select, input, label')) {
    el.addEventListener('beforexrselect', (e) => e.preventDefault());
  }

  let frame = null;
  let grid = null;
  let sizeScale = 1;
  const creatures = [];
  const hitPos = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  let hasHit = false;

  const messages = {
    [State.Scanning]: 'Mova o celular devagar sobre a mesa…',
    [State.NoTableHint]: 'Não achei a mesa. Mais luz ajuda; evite superfícies lisas e brilhantes.',
    [State.AwaitingCenterTap]: 'Toque no centro da mesa',
    [State.Adjusting]: 'Ajuste o tamanho, toque para mover e confirme',
    [State.Confirmed]: 'Toque na mesa para invocar a criatura escolhida',
  };
  const sm = new CalibrationStateMachine(15, (_, next) => {
    ui.status.textContent = messages[next];
    ui.sizeRow.hidden = next !== State.Adjusting;
    ui.confirm.hidden = next !== State.Adjusting;
    ui.recalibrate.hidden = next !== State.Confirmed;
    ui.cardSelect.hidden = next !== State.Confirmed;
  });
  ui.status.textContent = messages[State.Scanning];

  const setFrame = (f) => {
    frame = f;
    if (grid) scene.remove(grid);
    grid = makeTableGrid(frame);
    scene.add(grid);
  };

  ui.size.oninput = () => {
    sizeScale = Number(ui.size.value);
    if (frame) setFrame(frame.scaled(sizeScale));
  };
  ui.confirm.onclick = () => sm.confirm();
  ui.recalibrate.onclick = () => sm.recalibrate();
  ui.exit.onclick = () => session.end();

  session.addEventListener('select', () => {
    if (sm.state === State.Confirmed) {
      if (!hasHit || !frame.isOnTable(hitPos, 0.05)) return;
      const side = frame.sideOf(hitPos);
      if (side === 'outside') {
        ui.status.textContent = 'Fora da mesa: toque dentro da grade';
        return;
      }
      const card = pickCard();
      if (!card) return;
      const choice = resolver.resolve(card);
      const creature = makeCreature(choice, { height: 0.08 });
      creature.position.copy(hitPos);
      // Vira para o centro da mesa (de frente para o outro jogador).
      const toward = side === 'near' ? frame.forward : { x: -frame.forward.x, z: -frame.forward.z };
      creature.rotation.y = Math.atan2(toward.x, toward.z);
      creature.userData.spawn();
      scene.add(creature);
      creatures.push(creature);
      ui.status.textContent = `${card.displayName} → ${resolver.label(choice.modelId)} (${side === 'near' ? 'seu lado' : 'lado do oponente'})`;
      return;
    }
    const result = sm.tap(hasHit);
    if (result === 'centerSet') {
      setFrame(TableFrame.fromTap(hitPos, camPos).scaled(sizeScale));
    } else if (result === 'recentered') {
      setFrame(frame.recentered(hitPos));
    } else if (result === 'invalid') {
      ui.status.textContent = 'Aponte para a mesa (o anel dourado) e toque de novo';
    }
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop((_, xrFrame) => {
    const dt = Math.min(clock.getDelta(), 0.1);
    hasHit = false;
    if (xrFrame) {
      const hits = xrFrame.getHitTestResults(hitSource);
      const pose = hits[0]?.getPose(refSpace);
      // Só planos horizontais (normal para cima): a mesa, não paredes.
      if (pose) {
        const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
        const up = new THREE.Vector3(0, 1, 0).transformDirection(m);
        if (up.y > 0.9) {
          hasHit = true;
          hitPos.setFromMatrixPosition(m);
          reticle.matrix.copy(m);
        }
      }
      const viewerPose = xrFrame.getViewerPose(refSpace);
      if (viewerPose) camPos.setFromMatrixPosition(new THREE.Matrix4().fromArray(viewerPose.transform.matrix));
      sm.tick(dt, hasHit, !!viewerPose && !viewerPose.emulatedPosition);
    }
    reticle.visible = hasHit && sm.state !== State.Confirmed;
    for (const c of creatures) c.userData.update(dt);
    renderer.render(scene, camera);
  });

  session.addEventListener('end', () => {
    hitSource.cancel();
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.domElement.remove();
    onEnd?.();
  });
}
