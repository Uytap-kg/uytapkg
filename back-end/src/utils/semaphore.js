/**
 * Асинхронный семафор с ограничением параллельных вызовов, потолком очереди и таймаутом ожидания.
 * Защищает платные и тяжёлые ресурсы (Claude/Gemini, ElevenLabs, Sharp, Resend/SMTP, Nikita SMS)
 * от перегрузки CPU/памяти и одновременного исчерпания квот при всплесках трафика.
 */
export class Semaphore {
  constructor({ maxConcurrent = 5, maxQueue = 100, acquireTimeoutMs = 15000, name = "semaphore" } = {}) {
    this.maxConcurrent = Math.max(1, Number(maxConcurrent) || 5);
    this.maxQueue = Math.max(0, Number(maxQueue) || 100);
    this.acquireTimeoutMs = Math.max(100, Number(acquireTimeoutMs) || 15000);
    this.name = name;
    this.active = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        this._release();
      };
    }

    if (this.queue.length >= this.maxQueue) {
      const err = new Error(`Очередь ${this.name} переполнена (${this.maxQueue})`);
      err.code = "SEMAPHORE_QUEUE_FULL";
      throw err;
    }

    return new Promise((resolve, reject) => {
      const item = { resolve: null, reject, timer: null };
      item.timer = setTimeout(() => {
        const idx = this.queue.indexOf(item);
        if (idx !== -1) this.queue.splice(idx, 1);
        const err = new Error(`Превышено время ожидания очереди ${this.name} (${this.acquireTimeoutMs}ms)`);
        err.code = "SEMAPHORE_TIMEOUT";
        reject(err);
      }, this.acquireTimeoutMs);

      if (item.timer && typeof item.timer.unref === "function") {
        item.timer.unref();
      }

      item.resolve = () => {
        if (item.timer) clearTimeout(item.timer);
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this._release();
        });
      };

      this.queue.push(item);
    });
  }

  _release() {
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next && typeof next.resolve === "function") {
        next.resolve();
        return;
      }
    }
    this.active = Math.max(0, this.active - 1);
  }

  async run(fn) {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  getStats() {
    return {
      name: this.name,
      active: this.active,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueue: this.maxQueue,
    };
  }
}

export default Semaphore;
