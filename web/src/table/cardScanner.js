// Leitor de cartas para os modos Mesa. Usa as mesmas peças do campo de batalha (OCR do nome, busca
// no catálogo, contorno da carta), mas lê a mesa de um jeito próprio:
//
// 1. Vista de cima: como a mesa está calibrada, cada bloco da mesa (planScans em tableCards.js) é
//    reamostrado como se a câmera estivesse bem em cima, numa escala fixa (5 px por mm). A perspectiva
//    some: a carta do outro lado da mesa, que a câmera vê bem de lado e achatada, fica com as letras
//    na proporção certa, e toda carta tem o mesmo tamanho na imagem (PLANO §4: retificar).
// 2. "Para cima" da vista = o lado para onde o topo das cartas daquele bloco aponta (seu lado, lado do
//    oponente ou cartas viradas). O Tesseract só lê texto em pé.
// 3. Binarização local antes do OCR: sem ela o nome não é lido com a mesa escura em volta.
// 4. O contorno achado na vista de cima já está em coordenadas da mesa: a posição sai direto, e o
//    tamanho é conferido com 63 × 88 mm (PLANO §5.2).

import { getOcrReaders } from '../recognition/ocr.js';
import { NameMatcher, findCardsInLine, mergeRowLines, levenshtein } from '../recognition/nameMatcher.js';
import { detectCardQuad } from '../recognition/cardDetector.js';
import { solveHomography } from './cameraPose.js';
import { measureCard, completeFromTop, cardFromTitle, sameFootprint, CARD_H, CARD_W } from './tableCards.js';

export const RES = 5000; // px por metro na vista de cima da 1ª passada (5 px/mm: acha as linhas de texto)
// 2ª passada: a faixa do nome de cada carta é relida sozinha, de perto (9-12 px/mm). Medido numa foto
// real: o nome das cartas (fonte pequena) só é lido a partir de ~9-11 px/mm ("Lathliss, Dragon Queen");
// a 5-8 px/mm sai "Clarhiis. Dragon Quena". Ler a mesa inteira assim seria lento demais; só as faixas.
const MAX_REREAD = 8; // releituras por bloco (primeiro as apontadas pela linha de tipo)
const MAX_LOOSE = 3; // releituras de linhas só parecidas com um nome (quase sempre texto de regras)
const LOOSE_REREAD = 0.7; // parecença mínima para uma linha só parecida valer uma releitura
// Variações da releitura, na ordem em que acertaram mais numa foto real com a câmera longe (~3 px/mm
// na carta). Faixa estreita (11 mm) em cima do nome é a que mais acerta; como a posição estimada pode
// errar uns milímetros, ela também é tentada 3 mm acima e abaixo.
const REREAD_VARIANTS = [
  { res: 12000, height: 0.011, shift: 0, bin: false },
  { res: 12000, height: 0.011, shift: 0.003, bin: false },
  { res: 12000, height: 0.011, shift: -0.003, bin: false },
  { res: 9000, height: 0.014, shift: 0, bin: true },
  { res: 12000, height: 0.024, shift: 0, bin: false },
  { res: 12000, height: 0.011, shift: 0, bin: true },
];
const LOOSE_SCORE = 0.55; // parecença mínima para uma linha virar candidata (a releitura confirma)
const DETECT_WIDTH = 640; // resolução usada para achar o contorno da carta
const BIN_WINDOW = 31; // px: janela da binarização local
const BIN_OFFSET = 8; // quanto mais escuro que a vizinhança o pixel precisa ser para virar texto
const MARGIN = 0.055; // m: folga em volta do bloco (meia diagonal da carta: carta na divisa entra inteira)

/** Caixa que contém as caixas dadas. */
function union(boxes) {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

// Palavras da linha de tipo (inglês e português), para achar a linha de tipo mesmo mal lida.
const TYPE_WORDS = ['creature', 'criatura', 'artifact', 'artefato', 'enchantment', 'encantamento', 'legendary',
  'lendario', 'lendaria', 'instant', 'instantaneo', 'instantanea', 'sorcery', 'feitico', 'planeswalker', 'land',
  'terreno', 'battle', 'batalha', 'kindred', 'tribal', 'token', 'ficha'];
const plain = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * A linha parece a linha de tipo de uma carta ("Legendary Creature — Dragon", mesmo mal lida:
 * "Legecodacy Croature — Angel")? Em toda carta ela fica a uma distância fixa abaixo do nome.
 */
export function looksLikeTypeLine(text) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const typeWord = words.some((w) => {
    const p = plain(w);
    if (p.length < 4) return false;
    return TYPE_WORDS.some((t) => (p.length < 5 ? p === t : levenshtein(p, t, 2) <= (t.length >= 8 ? 2 : 1)));
  });
  // Linha de tipo tem o travessão antes dos subtipos ("Creature — Dragon") ou é curta ("Instant").
  // Sem isso, "create a 5/5 red" (texto de regras) passaria por "Creature".
  return typeWord && (/[—–-]/.test(text) || words.length <= 3);
}

/**
 * Onde está a faixa do nome, a partir da caixa da linha de tipo (pixels de uma vista de cima a `res`
 * px/m, carta em pé): o centro do nome fica ~50% da altura da carta acima do centro da linha de tipo,
 * começando na mesma margem esquerda. Com folga para a carta um pouco girada.
 */
export function nameBarFromTypeLine(b, res) {
  const cy = (b.y0 + b.y1) / 2 - 0.505 * CARD_H * res;
  return { x0: b.x0 - 0.012 * res, x1: b.x0 + 0.06 * res, y0: cy - 0.012 * res, y1: cy + 0.012 * res };
}

/**
 * Separa uma linha do OCR onde há um vão grande entre palavras: cartas vizinhas na mesma altura saem
 * juntas numa linha só ("Legendary Creature — Angel   Legendary Creature — Dragon").
 * Retorna [{ text, bbox, words, confidence }].
 */
export function splitByGaps(line) {
  const words = (line.words ?? []).filter((w) => w.text?.trim() && w.bbox).sort((a, b) => a.bbox.x0 - b.bbox.x0);
  if (words.length < 2) return line.bbox ? [line] : [];
  const hs = words.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
  const gap = 1.5 * hs[hs.length >> 1];
  const groups = [[words[0]]];
  for (let i = 1; i < words.length; i++) {
    if (words[i].bbox.x0 - words[i - 1].bbox.x1 > gap) groups.push([]);
    groups[groups.length - 1].push(words[i]);
  }
  return groups.map((g) => ({
    text: g.map((w) => w.text).join(' '),
    words: g,
    bbox: union(g.map((w) => w.bbox)),
    confidence: Math.min(...g.map((w) => w.confidence ?? line.confidence ?? 0)),
  }));
}

/**
 * Parecença de duas linhas de tipo (0 a 1), sem acento, pontuação nem caixa. Quando as duas têm
 * subtipos (depois do travessão), vale a menor entre a linha inteira e os subtipos: "Legendary Creature
 * — Dragon" e "— Angel" começam iguais, e é o subtipo que separa uma carta da outra.
 */
export function typeSimilarity(a, b) {
  const words = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const ratio = (x, y) => {
    const L = Math.max(x.length, y.length);
    return L ? 1 - levenshtein(x, y, L) / L : 0;
  };
  const full = ratio(words(a), words(b));
  const sub = (t) => {
    const i = String(t ?? '').search(/[—–]|\s-\s/);
    return i >= 0 ? words(String(t).slice(i + 1)) : null;
  };
  const sa = sub(a);
  const sb = sub(b);
  return sa && sb ? Math.min(full, ratio(sa, sb)) : full;
}

