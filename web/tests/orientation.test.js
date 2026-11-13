import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCardQuad } from '../src/recognition/cardDetector.js';
import { fromRotated, toRotated, rotateGray, rotatedSize, rotationFor, ROTATIONS } from '../src/recognition/orientation.js';
import { renderScene, ocrTitleBox, maxCornerError } from './helpers/syntheticCard.js';

const W = 640;
const H = 1138;

test('ida e volta do giro devolve o mesmo ponto', () => {
  for (const deg of [0, 90, 180, 270]) {
    for (const p of [{ x: 0, y: 0 }, { x: 123.5, y: 456.25 }, { x: W, y: H }]) {
      const back = fromRotated(toRotated(p, deg, W, H), deg, W, H);
      assert.ok(Math.hypot(back.x - p.x, back.y - p.y) < 1e-9, `${deg}°`);
    }
  }
  assert.deepEqual(rotatedSize(W, H, 90), { w: H, h: W });
  // 90° horário: o canto de cima à esquerda vai para o de cima à direita.
  const p = toRotated({ x: 0, y: 0 }, 90, W, H);
  assert.ok(Math.abs(p.x - H) < 1e-9 && Math.abs(p.y) < 1e-9);
});

test('a maioria das leituras é em pé, com ponta-cabeça frequente e de lado de vez em quando', () => {
  const count = (d) => ROTATIONS.filter((r) => r === d).length;
  assert.ok(count(0) >= ROTATIONS.length / 2);
  assert.ok(count(180) >= 3);
  assert.ok(count(90) >= 1 && count(270) >= 1);
  assert.deepEqual([0, 1, 2, 3].map((i) => rotationFor(i, true)).sort((a, b) => a - b), [0, 90, 180, 270]);
});

// Cantos na ordem da CARTA (topo-esq., topo-dir., base-dir., base-esq.).
const upright = [{ x: 220, y: 420 }, { x: 400, y: 420 }, { x: 400, y: 671 }, { x: 220, y: 671 }];
const turn = (q, deg) => q.map((p) => fromRotated(p, deg, W, H));
const cases = {
  // A mesma carta girada no quadro: o nome fica embaixo e de cabeça para baixo, ou de lado.
  'de ponta-cabeça': [180, turn(upright, 180)],
  'de ponta-cabeça e deitada na mesa': [180, turn([{ x: 250, y: 470 }, { x: 395, y: 462 }, { x: 430, y: 640 }, { x: 222, y: 652 }], 180)],
  'virada 90° para a direita': [90, null],
  'virada 90° para a esquerda': [270, null],
};

for (const [name, [deg, given]] of Object.entries(cases)) {
  test(`acha a carta ${name} lendo o quadro girado`, () => {
    // Carta de lado num quadro em retrato: monta em pé no quadro deitado e leva para o retrato.
    const r = rotatedSize(W, H, deg);
    const inRot = given ? given.map((p) => toRotated(p, deg, W, H)) : [{ x: 470, y: 200 }, { x: 650, y: 200 }, { x: 650, y: 451 }, { x: 470, y: 451 }];
    const q = given ?? inRot.map((p) => fromRotated(p, deg, W, H));
    const frame = renderScene(W, H, q);
    // Sem girar, o "nome" está de cabeça para baixo/de lado: o OCR não o leria. Girado, fica em pé.
    const rot = rotateGray(frame, deg);
    assert.equal(rot.w, r.w);
    const found = detectCardQuad(rot, ocrTitleBox(inRot));
    assert.ok(found, 'não achou a carta no quadro girado');
    const back = found.map((p) => fromRotated(p, deg, W, H));
    const size = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
    // Os cantos voltam na ordem da carta, não da tela.
    assert.ok(maxCornerError(back, q) < Math.max(3, size * 0.03), `erro dos cantos ${maxCornerError(back, q).toFixed(1)} px`);
  });
}
