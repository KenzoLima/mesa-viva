// Acha a carta do catálogo a partir de um texto lido por OCR (com erros de leitura).
// Índice de trigramas para achar candidatos rápido + distância de Levenshtein para decidir.
// Funciona com o catálogo inteiro (inglês e português), sem cadastrar carta nenhuma.
//
// findCardsInLine: acha os nomes dentro de UMA linha do OCR, usando as palavras (com caixa de cada uma).
// O OCR junta na mesma linha o texto de cartas lado a lado ("GOBLIN  E ZOMBIE"), então não dá para
// usar a linha inteira: separa por espaços grandes, aceita lixo curto em volta do nome (custo de mana,
// borda da carta) e devolve a caixa só das palavras do nome.
// Tokens: o nome fica no topo (em versalete) e também na linha de tipo ("Token Creature — Goblin");
// quando o nome do topo não sai, a linha de tipo identifica o token.

import { normalizeName } from '../data/textNorm.js';

const clean = (s) => normalizeName(s).replace(/[^a-z0-9' ,-]/g, ' ').replace(/\s+/g, ' ').trim();
const letters = (s) => clean(s).replace(/[^a-z]/g, '');

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

const isToken = (card) => card.isToken;

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
    this.sorted = [...new Set(this.names)].sort();
  }

  /** Existe nome de carta MAIOR que começa com este texto? ("llanowar e" -> "llanowar elves") */
  hasLongerName(prefix) {
    const a = this.sorted;
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid] < prefix) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < a.length && a[i].startsWith(prefix); i++) if (a[i].length > prefix.length) return true;
    return false;
  }

  /**
   * Carta com esse nome exato (normalizado). Entre várias com o mesmo nome (tokens têm muitas
   * versões), fica com a mais simples: sem habilidades.
   */
  pick(name, filter) {
    const cards = this.catalog.lookup(name).filter(filter ?? (() => true));
    if (cards.length < 2) return cards[0] ?? null;
    const weight = (c) => (c.isToken ? c.keywords.length : 0);
    return cards.map((c, i) => ({ c, i })).sort((a, b) => weight(a.c) - weight(b.c) || a.i - b.i)[0].c;
  }

  /**
   * Melhor carta para o texto, ou null. Retorna { card, score } (score 0..1).
   * filter (opcional): só aceita cartas que passam (ex.: só tokens).
   */
  match(text, { minScore = 0.78, filter } = {}) {
    const q = clean(text);
    if (q.replace(/[^a-z]/g, '').length < 4) return null;
    const exact = this.pick(q, filter);
    if (exact) return { card: exact, score: 1 };
    // Leitura curta só vale exata: "BLIN" (pedaço de "GOBLIN") não pode virar "Blink".
    if (q.replace(/[^a-z]/g, '').length < 6) return null;

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
      if (score < minScore || (best && score <= best.score)) continue;
      const card = this.pick(name, filter);
      if (card) best = { card, score };
    }
    return best;
  }
}

// ---------- nomes dentro de uma linha do OCR ----------

// Palavras da linha de tipo (inglês e português). Uma linha com elas não é nome de carta.
const TYPE_WORDS = ['creature', 'criatura', 'artifact', 'artefato', 'enchantment', 'encantamento', 'legendary',
  'lendario', 'lendaria', 'planeswalker', 'instant', 'sorcery', 'feitico', 'instantanea', 'tribal', 'token', 'ficha',
  'battle', 'batalha', 'kindred'];
const TOKEN_WORDS = ['token', 'ficha'];
const DASH = /^[—–\-~_=]{1,3}$/;

function fuzzyIn(word, list) {
  const w = letters(word);
  if (w.length < 4) return false;
  // Tolerância 1 (2 só em palavra longa): "Treasure" não pode virar "Creature".
  return list.some((t) => levenshtein(w, t, 2) <= (t.length >= 9 ? 2 : 1));
}

/** Palavra que pode ser ignorada em volta do nome: lixo curto, pouco confiável ou sem letras. */
function droppable(w) {
  const n = letters(w.text).length;
  return n <= 3 || (w.confidence ?? 100) < 55;
}

function union(words) {
  return {
    x0: Math.min(...words.map((w) => w.bbox.x0)),
    y0: Math.min(...words.map((w) => w.bbox.y0)),
    x1: Math.max(...words.map((w) => w.bbox.x1)),
    y1: Math.max(...words.map((w) => w.bbox.y1)),
  };
}

/** Separa a linha onde há um espaço grande entre palavras (texto de outra carta ao lado). */
function segments(words) {
  const h = medianHeight(words);
  const out = [[words[0]]];
  for (let i = 1; i < words.length; i++) {
    if (words[i].bbox.x0 - words[i - 1].bbox.x1 > h * 1.2) out.push([]);
    out[out.length - 1].push(words[i]);
  }
  return out;
}

const MAX_NAME_WORDS = 6;

/** Linha de tipo de token: "Token Creature — Goblin" / "Ficha de Criatura — Goblin". */
function tokenFromTypeLine(matcher, seg, typeIdx) {
  const tokenAt = seg.findIndex((w) => fuzzyIn(w.text, TOKEN_WORDS));
  if (tokenAt < 0) return null;
  // O nome vem depois do travessão; se o OCR perdeu o travessão, depois da última palavra de tipo.
  const dash = seg.findIndex((w, i) => i > tokenAt && DASH.test(w.text.trim()));
  let start = dash >= 0 ? dash + 1 : Math.max(...typeIdx) + 1;
  while (start < seg.length && DASH.test(seg[start].text.trim())) start++;
  const rest = seg.slice(start, start + 3);
  for (let n = rest.length; n >= 1; n--) {
    const text = rest.slice(0, n).map((w) => w.text).join(' ');
    const key = clean(text);
    if (key.replace(/[^a-z]/g, '').length < 3) continue;
    const exact = matcher.pick(key, isToken);
    const m = exact ? { card: exact, score: 1 } : matcher.match(text, { minScore: 0.8, filter: isToken });
    if (m) return { ...m, bbox: union(seg.slice(tokenAt, start + n)), anchor: 'type', text, strict: false };
  }
  return null;
}

