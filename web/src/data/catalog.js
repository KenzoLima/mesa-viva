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
    return (this.byName.get(normalizeName(name)) ?? []).map((id) => this.byId.get(id)).filter(Boolean);
  }

  /** Busca por prefixo, para o campo de pesquisa. */
  search(text, limit = 20) {
    const key = normalizeName(text);
    if (!key) return [];
    const out = [];
    for (const [name, ids] of this.byName) {
      if (!name.includes(key)) continue;
      for (const id of ids) if (!out.includes(id)) out.push(id);
      if (out.length >= limit) break;
    }
    return out.map((id) => this.byId.get(id));
  }

  static async load(baseUrl = 'data/') {
    const [cards, names] = await Promise.all([
      fetch(`${baseUrl}cards.tsv`).then((r) => r.text()),
      fetch(`${baseUrl}names.tsv`).then((r) => (r.ok ? r.text() : '')),
    ]);
    return new CardCatalog(cards, names);
  }
}
