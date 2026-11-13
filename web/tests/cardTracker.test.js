import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardTracker, cardRectFromTitle, CARD } from '../src/recognition/cardTracker.js';

// Gerador determinístico para a textura da carta.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const blobs = Array.from({ length: 70 }, () => ({ u: 0.1 + rnd() * 0.8, v: 0.12 + rnd() * 0.42, r: 0.02 + rnd() * 0.05, c: 40 + rnd() * 180 }));
const text = Array.from({ length: 120 }, () => ({ u: 0.08 + rnd() * 0.8, v: 0.6 + rnd() * 0.3, w: 0.01 + rnd() * 0.03 }));

const W = 320;
const H = 240;
const CH = 150; // altura da carta em pixels (escala 1)

/** Cor da carta no ponto (u, v) ∈ [0,1]² (fora: null). */
function cardColor(u, v) {
  if (u < 0 || v < 0 || u > 1 || v > 1) return null;
  if (u < 0.045 || u > 0.955 || v < 0.035 || v > 0.965) return 15; // moldura preta
  for (const b of blobs) if ((u - b.u) ** 2 + ((v - b.v) * 1.4) ** 2 < b.r * b.r) return b.c;
  for (const t of text) if (v > t.v && v < t.v + 0.012 && u > t.u && u < t.u + t.w) return 30;
  if (v > 0.055 && v < 0.09 && u > 0.075 && u < 0.55) return 35; // nome
  return 215;
}

/** Desenha a carta com centro (cx, cy), ângulo a (rad) e escala s. */
function render({ cx, cy, a, s }) {
  const data = new Float32Array(W * H);
  const ch = CH * s;
  const cw = ch * CARD.aspect;
  const cos = Math.cos(-a);
  const sin = Math.sin(-a);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const dx = x + ox - cx;
        const dy = y + oy - cy;
        const u = (dx * cos - dy * sin) / cw + 0.5;
        const v = (dx * sin + dy * cos) / ch + 0.5;
        sum += cardColor(u, v) ?? 95 + 10 * Math.sin(x * 0.05) * Math.cos(y * 0.07);
      }
      data[y * W + x] = sum / 4;
    }
  }
  return { data, w: W, h: H, scale: 1 };
}

function corners({ cx, cy, a, s }) {
  const ch = CH * s;
  const cw = ch * CARD.aspect;
  return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([u, v]) => ({
    x: cx + u * cw * Math.cos(a) - v * ch * Math.sin(a),
    y: cy + u * cw * Math.sin(a) + v * ch * Math.cos(a),
  }));
}

const maxCornerError = (q, pose) => Math.max(...corners(pose).map((c, i) => Math.hypot(c.x - q[i].x, c.y - q[i].y)));

/** Retângulo estimado pelo título, com erro proposital (como o OCR). */
function ocrGuess(pose, err = 0.08) {
  const ch = CH * pose.s;
  const cw = ch * CARD.aspect;
  const left = pose.cx - cw / 2;
  const top = pose.cy - ch / 2;
  const tH = CARD.titleHeight * ch * (1 + err);
  const tc = top + CARD.titleCenterY * ch + 2;
  return cardRectFromTitle({ x0: left + CARD.titleLeft * cw + 3, y0: tc - tH / 2, y1: tc + tH / 2 });
}

test('encaixa o contorno nas bordas reais mesmo com a estimativa do OCR errada', () => {
  const pose = { cx: 160, cy: 120, a: 0, s: 1 };
  const t = new CardTracker(render(pose), { rect: ocrGuess(pose, 0.1) });
  assert.ok(t.valid, 'achou pontos para seguir');
  assert.ok(maxCornerError(t.quad, pose) < 3, `erro dos cantos ${maxCornerError(t.quad, pose).toFixed(1)} px`);
});

test('segue a carta andando, girando e aproximando', () => {
  let pose = { cx: 120, cy: 120, a: 0, s: 1 };
  const t = new CardTracker(render(pose), { rect: ocrGuess(pose) });
  for (let i = 1; i <= 30; i++) {
    pose = { cx: 120 + i * 2.5, cy: 120 + Math.sin(i / 5) * 12, a: i * 0.012, s: 1 + i * 0.006 };
    assert.ok(t.track(render(pose)), `perdeu a carta no quadro ${i}`);
  }
  const err = maxCornerError(t.quad, pose);
  assert.ok(err < 4, `erro dos cantos no fim ${err.toFixed(1)} px`);
});

test('reencontra a carta a partir de um quadro antigo do OCR (movimento grande)', () => {
  const old = { cx: 150, cy: 120, a: 0, s: 1 };
  const t = new CardTracker(render(old), { rect: ocrGuess(old) });
  const now = { cx: 185, cy: 108, a: 0.1, s: 1.12 };
  assert.ok(t.track(render(now)), 'não reencontrou');
  assert.ok(maxCornerError(t.quad, now) < 5, `erro ${maxCornerError(t.quad, now).toFixed(1)} px`);
});

test('quando a carta sai da imagem, avisa que perdeu', () => {
  const pose = { cx: 160, cy: 120, a: 0, s: 1 };
  const t = new CardTracker(render(pose), { rect: ocrGuess(pose) });
  const empty = render({ cx: -500, cy: -500, a: 0, s: 1 });
  assert.equal(t.track(empty), false);
});

test('cardShapeOk: aceita carta em perspectiva, barra contorno deformado', async () => {
  const { cardShapeOk } = await import('../src/recognition/cardTracker.js');
  assert.ok(cardShapeOk([{ x: 220, y: 420 }, { x: 400, y: 420 }, { x: 400, y: 671 }, { x: 220, y: 671 }]));
  assert.ok(cardShapeOk([{ x: 250, y: 470 }, { x: 395, y: 462 }, { x: 430, y: 640 }, { x: 222, y: 652 }]));
  // Como no print: canto de baixo escorrendo para a mesa.
  assert.ok(!cardShapeOk([{ x: 25, y: 620 }, { x: 390, y: 625 }, { x: 470, y: 1280 }, { x: 5, y: 1055 }]));
  // Achatado (pegou só a caixa de texto) e torto.
  assert.ok(!cardShapeOk([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 120 }, { x: 0, y: 120 }]));
  assert.ok(!cardShapeOk([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 480, y: 280 }, { x: 280, y: 280 }]));
});
