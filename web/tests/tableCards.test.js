import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TableCards, measureCard, wrapDeg, yawOf, CARD_W, CARD_H } from '../src/table/tableCards.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const elf = { oracleId: 'elf', name: 'Llanowar Elves' };
const dragon = { oracleId: 'dragon', name: 'Shivan Dragon' };
const det = (card, x, y, yaw = 0) => ({ card, center: { x, y }, yaw });
const types = (ev) => ev.map((e) => `${e.type}:${e.entry.card.oracleId}`);

/** Cantos de uma carta na mesa com o topo apontando para `yaw` graus. */
function cardQuad(cx, cy, yaw, w = CARD_W, h = CARD_H) {
  const a = (yaw * Math.PI) / 180;
  const up = { x: Math.sin(a), y: Math.cos(a) };
  const right = { x: up.y, y: -up.x };
  const p = (u, v) => ({ x: cx + right.x * u + up.x * v, y: cy + right.y * u + up.y * v });
  return [p(-w / 2, h / 2), p(w / 2, h / 2), p(w / 2, -h / 2), p(-w / 2, -h / 2)];
}

test('ângulos', () => {
  assert.equal(wrapDeg(190), -170);
  assert.equal(wrapDeg(-180), 180);
  assert.ok(near(yawOf({ x: 0, y: 1 }), 0));
  assert.ok(near(yawOf({ x: 1, y: 0 }), 90));
  assert.ok(near(Math.abs(yawOf({ x: 0, y: -1 })), 180));
});

test('mede a carta na mesa e valida o tamanho', () => {
  const m = measureCard(cardQuad(0.1, -0.2, 0));
  assert.ok(near(m.center.x, 0.1) && near(m.center.y, -0.2));
  assert.ok(near(m.yaw, 0, 1e-6) && m.sizeOk);
  assert.ok(near(m.width, CARD_W) && near(m.height, CARD_H));
  const opp = measureCard(cardQuad(0, 0.2, 180));
  assert.ok(near(Math.abs(opp.yaw), 180, 1e-6));
  const tapped = measureCard(cardQuad(0, 0, 90));
  assert.ok(near(tapped.yaw, 90, 1e-6));
  // Carta na mão (mais perto da câmera) aparece maior projetada na mesa: não vale.
  assert.equal(measureCard(cardQuad(0, 0, 0, CARD_W * 1.6, CARD_H * 1.6)).sizeOk, false);
  assert.equal(measureCard([null, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]), null);
});

test('carta nova, parada, andou pouco e andou de verdade', () => {
  const t = new TableCards();
  assert.deepEqual(types(t.update([det(elf, 0, -0.2)], 0)), ['spawn:elf']);
  assert.deepEqual(types(t.update([det(elf, 0.005, -0.2, 3)], 1)), []); // zona morta: 5 mm e 3°
  assert.deepEqual(types(t.update([det(elf, 0.04, -0.2)], 2)), ['move:elf']);
  const e = [...t.entries.values()][0];
  assert.ok(near(e.pos.x, 0.04));
  // Arrastada 12 cm (única cópia): é a mesma carta, não outra.
  assert.deepEqual(types(t.update([det(elf, 0.16, -0.2)], 3)), ['move:elf']);
  assert.equal(t.entries.size, 1);
});

test('duas cópias da mesma carta em lugares diferentes', () => {
  const t = new TableCards();
  t.update([det(elf, -0.1, -0.2), det(elf, 0.1, -0.2)], 0);
  assert.equal(t.entries.size, 2);
  // As duas lidas de novo no mesmo lugar: nada muda.
  assert.deepEqual(types(t.update([det(elf, 0.1, -0.2), det(elf, -0.1, -0.2)], 1)), []);
  // Uma terceira, a 10 cm das outras (duas cópias já vistas): é nova.
  assert.deepEqual(types(t.update([det(elf, -0.1, -0.2), det(elf, 0.1, -0.2), det(elf, 0, -0.05)], 2)), ['spawn:elf']);
});

