// Vigia das cartas reconhecidas, rodando várias vezes por segundo nos dois modos Mesa (sem OCR).
// Para cada carta conhecida recorta só o pedacinho da imagem em volta dela, monta a vista de cima
// (turnWatch.js) e decide se ela foi virada (atacar), desvirada, girada de ponta-cabeça ou tirada.
// O OCR (cardScanner) continua achando as cartas novas e as que mudaram de lugar.

import { TurnTracker, patchView } from './turnWatch.js';
import { resampleTopDown } from './cardScanner.js';
import { wrapDeg } from './tableCards.js';

const SOURCE_SIDE = 160; // px: o pedaço da imagem em volta da carta é reduzido até este tamanho

export class CardWatch {
  /** cards: TableCards; recognized: RecognizedCreatures. */
  constructor(cards, recognized) {
    this.cards = cards;
    this.recognized = recognized;
    this.trackers = new Map(); // id da carta → { tracker, refYaw }
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * Uma rodada. source: o quadro (vídeo ou canvas), srcW × srcH; toImage(pontoDaMesa) → pixel do
   * quadro ou null; now: segundos.
   */
  tick(source, srcW, srcH, toImage, now) {
    for (const id of this.trackers.keys()) if (!this.cards.entries.has(id)) this.trackers.delete(id);
    for (const e of [...this.cards.entries.values()]) {
      let t = this.trackers.get(e.id);
      if (!t) {
        t = { tracker: new TurnTracker(), refYaw: e.baseYaw };
        this.trackers.set(e.id, t);
      }
      const view = patchView(e.pos, t.refYaw);
      const corners = [[0, 0], [view.w, 0], [view.w, view.h], [0, view.h]].map(([u, v]) => toImage(view.toTable(u, v)));
      if (corners.some((c) => !c)) continue;
      const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))));
      const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))));
      const x1 = Math.min(srcW, Math.ceil(Math.max(...corners.map((c) => c.x))));
      const y1 = Math.min(srcH, Math.ceil(Math.max(...corners.map((c) => c.y))));
      if (x1 - x0 < 8 || y1 - y0 < 8) continue; // fora da câmera
      const s = Math.min(1, SOURCE_SIDE / Math.max(x1 - x0, y1 - y0));
      const w = Math.max(2, Math.round((x1 - x0) * s));
      const h = Math.max(2, Math.round((y1 - y0) * s));
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx.drawImage(source, x0, y0, x1 - x0, y1 - y0, 0, 0, w, h);
      const px = this.ctx.getImageData(0, 0, w, h).data;
      const data = new Float32Array(w * h);
      for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
      const toSub = (p) => {
        const q = toImage(p);
        return q && { x: (q.x - x0) * s, y: (q.y - y0) * s };
      };
      const patch = resampleTopDown({ data, w, h }, view, toSub);
      if (!patch) continue;
      const r = t.tracker.update(patch, view.w, now);
      if (r.present === true) this.cards.seen(e.id, now);
      else if (r.present === false) this.cards.absent(e.id, now);
      if (r.turn !== null) {
        this.recognized.apply(this.cards.turn(e.id, wrapDeg(t.refYaw + r.turn), now));
        // De ponta-cabeça a carta passa a ter esse giro como "em pé": nova referência.
        if (r.turn === 180) {
          t.tracker.reset();
          t.refYaw = e.baseYaw;
        }
      }
    }
    this.recognized.apply(this.cards.expire(now));
  }

  clear() {
    this.trackers.clear();
  }
}
