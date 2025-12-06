/**
 * Utility functions for correlation engine
 */

import { randomBytes } from 'crypto';

/**
 * Generate a unique ID using crypto random bytes
 * More robust than Date.now() + Math.random()
 */
export function generateId(prefix: string = 'id'): string {
  const timestamp = Date.now().toString(36);
  const randomPart = randomBytes(8).toString('hex');
  return `${prefix}_${timestamp}_${randomPart}`;
}

/**
 * Generate event ID
 */
export function generateEventId(): string {
  return generateId('event');
}

/**
 * Generate entity ID from name
 */
export function generateEntityId(type: string, name: string): string {
  const sanitizedName = name.replace(/\s+/g, '_').toLowerCase();
  const hash = randomBytes(4).toString('hex').slice(0, 6);
  return `${type}_${sanitizedName}_${hash}`;
}

/**
 * Generate edge ID
 */
export function generateEdgeId(sourceId: string, targetId: string): string {
  const hash = randomBytes(4).toString('hex').slice(0, 6);
  return `edge_${sourceId}_${targetId}_${hash}`;
}

/**
 * Simple mutex implementation for async operations
 */
export class AsyncMutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
