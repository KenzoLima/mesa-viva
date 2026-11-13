// Cartas reconhecidas sobre a mesa calibrada (os dois modos Mesa). Lógica pura, testável no Node.
//
// Cada leitura do OCR vira uma posição na MESA (não na tela): a criatura fica ancorada ali e o
// rastreamento da câmera (ou a câmera parada) a mantém estável entre uma leitura e outra (PLANO §5.3).
// Aqui se decide, a cada leitura, o que mudou:
//   spawn  carta nova → invoca a criatura;
//   move   a carta andou mais que a zona morta (1,5 cm ou 8°) → a criatura acompanha;
//   tap / untap  a carta foi virada ~90° em relação a como entrou (atacar) ou desvirada;
//   remove a carta sumiu por `lostAfter` segundos com o lugar dela à vista → a criatura sai.
//
// Coordenadas da mesa: x = direita, y = frente (do jogador para o oponente), metros.
// yaw da carta: para onde aponta o TOPO dela, em graus no sentido horário visto de cima
// (0 = para o oponente, 180 = para você, ±90 = de lado).

export const CARD_W = 0.063;
export const CARD_H = 0.088;

/** Ângulo em (-180, 180]. */
export function wrapDeg(a) {
  let x = ((a + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

/** yaw (graus) do vetor "topo da carta" em coordenadas da mesa. */
export const yawOf = (up) => (Math.atan2(up.x, up.y) * 180) / Math.PI;

/**
 * Carta lida na imagem → medida na mesa. quad: 4 cantos da carta [sup.esq, sup.dir, inf.dir, inf.esq]
 * já levados para a mesa ({x, y} em metros; null se o raio não cruzou a mesa).
 * Retorna { center, up, yaw, width, height, sizeOk } ou null.
 * sizeOk: o tamanho bate com 63 × 88 mm (±tol). Se não bate, a carta está na mão de alguém ou o
 * contorno pegou outra coisa (PLANO §5.2: validação pelo tamanho conhecido).
 */
export function measureCard(quad, tol = 0.3) {
  if (!quad || quad.length !== 4 || quad.some((p) => !p)) return null;
  const [tl, tr, br, bl] = quad;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const top = mid(tl, tr);
  const bottom = mid(bl, br);
  const center = mid(top, bottom);
  const height = (dist(tl, bl) + dist(tr, br)) / 2;
  const width = (dist(tl, tr) + dist(bl, br)) / 2;
  const len = dist(top, bottom) || 1;
  const up = { x: (top.x - bottom.x) / len, y: (top.y - bottom.y) / len };
  const sizeOk = Math.abs(width / CARD_W - 1) <= tol && Math.abs(height / CARD_H - 1) <= tol;
  return { center, up, yaw: yawOf(up), width, height, sizeOk };
}

/**
 * Completa uma carta pela borda de cima (o detector às vezes para na borda da ilustração e devolve só
 * a parte de cima). quad: [sup.esq, sup.dir, inf.dir, inf.esq] na mesa. Se a borda de cima tem a
 * largura de uma carta (±20%), monta a carta inteira 88 mm para baixo dela. Senão, null.
 */
export function completeFromTop(quad) {
  if (!quad || quad.some((p) => !p)) return null;
  const [tl, tr, , bl] = quad;
  const w = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  if (Math.abs(w / CARD_W - 1) > 0.2) return null;
  const a = { x: (tr.x - tl.x) / w, y: (tr.y - tl.y) / w };
  let up = { x: -a.y, y: a.x };
  // O "para cima" aponta para longe da base detectada.
  if ((bl.x - tl.x) * up.x + (bl.y - tl.y) * up.y > 0) up = { x: -up.x, y: -up.y };
  const down = (p) => ({ x: p.x - up.x * CARD_H, y: p.y - up.y * CARD_H });
  return [tl, tr, down(tr), down(tl)];
}

/**
 * Carta estimada pelo nome lido, quando o contorno não aparece (mão na frente, borda sem contraste).
 * Na vista de cima a carta tem tamanho conhecido e fica em pé: o nome começa a 7,5% da largura da
 * borda esquerda e seu centro fica a 7,2% da altura a partir do topo (as mesmas medidas do cardTracker).
 * bbox em pixels da vista; res em px/m. Retorna os 4 cantos em pixels da vista.
 */
export function cardFromTitle(bbox, res) {
  const w = CARD_W * res;
  const h = CARD_H * res;
  const x0 = bbox.x0 - 0.075 * w;
  const y0 = (bbox.y0 + bbox.y1) / 2 - 0.072 * h;
  return [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }];
}

/**
 * As duas leituras são da mesma carta física? Sim se o centro de uma cai dentro do retângulo da outra
 * (63 × 88 mm no giro dela, aumentado 15%: a linha de tipo lida como token fica quase a meia carta do
 * centro). Cartas vizinhas não se confundem: lado a lado os centros ficam a ≥ 6,3 cm, uma acima da
 * outra a ≥ 8,8 cm. a, b: { center: {x, y}, yaw }.
 */
export function sameFootprint(a, b, shrink = 1.15) {
  const inside = (p, card) => {
    const r = ((card.yaw ?? 0) * Math.PI) / 180;
    const up = { x: Math.sin(r), y: Math.cos(r) };
    const dx = p.x - card.center.x;
    const dy = p.y - card.center.y;
    const along = dx * up.x + dy * up.y;
    const across = dx * up.y - dy * up.x;
    return Math.abs(across) <= (CARD_W / 2) * shrink && Math.abs(along) <= (CARD_H / 2) * shrink;
  };
  return inside(a.center, b) || inside(b.center, a);
}

export class TableCards {
  constructor({ matchRadius = 0.06, moveRadius = 0.15, deadzone = 0.015, deadzoneDeg = 8, lostAfter = 6, occupied = 0.04, swapVotes = 3 } = {}) {
    Object.assign(this, { matchRadius, moveRadius, deadzone, deadzoneDeg, lostAfter, occupied, swapVotes });
    this.votes = new Map(); // id da carta no lugar → { oracleId, n } (outro nome lido em cima dela)
    this.entries = new Map(); // id → { id, card, pos, yaw, baseYaw, tapped, lastSeen, missingSince }
    this.nextId = 1;
  }

  /**
   * detections: [{ card, center: {x, y}, yaw }] de UMA leitura.
   * visible(pos, entry): o que esta leitura podia ver da carta:
   *   null/undefined — a leitura nem cobria esse lugar (outro bloco): nada muda;
   *   false — o lugar está fora da câmera (ou coberto): não conta como sumida;
   *   'same' — dava para ler a carta como ela estava; 'turned' — dava para ler se ela tivesse sido
   *   virada 90°; true — as duas coisas.
   * A carta só começa a contar como sumida depois de não ser vista nem 'same' nem 'turned' (uma carta
   * que acabou de ser virada para atacar não é lida no bloco "em pé", só no bloco "virado").
   * Retorna os eventos, na ordem em que devem ser aplicados.
   */
  update(detections, now, visible = () => true) {
    const events = [];
    const seen = new Set();
    for (const d of detections) {
      const entry = this.#match(d, seen);
      if (!entry) {
        // Já tem outra carta nesse lugar: é leitura errada (uma carta física, uma criatura) — a não ser
        // que o mesmo outro nome se repita: aí trocaram a carta e a de antes sai.
        const there = this.#occupant(d);
        if (there) {
          const v = this.votes.get(there.id);
          const n = v?.oracleId === d.card.oracleId ? v.n + 1 : 1;
          // Troca na hora quando a leitura nova é claramente melhor: o nome no topo da carta contra
          // uma linha de tipo lida como token, ou um nome mais completo ("Shivan Dragon" contra só
          // "Dragon", quando o OCR perdeu uma palavra e achou o token de mesmo nome).
          const nameOf = (c) => String(c.name ?? '').toLowerCase();
          const better = (there.anchor === 'type' && (d.anchor ?? 'title') === 'title')
            || (nameOf(d.card).length > nameOf(there.card).length && nameOf(d.card).includes(nameOf(there.card)));
          if (n < this.swapVotes && !better) {
            this.votes.set(there.id, { oracleId: d.card.oracleId, n });
            seen.add(there.id); // o lugar está ocupado e foi visto: a de antes não "some"
            continue;
          }
          this.votes.delete(there.id);
          this.entries.delete(there.id);
          events.push({ type: 'remove', entry: there });
        }
        const e = {
          id: this.nextId++, card: d.card, anchor: d.anchor ?? 'title', pos: { ...d.center }, yaw: d.yaw, baseYaw: d.yaw,
          tapped: false, lastSeen: now, missingSince: null, missed: null,
        };
        this.entries.set(e.id, e);
        seen.add(e.id);
        events.push({ type: 'spawn', entry: e });
        continue;
      }
      seen.add(entry.id);
      this.votes.delete(entry.id);
      entry.lastSeen = now;
      entry.missingSince = null;
      entry.missed = null;
      const moved = Math.hypot(d.center.x - entry.pos.x, d.center.y - entry.pos.y) > this.deadzone;
      const turned = Math.abs(wrapDeg(d.yaw - entry.yaw)) > this.deadzoneDeg;
      if (moved || turned) {
        if (moved) entry.pos = { ...d.center };
        if (turned) entry.yaw = d.yaw;
        events.push({ type: 'move', entry });
      }
      this.#tapState(entry, events);
    }
    for (const e of this.entries.values()) {
      if (seen.has(e.id)) continue;
      const v = visible(e.pos, e);
      if (v === null || v === undefined) continue; // esta leitura não cobria a carta
      if (v === false) {
        e.missingSince = null; // fora de vista: não conta como sumida
        e.missed = null;
        continue;
      }
      e.missed ??= new Set();
      if (v === true) e.missed.add('same').add('turned');
      else e.missed.add(v);
      if (!(e.missed.has('same') && e.missed.has('turned'))) continue;
      e.missingSince ??= now;
      if (now - e.missingSince >= this.lostAfter) {
        this.entries.delete(e.id);
        events.push({ type: 'remove', entry: e });
      }
    }
    return events;
  }

  /** Virada (~90° para qualquer lado do giro em que entrou) ou desvirada: evento de atacar. */
  #tapState(entry, events) {
    const delta = Math.abs(wrapDeg(entry.yaw - entry.baseYaw));
    const tapped = delta >= 55 && delta <= 125;
    if (tapped !== entry.tapped) {
      entry.tapped = tapped;
      events.push({ type: tapped ? 'tap' : 'untap', entry });
    } else if (!tapped && delta > 125) {
      // Girou de vez (passou a carta para o outro lado): esse passa a ser o "em pé" dela.
      entry.baseYaw = entry.yaw;
    }
  }

  /**
   * Giro medido pelo vigia (turnWatch.js), na hora, sem esperar o OCR. yaw: para onde o topo da
   * carta aponta agora. Retorna os eventos (move, tap/untap).
   */
  turn(id, yaw, now) {
    const entry = this.entries.get(id);
    if (!entry) return [];
    const events = [];
    entry.lastSeen = now;
    entry.missingSince = null;
    entry.missed = null;
    if (Math.abs(wrapDeg(yaw - entry.yaw)) > this.deadzoneDeg) {
      entry.yaw = yaw;
      events.push({ type: 'move', entry });
    }
    this.#tapState(entry, events);
    return events;
  }

  /** O vigia viu a carta no lugar: ela não está sumida (mesmo que o OCR não a leia agora). */
  seen(id, now) {
    const e = this.entries.get(id);
    if (!e) return;
    e.lastSeen = now;
    e.missingSince = null;
    e.missed = null;
  }

  /**
   * O vigia não acha mais a carta no lugar (tirada, ou coberta por vários segundos): conta como
   * faltando em pé e virada; a próxima leitura a remove passado o prazo.
   */
  absent(id, now) {
    const e = this.entries.get(id);
    if (!e) return;
    e.missed = new Set(['same', 'turned']);
    e.missingSince ??= now;
  }

  /** Remove as cartas sumidas há mais que o prazo (sem precisar de uma leitura do OCR). */
  expire(now) {
    const events = [];
    for (const e of this.entries.values()) {
      if (e.missingSince !== null && e.missed?.has('same') && e.missed.has('turned') && now - e.missingSince >= this.lostAfter) {
        this.entries.delete(e.id);
        events.push({ type: 'remove', entry: e });
      }
    }
    return events;
  }

  /** Carta (de outro nome) que já ocupa o lugar desta leitura (o centro de uma dentro da outra). */
  #occupant(d) {
    for (const e of this.entries.values()) {
      if (Math.hypot(d.center.x - e.pos.x, d.center.y - e.pos.y) < this.occupied
        || sameFootprint({ center: d.center, yaw: d.yaw }, { center: e.pos, yaw: e.yaw })) return e;
    }
    return null;
  }

  /** A carta conhecida que corresponde à leitura: a mesma carta perto, ou uma cópia que andou. */
  #match(d, seen) {
    let best = null;
    let bestD = Infinity;
    for (const e of this.entries.values()) {
      if (seen.has(e.id) || e.card.oracleId !== d.card.oracleId) continue;
      const dist = Math.hypot(d.center.x - e.pos.x, d.center.y - e.pos.y);
      if (dist < bestD) {
        bestD = dist;
        best = e;
      }
    }
    if (!best) return null;
    if (bestD <= this.matchRadius) return best;
    // Mais longe (a carta foi arrastada): vale se é a única cópia, ou se essa cópia já não estava
    // sendo vista no lugar antigo. Senão é outra cópia da mesma carta, em outro lugar.
    if (bestD <= this.moveRadius && (best.missingSince !== null || this.#onlyCopy(d))) return best;
    return null;
  }

  #onlyCopy(d) {
    let n = 0;
    for (const e of this.entries.values()) if (e.card.oracleId === d.card.oracleId) n++;
    return n === 1;
  }

  /** Esquece tudo (recalibrou a mesa). Retorna os eventos de remoção. */
  clear() {
    const events = [...this.entries.values()].map((entry) => ({ type: 'remove', entry }));
    this.entries.clear();
    this.votes.clear();
    return events;
  }
}

