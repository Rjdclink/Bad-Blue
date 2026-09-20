import { EventEmitter } from 'node:events';

export interface QuantiTensorLease {
  readonly buffer: SharedArrayBuffer;
  readonly view: Float32Array;
  readonly length: number;
  readonly capacity: number;
  readonly byteLength: number;
  readonly reused: boolean;
  release(): void;
}

export interface QuantiPinnedTensorState {
  readonly key: string;
  readonly version: number;
  readonly view: Float32Array;
  release(): void;
}

export interface QuantiTensorStateInfo {
  key: string;
  version: number;
  length: number;
  byteLength: number;
  pinnedReaders: number;
  expiresAt: number | null;
  lastAccessedAt: number;
}

export interface QuantiTensorFabricStatus {
  pooledBuffers: number;
  pooledBytes: number;
  activeLeases: number;
  activeBytes: number;
  peakActiveBytes: number;
  allocations: number;
  reuses: number;
  evictions: number;
  stateCells: number;
  stateBytes: number;
  expiredStates: number;
  capacityEvictions: number;
}

export interface QuantiTensorFabricOptions {
  maxPooledBytes?: number;
  maxBuffersPerClass?: number;
  maxStateBytes?: number;
}

type InternalLease = QuantiTensorLease & { released: boolean };
type StateGeneration = {
  key: string;
  version: number;
  length: number;
  lease: InternalLease;
  pins: number;
  retired: boolean;
  expiresAt: number | null;
  lastAccessedAt: number;
};

const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;

function nextPowerOfTwo(value: number): number {
  let size = 1;
  while (size < value && size < 0x40000000) size *= 2;
  return Math.max(1, size);
}

function positiveFinite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Float32 tensor/state fabric for realtime inference context.
 *
 * This deliberately complements the existing Float64 numerical fabric instead
 * of replacing it. Avatar identity features, landmarks, low-resolution latent
 * state and model-conditioning vectors are naturally Float32 and should be
 * reused without repeated allocation/copy churn.
 *
 * The design borrows the useful "Ice Crystal" concept from the repository:
 * hot state is bounded, reusable and expires. It does not inherit crawler
 * semantics or domain authority.
 */
export class QuantiTensorFabric extends EventEmitter {
  private readonly maxPooledBytes: number;
  private readonly maxBuffersPerClass: number;
  private readonly maxStateBytes: number;
  private readonly pools = new Map<number, SharedArrayBuffer[]>();
  private readonly states = new Map<string, StateGeneration>();
  private pooledBytes = 0;
  private activeLeases = 0;
  private activeBytes = 0;
  private peakActiveBytes = 0;
  private allocations = 0;
  private reuses = 0;
  private evictions = 0;
  private expiredStates = 0;
  private capacityEvictions = 0;

  constructor(options: QuantiTensorFabricOptions = {}) {
    this.maxPooledBytes = Math.max(
      256 * 1024,
      positiveFinite(
        process.env.QUANTI_COMP_TENSOR_POOL_BYTES || options.maxPooledBytes,
        32 * 1024 * 1024,
      ),
    );
    this.maxBuffersPerClass = Math.max(
      1,
      Math.min(
        64,
        positiveFinite(
          process.env.QUANTI_COMP_TENSOR_POOL_PER_CLASS || options.maxBuffersPerClass,
          8,
        ),
      ),
    );
    this.maxStateBytes = Math.max(
      1024 * 1024,
      positiveFinite(
        process.env.QUANTI_COMP_TENSOR_STATE_BYTES || options.maxStateBytes,
        64 * 1024 * 1024,
      ),
    );
  }

  acquireFloat32(length: number, options: { zero?: boolean } = {}): QuantiTensorLease {
    if (!Number.isFinite(length) || length <= 0) {
      throw new Error('QUANTI_TENSOR_INVALID_LENGTH: Float32 lease length must be positive');
    }
    const requested = Math.ceil(length);
    const capacity = nextPowerOfTwo(requested);
    const byteLength = capacity * FLOAT32_BYTES;
    const bucket = this.pools.get(capacity);
    const reused = Boolean(bucket?.length);
    const buffer = reused ? bucket!.pop()! : new SharedArrayBuffer(byteLength);

    if (reused) {
      this.pooledBytes = Math.max(0, this.pooledBytes - byteLength);
      this.reuses += 1;
    } else {
      this.allocations += 1;
    }

    const view = new Float32Array(buffer, 0, requested);
    if (options.zero !== false) view.fill(0);
    this.activeLeases += 1;
    this.activeBytes += byteLength;
    this.peakActiveBytes = Math.max(this.peakActiveBytes, this.activeBytes);
    let released = false;

    const lease: InternalLease = {
      buffer,
      view,
      length: requested,
      capacity,
      byteLength,
      reused,
      released: false,
      release: () => {
        if (released) return;
        released = true;
        lease.released = true;
        this.activeLeases = Math.max(0, this.activeLeases - 1);
        this.activeBytes = Math.max(0, this.activeBytes - byteLength);
        this.returnBuffer(capacity, buffer);
      },
    };

    this.emit('lease-acquired', { length: requested, capacity, byteLength, reused });
    return lease;
  }