/**
 * Nome lido com a ajuda da linha de tipo da mesma carta: aceita um nome só parecido (≥ 0,65) quando a
 * linha de tipo da carta também bate com a lida (≥ 0,7). "Clarhiis. Dragon Quena" + "Legendary Creacure
 * — Dragon" → Lathliss, Dragon Queen. As duas provas juntas seguram o erro que cada uma sozinha teria.
 * lines: linhas do OCR da faixa do nome. Retorna { card, score, bbox, anchor: 'title' } ou null.
 */
export function typeGuidedMatch(matcher, lines, typeText, { minName = 0.65, minType = 0.7 } = {}) {
  const filter = (c) => typeSimilarity(c.typeLine, typeText) >= minType;
  let best = null;
  for (const line of lines) {
    const words = (line.words ?? []).filter((w) => w.text?.trim() && w.bbox);
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j <= Math.min(words.length, i + 5); j++) {
        const text = words.slice(i, j).map((w) => w.text).join(' ');
        if (text.replace(/[^\p{L}]/gu, '').length < 5) continue;
        const m = matcher.match(text, { minScore: minName, filter });
        if (m && (!best || m.score > best.score)) {
          best = { card: m.card, score: m.score, bbox: union(words.slice(i, j).map((w) => w.bbox)), anchor: 'title', text, strict: false };
        }
      }
    }
  }
  return best;
}

const isTypeWord = (w) => {
  const p = plain(w);
  return p.length >= 4 && TYPE_WORDS.some((t) => (p.length < 5 ? p === t : levenshtein(p, t, 2) <= (t.length >= 8 ? 2 : 1)));
};

/**
 * Caixa da linha de tipo para achar o nome acima dela: a altura vem só das palavras de tipo
 * ("Creature"). Um borrão alto da ilustração lido junto na mesma linha ("AEB Creasure o") puxava o
 * centro da caixa para cima, e a faixa do nome era procurada 1 cm fora da carta.
 */
export function typeWordsBox(part) {
  const words = (part.words ?? []).filter((w) => w.bbox && isTypeWord(w.text ?? ''));
  if (!words.length) return part.bbox;
  return { x0: part.bbox.x0, x1: part.bbox.x1, y0: Math.min(...words.map((w) => w.bbox.y0)), y1: Math.max(...words.map((w) => w.bbox.y1)) };
}

// Tipos em português → tipo do catálogo (que só tem a linha de tipo em inglês).
const TYPE_PT = [['criatura', 'Creature'], ['terreno', 'Land'], ['artefato', 'Artifact'], ['encantamento', 'Enchantment'],
  ['feitico', 'Sorcery'], ['instantanea', 'Instant'], ['instantaneo', 'Instant'], ['batalha', 'Battle']];

/**
 * O texto lido onde fica a linha de tipo da carta confere com a carta do catálogo? Compara os subtipos
 * ("Elder Dinosaur"; sem subtipo, a linha inteira) com cada trecho do texto lido, aceitando erros de
 * leitura (≥ 70% de parecença) e lixo em volta. Carta em português: confere só o tipo (Criatura,
 * Terreno…), porque o catálogo não tem os subtipos traduzidos.
 * É a segunda prova de um nome lido: "Elder Dimosaur" lido como o nome "Dinosaur" não tem "Dinosaur"
 * de novo na linha de tipo; um nome achado no lixo de uma carta de ponta-cabeça também não.
 */
export function typeAgrees(card, text, min = 0.7) {
  const words = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z]+/g, ' ').trim().split(' ').filter((w) => w.length >= 2);
  const read = words(text);
  if (read.join('').length < 4) return false;
  for (const face of String(card.typeLine ?? '').split('//')) {
    const dash = face.search(/[—–]|\s-\s/);
    const target = words(dash >= 0 ? face.slice(dash + 1) : face);
    if (!target.length) continue;
    const goal = target.join(' ');
    for (let a = 0; a < read.length; a++) {
      for (let n = Math.max(1, target.length - 1); n <= target.length + 1 && a + n <= read.length; n++) {
        const got = read.slice(a, a + n).join(' ');
        const L = Math.max(goal.length, got.length);
        if (1 - levenshtein(goal, got, L) / L >= min) return true;
      }
    }
  }
  return TYPE_PT.some(([pt, en]) => card.hasType?.(en) && read.some((w) => w.length >= 6 && levenshtein(w, pt, 2) <= 1));
}

/** A faixa a reler em volta de uma caixa de texto (a linha lida pode ser só um pedaço do nome). */
function stripAround(b, res) {
  const h = b.y1 - b.y0;
  return { x0: b.x0 - 2 * h, x1: Math.max(b.x1 + 2 * h, b.x0 + 0.06 * res), y0: b.y0 - 0.8 * h, y1: b.y1 + 0.8 * h };
}

/**
 * Onde o texto fica na carta medida: fração da altura a partir do topo (0 = topo, 1 = base).
 * p: centro do texto na mesa; card: { center, up } (measureCard).
 */
export function heightFraction(p, card) {
  const along = (p.x - card.center.x) * card.up.x + (p.y - card.center.y) * card.up.y;
  return (CARD_H / 2 - along) / CARD_H;
}

/**
 * Linha do OCR que LEMBRA um nome de carta (busca solta: até 5 palavras seguidas, parecença ≥ 55%).
 * Retorna { score, bbox } ou null. Não decide nada: só aponta o que vale reler de perto.
 */
export function looseCandidate(matcher, line, minScore = LOOSE_SCORE) {
  const words = (line.words ?? []).filter((w) => w.text?.trim() && w.bbox);
  let best = null;
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j <= Math.min(words.length, i + 5); j++) {
      const text = words.slice(i, j).map((w) => w.text).join(' ');
      if (text.replace(/[^\p{L}]/gu, '').length < 6) continue;
      const m = matcher.match(text, { minScore });
      if (m && (!best || m.score > best.score)) best = { score: m.score, card: m.card, bbox: union(words.slice(i, j).map((w) => w.bbox)) };
    }
  }
  return best;
}

