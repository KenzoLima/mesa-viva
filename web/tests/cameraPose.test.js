import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calibrateFromCard, calibrateFromRect, refineCorners, REFERENCES, solveHomography, orderCorners, cardTableCorners, coverIntrinsics, projectionMatrix,
  cameraWorldMatrix, rayFromView, projectToView, videoToView, viewToVideo, defaultFocal, imageShift, cameraMoved, edgePixels,
} from '../src/table/cameraPose.js';

const W = 1280;
const H = 720;

/** Câmera de verdade (OpenCV) olhando de `eye` para `target`, em coordenadas do mundo (Three.js). */
function trueCamera(eye, target, f) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const n = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const z = n(sub(target, eye));
  const x = n(cross(z, [0, 1, 0]));
  const y = cross(z, x);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (p) => {
    const d = sub([p.x, p.y, p.z], eye);
    return { x: (f * dot(d, x)) / dot(d, z) + W / 2, y: (f * dot(d, y)) / dot(d, z) + H / 2 };
  };
}
const tableToWorld = (p) => ({ x: p.x, y: 0, z: -p.y });

function scene({ eye = [0.08, 0.55, 0.5], f = 950, noise = 0, size = [] } = {}) {
  const project = trueCamera(eye, [0, 0, 0], f);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 2; };
  const corners = cardTableCorners(...size).map((c) => {
    const p = project(tableToWorld(c));
    return { x: p.x + rnd() * noise, y: p.y + rnd() * noise };
  });
  return { eye, f, project, corners };
}

const close = (a, b, tol) => Math.abs(a - b) <= tol;

test('homografia leva os 4 pontos certinho', () => {
  const src = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const dst = [{ x: 10, y: 20 }, { x: 110, y: 25 }, { x: 120, y: 140 }, { x: 5, y: 130 }];
  const Hm = solveHomography(src, dst);
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const w = Hm[2][0] * x + Hm[2][1] * y + 1;
    assert.ok(close((Hm[0][0] * x + Hm[0][1] * y + Hm[0][2]) / w, dst[i].x, 1e-6));
    assert.ok(close((Hm[1][0] * x + Hm[1][1] * y + Hm[1][2]) / w, dst[i].y, 1e-6));
  }
  assert.equal(solveHomography(src, [dst[0], dst[0], dst[0], dst[0]]), null);
});

test('ordena os cliques em qualquer ordem', () => {
  const { corners } = scene();
  const shuffled = [corners[2], corners[0], corners[3], corners[1]];
  assert.deepEqual(orderCorners(shuffled), corners);
});

test('acha a câmera e a focal pela carta (sem ruído)', () => {
  const s = scene();
  const cal = calibrateFromCard([...s.corners].reverse(), W, H);
  assert.ok(cal.ok);
  assert.ok(cal.focalEstimated);
  assert.ok(close(cal.f, s.f, s.f * 0.01), `f=${cal.f}`);
  assert.ok(close(cal.camWorld.x, s.eye[0], 0.005));
  assert.ok(close(cal.camWorld.y, s.eye[1], 0.005));
  assert.ok(close(cal.camWorld.z, s.eye[2], 0.005));
});

test('folha A4 com cliques de ±0,5 px: a borda da área desalinha poucos pixels', () => {
  const a4 = [REFERENCES.a4.width, REFERENCES.a4.height];
  const s = scene({ noise: 0.5, size: a4 });
  const cal = calibrateFromRect(s.corners, W, H);
  assert.ok(cal.ok && cal.focalEstimated);
  const k = coverIntrinsics(cal, W, H, W, H);
  for (const [x, y] of [[-0.3, -0.35], [0.3, -0.35], [0.3, 0.35], [-0.3, 0.35]]) {
    const pw = { x, y: 0, z: -y };
    const a = projectToView(pw, k, cal);
    const b = s.project(pw);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 8, `canto (${x}, ${y}) a ${Math.hypot(a.x - b.x, a.y - b.y).toFixed(1)} px`);
  }
});

test('descobre se a folha está em pé ou deitada', () => {
  const standing = calibrateFromRect(scene({ size: [0.21, 0.297] }).corners, W, H);
  assert.ok(Math.abs(standing.width - 0.21) < 1e-9 && Math.abs(standing.height - 0.297) < 1e-9);
  const lying = calibrateFromRect(scene({ size: [0.297, 0.21] }).corners, W, H);
  assert.ok(Math.abs(lying.width - 0.297) < 1e-9 && Math.abs(lying.height - 0.21) < 1e-9);
});

test('retângulo de frente para a câmera: usa a focal padrão', () => {
  const s = scene({ eye: [0, 0.7, 0.0001], size: [0.21, 0.297] });
  const cal = calibrateFromRect(s.corners, W, H);
  assert.ok(cal.ok);
  assert.equal(cal.focalEstimated, false);
  assert.ok(close(cal.f, defaultFocal(W), 1e-6));
});