test('virar para atacar e desvirar', () => {
  const t = new TableCards();
  t.update([det(dragon, 0, -0.2, 0)], 0);
  assert.deepEqual(types(t.update([det(dragon, 0, -0.2, 88)], 1)), ['move:dragon', 'tap:dragon']);
  assert.equal([...t.entries.values()][0].tapped, true);
  assert.deepEqual(types(t.update([det(dragon, 0, -0.2, 2)], 2)), ['move:dragon', 'untap:dragon']);
  // Carta do oponente (topo para você) virada também conta.
  const o = new TableCards();
  o.update([det(dragon, 0, 0.2, 180)], 0);
  assert.deepEqual(types(o.update([det(dragon, 0, 0.2, -95)], 1)), ['move:dragon', 'tap:dragon']);
});

test('some só depois de um tempo à vista; fora de vista não conta', () => {
  const t = new TableCards({ lostAfter: 10 });
  t.update([det(elf, 0, -0.2)], 0);
  assert.deepEqual(types(t.update([], 1)), []);
  assert.deepEqual(types(t.update([], 8)), []);
  assert.deepEqual(types(t.update([], 11)), ['remove:elf']);
  // Coberta / fora do quadro: não some.
  const u = new TableCards({ lostAfter: 10 });
  u.update([det(elf, 0, -0.2)], 0);
  u.update([], 5, () => false);
  assert.deepEqual(types(u.update([], 30, () => false)), []);
  assert.deepEqual(types(u.update([], 31)), []); // voltou à vista: o tempo recomeça
  assert.deepEqual(types(u.update([], 42)), ['remove:elf']);
  // Vista de novo antes do prazo: zera.
  const v = new TableCards({ lostAfter: 10 });
  v.update([det(elf, 0, -0.2)], 0);
  v.update([], 6);
  v.update([det(elf, 0, -0.2)], 9);
  assert.deepEqual(types(v.update([], 18)), []);
});

test('leitura por blocos: outro bloco não mexe; carta virada não some antes do bloco "virado"', () => {
  const t = new TableCards({ lostAfter: 5 });
  t.update([det(dragon, 0, -0.2, 0)], 0);
  // Blocos que não cobrem a carta: nada muda, por mais tempo que passe.
  assert.deepEqual(types(t.update([], 20, () => null)), []);
  // A carta foi virada: o bloco "em pé" não a lê...
  assert.deepEqual(types(t.update([], 21, () => 'same')), []);
  assert.deepEqual(types(t.update([], 40, () => 'same')), []);
  // ...e o bloco "virado" lê: é a mesma carta, que atacou.
  assert.deepEqual(types(t.update([det(dragon, 0, -0.2, 90)], 41, () => 'turned')), ['move:dragon', 'tap:dragon']);
  // Tirada da mesa: só some depois de faltar nos dois tipos de bloco, e passado o prazo.
  assert.deepEqual(types(t.update([], 50, () => 'same')), []);
  assert.deepEqual(types(t.update([], 70, () => 'turned')), []); // agora conta: desde 70
  assert.deepEqual(types(t.update([], 74, () => null)), []);
  assert.deepEqual(types(t.update([], 76, () => 'same')), ['remove:dragon']);
});

test('o que cada bloco cobre', async () => {
  const { coverage } = await import('../src/table/tableCards.js');
  const job = { region: { x0: -0.3, x1: 0, y0: -0.35, y1: 0 }, up: 0 };
  const seen = () => true;
  assert.equal(coverage(job, { x: 0.1, y: -0.1 }, { yaw: 0 }, seen), null); // fora do bloco
  assert.equal(coverage(job, { x: -0.1, y: -0.1 }, { yaw: 0 }, () => false), false); // fora da câmera
  assert.equal(coverage(job, { x: -0.1, y: -0.1 }, { yaw: 10 }, seen), 'same');
  assert.equal(coverage(job, { x: -0.1, y: -0.1 }, { yaw: 95 }, seen), 'turned');
  assert.equal(coverage(job, { x: -0.1, y: -0.1 }, { yaw: 180 }, seen), null);
});

