// Desenho da mesa compartilhado pelos dois modos Mesa (WebXR no Android e câmera parada):
// área de jogo (TableAreaVisualizer do Unity), grupo da mesa com sombra e invocação das criaturas.

import * as THREE from 'three';
import { makeCreature } from '../creatures.js';
import { TableFrame, creatureHeight } from './tableFrame.js';

export const GOLD = 0xd4af37;
const GOLD_TEXT = '#e6c27a';
const LIFT = 0.002; // desenho da área um pouco acima do plano, para não brigar com a profundidade
export const HANDLE_OFFSET = 0.07;

export const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);

/** Mesa → matriz de mundo: X = direita, Y = cima, -Z = frente (do jogador para o oponente). */
export function frameMatrix(frame, m = new THREE.Matrix4()) {
  const r = frame.right;
  const f = frame.forward;
  m.makeBasis(new THREE.Vector3(r.x, 0, r.z), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-f.x, 0, -f.z));
  m.setPosition(frame.center.x, frame.center.y, frame.center.z);
  return m;
}

/** Matriz da âncora → TableFrame (a âncora guarda a pose da mesa confirmada). */
export function frameFromMatrix(m, width, depth) {
  const pos = new THREE.Vector3().setFromMatrixPosition(m);
  const back = new THREE.Vector3().setFromMatrixColumn(m, 2);
  return new TableFrame({ x: pos.x, y: pos.y, z: pos.z }, { x: -back.x, y: 0, z: -back.z }, width, depth);
}

/** Coordenada da mesa (x direita, y frente) → local do grupo da mesa. */
export const local = (t, h = 0) => new THREE.Vector3(t.x, h, -t.y);

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
export function makeArea(width, depth) {
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

export function setAreaOpacity(area, k) {
  area.traverse((o) => {
    const m = o.material;
    if (m?.userData.base !== undefined) m.opacity = m.userData.base * k;
  });
  area.visible = k > 0.001;
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    o.material?.map?.dispose();
    o.material?.dispose();
  });
}


/**
 * Grupo da mesa (segue a pose da mesa) com o "shadow catcher" e uma luz só para as sombras
 * (PLANO §5.4: o maior ganho de realismo por esforço).
 */
export function makeTableRig(scene) {
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
  const shadowLight = new THREE.DirectionalLight(0xffffff, 0.5);
  shadowLight.castShadow = true;
  shadowLight.shadow.mapSize.set(1024, 1024);
  Object.assign(shadowLight.shadow.camera, { left: -0.7, right: 0.7, top: 0.7, bottom: -0.7, near: 0.05, far: 3 });
  shadowLight.shadow.bias = -0.0005;
  shadowLight.position.set(0.25, 1, 0.35);
  tableRoot.add(shadowLight, shadowLight.target);
  return { tableRoot, shadowCatcher };
}

/** Ajusta o "shadow catcher" ao tamanho da área (com folga). */
export function fitShadowCatcher(shadowCatcher, frame) {
  shadowCatcher.scale.set((frame.width + 0.5) / 2, 1, (frame.depth + 0.5) / 2);
}

/** Atualiza as criaturas e liga a sombra delas quando o modelo termina de carregar. */
export function updateCreatures(creatures, dt) {
  for (const c of creatures) {
    c.userData.update(dt);
    if (!c.userData.shadowed && !c.userData.loading) {
      c.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      c.userData.shadowed = true;
    }
  }
}

/** Animação de opacidade da área ao confirmar: pisca e some. Retorna se acabou. */
export function animateAreaFade(area, fade, dt) {
  fade.t += dt;
  const blink = fade.t < 0.6 ? 0.55 + 0.45 * Math.cos((fade.t * Math.PI * 2) / 0.2) : 1;
  const out = fade.t < 0.6 ? 1 : Math.max(0, 1 - (fade.t - 0.6) / 0.6);
  setAreaOpacity(area, blink * out);
  return fade.t >= 1.2;
}

/** Rotação Y (grupo da mesa) para a criatura olhar para onde aponta o topo da carta (yaw em graus). */
export function facingFromYaw(yawDeg) {
  const a = (yawDeg * Math.PI) / 180;
  return Math.atan2(Math.sin(a), -Math.cos(a));
}

const LUNGE = 0.75; // s: bote de reserva (modelo sem clipe de ataque, ou criatura sem attack())

/** Para onde a criatura olha: o topo da carta; virada (atacando), para onde a carta apontava em pé. */
const facingOf = (entry) => facingFromYaw(entry.tapped ? entry.baseYaw : entry.yaw);

