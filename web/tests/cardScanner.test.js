import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  looksLikeTypeLine, nameBarFromTypeLine, heightFraction, splitByGaps, typeSimilarity, typeGuidedMatch, RES,
} from '../src/table/cardScanner.js';
import { NameMatcher } from '../src/recognition/nameMatcher.js';
import { CardCatalog } from '../src/data/catalog.js';
import { CARD_H } from '../src/table/tableCards.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// Catálogo pequeno com as cartas da foto real e algumas parecidas.
const COLS = ['oracle_id', 'name', 'layout', 'is_token', 'type_line', 'card_types', 'subtypes', 'colors', 'power', 'toughness', 'keywords', 'produced_mana'];
const rows = [
  ['a', 'Aurelia, the Warleader', 'normal', '0', 'Legendary Creature — Angel', 'Creature', 'Angel', 'R|W', '3', '4', 'Flying', ''],
  ['l', 'Lathliss, Dragon Queen', 'normal', '0', 'Legendary Creature — Dragon', 'Creature', 'Dragon', 'R', '6', '6', 'Flying', ''],
  ['c', 'Cremate', 'normal', '0', 'Instant', 'Instant', '', 'B', '', '', '', ''],
  ['d', 'Dragon', 'token', '1', 'Token Creature — Dragon', 'Creature', 'Dragon', 'R', '5', '5', 'Flying', ''],
  ['s', 'Lathliss Kin', 'normal', '0', 'Creature — Elf', 'Creature', 'Elf', 'G', '1', '1', '', ''],
];
const tsv = [COLS.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n');
const matcher = new NameMatcher(new CardCatalog(tsv));

/** Linha do OCR com palavras em x crescente (largura proporcional ao texto). */
function ocrLine(parts, y = 100, h = 14) {
  let x = 10;
  const words = [];
  for (const p of parts) {
    if (p === '  ') { x += 80; continue; }
    const w = p.length * 8;
    words.push({ text: p, bbox: { x0: x, y0: y, x1: x + w, y1: y + h }, confidence: 80 });
    x += w + 6;
  }
  return { text: parts.join(' '), words, confidence: 80, bbox: { x0: 10, y0: y, x1: x, y1: y + h } };
}

test('linha de tipo, mesmo mal lida; texto de regras não', () => {
  assert.ok(looksLikeTypeLine('Legecodacy Croature — Angel'));
  assert.ok(looksLikeTypeLine('Legendary Creacure — Dragon'));
  assert.ok(looksLikeTypeLine('Instant'));
  assert.ok(looksLikeTypeLine('Criatura Lendária — Anjo'));
  assert.ok(!looksLikeTypeLine('fiel control entes, create à 5/5 red')); // "create" sem travessão
  assert.ok(!looksLikeTypeLine('Lathliss, Dragon Queen'));
});

test('a faixa do nome fica ~50% da carta acima da linha de tipo', () => {
  const type = { x0: 100, y0: 300, x1: 260, y1: 314 };
  const r = nameBarFromTypeLine(type, RES);
  const cy = (r.y0 + r.y1) / 2;
  assert.ok(near(307 - cy, 0.505 * CARD_H * RES, 1e-6));
  assert.ok(r.x0 < 100 && r.x1 > 100 + 0.05 * RES);
});

test('onde o texto fica na carta (fração da altura a partir do topo)', () => {
  const card = { center: { x: 0, y: 0 }, up: { x: 0, y: 1 } };
  assert.ok(near(heightFraction({ x: 0, y: CARD_H / 2 }, card), 0));
  assert.ok(near(heightFraction({ x: 0, y: 0 }, card), 0.5));
  assert.ok(near(heightFraction({ x: 0, y: -0.2 * CARD_H }, card), 0.7)); // texto de regras
  const turned = { center: { x: 0, y: 0 }, up: { x: 1, y: 0 } };
  assert.ok(near(heightFraction({ x: CARD_H / 2, y: 0 }, turned), 0));
});

test('separa duas linhas de tipo vizinhas que o OCR juntou', () => {
  const merged = ocrLine(['Legecodacy', 'Croature', '—', 'Angel', '  ', 'Legendary', 'Creacure', '—', 'Dragon']);
  const parts = splitByGaps(merged);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].text, 'Legecodacy Croature — Angel');
  assert.equal(parts[1].text, 'Legendary Creacure — Dragon');
  assert.ok(parts[1].bbox.x0 > parts[0].bbox.x1);
});

