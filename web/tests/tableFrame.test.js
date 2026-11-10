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
  assert.equal(sm.state, State.Adjusting);
});
