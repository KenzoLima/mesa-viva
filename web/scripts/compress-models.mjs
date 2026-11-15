// Comprime com meshopt (EXT_meshopt_compression) os .glb de public/models/** e confere que nada mudou
// de forma visível: mesmos nós, malhas, peles e animações, e a caixa do modelo igual até 0,5%.
// O app decodifica com o MeshoptDecoder do three (creatures.js).
//
//   npm run compress-models            comprime e grava os que passaram na conferência
//   npm run compress-models -- --dry   só mostra o que faria
//
// Rode depois de `git lfs pull`: sem isso os .glb são só os ponteiros do LFS (o script avisa e para).
// Arquivos já comprimidos com meshopt são pulados: rodar de novo não muda nada.

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const ROOT = fileURLToPath(new URL('../public/models/', import.meta.url));
const TOLERANCE = 0.005; // fração da diagonal da caixa
const dry = process.argv.includes('--dry');

async function* glbFiles(dir) {
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) yield* glbFiles(p);
    else if (d.name.toLowerCase().endsWith('.glb')) yield p;
  }
}

// Matriz 4 × 4 em colunas (como no glTF).
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
const apply = (m, v) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);

/**
 * Caixa do modelo como ele é desenhado parado: malhas com pele são deformadas pelos ossos na pose de
 * repouso (jointWorld × inverseBind), as outras pela matriz do nó. O getBounds do glTF-Transform
 * ignora a pele, e a quantização muda justamente a matriz do nó/inverseBind das malhas com pele.
 */
function drawnBounds(scene) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const add = (p) => p.forEach((v, i) => { min[i] = Math.min(min[i], v); max[i] = Math.max(max[i], v); });
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const skin = node.getSkin();
    let joints = null;
    if (skin) {
      const ibm = skin.getInverseBindMatrices();
      joints = skin.listJoints().map((j, i) => mul(j.getWorldMatrix(), ibm ? ibm.getElement(i, []) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    }
    const world = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const J = joints && prim.getAttribute('JOINTS_0');
      const W = joints && prim.getAttribute('WEIGHTS_0');
      const v = [];
      const jv = [];
      const wv = [];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        if (!J || !W) {
          add(apply(world, v));
          continue;
        }
        J.getElement(i, jv);
        W.getElement(i, wv);
        const sum = [0, 0, 0];
        let wsum = 0;
        for (let k = 0; k < 4; k++) {
          if (!wv[k]) continue;
          const p = apply(joints[jv[k]], v);
          for (let c = 0; c < 3; c++) sum[c] += p[c] * wv[k];
          wsum += wv[k];
        }
        add(sum.map((s) => s / (wsum || 1)));
      }
    }
  });
  return Number.isFinite(min[0]) ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] };
}

/** Resumo do que tem que continuar igual depois de comprimir (só o que a cena usa). */
function summary(doc) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const nodes = new Set();
  const meshes = new Set();
  const skins = new Set();
  scene?.traverse((n) => {
    nodes.add(n);
    if (n.getMesh()) meshes.add(n.getMesh());
    if (n.getSkin()) skins.add(n.getSkin());
  });
  for (const s of skins) for (const j of s.listJoints()) nodes.add(j);
  return {
    nodes: nodes.size,
    meshes: meshes.size,
    skins: skins.size,
    animations: root.listAnimations().map((a) => a.getName()).join('|'),
    box: scene ? drawnBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] },
  };
}

function compare(a, b) {
  const problems = [];
  for (const k of ['nodes', 'meshes', 'skins', 'animations']) {
    if (a[k] !== b[k]) problems.push(`${k}: ${a[k]} → ${b[k]}`);
  }
  const diag = Math.hypot(...a.box.max.map((v, i) => v - a.box.min[i])) || 1;
  const off = Math.max(...[0, 1, 2].flatMap((i) => [Math.abs(a.box.min[i] - b.box.min[i]), Math.abs(a.box.max[i] - b.box.max[i])]));
  if (off / diag > TOLERANCE) problems.push(`caixa mudou ${((off / diag) * 100).toFixed(2)}% da diagonal`);
  return problems;
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

async function main() {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

  let before = 0;
  let after = 0;
  let done = 0;
  let skipped = 0;
  let failed = 0;
  for await (const file of glbFiles(ROOT)) {
    const name = relative(ROOT, file).replaceAll('\\', '/');
    const raw = await readFile(file);
    if (raw.subarray(0, 4).toString('latin1') !== 'glTF') {
      if (raw.subarray(0, 40).toString('utf8').startsWith('version https://git-lfs')) {
        console.error(`${name}: é só o ponteiro do Git LFS. Rode \`git lfs pull\` antes.`);
        process.exit(1);
      }
      console.warn(`${name}: não é um GLB, pulado`);
      skipped++;
      continue;
    }
    const doc = await io.readBinary(new Uint8Array(raw));
    if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression')) {
      skipped++;
      continue;
    }
    const ref = summary(doc);
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const out = await io.writeBinary(doc);
    // Confere relendo o arquivo gerado (decodificado), como o app vai ler.
    const problems = compare(ref, summary(await io.readBinary(out)));
    if (problems.length) {
      console.warn(`${name}: NÃO gravado (${problems.join('; ')})`);
      failed++;
      continue;
    }
    if (out.byteLength >= raw.byteLength) {
      console.log(`${name}: comprimido não ficou menor (${kb(raw.byteLength)} → ${kb(out.byteLength)}), mantido`);
      skipped++;
      continue;
    }
    before += raw.byteLength;
    after += out.byteLength;
    done++;
    console.log(`${name}: ${kb(raw.byteLength)} → ${kb(out.byteLength)}`);
    if (!dry) await writeFile(file, out);
  }
  const pct = before ? Math.round((1 - after / before) * 100) : 0;
  console.log(`\n${done} comprimidos (${kb(before)} → ${kb(after)}, −${pct}%), ${skipped} pulados, ${failed} com problema${dry ? ' (--dry: nada gravado)' : ''}`);
  if (failed) process.exitCode = 1;
}

await stat(ROOT);
await main();
