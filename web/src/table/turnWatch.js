// Vigia de giro das cartas já reconhecidas na mesa: percebe na hora (várias vezes por segundo, sem OCR)
// quando a carta é virada 90° para qualquer lado (atacar), desvirada ou girada de ponta-cabeça.
//
// Como: a mesa está calibrada e a posição da carta é conhecida, então dá para recortar da imagem da
// câmera um quadradinho da vista de cima em volta da carta, sempre na mesma orientação (a da carta
// quando entrou). O recorte de quando ela entrou é a referência. A cada vez, o recorte atual é
// comparado com a referência girada 0°, +90°, 180° e -90° (correlação normalizada, procurando um
// pequeno deslocamento: a carta escorrega um pouco quando é virada). A arte e o texto da carta são
// únicos: o giro que casa melhor diz para que lado ela foi virada. Mão na frente: nada casa, nada muda.
//
// Lógica pura (sem DOM), testável no Node.

export const PATCH_RES = 600; // px por metro do recorte (0,6 px/mm: 84 × 84 px para 14 cm)
export const PATCH_SIZE = 0.14; // m: lado do recorte em volta do centro da carta
const INNER = 0.054; // m: quadrado central comparado (cabe dentro da carta em pé ou deitada)
// px: deslocamento procurado (3 cm a 0,6 px/mm). A posição lida pelo OCR pode errar 1-2 cm, e virar a
// carta gira em torno do centro DELA: no recorte, centrado no lugar estimado, isso vira giro + deslocamento.
const SHIFT = 18;

/** Geometria do recorte: quadrado de `size` metros centrado na carta, com o "para cima" em `up` graus. */
export function patchView(center, up, res = PATCH_RES, size = PATCH_SIZE) {
  const S = Math.round(size * res);
  const a = (up * Math.PI) / 180;
  const U = { x: Math.sin(a), y: Math.cos(a) };
  const R = { x: U.y, y: -U.x };
  const toTable = (u, v) => {
    const r = (u - S / 2) / res;
    const s = (S / 2 - v) / res;
    return { x: center.x + R.x * r + U.x * s, y: center.y + R.y * r + U.y * s };
  };
  return { w: S, h: S, toTable };
}

/** Gira um quadrado S × S `k` quartos de volta no sentido horário. */
export function rotateSquare(img, S, k) {
  const q = ((k % 4) + 4) % 4;
  if (!q) return img;
  const out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let sx = x;
      let sy = y;
      // Horário: o pixel (x, y) do resultado vem de onde ele estava antes de girar.
      if (q === 1) { sx = y; sy = S - 1 - x; }
      else if (q === 2) { sx = S - 1 - x; sy = S - 1 - y; }
      else { sx = S - 1 - y; sy = x; }
      out[y * S + x] = img[sy * S + sx];
    }
  }
  return out;
}

/**
 * Correlação normalizada entre o centro de `ref` (lado `n`) e `cur` deslocado (dx, dy).
 * Vai de -1 a 1; ~0 sem relação. Imagens lisas (variância ~0) dão 0.
 */
function ncc(ref, cur, S, n, dx, dy) {
  const o = (S - n) >> 1;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let y = 0; y < n; y++) {
    const ra = (o + y) * S + o;
    const rb = (o + y + dy) * S + o + dx;
    for (let x = 0; x < n; x++) {
      const a = ref[ra + x];
      const b = cur[rb + x];
      sa += a;
      sb += b;
      saa += a * a;
      sbb += b * b;
      sab += a * b;
    }
  }
  const N = n * n;
  const va = saa - (sa * sa) / N;
  const vb = sbb - (sb * sb) / N;
  if (va < 1e-6 * N || vb < 1e-6 * N) return 0;
  return (sab - (sa * sb) / N) / Math.sqrt(va * vb);
}

const TURNS = [0, 90, 180, -90]; // k quartos horários → giro da carta (graus, horário visto de cima)

/** Média 3 × 3: alarga o pico da correlação (a busca grossa, a cada 2 px, não o perde). */
function blur3(img, S) {
  const out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let sum = 0;
      let n = 0;
      for (let j = Math.max(0, y - 1); j <= Math.min(S - 1, y + 1); j++) {
        for (let i = Math.max(0, x - 1); i <= Math.min(S - 1, x + 1); i++) {
          sum += img[j * S + i];
          n++;
        }
      }
      out[y * S + x] = sum / n;
    }
  }
  return out;
}

