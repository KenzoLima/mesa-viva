import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCardQuad } from '../src/recognition/cardDetector.js';
import { renderScene, ocrTitleBox, maxCornerError } from './helpers/syntheticCard.js';

const W = 640;
const H = 1138; // retrato, como a câmera do iPhone reduzida

const cases = {
  'de frente': [{ x: 220, y: 420 }, { x: 400, y: 420 }, { x: 400, y: 671 }, { x: 220, y: 671 }],
  'deitada na mesa (perspectiva, como no vídeo)': [{ x: 250, y: 470 }, { x: 395, y: 462 }, { x: 430, y: 640 }, { x: 222, y: 652 }],
  'girada 12°': [{ x: 240, y: 400 }, { x: 410, y: 436 }, { x: 362, y: 667 }, { x: 192, y: 631 }],
  pequena: [{ x: 300, y: 600 }, { x: 380, y: 598 }, { x: 392, y: 700 }, { x: 290, y: 703 }],
};

for (const [name, q] of Object.entries(cases)) {
  test(`acha o contorno da carta: ${name}`, () => {
    const frame = renderScene(W, H, q);
    const found = detectCardQuad(frame, ocrTitleBox(q));
    assert.ok(found, 'não achou a carta');
    const err = maxCornerError(found, q);
    const size = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
    assert.ok(err < Math.max(3, size * 0.03), `erro dos cantos ${err.toFixed(1)} px (carta com ${size.toFixed(0)} px)`);
  });
}

test('sem carta, não inventa um contorno', () => {
  const frame = renderScene(W, H, [{ x: -900, y: -900 }, { x: -800, y: -900 }, { x: -800, y: -760 }, { x: -900, y: -760 }]);
  assert.equal(detectCardQuad(frame, { x0: 250, x1: 380, y0: 470, y1: 482 }), null);
});
