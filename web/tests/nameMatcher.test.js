import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CardCatalog } from '../src/data/catalog.js';
import { NameMatcher } from '../src/recognition/nameMatcher.js';

const catalog = new CardCatalog(
  readFileSync(new URL('../public/data/cards.tsv', import.meta.url), 'utf8'),
  readFileSync(new URL('../public/data/names.tsv', import.meta.url), 'utf8'),
);
const matcher = new NameMatcher(catalog);
const name = (t) => matcher.match(t)?.card.name ?? null;

test('nome exato e com erros de OCR', () => {
  assert.equal(name('Shivan Dragon'), 'Shivan Dragon');
  assert.equal(name('Shivan Dragcn'), 'Shivan Dragon');
  assert.equal(name('LIanowar EIves'), 'Llanowar Elves');
});

test('nome em português', () => {
  assert.equal(name('Dragão Viashivano'), 'Viashivan Dragon');
  assert.equal(name('Dragao Viashlvano'), 'Viashivan Dragon');
});

test('lixo não vira carta', () => {
  assert.equal(name('~ ® 4 ¥'), null);
  assert.equal(name('the of and'), null);
});
