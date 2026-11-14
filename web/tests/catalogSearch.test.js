// Busca da Biblioteca: a carta mais parecida com o que foi digitado vem primeiro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CardCatalog } from '../src/data/catalog.js';

const read = (f) => readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8');
const catalog = new CardCatalog(read('cards.tsv'), read('names.tsv'));
const names = (q, n = 20) => catalog.search(q, n).map((c) => c.name);

test('nome exato vem primeiro, em inglês ou português', () => {
  assert.equal(names('Lightning Bolt')[0], 'Lightning Bolt');
  assert.equal(names('raio')[0], 'Lightning Bolt'); // "Raio" é o nome em português
  assert.equal(names('elfos de llanowar')[0], 'Llanowar Elves');
});

test('nome que começa com o texto antes do texto no meio de uma palavra', () => {
  const r = names('bolt', 40);
  assert.ok(r.indexOf('Lightning Bolt') >= 0, 'Lightning Bolt aparece');
  const firstMiddle = r.findIndex((n) => !/(^|[\s'-])bolt/i.test(n));
  if (firstMiddle >= 0) assert.ok(r.indexOf('Lightning Bolt') < firstMiddle, 'palavra inteira antes de pedaço de palavra');
  assert.ok(/^bolt/i.test(r[0]), `o primeiro começa com "bolt" (${r[0]})`);
});

test('uma letra só não começa com nomes de pontuação', () => {
  assert.ok(!names('a')[0].startsWith('"'));
});

test('sem resultado e texto vazio', () => {
  assert.deepEqual(catalog.search('xyzqw'), []);
  assert.deepEqual(catalog.search('  '), []);
});
