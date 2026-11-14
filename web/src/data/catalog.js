// Leitor do catálogo do app (cards.tsv + names.tsv), o mesmo que o CardCatalog.cs do Unity lê.
// Os arquivos vêm de ml/scripts/export_app_catalog.py e são copiados por tools/sync_web_data.py.

import { normalizeName } from './textNorm.js';

const list = (v) => (v ? v.split('|').filter(Boolean) : []);

/** Lê um TSV do catálogo: ignora linhas "#", a primeira linha restante é o cabeçalho. */
export function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const header = lines.shift()?.split('\t') ?? [];
  return lines.map((line) => {
    const cols = line.split('\t');
    return Object.fromEntries(header.map((h, i) => [h, cols[i] ?? '']));
  });
}

export class Card {
  constructor(row) {
    this.oracleId = row.oracle_id;
    this.name = row.name;
    this.layout = row.layout;
    this.isToken = row.is_token === '1';
    this.typeLine = row.type_line;
    this.cardTypes = list(row.card_types);
    this.subtypes = list(row.subtypes);
    this.colors = list(row.colors);
    this.power = row.power === '' ? null : row.power;
    this.toughness = row.toughness === '' ? null : row.toughness;
    this.keywords = list(row.keywords);
    this.producedMana = list(row.produced_mana);
    this.displayName = row.name;
  }

  hasType(type) {
    return this.cardTypes.includes(type);
  }
}

export class CardCatalog {
  constructor(cardsTsv, namesTsv = '') {
    this.byId = new Map();
    this.byName = new Map(); // nome normalizado -> [oracle_id]
    for (const row of parseTsv(cardsTsv)) {
      const card = new Card(row);
      this.byId.set(card.oracleId, card);
      this.#index(normalizeName(card.name), card.oracleId);
      // "Delver of Secrets // Insectile Aberration" também acha por "Delver of Secrets".
      for (const face of card.name.split(' // ')) this.#index(normalizeName(face), card.oracleId);
    }
    for (const row of parseTsv(namesTsv)) {
      this.#index(row.norm_name, row.oracle_id);
      const card = this.byId.get(row.oracle_id);
      if (card && row.lang === 'pt' && card.displayName === card.name) card.displayName = row.display_name;
    }
  }

  #index(key, id) {
    if (!key) return;
    const ids = this.byName.get(key) ?? [];
    if (!ids.includes(id)) ids.push(id);
    this.byName.set(key, ids);
  }

  get size() {
    return this.byId.size;
  }

  get(oracleId) {
    return this.byId.get(oracleId) ?? null;
  }

  /** Cartas com esse nome (inglês ou português, com ou sem acento). */
  lookup(name) {
    const key = normalizeName(name);
    // Com o catálogo inteiro um nome pode bater em várias cartas: o nome oficial vem antes de faces e traduções.
    const rank = (card) => {
      if (normalizeName(card.name) === key) return 0;
      if (card.name.split(' // ').some((f) => normalizeName(f) === key)) return 1;
      return 2;
    };
    return (this.byName.get(key) ?? [])
      .map((id) => this.byId.get(id))
      .filter(Boolean)
      .sort((a, b) => rank(a) - rank(b));
  }

  /**
   * Busca para o campo de pesquisa (inglês ou português), da mais para a menos parecida:
   * nome exato, nome que começa com o texto, palavra do nome que começa com o texto, texto no meio.
   * Dentro do mesmo nível, o nome mais curto primeiro. "bolt": Boltwave e Boltfire (começam com o
   * texto), depois Lightning Bolt (palavra do nome), depois Electro's Bolt… e só então Thunderbolt.
   */
  search(text, limit = 20) {
    const key = normalizeName(text);
    if (!key) return [];
    const best = new Map(); // oracleId -> [nível, tamanho do nome]
    const wordStart = ` ${key}`;
    for (const [name, ids] of this.byName) {
      const at = name.indexOf(key);
      if (at < 0) continue;
      let rank = 3;
      if (name === key) rank = 0;
      else if (at === 0) rank = 1;
      else if (name.includes(wordStart)) rank = 2;
      for (const id of ids) {
        const prev = best.get(id);
        if (!prev || rank < prev[0] || (rank === prev[0] && name.length < prev[1])) best.set(id, [rank, name.length]);
      }
    }
    // Empate: o nome completo mais curto ("Lightning Bolt" antes de "Emeritus of Conflict // Lightning Bolt").
    const full = (id) => this.byId.get(id)?.name.length ?? 0;
    return [...best]
      .sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1] || full(a[0]) - full(b[0]))
      .slice(0, limit)
      .map(([id]) => this.byId.get(id))
      .filter(Boolean);
  }

  static async load(baseUrl = 'data/') {
    const [cards, names] = await Promise.all([
      fetch(`${baseUrl}cards.tsv`).then((r) => r.text()),
      fetch(`${baseUrl}names.tsv`).then((r) => (r.ok ? r.text() : '')),
    ]);
    return new CardCatalog(cards, names);
  }
}
