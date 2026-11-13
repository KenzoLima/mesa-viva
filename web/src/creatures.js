// Criaturas 3D a partir de uma escolha do ModelResolver.
// Se existir public/models/<modelId>.glb, usa o modelo (com a animação "idle" ou a primeira).
// Senão, monta um placeholder procedural nas cores da carta: o app funciona sem nenhum asset.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export const MANA = { W: 0xf4ecd0, U: 0x3b7dd8, B: 0x5b4a6e, R: 0xd8452b, G: 0x3f9b4a, C: 0xa8a39a, M: 0xd4af37 };
const BIOME = {
  terrain_plains: 0xd9c27a, terrain_water: 0x2e6fb5, terrain_swamp: 0x3f4a33,
  terrain_mountain: 0x8a5a44, terrain_forest: 0x2f7a3a, terrain_wasteland: 0x8c8577,
};
const WINGED = new Set(['winged', 'dragon', 'angel', 'bat', 'bird', 'fairy', 'demon']);
const HORNED = new Set(['dragon', 'demon', 'goblin', 'orc']);

const loader = new GLTFLoader();
const glbCache = new Map();

function loadGlb(modelId) {
  if (!glbCache.has(modelId)) {
    const url = `${import.meta.env?.BASE_URL ?? './'}models/${modelId}.glb`;
    glbCache.set(modelId, fetch(url, { method: 'HEAD' })
      .then((r) => (r.ok && !(r.headers.get('content-type') ?? '').includes('html') ? loader.loadAsync(url) : null))
      .catch(() => null));
  }
  return glbCache.get(modelId);
}

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...extra });

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
}

function creatureBody(choice, colors) {
  const g = new THREE.Group();
  const main = colors[0];
  const accent = colors[1] ?? 0xf2e6c8;
  const body = mesh(new THREE.SphereGeometry(0.3, 24, 16), mat(main), 0, 0.38, 0);
  body.scale.set(1, 1.2, 0.9);
  const head = mesh(new THREE.SphereGeometry(0.19, 24, 16), mat(main), 0, 0.86, 0.04);
  const eyeMat = mat(0xfff6c0, { emissive: 0xffe680, emissiveIntensity: 1.5 });
  g.add(body, head,
    mesh(new THREE.SphereGeometry(0.035, 8, 8), eyeMat, -0.07, 0.9, 0.2),
    mesh(new THREE.SphereGeometry(0.035, 8, 8), eyeMat, 0.07, 0.9, 0.2),
    mesh(new THREE.SphereGeometry(0.12, 16, 8), mat(accent), 0, 0.42, 0.22));
  for (const side of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.18, 10), mat(main), side * 0.14, 0.09, 0));
  if (WINGED.has(choice.modelId)) {
    const wingGeo = new THREE.ConeGeometry(0.22, 0.5, 3);
    for (const side of [-1, 1]) {
      const w = mesh(wingGeo, mat(accent, { side: THREE.DoubleSide }), side * 0.32, 0.6, -0.12);
      w.rotation.set(0.3, 0, side * -1.1);
      w.scale.z = 0.15;
      w.userData.wing = side;
      g.add(w);
    }
  }
  if (HORNED.has(choice.modelId)) {
    for (const side of [-1, 1]) {
      const h = mesh(new THREE.ConeGeometry(0.04, 0.16, 8), mat(0x2b2218), side * 0.1, 1.04, 0);
      h.rotation.z = side * -0.4;
      g.add(h);
    }
  }
  return g;
}

function terrainBody(choice) {
  const g = new THREE.Group();
  const mix = choice.terrainMix.length ? choice.terrainMix : [choice.modelId];
  const step = (Math.PI * 2) / mix.length;
  mix.forEach((biome, i) => {
    const color = BIOME[biome] ?? 0x888888;
    const slice = mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.08, 32, 1, false, i * step, step), mat(color), 0, 0.04, 0);
    g.add(slice);
    const a = i * step + step / 2;
    const x = Math.sin(a) * 0.28;
    const z = Math.cos(a) * 0.28;
    if (biome === 'terrain_forest') g.add(mesh(new THREE.ConeGeometry(0.1, 0.35, 8), mat(0x1f5a28), x, 0.25, z));
    else if (biome === 'terrain_mountain') g.add(mesh(new THREE.ConeGeometry(0.16, 0.4, 5), mat(0x6d4a3a), x, 0.28, z));
    else if (biome === 'terrain_water') g.add(mesh(new THREE.TorusGeometry(0.09, 0.02, 8, 24), mat(0x9fd3ff), x, 0.1, z));
    else g.add(mesh(new THREE.DodecahedronGeometry(0.07), mat(color), x, 0.13, z));
  });
  return g;
}