// ---------------------------------------------------------------- plano de leitura por blocos

/** A carta (yaw) fica em pé numa vista de cima cujo "para cima" aponta para `up`? */
export function readableAt(yaw, up) {
  return Math.abs(wrapDeg(yaw - up)) < 45;
}

/**
 * Divide a área de jogo em blocos para o OCR (cada um vira uma vista de cima no cardScanner).
 * Seu lado: cartas com o topo para o oponente (up 0). Lado do oponente: topo para você (up 180).
 * Depois, os mesmos blocos para as cartas viradas (atacando: o dono gira no sentido horário, up +90).
 * visible(pontoDaMesa): o ponto aparece no quadro? Bloco sem nenhum canto (nem o centro) à vista fica
 * de fora. Blocos de ~32 × 20 cm: mesa maior vira mais blocos.
 * Retorna [{ region: {x0, x1, y0, y1} (m), up, owner, tapped }]: primeiro os em pé, depois os virados.
 */
export function planScans(frame, visible = () => true, { blockWidth = 0.32, blockDepth = 0.2 } = {}) {
  const W = frame.width / 2;
  const D = frame.depth / 2;
  // Mesa maior = mais blocos (cada vista de cima continua do mesmo tamanho e rápida de ler).
  const cols = Math.max(1, Math.ceil((2 * W) / blockWidth - 1e-9));
  const rows = Math.max(1, Math.ceil(D / blockDepth - 1e-9));
  const halves = [
    { owner: 'you', up: 0, y0: -D, y1: 0 },
    { owner: 'opponent', up: 180, y0: 0, y1: D },
  ];
  const upright = [];
  for (const half of halves) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const region = {
          x0: -W + (2 * W * c) / cols,
          x1: -W + (2 * W * (c + 1)) / cols,
          y0: half.y0 + ((half.y1 - half.y0) * r) / rows,
          y1: half.y0 + ((half.y1 - half.y0) * (r + 1)) / rows,
        };
        // Vale se qualquer parte aparece (o centro pode estar fora da câmera com cartas à vista).
        const pts = [
          { x: (region.x0 + region.x1) / 2, y: (region.y0 + region.y1) / 2 },
          { x: region.x0, y: region.y0 }, { x: region.x1, y: region.y0 },
          { x: region.x1, y: region.y1 }, { x: region.x0, y: region.y1 },
        ];
        if (!pts.some((q) => visible(q))) continue;
        upright.push({ region, up: half.up, owner: half.owner, tapped: false });
      }
    }
  }
  const tapped = upright.map((j) => ({ ...j, up: wrapDeg(j.up + 90), tapped: true }));
  return [...upright, ...tapped];
}