test('nome só parecido vale quando a linha de tipo também bate', () => {
  assert.ok(typeSimilarity('Legendary Creature — Dragon', 'Legendary Creacure — Dragon') > 0.9);
  assert.ok(typeSimilarity('Legendary Creature — Dragon', 'Legecodacy Croature — Angel') < 0.85);
  // "Clarhiis. Dragon Quena" (5 px/mm) + tipo de dragão → Lathliss.
  const m = typeGuidedMatch(matcher, [ocrLine(['Clarhiis.', 'Dragon', 'Quena'])], 'Legendary Creacure — Dragon');
  assert.equal(m?.card.name, 'Lathliss, Dragon Queen');
  assert.equal(m.anchor, 'title');
  // O mesmo nome com a linha de tipo de outra carta (anjo): não aceita.
  assert.equal(typeGuidedMatch(matcher, [ocrLine(['Clarhiis.', 'Dragon', 'Quena'])], 'Legendary Creature — Angel'), null);
  // "Aurcelia, e Warleador" + tipo de anjo → Aurelia.
  assert.equal(typeGuidedMatch(matcher, [ocrLine(['Aurcelia,', 'e', 'Warleador', '229248'])], 'Legecodacy Croature — Angel')?.card.name, 'Aurelia, the Warleader');
  // Lixo não vira carta.
  assert.equal(typeGuidedMatch(matcher, [ocrLine(['Fem', 'q', 'por', '"o', 'A'])], 'Legendary Creacure — Dragon'), null);
});

test('mesa maior vira mais blocos; bloco com só um canto à vista entra', async () => {
  const { planScans } = await import('../src/table/tableCards.js');
  const { TableFrame } = await import('../src/table/tableFrame.js');
  const small = new TableFrame({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }).scaled(1);
  const big = small.scaled(1.6); // 96 × 112 cm
  const up = (jobs) => jobs.filter((j) => !j.tapped);
  assert.equal(up(planScans(small)).length, 8);
  assert.ok(up(planScans(big)).length > 8);
  for (const j of up(planScans(big))) {
    assert.ok(j.region.x1 - j.region.x0 <= 0.32 + 1e-9 && j.region.y1 - j.region.y0 <= 0.2 + 1e-9);
  }
  // Só a borda de baixo (seu lado) aparece: os blocos de baixo entram mesmo com o centro fora.
  const visibleBottomEdge = (p) => p.y <= -0.34;
  const jobs = up(planScans(small, visibleBottomEdge));
  assert.ok(jobs.length > 0 && jobs.every((j) => j.owner === 'you'));
});

test('bloco parado é pulado; carta nova ou tempo demais faz ler de novo', async () => {
  const { signatureChange } = await import('../src/table/cardScanner.js');
  const { BlockMemory } = await import('../src/table/tableCards.js');
  let seed = 9;
  const table = new Float32Array(200 * 150).map(() => { seed = (seed * 16807) % 2147483647; return 60 + (seed % 40); });
  const noisy = table.map((v, i) => v + ((i * 13) % 3) - 1); // ruído do sensor
  const brighter = table.map((v) => v + 20); // acenderam a luz
  const withCard = table.map((v, i) => ((i % 200) > 90 && (i % 200) < 122 && i / 200 > 50 && i / 200 < 94 ? 220 : v)); // carta de 63 × 88 mm
  assert.ok(signatureChange(table, noisy) < 1.5);
  assert.ok(signatureChange(table, brighter) < 1.5);
  assert.ok(signatureChange(table, withCard) > 1.5, `${signatureChange(table, withCard)}`);

  const mem = new BlockMemory({ maxAge: 60, retry: 8 });
  const job = { region: { x0: -0.3, x1: 0, y0: -0.2, y1: 0 }, up: 0 };
  assert.ok(mem.needsRead(job, table, 0, signatureChange)); // nunca lido
  mem.remember(job, table, 0);
  assert.ok(!mem.needsRead(job, noisy, 10, signatureChange)); // parado: pula
  assert.ok(mem.needsRead(job, withCard, 11, signatureChange)); // carta nova: lê
  assert.ok(mem.needsRead(job, noisy, 61, signatureChange)); // muito tempo: lê de novo
  assert.ok(mem.needsRead({ ...job, up: 90 }, noisy, 12, signatureChange)); // outro giro é outro bloco
  mem.clear();
  assert.ok(mem.needsRead(job, noisy, 13, signatureChange));
});

test('bloco com linha de tipo sem nome volta logo para a fila', async () => {
  const { BlockMemory } = await import('../src/table/tableCards.js');
  const mem = new BlockMemory({ maxAge: 30, retry: 8 });
  const job = { region: { x0: 0, x1: 0.3, y0: -0.2, y1: 0 }, up: 0 };
  const sig = new Float32Array(10).fill(80);
  const same = () => 0;
  mem.remember(job, sig, 0, true);
  assert.ok(!mem.needsRead(job, sig, 5, same));
  assert.ok(mem.needsRead(job, sig, 8.5, same)); // incompleto: relê em 8 s
  mem.remember(job, sig, 10, false);
  assert.ok(!mem.needsRead(job, sig, 30, same));
  assert.ok(mem.needsRead(job, sig, 40.5, same)); // parado e completo: 30 s
});
