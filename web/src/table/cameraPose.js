// Pose de uma câmera PARADA a partir de um retângulo de tamanho conhecido sobre a mesa (PLANO §5.2, método 2).
// Sem WebXR: serve para o PC (webcam), o iPhone e Androids sem ARCore, com a câmera num suporte.
// Uma carta sozinha é pequena demais (a borda da área desalinha dezenas de pixels); por isso a referência
// padrão é uma folha A4, e a carta fica como opção menos precisa.
// Matemática pura (sem Three.js nem DOM), testável no Node.
//
// Sistemas de coordenadas:
//   mesa: X = direita, Y = frente (do jogador para o oponente), Z = para cima; metros; origem no centro do retângulo.
//   câmera (OpenCV): x = direita na imagem, y = para baixo, z = para a frente da lente.
//   mundo (Three.js): y = para cima; ponto da mesa (X, Y, 0) → mundo (X, 0, -Y).

export const CARD_WIDTH = 0.063;
export const CARD_HEIGHT = 0.088;

/** Referências de calibração: largura × profundidade (m), como o objeto fica deitado na mesa. */
export const REFERENCES = Object.freeze({
  a4: { width: 0.21, height: 0.297, label: 'Folha A4' },
  letter: { width: 0.216, height: 0.279, label: 'Folha carta (EUA)' },
  playmat: { width: 0.61, height: 0.355, label: 'Playmat (61 × 35 cm)' },
  card: { width: CARD_WIDTH, height: CARD_HEIGHT, label: 'Uma carta (menos preciso)' },
});

/** Abertura horizontal suposta quando não dá para estimar (webcam/celular típicos). */
export const DEFAULT_HFOV_DEG = 65;

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => Math.hypot(a[0], a[1], a[2]);
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Resolve A x = b (eliminação de Gauss com pivô parcial). Retorna null se for singular. */
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Homografia H (3×3, por linhas, H[2][2] = 1) que leva 4 pontos `src` ({x, y}) em `dst` ({x, y}).
 * Retorna null se os pontos estiverem degenerados (três alinhados).
 */
export function solveHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  if (!h) return null;
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

/**
 * Focal (pixels) pela homografia de um plano, com o centro óptico em (cx, cy) e pixels quadrados (Zhang).
 * Duas estimativas: f1 (as colunas de rotação são ortogonais) e f2 (têm o mesmo tamanho). Com a proporção
 * certa do retângulo elas concordam; com a errada (folha em pé × deitada), não.
 * span = [largura, profundidade] do retângulo: sem perspectiva visível nele (< 3%), a focal não é
 * observável e o resultado é null.
 */
export function focalDetails(H, cx, cy, span = null) {
  const h = [0, 1, 2].map((r) => [0, 1, 2].map((c) => H[r][c] - (r === 0 ? cx : r === 1 ? cy : 0) * H[2][c]));
  const [h11, h12] = [h[0][0], h[0][1]];
  const [h21, h22] = [h[1][0], h[1][1]];
  const [h31, h32] = [h[2][0], h[2][1]];
  if (span && Math.max(Math.abs(h31) * span[0], Math.abs(h32) * span[1]) < 0.03) return null;
  const out = { f1: null, f2: null, w1: 0, w2: 0 };
  const scale = Math.max(Math.abs(h31), Math.abs(h32)) ** 2 || 1e-30;
  const d1 = h31 * h32;
  if (Math.abs(d1) > scale * 1e-3) {
    const q = -(h11 * h12 + h21 * h22) / d1;
    if (q > 0) Object.assign(out, { f1: Math.sqrt(q), w1: Math.abs(d1) });
  }
  const d2 = h31 * h31 - h32 * h32;
  if (Math.abs(d2) > scale * 1e-3) {
    const q = -(h11 * h11 + h21 * h21 - h12 * h12 - h22 * h22) / d2;
    if (q > 0) Object.assign(out, { f2: Math.sqrt(q), w2: Math.abs(d2) });
  }
  if (!out.f1 && !out.f2) return null;
  out.f = Math.sqrt(((out.f1 ?? 0) ** 2 * out.w1 + (out.f2 ?? 0) ** 2 * out.w2) / (out.w1 + out.w2));
  out.disagreement = out.f1 && out.f2 ? Math.abs(Math.log(out.f1 / out.f2)) : null;
  return out;
}