/** Ordem de leitura: os blocos em pé toda volta, os virados a cada duas voltas. */
export function scanOrder(jobs) {
  const up = jobs.filter((j) => !j.tapped);
  return [...up, ...up, ...jobs.filter((j) => j.tapped)];
}

/** A posição (mesa) está dentro da região (sem a folga)? */
export function inRegion(pos, r) {
  return pos.x >= r.x0 && pos.x <= r.x1 && pos.y >= r.y0 && pos.y <= r.y1;
}

/**
 * Para o TableCards.update: o que o bloco `job` (planScans) podia ver da carta `e`.
 * inView(pos): o lugar aparece na câmera?
 */
export function coverage(job, pos, e, inView) {
  if (!inRegion(pos, job.region)) return null;
  if (!inView(pos)) return false;
  if (readableAt(e.yaw, job.up)) return 'same';
  if (Math.abs(wrapDeg(e.yaw - job.up)) < 135) return 'turned';
  return null; // de ponta-cabeça para este bloco: quem lê é o bloco do outro lado
}

/**
 * Lembra a assinatura de cada bloco lido para pular os que não mudaram (o OCR de um bloco leva
 * segundos; a mesa fica quase toda parada). Um bloco parado ainda é relido de tempos em tempos
 * (`maxAge`), para pegar o que escapou numa leitura.
 */
export class BlockMemory {
  constructor({ threshold = 1.5, maxAge = 30, retry = 8 } = {}) {
    this.retry = retry; // bloco com leitura incompleta (linha de tipo sem nome): volta logo
    this.threshold = threshold;
    this.maxAge = maxAge;
    this.last = new Map(); // chave do bloco → { sig, at, unresolved }
  }

  static key(job) {
    const r = job.region;
    return `${r.x0.toFixed(3)},${r.x1.toFixed(3)},${r.y0.toFixed(3)},${r.y1.toFixed(3)},${job.up}`;
  }

  /** Precisa ler o bloco? change(a, b) mede a diferença entre duas assinaturas. */
  needsRead(job, sig, now, change) {
    const prev = this.last.get(BlockMemory.key(job));
    if (!prev || !sig) return true;
    if (now - prev.at >= (prev.unresolved ? this.retry : this.maxAge)) return true;
    return change(sig, prev.sig) > this.threshold;
  }

  /** unresolved: a leitura achou sinal de carta (linha de tipo) sem conseguir o nome. */
  remember(job, sig, now, unresolved = false) {
    if (sig) this.last.set(BlockMemory.key(job), { sig, at: now, unresolved });
  }

  clear() {
    this.last.clear();
  }
}
