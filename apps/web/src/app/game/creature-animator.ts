export type AnimType = 'idle' | 'walk' | 'attack' | 'cast' | 'hit' | 'death' | 'spawn';
export type AnimDirection = 'north' | 'east' | 'south' | 'west';

export interface AnimSequence {
  animation: AnimType;
  direction: AnimDirection;
  frames: number[];
  frameDurationMs: number;
  loop: boolean;
  playbackMode?: 'normal' | 'pingpong';
  holdLastFrameMs?: number;
}

export interface AnimConfig {
  spriteWidth: number;
  spriteHeight: number;
  sheetColumns: number;
  sheetRows: number;
  anchor?: { x: number; y: number };
  animations: AnimSequence[];
}

/**
 * Animador data-driven de criaturas. Avança o frame por tempo decorrido
 * (sem interval), com suporte a loop/ping-pong, one-shots (attack/hit) com
 * fallback automático e trava de death.
 */
export class CreatureAnimator {
  private readonly lookup = new Map<string, AnimSequence>();
  private direction: AnimDirection;
  private current: AnimType = 'idle';
  private fallback: AnimType = 'idle';
  private startedAt = 0;
  private deathLocked = false;

  constructor(
    readonly config: AnimConfig,
    direction: AnimDirection = 'south',
  ) {
    this.direction = direction;
    for (const seq of config.animations) this.lookup.set(`${seq.animation}:${seq.direction}`, seq);
  }

  setDirection(direction: AnimDirection) {
    this.direction = direction;
  }

  get currentType(): AnimType {
    return this.current;
  }

  /** Troca de animação sem reiniciar se for a mesma (ex.: walk contínuo). */
  play(anim: AnimType, now: number) {
    if (this.deathLocked) return;
    if (anim === this.current) return;
    this.setCurrent(anim, now);
    if (anim === 'walk' || anim === 'idle') this.fallback = anim;
  }

  /** One-shot (attack/hit/death): reinicia e volta ao walk/idle ao terminar. */
  playOnce(anim: AnimType, now: number) {
    if (this.deathLocked) return;
    this.setCurrent(anim, now);
  }

  /** Índice do frame (célula da spritesheet) atualmente exibido. */
  frameIndex(now: number): number {
    const seq =
      this.lookup.get(`${this.current}:${this.direction}`) ??
      this.lookup.get(`idle:${this.direction}`) ??
      this.lookup.get(`walk:${this.direction}`);
    if (!seq || seq.frames.length === 0) return 0;
    const index = seq.frames[this.computeIndex(seq, now)];
    this.revertIfFinished(seq, now);
    return index;
  }

  private setCurrent(anim: AnimType, now: number) {
    const seq =
      this.lookup.get(`${anim}:${this.direction}`) ??
      this.lookup.get(`${anim}:south`) ??
      this.lookup.get(`idle:${this.direction}`);
    this.current = seq?.animation ?? 'idle';
    this.startedAt = now;
    if (this.current === 'death') this.deathLocked = true;
  }

  private revertIfFinished(seq: AnimSequence, now: number) {
    if (seq.loop || this.current === 'death') return;
    const totalMs = seq.frames.length * Math.max(1, seq.frameDurationMs) + (seq.holdLastFrameMs ?? 0);
    if (now - this.startedAt >= totalMs) {
      this.current = this.fallback;
      this.startedAt = now;
    }
  }

  private computeIndex(seq: AnimSequence, now: number): number {
    const len = seq.frames.length;
    const dur = Math.max(1, seq.frameDurationMs);
    const raw = Math.floor((now - this.startedAt) / dur);
    if (seq.playbackMode === 'pingpong') {
      const period = Math.max(1, len * 2 - 2);
      const t = raw % period;
      return t < len ? t : period - t;
    }
    if (!seq.loop) return Math.min(raw, len - 1);
    return raw % len;
  }
}
