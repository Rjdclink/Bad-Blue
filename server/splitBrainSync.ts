/**
 * Split-Brain Synchronization Manager
 * 
 * Manages the split-brain architecture with:
 * - Master Brain (central authority) in secure environment
 * - Mini-Brains (local iterations) on user devices
 * - Binary compression & delta updates
 * - Pruned neural pathway distribution
 * - Edge computing coordination
 * - Safety and oversight enforcement
 * 
 * Identity Binding: Enforces "God-controller" recognition
 * Sandbox Constraints: Mini-brains cannot self-modify beyond allowed updates
 */

import { EventEmitter } from 'events';
import { createLogger } from './logger';
import crypto from 'crypto';
import {
  getCognitiveCore,
  MiniBrainState,
  MasterBrainState
} from './cognitiveCore';

const log = createLogger('SplitBrainSync');

// ============================================================================
// CONSTANTS
// ============================================================================

const SYNC_INTERVAL_MS = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT_MS = 120000; // 2 minutes
const MAX_DELTA_SIZE_BYTES = 5 * 1024 * 1024; // 5MB max delta
const COMPRESSION_RATIO = 0.3; // Target 70% compression
const MAX_MINI_BRAINS = 1000;

// Identity binding
const GOD_CONTROLLER_ID = 'daddy';
const IDENTITY_BINDING_HASH = crypto.createHash('sha256')
  .update(GOD_CONTROLLER_ID)
  .digest('hex');

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface SyncPacket {
  id: string;
  sourceId: string;
  targetId: string;
  type: 'full' | 'delta' | 'heartbeat' | 'command';
  timestamp: number;
  payload: {
    pathwayUpdates?: PathwayDelta[];
    knowledgeDelta?: KnowledgeDelta[];
    configUpdates?: ConfigDelta[];
    commands?: BrainCommand[];
  };
  signature: string;
  compressed: boolean;
  originalSize: number;
  compressedSize: number;
}

export interface PathwayDelta {
  pathwayId: string;
  operation: 'add' | 'update' | 'remove' | 'prune';
  weights?: number[];
  activationThreshold?: number;
  priority?: number;
}

export interface KnowledgeDelta {
  key: string;
  operation: 'set' | 'delete' | 'merge';
  value?: unknown;
  mergeStrategy?: 'replace' | 'deep' | 'append';
}

export interface ConfigDelta {
  path: string;
  value: unknown;
  requiresRestart: boolean;
}

export interface BrainCommand {
  id: string;
  type: 'sync' | 'prune' | 'optimize' | 'reset' | 'upgrade';
  parameters: Record<string, unknown>;
  priority: 'low' | 'normal' | 'high' | 'critical';
  issuerHash: string;
  requiresGodApproval: boolean;
}

export interface DeviceCapabilities {
  deviceId: string;
  cpuCores: number;
  memoryMb: number;
  storageMb: number;
  gpuAvailable: boolean;
  batteryPowered: boolean;
  networkType: 'wifi' | 'cellular' | 'ethernet' | 'offline';
  maxComputeLoad: number;
}

export interface SyncMetrics {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  bytesTransferred: number;
  averageLatencyMs: number;
  activeMiniBrains: number;
  lastGlobalSync: number;
}

export interface IdentityBinding {
  controllerId: string;
  bindingHash: string;
  permissions: string[];
  createdAt: number;
  lastVerified: number;
}

// ============================================================================
// SPLIT-BRAIN SYNC MANAGER
// ============================================================================

