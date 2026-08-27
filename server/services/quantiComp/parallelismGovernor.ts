import { EventEmitter } from 'node:events';
import os from 'node:os';
import type { QuantiLane } from './types.js';

const LANE_RANK: Record<QuantiLane, number> = {
  background: 1,
  batch: 2,
  warm: 3,
  hot: 4,
  ultra_hot: 5,
};

export type QuantiParallelismErrorCode =
  | 'INVALID_REQUEST'
  | 'ABORTED'
  | 'DEADLINE_EXPIRED'
  | 'SHUTDOWN';

export class QuantiParallelismError extends Error {
  constructor(
    message: string,
    public readonly code: QuantiParallelismErrorCode,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'QuantiParallelismError';
  }
}

export interface QuantiParallelismRequest {
  id: string;
  units: number;
  lane: QuantiLane;
  priority: number;
  deadlineAt?: number;
  signal?: AbortSignal;
  metadata?: Record<string, number | string | boolean | null>;
}

export interface QuantiParallelismLease {
  id: string;
  units: number;
  grantedAt: number;
  waitedMs: number;
  release: () => void;
}

export interface QuantiParallelismStatus {
  capacityUnits: number;
  activeUnits: number;
  queuedReservations: number;
  utilization: number;
  peakActiveUnits: number;
  grantedReservations: number;
  rejectedReservations: number;
  initialized: boolean;
}

type PendingReservation = {
  request: QuantiParallelismRequest;
  requestedAt: number;
  resolve: (lease: QuantiParallelismLease) => void;
  reject: (error: Error) => void;
  deadlineTimer?: NodeJS.Timeout;
  cleanupAbort?: () => void;
};

export interface QuantiParallelismGovernorOptions {
  capacityUnits?: number;
}

function normalizePriority(priority: number): number {
  return Number.isFinite(priority) ? Math.max(-1_000_000, Math.min(1_000_000, priority)) : 0;
}

function compareRequests(a: PendingReservation, b: PendingReservation): number {
  const laneDelta = LANE_RANK[b.request.lane] - LANE_RANK[a.request.lane];
  if (laneDelta !== 0) return laneDelta;
  const aDeadline = a.request.deadlineAt ?? Number.POSITIVE_INFINITY;
  const bDeadline = b.request.deadlineAt ?? Number.POSITIVE_INFINITY;
  if (aDeadline !== bDeadline) return aDeadline - bDeadline;
  const priorityDelta = normalizePriority(b.request.priority) - normalizePriority(a.request.priority);
  if (priorityDelta !== 0) return priorityDelta;
  return a.requestedAt - b.requestedAt;
}

export class QuantiParallelismGovernor extends EventEmitter {
  private readonly capacityUnits: number;
  private readonly queue: PendingReservation[] = [];
  private activeUnits = 0;
  private peakActiveUnits = 0;
  private grantedReservations = 0;
  private rejectedReservations = 0;
  private initialized = true;

  constructor(options: QuantiParallelismGovernorOptions = {}) {
    super();
    const available = Math.max(1, os.availableParallelism?.() || os.cpus().length);
    const configured = Number(process.env.QUANTI_COMP_PARALLEL_UNITS || options.capacityUnits || available);
    this.capacityUnits = Math.max(
      1,
      Math.min(64, available, Number.isFinite(configured) ? Math.floor(configured) : available),
    );
  }

  acquire(request: QuantiParallelismRequest): Promise<QuantiParallelismLease> {
    if (!this.initialized) {
      return Promise.reject(new QuantiParallelismError(
        'Quanti parallelism governor is shut down',
        'SHUTDOWN',
        { reservationId: request.id },
      ));
    }
    if (!request.id || !(request.lane in LANE_RANK) || !Number.isFinite(request.units) || request.units <= 0) {
      return Promise.reject(new QuantiParallelismError(
        'Parallelism reservation requires id, valid lane, and positive finite units',
        'INVALID_REQUEST',
        { reservationId: request.id, requestedUnits: request.units },
      ));
    }
    if (request.signal?.aborted) {
      return Promise.reject(new QuantiParallelismError(
        'Parallelism reservation aborted before queueing',
        'ABORTED',
        { reservationId: request.id },
      ));
    }
    if (request.deadlineAt !== undefined && request.deadlineAt <= Date.now()) {
      return Promise.reject(new QuantiParallelismError(
        'Parallelism reservation deadline expired before queueing',
        'DEADLINE_EXPIRED',
        { reservationId: request.id, deadlineAt: request.deadlineAt },
      ));
    }

    const normalized: QuantiParallelismRequest = {
      ...request,
      units: Math.max(1, Math.min(this.capacityUnits, Math.ceil(request.units))),
      priority: normalizePriority(request.priority),
    };

    return new Promise<QuantiParallelismLease>((resolve, reject) => {
      const pending: PendingReservation = {
        request: normalized,
        requestedAt: Date.now(),
        resolve,
        reject,
      };
      if (normalized.signal) {
        const onAbort = () => this.rejectQueued(normalized.id, 'ABORTED', 'Parallelism reservation aborted while queued');
        normalized.signal.addEventListener('abort', onAbort, { once: true });
        pending.cleanupAbort = () => normalized.signal?.removeEventListener('abort', onAbort);
      }
      if (normalized.deadlineAt !== undefined) {
        const remaining = Math.max(1, normalized.deadlineAt - Date.now());
        pending.deadlineTimer = setTimeout(() => {
          this.rejectQueued(normalized.id, 'DEADLINE_EXPIRED', 'Parallelism reservation deadline expired while queued');
        }, remaining);
      }
      this.queue.push(pending);
      this.queue.sort(compareRequests);
      this.emit('reservation-queued', {
        reservationId: normalized.id,
        units: normalized.units,
        lane: normalized.lane,
        queueDepth: this.queue.length,
      });
      this.pump();
    });
  }

