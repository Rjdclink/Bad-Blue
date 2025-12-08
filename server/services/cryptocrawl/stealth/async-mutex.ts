// AsyncMutex - Simple mutex for deterministic execution
// Ensures transactions are executed in order without race conditions

export class AsyncMutex {
  private locked = false;
  private queue: Array<() => void> = [];

  /**
   * Acquire the lock. Returns a promise that resolves when the lock is available.
   * Uses a queue-based implementation for fairness.
   */
  async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  /**
   * Release the lock and notify the next waiter in the queue.
   */
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        next();
      }
    } else {
      this.locked = false;
    }
  }

  /**
   * Execute a function with the lock held.
   * Automatically acquires and releases the lock.
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Check if the lock is currently held.
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Get the number of waiters in the queue.
   */
  getQueueLength(): number {
    return this.queue.length;
  }
}