export function estimateFocal(H, cx, cy, span = null) {
  return focalDetails(H, cx, cy, span)?.f ?? null;
}

/**
 * Rotação R (linhas) e translação t da mesa para a câmera (OpenCV) a partir da homografia mesa → imagem.
 * Retorna null se a câmera ficaria abaixo da mesa (cantos espelhados).
 */
export function poseFromHomography(H, f, cx, cy) {
  const col = (c) => [(H[0][c] - cx * H[2][c]) / f, (H[1][c] - cy * H[2][c]) / f, H[2][c]];
  let b1 = col(0);
  let b2 = col(1);
  const b3 = col(2);
  let lambda = 2 / (norm3(b1) + norm3(b2));
  if (b3[2] * lambda < 0) lambda = -lambda; // o retângulo tem que estar na frente da lente
  b1 = scale3(b1, lambda);
  b2 = scale3(b2, lambda);
  const t = scale3(b3, lambda);
  // Ortonormaliza (o ruído dos cliques deixa as colunas levemente tortas).
  const r1 = scale3(b1, 1 / norm3(b1));
  let r2 = sub3(b2, scale3(r1, dot3(r1, b2)));
  r2 = scale3(r2, 1 / norm3(r2));
  const r3 = cross3(r1, r2);
  const R = [[r1[0], r2[0], r3[0]], [r1[1], r2[1], r3[1]], [r1[2], r2[2], r3[2]]];
  const camTable = [0, 1, 2].map((i) => -(R[0][i] * t[0] + R[1][i] * t[1] + R[2][i] * t[2])); // C = -Rᵀ t
  if (camTable[2] <= 0) return null;
  return { R, t, camTable };
}

/** Ordena 4 cliques em [longe-esq, longe-dir, perto-dir, perto-esq] (o lado de cima da imagem é o longe). */
export function orderCorners(points) {
  const byY = [...points].sort((a, b) => a.y - b.y);
  const [a, b] = byY.slice(0, 2).sort((p, q) => p.x - q.x);
  const [c, d] = byY.slice(2).sort((p, q) => p.x - q.x);
  return [a, b, d, c];
}

/** Cantos do retângulo na mesa, na mesma ordem de orderCorners. */
export function cardTableCorners(width = CARD_WIDTH, height = CARD_HEIGHT) {
  const w = width / 2;
  const h = height / 2;
  return [{ x: -w, y: h }, { x: w, y: h }, { x: w, y: -h }, { x: -w, y: -h }];
}

export function defaultFocal(imageWidth, hfovDeg = DEFAULT_HFOV_DEG) {
  return imageWidth / 2 / Math.tan((hfovDeg * Math.PI) / 360);
}

function solveRect(corners, imageWidth, imageHeight, width, height, focal) {
  const cx = imageWidth / 2;
  const cy = imageHeight / 2;
  const H = solveHomography(cardTableCorners(width, height), orderCorners(corners));
  if (!H) return { ok: false, reason: 'degenerate' };
  let f = focal;
  let focalEstimated = false;
  let disagreement = null;
  if (!f) {
    const est = focalDetails(H, cx, cy, [width, height]);
    disagreement = est?.disagreement ?? null;
    // Só aberturas plausíveis (~25° a ~90° na horizontal); fora disso os cliques foram ruidosos demais.
    if (est && est.f > imageWidth * 0.5 && est.f < imageWidth * 2.2) {
      f = est.f;
      focalEstimated = true;
    } else {
      f = defaultFocal(imageWidth);
    }
  }
  const pose = poseFromHomography(H, f, cx, cy);
  if (!pose) return { ok: false, reason: 'mirrored' };
  const [X, Y, Z] = pose.camTable;
  return { ok: true, f, focalEstimated, disagreement, width, height, cx, cy, R: pose.R, t: pose.t, camWorld: { x: X, y: Z, z: -Y } };
}

/**
 * Calibra a câmera por um retângulo de tamanho conhecido. corners: 4 pontos em pixels do VÍDEO
 * (qualquer ordem). O lado de cima da imagem é o do oponente; o centro do retângulo é a origem.
 * Com largura ≠ profundidade e `autoOrient`, testa o retângulo em pé e deitado e fica com o que faz as
 * duas estimativas da focal concordarem.
 * Retorna { ok, f, focalEstimated, R, t, camWorld, width, height, reason }.
 */