test('recalibrar esquece tudo', () => {
  const t = new TableCards();
  t.update([det(elf, 0, -0.2), det(dragon, 0.1, 0.2, 180)], 0);
  assert.deepEqual(types(t.clear()), ['remove:elf', 'remove:dragon']);
  assert.equal(t.entries.size, 0);
});

test('a criatura olha para onde aponta o topo da carta', async () => {
  const { facingFromYaw } = await import('../src/table/tableVisuals.js');
  // Modelo olha para +Z local; frente da mesa = -Z local.
  const look = (yaw) => { const r = facingFromYaw(yaw); return { x: Math.sin(r), z: Math.cos(r) }; };
  const fwd = look(0);
  assert.ok(near(fwd.x, 0, 1e-9) && near(fwd.z, -1, 1e-9)); // sua carta: olha para o oponente
  const back = look(180);
  assert.ok(near(back.z, 1, 1e-9)); // carta do oponente: olha para você
  const right = look(90);
  assert.ok(near(right.x, 1, 1e-9)); // virada para a direita
});

test('ponto da mesa → pixel da foto da RA (matrizes da vista)', async () => {
  const THREE = await import('three');
  const { projectShot } = await import('../src/table/xrCameraImage.js');
  const cam = new THREE.PerspectiveCamera(60, 1280 / 720, 0.05, 20);
  cam.position.set(0.1, 0.6, 0.4);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const shot = { w: 1280, h: 720, proj: cam.projectionMatrix.toArray(), view: cam.matrixWorld.toArray() };
  const pw = { x: 0.12, y: 0, z: -0.15 };
  const ndc = new THREE.Vector3(pw.x, pw.y, pw.z).project(cam);
  const px = projectShot(pw, shot);
  assert.ok(near(px.x, ((ndc.x + 1) / 2) * 1280, 1e-6) && near(px.y, ((1 - ndc.y) / 2) * 720, 1e-6));
  assert.equal(projectShot({ x: 0.1, y: 0.6, z: 1.4 }, shot), null); // atrás da câmera
});

test('binarização local: texto escuro vira preto, fundos lisos viram branco', async () => {
  const { binarize } = await import('../src/table/cardScanner.js');
  const w = 60;
  const h = 20;
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Metade esquerda escura (mesa), metade direita clara (faixa do nome) com uma "letra" escura.
      let v = x < 30 ? 50 : 230;
      if (x >= 40 && x < 43 && y >= 6 && y < 14) v = 20;
      gray[y * w + x] = v;
    }
  }
  const out = binarize(gray, w, h, 15, 8);
  const at = (x, y) => out[(y * w + x) * 4];
  assert.equal(at(41, 10), 0); // a letra
  assert.equal(at(55, 3), 255); // faixa clara
  assert.equal(at(5, 10), 255); // mesa escura e lisa: fundo branco, não um borrão preto
});

