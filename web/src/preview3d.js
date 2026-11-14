// Prévia 3D da criatura de uma carta (Biblioteca → toque numa carta): gira devagar sobre um disco,
// com a mesma luz do campo de batalha. Arrastar com o dedo gira na mão; "Atacar" toca o golpe.

import * as THREE from 'three';
import { makeCreature, addLights } from './creatures.js';

// Um renderizador só, reaproveitado a cada abertura: criar um contexto WebGL por abertura esgota o
// limite do navegador (~16) e, abrindo e fechando rápido, o Chrome chega a bloquear o WebGL da página.
let shared = null;
function sharedRenderer() {
  if (!shared) {
    shared = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    shared.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    shared.outputColorSpace = THREE.SRGBColorSpace;
    shared.domElement.className = 'cd-canvas';
  }
  return shared;
}

/**
 * Mostra a criatura de `choice` dentro de `container`. Retorna { setChoice(choice), attack(), stop() }.
 * onLoading(bool): avisa enquanto o modelo baixa. label: descrição do canvas para leitores de tela.
 */
export function startPreview(container, choice, { onLoading, label = '' } = {}) {
  const renderer = sharedRenderer();
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', label);
  canvas.setAttribute('role', 'img');
  container.prepend(canvas);
  const scene = new THREE.Scene();
  addLights(scene);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 20);
  camera.position.set(0, 0.62, 2.35);
  camera.lookAt(0, 0.42, 0);

  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.66, 0.04, 48),
    new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 0.85, metalness: 0.2 }),
  );
  disc.position.y = -0.02;
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.64, 0.012, 8, 64).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.4, metalness: 0.7 }),
  );
  const turntable = new THREE.Group();
  turntable.add(disc, rim);
  scene.add(turntable);

  let creature = null;
  function setChoice(c) {
    if (creature) turntable.remove(creature);
    // Altura fixa: na prévia todas cabem no quadro (o tamanho pelo poder vale na mesa).
    creature = makeCreature({ ...c, scale: 1 }, { height: 0.95, waitForModel: true });
    creature.userData.spawn();
    turntable.add(creature);
  }
  setChoice(choice);

  // Arrastar gira; solto, volta a girar sozinho devagar.
  let spin = 0.5;
  let drag = null;
  const down = (e) => {
    drag = { x: e.clientX, id: e.pointerId };
    canvas.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    turntable.rotation.y += (e.clientX - drag.x) * 0.012;
    drag.x = e.clientX;
  };
  const up = () => { drag = null; };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  const resize = () => {
    const w = container.clientWidth || 300;
    const h = container.clientHeight || 220;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Enquadramento automático: cada modelo tem um tamanho e uma pose (o dragão voa, com as asas
  // abertas). Mede a criatura já animada e aproxima/afasta a câmera para ela caber inteira, com o disco.
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  const view = { y: 0.42, dist: 2.35 }; // alvo atual (suavizado)
  const goal = { y: 0.42, dist: 2.35 };
  function measure() {
    if (!creature || creature.userData.loading) return;
    box.makeEmpty();
    creature.updateMatrixWorld(true);
    creature.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      if (o.isSkinnedMesh) o.computeBoundingBox(); // com a pose atual dos ossos
      else if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      part.copy(o.isSkinnedMesh ? o.boundingBox : o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(part);
    });
    box.union(part.set(new THREE.Vector3(-0.66, -0.04, -0.66), new THREE.Vector3(0.66, 0, 0.66))); // o disco
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    // Gira: a largura que importa é a maior entre x e z.
    const needH = size.y / 2 / Math.tan(halfFov);
    const needW = Math.max(size.x, size.z) / 2 / (Math.tan(halfFov) * camera.aspect);
    goal.dist = Math.max(needH, needW) * 1.12 + Math.max(size.x, size.z) / 2;
    goal.y = (box.min.y + box.max.y) / 2;
  }

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const clock = new THREE.Clock();
  let wasLoading = null;
  let measureT = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!drag && !reduced) turntable.rotation.y += spin * dt;
    creature?.userData.update(dt);
    const loading = !!creature?.userData.loading;
    if (loading !== wasLoading) {
      wasLoading = loading;
      onLoading?.(loading);
      measureT = 0.7; // mede logo que o modelo aparece (depois do "pop")
    }
    measureT -= dt;
    if (measureT <= 0) {
      measure();
      measureT = 0.6;
    }
    const k = 1 - Math.exp(-dt * 5);
    view.y += (goal.y - view.y) * k;
    view.dist += (goal.dist - view.dist) * k;
    // Um pouco de cima, olhando para o meio da criatura.
    camera.position.set(0, view.y + view.dist * 0.18, view.dist);
    camera.lookAt(0, view.y, 0);
    renderer.render(scene, camera);
  });

  return {
    setChoice,
    attack: () => creature?.userData.attack(),
    stop() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      disc.geometry.dispose();
      disc.material.dispose();
      rim.geometry.dispose();
      rim.material.dispose();
      renderer.renderLists.dispose();
      canvas.remove(); // o renderizador fica guardado para a próxima abertura
      spin = 0;
    },
  };
}