export function calibrateFromRect(corners, imageWidth, imageHeight, {
  width = REFERENCES.a4.width, height = REFERENCES.a4.height, focal, autoOrient = true,
} = {}) {
  const sizes = autoOrient && Math.abs(width - height) > 1e-3 ? [[width, height], [height, width]] : [[width, height]];
  let best = null;
  for (const [w, h] of sizes) {
    const r = solveRect(corners, imageWidth, imageHeight, w, h, focal);
    if (!r.ok) {
      best ??= r;
      continue;
    }
    if (!best?.ok || (r.disagreement ?? Infinity) < (best.disagreement ?? Infinity)) best = r;
  }
  return best;
}

/** Atalho: calibração por uma carta em pé, virada para o jogador. */
export function calibrateFromCard(corners, imageWidth, imageHeight, opts = {}) {
  return calibrateFromRect(corners, imageWidth, imageHeight, { width: CARD_WIDTH, height: CARD_HEIGHT, autoOrient: false, ...opts });
}

// ---------------------------------------------------------------- "imã" nas bordas

function sampleGray(g, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= g.width - 1 || y0 >= g.height - 1) return null;
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * g.width + x0;
  const d = g.data;
  return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + g.width] * (1 - fx) + d[i + g.width + 1] * fx) * fy;
}

/** Reta por mínimos quadrados totais: { p: ponto, d: direção unitária }. */
function fitLine(pts) {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: { x: mx, y: my }, d: { x: Math.cos(a), y: Math.sin(a) } };
}

const lineDist = (l, q) => Math.abs((q.x - l.p.x) * l.d.y - (q.y - l.p.y) * l.d.x);

function intersectLines(l1, l2) {
  const den = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / den;
  return { x: l1.p.x + l1.d.x * t, y: l1.p.y + l1.d.y * t };
}

/** Reta da borda perto do lado a→b (ou null sem borda nítida). */
function edgeLine(gray, a, b, search, samples, minContrast) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 16) return null;
  const nrm = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  const pts = [];
  for (let k = 0; k < samples; k++) {
    const t = 0.15 + (0.7 * k) / (samples - 1);
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const prof = [];
    for (let o = -search; o <= search; o += 0.5) {
      const g1 = sampleGray(gray, p.x + nrm.x * (o + 1), p.y + nrm.y * (o + 1));
      const g0 = sampleGray(gray, p.x + nrm.x * (o - 1), p.y + nrm.y * (o - 1));
      prof.push(g1 === null || g0 === null ? 0 : Math.abs(g1 - g0));
    }
    let m = 0;
    for (let j = 1; j < prof.length; j++) if (prof[j] > prof[m]) m = j;
    if (prof[m] < minContrast) continue;
    let off = 0; // pico subpixel pela parábola dos vizinhos
    if (m > 0 && m < prof.length - 1) {
      const den = prof[m - 1] - 2 * prof[m] + prof[m + 1];
      if (den < 0) off = (0.5 * (prof[m - 1] - prof[m + 1])) / den;
    }
    const o = -search + (m + off) * 0.5;
    pts.push({ x: p.x + nrm.x * o, y: p.y + nrm.y * o });
  }
  if (pts.length < samples / 2) return null;
  const first = fitLine(pts);
  const ds = pts.map((q) => lineDist(first, q)).sort((x, y) => x - y);
  const tol = Math.max(0.75, 2.5 * ds[ds.length >> 1]);
  const inliers = pts.filter((q) => lineDist(first, q) <= tol);
  return inliers.length >= samples / 2 ? fitLine(inliers) : null;
}

/**
 * "Imã": encaixa os 4 cantos clicados na borda real do retângulo, com precisão abaixo de 1 pixel.
 * gray: { data, width, height } em pixels do vídeo. Procura o maior contraste perpendicular a cada lado
 * até `search` px, ajusta uma reta e cruza os lados vizinhos. Canto sem borda nítida fica como clicado.
 * Retorna { corners (na ordem de orderCorners), snapped (quantos cantos encaixaram) }.
 */
