// Porta de TableFrame.cs + TableCalibrationStateMachine.cs (Unity), sem dependência de WebXR (testável no Node).
// Vetores são {x, y, z}; y é "para cima" (o hit-test do WebXR devolve planos horizontais com normal +Y).

export const DEFAULT_WIDTH = 0.6;
export const DEFAULT_DEPTH = 0.7;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Área da mesa: retângulo no plano horizontal, centrado em `center`, com `forward` apontando
 * do jogador para o oponente. Metade perto = "near" (você), metade longe = "far" (oponente).
 */
export class TableFrame {
  constructor(center, forward, width = DEFAULT_WIDTH, depth = DEFAULT_DEPTH) {
    const len = Math.hypot(forward.x, forward.z) || 1;
    this.center = { ...center };
    this.forward = { x: forward.x / len, y: 0, z: forward.z / len };
    this.right = { x: -this.forward.z, y: 0, z: this.forward.x };
    this.width = width;
    this.depth = depth;
  }

  /** Centro tocado + posição da câmera: a frente aponta para longe de quem segura o celular. */
  static fromTap(center, cameraPos, width, depth) {
    const away = sub(center, cameraPos);
    if (Math.hypot(away.x, away.z) < 1e-4) away.z = -1;
    return new TableFrame(center, away, width, depth);
  }

  scaled(factor) {
    return new TableFrame(this.center, this.forward, DEFAULT_WIDTH * factor, DEFAULT_DEPTH * factor);
  }

  recentered(center) {
    return new TableFrame(center, this.forward, this.width, this.depth);
  }

  /** Coordenadas na mesa: x = direita, y = frente (metros a partir do centro). */
  worldToTable(p) {
    const d = sub(p, this.center);
    return { x: dot(d, this.right), y: dot(d, this.forward) };
  }

  tableToWorld(t, height = 0) {
    return {
      x: this.center.x + this.right.x * t.x + this.forward.x * t.y,
      y: this.center.y + height,
      z: this.center.z + this.right.z * t.x + this.forward.z * t.y,
    };
  }

  heightAbove(p) {
    return p.y - this.center.y;
  }

  isOnTable(p, tolerance = 0.02) {
    return Math.abs(this.heightAbove(p)) <= tolerance;
  }

  contains(p, margin = 0) {
    const t = this.worldToTable(p);
    return Math.abs(t.x) <= this.width / 2 - margin && Math.abs(t.y) <= this.depth / 2 - margin;
  }

  /** 'near' (seu lado), 'far' (lado do oponente) ou 'outside'. */
  sideOf(p, margin = 0) {
    if (!this.contains(p, margin)) return 'outside';
    return this.worldToTable(p).y < 0 ? 'near' : 'far';
  }

  corners(height = 0) {
    const w = this.width / 2;
    const d = this.depth / 2;
    return [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, y]) => this.tableToWorld({ x, y }, height));
  }
}

export const State = Object.freeze({
  Scanning: 'scanning',
  NoTableHint: 'noTableHint',
  AwaitingCenterTap: 'awaitingCenterTap',
  Adjusting: 'adjusting',
  Confirmed: 'confirmed',
});

/**
 * Scanning ──(achou plano)──► AwaitingCenterTap ──(toque)──► Adjusting ──(confirm)──► Confirmed
 *    │ 15 s sem plano                                            ▲                        │
 *    ▼                                                           └──── recalibrate ───────┘
 * NoTableHint ──(achou plano)──► AwaitingCenterTap
 * Com o rastreamento perdido, nada avança e toques são ignorados.
 */
export class CalibrationStateMachine {
  constructor(noTableTimeoutSeconds = 15, onChange = () => {}) {
    this.state = State.Scanning;
    this.trackingLost = false;
    this.timeout = noTableTimeoutSeconds;
    this.scanSeconds = 0;
    this.onChange = onChange;
  }

  #go(next) {
    if (next === this.state) return;
    const prev = this.state;
    this.state = next;
    this.onChange(prev, next);
  }

  tick(dt, tableFound, trackingOk) {
    this.trackingLost = !trackingOk;
    if (this.trackingLost) return;
    if (this.state === State.Scanning || this.state === State.NoTableHint) {
      if (tableFound) return this.#go(State.AwaitingCenterTap);
      this.scanSeconds += dt;
      if (this.state === State.Scanning && this.scanSeconds >= this.timeout) this.#go(State.NoTableHint);
    }
  }

  /** Retorna 'centerSet', 'recentered', 'invalid' ou 'ignored'. */
  tap(onPlane) {
    if (this.trackingLost) return 'ignored';
    if (this.state === State.AwaitingCenterTap || this.state === State.Adjusting) {
      if (!onPlane) return 'invalid';
      const wasAdjusting = this.state === State.Adjusting;
      this.#go(State.Adjusting);
      return wasAdjusting ? 'recentered' : 'centerSet';
    }
    return 'ignored';
  }

  confirm() {
    if (this.state !== State.Adjusting) return false;
    this.#go(State.Confirmed);
    return true;
  }

  recalibrate() {
    if (this.state !== State.Confirmed) return false;
    this.#go(State.Adjusting);
    return true;
  }
}