function ocrLines(data) {
  if (data.lines?.length) return data.lines;
  return (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
}

/** Cinza (Float32Array) de algo desenhável. */
export function grayOfSource(source, w, h, canvas = document.createElement('canvas')) {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
  return { data: g, w, h };
}

/**
 * Binarização local (média da vizinhança por imagem integral): texto preto em fundo branco, seja qual
 * for o fundo. Sem isso o Tesseract não lê o nome quando há muito escuro em volta (mesa de madeira,
 * playmat escuro, a borda preta da carta). Recebe cinza e devolve RGBA (w × h).
 */
export function binarize(gray, w, h, win = BIN_WINDOW, offset = BIN_OFFSET) {
  const W1 = w + 1;
  const S = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      S[(y + 1) * W1 + x + 1] = S[y * W1 + x + 1] + row;
    }
  }
  const r = win >> 1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = S[y1 * W1 + x1] - S[y0 * W1 + x1] - S[y1 * W1 + x0] + S[y0 * W1 + x0];
      const v = gray[y * w + x] < sum / ((x1 - x0) * (y1 - y0)) - offset ? 0 : 255;
      const i = (y * w + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Geometria da vista de cima de um bloco. region: {x0, x1, y0, y1} na mesa (m); up: para onde aponta
 * o "para cima" da vista, em graus na mesa (0 = para o oponente). Com folga em volta.
 * Retorna { w, h, toTable(u, v) → {x, y}, toPixel({x, y}) → {u, v} }.
 */
export function topDownView(region, up, res = RES, margin = MARGIN) {
  const a = (up * Math.PI) / 180;
  const U = { x: Math.sin(a), y: Math.cos(a) };
  const R = { x: U.y, y: -U.x };
  const pts = [[region.x0 - margin, region.y0 - margin], [region.x1 + margin, region.y0 - margin], [region.x1 + margin, region.y1 + margin], [region.x0 - margin, region.y1 + margin]];
  const rs = pts.map(([x, y]) => x * R.x + y * R.y);
  const us = pts.map(([x, y]) => x * U.x + y * U.y);
  const minR = Math.min(...rs);
  const maxU = Math.max(...us);
  const w = Math.ceil((Math.max(...rs) - minR) * res);
  const h = Math.ceil((maxU - Math.min(...us)) * res);
  const toTable = (u, v) => {
    const r = minR + u / res;
    const s = maxU - v / res;
    return { x: R.x * r + U.x * s, y: R.y * r + U.y * s };
  };
  const toPixel = (p) => ({ u: (p.x * R.x + p.y * R.y - minR) * res, v: (maxU - (p.x * U.x + p.y * U.y)) * res });
  return { w, h, toTable, toPixel };
}

/**
 * Reamostra o cinza do quadro (src: {data, w, h}) na vista de cima. toImage(pontoDaMesa) → pixel do
 * quadro {x, y} ou null. Fora do quadro fica cinza médio. Retorna Float32Array (view.w × view.h) ou null.
 */
export function resampleTopDown(src, view, toImage, fill = 128) {
  const corners = [[0, 0], [view.w, 0], [view.w, view.h], [0, view.h]];
  const img = corners.map(([u, v]) => toImage(view.toTable(u, v)));
  if (img.some((p) => !p)) return null;
  const H = solveHomography(corners.map(([x, y]) => ({ x, y })), img);
  if (!H) return null;
  const out = new Float32Array(view.w * view.h);
  const { data, w, h } = src;
  for (let v = 0; v < view.h; v++) {
    for (let u = 0; u < view.w; u++) {
      const z = H[2][0] * u + H[2][1] * v + 1;
      const x = (H[0][0] * u + H[0][1] * v + H[0][2]) / z;
      const y = (H[1][0] * u + H[1][1] * v + H[1][2]) / z;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) {
        out[v * view.w + u] = fill;
        continue;
      }
      const fx = x - x0;
      const fy = y - y0;
      const i = y0 * w + x0;
      out[v * view.w + u] = (data[i] * (1 - fx) + data[i + 1] * fx) * (1 - fy) + (data[i + w] * (1 - fx) + data[i + w + 1] * fx) * fy;
    }
  }
  return out;
}

// ---------------------------------------------------------------- onde há alguma coisa na mesa
//
// O OCR não pode receber a mesa vazia. A binarização local realça qualquer textura: o grão de um playmat
// vira um campo de pontinhos que o Tesseract (modo de texto esparso) tenta ler como texto. Medido com um
// playmat texturizado: 76 a 218 "linhas" de lixo e 2 a 6 s por bloco VAZIO (no PC; no celular, várias
// vezes isso), e desse lixo saíam nomes de carta ("Fire // Ice", "Pain // Suffering", "Tiny").
// Antes do OCR, uma vista de cima bem pequena diz onde há contraste de verdade (carta, mão, borda da
// mesa): a textura some quando se tira a média de alguns milímetros; a carta, não. Fora dali a imagem
// do OCR fica em branco, e um bloco sem nada nem passa pelo OCR.

const ACT_RES = 1000; // px por metro da vista usada para achar onde há alguma coisa (1 px/mm)
const ACT_CELL = 4; // px dessa vista por célula (4 mm: a média apaga o grão do playmat)
const ACT_MIN = 28; // níveis de cinza: contraste mínimo entre células vizinhas para valer
const ACT_NOISE = 4; // …ou este tanto de vezes o contraste típico do bloco (mesa de madeira, toalha)
const ACT_MIN_CELLS = 12; // grupo menor que isso (~2 cm²) é sujeira, não carta
const ACT_GROW = 4; // células (16 mm): a área cresce isso para pegar o meio liso da caixa de texto

/**
 * Onde há alguma coisa num bloco. gray: vista de cima pequena (w × h; NaN = fora da câmera).
 * Retorna { mask (Uint8Array gw × gh, 1 = pode ter carta), gw, gh, cell, count } (count = células ligadas).
 */
export function activityMask(gray, w, h, {
  cell = ACT_CELL, min = ACT_MIN, noise = ACT_NOISE, minCells = ACT_MIN_CELLS, grow = ACT_GROW,
} = {}) {
  const gw = Math.floor(w / cell);
  const gh = Math.floor(h / cell);
  const n = gw * gh;
  const mean = new Float32Array(n);
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      let s = 0;
      for (let y = cy * cell; y < (cy + 1) * cell; y++) for (let x = cx * cell; x < (cx + 1) * cell; x++) s += gray[y * w + x];
      mean[cy * gw + cx] = s / (cell * cell); // NaN se algum pixel está fora da câmera
    }
  }
  // Contraste de cada célula: diferença entre a mais clara e a mais escura das 9 em volta dela.
  const range = new Float32Array(n);
  const valid = [];
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      const i = cy * gw + cx;
      if (Number.isNaN(mean[i])) continue;
      let lo = Infinity;
      let hi = -Infinity;
      for (let y = Math.max(0, cy - 1); y <= Math.min(gh - 1, cy + 1); y++) {
        for (let x = Math.max(0, cx - 1); x <= Math.min(gw - 1, cx + 1); x++) {
          const v = mean[y * gw + x];
          if (Number.isNaN(v)) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      range[i] = hi - lo;
      valid.push(range[i]);
    }
  }
  const mask = new Uint8Array(n);
  if (!valid.length) return { mask, gw, gh, cell, count: 0 };
  valid.sort((a, b) => a - b);
  const threshold = Math.max(min, noise * valid[valid.length >> 1]);
  const active = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (range[i] > threshold) active[i] = 1;
  // Grupos de células vizinhas: os pequenos (um dado, um reflexo) ficam de fora.
  const seen = new Uint8Array(n);
  const keep = new Uint8Array(n);
  const stack = [];
  for (let i = 0; i < n; i++) {
    if (!active[i] || seen[i]) continue;
    const group = [];
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      group.push(j);
      const cx = j % gw;
      const cy = (j - cx) / gw;
      for (let y = Math.max(0, cy - 1); y <= Math.min(gh - 1, cy + 1); y++) {
        for (let x = Math.max(0, cx - 1); x <= Math.min(gw - 1, cx + 1); x++) {
          const k = y * gw + x;
          if (active[k] && !seen[k]) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
    }
    if (group.length >= minCells) for (const j of group) keep[j] = 1;
  }
  // Cresce a área (primeiro na horizontal, depois na vertical).
  const wide = new Uint8Array(n);
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      if (!keep[cy * gw + cx]) continue;
      for (let x = Math.max(0, cx - grow); x <= Math.min(gw - 1, cx + grow); x++) wide[cy * gw + x] = 1;
    }
  }
  let count = 0;
  for (let cx = 0; cx < gw; cx++) {
    for (let cy = 0; cy < gh; cy++) {
      if (!wide[cy * gw + cx]) continue;
      for (let y = Math.max(0, cy - grow); y <= Math.min(gh - 1, cy + grow); y++) mask[y * gw + cx] = 1;
    }
  }
  for (let i = 0; i < n; i++) count += mask[i];
  return { mask, core: keep, gw, gh, cell, count };
}

