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
import { measureCard, completeFromTop, cardFromTitle, sameFootprint, CARD_H } from './tableCards.js';

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
export function resampleTopDown(src, view, toImage) {
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
        out[v * view.w + u] = 128;
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

export class TableCardScanner {
  constructor(catalog) {
    this.matcher = new NameMatcher(catalog);
    this.reader = null;
    this.ocrCanvas = document.createElement('canvas');
    this.nameCanvas = document.createElement('canvas');
    this.grabCanvas = document.createElement('canvas');
    this.last = null;
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

  /** Cinza do quadro inteiro (uma vez por leitura). */
  gray(source, w, h) {
    return grayOfSource(source, w, h, this.grabCanvas);
  }

  /**
   * Lê as cartas de um bloco da mesa. src: cinza do quadro ({data, w, h}); job: { region, up }
   * (planScans); toImage(pontoDaMesa) → pixel do quadro ou null. known: cartas já reconhecidas
   * ([{ center, yaw }]): o nome delas não é relido de perto (a parte cara), só o das cartas novas.
   * Retorna [{ card, anchor, center, yaw }] (centro e topo da carta em coordenadas da mesa).
   */
  async scan(src, job, toImage, known = []) {
    await this.ready();
    const view = topDownView(job.region, job.up);
    const info = { up: job.up, size: [view.w, view.h], lines: [], found: [], kept: [] };
    this.last = info;
    const top = resampleTopDown(src, view, toImage);
    if (!top) return [];
    const oc = this.ocrCanvas;
    oc.width = view.w;
    oc.height = view.h;
    oc.getContext('2d').putImageData(new ImageData(binarize(top, view.w, view.h), view.w, view.h), 0, 0);
    let data;
    try {
      ({ data } = await this.reader.worker.recognize(oc, {}, { blocks: true, text: true }));
    } catch (err) {
      console.warn('OCR falhou neste bloco', err);
      return [];
    }
    const lines = mergeRowLines(ocrLines(data));
    info.lines = lines.map((l) => l.text?.trim()).filter(Boolean);
    const found = [];
    const byType = []; // faixas do nome apontadas por linhas de tipo
    const loose = []; // linhas que lembram um nome
    for (const line of lines) {
      const strict = line.confidence >= 20 ? findCardsInLine(this.matcher, line) : [];
      found.push(...strict);
      for (const part of splitByGaps(line)) {
        if (looksLikeTypeLine(part.text)) byType.push({ label: `tipo «${part.text}»`, rect: nameBarFromTypeLine(part.bbox, RES), typeText: part.text });
      }
      if (strict.some((m) => m.anchor === 'title')) continue;
      const c = looseCandidate(this.matcher, line);
      if (c) loose.push({ label: `${c.card.name} ${c.score.toFixed(2)}`, rect: stripAround(c.bbox, RES), score: c.score });
    }
    // 2ª passada: relê de perto (12 px/mm) a faixa do nome de cada carta com linha de tipo lida e as
    // linhas que lembram um nome. A 1ª passada, a 5 px/mm, embaralha o nome das cartas de verdade.
    loose.sort((a, b) => b.score - a.score);
    const looseTop = loose.filter((c) => c.score >= LOOSE_REREAD).slice(0, MAX_LOOSE);
    info.reread = [];
    const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const area = (r) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
    const iou = (a, b) => {
      const i = area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
      return i / (area(a) + area(b) - i || 1);
    };
    const done = [];
    for (const c of [...byType, ...looseTop]) {
      if (info.reread.length >= MAX_REREAD) break;
      if (done.some((r) => iou(r, c.rect) > 0.5)) continue; // praticamente a mesma faixa: já foi relida
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
      if (m && !found.some((f) => f.card.oracleId === m.card.oracleId && overlaps(f.bbox, m.bbox))) found.push(m);
    }
    info.found = found.map((m) => `${m.anchor}:${m.card.name}`);
    if (!found.length) return [];

    const frame = shrink(top, view.w, view.h, DETECT_WIDTH);
    const s = frame.scale;
    const detections = [];
    for (const m of found) {
      const { x0, y0, x1, y1 } = m.bbox;
      const quad = detectCardQuad(frame, { x0: x0 * s, y0: y0 * s, x1: x1 * s, y1: y1 * s }, { anchor: m.anchor });
      let how = 'contorno';
      let measured = quad ? measureCard(quad.map((p) => view.toTable(p.x / s, p.y / s))) : null;
      // Token não entra por estimativa: o nome dele é igual a um tipo de criatura ("Dragon", "Elf"),
      // que aparece na linha de tipo das cartas comuns; estimar a carta a partir dali erra o lugar.
      const estimable = !m.card.isToken;
      if (quad && !measured?.sizeOk && estimable) {
        // Contorno curto (parou na ilustração): completa pela borda de cima, que o nome ancora.
        const full = completeFromTop(quad.map((p) => view.toTable(p.x / s, p.y / s)));
        if (full) {
          measured = measureCard(full);
          how = 'borda de cima';
        }
      }
      // Sem contorno aproveitável: só com o nome lido com certeza, pela posição do nome na carta.
      const trusty = m.anchor === 'title' && m.strict && !m.keyword && m.score >= 0.95 && m.text.replace(/[^\p{L}]/gu, '').length >= 6;
      if (!measured?.sizeOk && trusty && estimable) {
        measured = measureCard(cardFromTitle(m.bbox, RES).map((p) => view.toTable(p.x, p.y)));
        how = 'pelo nome';
      }
      // O nome fica no topo da carta (a linha de tipo, no meio para baixo): um nome achado no texto de
      // regras ("create a 5/5" → "Cremate") cai no meio da carta e é descartado.
      if (measured?.sizeOk) {
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
