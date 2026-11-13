// Segue a carta na imagem da câmera entre uma leitura de OCR e outra (o OCR leva 1-3 s por quadro).
//
// Como funciona (tudo num quadro cinza reduzido, TRACK_WIDTH px de largura):
// 1. A partir do nome lido pelo OCR, estima o retângulo da carta e o ENCAIXA nas bordas reais
//    (refineQuad: procura a borda mais forte perto de cada lado e ajusta uma reta).
// 2. Escolhe pontos com textura dentro da carta (cantos de Shi-Tomasi).
// 3. A cada quadro, segue esses pontos com fluxo óptico Lucas-Kanade em pirâmide (aguenta tremida e
//    movimento rápido), descarta os errados (ida e volta + RANSAC) e calcula o movimento afim da carta:
//    translação, rotação, escala e inclinação. Os quatro cantos da carta andam junto.
// 4. De tempos em tempos reencaixa nas bordas (não acumula erro) e renova os pontos.
//
// A parte pesada é pura (sem DOM) para rodar nos testes do Node.

export const TRACK_WIDTH = 320; // largura do quadro reduzido usado no rastreamento

/**
 * Proporção da carta de Magic (63 × 88 mm) e onde o nome fica nela.
 * titleHeight é a altura da CAIXA que o OCR devolve (inclui acentos e símbolos de mana), não do texto.
 * Num vídeo do iPhone, com 0.042 a estimativa saiu quase 2× maior que a carta; por isso 0.075.
 * É só o plano B: o normal é o cardDetector achar as bordas reais.
 */
export const CARD = { aspect: 63 / 88, titleHeight: 0.075, titleLeft: 0.075, titleCenterY: 0.072 };

/**
 * Estima o retângulo da carta a partir da caixa do nome lido pelo OCR.
 * Usa a altura e o início do texto (a largura depende do tamanho do nome, então não serve).
 */
export function cardRectFromTitle({ x0, y0, y1 }) {
  const h = (y1 - y0) / CARD.titleHeight;
  const w = h * CARD.aspect;
  return { x: x0 - CARD.titleLeft * w, y: (y0 + y1) / 2 - CARD.titleCenterY * h, w, h };
}

/** Converte o vídeo (ou um canvas) para um quadro cinza pequeno. */
export class GraySampler {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /** Retorna { data: Float32Array, w, h, scale } (scale = pixels reduzidos por pixel do vídeo). */
  sample(source, srcW, srcH) {
    const scale = TRACK_WIDTH / srcW;
    const w = TRACK_WIDTH;
    const h = Math.round(srcH * scale);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.drawImage(source, 0, 0, w, h);
    return grayFrame(this.ctx.getImageData(0, 0, w, h).data, w, h, scale);
  }
}

export function grayFrame(rgba, w, h, scale = 1) {
  const data = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114;
  return { data, w, h, scale };
}

// ---------- imagem ----------

function sample(img, x, y) {
  const { data, w, h } = img;
  x = x < 0 ? 0 : x > w - 1.001 ? w - 1.001 : x;
  y = y < 0 ? 0 : y > h - 1.001 ? h - 1.001 : y;
  const x0 = x | 0;
  const y0 = y | 0;
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * w + x0;
  return (data[i] * (1 - fx) + data[i + 1] * fx) * (1 - fy) + (data[i + w] * (1 - fx) + data[i + w + 1] * fx) * fy;
}

const LEVELS = 4;

function pyramidOf(frame) {
  if (frame.pyr) return frame.pyr;
  const pyr = [{ data: frame.data, w: frame.w, h: frame.h }];
  for (let l = 1; l < LEVELS; l++) {
    const p = pyr[l - 1];
    const w = p.w >> 1;
    const h = p.h >> 1;
    if (w < 16 || h < 16) break;
    const data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = 2 * y * p.w + 2 * x;
        data[y * w + x] = (p.data[i] + p.data[i + 1] + p.data[i + p.w] + p.data[i + p.w + 1]) / 4;
      }
    }
    pyr.push({ data, w, h });
  }
  frame.pyr = pyr;
  return pyr;
}

// ---------- fluxo óptico (Lucas-Kanade em pirâmide) ----------

const HALF = 5; // janela 11×11
const WIN = (2 * HALF + 1) ** 2;
const winI = new Float32Array(WIN);
const winX = new Float32Array(WIN);
const winY = new Float32Array(WIN);