/**
 * Cartas soltas na mesa, achadas pela forma (sem OCR): cada grupo de células com contraste, do tamanho
 * de uma carta, vira um retângulo 63 × 88 mm ajustado às bordas. Cartas encostadas ou empilhadas formam
 * um grupo maior e ficam para a leitura do bloco inteiro.
 * gray: a vista pequena (w × h, NaN = não olhar); act: activityMask dela; res: px por metro.
 * Retorna [{ quad: [4 cantos em px], long, short }]: o lado de 88 mm vai de quad[0] para quad[3].
 * Quem chama decide qual ponta é o topo.
 */
export function findCardRects(gray, w, h, act, res = ACT_RES, tol = 0.22) {
  const { gw, gh, cell } = act;
  const n = gw * gh;
  if (!act.core) return [];
  // Tapa os buracos: a caixa de texto e a ilustração são lisas por dentro, cercadas pela moldura.
  const outside = new Uint8Array(n);
  const stack = [];
  const push = (i) => {
    if (!act.core[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < gw; x++) {
    push(x);
    push((gh - 1) * gw + x);
  }
  for (let y = 0; y < gh; y++) {
    push(y * gw);
    push(y * gw + gw - 1);
  }
  while (stack.length) {
    const j = stack.pop();
    const cx = j % gw;
    const cy = (j - cx) / gw;
    if (cx > 0) push(j - 1);
    if (cx < gw - 1) push(j + 1);
    if (cy > 0) push(j - gw);
    if (cy < gh - 1) push(j + gw);
  }
  const seen = new Uint8Array(n);
  const mm = res / 1000; // px por mm
  const cardCells = (63 * 88 * mm * mm) / (cell * cell);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (outside[i] || seen[i]) continue;
    const group = [];
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      group.push(j);
      const cx = j % gw;
      const cy = (j - cx) / gw;
      for (const k of [cx > 0 ? j - 1 : -1, cx < gw - 1 ? j + 1 : -1, cy > 0 ? j - gw : -1, cy < gh - 1 ? j + gw : -1]) {
        if (k >= 0 && !outside[k] && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    // O grupo inclui um anel de ~1 célula em volta da carta (o contraste da borda).
    if (group.length < cardCells * 0.6 || group.length > cardCells * 2) continue;
    // Eixos principais (a carta é 1,4 vez mais alta que larga).
    let mx = 0;
    let my = 0;
    for (const j of group) {
      mx += j % gw;
      my += Math.floor(j / gw);
    }
    mx /= group.length;
    my /= group.length;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const j of group) {
      const dx = (j % gw) - mx;
      const dy = Math.floor(j / gw) - my;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const a = { x: Math.cos(ang), y: Math.sin(ang) }; // eixo comprido
    const b = { x: -a.y, y: a.x };
    const pa = [];
    const pb = [];
    for (const j of group) {
      const dx = (j % gw) - mx;
      const dy = Math.floor(j / gw) - my;
      pa.push(dx * a.x + dy * a.y);
      pb.push(dx * b.x + dy * b.y);
    }
    pa.sort((x, y) => x - y);
    pb.sort((x, y) => x - y);
    const q = (v, f) => v[Math.min(v.length - 1, Math.max(0, Math.round(f * (v.length - 1))))];
    // Em px da vista (centro da célula), já sem o anel de fora.
    const side = { a0: (q(pa, 0.01) + 0.5) * cell, a1: (q(pa, 0.99) + 0.5) * cell, b0: (q(pb, 0.01) + 0.5) * cell, b1: (q(pb, 0.99) + 0.5) * cell };
    const c = { x: (mx + 0.5) * cell, y: (my + 0.5) * cell };
    const at = (u, v) => ({ x: c.x + a.x * u + b.x * v, y: c.y + a.y * u + b.y * v });
    const sample = (p) => {
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      return x < 0 || y < 0 || x >= w || y >= h ? NaN : gray[y * w + x];
    };
    // "Imã": cada lado desliza até a borda mais forte (±1,5 célula), medida ao longo do lado inteiro.
    const snap = (key, axis, sign) => {
      const other = axis === 'a' ? [side.b0, side.b1] : [side.a0, side.a1];
      const scores = [];
      for (let t = -1.5 * cell; t <= 1.5 * cell; t += 1) {
        const pos = side[key] + t;
        let sum = 0;
        let cnt = 0;
        for (let v = other[0] + cell; v <= other[1] - cell; v += 1) {
          const inn = axis === 'a' ? at(pos - sign * 1.5, v) : at(v, pos - sign * 1.5);
          const outp = axis === 'a' ? at(pos + sign * 1.5, v) : at(v, pos + sign * 1.5);
          const d = sample(inn) - sample(outp);
          if (Number.isNaN(d)) continue;
          sum += Math.abs(d);
          cnt++;
        }
        scores.push({ pos, score: cnt ? sum / cnt : 0 });
      }
      const bestScore = Math.max(...scores.map((x) => x.score));
      // A borda de FORA: a moldura de dentro costuma ser a mais forte (borda preta contra a caixa
      // clara, a 3 mm da de fora), então vale a posição mais externa com pelo menos 30% da mais forte.
      const order = sign > 0 ? [...scores].reverse() : scores;
      const floor = Math.max(10, 0.3 * bestScore);
      const edge = order.find((x) => x.score >= floor);
      if (edge) side[key] = edge.pos;
    };
    snap('a0', 'a', -1);
    snap('a1', 'a', 1);
    snap('b0', 'b', -1);
    snap('b1', 'b', 1);
    const long = (side.a1 - side.a0) / mm / 1000;
    const short = (side.b1 - side.b0) / mm / 1000;
    if (Math.abs(long / 0.088 - 1) > tol || Math.abs(short / 0.063 - 1) > tol) continue;
    // quad[0] → quad[3] é o lado comprido: [ponta 1 esq., ponta 1 dir., ponta 2 dir., ponta 2 esq.]
    out.push({ quad: [at(side.a0, side.b1), at(side.a0, side.b0), at(side.a1, side.b0), at(side.a1, side.b1)], long, short });
  }
  return out;
}

/**
 * Deixa em branco, na imagem do OCR (rgba, w × h), o que está fora da área com alguma coisa.
 * scale: px da imagem por px da vista pequena onde a área foi achada.
 */
export function whitenOutside(rgba, w, h, act, scale) {
  const k = act.cell * scale;
  for (let y = 0; y < h; y++) {
    const cy = Math.min(act.gh - 1, Math.floor(y / k));
    for (let x = 0; x < w; x++) {
      const cx = Math.floor(x / k);
      if (cx < act.gw && act.mask[cy * act.gw + cx]) continue;
      const i = (y * w + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 255;
    }
  }
  return rgba;
}

const SIGNATURE_RES = 500; // px por metro da assinatura do bloco (0,5 px/mm: ~200 × 150 px)

/**
 * Assinatura barata de um bloco: a vista de cima dele em 0,5 px/mm. Comparando com a da última
 * leitura dá para pular o OCR (caro) dos blocos onde nada mudou. null se o bloco não aparece.
 */
export function blockSignature(src, job, toImage) {
  const view = topDownView(job.region, job.up, SIGNATURE_RES, 0);
  return resampleTopDown(src, view, toImage);
}

/**
 * Quanto um bloco mudou (níveis de cinza, 0 a 255): média da diferença absoluta, descontada a mudança
 * geral de luz. Uma carta nova num bloco de 32 × 20 cm muda ~10% dele e dá alguns níveis; ruído do
 * sensor fica abaixo de 1.
 */
export function signatureChange(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let off = 0;
  for (let i = 0; i < a.length; i++) off += a[i] - b[i];
  off /= a.length;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i] - off);
  return sum / a.length;
}

/** Reduz o cinza (média por bloco) para achar o contorno: formato do grayFrame do cardTracker. */
export function shrink(gray, w, h, tw) {
  const s = Math.min(1, tw / w);
  const ow = Math.max(1, Math.round(w * s));
  const oh = Math.max(1, Math.round(h * s));
  const data = new Float32Array(ow * oh);
  const count = new Float32Array(ow * oh);
  for (let y = 0; y < h; y++) {
    const oy = Math.min(oh - 1, Math.floor(y * s));
    for (let x = 0; x < w; x++) {
      const o = oy * ow + Math.min(ow - 1, Math.floor(x * s));
      data[o] += gray[y * w + x];
      count[o]++;
    }
  }
  for (let i = 0; i < data.length; i++) data[i] /= count[i] || 1;
  return { data, w: ow, h: oh, scale: s };
}

/**
 * Tira da vista pequena (gray, NaN = não olhar) as cartas já reconhecidas, com 3 mm de folga: o vigia
 * de giro já cuida delas, e sem isso todo bloco com carta passaria pelo OCR para sempre.
 * view: a vista de cima dessa imagem (topDownView); known: [{ center, yaw }].
 */
export function hideKnownCards(gray, view, known, pad = 0.003) {
  for (const k of known) {
    const r = ((k.yaw ?? 0) * Math.PI) / 180;
    const up = { x: Math.sin(r), y: Math.cos(r) };
    const hw = CARD_W / 2 + pad;
    const hh = CARD_H / 2 + pad;
    const corners = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]]
      .map(([a, b]) => view.toPixel({ x: k.center.x + up.y * a + up.x * b, y: k.center.y - up.x * a + up.y * b }));
    const u0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.u))));
    const u1 = Math.min(view.w - 1, Math.ceil(Math.max(...corners.map((c) => c.u))));
    const v0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.v))));
    const v1 = Math.min(view.h - 1, Math.ceil(Math.max(...corners.map((c) => c.v))));
    for (let v = v0; v <= v1; v++) {
      for (let u = u0; u <= u1; u++) {
        const p = view.toTable(u + 0.5, v + 0.5);
        const dx = p.x - k.center.x;
        const dy = p.y - k.center.y;
        if (Math.abs(dx * up.y - dy * up.x) <= hw && Math.abs(dx * up.x + dy * up.y) <= hh) gray[v * view.w + u] = NaN;
      }
    }
  }
  return gray;
}

