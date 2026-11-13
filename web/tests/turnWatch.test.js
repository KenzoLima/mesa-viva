import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotateSquare, matchTurn, TurnTracker, patchView, PATCH_RES, PATCH_SIZE } from '../src/table/turnWatch.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const S = Math.round(PATCH_RES * PATCH_SIZE); // 84 px

/** "Carta" vista de cima: retângulo 38 × 53 px (63 × 88 mm a 0,6 px/mm) com uma arte assimétrica. */
function cardImage({ turn = 0, dx = 0, dy = 0, cover = null } = {}) {
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const art = new Float32Array(38 * 53).map(() => 40 + rnd() * 180);
  const img = new Float32Array(S * S).fill(70); // mesa
  // Desenha a carta em pé, no centro, e depois gira a imagem inteira (em volta do centro da carta).
  const ox = (S - 38) >> 1;
  const oy = (S - 53) >> 1;
  for (let y = 0; y < 53; y++) {
    for (let x = 0; x < 38; x++) {
      const px = ox + x;
      const py = oy + y;
      // Faixa do nome clara no topo, arte no meio: o topo é diferente da base.
      img[py * S + px] = y < 6 ? 235 : art[y * 38 + x];
    }
  }
  const k = { 0: 0, 90: 1, 180: 2, '-90': 3 }[turn];
  let out = rotateSquare(img, S, k);
  if (dx || dy) {
    const moved = new Float32Array(S * S).fill(70);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const sx = x - dx;
      const sy = y - dy;
      if (sx >= 0 && sy >= 0 && sx < S && sy < S) moved[y * S + x] = out[sy * S + sx];
    }
    out = moved;
  }
  if (cover) for (let y = cover[1]; y < cover[3]; y++) for (let x = cover[0]; x < cover[2]; x++) out[y * S + x] = 200;
  return out;
}

test('girar o quadrado: quatro quartos voltam ao começo, um quarto é horário', () => {
  const img = new Float32Array(9).map((_, i) => i); // 0 1 2 / 3 4 5 / 6 7 8
  assert.deepEqual([...rotateSquare(img, 3, 1)], [6, 3, 0, 7, 4, 1, 8, 5, 2]); // horário
  assert.deepEqual([...rotateSquare(rotateSquare(img, 3, 1), 3, 3)], [...img]);
  assert.deepEqual([...rotateSquare(img, 3, 4)], [...img]);
});

test('acha para que lado a carta foi virada, mesmo escorregando um pouco', () => {
  const ref = cardImage();
  assert.equal(matchTurn(ref, cardImage(), S).turn, 0);
  assert.equal(matchTurn(ref, cardImage({ turn: 90 }), S).turn, 90);
  assert.equal(matchTurn(ref, cardImage({ turn: -90 }), S).turn, -90);
  assert.equal(matchTurn(ref, cardImage({ turn: 180 }), S).turn, 180);
  const slid = matchTurn(ref, cardImage({ turn: 90, dx: 4, dy: -3 }), S);
  assert.equal(slid.turn, 90);
  assert.ok(slid.best > 0.6, `correlação ${slid.best}`);
  // Centro estimado 2 cm ao lado do centro real: virar gira em volta do centro real.
  const offRef = cardImage({ dx: 12 });
  for (const turn of [90, -90]) {
    const m = matchTurn(offRef, cardImage({ turn, dx: 12 }), S);
    assert.equal(m.turn, turn, `${turn}: ${m.scores.map((x) => x.toFixed(2))}`);
  }
});

test('vigia: vira na hora (2 leituras), desvira, e mão na frente não muda nada', () => {
  const t = new TurnTracker();
  assert.deepEqual(t.update(cardImage(), S, 0), { turn: null, present: null }); // referência
  assert.equal(t.update(cardImage(), S, 0.25).present, true);
  assert.equal(t.update(cardImage({ turn: 90 }), S, 0.5).turn, null); // 1ª vez: espera confirmar
  assert.equal(t.update(cardImage({ turn: 90 }), S, 0.75).turn, 90); // virou
  assert.equal(t.update(cardImage({ turn: 90 }), S, 1).turn, null); // continua virada: sem novo evento
  t.update(cardImage(), S, 1.25);
  assert.equal(t.update(cardImage(), S, 1.5).turn, 0); // desvirou
  // Para o outro lado.
  t.update(cardImage({ turn: -90 }), S, 1.75);
  assert.equal(t.update(cardImage({ turn: -90 }), S, 2).turn, -90);
  // Uma leitura só, de passagem, não vira nada.
  const u = new TurnTracker();
  u.update(cardImage(), S, 0);
  u.update(cardImage({ turn: 90 }), S, 0.25);
  assert.equal(u.update(cardImage(), S, 0.5).turn, null);
  assert.equal(u.turn, 0);
});

test('vigia: carta tirada ou coberta por muito tempo some; de passagem, não', () => {
  const t = new TurnTracker({ goneAfter: 4 });
  t.update(cardImage(), S, 0);
  const empty = new Float32Array(S * S).fill(70).map((v, i) => v + ((i * 7) % 13)); // só mesa
  assert.equal(t.update(empty, S, 1).present, null);
  assert.equal(t.update(empty, S, 3).present, null);
  assert.equal(t.update(empty, S, 5.1).present, false);
  assert.equal(t.update(cardImage(), S, 6).present, true); // voltou
  assert.equal(t.turn, 0);
  // Um casamento fraco ocasional (ruído) não zera a contagem.
  const u = new TurnTracker({ goneAfter: 4 });
  u.update(cardImage(), S, 0);
  u.update(empty, S, 1);
  const half = cardImage({ cover: [0, 0, S, 46] }); // carta quase toda coberta: casa pouco
  u.update(half, S, 2.5);
  assert.equal(u.update(empty, S, 5.2).present, false);
});

test('recorte da vista de cima centrado na carta, no giro dela', () => {
  const half = PATCH_SIZE / 2;
  const v = patchView({ x: 0.1, y: -0.2 }, 0);
  assert.equal(v.w, Math.round(PATCH_RES * PATCH_SIZE));
  const c = v.toTable(v.w / 2, v.h / 2);
  assert.ok(near(c.x, 0.1) && near(c.y, -0.2));
  const top = v.toTable(v.w / 2, 0); // alto do recorte = topo da carta
  assert.ok(near(top.y, -0.2 + half, 1e-9));
  const r = patchView({ x: 0, y: 0 }, 90).toTable(v.w / 2, 0); // carta com o topo para a direita
  assert.ok(near(r.x, half, 1e-9) && near(r.y, 0, 1e-9));
});
