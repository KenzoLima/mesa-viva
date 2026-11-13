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
import { NameMatcher, findCardsInLine, mergeRowLines } from '../recognition/nameMatcher.js';
import { detectCardQuad } from '../recognition/cardDetector.js';
import { solveHomography } from './cameraPose.js';
import { measureCard, completeFromTop, cardFromTitle } from './tableCards.js';

export const RES = 5000; // px por metro na vista de cima (5 px/mm: o nome fica com ~15 px de altura)
const DETECT_WIDTH = 640; // resolução usada para achar o contorno da carta
const BIN_WINDOW = 31; // px: janela da binarização local
const BIN_OFFSET = 8; // quanto mais escuro que a vizinhança o pixel precisa ser para virar texto
const SAME_CARD = 0.035; // m: duas leituras mais perto que isso são a mesma carta física
const MARGIN = 0.055; // m: folga em volta do bloco (meia diagonal da carta: carta na divisa entra inteira)

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
    this.grabCanvas = document.createElement('canvas');
    this.last = null;
  }

  /** Espera o OCR (o menu já começou a prepará-lo). */
  async ready() {
    this.reader ??= await getOcrReaders();
    return this;
  }

  /** Cinza do quadro inteiro (uma vez por leitura). */
  gray(source, w, h) {
    return grayOfSource(source, w, h, this.grabCanvas);
  }

  /**
   * Lê as cartas de um bloco da mesa. src: cinza do quadro ({data, w, h}); job: { region, up }
   * (planScans); toImage(pontoDaMesa) → pixel do quadro ou null.
   * Retorna [{ card, anchor, center, yaw }] (centro e topo da carta em coordenadas da mesa).
   */
  async scan(src, job, toImage) {
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
    for (const line of lines) {
      if (line.confidence < 20) continue;
      found.push(...findCardsInLine(this.matcher, line));
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
      if (quad && !measured?.sizeOk) {
        // Contorno curto (parou na ilustração): completa pela borda de cima, que o nome ancora.
        const full = completeFromTop(quad.map((p) => view.toTable(p.x / s, p.y / s)));
        if (full) {
          measured = measureCard(full);
          how = 'borda de cima';
        }
      }
      // Sem contorno aproveitável: só com o nome lido com certeza, pela posição do nome na carta.
      const trusty = m.anchor === 'title' && m.strict && !m.keyword && m.score >= 0.95 && m.text.replace(/[^\p{L}]/gu, '').length >= 6;
      if (!measured?.sizeOk && trusty) {
        measured = measureCard(cardFromTitle(m.bbox, RES).map((p) => view.toTable(p.x, p.y)));
        how = 'pelo nome';
      }
      if (!measured?.sizeOk) {
        info.kept.push(`${m.card.name}: tamanho ${measured ? `${(measured.width * 1000).toFixed(0)}×${(measured.height * 1000).toFixed(0)} mm` : '?'}`);
        continue; // na mão de alguém, ou o contorno pegou outra coisa
      }
      const dup = detections.find((d) => Math.hypot(d.center.x - measured.center.x, d.center.y - measured.center.y) < SAME_CARD);
      if (dup) {
        // Mesma carta física lida duas vezes: o nome no topo vale mais que um nome achado no texto.
        if (dup.anchor !== 'title' && m.anchor === 'title') Object.assign(dup, { card: m.card, anchor: m.anchor });
        continue;
      }
      info.kept.push(`${m.card.name}: ok (${how})`);
      detections.push({ card: m.card, anchor: m.anchor, center: measured.center, yaw: measured.yaw });
    }
    return detections;
  }
}
