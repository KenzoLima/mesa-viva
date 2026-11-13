// Pose 3D da carta a partir do contorno na tela, e o "virar" da carta (tap): a carta girada 90° em
// relação a como estava quando a criatura surgiu.
//
// O giro é medido no PLANO DA CARTA (pela pose 3D), não na tela: com a mesa vista de lado, uma carta
// girada 90° na mesa aparece girada bem menos que 90° na tela (o eixo da profundidade encolhe).

import * as THREE from 'three';

export const AX = new THREE.Vector3(); // direita da carta
export const AY = new THREE.Vector3(); // normal da carta
export const AZ = new THREE.Vector3(); // topo da carta
const BASIS = new THREE.Matrix4();

/**
 * Orientação 3D da carta a partir do contorno na tela (q = [topo-esq, topo-dir, base-dir, base-esq]).
 * Resolve a pose de um retângulo 63x88 em projeção quase ortográfica; a perspectiva (lado mais
 * curto = mais longe) decide para que lado ela inclina. Preenche AX (direita da carta),
 * AY (normal da carta) e AZ (direção do topo da carta).
 */
export function cardPose(q) {
  const mid = (p1, p2) => ({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
  const len = (p1, p2) => Math.hypot(p2.x - p1.x, p2.y - p1.y);
  // Eixos da carta na cena (y para cima): u = esquerda→direita, v = topo→base.
  const l = mid(q[0], q[3]), r = mid(q[1], q[2]), t = mid(q[0], q[1]), b = mid(q[3], q[2]);
  const u = { x: (r.x - l.x) / 63, y: -(r.y - l.y) / 63 };
  const v = { x: (b.x - t.x) / 88, y: -(b.y - t.y) / 88 };
  const uu = u.x * u.x + u.y * u.y, vv = v.x * v.x + v.y * v.y, uv = u.x * v.x + u.y * v.y;
  const sum = uu + vv;
  const s2 = (sum + Math.sqrt(Math.max(0, sum * sum - 4 * (uu * vv - uv * uv)))) / 2 || 1;
  let vz = Math.sqrt(Math.max(0, 1 - vv / s2));
  let uz = Math.sqrt(Math.max(0, 1 - uu / s2));
  // A borda mais perto da câmera aparece maior.
  if (len(q[3], q[2]) < len(q[0], q[1])) vz = -vz;
  if (Math.abs(vz) > 1e-3) uz = -uv / s2 / vz;
  else if (len(q[1], q[2]) < len(q[0], q[3])) uz = -uz;
  const s = Math.sqrt(s2);
  AX.set(u.x / s, u.y / s, uz).normalize(); // direita da carta
  AZ.set(-v.x / s, -v.y / s, -vz).normalize(); // topo da carta = para onde a criatura olha
  AY.crossVectors(AZ, AX).normalize(); // normal da carta = "para cima" da criatura
  if (AY.z < 0) AY.negate();
  AX.crossVectors(AY, AZ).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(BASIS.makeBasis(AX, AY, AZ));
}

const E1 = new THREE.Vector3();
const E2 = new THREE.Vector3();
const SCREEN_UP = new THREE.Vector3(0, 1, 0);

/**
 * Para onde o topo da carta aponta, em graus, girando no plano da própria carta (da mesa).
 * 0 = topo da carta para o alto da tela; ±90 = de lado; ±180 = de ponta-cabeça.
 */
export function cardYaw(q) {
  cardPose(q);
  // Referência no plano da carta: o "alto da tela" projetado na mesa.
  E1.copy(SCREEN_UP).addScaledVector(AY, -AY.dot(SCREEN_UP));
  if (E1.lengthSq() < 1e-6) E1.set(0, 0, -1).addScaledVector(AY, -AY.z);
  E1.normalize();
  E2.crossVectors(AY, E1);
  return Math.atan2(AZ.dot(E2), AZ.dot(E1)) * (180 / Math.PI);
}

/** Diferença entre dois ângulos, em [-180, 180). */
export const angleDiff = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;

/**
 * Percebe quando a carta é virada (tap): girada ~90° em relação a como estava quando a criatura
 * surgiu, para qualquer lado. De ponta-cabeça (180°) conta como desvirada.
 * Com histerese e um tempo mínimo na nova posição: o contorno tremendo não dispara nada.
 */
export class TapWatcher {
  constructor({ enter = 60, exit = 30, hold = 0.25 } = {}) {
    this.enter = enter; // graus para contar como virada
    this.exit = exit; // abaixo disto volta a contar como desvirada
    this.hold = hold; // segundos na nova posição antes de valer
    this.base = null; // giro quando a criatura surgiu
    this.tapped = false;
    this.timer = 0;
  }

  /** Quanto a carta está virada: 0 = como surgiu (ou de ponta-cabeça), 90 = de lado. */
  turn(yaw) {
    const d = Math.abs(angleDiff(yaw, this.base ?? yaw));
    return Math.min(d, 180 - d);
  }

  /** Novo giro medido. Retorna true só no momento em que a carta acaba de ser virada. */
  update(yaw, dt) {
    if (this.base === null) {
      this.base = yaw;
      return false;
    }
    const d = this.turn(yaw);
    const want = this.tapped ? d > this.exit : d >= this.enter;
    if (want === this.tapped) {
      this.timer = 0;
      return false;
    }
    this.timer += dt;
    if (this.timer < this.hold) return false;
    this.tapped = want;
    this.timer = 0;
    return want;
  }
}
