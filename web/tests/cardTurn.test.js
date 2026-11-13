import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardYaw, angleDiff, TapWatcher } from '../src/recognition/cardTurn.js';

/**
 * Contorno na tela de uma carta deitada na mesa, girada `deg` graus na mesa (horário visto de cima),
 * com a câmera inclinada `tilt` graus (90 = olhando de cima). Cantos na ordem da carta.
 */
function cardOnTable(deg, tilt = 50, { x = 0, z = 0 } = {}) {
  const a = (deg * Math.PI) / 180;
  const t = (tilt * Math.PI) / 180;
  const corners = [[-31.5, 44], [31.5, 44], [31.5, -44], [-31.5, -44]]; // (direita, para longe), topo = longe
  return corners.map(([cx, cz]) => {
    const tx = x + cx * Math.cos(a) + cz * Math.sin(a);
    const tz = z - cx * Math.sin(a) + cz * Math.cos(a);
    const depth = 400 + tz * Math.cos(t);
    const up = tz * Math.sin(t);
    return { x: 500 + (800 * tx) / depth, y: 500 - (800 * up) / depth };
  });
}

test('mede o giro da carta no plano da mesa, mesmo vista de lado', () => {
  for (const tilt of [90, 60, 40]) {
    const base = cardYaw(cardOnTable(0, tilt));
    for (const deg of [30, 90, -90, 180]) {
      // Horário visto de cima = anti-horário na conta do cardYaw (eixo y da cena para cima).
      const d = angleDiff(cardYaw(cardOnTable(deg, tilt)), base);
      assert.ok(Math.abs(angleDiff(d, -deg)) < 5, `inclinação ${tilt}°, giro ${deg}°: medido ${d.toFixed(1)}°`);
    }
  }
});

test('carta virada 90° dispara uma vez; ponta-cabeça e tremor não', () => {
  const w = new TapWatcher();
  const feed = (yaw, secs) => {
    let fired = 0;
    for (let s = 0; s < secs; s += 1 / 30) fired += w.update(yaw, 1 / 30) ? 1 : 0;
    return fired;
  };
  assert.equal(feed(10, 1), 0); // surgiu com 10°
  assert.equal(feed(10 + 40, 1), 0); // contorno torto, não é virar
  assert.equal(w.update(10 + 90, 1 / 30), false); // um quadro só não basta
  assert.equal(feed(10, 0.2), 0);
  assert.equal(feed(10 + 85, 1), 1); // virou: dispara uma vez
  assert.equal(feed(10 + 95, 2), 0); // continua virada: não repete
  assert.equal(feed(10, 1), 0); // desvirou
  assert.equal(feed(10 - 88, 1), 1); // virou para o outro lado: dispara de novo
  assert.equal(feed(10 + 180, 1), 0); // de ponta-cabeça conta como desvirada
  assert.equal(w.tapped, false);
});
