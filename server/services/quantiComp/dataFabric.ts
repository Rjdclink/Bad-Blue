import { EventEmitter } from 'node:events';

export interface QuantiSharedFloat64Lease {
  readonly buffer: SharedArrayBuffer;
  readonly view: Float64Array;
  readonly length: number;
  readonly capacity: number;
  readonly byteLength: number;
  readonly reused: boolean;
  release(): void;
}

export interface QuantiPinnedFloat64State {
  readonly key: string;
  readonly version: number;
  readonly view: Float64Array;
  release(): void;
}

export interface QuantiFloat64StateInfo {
  key: string;
  version: number;
  length: number;
  byteLength: number;
  pinnedReaders: number;
}

export interface QuantiDataFabricStatus {
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
}

export interface QuantiDataFabricOptions {
  maxPooledBytes?: number;
  maxBuffersPerClass?: number;
}

type InternalLease = QuantiSharedFloat64Lease & { released: boolean };
type StateGeneration = {
  key: string;
  version: number;
  length: number;
  lease: InternalLease;
  pins: number;
  retired: boolean;
};

const FLOAT64_BYTES = Float64Array.BYTES_PER_ELEMENT;

function nextPowerOfTwo(value: number): number {
  let size = 1;
  while (size < value && size < 0x40000000) size *= 2;
  return Math.max(1, size);
}

export class QuantiDataFabric extends EventEmitter {
  private readonly maxPooledBytes: number;
  private readonly maxBuffersPerClass: number;
  private readonly pools = new Map<number, SharedArrayBuffer[]>();
  private readonly states = new Map<string, StateGeneration>();
  private pooledBytes = 0;
  private activeLeases = 0;
  private activeBytes = 0;
  private peakActiveBytes = 0;
  private allocations = 0;
  private reuses = 0;
  private evictions = 0;

  constructor(options: QuantiDataFabricOptions = {}) {
    super();
    const configuredMaxBytes = Number(process.env.QUANTI_COMP_SHARED_POOL_BYTES || options.maxPooledBytes || 16 * 1024 * 1024);
    this.maxPooledBytes = Math.max(64 * 1024, Number.isFinite(configuredMaxBytes) ? Math.floor(configuredMaxBytes) : 16 * 1024 * 1024);
    const configuredPerClass = Number(process.env.QUANTI_COMP_SHARED_POOL_PER_CLASS || options.maxBuffersPerClass || 8);
    this.maxBuffersPerClass = Math.max(1, Math.min(64, Number.isFinite(configuredPerClass) ? Math.floor(configuredPerClass) : 8));
  }

  acquireFloat64(length: number, options: { zero?: boolean } = {}): QuantiSharedFloat64Lease {
    if (!Number.isFinite(length) || length <= 0) throw new Error('QUANTI_DATA_INVALID_LENGTH: Float64 lease length must be positive');
    const requested = Math.ceil(length);
    const capacity = nextPowerOfTwo(requested);
    const byteLength = capacity * FLOAT64_BYTES;
    const bucket = this.pools.get(capacity);
    const reused = !!bucket?.length;
    const buffer = reused ? bucket!.pop()! : new SharedArrayBuffer(byteLength);

    if (reused) {
      this.pooledBytes = Math.max(0, this.pooledBytes - byteLength);
      this.reuses += 1;
    } else {
      this.allocations += 1;
    }

    const view = new Float64Array(buffer, 0, requested);
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

  publishFloat64State(key: string, values: ArrayLike<number>): QuantiFloat64StateInfo {
    if (!key) throw new Error('QUANTI_DATA_INVALID_STATE_KEY: state key is required');
    const length = Math.max(1, Math.floor(Number(values.length) || 0));
    const next = this.acquireFloat64(length, { zero: false }) as InternalLease;
    for (let i = 0; i < length; i += 1) next.view[i] = Number(values[i]) || 0;

    const existing = this.states.get(key);
    const generation: StateGeneration = {
      key,
      version: (existing?.version || 0) + 1,
      length,
      lease: next,
      pins: 0,
      retired: false,
    };
    this.states.set(key, generation);
    if (existing) this.retireGeneration(existing);
    this.emit('state-published', { key, version: generation.version, length });
    return this.stateInfo(generation);
  }

  updateFloat64State(key: string, updates: Iterable<readonly [number, number]>): QuantiFloat64StateInfo {
    const current = this.states.get(key);
    if (!current) throw new Error(`QUANTI_DATA_STATE_MISSING: ${key}`);
    const changes = Array.from(updates);
    for (const [index] of changes) {
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new Error(`QUANTI_DATA_STATE_INDEX: ${key}[${index}]`);
      }
    }

    let target = current;
    if (current.pins > 0) {
      const nextLease = this.acquireFloat64(current.length, { zero: false }) as InternalLease;
      nextLease.view.set(current.lease.view.subarray(0, current.length));
      target = {
        key,
        version: current.version + 1,
        length: current.length,
        lease: nextLease,
        pins: 0,
        retired: false,
      };
      this.states.set(key, target);
      this.retireGeneration(current);
    } else {
      target.version += 1;
    }

    for (const [index, value] of changes) target.lease.view[index] = Number(value) || 0;
    this.emit('state-updated', { key, version: target.version, changes: changes.length, copyOnWrite: target !== current });
    return this.stateInfo(target);
  }

  pinFloat64State(key: string): QuantiPinnedFloat64State | null {
    const generation = this.states.get(key);
    if (!generation) return null;
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

  getStateInfo(key: string): QuantiFloat64StateInfo | null {
    const generation = this.states.get(key);
    return generation ? this.stateInfo(generation) : null;
  }

  getStatus(): QuantiDataFabricStatus {
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

  private returnBuffer(capacity: number, buffer: SharedArrayBuffer): void {
    const byteLength = buffer.byteLength;
    const bucket = this.pools.get(capacity) || [];
    if (bucket.length >= this.maxBuffersPerClass || this.pooledBytes + byteLength > this.maxPooledBytes) {
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

  private stateInfo(generation: StateGeneration): QuantiFloat64StateInfo {
    return {
      key: generation.key,
      version: generation.version,
      length: generation.length,
      byteLength: generation.lease.byteLength,
      pinnedReaders: generation.pins,
    };
  }
}

export const quantiDataFabric = new QuantiDataFabric();