/**
 * Compara o recorte atual com a referência nos 4 giros. Retorna { scores: [s0, s90, s180, s-90],
 * turn (graus do melhor), best (correlação do melhor) }.
 */
export function matchTurn(refIn, curIn, S, res = PATCH_RES) {
  const ref = blur3(refIn, S);
  const cur = blur3(curIn, S);
  const n = Math.min(S - 2 * 4, Math.round(INNER * res));
  const shift = Math.min(SHIFT, (S - n) >> 1);
  const scores = TURNS.map((_, k) => {
    const r = rotateSquare(ref, S, k);
    // Busca grossa (a cada 2 px) e depois fina em volta do melhor.
    let best = -1;
    let bx = 0;
    let by = 0;
    for (let dy = -shift; dy <= shift; dy += 2) {
      for (let dx = -shift; dx <= shift; dx += 2) {
        const c = ncc(r, cur, S, n, dx, dy);
        if (c > best) [best, bx, by] = [c, dx, dy];
      }
    }
    for (let dy = by - 1; dy <= by + 1; dy++) {
      for (let dx = bx - 1; dx <= bx + 1; dx++) {
        if (Math.abs(dx) <= shift && Math.abs(dy) <= shift) best = Math.max(best, ncc(r, cur, S, n, dx, dy));
      }
    }
    return best;
  });
  let k = 0;
  for (let i = 1; i < 4; i++) if (scores[i] > scores[k]) k = i;
  return { scores, turn: TURNS[k], best: scores[k] };
}

/**
 * Estado do vigia de UMA carta. update(recorte, agora) → { turn (mudou para), present }:
 *   turn: novo giro (0, 90, 180, -90) em relação à referência, só no momento em que muda;
 *   present: true (carta vista com clareza), false (há `goneAfter` s sem casar nada: tirada ou
 *   coberta) ou null (incerto). Abaixo de `goneScore` conta como "nada casa"; só um casamento
 *   acima de `backScore` zera essa conta.
 * Histerese: o giro novo precisa ganhar `holdChecks` vezes seguidas, com folga sobre o atual.
 */
export class TurnTracker {
  constructor({ minScore = 0.45, margin = 0.12, holdChecks = 2, goneScore = 0.35, backScore = 0.45, goneAfter = 4, refreshEvery = 8 } = {}) {
    Object.assign(this, { minScore, margin, holdChecks, goneScore, backScore, goneAfter, refreshEvery });
    this.ref = null;
    this.refAt = 0;
    this.turn = 0;
    this.cand = null;
    this.candN = 0;
    this.lowSince = null;
  }

  reset() {
    this.ref = null;
    this.turn = 0;
    this.cand = null;
    this.candN = 0;
    this.lowSince = null;
  }

  update(cur, S, now) {
    if (!this.ref) {
      this.ref = cur;
      this.refAt = now;
      return { turn: null, present: null };
    }
    const m = matchTurn(this.ref, cur, S);
    this.lastBest = m.best;
    // Nada casa (só mesa, ou mão em cima): conta o tempo. Um casamento fraco de vez em quando (o
    // máximo de muitas comparações sobe um pouco por acaso) não zera; só um casamento claro zera.
    if (m.best < this.goneScore) this.lowSince ??= now;
    else if (m.best >= this.backScore) this.lowSince = null;
    if (m.best < this.backScore) {
      this.cand = null;
      const gone = this.lowSince !== null && now - this.lowSince >= this.goneAfter;
      return { turn: null, present: gone ? false : null };
    }
    const present = m.best >= 0.5 ? true : null;
    const currentScore = m.scores[TURNS.indexOf(this.turn)];
    let changed = null;
    if (m.turn !== this.turn && m.best >= this.minScore && m.best - currentScore >= this.margin) {
      this.candN = this.cand === m.turn ? this.candN + 1 : 1;
      this.cand = m.turn;
      if (this.candN >= this.holdChecks) {
        this.turn = m.turn;
        this.cand = null;
        this.candN = 0;
        changed = m.turn;
      }
    } else {
      this.cand = null;
      this.candN = 0;
      // Parada e em pé: renova a referência devagar (luz mudando ao longo da partida).
      if (this.turn === 0 && m.scores[0] >= 0.75 && now - this.refAt >= this.refreshEvery) {
        this.ref = cur;
        this.refAt = now;
      }
    }
    return { turn: changed, present };
  }
}