/** Caixa (em células) da área ligada, ou null. */
export function maskBounds(act) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < act.gh; y++) {
    for (let x = 0; x < act.gw; x++) {
      if (!act.mask[y * act.gw + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Ponto da carta → mesa. quad: os 4 cantos da carta na mesa [sup.esq, sup.dir, inf.dir, inf.esq];
 * (u, v) de 0 a 1 a partir do canto de cima à esquerda. Pelos cantos de verdade, e não por centro +
 * tamanho nominal: se a calibração da mesa estica um pouco a vista de cima, a faixa do nome continua
 * em cima do nome.
 */
export function cardMapper(quad) {
  const H = solveHomography([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], quad);
  if (!H) return null;
  return (u, v) => {
    const z = H[2][0] * u + H[2][1] * v + 1;
    return { x: (H[0][0] * u + H[0][1] * v + H[0][2]) / z, y: (H[1][0] * u + H[1][1] * v + H[1][2]) / z };
  };
}

/** Os 4 cantos de uma carta medida ({ center, up }), no tamanho nominal. */
function nominalQuad(card) {
  const up = card.up;
  const right = { x: up.y, y: -up.x };
  const at = (a, b) => ({ x: card.center.x + right.x * a + up.x * b, y: card.center.y + right.y * a + up.y * b });
  return [at(-CARD_W / 2, CARD_H / 2), at(CARD_W / 2, CARD_H / 2), at(CARD_W / 2, -CARD_H / 2), at(-CARD_W / 2, -CARD_H / 2)];
}

// Faixas da carta (frações da largura e da altura). O nome ocupa de ~4,5% a ~10,5% da altura.
const NAME_BANDS = [
  { u0: 0.03, u1: 0.9, v0: 0.015, v1: 0.135, res: 12000, bin: false },
  { u0: 0.03, u1: 0.9, v0: 0.015, v1: 0.135, res: 9000, bin: true },
  { u0: 0.03, u1: 0.9, v0: -0.02, v1: 0.17, res: 12000, bin: false },
];
const TYPE_BANDS = [
  { u0: 0.04, u1: 0.87, v0: 0.525, v1: 0.63, res: 12000, bin: false },
  { u0: 0.04, u1: 0.87, v0: 0.51, v1: 0.645, res: 9000, bin: true },
];

export class TableCardScanner {
  constructor(catalog) {
    this.matcher = new NameMatcher(catalog);
    this.reader = null;
    this.ocrCanvas = document.createElement('canvas');
    this.nameCanvas = document.createElement('canvas');
    this.grabCanvas = document.createElement('canvas');
    this.last = null;
    this.pending = []; // nomes só parecidos, sem linha de tipo legível, esperando a segunda leitura
  }

  /** Espera o OCR (o menu já começou a prepará-lo). */
  async ready() {
    this.reader ??= await getOcrReaders();
    return this;
  }

  /**
   * Relê de perto a faixa `rect` (pixels da vista de cima `view`), reamostrando direto do quadro.
   * Com a câmera longe (~3 px/mm na carta) o Tesseract é instável: o mesmo nome sai certo ou como
   * lixo conforme o recorte. Por isso tenta algumas variações (escala, altura da faixa, com e sem
   * binarização) e para na primeira que der um nome. `tries` limita as variações.
   * Retorna o nome achado com a caixa em pixels de `view` (anchor 'title'), ou null.
   */
  async #reread(src, view, rect, toImage, typeText = null, tries = REREAD_VARIANTS.length) {
    const cy = (rect.y0 + rect.y1) / 2;
    const texts = [];
    for (const { res, height, shift, bin } of REREAD_VARIANTS.slice(0, tries)) {
      const k = RES / res; // px da vista por px do recorte
      const half = Math.min((rect.y1 - rect.y0) / 2, (height * RES) / 2);
      const x0 = rect.x0;
      const y0 = cy - shift * RES - half; // shift > 0: mais para o topo da carta
      const crop = {
        w: Math.ceil((rect.x1 - rect.x0) / k),
        h: Math.ceil((2 * half) / k),
        toTable: (u, v) => view.toTable(x0 + u * k, y0 + v * k),
      };
      const gray = resampleTopDown(src, crop, toImage);
      if (!gray) return null;
      let rgba;
      if (bin) rgba = binarize(gray, crop.w, crop.h);
      else {
        rgba = new Uint8ClampedArray(crop.w * crop.h * 4);
        for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
          rgba[j] = rgba[j + 1] = rgba[j + 2] = gray[i];
          rgba[j + 3] = 255;
        }
      }
      const oc = this.nameCanvas;
      oc.width = crop.w;
      oc.height = crop.h;
      oc.getContext('2d').putImageData(new ImageData(rgba, crop.w, crop.h), 0, 0);
      let data;
      try {
        ({ data } = await this.reader.worker.recognize(oc, {}, { blocks: true, text: true }));
      } catch {
        continue;
      }
      texts.push((data.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40));
      const back = (m) => {
        const bb = m.bbox;
        return { ...m, bbox: { x0: x0 + bb.x0 * k, y0: y0 + bb.y0 * k, x1: x0 + bb.x1 * k, y1: y0 + bb.y1 * k } };
      };
      const lines = mergeRowLines(ocrLines(data));
      let m = null;
      for (const line of lines) {
        m = findCardsInLine(this.matcher, line).find((x) => x.anchor === 'title');
        if (m) break;
      }
      // Faixa apontada por uma linha de tipo: nome só parecido vale se a linha de tipo também bate.
      if (!m && typeText) m = typeGuidedMatch(this.matcher, lines, typeText);
      if (m) {
        this.lastReread = texts.join(' | ');
        return back(m);
      }
    }
    this.lastReread = texts.join(' | ');
    return null;
  }

  /**
   * Lê de perto uma faixa da carta (band: frações da carta, px/m e binarização), recortando direto do
   * quadro pelos 4 cantos dela na mesa (quad). Retorna { text, lines } ou null.
   */
  async #readBand(src, quad, toImage, band) {
    const map = cardMapper(quad);
    if (!map) return null;
    const w = Math.ceil((band.u1 - band.u0) * CARD_W * band.res);
    const h = Math.ceil((band.v1 - band.v0) * CARD_H * band.res);
    const crop = { w, h, toTable: (x, y) => map(band.u0 + ((band.u1 - band.u0) * x) / w, band.v0 + ((band.v1 - band.v0) * y) / h) };
    const gray = resampleTopDown(src, crop, toImage);
    if (!gray) return null;
    let rgba;
    if (band.bin) rgba = binarize(gray, w, h);
    else {
      rgba = new Uint8ClampedArray(w * h * 4);
      for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
        rgba[j] = rgba[j + 1] = rgba[j + 2] = gray[i];
        rgba[j + 3] = 255;
      }
    }
    const oc = this.nameCanvas;
    oc.width = w;
    oc.height = h;
    oc.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
    try {
      const { data } = await this.reader.worker.recognize(oc, {}, { blocks: true, text: true });
      return { text: (data.text ?? '').replace(/\s+/g, ' ').trim(), lines: mergeRowLines(ocrLines(data)) };
    } catch {
      return null;
    }
  }

  /** Lê de perto a linha de tipo da carta (quad: os 4 cantos na mesa). Retorna os textos lidos. */
  async #readTypeLine(src, quad, toImage) {
    const texts = [];
    for (const band of TYPE_BANDS) {
      const r = await this.#readBand(src, quad, toImage, band);
      if (r?.text) texts.push(r.text);
      if (r?.text && looksLikeTypeLine(r.text)) break;
    }
    return texts;
  }

  /**
   * Lê o nome de uma carta já achada na mesa (quad: os 4 cantos), na faixa do nome dela. typeText: a
   * linha de tipo lida dessa carta (aceita um nome só parecido se ela confere).
   * Retorna { card, score, text, … } ou null; this.lastReread guarda o que foi lido.
   */
  async #readName(src, quad, toImage, typeText) {
    const texts = [];
    let m = null;
    for (const band of NAME_BANDS) {
      const r = await this.#readBand(src, quad, toImage, band);
      if (!r) continue;
      texts.push(r.text.slice(0, 40));
      for (const line of r.lines) {
        m = findCardsInLine(this.matcher, line).find((x) => x.anchor === 'title');
        if (m) break;
      }
      if (!m && typeText) m = typeGuidedMatch(this.matcher, r.lines, typeText);
      if (m) break;
    }
    this.lastReread = texts.join(' | ');
    return m;
  }

  /**
   * Lê uma carta achada pela forma (quad: os 4 cantos na mesa, o topo em quad[0]–quad[1]): o nome e,
   * se o nome não saiu sem erro, a linha de tipo. Retorna { m, typeText, typed }: m = o nome achado
   * (ou null); typed = a linha de tipo foi lida ali (então o topo é esse mesmo).
   */
  async #readCard(src, quad, toImage) {
    const nameLines = [];
    const texts = [];
    let m = null;
    for (const band of NAME_BANDS) {
      const r = await this.#readBand(src, quad, toImage, band);
      if (!r) continue;
      texts.push(r.text.slice(0, 40));
      nameLines.push(...r.lines);
      for (const line of r.lines) {
        m = findCardsInLine(this.matcher, line).find((x) => x.anchor === 'title');
        if (m) break;
      }
      // Nome longo lido sem erro: não precisa de mais nada.
      if (m && m.score >= 0.95 && m.text.replace(/[^\p{L}]/gu, '').length >= 10) {
        this.lastReread = texts.join(' | ');
        return { m, typeText: null, typed: true };
      }
      if (m) break;
      if (!r.text && band === NAME_BANDS[1]) break; // nada escrito nessa ponta (nem binarizada): não é o topo
    }
    const types = await this.#readTypeLine(src, quad, toImage);
    const typeText = types.find((t) => looksLikeTypeLine(t)) ?? null;
    if (!m && typeText) m = typeGuidedMatch(this.matcher, nameLines, typeText);
    this.lastReread = `${texts.join(' | ')} ‖ ${types.join(' | ').slice(0, 60)}`;
    return { m, typeText, typed: !!typeText };
  }

  /** Cinza do quadro inteiro (uma vez por leitura). */
  gray(source, w, h) {
    return grayOfSource(source, w, h, this.grabCanvas);
  }

  /**
   * Lê as cartas de um bloco da mesa. src: cinza do quadro ({data, w, h}); job: { region, up }
   * (planScans); toImage(pontoDaMesa) → pixel do quadro ou null. known: cartas já reconhecidas
   * ([{ center, yaw, oracleId }]): o nome delas não é relido de perto (a parte cara), só o das cartas
   * novas, e a linha de tipo delas não é conferida de novo.
   * Retorna [{ card, anchor, center, yaw }] (centro e topo da carta em coordenadas da mesa).
   */
  async scan(src, job, toImage, known = []) {
    await this.ready();
    const view = topDownView(job.region, job.up);
    const info = { up: job.up, size: [view.w, view.h], lines: [], found: [], kept: [] };
    this.last = info;
    // Onde há alguma coisa neste bloco (vista pequena, barata). Mesa vazia não vai para o OCR.
    const low = topDownView(job.region, job.up, ACT_RES);
    const lowGray = resampleTopDown(src, low, toImage, NaN);
    if (!lowGray) return [];
    // As cartas já reconhecidas saem da conta: bloco só com elas não passa pelo OCR.
    let act = activityMask(hideKnownCards(lowGray, low, known), low.w, low.h);
    info.active = +(act.count / (act.gw * act.gh || 1)).toFixed(3);
    info.reread = [];
    if (!act.count) return [];
    // 1) Cartas soltas, achadas pela forma: lê só a faixa do nome (e a de tipo) de cada uma. São poucas
    // imagens pequenas por carta, em vez do bloco inteiro, e a faixa cai no lugar certo.
    const direct = []; // nomes lidos assim: { ...nome, quad, measured, typeText }
    const shaped = []; // cartas achadas pela forma, lidas ou não
    for (const r of findCardRects(lowGray, low.w, low.h, act)) {
      const p = r.quad.map((c) => low.toTable(c.x, c.y));
      // Na vista, o lado comprido tem que estar de pé; deitada, quem lê é o bloco das cartas viradas.
      const dx = r.quad[3].x - r.quad[0].x;
      const dy = r.quad[3].y - r.quad[0].y;
      if (Math.abs(dy) < Math.abs(dx)) continue;
      const upright = dy > 0 ? p : [p[2], p[3], p[0], p[1]]; // topo = a ponta de cima da vista
      const flipped = [upright[2], upright[3], upright[0], upright[1]];
      const measured = measureCard(upright);
      if (!measured?.sizeOk || known.some((k) => sameFootprint(measured, k))) continue;
      shaped.push(measured);
      let got = await this.#readCard(src, upright, toImage);
      let quad = upright;
      const first = this.lastReread;
      // Nem nome nem linha de tipo nessa ponta: a carta pode estar de ponta-cabeça.
      if (!got.m && !got.typed) {
        const other = await this.#readCard(src, flipped, toImage);
        if (other.m || other.typed) {
          got = other;
          quad = flipped;
        }
      }
      const at = toImage(measured.center);
      info.reread.push(`carta @${at ? `${Math.round(at.x)},${Math.round(at.y)}` : '?'} ${(r.short * 1000).toFixed(0)}×${(r.long * 1000).toFixed(0)} mm → ${got.m ? got.m.card.name : '-'} «${quad === upright ? first : this.lastReread}»`);
      if (got.m) direct.push({ ...got.m, anchor: 'title', typeText: got.typeText, quad, measured: measureCard(quad) });
      else info.unresolved = (info.unresolved ?? 0) + 1;
    }
    // 2) O que sobrou (cartas encostadas, empilhadas, com a mão em cima) vai para o OCR do bloco.
    if (shaped.length) act = activityMask(hideKnownCards(lowGray, low, shaped), low.w, low.h);
    const bounds = maskBounds(act);
    const top = bounds || direct.length ? resampleTopDown(src, view, toImage) : null;
    if (!top) return [];
    const found = [];
    const typeLines = []; // linhas de tipo lidas, com o lugar delas na mesa
    let small = null; // quadro reduzido para achar contornos (só se precisar)
    const frameSmall = () => (small ??= shrink(top, view.w, view.h, DETECT_WIDTH));
    if (bounds) {
    const ink = whitenOutside(binarize(top, view.w, view.h), view.w, view.h, act, RES / ACT_RES);
    // O OCR recebe só o retângulo onde há alguma coisa (as caixas lidas voltam para a vista inteira).
    const cellPx = (act.cell * RES) / ACT_RES;
    const ox = Math.min(view.w - 1, Math.round(bounds.x0 * cellPx));
    const oy = Math.min(view.h - 1, Math.round(bounds.y0 * cellPx));
    const cw = Math.max(1, Math.min(view.w, Math.round(bounds.x1 * cellPx)) - ox);
    const ch = Math.max(1, Math.min(view.h, Math.round(bounds.y1 * cellPx)) - oy);
    const oc = this.ocrCanvas;
    oc.width = cw;
    oc.height = ch;
    oc.getContext('2d').putImageData(new ImageData(ink, view.w, view.h), -ox, -oy, ox, oy, cw, ch);
    let data;
    try {
      ({ data } = await this.reader.worker.recognize(oc, {}, { blocks: true, text: true }));
    } catch (err) {
      console.warn('OCR falhou neste bloco', err);
      return [];
    }
    const moved = (b) => b && { x0: b.x0 + ox, y0: b.y0 + oy, x1: b.x1 + ox, y1: b.y1 + oy };
    const lines = mergeRowLines(ocrLines(data).map((l) => ({
      ...l, bbox: moved(l.bbox), words: (l.words ?? []).map((w) => ({ ...w, bbox: moved(w.bbox) })),
    })));
    info.lines = lines.map((l) => l.text?.trim()).filter(Boolean);
    const byType = []; // faixas do nome apontadas por linhas de tipo
    const loose = []; // linhas que lembram um nome
    for (const line of lines) {
      const strict = line.confidence >= 20 ? findCardsInLine(this.matcher, line) : [];
      found.push(...strict);
      for (const part of splitByGaps(line)) {
        if (!looksLikeTypeLine(part.text)) continue;
        const box = typeWordsBox(part);
        typeLines.push({ text: part.text, at: view.toTable((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2) });
        byType.push({ label: `tipo «${part.text}»`, rect: nameBarFromTypeLine(box, RES), typeText: part.text, box });
      }
      if (strict.some((m) => m.anchor === 'title')) continue;
      const c = looseCandidate(this.matcher, line);
      if (c) loose.push({ label: `${c.card.name} ${c.score.toFixed(2)}`, rect: stripAround(c.bbox, RES), score: c.score });
    }
    // 2ª passada: relê de perto (12 px/mm) a faixa do nome de cada carta com linha de tipo lida e as
    // linhas que lembram um nome. A 1ª passada, a 5 px/mm, embaralha o nome das cartas de verdade.
    loose.sort((a, b) => b.score - a.score);
    const looseTop = loose.filter((c) => c.score >= LOOSE_REREAD).slice(0, MAX_LOOSE);
    const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const area = (r) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
    const iou = (a, b) => {
      const i = area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
      return i / (area(a) + area(b) - i || 1);
    };
    const done = [];
    const located = [...shaped]; // cartas já achadas (pela forma, ou pelo contorno a partir da linha de tipo)
    for (const c of [...byType, ...looseTop]) {
      if (info.reread.length >= MAX_REREAD) break;
      if (done.some((r) => iou(r, c.rect) > 0.5)) continue; // praticamente a mesma faixa: já foi relida
      // Linha de tipo: primeiro acha a CARTA (o contorno em volta dela). Com os 4 cantos na mão, a faixa
      // do nome é recortada no lugar exato, mesmo com a vista de cima um pouco esticada pela calibração
      // (medido: a faixa estimada só pela distância caía 9 mm fora e o nome, legível, não era lido).
      if (c.box) {
        const fs = frameSmall().scale;
        const b = c.box;
        const q = detectCardQuad(frameSmall(), { x0: b.x0 * fs, y0: b.y0 * fs, x1: b.x1 * fs, y1: b.y1 * fs }, { anchor: 'type' });
        const quad = q?.map((p) => view.toTable(p.x / fs, p.y / fs));
        const measured = quad ? measureCard(quad) : null;
        const f = measured?.sizeOk ? heightFraction(view.toTable((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2), measured) : -1;
        if (f >= 0.5 && f <= 0.66) {
          if (located.some((l) => sameFootprint(l, measured))) continue; // outra linha da mesma carta
          located.push(measured);
          if (known.some((k) => sameFootprint(measured, k))) continue;
          done.push(c.rect);
          const m = await this.#readName(src, quad, toImage, c.typeText);
          info.reread.push(`carta de «${c.typeText}» → ${m ? m.card.name : '-'} «${this.lastReread ?? ''}»`);
          if (m) direct.push({ ...m, anchor: 'title', typeText: c.typeText, quad, measured });
          else info.unresolved = (info.unresolved ?? 0) + 1;
          continue;
        }
      }
      // Faixa em cima de uma carta já reconhecida: o vigia de giro já confirma que ela está lá.
      const mid = view.toTable((c.rect.x0 + c.rect.x1) / 2, (c.rect.y0 + c.rect.y1) / 2);
      if (known.some((k) => sameFootprint({ center: mid, yaw: k.yaw }, k))) continue;
      // Nome já lido direito nessa faixa: não precisa reler.
      if (found.some((f) => f.anchor === 'title' && overlaps(f.bbox, c.rect))) continue;
      done.push(c.rect);
      // Faixa apontada por linha de tipo: há carta ali, vale insistir; linha só parecida: 2 tentativas.
      const m = await this.#reread(src, view, c.rect, toImage, c.typeText, c.typeText ? REREAD_VARIANTS.length : 2);
      const at = toImage(view.toTable((c.rect.x0 + c.rect.x1) / 2, (c.rect.y0 + c.rect.y1) / 2));
      info.reread.push(`${c.label} @${at ? `${Math.round(at.x)},${Math.round(at.y)}` : '?'} → ${m ? m.card.name : '-'} «${this.lastReread ?? ''}»`);
      if (!m && c.typeText) info.unresolved = (info.unresolved ?? 0) + 1;
      // A faixa veio de uma linha de tipo: é a linha de tipo dessa mesma carta.
      if (m && !found.some((f) => f.card.oracleId === m.card.oracleId && overlaps(f.bbox, m.bbox))) found.push({ ...m, typeText: c.typeText });
    }
    } // fim do OCR do bloco
    info.found = [...direct, ...found].map((m) => `${m.anchor}:${m.card.name}`);
    if (!found.length && !direct.length) return [];

    const frame = frameSmall();
    const s = frame.scale;
    const detections = [];
    for (const m of [...direct, ...found]) {
      let how = 'contorno';
      let measured = m.measured ?? null; // carta já achada pela linha de tipo
      let tq = m.quad ?? null; // os 4 cantos na mesa
      if (measured) how = 'contorno pela linha de tipo';
      else {
        const { x0, y0, x1, y1 } = m.bbox;
        const found4 = detectCardQuad(frame, { x0: x0 * s, y0: y0 * s, x1: x1 * s, y1: y1 * s }, { anchor: m.anchor });
        tq = found4?.map((p) => view.toTable(p.x / s, p.y / s)) ?? null;
        measured = tq ? measureCard(tq) : null;
      }
      const quad = tq;
      // Token não entra por estimativa: o nome dele é igual a um tipo de criatura ("Dragon", "Elf"),
      // que aparece na linha de tipo das cartas comuns; estimar a carta a partir dali erra o lugar.
      const estimable = !m.card.isToken;
      if (quad && !measured?.sizeOk && estimable) {
        // Contorno curto (parou na ilustração): completa pela borda de cima, que o nome ancora.
        const full = completeFromTop(quad);
        if (full) {
          measured = measureCard(full);
          tq = full;
          how = 'borda de cima';
        }
      }
      // Sem contorno aproveitável: só com o nome lido com certeza, pela posição do nome na carta.
      const trusty = m.anchor === 'title' && m.strict && !m.keyword && m.score >= 0.95 && m.text.replace(/[^\p{L}]/gu, '').length >= 6;
      if (!measured?.sizeOk && trusty && estimable) {
        tq = cardFromTitle(m.bbox, RES).map((p) => view.toTable(p.x, p.y));
        measured = measureCard(tq);
        how = 'pelo nome';
      }
      // O nome fica no topo da carta (a linha de tipo, no meio para baixo): um nome achado no texto de
      // regras ("create a 5/5" → "Cremate") cai no meio da carta e é descartado.
      if (measured?.sizeOk && !m.measured) {
        const { x0: bx0, y0: by0, x1: bx1, y1: by1 } = m.bbox;
        const f = heightFraction(view.toTable((bx0 + bx1) / 2, (by0 + by1) / 2), measured);
        const ok = m.anchor === 'title' ? f >= -0.05 && f <= 0.2 : f >= 0.4 && f <= 1;
        if (!ok) {
          info.kept.push(`${m.card.name}: texto a ${(f * 100).toFixed(0)}% da altura`);
          continue;
        }
      }
      if (!measured?.sizeOk) {
        info.kept.push(`${m.card.name}: tamanho ${measured ? `${(measured.width * 1000).toFixed(0)}×${(measured.height * 1000).toFixed(0)} mm` : '?'}`);
        continue; // na mão de alguém, ou o contorno pegou outra coisa
      }
      // Segunda prova: a linha de tipo da carta tem que conferir com a do catálogo. Só um nome longo
      // lido sem erro dispensa. Sem isso um pedaço de texto parecido com um nome (o subtipo na linha de
      // tipo, lixo de uma carta de ponta-cabeça) virava a criatura errada, que depois não saía mais:
      // o nome de uma carta já reconhecida não é relido. Carta já reconhecida com esse nome não paga de novo.
      const sure = !m.card.isToken && m.score >= 0.95 && m.text.replace(/[^\p{L}]/gu, '').length >= 10;
      const already = known.some((k) => k.oracleId === m.card.oracleId && sameFootprint(k, measured));
      if (m.anchor === 'title' && !sure && !already) {
        const seen = typeLines.filter((t) => {
          const f = heightFraction(t.at, measured);
          const side = (t.at.x - measured.center.x) * measured.up.y - (t.at.y - measured.center.y) * measured.up.x;
          return f >= 0.48 && f <= 0.67 && Math.abs(side) <= 0.03;
        }).map((t) => t.text);
        if (m.typeText) seen.push(m.typeText);
        let agrees = seen.some((t) => typeAgrees(m.card, t));
        if (!agrees) {
          const read = await this.#readTypeLine(src, tq ?? nominalQuad(measured), toImage);
          seen.push(...read);
          agrees = read.some((t) => typeAgrees(m.card, t));
        }
        // Não conferiu. Se ali foi lida uma linha de tipo, ela é de OUTRA carta: o nome está errado.
        // Se nada legível saiu (câmera longe, desfocada), não há como conferir: aí só passa o nome
        // lido sem erro; o só parecido espera uma leitura melhor.
        const contradicted = seen.some((t) => looksLikeTypeLine(t));
        // Nome só parecido e linha de tipo ilegível (carta longe, meio coberta): vale se a leitura
        // seguinte do bloco der a mesma carta no mesmo lugar.
        let repeated = false;
        if (!agrees && !contradicted && m.score < 0.95) {
          const here = { center: measured.center, yaw: measured.yaw };
          const i = this.pending.findIndex((q) => q.oracleId === m.card.oracleId && sameFootprint(q, here));
          repeated = i >= 0;
          if (repeated) this.pending.splice(i, 1);
          else {
            this.pending = this.pending.filter((q) => !sameFootprint(q, here)).slice(-30);
            this.pending.push({ ...here, oracleId: m.card.oracleId });
          }
        }
        if (!agrees && !repeated && (contradicted || m.score < 0.95)) {
          info.kept.push(`${m.card.name} («${m.text}» ${m.score.toFixed(2)}): a linha de tipo não confere («${seen.join(' | ').slice(0, 80)}» × ${m.card.typeLine})`);
          info.unresolved = (info.unresolved ?? 0) + 1; // há carta ali: o bloco volta logo
          continue;
        }
      }
      const dup = detections.find((d) => sameFootprint(d, measured));
      if (dup) {
        // Mesma carta física lida duas vezes (o nome e a linha de tipo): o nome no topo vale mais.
        if (dup.anchor !== 'title' && m.anchor === 'title') {
          Object.assign(dup, { card: m.card, anchor: m.anchor, center: measured.center, yaw: measured.yaw });
        }
        continue;
      }
      info.kept.push(`${m.card.name}: ok (${how})`);
      detections.push({ card: m.card, anchor: m.anchor, center: measured.center, yaw: measured.yaw });
    }
    return detections;
  }
}
