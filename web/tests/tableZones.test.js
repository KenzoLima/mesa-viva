// Zonas desenhadas na mesa (grimório, cemitério, exílio, terrenos, campo de batalha).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneLayout } from '../src/table/tableVisuals.js';
import { DEFAULT_WIDTH, DEFAULT_DEPTH } from '../src/table/tableFrame.js';

const overlap = (a, b) => a.x0 < b.x1 - 1e-9 && b.x0 < a.x1 - 1e-9 && a.y0 < b.y1 - 1e-9 && b.y0 < a.y1 - 1e-9;

for (const k of [0.5, 1, 1.6]) {
  test(`mesa ${k}×: cinco zonas de cada lado, dentro da mesa, sem se sobrepor`, () => {
    const w = DEFAULT_WIDTH * k;
    const d = DEFAULT_DEPTH * k;
    const zones = zoneLayout(w, d);
    for (const side of ['you', 'opponent']) {
      const mine = zones.filter((z) => z.side === side);
      assert.deepEqual(mine.map((z) => z.name).sort(), ['battlefield', 'exile', 'graveyard', 'lands', 'library']);
      for (const z of mine) {
        assert.ok(z.x0 >= -w / 2 && z.x1 <= w / 2, `${side} ${z.name} cabe na largura`);
        // Cada jogador só usa a metade dele (y < 0 é o seu lado).
        if (side === 'you') assert.ok(z.y0 >= -d / 2 && z.y1 <= 0, `${z.name} na sua metade`);
        else assert.ok(z.y0 >= 0 && z.y1 <= d / 2, `${z.name} na metade do oponente`);
      }
    }
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) assert.ok(!overlap(zones[i], zones[j]), `${zones[i].name}/${zones[j].name}`);
    }
  });
}

test('grimório à direita de cada jogador e perto dele; o do oponente espelhado, texto virado', () => {
  const zones = zoneLayout(DEFAULT_WIDTH, DEFAULT_DEPTH);
  const lib = (side) => zones.find((z) => z.side === side && z.name === 'library');
  const grave = (side) => zones.find((z) => z.side === side && z.name === 'graveyard');
  assert.ok(lib('you').x0 > 0 && lib('opponent').x1 < 0, 'direita de cada um');
  assert.ok(lib('you').y0 < grave('you').y0, 'seu grimório mais perto de você que o cemitério');
  assert.ok(lib('opponent').y1 > grave('opponent').y1, 'o do oponente mais perto dele');
  assert.equal(lib('you').turn, 0);
  assert.equal(lib('opponent').turn, Math.PI);
  // Do tamanho de uma carta (63 × 88 mm) com folga, na mesa padrão.
  const z = lib('you');
  assert.ok(z.x1 - z.x0 >= 0.063 && z.y1 - z.y0 >= 0.088);
});
