import { Injectable } from '@nestjs/common';

/**
 * Game loop do servidor. Não depende do FPS do navegador: usa o tempo do
 * servidor (setInterval) e calcula o delta real entre ticks.
 */
@Injectable()
export class GameLoop {
  private timer: NodeJS.Timeout | null = null;
  private lastTickAt = 0;

  constructor(
    private readonly intervalMs: number,
    private readonly onTick: (deltaMs: number, now: number) => void,
  ) {}

  get running(): boolean {
    return this.timer !== null;
  }

  start() {
    if (this.timer) return;
    this.lastTickAt = Date.now();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const now = Date.now();
    const delta = now - this.lastTickAt;
    this.lastTickAt = now;
    this.onTick(delta, now);
  }
}