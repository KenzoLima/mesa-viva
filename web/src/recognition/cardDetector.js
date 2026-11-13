// Acha o contorno real da carta (4 cantos, em perspectiva) em volta do nome lido pelo OCR.
//
// Por que não basta estimar pelo tamanho do nome: a caixa do OCR inclui acentos e símbolos de mana
// (sai maior que o texto) e a carta deitada na mesa aparece em perspectiva. Então:
// 1. Recorta uma região generosa em volta do nome.
// 2. Acha as bordas (Sobel + afinamento) e as retas dominantes (Hough orientado pelo gradiente).
// 3. Separa retas "horizontais" (acima/abaixo do nome) e "verticais" (esquerda/direita do nome).
// 4. Testa as combinações e fica com o quadrilátero que contém o nome, tem proporção de carta e
//    cuja borda é mais contínua nos quatro lados (preferindo o mais externo: a borda da carta,
//    não a moldura da arte).
//
// Puro (sem DOM): roda nos testes do Node.

const DEG = Math.PI / 180;

function lineIntersect(a, b) {
  // Reta: x·cosθ + y·sinθ = ρ
  const det = a.c * b.s - a.s * b.c;
  if (Math.abs(det) < 1e-6) return null;
  return { x: (a.r * b.s - a.s * b.r) / det, y: (a.c * b.r - a.r * b.c) / det };
}

function quadArea(q) {
  let s = 0;
  for (let i = 0; i < 4; i++) s += q[i].x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * q[i].y;
  return s / 2;
}

function convex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const z = Math.sign((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
    if (!z || (sign && z !== sign)) return false;
    sign = z;
  }
  return true;
}

function inside(q, x, y) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const z = Math.sign((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x));
    if (!z) continue;
    if (sign && z !== sign) return false;
    sign = z;
  }
  return true;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * frame: { data: Float32Array (cinza), w, h }.
 * title: caixa do texto lido { x0, y0, x1, y1 } nas coordenadas do frame.
 * anchor: 'title' = é o nome, no topo da carta; 'type' = linha de tipo de token (embaixo, ~55-95% da altura).
 * Retorna [sup.esq, sup.dir, inf.dir, inf.esq] ou null.
 */
const ANCHORS = {
  // min/max: onde o centro do texto fica (× altura da carta, a partir do topo).
  // above/extent: região de busca acima e abaixo do texto (× altura estimada). below: folga até a base (× altura do texto).
  title: { min: 0.015, max: 0.2, above: 0.3, extent: 1.25, below: 3 },
  type: { min: 0.5, max: 0.95, above: 1.45, extent: 0.65, below: 0.4 },
};

export function detectCardQuad(frame, title, { anchor = 'title' } = {}) {
  const pos = ANCHORS[anchor] ?? ANCHORS.title;
  const th = Math.max(4, title.y1 - title.y0);
  const tw = Math.max(th, title.x1 - title.x0);
  // Altura da carta: o nome tem ~4-6% dela. Margem larga para os dois lados do erro.
  // Com a carta girada a caixa do OCR fica alta demais, por isso o limite pela largura do nome.
  const capped = Math.max(Math.min(th / 0.03, tw * 4), tw * 1.6);
  const q = detectWith(frame, title, pos, capped);
  // Nome curto e centralizado (tokens: "GOBLIN") deixa a estimativa curta e a busca acha só um pedaço
  // da carta. Se o resultado ficou pequeno para a altura do texto, tenta de novo pela altura.
  const free = th / 0.03;
  if (free > capped * 1.2 && (!q || quadHeight(q) < th / 0.09)) {
    const q2 = detectWith(frame, title, pos, free);
    if (q2 && (!q || quadHeight(q2) > quadHeight(q))) return q2;
  }
  return q;
}

