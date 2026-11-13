// Modo Cartas: reconhece as cartas pela imagem (MindAR) e faz a criatura surgir em cima.
// Funciona no iPhone (Safari) e no Android (Chrome). Equivale à Fase 0 do Unity (CardCreatureSpawner).
//
// Alvos: public/targets/targets.mind + targets.json (gerados em compilar.html).
// targets.json = [{ "name": "Llanowar Elves" }, ...] na MESMA ordem das imagens do .mind.

import * as THREE from 'three';
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js';
import { makeCreature, addLights } from '../creatures.js';

export async function startCardsMode(container, { targets, catalog, resolver, onStatus }) {
  const mindar = new MindARThree({
    container,
    imageTargetSrc: './targets/targets.mind',
    maxTrack: 3,
    uiLoading: 'no',
    uiScanning: 'no',
    uiError: 'no',
    filterMinCF: 0.0001,
    filterBeta: 0.001,
  });
  const { renderer, scene, camera } = mindar;
  addLights(scene);

  const creatures = [];
  targets.forEach((target, index) => {
    const card = catalog.lookup(target.name)[0];
    const anchor = mindar.addAnchor(index);
    if (!card) {
      console.warn(`Carta "${target.name}" não está no catálogo; o alvo ${index} fica sem criatura.`);
      return;
    }
    const choice = resolver.resolve(card);
    const creature = makeCreature(choice, { height: 0.7 });
    // No MindAR a carta é o plano XY (largura 1) e Z sai da carta: deita o "para cima" da criatura em +Z.
    // Gira 180° em volta do próprio eixo: frente (+Z do modelo) para o topo da carta, de costas para quem
    // jogou a carta, olhando para o campo do oponente.
    creature.rotation.set(Math.PI / 2, Math.PI, 0);
    creature.position.z = 0.01;
    anchor.group.add(creature);
    creatures.push(creature);
    anchor.onTargetFound = () => {
      creature.userData.spawn();
      onStatus?.(`${card.displayName} → ${resolver.label(choice.modelId)} (${choice.reason})`);
    };
    anchor.onTargetLost = () => onStatus?.('Aponte a câmera para uma carta');
  });

  await mindar.start();
  onStatus?.('Aponte a câmera para uma carta');
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    for (const c of creatures) c.userData.update(dt);
    renderer.render(scene, camera);
  });

  return () => {
    renderer.setAnimationLoop(null);
    mindar.stop();
    renderer.dispose();
    container.innerHTML = '';
  };
}
