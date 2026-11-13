// Carrega cada GLB do Bestiário com o GLTFLoader do three.js (o mesmo do app web) e confere
// malha, esqueleto e animações.   node tools/bestiary/validate_three.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const three = resolve(here, '../../web/node_modules/three');
const THREE = await import(pathToFileURL(join(three, 'build/three.module.js')));
const { GLTFLoader } = await import(pathToFileURL(join(three, 'examples/jsm/loaders/GLTFLoader.js')));

const root = resolve(here, '../../Bestiary');
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.glb')) files.push(p);
  }
})(root);

let bad = 0;
for (const file of files.sort()) {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  try {
    const gltf = await new Promise((ok, err) => new GLTFLoader().parse(ab, '', ok, err));
    let tris = 0, skinned = 0, bones = 0;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (o.isSkinnedMesh) { skinned++; bones = o.skeleton.bones.length; tris += o.geometry.index.count / 3; }
    });
    const mixer = new THREE.AnimationMixer(gltf.scene);
    let finite = true;
    for (const clip of gltf.animations) {
      mixer.stopAllAction();
      mixer.clipAction(clip).play();
      mixer.setTime(clip.duration * 0.37);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => { if (o.isBone && !o.matrixWorld.elements.every(Number.isFinite)) finite = false; });
    }
    mixer.stopAllAction();
    const box = new THREE.Box3();
    gltf.scene.traverse((o) => { if (o.isSkinnedMesh) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox); } });
    const ok = skinned > 0 && tris > 0 && finite && (file.includes('_LOD') || gltf.animations.some((a) => /idle/i.test(a.name)));
    if (!ok) bad++;
    console.log(`${ok ? 'OK  ' : 'ERRO'} ${file.slice(root.length + 1).split(/[\\/]/).join('/')}  ${tris} tris  ${bones} ossos  ` +
      `altura ${box.max.y.toFixed(2)} m  clips: ${gltf.animations.map((a) => a.name).join(', ')}`);
  } catch (e) { bad++; console.log(`ERRO ${file}: ${e.message ?? e}`); }
}
console.log(bad ? `${bad} arquivo(s) com problema` : `${files.length} arquivos GLB carregados sem erro`);
process.exit(bad ? 1 : 0);
