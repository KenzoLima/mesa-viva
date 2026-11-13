// Prévia 3D da criatura de uma carta (Biblioteca → toque numa carta): gira devagar sobre um disco,
// com a mesma luz do campo de batalha. Arrastar com o dedo gira na mão; "Atacar" toca o golpe.

import * as THREE from 'three';
import { makeCreature, addLights } from './creatures.js';

/**
 * Mostra a criatura de `choice` no canvas. Retorna { setChoice(choice), attack(), stop() }.
 * onLoading(bool): avisa enquanto o modelo baixa.
 */
export function startPreview(canvas, choice, { onLoading } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
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
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 220;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const clock = new THREE.Clock();
  let wasLoading = null;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!drag && !reduced) turntable.rotation.y += spin * dt;
    creature?.userData.update(dt);
    const loading = !!creature?.userData.loading;
    if (loading !== wasLoading) {
      wasLoading = loading;
      onLoading?.(loading);
    }
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
      renderer.dispose();
      spin = 0;
    },
  };
}
