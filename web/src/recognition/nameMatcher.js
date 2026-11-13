// Acha a carta do catálogo a partir de um texto lido por OCR (com erros de leitura).
// Índice de trigramas para achar candidatos rápido + distância de Levenshtein para decidir.
// Funciona com o catálogo inteiro (inglês e português), sem cadastrar carta nenhuma.

import { normalizeName } from '../data/textNorm.js';

const clean = (s) => normalizeName(s).replace(/[^a-z0-9' ,-]/g, ' ').replace(/\s+/g, ' ').trim();

function trigrams(s) {
  const p = `  ${s} `;
  const out = new Set();
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  return out;
}

export function levenshtein(a, b, max = Infinity) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export class NameMatcher {
  /** catalog: CardCatalog (usa byName: nome normalizado -> [oracle_id]). */
  constructor(catalog) {
    this.catalog = catalog;
    this.names = [];
    this.index = new Map();
    for (const name of catalog.byName.keys()) {
      const key = clean(name);
      if (key.length < 3) continue;
      const id = this.names.push(key) - 1;
      for (const g of trigrams(key)) {
        let list = this.index.get(g);
        if (!list) this.index.set(g, (list = []));
        list.push(id);
      }
    }
  }

  /** Melhor carta para o texto, ou null. Retorna { card, score } (score 0..1). */
  match(text, minScore = 0.78) {
    const q = clean(text);
    if (q.replace(/[^a-z]/g, '').length < 4) return null;
    const exact = this.catalog.lookup(q)[0];
    if (exact) return { card: exact, score: 1 };

    const grams = trigrams(q);
    const hits = new Map();
    for (const g of grams) for (const id of this.index.get(g) ?? []) hits.set(id, (hits.get(id) ?? 0) + 1);
    const candidates = [...hits].filter(([, n]) => n >= grams.size * 0.4)
      .sort((a, b) => b[1] - a[1]).slice(0, 40);

    let best = null;
    for (const [id] of candidates) {
      const name = this.names[id];
      const len = Math.max(name.length, q.length);
      const d = levenshtein(q, name, Math.floor(len * (1 - minScore)));
      const score = 1 - d / len;
      if (score >= minScore && (!best || score > best.score)) best = { name, score };
    }
    if (!best) return null;
    const card = this.catalog.lookup(best.name)[0];
    return card ? { card, score: best.score } : null;
  }
}