function spellBody(colors) {
  const g = new THREE.Group();
  const core = mesh(new THREE.IcosahedronGeometry(0.18), mat(colors[0], { emissive: colors[0], emissiveIntensity: 1.2 }), 0, 0.5, 0);
  const ring = mesh(new THREE.TorusGeometry(0.32, 0.025, 8, 48), mat(colors[1] ?? 0xffffff, { emissive: colors[0], emissiveIntensity: 0.6 }), 0, 0.5, 0);
  ring.userData.spin = 2.5;
  core.userData.spin = -1.5;
  g.add(core, ring);
  return g;
}

function propBody(colors) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.12, 6), mat(0x3a3128), 0, 0.06, 0));
  const gem = mesh(new THREE.OctahedronGeometry(0.22), mat(colors[0], { metalness: 0.5, roughness: 0.25, emissive: colors[0], emissiveIntensity: 0.3 }), 0, 0.45, 0);
  gem.userData.spin = 1;
  g.add(gem);
  return g;
}

function proceduralBody(choice) {
  const colors = (choice.tint ?? ['C']).map((k) => MANA[k] ?? MANA.C);
  if (choice.kind === 'terrain') return terrainBody(choice);
  if (choice.kind === 'spell') return spellBody(colors);
  if (choice.kind === 'prop') return propBody(colors);
  return creatureBody(choice, colors);
}

/** Ajusta o objeto para ficar com a base em y=0 e a altura dada. */
function fitHeight(obj, height) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = height / Math.max(size.y, size.x * 0.8, 1e-6);
  obj.scale.multiplyScalar(s);
  obj.position.y -= box.min.y * s;
}

/**
 * Cria a criatura. `height` = altura em unidades da cena (MindAR: largura da carta = 1; WebXR: metros).
 * Retorna um Group com userData.update(dt), userData.spawn() e userData.loading (true enquanto o
 * modelo 3D está sendo baixado).
 * waitForModel: não mostra o boneco provisório enquanto carrega; a criatura surge (com o "pop")
 * só quando o modelo chega. Sem modelo para essa criatura, surge o boneco provisório.
 */
export function makeCreature(choice, { height = 0.6, waitForModel = false } = {}) {
  const root = new THREE.Group();
  const pivot = new THREE.Group(); // anima escala/balanço sem mexer no root (que o app posiciona)
  root.add(pivot);
  const finalHeight = height * (choice.scale ?? 1);

  let body = proceduralBody(choice);
  fitHeight(body, finalHeight);
  pivot.add(body);
  let mixer = null;
  root.userData.loading = true;
  if (waitForModel) pivot.visible = false;

  loadGlb(choice.modelId).then((gltf) => {
    root.userData.loading = false;
    pivot.visible = true;
    if (!gltf) return;
    const model = cloneSkinned(gltf.scene);
    fitHeight(model, finalHeight);
    pivot.remove(body);
    body = model;
    pivot.add(model);
    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(model);
      const clip = gltf.animations.find((a) => /idle/i.test(a.name)) ?? gltf.animations[0];
      mixer.clipAction(clip).play();
    }
  });

  let t = 0;
  let spawnT = 1;
  root.userData.spawn = () => { spawnT = 0; };
  root.userData.update = (dt) => {
    t += dt;
    // Esperando o modelo: segura o "pop" para ele acontecer quando a criatura aparecer.
    if (spawnT < 1 && !(waitForModel && root.userData.loading)) spawnT = Math.min(1, spawnT + dt / 0.6);
    // "Pop" com leve exagero no fim (easeOutBack).
    const k = 1.70158;
    const e = 1 + (k + 1) * (spawnT - 1) ** 3 + k * (spawnT - 1) ** 2;
    pivot.scale.setScalar(Math.max(0.001, e));
    if (!mixer && choice.kind === 'creature') pivot.position.y = Math.sin(t * 2) * finalHeight * 0.03;
    body.traverse((o) => {
      if (o.userData.spin) o.rotation.y += o.userData.spin * dt;
      if (o.userData.wing) o.rotation.z = o.userData.wing * (-1.1 + Math.sin(t * 8) * 0.35);
    });
    mixer?.update(dt);
  };
  return root;
}

export function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x302438, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(0.5, 2, 1);
  scene.add(sun);
}
