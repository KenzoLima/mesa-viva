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

  /** Lado do jogador em relação à câmera (botões "De que lado você está?"), como TableFrame.ForSeat. */
  static forSeat(seat, center, cameraPos, width, depth) {
    const frame = TableFrame.fromTap(center, cameraPos, width, depth);
    return frame.rotatedBy(SEAT_ROTATION[seat] ?? 0);
  }

  scaled(factor) {
    return new TableFrame(this.center, this.forward, DEFAULT_WIDTH * factor, DEFAULT_DEPTH * factor);
  }

  recentered(center) {
    return new TableFrame(center, this.forward, this.width, this.depth);
  }

  /** Gira a frente em torno da vertical, no sentido horário visto de cima (igual ao RotatedBy do Unity). */
  rotatedBy(degrees) {
    const a = (degrees * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const f = this.forward;
    const r = this.right;
    return new TableFrame(this.center, { x: f.x * c + r.x * s, y: 0, z: f.z * c + r.z * s }, this.width, this.depth);
  }

  flipped() {
    return this.rotatedBy(180);
  }

  /** Mesma mesa, com a frente apontando para `direction` (alça de rotação). */
  withForward(direction) {
    if (Math.hypot(direction.x, direction.z) < 1e-4) return this;
    return new TableFrame(this.center, direction, this.width, this.depth);
  }

  /** Ponto onde um raio (origem + direção) cruza o plano da mesa, ou null. */
  raycast(origin, direction) {
    if (Math.abs(direction.y) < 1e-6) return null;
    const t = (this.center.y - origin.y) / direction.y;
    if (t < 0) return null;
    return { x: origin.x + direction.x * t, y: this.center.y, z: origin.z + direction.z * t };
  }

  /** Posição da alça de rotação: além da borda do oponente. */
  handlePosition(offset = 0.07) {
    return this.tableToWorld({ x: 0, y: this.depth / 2 + offset });
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

/** De que lado da mesa o jogador está, visto pela câmera (PlayerSeat do Unity). */
export const Seat = Object.freeze({
  NearCamera: 'near',
  FarFromCamera: 'far',
  CameraLeft: 'left',
  CameraRight: 'right',
});
const SEAT_ROTATION = { near: 0, far: 180, left: 90, right: -90 };

/**
 * Altura da criatura na mesa (PLANO §5.4): base de 7 cm vezes um fator de poder
 * (poder 1 → 0,8×, 7 ou mais → 1,6×). Sem poder numérico (*, X, não-criatura) fica 1×.
 */
export function creatureHeight(power, base = 0.07) {
  const p = Number.parseFloat(power);
  if (!Number.isFinite(p)) return base;
  const k = Math.min(1, Math.max(0, (p - 1) / 6));
  return base * (0.8 + 0.8 * k);
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
 *    │ 15 s sem plano  ▲                ▲                                                  │
 *    ▼                 │ retryScan      └──── recalibrate (mesa ainda conhecida) ──────────┤
 * NoTableHint ─────────┘                                                                   │
 *    └──(achou plano)──► AwaitingCenterTap      Scanning ◄── recalibrate (mesa perdida) ───┘
 * Com o rastreamento perdido, nada avança, o tempo não conta e toques são ignorados.
 */
export class CalibrationStateMachine {
  constructor(noTableTimeoutSeconds = 15, onChange = () => {}) {
    this.state = State.Scanning;
    this.trackingLost = false;
    this.timeout = noTableTimeoutSeconds;
    this.scanSeconds = 0;
    this.onChange = onChange;
    this.onTrackingLost = null;
  }

  #go(next) {
    if (next === this.state) return;
    const prev = this.state;
    this.state = next;
    if (next === State.Scanning) this.scanSeconds = 0;
    this.onChange(prev, next);
  }

  tick(dt, tableFound, trackingOk) {
    if (this.trackingLost === trackingOk) {
      this.trackingLost = !trackingOk;
      this.onTrackingLost?.(this.trackingLost);
    }
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
    if (this.trackingLost || this.state !== State.Adjusting) return false;
    this.#go(State.Confirmed);
    return true;
  }

  /** Volta ao começo. Se a mesa ainda é conhecida, pula direto para o toque no centro. */
  recalibrate(tableStillKnown = true) {
    this.scanSeconds = 0;
    this.#go(tableStillKnown ? State.AwaitingCenterTap : State.Scanning);
    return true;
  }

  /** Botão "Tentar de novo" da dica de mesa não encontrada. */
  retryScan() {
    this.scanSeconds = 0;
    if (this.state === State.NoTableHint) this.#go(State.Scanning);
  }
}

/**
 * Histerese de um sinal booleano (TrackingStatusFilter do Unity): o valor novo só vale depois de
 * persistir por `holdSeconds`, para o aviso não piscar com variações de um quadro.
 * A primeira leitura vale na hora. update() retorna true quando o valor estável mudou.
 */
export class StableFlag {
  constructor(holdSeconds = 0.6) {
    this.hold = holdSeconds;
    this.value = null;
    this.candidate = null;
    this.seconds = 0;
  }

  update(raw, dt) {
    if (this.value === null) {
      this.value = raw;
      this.candidate = raw;
      return true;
    }
    if (raw !== this.candidate) {
      this.candidate = raw;
      this.seconds = 0;
    }
    if (raw === this.value) return false;
    this.seconds += dt;
    if (this.seconds < this.hold) return false;
    this.value = raw;
    return true;
  }
}

/**
 * Progresso da busca pela mesa (0..1), como o ScanProgress do Unity.
 * Com detecção de planos: área do maior plano horizontal / área mínima.
 * Sem ela (só hit-test): enche enquanto o anel acerta uma superfície horizontal e esvazia devagar sem acerto.
 */
export class ScanProgress {
  constructor(minArea = 0.15, fillSeconds = 1.2) {
    this.minArea = minArea;
    this.fillSeconds = fillSeconds;
    this.hitProgress = 0;
    this.value = 0;
  }

  update(dt, { hasHit, planeArea = null }) {
    this.hitProgress = Math.min(1, Math.max(0, this.hitProgress + (hasHit ? dt / this.fillSeconds : -dt / (this.fillSeconds * 3))));
    const planeProgress = planeArea === null ? 0 : Math.min(1, planeArea / this.minArea);
    this.value = Math.max(this.hitProgress, planeProgress);
    return this.value;
  }

  get found() {
    return this.value >= 1;
  }

  reset() {
    this.hitProgress = 0;
    this.value = 0;
  }
}

/** Área de um polígono no plano XZ (pontos {x, z}), para medir os planos detectados. */
export function polygonAreaXZ(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}