/**
 * Nomes de carta numa linha do OCR. line = { text, bbox, confidence, words: [{ text, bbox, confidence }] }.
 * Retorna [{ card, score, bbox, anchor, text }]; anchor = 'title' (nome no topo) ou 'type' (linha de tipo).
 */
export function findCardsInLine(matcher, line) {
  let words = (line.words ?? []).filter((w) => w.text?.trim());
  if (!words.length) words = [{ text: line.text ?? '', bbox: line.bbox, confidence: line.confidence }];
  const out = [];
  const cache = new Map();
  const matchSpan = (span) => {
    const text = span.map((w) => w.text).join(' ');
    if (cache.has(text)) return cache.get(text);
    let m = null;
    const n = letters(text).length;
    if (n >= 4) m = matcher.match(text);
    // Nome curto (Elf, Cat, Ape…): só token, com o nome exato e bem lido.
    else if (n === 3 && span.length === 1 && (span[0].confidence ?? 0) >= 80) {
      const card = matcher.pick(clean(text), isToken);
      if (card) m = { card, score: 1 };
    }
    cache.set(text, m);
    return m;
  };

  for (const seg of segments(words)) {
    const typeIdx = seg.map((w, i) => (fuzzyIn(w.text, TYPE_WORDS) ? i : -1)).filter((i) => i >= 0);
    if (typeIdx.length) {
      // Linha de tipo: só serve para token (em carta normal o subtipo não é o nome).
      const t = tokenFromTypeLine(matcher, seg, typeIdx);
      if (t) out.push(t);
      continue;
    }
    // Programação dinâmica: cobre o segmento com nomes e palavras descartáveis; no máximo uma
    // palavra "boa" fica de fora (texto de regras com o nome no meio não vira carta).
    const n = seg.length;
    const memo = new Map();
    const best = (i, skips) => {
      if (i === n) return { score: 0, picks: [] };
      const key = i * 2 + skips;
      if (memo.has(key)) return memo.get(key);
      let r = null;
      const consider = (cand) => {
        if (cand && (!r || cand.score > r.score)) r = cand;
      };
      if (droppable(seg[i])) consider(best(i + 1, skips));
      else if (skips < 1) {
        const s = best(i + 1, skips + 1);
        if (s) consider({ score: s.score - 0.5, picks: s.picks });
      }
      for (let j = i + 1; j <= Math.min(n, i + MAX_NAME_WORDS); j++) {
        const span = seg.slice(i, j);
        const m = matchSpan(span);
        if (!m) continue;
        const rest = best(j, skips);
        if (!rest) continue;
        const text = span.map((w) => w.text).join(' ');
        consider({
          // Pontua pelas letras cobertas, com custo por nome: "Llanowar Elves" vence "Llanowar" + "Elves".
          score: rest.score + m.score * letters(text).length - 2,
          picks: [{ ...m, bbox: union(span), anchor: 'title', text, span }, ...rest.picks],
        });
      }
      memo.set(key, r);
      return r;
    };
    const r = best(0, 0);
    if (!r?.picks.length) continue;
    // Palavra "boa" colada no nome que ficou de fora = o nome é só um pedaço ("Serra" de "Serra Ape…",
    // "Breach" de "reach"): descarta. Lixo do custo de mana fica separado ou não tem letras.
    const h = medianHeight(seg);
    const used = new Set(r.picks.flatMap((p) => p.span));
    const glued = (a, b) => b.bbox.x0 - a.bbox.x1 < h * 0.8;
    // Vale também para outro nome colado: dois nomes de cartas diferentes nunca ficam grudados.
    const solid = (w) => letters(w.text).length >= 3;
    const skipped = seg.some((w) => !used.has(w) && !droppable(w));
    for (const p of r.picks) {
      const first = seg.indexOf(p.span[0]);
      const last = seg.indexOf(p.span[p.span.length - 1]);
      const before = seg[first - 1];
      const after = seg[last + 1];
      if ((before && solid(before) && glued(before, p.span[0])) || (after && solid(after) && glued(p.span[p.span.length - 1], after))) continue;
      // Nome cortado: "Llanowar E…" é o começo de "Llanowar Elves", não a carta "Llanowar". Espera ler melhor.
      if (after && glued(p.span[p.span.length - 1], after)) {
        const tail = letters(after.text);
        if (tail && matcher.hasLongerName(`${clean(p.text)} ${tail}`)) continue;
      }
      // Nome de 3 letras (token Elf, Cat…) só sozinho na linha.
      if (letters(p.text).length < 4 && seg.some((w) => !p.span.includes(w) && solid(w))) continue;
      const { span, ...rest } = p;
      // strict: a linha é só o nome e lixo em volta (dá para confiar até sem achar o contorno).
      out.push({ ...rest, strict: !skipped });
    }
  }
  return out;
}

function medianHeight(words) {
  const hs = words.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
  return hs[hs.length >> 1] || 1;
}