/** Onde o ponto (x, y) de P foi parar em C. Retorna {x, y} ou null. */
export function lkPoint(P, C, x, y) {
  let gx = 0;
  let gy = 0;
  const top = Math.min(P.length, C.length) - 1;
  for (let l = top; l >= 0; l--) {
    const s = 2 ** l;
    const I = P[l];
    const J = C[l];
    const ux = x / s;
    const uy = y / s;
    let gxx = 0;
    let gxy = 0;
    let gyy = 0;
    let k = 0;
    for (let dy = -HALF; dy <= HALF; dy++) {
      for (let dx = -HALF; dx <= HALF; dx++, k++) {
        const px = ux + dx;
        const py = uy + dy;
        const ix = (sample(I, px + 1, py) - sample(I, px - 1, py)) / 2;
        const iy = (sample(I, px, py + 1) - sample(I, px, py - 1)) / 2;
        winI[k] = sample(I, px, py);
        winX[k] = ix;
        winY[k] = iy;
        gxx += ix * ix;
        gxy += ix * iy;
        gyy += iy * iy;
      }
    }
    const det = gxx * gyy - gxy * gxy;
    const minEig = (gxx + gyy) / 2 - Math.sqrt(((gxx - gyy) / 2) ** 2 + gxy * gxy);
    if (minEig / WIN < 0.5 || det < 1e-6) {
      if (l === 0) return null;
      gx *= 2;
      gy *= 2;
      continue;
    }
    let vx = 0;
    let vy = 0;
    for (let it = 0; it < 12; it++) {
      let bx = 0;
      let by = 0;
      k = 0;
      for (let dy = -HALF; dy <= HALF; dy++) {
        for (let dx = -HALF; dx <= HALF; dx++, k++) {
          const diff = winI[k] - sample(J, ux + gx + vx + dx, uy + gy + vy + dy);
          bx += diff * winX[k];
          by += diff * winY[k];
        }
      }
      const ddx = (gyy * bx - gxy * by) / det;
      const ddy = (gxx * by - gxy * bx) / det;
      vx += ddx;
      vy += ddy;
      if (ddx * ddx + ddy * ddy < 0.0009) break;
    }
    if (l > 0) {
      gx = 2 * (gx + vx);
      gy = 2 * (gy + vy);
    } else {
      gx += vx;
      gy += vy;
    }
  }
  const nx = x + gx;
  const ny = y + gy;
  if (!Number.isFinite(nx) || nx < 0 || ny < 0 || nx > P[0].w - 1 || ny > P[0].h - 1) return null;
  return { x: nx, y: ny };
}

// ---------- geometria ----------

function solve3(m, v) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-9) return null;
  return [
    (v[0] * (e * i - f * h) - b * (v[1] * i - f * v[2]) + c * (v[1] * h - e * v[2])) / det,
    (a * (v[1] * i - f * v[2]) - v[0] * (d * i - f * g) + c * (d * v[2] - v[1] * g)) / det,
    (a * (e * v[2] - v[1] * h) - b * (d * v[2] - v[1] * g) + v[0] * (d * h - e * g)) / det,
  ];
}

/** Afim por mínimos quadrados: [a, b, c, d, e, f] com x' = ax + by + c, y' = dx + ey + f. */
function fitAffine(src, dst, idx) {
  const m = new Array(9).fill(0);
  const vx = [0, 0, 0];
  const vy = [0, 0, 0];
  for (const i of idx) {
    const r = [src[i].x, src[i].y, 1];
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) m[a * 3 + b] += r[a] * r[b];
      vx[a] += r[a] * dst[i].x;
      vy[a] += r[a] * dst[i].y;
    }
  }
  const p = solve3(m, vx);
  const q = solve3(m, vy);
  return p && q ? [...p, ...q] : null;
}

const applyAffine = (A, p) => ({ x: A[0] * p.x + A[1] * p.y + A[2], y: A[3] * p.x + A[4] * p.y + A[5] });

function ransacAffine(src, dst, tol = 1.5, iters = 80) {
  const n = src.length;
  if (n < 4) return null;
  let best = null;
  for (let it = 0; it < iters; it++) {
    const a = (Math.random() * n) | 0;
    const b = (Math.random() * n) | 0;
    const c = (Math.random() * n) | 0;
    if (a === b || b === c || a === c) continue;
    const A = fitAffine(src, dst, [a, b, c]);
    if (!A) continue;
    const inl = [];
    for (let i = 0; i < n; i++) {
      const p = applyAffine(A, src[i]);
      if ((p.x - dst[i].x) ** 2 + (p.y - dst[i].y) ** 2 < tol * tol) inl.push(i);
    }
    if (!best || inl.length > best.inliers.length) best = { inliers: inl };
  }
  if (!best || best.inliers.length < 4) return null;
  const A = fitAffine(src, dst, best.inliers);
  return A ? { A, inliers: best.inliers } : null;
}