export function refineCorners(gray, corners, { search = 10, samples = 18, minContrast = 10 } = {}) {
  const c = orderCorners(corners);
  const lines = c.map((a, i) => edgeLine(gray, a, c[(i + 1) % 4], search, samples, minContrast));
  let snapped = 0;
  const out = c.map((p, i) => {
    const l1 = lines[(i + 3) % 4];
    const l2 = lines[i];
    if (!l1 || !l2) return p;
    const q = intersectLines(l1, l2);
    if (!q || Math.hypot(q.x - p.x, q.y - p.y) > search * 1.5) return p;
    snapped++;
    return q;
  });
  return { corners: out, snapped };
}

// ---------------------------------------------------------------- tela (vídeo em object-fit: cover)

/** Intrínsecas em pixels da TELA, com o vídeo esticado em "cover" num quadro de viewW × viewH. */
export function coverIntrinsics(cal, videoW, videoH, viewW, viewH) {
  const s = Math.max(viewW / videoW, viewH / videoH);
  const ox = (viewW - videoW * s) / 2;
  const oy = (viewH - videoH * s) / 2;
  return { fx: cal.f * s, fy: cal.f * s, cx: cal.cx * s + ox, cy: cal.cy * s + oy, width: viewW, height: viewH, s, ox, oy };
}

/** Pixel do vídeo → pixel da tela (mesmo "cover"). */
export function videoToView(p, k) {
  return { x: p.x * k.s + k.ox, y: p.y * k.s + k.oy };
}

export function viewToVideo(p, k) {
  return { x: (p.x - k.ox) / k.s, y: (p.y - k.oy) / k.s };
}

/** Só o "cover" (para desenhar cantos antes de haver calibração). */
export function coverTransform(videoW, videoH, viewW, viewH) {
  const s = Math.max(viewW / videoW, viewH / videoH);
  return { s, ox: (viewW - videoW * s) / 2, oy: (viewH - videoH * s) / 2 };
}

/** Matriz de projeção (coluna a coluna, como a do Three.js) com as intrínsecas da tela. */
export function projectionMatrix(k, near = 0.01, far = 20) {
  const { fx, fy, cx, cy, width: W, height: H } = k;
  const m = new Array(16).fill(0);
  m[0] = (2 * fx) / W;
  m[5] = (2 * fy) / H;
  m[8] = 1 - (2 * cx) / W;
  m[9] = (2 * cy) / H - 1;
  m[10] = -(far + near) / (far - near);
  m[11] = -1;
  m[14] = (-2 * far * near) / (far - near);
  return m;
}

/** Mesa → mundo (vetor). */
const tableToWorld = (v) => [v[0], v[2], -v[1]];

/**
 * Matriz de mundo da câmera do Three.js (coluna a coluna). A câmera do Three olha para -Z com +Y para
 * cima; a do OpenCV olha para +Z com +y para baixo: eixos x, -y, -z.
 */
export function cameraWorldMatrix(cal) {
  const { R } = cal;
  // Linhas de R = eixos da câmera (OpenCV) em coordenadas da mesa.
  const ex = tableToWorld([R[0][0], R[0][1], R[0][2]]);
  const ey = tableToWorld([R[1][0], R[1][1], R[1][2]]).map((v) => -v);
  const ez = tableToWorld([R[2][0], R[2][1], R[2][2]]).map((v) => -v);
  const c = cal.camWorld;
  return [...ex, 0, ...ey, 0, ...ez, 0, c.x, c.y, c.z, 1];
}

/** Raio do mundo que passa pelo pixel da tela. */
export function rayFromView(p, k, cal) {
  const d = [(p.x - k.cx) / k.fx, (p.y - k.cy) / k.fy, 1];
  const { R } = cal;
  const dt = [0, 1, 2].map((i) => R[0][i] * d[0] + R[1][i] * d[1] + R[2][i] * d[2]); // Rᵀ d
  const w = tableToWorld(dt);
  const n = norm3(w);
  return { origin: { ...cal.camWorld }, direction: { x: w[0] / n, y: w[1] / n, z: w[2] / n } };
}

/** Ponto do mundo → pixel da tela (null se atrás da câmera). */
export function projectToView(pw, k, cal) {
  const pt = [pw.x, -pw.z, pw.y]; // mundo → mesa
  const { R, t } = cal;
  const pc = [0, 1, 2].map((i) => R[i][0] * pt[0] + R[i][1] * pt[1] + R[i][2] * pt[2] + t[i]);
  if (pc[2] <= 1e-6) return null;
  return { x: k.fx * (pc[0] / pc[2]) + k.cx, y: k.fy * (pc[1] / pc[2]) + k.cy };
}