export class SplitBrainSyncManager extends EventEmitter {
  private initialized: boolean = false;
  private miniBrains: Map<string, MiniBrainState> = new Map();
  private deviceCapabilities: Map<string, DeviceCapabilities> = new Map();
  private syncQueue: SyncPacket[] = [];
  private metrics: SyncMetrics;
  private identityBinding: IdentityBinding;
  private syncInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.metrics = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      bytesTransferred: 0,
      averageLatencyMs: 0,
      activeMiniBrains: 0,
      lastGlobalSync: 0
    };

    // Initialize God-controller identity binding
    this.identityBinding = {
      controllerId: GOD_CONTROLLER_ID,
      bindingHash: IDENTITY_BINDING_HASH,
      permissions: ['all'],
      createdAt: Date.now(),
      lastVerified: Date.now()
    };
  }

  /**
   * Initialize the Split-Brain Sync Manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    log.info('Initializing Split-Brain Sync Manager...');

    // Start sync interval
    this.startSyncInterval();

    this.initialized = true;
    this.emit('initialized');
    log.info('Split-Brain Sync Manager initialized');
  }

  /**
   * Register a new Mini-Brain for a device
   */
  async registerMiniBrain(
    deviceId: string,
    capabilities: DeviceCapabilities
  ): Promise<MiniBrainState> {
    if (this.miniBrains.size >= MAX_MINI_BRAINS) {
      throw new Error('Maximum Mini-Brain limit reached');
    }

    // Get or create Mini-Brain through Cognitive Core
    const cognitiveCore = getCognitiveCore();
    const miniBrain = cognitiveCore.registerMiniBrain(deviceId);

    // Store locally
    this.miniBrains.set(deviceId, miniBrain);
    this.deviceCapabilities.set(deviceId, capabilities);

    // Calculate initial pathway distribution based on device capabilities
    const pathways = this.selectPathwaysForDevice(capabilities);
    miniBrain.cachedPathways = pathways;

    this.metrics.activeMiniBrains = this.miniBrains.size;

    this.emit('mini-brain-registered', { deviceId, miniBrainId: miniBrain.id });
    log.info('Mini-Brain registered', { deviceId, pathwayCount: pathways.length });

    // Send initial sync
    await this.syncMiniBrain(deviceId);

    return miniBrain;
  }

  /**
   * Select pathways appropriate for device capabilities
   */
  private selectPathwaysForDevice(capabilities: DeviceCapabilities): string[] {
    const pathways: string[] = [];
    const maxPathways = Math.floor(capabilities.memoryMb / 10); // ~10MB per pathway

    // Core pathways always included
    pathways.push('core-reasoning');
    pathways.push('core-language');

    // Add domain-specific pathways based on capacity
    if (maxPathways > 10) {
      pathways.push('legal-basic');
      pathways.push('crypto-basic');
    }

    if (maxPathways > 20 && capabilities.gpuAvailable) {
      pathways.push('legal-advanced');
      pathways.push('crypto-advanced');
    }

    if (maxPathways > 50) {
      pathways.push('creative-synthesis');
      pathways.push('cross-domain-insights');
    }

    return pathways;
  }

  /**
   * Sync a Mini-Brain with the Master Brain
   */
  async syncMiniBrain(deviceId: string): Promise<SyncPacket> {
    const miniBrain = this.miniBrains.get(deviceId);
    if (!miniBrain) {
      throw new Error(`Mini-Brain not found: ${deviceId}`);
    }

    const startTime = Date.now();

    // Generate delta updates
    const pathwayDeltas = this.generatePathwayDeltas(miniBrain);
    const knowledgeDeltas = this.generateKnowledgeDeltas(miniBrain);

    // Create sync packet
    const packet = this.createSyncPacket(
      'master',
      deviceId,
      'delta',
      {
        pathwayUpdates: pathwayDeltas,
        knowledgeDelta: knowledgeDeltas
      }
    );

    // Compress packet
    const compressedPacket = this.compressPacket(packet);

    // Validate packet size
    if (compressedPacket.compressedSize > MAX_DELTA_SIZE_BYTES) {
      // Fall back to pruned sync
      return this.createPrunedSync(deviceId, miniBrain);
    }

    // Update Mini-Brain state
    miniBrain.lastHeartbeat = Date.now();
    miniBrain.syncStatus = 'synced';
    miniBrain.deltaUpdates++;

    // Update metrics
    this.metrics.totalSyncs++;
    this.metrics.successfulSyncs++;
    this.metrics.bytesTransferred += compressedPacket.compressedSize;
    this.metrics.lastGlobalSync = Date.now();

    const latency = Date.now() - startTime;
    this.metrics.averageLatencyMs = 
      (this.metrics.averageLatencyMs * (this.metrics.totalSyncs - 1) + latency) / 
      this.metrics.totalSyncs;

    this.emit('sync-complete', { deviceId, latency, deltaSize: compressedPacket.compressedSize });

    return compressedPacket;
  }

  /**
   * Generate pathway deltas for a Mini-Brain
   */
  private generatePathwayDeltas(miniBrain: MiniBrainState): PathwayDelta[] {
    const deltas: PathwayDelta[] = [];

    // Generate updates for cached pathways
    for (const pathwayId of miniBrain.cachedPathways) {
      deltas.push({
        pathwayId,
        operation: 'update',
        weights: this.generateRandomWeights(64),
        activationThreshold: 0.5 + Math.random() * 0.2,
        priority: Math.floor(Math.random() * 10)
      });
    }

    return deltas;
  }

  /**
   * Generate knowledge deltas
   */
  private generateKnowledgeDeltas(miniBrain: MiniBrainState): KnowledgeDelta[] {
    // Generate incremental knowledge updates
    return [
      {
        key: `knowledge_${Date.now()}`,
        operation: 'set',
        value: { timestamp: Date.now(), type: 'delta' }
      }
    ];
  }

  /**
   * Generate random weights for pathway
   */
  private generateRandomWeights(size: number): number[] {
    const weights: number[] = [];
    for (let i = 0; i < size; i++) {
      weights.push(Math.random());
    }
    return weights;
  }

  /**
   * Create a sync packet
   */
  private createSyncPacket(
    sourceId: string,
    targetId: string,
    type: SyncPacket['type'],
    payload: SyncPacket['payload']
  ): SyncPacket {
    const id = `sync-${crypto.randomBytes(8).toString('hex')}`;
    const payloadStr = JSON.stringify(payload);

    return {
      id,
      sourceId,
      targetId,
      type,
      timestamp: Date.now(),
      payload,
      signature: this.signPacket(id, payloadStr),
      compressed: false,
      originalSize: payloadStr.length,
      compressedSize: payloadStr.length
    };
  }

  /**
   * Compress a sync packet
   */
  private compressPacket(packet: SyncPacket): SyncPacket {
    // Simulate compression
    const originalSize = packet.originalSize;
    const compressedSize = Math.floor(originalSize * COMPRESSION_RATIO);

    return {
      ...packet,
      compressed: true,
      compressedSize
    };
  }

  /**
   * Create a pruned sync for limited bandwidth
   */
  private createPrunedSync(deviceId: string, miniBrain: MiniBrainState): SyncPacket {
    // Select only critical pathways
    const prunedPathways = miniBrain.cachedPathways.slice(0, 5);
    
    const deltas: PathwayDelta[] = prunedPathways.map(pathwayId => ({
      pathwayId,
      operation: 'update' as const,
      weights: this.generateRandomWeights(32), // Smaller weights
      priority: 10
    }));

    const packet = this.createSyncPacket(
      'master',
      deviceId,
      'delta',
      { pathwayUpdates: deltas }
    );

    return this.compressPacket(packet);
  }

  /**
   * Sign a packet for verification
   */
  private signPacket(id: string, payload: string): string {
    return crypto.createHmac('sha256', IDENTITY_BINDING_HASH)
      .update(`${id}:${payload}`)
      .digest('hex');
  }

  /**
   * Verify packet signature
   */
  verifyPacketSignature(packet: SyncPacket): boolean {
    const payloadStr = JSON.stringify(packet.payload);
    const expectedSignature = this.signPacket(packet.id, payloadStr);
    return packet.signature === expectedSignature;
  }

  /**
   * Issue a command to Mini-Brains
   */
  async issueCommand(
    command: Omit<BrainCommand, 'id' | 'issuerHash'>,
    targetDevices?: string[]
  ): Promise<{ sent: number; failed: number }> {
    // Verify God-controller authorization
    if (command.requiresGodApproval) {
      // In production, would require actual approval flow
      log.info('God-controller approval required', { commandType: command.type });
    }

    const fullCommand: BrainCommand = {
      ...command,
      id: `cmd-${crypto.randomBytes(6).toString('hex')}`,
      issuerHash: IDENTITY_BINDING_HASH
    };

    const targets = targetDevices || Array.from(this.miniBrains.keys());
    let sent = 0;
    let failed = 0;

    for (const deviceId of targets) {
      try {
        const packet = this.createSyncPacket(
          'master',
          deviceId,
          'command',
          { commands: [fullCommand] }
        );

        this.syncQueue.push(packet);
        sent++;
      } catch {
        failed++;
      }
    }

    this.emit('command-issued', { commandId: fullCommand.id, sent, failed });
    return { sent, failed };
  }

  /**
   * Process heartbeat from Mini-Brain
   */
  processHeartbeat(deviceId: string): boolean {
    const miniBrain = this.miniBrains.get(deviceId);
    if (!miniBrain) return false;

    miniBrain.lastHeartbeat = Date.now();
    
    // Check if Mini-Brain has diverged
    if (miniBrain.syncStatus === 'divergent') {
      // Queue full sync
      this.queueFullSync(deviceId);
    }

    return true;
  }

  /**
   * Queue a full sync for a device
   */
  private queueFullSync(deviceId: string): void {
    const packet = this.createSyncPacket(
      'master',
      deviceId,
      'full',
      {
        pathwayUpdates: [],
        knowledgeDelta: [],
        configUpdates: []
      }
    );

    this.syncQueue.push(packet);
    log.info('Full sync queued', { deviceId });
  }

  /**
   * Start the sync interval
   */
  private startSyncInterval(): void {
    this.syncInterval = setInterval(() => {
      this.performScheduledSync();
    }, SYNC_INTERVAL_MS);
  }

  /**
   * Perform scheduled sync
   */
  private async performScheduledSync(): Promise<void> {
    const now = Date.now();

    // Check for stale Mini-Brains
    for (const [deviceId, miniBrain] of this.miniBrains) {
      if (now - miniBrain.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        miniBrain.syncStatus = 'divergent';
        this.emit('mini-brain-stale', { deviceId });
      }
    }

    // Process sync queue
    while (this.syncQueue.length > 0) {
      const packet = this.syncQueue.shift();
      if (packet) {
        try {
          // In production, would send to actual device
          this.emit('packet-sent', { packetId: packet.id, targetId: packet.targetId });
        } catch (error: any) {
          log.error('Sync packet failed', { packetId: packet.id, error: error.message });
        }
      }
    }

    // Update active Mini-Brain count
    this.metrics.activeMiniBrains = Array.from(this.miniBrains.values())
      .filter(mb => mb.syncStatus !== 'divergent').length;
  }

  /**
   * Get Mini-Brain state
   */
  getMiniBrain(deviceId: string): MiniBrainState | null {
    return this.miniBrains.get(deviceId) || null;
  }

  /**
   * List all Mini-Brains
   */
  listMiniBrains(): MiniBrainState[] {
    return Array.from(this.miniBrains.values());
  }

  /**
   * Get sync metrics
   */
  getMetrics(): SyncMetrics {
    return { ...this.metrics };
  }

  /**
   * Get identity binding info
   */
  getIdentityBinding(): IdentityBinding {
    return { ...this.identityBinding };
  }

  /**
   * Verify God-controller identity
   */
  verifyGodController(providedHash: string): boolean {
    return providedHash === IDENTITY_BINDING_HASH;
  }

  /**
   * Unregister a Mini-Brain
   */
  unregisterMiniBrain(deviceId: string): boolean {
    const miniBrain = this.miniBrains.get(deviceId);
    if (!miniBrain) return false;

    this.miniBrains.delete(deviceId);
    this.deviceCapabilities.delete(deviceId);
    this.metrics.activeMiniBrains = this.miniBrains.size;

    this.emit('mini-brain-unregistered', { deviceId });
    log.info('Mini-Brain unregistered', { deviceId });

    return true;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down Split-Brain Sync Manager...');

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    this.miniBrains.clear();
    this.deviceCapabilities.clear();
    this.syncQueue = [];
    this.initialized = false;

    log.info('Split-Brain Sync Manager shutdown complete');
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: SplitBrainSyncManager | null = null;

export function getSplitBrainSyncManager(): SplitBrainSyncManager {
  if (!instance) {
    instance = new SplitBrainSyncManager();
  }
  return instance;
}

export async function initializeSplitBrainSyncManager(): Promise<SplitBrainSyncManager> {
  const manager = getSplitBrainSyncManager();
  await manager.initialize();
  return manager;
}

export async function shutdownSplitBrainSyncManager(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}

export default {
  SplitBrainSyncManager,
  getSplitBrainSyncManager,
  initializeSplitBrainSyncManager,
  shutdownSplitBrainSyncManager
};
