import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TableFrame, CalibrationStateMachine, State, DEFAULT_WIDTH } from '../src/table/tableFrame.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('frente aponta para longe da câmera e ignora a altura', () => {
  const f = TableFrame.fromTap({ x: 0, y: 0.75, z: -0.5 }, { x: 0, y: 1.4, z: 0 });
  assert.ok(near(f.forward.z, -1) && near(f.forward.y, 0));
});

test('lados, conversão e cantos', () => {
  const f = TableFrame.fromTap({ x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  assert.equal(f.sideOf({ x: 0, y: 0, z: -0.9 }), 'near');
  assert.equal(f.sideOf({ x: 0, y: 0, z: -1.2 }), 'far');
  assert.equal(f.sideOf({ x: 0.5, y: 0, z: -1 }), 'outside');
  const p = f.tableToWorld({ x: 0.1, y: 0.2 });
  const back = f.worldToTable(p);
  assert.ok(near(back.x, 0.1) && near(back.y, 0.2));
  assert.equal(f.corners().length, 4);
  assert.ok(near(f.scaled(2).width, DEFAULT_WIDTH * 2));
  assert.ok(f.isOnTable({ x: 0, y: 0.01, z: -1 }) && !f.isOnTable({ x: 0, y: 0.1, z: -1 }));
});

test('máquina de estados da calibração', () => {
  const sm = new CalibrationStateMachine(15);
  assert.equal(sm.tap(true), 'ignored');
  sm.tick(16, false, true);
  assert.equal(sm.state, State.NoTableHint);
  sm.tick(0.1, true, true);
  assert.equal(sm.state, State.AwaitingCenterTap);
  assert.equal(sm.tap(false), 'invalid');
  assert.equal(sm.tap(true), 'centerSet');
  assert.equal(sm.tap(true), 'recentered');
  sm.tick(0.1, true, false);
  assert.equal(sm.tap(true), 'ignored'); // rastreamento perdido
  sm.tick(0.1, true, true);
  assert.ok(sm.confirm());
  assert.equal(sm.state, State.Confirmed);
  assert.ok(sm.recalibrate());
  assert.equal(sm.state, State.AwaitingCenterTap);
});

test('girar, trocar lados e lado do jogador seguem o Unity', async () => {
  const { Seat } = await import('../src/table/tableFrame.js');
  const f = TableFrame.fromTap({ x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 }); // frente = -z, direita = +x
  const r = f.rotatedBy(90);
  assert.ok(near(r.forward.x, 1) && near(r.forward.z, 0)); // horário visto de cima: frente vira a direita
  const back = f.flipped();
  assert.ok(near(back.forward.z, 1));
  assert.equal(back.sideOf({ x: 0, y: 0, z: -0.9 }), 'far');
  const left = TableFrame.forSeat(Seat.CameraLeft, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  assert.ok(near(left.forward.x, 1)); // quem senta à esquerda da câmera olha para a direita dela
  const right = TableFrame.forSeat(Seat.CameraRight, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  assert.ok(near(right.forward.x, -1));
  const w = f.withForward({ x: 0, y: 0.3, z: 1 });
  assert.ok(near(w.forward.z, 1) && near(w.forward.y, 0));
  assert.equal(f.withForward({ x: 0, y: 1, z: 0 }), f);
  const h = f.handlePosition(0.07);
  assert.ok(near(h.z, -1 - f.depth / 2 - 0.07));
});

test('raio da câmera até a mesa', () => {
  const f = TableFrame.fromTap({ x: 0, y: 0.7, z: -1 }, { x: 0, y: 1.4, z: 0 });
  const hit = f.raycast({ x: 0, y: 1.4, z: 0 }, { x: 0, y: -0.7, z: -1 });
  assert.ok(near(hit.y, 0.7) && near(hit.z, -1));
  assert.equal(f.raycast({ x: 0, y: 1.4, z: 0 }, { x: 0, y: 1, z: 0 }), null); // para cima: não cruza
  assert.equal(f.raycast({ x: 0, y: 1.4, z: 0 }, { x: 1, y: 0, z: 0 }), null); // paralelo
});

test('recalibrar, tentar de novo e confirmar sem rastreamento', () => {
  const sm = new CalibrationStateMachine(15);
  const lost = [];
  sm.onTrackingLost = (v) => lost.push(v);
  sm.tick(16, false, true);
  assert.equal(sm.state, State.NoTableHint);
  sm.retryScan();
  assert.equal(sm.state, State.Scanning);
  assert.equal(sm.scanSeconds, 0);
  sm.tick(0.1, true, true);
  sm.tap(true);
  sm.tick(0.1, true, false);
  assert.equal(sm.confirm(), false); // sem rastreamento não confirma
  sm.tick(0.1, true, true);
  assert.deepEqual(lost, [true, false]);
  assert.ok(sm.confirm());
  sm.recalibrate(true);
  assert.equal(sm.state, State.AwaitingCenterTap);
  sm.tap(true);
  sm.confirm();
  sm.recalibrate(false);
  assert.equal(sm.state, State.Scanning);
});

test('altura da criatura pelo poder', async () => {
  const { creatureHeight } = await import('../src/table/tableFrame.js');
  assert.ok(near(creatureHeight('1'), 0.056));
  assert.ok(near(creatureHeight('7'), 0.112));
  assert.ok(near(creatureHeight('12'), 0.112));
  assert.ok(near(creatureHeight('*'), 0.07));
  assert.ok(near(creatureHeight(null), 0.07));
});

test('histerese do aviso e progresso da busca', async () => {
  const { StableFlag, ScanProgress, polygonAreaXZ } = await import('../src/table/tableFrame.js');
  const flag = new StableFlag(0.5);
  assert.equal(flag.update(false, 0.016), true);
  assert.equal(flag.update(true, 0.3), false);
  assert.equal(flag.update(false, 0.3), false); // voltou antes do tempo: nada muda
  assert.equal(flag.update(true, 0.3), false);
  assert.equal(flag.update(true, 0.3), true);
  assert.equal(flag.value, true);

  const scan = new ScanProgress(0.15, 1);
  scan.update(0.5, { hasHit: true });
  assert.ok(near(scan.value, 0.5) && !scan.found);
  scan.update(0.6, { hasHit: true });
  assert.ok(scan.found);
  scan.reset();
  scan.update(0.1, { hasHit: false, planeArea: 0.3 });
  assert.ok(scan.found);
  assert.ok(near(polygonAreaXZ([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 2 }, { x: 0, z: 2 }]), 2));
});