test('imã: encaixa cantos clicados tortos na borda real', () => {
  // Folha clara sobre mesa escura, com borda suavizada (supersample 4×4).
  const gw = 320;
  const gh = 240;
  const quad = [{ x: 92.3, y: 61.7 }, { x: 231.6, y: 70.2 }, { x: 251.4, y: 188.9 }, { x: 70.8, y: 176.1 }];
  const inside = (x, y) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      const z = Math.sign((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x));
      if (sign && z && z !== sign) return false;
      sign ||= z;
    }
    return true;
  };
  const data = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let n = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) n += inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4);
      data[y * gw + x] = 40 + (200 * n) / 16 + ((x * 7 + y * 3) % 5); // um pouco de textura
    }
  }
  // O centro do pixel (x, y) é x + 0,5: a borda amostrada fica meio pixel deslocada.
  const truth = quad.map((p) => ({ x: p.x - 0.5, y: p.y - 0.5 }));
  const clicks = [{ x: 95, y: 58 }, { x: 228, y: 73 }, { x: 254, y: 186 }, { x: 68, y: 179 }];
  const { corners, snapped } = refineCorners({ data, width: gw, height: gh }, clicks);
  assert.equal(snapped, 4);
  corners.forEach((c, i) => assert.ok(Math.hypot(c.x - truth[i].x, c.y - truth[i].y) < 0.35, `canto ${i}: ${c.x.toFixed(2)},${c.y.toFixed(2)}`));
  // Sem borda (imagem lisa): mantém os cliques.
  const flat = refineCorners({ data: new Float32Array(gw * gh).fill(90), width: gw, height: gh }, clicks);
  assert.equal(flat.snapped, 0);
});

test('projeção, raio e matriz da câmera concordam com a câmera de verdade', () => {
  const s = scene();
  const cal = calibrateFromCard(s.corners, W, H, { focal: s.f });
  const k = coverIntrinsics(cal, W, H, 844, 390); // tela de celular deitado: corta em cima e embaixo
  const pw = { x: 0.2, y: 0, z: -0.25 };
  const trueVideo = s.project(pw);
  const view = projectToView(pw, k, cal);
  const back = viewToVideo(view, k);
  assert.ok(close(back.x, trueVideo.x, 0.5) && close(back.y, trueVideo.y, 0.5));
  assert.deepEqual(videoToView(back, k).x.toFixed(6), view.x.toFixed(6));

  // Raio pelo pixel cruza a mesa no mesmo ponto.
  const { origin, direction } = rayFromView(view, k, cal);
  const tHit = -origin.y / direction.y;
  assert.ok(close(origin.x + direction.x * tHit, pw.x, 1e-6) && close(origin.z + direction.z * tHit, pw.z, 1e-6));

  // Matriz de projeção × inversa da matriz da câmera = mesmo pixel.
  const M = cameraWorldMatrix(cal);
  const P = projectionMatrix(k);
  const e = M.slice(12, 15);
  const axes = [M.slice(0, 3), M.slice(4, 7), M.slice(8, 11)];
  const d = [pw.x - e[0], pw.y - e[1], pw.z - e[2]];
  const pc = axes.map((a) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2]); // câmera do Three
  const clip = [0, 1, 2, 3].map((r) => P[r] * pc[0] + P[4 + r] * pc[1] + P[8 + r] * pc[2] + P[12 + r]);
  const ndc = { x: clip[0] / clip[3], y: clip[1] / clip[3] };
  assert.ok(close((ndc.x + 1) / 2 * k.width, view.x, 1e-6));
  assert.ok(close((1 - ndc.y) / 2 * k.height, view.y, 1e-6));
  assert.ok(Math.abs(ndc.x) < 1 && clip[3] > 0);
});

test('câmera mexida pelo deslocamento da imagem (mesa de textura suave)', () => {
  const w = 80;
  const h = 45;
  // Textura suave: manchas grandes (como madeira vista de longe), com coordenadas contínuas.
  const tex = (x, y) => 90 + 25 * Math.sin(x * 0.21 + y * 0.05) + 18 * Math.sin(y * 0.33 - x * 0.07) + 10 * Math.sin((x + y) * 0.5);
  const img = (sx = 0, sy = 0, f = () => null) => {
    const o = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[y * w + x] = f(x, y) ?? tex(x + sx, y + sy);
    return o;
  };
  const ref = img();
  const still = imageShift(ref, img(), w, h);
  assert.ok(!cameraMoved(still), JSON.stringify(still));
  const nudged = imageShift(ref, img(1.4, 0), w, h); // ~22 px num vídeo de 1280
  assert.ok(cameraMoved(nudged), JSON.stringify(nudged));
  assert.equal(nudged.dx, -1);
  const tilted = imageShift(ref, img(0, -2.6), w, h);
  assert.ok(cameraMoved(tilted), JSON.stringify(tilted));
  const hand = imageShift(ref, img(0, 0, (x, y) => (x > 45 && y > 18 ? 200 : null)), w, h); // ~28% da imagem
  assert.ok(!cameraMoved(hand), JSON.stringify(hand));
  const light = imageShift(ref, img(0, 0, (x, y) => tex(x, y) + 30), w, h);
  assert.ok(!cameraMoved(light), JSON.stringify(light));
  // Folha tirada da mesa: um retângulo claro some, o resto fica no lugar.
  const withPaper = img(0, 0, (x, y) => (x > 30 && x < 50 && y > 12 && y < 34 ? 230 : null));
  const paperGone = imageShift(withPaper, img(), w, h);
  assert.ok(!cameraMoved(paperGone), JSON.stringify(paperGone));
  assert.ok(edgePixels(new Float32Array(w * h).fill(80), w, h).length === 0); // lisa: sem bordas
});
