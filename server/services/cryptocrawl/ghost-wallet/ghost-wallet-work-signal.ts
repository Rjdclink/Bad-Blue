import { EventEmitter } from 'node:events';

export type GhostWalletWakeReason =
  | 'startup_backlog'
  | 'postgres_notify'
  | 'local_work_enqueued'
  | 'retry_due'
  | 'listener_reconnected'
  | 'explicit_refresh';

class GhostWalletWorkSignal extends EventEmitter {
  emitWake(reason: GhostWalletWakeReason): void {
    this.emit('wake', reason);
  }

  onWake(listener: (reason: GhostWalletWakeReason) => void): () => void {
    this.on('wake', listener);
    return () => this.off('wake', listener);
  }
}

export const ghostWalletWorkSignal = new GhostWalletWorkSignal();