const centroid = (q) => ({ x: q.reduce((s, p) => s + p.x, 0) / q.length, y: q.reduce((s, p) => s + p.y, 0) / q.length });

function area(q) {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function isConvex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-9) return false;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return true;
}

function insideQuad(q, x, y) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const z = Math.sign((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x));
    if (z === 0) continue;
    if (sign && z !== sign) return false;
    sign = z;
  }
  return true;
}

/** Reta por mínimos quadrados totais: { m: ponto, d: direção unitária }. */
function fitLine(pts) {
  const m = centroid(pts);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    sxx += (p.x - m.x) ** 2;
    sxy += (p.x - m.x) * (p.y - m.y);
    syy += (p.y - m.y) ** 2;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { m, d: { x: Math.cos(ang), y: Math.sin(ang) } };
}

function intersect(l1, l2) {
  const det = l1.d.x * -l2.d.y - l1.d.y * -l2.d.x;
  if (Math.abs(det) < 1e-6) return null;
  const rx = l2.m.x - l1.m.x;
  const ry = l2.m.y - l1.m.y;
  const t = (rx * -l2.d.y - ry * -l2.d.x) / det;
  return { x: l1.m.x + l1.d.x * t, y: l1.m.y + l1.d.y * t };
}

/**
 * Encaixa o quadrilátero nas bordas reais da carta. Para cada lado, procura (na direção perpendicular,
 * até `reach` × a largura da carta) a borda mais externa entre as fortes e ajusta uma reta nelas.
 * Lados sem borda clara ficam como estavam. Retorna um novo quad (ou o mesmo, se não deu).
 */
export function refineQuad(frame, quad, reach = 0.08) {
  const c = centroid(quad);
  const lens = quad.map((p, i) => Math.hypot(quad[(i + 1) % 4].x - p.x, quad[(i + 1) % 4].y - p.y));
  const R = Math.max(3, reach * Math.min(...lens));
  const lines = [];
  let found = 0;
  for (let i = 0; i < 4; i++) {
    const p = quad[i];
    const q = quad[(i + 1) % 4];
    const t = { x: (q.x - p.x) / lens[i], y: (q.y - p.y) / lens[i] };
    let n = { x: -t.y, y: t.x };
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    if (n.x * (mid.x - c.x) + n.y * (mid.y - c.y) < 0) n = { x: -n.x, y: -n.y };
    const pts = [];
    for (let k = 0; k < 14; k++) {
      const s = (0.12 + (0.76 * k) / 13) * lens[i];
      const bx = p.x + t.x * s;
      const by = p.y + t.y * s;
      const prof = [];
      for (let d = -R; d <= R; d += 0.5) {
        const g = Math.abs(sample(frame, bx + n.x * (d + 0.75), by + n.y * (d + 0.75))
          - sample(frame, bx + n.x * (d - 0.75), by + n.y * (d - 0.75)));
        prof.push({ d, g });
      }
      const gmax = Math.max(...prof.map((e) => e.g));
      if (gmax < 18) continue;
      // A borda mais de fora entre as fortes: a moldura preta da carta contra a mesa, não o quadro da arte.
      let pick = null;
      for (let j = 1; j < prof.length - 1; j++) {
        const e = prof[j];
        if (e.g >= Math.max(14, 0.2 * gmax) && e.g >= prof[j - 1].g && e.g >= prof[j + 1].g) pick = e;
      }
      if (pick) pts.push({ x: bx + n.x * pick.d, y: by + n.y * pick.d });
    }
    let line = { m: p, d: t };
    if (pts.length >= 6) {
      let fit = fitLine(pts);
      const dist = (e) => Math.abs((e.x - fit.m.x) * -fit.d.y + (e.y - fit.m.y) * fit.d.x);
      const good = pts.filter((e) => dist(e) < 1.5);
      if (good.length >= 5) {
        fit = fitLine(good);
        // Só aceita se a reta continuar quase paralela ao lado original.
        if (Math.abs(fit.d.x * t.x + fit.d.y * t.y) > 0.95) {
          line = fit;
          found++;
        }
      }
    }
    lines.push(line);
  }
  if (found === 0) return quad;
  const out = [];
  for (let i = 0; i < 4; i++) {
    const p = intersect(lines[(i + 3) % 4], lines[i]);
    if (!p || Math.hypot(p.x - quad[i].x, p.y - quad[i].y) > R * 1.8) return quad;
    out.push(p);
  }
  const ratio = Math.abs(area(out) / area(quad));
  return isConvex(out) && ratio > 0.7 && ratio < 1.4 ? out : quad;
}