const quadHeight = (q) => (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;

function detectWith(frame, title, pos, cardH) {
  const th = Math.max(4, title.y1 - title.y0);
  const tw = Math.max(th, title.x1 - title.x0);
  const tc = { x: (title.x0 + title.x1) / 2, y: (title.y0 + title.y1) / 2 };
  const { above } = pos;
  const rx0 = Math.max(1, Math.floor(title.x0 - cardH * 0.45));
  const rx1 = Math.min(frame.w - 2, Math.ceil(title.x0 + cardH * 1.0));
  const ry0 = Math.max(1, Math.floor(tc.y - cardH * above));
  const ry1 = Math.min(frame.h - 2, Math.ceil(tc.y + cardH * pos.extent));
  const W = rx1 - rx0 + 1;
  const H = ry1 - ry0 + 1;
  if (W < 20 || H < 20) return null;

  // ---- gradiente (Sobel) ----
  const { data, w } = frame;
  const gx = new Float32Array(W * H);
  const gy = new Float32Array(W * H);
  const mag = new Float32Array(W * H);
  const hist = new Uint32Array(256);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = (y + ry0) * w + (x + rx0);
      const a = data[i - w - 1];
      const b = data[i - w];
      const c = data[i - w + 1];
      const d = data[i - 1];
      const f = data[i + 1];
      const g = data[i + w - 1];
      const h = data[i + w];
      const k = data[i + w + 1];
      const sx = (c + 2 * f + k - a - 2 * d - g) / 4;
      const sy = (g + 2 * h + k - a - 2 * b - c) / 4;
      const j = y * W + x;
      gx[j] = sx;
      gy[j] = sy;
      const m = Math.hypot(sx, sy);
      mag[j] = m;
      hist[Math.min(255, m | 0)]++;
    }
  }
  // Limiar adaptativo: as 12% bordas mais fortes da região (no mínimo 12 de 255).
  let acc = 0;
  let thr = 255;
  const total = (W - 2) * (H - 2);
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc > total * 0.12) {
      thr = v;
      break;
    }
  }
  thr = Math.max(12, thr);

  // ---- Hough orientado: cada borda vota só em ângulos perto da direção do seu gradiente ----
  const NT = 180;
  const diag = Math.ceil(Math.hypot(W, H));
  const NR = 2 * diag + 1;
  const votes = new Float32Array(NT * NR);
  const edges = []; // pixels de borda afinados: x, y, ux, uy (coords da região)
  const cosT = Float32Array.from({ length: NT }, (_, t) => Math.cos(t * DEG));
  const sinT = Float32Array.from({ length: NT }, (_, t) => Math.sin(t * DEG));
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const j = y * W + x;
      const m = mag[j];
      if (m < thr) continue;
      // Afinamento: só o máximo local na direção do gradiente.
      const ux = gx[j] / m;
      const uy = gy[j] / m;
      const ox = Math.round(ux);
      const oy = Math.round(uy);
      if (m < mag[j + oy * W + ox] || m < mag[j - oy * W - ox]) continue;
      edges.push(x, y, ux, uy);
      let t0 = Math.round(Math.atan2(uy, ux) / DEG);
      if (t0 < 0) t0 += 180;
      for (let dt = -2; dt <= 2; dt++) {
        const t = (t0 + dt + NT) % NT;
        const r = Math.round(x * cosT[t] + y * sinT[t]) + diag;
        votes[t * NR + r] += 1;
      }
    }
  }

  // ---- picos ----
  const peaks = [];
  const minVotes = Math.max(10, Math.min(th * 2.5, tw * 0.35));
  for (let t = 0; t < NT; t++) {
    for (let r = 1; r < NR - 1; r++) {
      const v = votes[t * NR + r];
      if (v < minVotes) continue;
      let isMax = true;
      for (let dt = -3; dt <= 3 && isMax; dt++) {
        const tt = (t + dt + NT) % NT;
        for (let dr = -4; dr <= 4; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= NR || (dt === 0 && dr === 0)) continue;
          const o = votes[tt * NR + rr];
          if (o > v || (o === v && (dt < 0 || (dt === 0 && dr < 0)))) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) peaks.push({ t, r: r - diag, v });
    }
  }
  peaks.sort((a, b) => b.v - a.v);

  // Retas em coordenadas do frame inteiro.
  const lines = peaks.slice(0, 60).map(({ t, r, v }) => {
    const c = Math.cos(t * DEG);
    const s = Math.sin(t * DEG);
    return { t, c, s, r: r + rx0 * c + ry0 * s, v };
  });
  // Normal perto da vertical (θ≈90°) = reta horizontal.
  const horiz = lines.filter((l) => Math.abs(l.t - 90) <= 35);
  const vert = lines.filter((l) => l.t <= 35 || l.t >= 145);
  const yAt = (l, x) => (l.r - x * l.c) / l.s;
  const xAt = (l, y) => (l.r - y * l.s) / l.c;

  const top = horiz.filter((l) => yAt(l, tc.x) < title.y0 + th * 0.3 && yAt(l, tc.x) > tc.y - cardH * above).slice(0, 7);
  const bottom = horiz.filter((l) => yAt(l, tc.x) > title.y1 + th * pos.below).slice(0, 9);
  const left = vert.filter((l) => xAt(l, tc.y) < title.x0 + th * 0.5).slice(0, 7);
  const right = vert.filter((l) => xAt(l, tc.y) > tc.x).slice(0, 9);

  // ---- suporte de borda ao longo de um segmento ----
  const support = (a, b) => {
    const len = dist(a, b);
    const n = Math.max(8, Math.floor(len / 2));
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    let hit = 0;
    for (let i = 0; i < n; i++) {
      const f = 0.06 + (0.88 * i) / (n - 1);
      const px = a.x + (b.x - a.x) * f - rx0;
      const py = a.y + (b.y - a.y) * f - ry0;
      for (const o of [0, -1, 1, -2, 2]) {
        const x = Math.round(px + nx * o);
        const y = Math.round(py + ny * o);
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        if (mag[y * W + x] >= thr * 0.6) {
          hit++;
          break;
        }
      }
    }
    return hit / n;
  };

  let best = null;
  const cands = [];
  for (const T of top) {
    for (const B of bottom) {
      for (const L of left) {
        for (const R of right) {
          const q = [lineIntersect(T, L), lineIntersect(T, R), lineIntersect(B, R), lineIntersect(B, L)];
          if (q.some((p) => !p)) continue;
          if (!convex(q) || !inside(q, tc.x, tc.y)) continue;
          const wTop = dist(q[0], q[1]);
          const wBot = dist(q[3], q[2]);
          const hL = dist(q[0], q[3]);
          const hR = dist(q[1], q[2]);
          const cw = (wTop + wBot) / 2;
          const ch = (hL + hR) / 2;
          // Proporção de carta (1,4) com folga para a perspectiva da carta deitada na mesa.
          const aspect = ch / cw;
          if (aspect < 0.65 || aspect > 1.9) continue;
          if (Math.max(wTop, wBot) / Math.min(wTop, wBot) > 1.8 || Math.max(hL, hR) / Math.min(hL, hR) > 1.8) continue;
          // O nome fica no topo da carta (a linha de tipo do token, embaixo) e ocupa boa parte da largura.
          const topY = yAt(T, tc.x);
          const rel = (tc.y - topY) / ch;
          if (rel < pos.min || rel > pos.max) continue;
          if (tw > cw * 1.05 || tw < cw * 0.15) continue;
          const s = [support(q[0], q[1]), support(q[1], q[2]), support(q[2], q[3]), support(q[3], q[0])];
          const mean = (s[0] + s[1] + s[2] + s[3]) / 4;
          const score = 0.5 * mean + 0.5 * Math.min(...s);
          if (score < 0.45) continue;
          cands.push({ q, score, area: Math.abs(quadArea(q)) });
        }
      }
    }
  }
  if (!cands.length) return null;
  // Entre os bem apoiados, o mais externo (a borda preta da carta, não o quadro da arte).
  const top1 = Math.max(...cands.map((c) => c.score));
  for (const c of cands) {
    if (c.score < top1 - 0.12) continue;
    if (!best || c.area > best.area) best = c;
  }
  return refineSides(best.q, edges, rx0, ry0) ?? best.q;
}

