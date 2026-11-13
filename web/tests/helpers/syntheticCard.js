// Desenha uma carta de Magic sintética em perspectiva (para testar o detector e o rastreador).

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const blobs = Array.from({ length: 60 }, () => ({ u: 0.1 + rnd() * 0.8, v: 0.13 + rnd() * 0.4, r: 0.02 + rnd() * 0.05, c: 40 + rnd() * 160 }));
const words = Array.from({ length: 90 }, () => ({ u: 0.09 + rnd() * 0.75, v: 0.64 + rnd() * 0.26, w: 0.02 + rnd() * 0.06 }));

// Nome: faixa de "letras" em u ∈ [0.08, 0.62], v ∈ [0.058, 0.088].
export const TITLE = { u0: 0.08, u1: 0.62, v0: 0.058, v1: 0.088 };

/** Cor (0-255) da carta no ponto (u, v) ∈ [0,1]². */
export function cardColor(u, v) {
  if (u < 0.04 || u > 0.96 || v < 0.03 || v > 0.97) return 12; // borda preta
  if (u < 0.065 || u > 0.935 || v < 0.045 || v > 0.955) return 150; // moldura colorida
  if (v > TITLE.v0 && v < TITLE.v1 && u > TITLE.u0 && u < TITLE.u1) return ((u * 160) | 0) % 3 ? 25 : 200; // letras
  if (v > 0.035 && v < 0.105) return 205; // caixa do nome
  if (v > 0.115 && v < 0.55 && u > 0.08 && u < 0.92) {
    for (const b of blobs) if ((u - b.u) ** 2 + ((v - b.v) * 1.4) ** 2 < b.r * b.r) return b.c;
    return 90;
  }
  if (v > 0.56 && v < 0.61) return 200; // linha de tipo
  for (const t of words) if (v > t.v && v < t.v + 0.013 && u > t.u && u < t.u + t.w) return 30;
  return 215; // caixa de texto
}

/** Homografia que leva o quadrado unitário (u,v) nos 4 cantos q (sup.esq, sup.dir, inf.dir, inf.esq). */
export function homography(q) {
  const src = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i];
    const { x, y } = q[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [...h, 1];
}

export const project = (H, u, v) => {
  const z = H[6] * u + H[7] * v + H[8];
  return { x: (H[0] * u + H[1] * v + H[2]) / z, y: (H[3] * u + H[4] * v + H[5]) / z };
};

function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}

/** Quadro cinza w×h com a carta nos cantos q, sobre uma mesa clara, com objetos de distração. */
export function renderScene(w, h, q, { table = 225, clutter = true } = {}) {
  const Hm = homography(q);
  const inv = invert3(Hm);
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const px = x + ox;
        const py = y + oy;
        const z = inv[6] * px + inv[7] * py + inv[8];
        const u = (inv[0] * px + inv[1] * py + inv[2]) / z;
        const v = (inv[3] * px + inv[4] * py + inv[5]) / z;
        let c;
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1) c = cardColor(u, v);
        else if (clutter && py < h * 0.18) c = 70; // "notebook" ao fundo
        else if (clutter && px > w * 0.85 && py > h * 0.7) c = 120; // mão/objeto no canto
        else c = table + 6 * Math.sin(px * 0.11) * Math.cos(py * 0.07);
        sum += c;
      }
      data[y * w + x] = sum / 4;
    }
  }
  return { data, w, h, scale: 1 };
}

/** Caixa do nome como o OCR devolve: retângulo alinhado aos eixos, inflado (acentos/mana). */
export function ocrTitleBox(q, inflate = 1.5) {
  const H = homography(q);
  const pts = [[TITLE.u0, TITLE.v0], [TITLE.u1, TITLE.v0], [TITLE.u1, TITLE.v1], [TITLE.u0, TITLE.v1]].map(([u, v]) => project(H, u, v));
  const x0 = Math.min(...pts.map((p) => p.x));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y));
  const y1 = Math.max(...pts.map((p) => p.y));
  const extra = ((y1 - y0) * (inflate - 1)) / 2;
  return { x0, x1, y0: y0 - extra, y1: y1 + extra };
}

export const maxCornerError = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));
