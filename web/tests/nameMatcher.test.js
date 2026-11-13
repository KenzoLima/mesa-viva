import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CardCatalog } from '../src/data/catalog.js';
import { NameMatcher, findCardsInLine } from '../src/recognition/nameMatcher.js';

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

// Linha do OCR a partir de palavras: [texto, x0, x1] (altura 20, confiança alta).
const line = (...ws) => ({
  words: ws.map(([text, x0, x1, confidence = 90]) => ({ text, confidence, bbox: { x0, y0: 100, x1, y1: 120 } })),
});
const found = (l) => findCardsInLine(matcher, l).map((m) => `${m.anchor}:${m.card.name}${m.card.isToken ? '*' : ''}`);

test('linha com lixo em volta do nome', () => {
  assert.deepEqual(found(line(['Il', 0, 10, 40], ['Llanowar', 16, 90], ['Elves', 96, 140], ['e', 150, 155, 30], ['|', 160, 162, 20])),
    ['title:Llanowar Elves']);
  const m = findCardsInLine(matcher, line(['[(', 0, 8, 30], ['Shivan', 12, 70], ['Dragon', 76, 140], ['422)', 150, 180, 40]))[0];
  assert.equal(m.card.name, 'Shivan Dragon');
  assert.deepEqual(m.bbox, { x0: 12, y0: 100, x1: 140, y1: 120 }); // caixa só do nome
});

test('duas cartas lado a lado na mesma linha do OCR', () => {
  assert.deepEqual(found(line(['|', 0, 4, 30], ['GOBLIN', 10, 80], ['E', 300, 306, 40], ['ZOMBIE', 312, 390], ['|', 395, 398, 30])),
    ['title:Goblin*', 'title:Zombie*']);
  assert.deepEqual(found(line(['Shivan', 0, 60], ['Dragon', 66, 130], ['Serra', 400, 450], ['Angel', 456, 510])),
    ['title:Shivan Dragon', 'title:Serra Angel']);
});

test('token pela linha de tipo (inglês e português)', () => {
  assert.deepEqual(found(line(['Token', 0, 50], ['Creature', 56, 130], ['—', 136, 150], ['Goblin', 156, 210])), ['type:Goblin*']);
  assert.deepEqual(found(line(['Token', 0, 50], ['Creature', 56, 130], ['—', 136, 150], ['Elf', 156, 180], ['Warrior', 186, 250])),
    ['type:Elf Warrior*']);
  assert.deepEqual(found(line(['Ficha', 0, 50], ['de', 56, 70], ['Criatura', 76, 140], ['—', 146, 160], ['Zombie', 166, 220])),
    ['type:Zombie*']);
  assert.deepEqual(found(line(['Tokem', 0, 50], ['Artifact', 56, 130], ['—', 136, 150], ['Treasure', 156, 230])), ['type:Treasure*']);
});

test('linha de tipo e texto de regras de carta normal não viram carta', () => {
  assert.deepEqual(found(line(['Creature', 0, 70], ['—', 76, 90], ['Elf', 96, 120], ['Druid', 126, 170])), []);
  assert.deepEqual(found(line(['Creature', 0, 70], ['—', 76, 90], ['Goblin', 96, 150], ['Scout', 156, 200])), []);
  assert.deepEqual(found(line(['O:', 0, 20], ['Shivan', 26, 80], ['Dragon', 86, 140], ['gets', 146, 180], ['+1/+0', 186, 230], ['until', 236, 270])), []);
});

test('pedaço de nome colado em outra palavra não vale', () => {
  // "Serra Ape…" (Serra Angel mal lido) não pode virar a carta "Serra".
  assert.deepEqual(found(line(['HES', 0, 30, 40], ['La', 36, 50, 40], ['Serra', 70, 120], ['Ape', 126, 160], ['=', 180, 185, 20])), []);
});

test('leitura parcial não vira outra carta', () => {
  // Do vídeo: "( GOBLIN — BLIN md | Llanowar E 2)" com dois tokens Goblin e um Llanowar Elves.
  assert.equal(name('BLIN'), null);
  assert.deepEqual(found(line(['Llanowar', 0, 80], ['E', 86, 96, 60], ['2)', 120, 135, 30])), []);
});

test('nome curto de token só com leitura boa', () => {
  assert.deepEqual(found(line(['ELF', 0, 40, 92])), ['title:Elf*']);
  assert.deepEqual(found(line(['ELF', 0, 40, 60])), []);
});
