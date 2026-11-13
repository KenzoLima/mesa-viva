// Espelha ml/tests/test_model_resolver.py e test_text_and_types.py: o JS tem que decidir igual ao Python e ao C#.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CardCatalog } from '../src/data/catalog.js';
import { ModelResolver, CREATURE, TERRAIN, PROP, SPELL } from '../src/data/modelResolver.js';
import { normalizeName } from '../src/data/textNorm.js';

const read = (f) => readFileSync(new URL(`../public/data/${f}`, import.meta.url), 'utf8');
const catalog = new CardCatalog(read('cards.tsv'), read('names.tsv'));
const map = JSON.parse(read('model_map.json'));
const resolver = new ModelResolver(map);
const pick = (name, r = resolver) => r.resolve(catalog.lookup(name)[0]);

test('normalização igual à do Python', () => {
  assert.equal(normalizeName('Æther  Vial'), 'aether vial');
  assert.equal(normalizeName('Jötun Grunt'), 'jotun grunt');
  assert.equal(normalizeName('Fire/Ice'), 'fire // ice');
  assert.equal(normalizeName('Urza’s Tower'), "urza's tower");
  assert.equal(normalizeName(''), '');
});

test('catálogo acha por nome, face e português', () => {
  assert.ok(catalog.size > 10);
  assert.equal(catalog.lookup('delver of secrets')[0].name, 'Delver of Secrets // Insectile Aberration');
  assert.equal(catalog.lookup('Elfos de Llanowar')[0].name, 'Llanowar Elves');
  assert.equal(catalog.lookup('Lightning Bolt')[0].typeLine, 'Instant'); // nome oficial antes de faces de outras cartas
  assert.equal(catalog.lookup('JOTUN GRUNT').length, 1);
});

for (const [name, model, reason] of [
  ['Llanowar Elves', 'bestiary/elf_warrior', 'subtipo Elf'],
  ['Goblin Guide', 'bestiary/goblin_warrior', 'subtipo Goblin'],
  ['Delver of Secrets', 'human', 'subtipo Human'],
  ['Jötun Grunt', 'giant', 'subtipo Giant'],
  ['Grizzly Bears', 'beast', 'família beast (Bear)'],
  ['Progenitus', 'lizard', 'família reptile (Hydra)'],
  ['Ornithopter', 'winged', 'habilidade Flying'],
  ['Myr Enforcer', 'golem', 'tipo Artifact'],
  ['Tarmogoyf', 'elemental', 'cor G (genérico)'],
  ['Dryad Arbor', 'elemental', 'cor G (genérico)'],
]) {
  test(`criatura: ${name} -> ${model}`, () => {
    const c = pick(name);
    assert.deepEqual([c.modelId, c.kind, c.reason], [model, CREATURE, reason]);
  });
}

test('override da carta e do usuário vencem', () => {
  const elves = catalog.lookup('Llanowar Elves')[0];
  const hero = new ModelResolver({ ...map, byOracleId: { [elves.oracleId]: 'elf_hero' } });
  assert.equal(hero.resolve(elves).modelId, 'elf_hero');
  const user = new ModelResolver({ ...map, byOracleId: { [elves.oracleId]: 'elf_hero' } }, { [elves.oracleId]: 'my_elf' });
  assert.equal(user.resolve(elves).modelId, 'my_elf');
  assert.equal(user.resolve(elves).reason, 'escolha do usuário');
});

for (const [power, scale] of [['0', 0.8], ['1', 0.8], ['4', 1.2], ['7', 1.6], ['10', 1.6], ['*', 1.0], [null, 1.0], ['1+*', 1.0]]) {
  test(`escala pelo poder ${power}`, () => assert.ok(Math.abs(resolver.scaleForPower(power) - scale) < 1e-9));
}

test('terrenos', () => {
  const forest = pick('Forest');
  assert.deepEqual([forest.modelId, forest.kind, forest.terrainMix], ['terrain_forest', TERRAIN, ['terrain_forest']]);
  const pool = pick('Breeding Pool');
  assert.deepEqual(pool.terrainMix, ['terrain_forest', 'terrain_water']);
  assert.equal(pool.reason, 'tipo básico');
  assert.equal(pick('Wastes').modelId, map.lands.default);
});

test('mágicas e outros permanentes', () => {
  assert.deepEqual([pick('Lightning Bolt').modelId, pick('Lightning Bolt').kind], ['vfx_fire', SPELL]);
  assert.equal(pick('Fire // Ice').modelId, 'vfx_prism');
  assert.deepEqual([pick('Sol Ring').modelId, pick('Sol Ring').kind], ['prop_artifact', PROP]);
  assert.equal(pick('Liliana of the Veil').modelId, 'hero_planeswalker');
});