/** Pontos bons de seguir (cantos de Shi-Tomasi) dentro do quad. */
export function detectFeatures(frame, quad, max = 60, minDist = 6) {
  const { data, w, h } = frame;
  const c = centroid(quad);
  const inner = quad.map((p) => ({ x: c.x + (p.x - c.x) * 0.94, y: c.y + (p.y - c.y) * 0.94 }));
  const xs = inner.map((p) => p.x);
  const ys = inner.map((p) => p.y);
  const x0 = Math.max(HALF + 2, Math.floor(Math.min(...xs)));
  const x1 = Math.min(w - HALF - 3, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(HALF + 2, Math.floor(Math.min(...ys)));
  const y1 = Math.min(h - HALF - 3, Math.ceil(Math.max(...ys)));
  if (x1 <= x0 || y1 <= y0) return [];
  const cw = x1 - x0 + 1;
  const ixx = new Float32Array(cw * (y1 - y0 + 1));
  const ixy = new Float32Array(ixx.length);
  const iyy = new Float32Array(ixx.length);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      const gx = (data[i + 1] - data[i - 1]) / 2;
      const gy = (data[i + w] - data[i - w]) / 2;
      const k = (y - y0) * cw + (x - x0);
      ixx[k] = gx * gx;
      ixy[k] = gx * gy;
      iyy[k] = gy * gy;
    }
  }
  const cands = [];
  let best = 0;
  for (let y = y0 + 2; y <= y1 - 2; y++) {
    for (let x = x0 + 2; x <= x1 - 2; x++) {
      if (!insideQuad(inner, x, y)) continue;
      let a = 0;
      let b = 0;
      let d = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const k = (y - y0 + dy) * cw + (x - x0 + dx);
          a += ixx[k];
          b += ixy[k];
          d += iyy[k];
        }
      }
      const e = (a + d) / 2 - Math.sqrt(((a - d) / 2) ** 2 + b * b);
      if (e > 25 * 25) {
        cands.push({ x, y, e });
        if (e > best) best = e;
      }
    }
  }
  cands.sort((p, q) => q.e - p.e);
  const out = [];
  const cell = new Map();
  const key = (x, y) => `${Math.floor(x / minDist)},${Math.floor(y / minDist)}`;
  for (const p of cands) {
    if (p.e < best * 0.01) break;
    const gx = Math.floor(p.x / minDist);
    const gy = Math.floor(p.y / minDist);
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) {
      for (let dx = -1; dx <= 1 && !near; dx++) {
        const o = cell.get(`${gx + dx},${gy + dy}`);
        if (o && (o.x - p.x) ** 2 + (o.y - p.y) ** 2 < minDist * minDist) near = true;
      }
    }
    if (near) continue;
    cell.set(key(p.x, p.y), p);
    out.push({ x: p.x, y: p.y });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * O quad ainda tem cara de carta? (convexo, lados opostos parecidos, proporção e ângulos de carta,
 * com folga para a perspectiva da carta deitada). Barra o contorno que "escorre" para a mesa ou para
 * a carta vizinha quando o rastreador ou o reencaixe nas bordas erram.
 */
export function cardShapeOk(q) {
  if (!q || q.length !== 4 || q.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  if (!isConvex(q)) return false;
  const d = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const wT = d(q[0], q[1]);
  const wB = d(q[3], q[2]);
  const hL = d(q[0], q[3]);
  const hR = d(q[1], q[2]);
  if (Math.min(wT, wB, hL, hR) < 2) return false;
  if (Math.max(wT, wB) / Math.min(wT, wB) > 1.45 || Math.max(hL, hR) / Math.min(hL, hR) > 1.4) return false;
  const aspect = (hL + hR) / (wT + wB);
  if (aspect < 0.6 || aspect > 2.1) return false;
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4];
    const b = q[i];
    const c = q[(i + 1) % 4];
    const cos = ((a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y)) / (d(a, b) * d(c, b));
    if (Math.abs(cos) > 0.62) return false; // ângulo fora de ~52°-128°
  }
  return true;
}

// ---------- rastreador ----------