  publishFloat32State(
    key: string,
    values: ArrayLike<number>,
    options: { ttlMs?: number } = {},
  ): QuantiTensorStateInfo {
    if (!key) throw new Error('QUANTI_TENSOR_INVALID_STATE_KEY: state key is required');
    const length = Math.max(1, Math.floor(Number(values.length) || 0));
    const next = this.acquireFloat32(length, { zero: false }) as InternalLease;
    for (let i = 0; i < length; i += 1) next.view[i] = Number(values[i]) || 0;

    const now = Date.now();
    const ttlMs = Number(options.ttlMs);
    const existing = this.states.get(key);
    const generation: StateGeneration = {
      key,
      version: (existing?.version || 0) + 1,
      length,
      lease: next,
      pins: 0,
      retired: false,
      expiresAt: Number.isFinite(ttlMs) && ttlMs > 0 ? now + ttlMs : null,
      lastAccessedAt: now,
    };
    this.states.set(key, generation);
    if (existing) this.retireGeneration(existing);
    this.evictExpired(now);
    this.enforceStateBudget();
    this.emit('state-published', {
      key,
      version: generation.version,
      length,
      byteLength: generation.lease.byteLength,
      expiresAt: generation.expiresAt,
    });
    return this.stateInfo(generation);
  }

  pinFloat32State(key: string): QuantiPinnedTensorState | null {
    const now = Date.now();
    const generation = this.states.get(key);
    if (!generation) return null;
    if (generation.expiresAt !== null && generation.expiresAt <= now) {
      this.states.delete(key);
      this.expiredStates += 1;
      this.retireGeneration(generation);
      this.emit('state-expired', { key, version: generation.version });
      return null;
    }
    generation.lastAccessedAt = now;
    generation.pins += 1;
    let released = false;
    return {
      key,
      version: generation.version,
      view: generation.lease.view.subarray(0, generation.length),
      release: () => {
        if (released) return;
        released = true;
        generation.pins = Math.max(0, generation.pins - 1);
        if (generation.retired && generation.pins === 0) generation.lease.release();
      },
    };
  }

  deleteState(key: string): boolean {
    const generation = this.states.get(key);
    if (!generation) return false;
    this.states.delete(key);
    this.retireGeneration(generation);
    this.emit('state-deleted', { key, version: generation.version });
    return true;
  }

  evictExpired(now = Date.now()): number {
    let removed = 0;
    for (const [key, generation] of this.states) {
      if (generation.expiresAt === null || generation.expiresAt > now || generation.pins > 0) continue;
      this.states.delete(key);
      this.expiredStates += 1;
      removed += 1;
      this.retireGeneration(generation);
      this.emit('state-expired', { key, version: generation.version });
    }
    return removed;
  }

  getStateInfo(key: string): QuantiTensorStateInfo | null {
    const generation = this.states.get(key);
    if (!generation) return null;
    if (generation.expiresAt !== null && generation.expiresAt <= Date.now() && generation.pins === 0) {
      this.deleteState(key);
      this.expiredStates += 1;
      return null;
    }
    return this.stateInfo(generation);
  }

  getStatus(): QuantiTensorFabricStatus {
    let pooledBuffers = 0;
    for (const buffers of this.pools.values()) pooledBuffers += buffers.length;
    let stateBytes = 0;
    for (const generation of this.states.values()) stateBytes += generation.lease.byteLength;
    return {
      pooledBuffers,
      pooledBytes: this.pooledBytes,
      activeLeases: this.activeLeases,
      activeBytes: this.activeBytes,
      peakActiveBytes: this.peakActiveBytes,
      allocations: this.allocations,
      reuses: this.reuses,
      evictions: this.evictions,
      stateCells: this.states.size,
      stateBytes,
      expiredStates: this.expiredStates,
      capacityEvictions: this.capacityEvictions,
    };
  }

  clearPool(): void {
    this.pools.clear();
    this.pooledBytes = 0;
  }

  shutdown(): void {
    for (const generation of this.states.values()) {
      generation.retired = true;
      if (generation.pins === 0) generation.lease.release();
    }
    this.states.clear();
    this.clearPool();
  }

  private enforceStateBudget(): void {
    let total = 0;
    for (const state of this.states.values()) total += state.lease.byteLength;
    if (total <= this.maxStateBytes) return;

    const candidates = Array.from(this.states.values())
      .filter(state => state.pins === 0)
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    for (const state of candidates) {
      if (total <= this.maxStateBytes) break;
      if (this.states.get(state.key) !== state) continue;
      this.states.delete(state.key);
      total = Math.max(0, total - state.lease.byteLength);
      this.capacityEvictions += 1;
      this.retireGeneration(state);
      this.emit('state-evicted', {
        key: state.key,
        version: state.version,
        reason: 'state_budget',
      });
    }
  }

  private returnBuffer(capacity: number, buffer: SharedArrayBuffer): void {
    const byteLength = buffer.byteLength;
    const bucket = this.pools.get(capacity) || [];
    if (
      bucket.length >= this.maxBuffersPerClass ||
      this.pooledBytes + byteLength > this.maxPooledBytes
    ) {
      this.evictions += 1;
      return;
    }
    bucket.push(buffer);
    this.pools.set(capacity, bucket);
    this.pooledBytes += byteLength;
    this.emit('lease-recycled', { capacity, byteLength });
  }

  private retireGeneration(generation: StateGeneration): void {
    generation.retired = true;
    if (generation.pins === 0) generation.lease.release();
  }

  private stateInfo(generation: StateGeneration): QuantiTensorStateInfo {
    return {
      key: generation.key,
      version: generation.version,
      length: generation.length,
      byteLength: generation.lease.byteLength,
      pinnedReaders: generation.pins,
      expiresAt: generation.expiresAt,
      lastAccessedAt: generation.lastAccessedAt,
    };
  }
}

export const quantiTensorFabric = new QuantiTensorFabric();