test('plano de leitura: blocos de cada lado, em pé e virados', async () => {
  const { planScans, scanOrder, readableAt, inRegion } = await import('../src/table/tableCards.js');
  const { TableFrame } = await import('../src/table/tableFrame.js');
  assert.ok(readableAt(5, 0) && !readableAt(90, 0) && readableAt(-170, 180) && readableAt(90, 90));
  const frame = new TableFrame({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  const jobs = planScans(frame);
  const up = jobs.filter((j) => !j.tapped);
  assert.equal(up.length, 8);
  assert.ok(up.every((j) => (j.owner === 'you' ? j.up === 0 && j.region.y1 <= 0 : j.up === 180 && j.region.y0 >= 0)));
  assert.ok(jobs.filter((j) => j.tapped).every((j) => (j.owner === 'you' ? j.up === 90 : j.up === -90)));
  for (const p of [{ x: -0.29, y: -0.34 }, { x: 0.29, y: -0.01 }, { x: 0, y: 0.34 }, { x: -0.2, y: 0.2 }]) {
    assert.ok(up.some((j) => inRegion(p, j.region)), `(${p.x}, ${p.y})`);
  }
  // Fora de vista: o bloco sai do plano.
  assert.equal(planScans(frame, (c) => c.y < 0).filter((j) => !j.tapped).length, 4);
  // Em pé duas vezes por volta, virados uma.
  assert.equal(scanOrder(jobs).length, 8 * 2 + 8);
});

test('vista de cima: pixel ↔ mesa e "para cima" certo', async () => {
  const { topDownView, RES } = await import('../src/table/cardScanner.js');
  const region = { x0: -0.3, x1: 0, y0: -0.35, y1: 0 };
  const v = topDownView(region, 0, RES, 0);
  assert.equal(v.w, 1500);
  assert.equal(v.h, 1750);
  const tl = v.toTable(0, 0);
  assert.ok(near(tl.x, -0.3, 1e-9) && near(tl.y, 0, 1e-9)); // canto de cima à esquerda = longe à esquerda
  const back = v.toPixel({ x: -0.1, y: -0.2 });
  const again = v.toTable(back.u, back.v);
  assert.ok(near(again.x, -0.1, 1e-9) && near(again.y, -0.2, 1e-9));
  // Lado do oponente (up 180): o "para cima" da vista aponta para você.
  const o = topDownView({ x0: 0, x1: 0.3, y0: 0, y1: 0.35 }, 180, RES, 0);
  const otl = o.toTable(0, 0);
  assert.ok(near(otl.x, 0.3, 1e-9) && near(otl.y, 0, 1e-9));
});

test('outro nome lido em cima de uma carta: ignora, a não ser que se repita (trocaram a carta)', () => {
  const t = new TableCards({ swapVotes: 3 });
  const cat = { oracleId: 'cat', name: 'Cat Dragon' };
  t.update([det(dragon, -0.19, -0.16)], 0);
  assert.deepEqual(types(t.update([det(cat, -0.19, -0.16)], 1)), []); // leitura errada
  assert.deepEqual(types(t.update([det(dragon, -0.19, -0.16)], 2)), []); // o nome certo zera os votos
  assert.deepEqual(types(t.update([det(cat, -0.19, -0.16)], 3)), []);
  assert.deepEqual(types(t.update([det(cat, -0.19, -0.16)], 4)), []);
  assert.deepEqual(types(t.update([det(cat, -0.19, -0.16)], 5)), ['remove:dragon', 'spawn:cat']);
  assert.equal(t.entries.size, 1);
  // Outra carta ao lado (a 8 cm) não é conflito.
  assert.deepEqual(types(t.update([det(cat, -0.19, -0.16), det(elf, -0.11, -0.16)], 6)), ['spawn:elf']);
});

test('completa a carta pela borda de cima e estima pelo nome', async () => {
  const { completeFromTop, cardFromTitle } = await import('../src/table/tableCards.js');
  // Carta inclinada 20°, detector parou a 58 mm.
  const full = cardQuad(0.1, -0.1, 20);
  const short = [full[0], full[1], { x: full[1].x + (full[2].x - full[1].x) * 0.66, y: full[1].y + (full[2].y - full[1].y) * 0.66 }, { x: full[0].x + (full[3].x - full[0].x) * 0.66, y: full[0].y + (full[3].y - full[0].y) * 0.66 }];
  assert.equal(measureCard(short).sizeOk, false);
  const fixed = measureCard(completeFromTop(short));
  assert.ok(fixed.sizeOk && near(fixed.center.x, 0.1, 1e-9) && near(fixed.center.y, -0.1, 1e-9) && near(fixed.yaw, 20, 1e-6));
  // Borda de cima larga demais (pegou duas cartas): não inventa.
  assert.equal(completeFromTop(cardQuad(0, 0, 0, CARD_W * 1.5)), null);
  // Pelo nome: o nome de uma carta de 315 × 440 px (5 px/mm) começa em x = 23,6 e tem o centro em y = 31,7.
  const q = cardFromTitle({ x0: 100 + 23.625, y0: 200 + 31.68 - 8, x1: 260, y1: 200 + 31.68 + 8 }, 5000);
  assert.ok(near(q[0].x, 100, 1e-6) && near(q[0].y, 200, 1e-6) && near(q[2].x, 415, 1e-6) && near(q[2].y, 640, 1e-6));
});