/**
 * Criaturas das cartas reconhecidas na mesa: aplica os eventos do TableCards (spawn, move, tap,
 * untap, remove). Cada criatura fica em pé no centro da carta, olhando para onde o topo da carta
 * aponta, e desliza suave quando a carta anda. Carta virada para qualquer lado: a criatura se volta
 * para o oponente e ataca (o golpe do modelo; sem ele, um bote). onEvent(texto) recebe uma frase.
 */
export class RecognizedCreatures {
  constructor(tableRoot, resolver, onEvent = () => {}) {
    this.tableRoot = tableRoot;
    this.resolver = resolver;
    this.onEvent = onEvent;
    this.byId = new Map();
    this.dying = new Set(); // já saíram da mesa; somem quando a animação de morte acaba
  }

  apply(events) {
    for (const { type, entry } of events) {
      const name = entry.card.displayName ?? entry.card.name;
      if (type === 'spawn') {
        const choice = this.resolver.resolve(entry.card);
        const creature = makeCreature(choice, { height: creatureHeight(entry.card.power) });
        creature.position.copy(local(entry.pos));
        creature.rotation.y = facingOf(entry);
        creature.userData.height = creatureHeight(entry.card.power);
        creature.userData.target = { pos: creature.position.clone(), rot: creature.rotation.y };
        creature.userData.spawn();
        creature.userData.recognized = entry.id;
        this.tableRoot.add(creature);
        this.byId.set(entry.id, creature);
        this.onEvent(`${name} na mesa → ${this.resolver.label(choice.modelId)}`);
      } else if (type === 'move') {
        const c = this.byId.get(entry.id);
        if (c) c.userData.target = { pos: local(entry.pos), rot: facingOf(entry) };
      } else if (type === 'tap') {
        const c = this.byId.get(entry.id);
        if (c) {
          c.userData.target = { pos: local(entry.pos), rot: facingOf(entry) };
          // O golpe do modelo (creatures.js); se não houver, o bote daqui.
          if (!c.userData.attack?.()) c.userData.lungeT = 0;
        }
        this.onEvent(`${name} atacou`);
      } else if (type === 'remove') {
        const c = this.byId.get(entry.id);
        if (c) {
          this.byId.delete(entry.id);
          // A criatura morre (clipe de morte do modelo, ou tomba) e só então sai da cena.
          if (c.userData.die && !c.userData.loading) {
            c.userData.die();
            this.dying.add(c);
          } else {
            this.tableRoot.remove(c);
          }
          this.onEvent(`${name} saiu da mesa`);
        }
      }
    }
  }

  /** Movimento suave até a posição/rotação nova, bote de ataque e animação de cada criatura. */
  update(dt) {
    const k = 1 - Math.exp(-dt * 8);
    for (const c of this.byId.values()) {
      const t = c.userData.target;
      const base = (c.userData.base ??= c.position.clone()); // posição sem o bote
      if (t) {
        base.lerp(t.pos, k);
        let d = t.rot - c.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        c.rotation.y += d * (c.userData.lungeT !== undefined ? Math.min(1, k * 3) : k);
      }
      c.position.copy(base);
      if (c.userData.lungeT !== undefined) {
        // Recua, dá o bote para a frente (para onde olha) e volta.
        const f = Math.min(1, (c.userData.lungeT += dt) / LUNGE);
        const z = f < 0.3 ? -0.15 * Math.sin((f / 0.3) * Math.PI / 2)
          : f < 0.5 ? -0.15 + 0.6 * Math.sin(((f - 0.3) / 0.2) * Math.PI / 2)
            : 0.45 * (1 - (f - 0.5) / 0.5) ** 2;
        const h = c.userData.height ?? 0.07;
        c.position.x += Math.sin(c.rotation.y) * z * h;
        c.position.z += Math.cos(c.rotation.y) * z * h;
        if (f >= 1) delete c.userData.lungeT;
      }
    }
    updateCreatures(this.byId.values(), dt);
    for (const c of this.dying) {
      c.userData.update(dt);
      if (c.userData.gone) {
        this.tableRoot.remove(c);
        this.dying.delete(c);
      }
    }
  }

  clear() {
    for (const c of [...this.byId.values(), ...this.dying]) this.tableRoot.remove(c);
    this.byId.clear();
    this.dying.clear();
  }

  get size() {
    return this.byId.size;
  }
}