export class CardTracker {
  /**
   * frame: quadro cinza (GraySampler/grayFrame).
   * start: { quad } = cantos achados pelo cardDetector, ou { rect } = estimativa pelo nome; em pixels do VÍDEO.
   */
  constructor(frame, { quad: found, rect }) {
    const s = frame.scale;
    let quad;
    if (found) {
      quad = found.map((p) => ({ x: p.x * s, y: p.y * s }));
    } else {
      quad = [
        { x: rect.x * s, y: rect.y * s },
        { x: (rect.x + rect.w) * s, y: rect.y * s },
        { x: (rect.x + rect.w) * s, y: (rect.y + rect.h) * s },
        { x: rect.x * s, y: (rect.y + rect.h) * s },
      ];
      // A estimativa pelo nome pode errar bastante: primeiro uma busca larga, depois uma fina.
      const wide = refineQuad(frame, quad, 0.18);
      if (cardShapeOk(wide)) quad = wide;
      const fine = refineQuad(frame, quad, 0.06);
      if (cardShapeOk(fine)) quad = fine;
    }
    this.quad = quad;
    this.scale = s;
    // Contorno sem cara de carta não é seguido: melhor esperar a próxima leitura do que prender errado.
    this.points = cardShapeOk(quad) ? detectFeatures(frame, quad) : [];
    this.prev = pyramidOf(frame);
    this.frames = 0;
    this.misses = 0;
    this.ok = this.points.length >= 8;
    // O quadro do OCR é de 1-3 s atrás: na primeira vez aceita uma mudança maior de escala.
    this.fresh = true;
  }

  get valid() {
    return this.points.length >= 8;
  }

  /** Segue a carta até este quadro. Retorna true se ainda está vendo a carta. */
  track(frame) {
    const cur = pyramidOf(frame);
    const src = [];
    const dst = [];
    for (const p of this.points) {
      const q = lkPoint(this.prev, cur, p.x, p.y);
      if (!q) continue;
      const back = lkPoint(cur, this.prev, q.x, q.y); // ida e volta: descarta pontos que escorregaram
      if (!back || (back.x - p.x) ** 2 + (back.y - p.y) ** 2 > 1) continue;
      src.push(p);
      dst.push(q);
    }
    const fit = src.length >= 6 ? ransacAffine(src, dst) : null;
    const det = fit ? fit.A[0] * fit.A[4] - fit.A[1] * fit.A[3] : 0;
    const [lo, hi] = this.fresh ? [0.4, 2.5] : [0.8, 1.25];
    if (!fit || fit.inliers.length < 6 || fit.inliers.length < src.length * 0.4 || det < lo || det > hi) {
      // Não achou: mantém o último quadro bom, para reencontrar a carta quando ela voltar.
      this.misses++;
      this.ok = false;
      return false;
    }
    this.fresh = false;
    this.misses = 0;
    this.frames++;
    let quad = this.quad.map((p) => applyAffine(fit.A, p));
    if (!cardShapeOk(quad)) {
      // O movimento achado deforma a carta: os pontos escorregaram para a mesa ou para outra carta.
      this.misses++;
      this.ok = false;
      return false;
    }
    if (this.frames % 5 === 0) {
      // Reencaixe nas bordas só como ajuste fino: se mexer muito, pegou a borda da carta vizinha ou
      // da mesa, e aceitar faria o contorno "crescer" a cada vez até sair da carta.
      const refined = refineQuad(frame, quad, 0.05);
      const w = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
      const moved = Math.max(...refined.map((p, i) => Math.hypot(p.x - quad[i].x, p.y - quad[i].y)));
      const grow = Math.abs(area(refined) / area(quad));
      if (cardShapeOk(refined) && moved < w * 0.04 && grow > 0.92 && grow < 1.08) quad = refined;
    }
    const c = centroid(quad);
    if (c.x < 0 || c.y < 0 || c.x > frame.w || c.y > frame.h) {
      this.ok = false;
      return false;
    }
    this.quad = quad;
    this.points = fit.inliers.map((i) => dst[i]).filter((p) => insideQuad(quad, p.x, p.y));
    if (this.points.length < 30 || this.frames % 20 === 0) {
      const fresh = detectFeatures(frame, quad);
      if (fresh.length > this.points.length) this.points = fresh;
    }
    this.prev = cur;
    this.ok = true;
    return true;
  }

  /** Cantos da carta (sup. esq., sup. dir., inf. dir., inf. esq.) em pixels do VÍDEO. */
  quadVideo() {
    return this.quad.map((p) => ({ x: p.x / this.scale, y: p.y / this.scale }));
  }
}