/** Reta por mínimos quadrados totais: { m: ponto, d: direção unitária }. */
function fitLine(pts) {
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { m: { x: mx, y: my }, d: { x: Math.cos(a), y: Math.sin(a) } };
}

function meet(l1, l2) {
  const det = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
  if (Math.abs(det) < 1e-6) return null;
  const t = ((l2.m.x - l1.m.x) * l2.d.y - (l2.m.y - l1.m.y) * l2.d.x) / det;
  return { x: l1.m.x + l1.d.x * t, y: l1.m.y + l1.d.y * t };
}

/**
 * O Hough tem resolução de 1°: ajusta cada lado nos pixels de borda que estão sobre ele
 * (direção do gradiente perpendicular ao lado) e recalcula os cantos.
 */
function refineSides(q, edges, rx0, ry0) {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const lines = [];
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const len = dist(a, b);
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    let n = { x: -d.y, y: d.x };
    if ((a.x - cx) * n.x + (a.y - cy) * n.y < 0) n = { x: -n.x, y: -n.y }; // normal para fora
    // Pixels de borda perto do lado, com a distância (com sinal, + para fora). A janela cresce com
    // o lado: em carta pequena a borda de fora e a de dentro da moldura viram uma reta só no Hough.
    const reach = Math.max(4, Math.min(10, len * 0.07));
    const nb = Math.round(reach * 2);
    const near = [];
    for (let k = 0; k < edges.length; k += 4) {
      const x = edges[k] + rx0;
      const y = edges[k + 1] + ry0;
      const along = (x - a.x) * d.x + (y - a.y) * d.y;
      if (along < len * 0.06 || along > len * 0.94) continue;
      if (Math.abs(edges[k + 2] * n.x + edges[k + 3] * n.y) < 0.9) continue;
      const off = (x - a.x) * n.x + (y - a.y) * n.y;
      if (Math.abs(off) <= reach) near.push({ x, y, off });
    }
    let line = { m: a, d };
    if (near.length >= Math.max(6, len * 0.25)) {
      // A borda da carta tem duas linhas paralelas (fora e dentro da moldura preta): fica com a de fora.
      const bins = new Array(2 * nb + 1).fill(0);
      for (const p of near) bins[Math.round(p.off * 2) + nb]++;
      const peak = Math.max(...bins);
      let pick = nb;
      for (let k = 1; k < 2 * nb; k++) if (bins[k] >= peak * 0.4 && bins[k] >= bins[k - 1] && bins[k] >= bins[k + 1]) pick = k;
      const center = (pick - nb) / 2;
      const pts = near.filter((p) => Math.abs(p.off - center) <= 1);
      if (pts.length >= Math.max(6, len * 0.2)) {
        line = fitLine(pts);
        const res = pts.filter((p) => Math.abs((p.x - line.m.x) * -line.d.y + (p.y - line.m.y) * line.d.x) <= 1);
        if (res.length >= 6) line = fitLine(res);
      }
    }
    lines.push(line);
  }
  const out = [];
  for (let i = 0; i < 4; i++) {
    const p = meet(lines[(i + 3) % 4], lines[i]);
    if (!p || dist(p, q[i]) > 14) return null;
    out.push(p);
  }
  return convex(out) ? out : null;
}
