/**
 * Semáforo simples para limitar concorrência de requisições.
 */
export class Semaphore {
  private available: number;
  private queue: (() => void)[] = [];

  constructor(private readonly capacity: number) {
    this.available = capacity;
  }

  acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.available++;
    }
  }
}

/**
 * Rate limiter: limita concorrência e garante um intervalo mínimo entre o
 * início de cada requisição (respeito ao servidor da Wiki).
 */
export class RateLimiter {
  private readonly semaphore: Semaphore;
  private lastStart = 0;

  constructor(
    private readonly concurrency: number,
    private readonly minDelayMs: number,
  ) {
    this.semaphore = new Semaphore(Math.max(1, concurrency));
  }

  /** Reserva um slot; o caller deve invocar a função liberada ao terminar. */
  async acquire(): Promise<() => void> {
    await this.semaphore.acquire();
    const wait = this.lastStart + this.minDelayMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastStart = Date.now();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.semaphore.release();
    };
  }
}