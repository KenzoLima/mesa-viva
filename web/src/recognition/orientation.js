// Leitura de cartas em qualquer orientação.
//
// O Tesseract só lê texto em pé: a carta de ponta-cabeça (a do oponente, do outro lado da mesa) e a
// carta virada de lado (virada/"tapped") passam batido. Por isso cada leitura usa o quadro girado
// em 0°, 180°, 90° ou 270°: no quadro girado o nome fica em pé, o cardDetector acha o contorno
// normalmente e os cantos voltam para o quadro original com fromRotated.
//
// Os cantos continuam na ordem da CARTA (topo-esq. da carta, topo-dir., base-dir., base-esq.), não
// da tela: numa carta de ponta-cabeça o "topo" fica embaixo na tela, e a criatura olha para quem a
// vê de frente (como a criatura do oponente).
//
// Puro (sem DOM): roda nos testes do Node.

/**
 * Ordem das leituras. A maioria em pé; ponta-cabeça bem frequente (cartas do oponente);
 * de lado de vez em quando (carta virada que se perdeu e precisa ser reencontrada).
 */
export const ROTATIONS = [0, 180, 0, 180, 0, 90, 0, 180, 0, 180, 0, 270];
/** Com alguma carta perdida (a mão passou na frente ao virar a carta), todas as orientações por igual. */
export const ROTATIONS_LOST = [0, 90, 180, 270];

/** Giro (graus, horário na tela) da leitura número `pass`. */
export function rotationFor(pass, lost = false) {
  const list = lost ? ROTATIONS_LOST : ROTATIONS;
  return list[((pass % list.length) + list.length) % list.length];
}

/** Tamanho da imagem w×h depois de girada `deg` graus. */
export function rotatedSize(w, h, deg) {
  return deg % 180 ? { w: h, h: w } : { w, h };
}

/**
 * Ponto da imagem w×h ORIGINAL levado para a imagem girada `deg` graus (horário).
 * (Mesmo giro do canvas: translate(centro) + rotate(deg) + drawImage centrado.)
 */
export function toRotated(p, deg, w, h) {
  const a = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(a));
  const s = Math.round(Math.sin(a));
  const r = rotatedSize(w, h, deg);
  const x = p.x - w / 2;
  const y = p.y - h / 2;
  return { x: x * c - y * s + r.w / 2, y: x * s + y * c + r.h / 2 };
}

/** Ponto da imagem girada `deg` graus levado de volta para a imagem w×h original. */
export function fromRotated(p, deg, w, h) {
  const a = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(a));
  const s = Math.round(Math.sin(a));
  const r = rotatedSize(w, h, deg);
  const x = p.x - r.w / 2;
  const y = p.y - r.h / 2;
  return { x: x * c + y * s + w / 2, y: -x * s + y * c + h / 2 };
}

/**
 * Desenha `src` girado `deg` graus (horário) e reduzido `scale` vezes em `dst` (canvas).
 * Só no navegador.
 */
export function drawRotated(src, deg, dst, scale = 1) {
  const r = rotatedSize(src.width, src.height, deg);
  dst.width = Math.round(r.w * scale);
  dst.height = Math.round(r.h * scale);
  const ctx = dst.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(dst.width / 2, dst.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return ctx;
}

/** Quadro cinza { data, w, h } girado `deg` graus (horário). Para os testes e para o Node. */
export function rotateGray(frame, deg) {
  const { w, h } = frame;
  const r = rotatedSize(w, h, deg);
  const data = new Float32Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const p = fromRotated({ x: x + 0.5, y: y + 0.5 }, deg, w, h);
      const sx = Math.min(w - 1, Math.max(0, Math.floor(p.x)));
      const sy = Math.min(h - 1, Math.max(0, Math.floor(p.y)));
      data[y * r.w + x] = frame.data[sy * w + sx];
    }
  }
  return { ...frame, data, w: r.w, h: r.h, pyr: undefined };
}