  getStatus(): QuantiParallelismStatus {
    return {
      capacityUnits: this.capacityUnits,
      activeUnits: this.activeUnits,
      queuedReservations: this.queue.length,
      utilization: this.capacityUnits > 0 ? this.activeUnits / this.capacityUnits : 0,
      peakActiveUnits: this.peakActiveUnits,
      grantedReservations: this.grantedReservations,
      rejectedReservations: this.rejectedReservations,
      initialized: this.initialized,
    };
  }

  shutdown(): void {
    if (!this.initialized) return;
    this.initialized = false;
    for (const pending of this.queue.splice(0)) {
      this.cleanupPending(pending);
      this.rejectedReservations += 1;
      pending.reject(new QuantiParallelismError(
        'Quanti parallelism governor shut down before reservation was granted',
        'SHUTDOWN',
        { reservationId: pending.request.id },
      ));
    }
    this.emit('shutdown');
  }

  private pump(): void {
    while (this.initialized && this.queue.length > 0) {
      const pending = this.queue[0];
      if (pending.request.signal?.aborted) {
        this.rejectQueued(pending.request.id, 'ABORTED', 'Parallelism reservation aborted while queued');
        continue;
      }
      if (pending.request.deadlineAt !== undefined && pending.request.deadlineAt <= Date.now()) {
        this.rejectQueued(pending.request.id, 'DEADLINE_EXPIRED', 'Parallelism reservation deadline expired while queued');
        continue;
      }
      if (this.activeUnits + pending.request.units > this.capacityUnits) return;

      this.queue.shift();
      this.cleanupPending(pending);
      this.activeUnits += pending.request.units;
      this.peakActiveUnits = Math.max(this.peakActiveUnits, this.activeUnits);
      this.grantedReservations += 1;
      const grantedAt = Date.now();
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        this.activeUnits = Math.max(0, this.activeUnits - pending.request.units);
        this.emit('reservation-released', {
          reservationId: pending.request.id,
          units: pending.request.units,
          activeUnits: this.activeUnits,
        });
        this.pump();
      };
      const lease: QuantiParallelismLease = {
        id: pending.request.id,
        units: pending.request.units,
        grantedAt,
        waitedMs: Math.max(0, grantedAt - pending.requestedAt),
        release,
      };
      this.emit('reservation-granted', {
        reservationId: pending.request.id,
        units: pending.request.units,
        lane: pending.request.lane,
        activeUnits: this.activeUnits,
        waitedMs: lease.waitedMs,
        metadata: pending.request.metadata,
      });
      pending.resolve(lease);
    }
  }

  private rejectQueued(id: string, code: 'ABORTED' | 'DEADLINE_EXPIRED', message: string): void {
    const index = this.queue.findIndex(item => item.request.id === id);
    if (index < 0) return;
    const [pending] = this.queue.splice(index, 1);
    this.cleanupPending(pending);
    this.rejectedReservations += 1;
    pending.reject(new QuantiParallelismError(message, code, {
      reservationId: id,
      deadlineAt: pending.request.deadlineAt,
    }));
    this.emit('reservation-rejected', {
      reservationId: id,
      code,
      message,
    });
    this.pump();
  }

  private cleanupPending(pending: PendingReservation): void {
    if (pending.deadlineTimer) clearTimeout(pending.deadlineTimer);
    pending.cleanupAbort?.();
  }
}

export const quantiParallelismGovernor = new QuantiParallelismGovernor();