// Histogramas reaproveitados (diferenças em passos de 0,5 nível de cinza, de -255 a +255).
const BINS = 1021;
const hist = new Uint32Array(BINS);
const diffBuf = new Float32Array(1 << 15);

function histMedian(n) {
  let acc = 0;
  let bin = 0;
  while (bin < BINS - 1 && acc + hist[bin] <= n >> 1) acc += hist[bin++];
  return bin;
}

/**
 * Pixels de borda da imagem de referência (os `fraction` de maior gradiente), longe da margem.
 * É neles que a câmera mexida aparece; as partes lisas da mesa não dizem nada.
 */
export function edgePixels(a, w, h, margin = 3, fraction = 0.2) {
  const g = new Float32Array(w * h);
  hist.fill(0);
  let n = 0;
  for (let y = margin; y < h - margin; y++) {
    for (let x = margin; x < w - margin; x++) {
      const i = y * w + x;
      const v = Math.hypot(a[i + 1] - a[i - 1], a[i + w] - a[i - w]);
      g[i] = v;
      hist[Math.min(BINS - 1, Math.round(v * 2))]++;
      n++;
    }
  }
  let acc = 0;
  let bin = BINS - 1;
  const want = Math.max(1, Math.floor(n * fraction));
  while (bin > 0 && acc + hist[bin] < want) acc += hist[bin--];
  const cut = Math.max(bin / 2, 4); // gradiente mínimo: ruído do sensor não é borda
  const out = [];
  for (let y = margin; y < h - margin; y++) for (let x = margin; x < w - margin; x++) if (g[y * w + x] >= cut) out.push(y * w + x);
  return Int32Array.from(out);
}

/** Mediana de |a - b deslocada| nos pixels `idx`, descontando a mudança geral de luz. */
function alignCost(a, b, w, idx, dx, dy) {
  const shift = dy * w + dx;
  const n = idx.length;
  hist.fill(0);
  for (let k = 0; k < n; k++) {
    const d = a[idx[k]] - b[idx[k] + shift];
    diffBuf[k] = d;
    hist[Math.min(BINS - 1, Math.max(0, Math.round(d * 2) + 510))]++;
  }
  const off = (histMedian(n) - 510) / 2;
  hist.fill(0);
  for (let k = 0; k < n; k++) hist[Math.min(BINS - 1, Math.round(Math.abs(diffBuf[k] - off) * 2))]++;
  return histMedian(n) / 2;
}

/**
 * Compara a imagem atual `b` com a de referência `a` (cinza, w × h) nos pixels de borda `idx`
 * (de edgePixels, com margem ≥ maxShift). Procura o deslocamento (dx, dy) até ±maxShift px que
 * melhor alinha as duas.
 * Retorna { dx, dy, zero (erro sem deslocar), best (erro no melhor), gain (zero / best) }.
 */
export function imageShift(a, b, w, h, maxShift = 3, idx = edgePixels(a, w, h, maxShift)) {
  if (!idx.length) return { dx: 0, dy: 0, zero: 0, best: 0, gain: 1 };
  const zero = alignCost(a, b, w, idx, 0, 0);
  let best = { dx: 0, dy: 0, c: zero };
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      if (!dx && !dy) continue;
      const c = alignCost(a, b, w, idx, dx, dy);
      if (c < best.c) best = { dx, dy, c };
    }
  }
  return { dx: best.dx, dy: best.dy, zero, best: best.c, gain: zero / Math.max(best.c, 0.5) };
}

/**
 * A câmera se mexeu? Sim quando as bordas alinham claramente melhor deslocadas (empurrão, câmera
 * girou ou escorregou no suporte). Mão, carta nova ou a folha tirada da mesa não contam: as outras
 * bordas continuam alinhadas sem deslocamento. `noise` = erro entre dois quadros com a câmera parada.
 */
export function cameraMoved(shift, noise = 0.5) {
  return (shift.dx !== 0 || shift.dy !== 0) && shift.gain >= 1.5 && shift.zero >= Math.max(1.5, noise * 2);
}
