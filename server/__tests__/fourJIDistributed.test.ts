/**
 * 4JI Distributed Architecture Tests
 * 
 * Comprehensive test suite for:
 * - Model Artifact Manager
 * - Faucet Gateway
 * - Edge Worker Manager
 * - Volunteer Compute Manager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Import modules
import {
  ModelArtifactManager,
  getModelArtifactManager,
  initializeModelArtifactManager,
  shutdownModelArtifactManager
} from '../modelArtifactManager';

import {
  FaucetGateway,
  getFaucetGateway,
  initializeFaucetGateway,
  shutdownFaucetGateway
} from '../faucetGateway';

import {
  EdgeWorkerManager,
  getEdgeWorkerManager,
  initializeEdgeWorkerManager,
  shutdownEdgeWorkerManager
} from '../edgeWorkerManager';

import {
  VolunteerComputeManager,
  getVolunteerComputeManager,
  initializeVolunteerComputeManager,
  shutdownVolunteerComputeManager
} from '../volunteerComputeManager';

// ============================================================================
// MODEL ARTIFACT MANAGER TESTS
// ============================================================================

describe('ModelArtifactManager', () => {
  let manager: ModelArtifactManager;

  beforeEach(async () => {
    await shutdownModelArtifactManager();
    manager = await initializeModelArtifactManager();
  });

  afterEach(async () => {
    await shutdownModelArtifactManager();
  });

  it('should initialize correctly', () => {
    expect(manager.isInitialized()).toBe(true);
  });

  it('should create a model artifact', async () => {
    const weightsData = new Uint8Array(1000);
    for (let i = 0; i < weightsData.length; i++) {
      weightsData[i] = i % 256;
    }

    const metadata = {
      architecture: 'transformer',
      parameters: 1000000,
      layers: 6,
      inputShape: [1, 512],
      outputShape: [1, 512],
      capabilities: ['text-generation']
    };

    const artifact = await manager.createArtifact(
      'test-model',
      '1.0.0',
      'micro',
      'legal',
      weightsData,
      metadata,
      { compressionLevel: 4, quantizationBits: 8 }
    );

    expect(artifact).toBeDefined();
    expect(artifact.name).toBe('test-model');
    expect(artifact.version).toBe('1.0.0');
    expect(artifact.type).toBe('micro');
    expect(artifact.domain).toBe('legal');
    expect(artifact.compression.format).toBe('zstd');
    expect(artifact.quantization.bits).toBe(8);
  });

  it('should load a model bundle', async () => {
    // Create artifact first
    const weightsData = new Uint8Array(500);
    const metadata = {
      architecture: 'test',
      parameters: 500,
      layers: 2,
      inputShape: [1, 64],
      outputShape: [1, 64],
      capabilities: ['test']
    };

    const artifact = await manager.createArtifact(
      'load-test',
      '1.0.0',
      'student',
      'shared',
      weightsData,
      metadata
    );

    // Load bundle
    const bundle = await manager.loadBundle(artifact.id);

    expect(bundle).toBeDefined();
    expect(bundle?.artifact.id).toBe(artifact.id);
    expect(bundle?.metadata.architecture).toBe('test');
  });

  it('should verify artifact signatures', async () => {
    const weightsData = new Uint8Array(100);
    const metadata = {
      architecture: 'test',
      parameters: 100,
      layers: 1,
      inputShape: [1, 10],
      outputShape: [1, 10],
      capabilities: []
    };

    const artifact = await manager.createArtifact(
      'verify-test',
      '1.0.0',
      'micro',
      'legal',
      weightsData,
      metadata
    );

    const isValid = manager.verifySignature(artifact);
    expect(isValid).toBe(true);
  });

  it('should return storage statistics', async () => {
    const stats = manager.getStorageStats();

    expect(stats).toBeDefined();
    expect(typeof stats.totalArtifacts).toBe('number');
    expect(typeof stats.loadedBundles).toBe('number');
    expect(typeof stats.compressionRatio).toBe('number');
  });

  it('should list artifacts with filters', async () => {
    const weightsData = new Uint8Array(100);
    const metadata = {
      architecture: 'test',
      parameters: 100,
      layers: 1,
      inputShape: [1, 10],
      outputShape: [1, 10],
      capabilities: []
    };

    await manager.createArtifact('legal-model', '1.0.0', 'micro', 'legal', weightsData, metadata);
    await manager.createArtifact('crypto-model', '1.0.0', 'student', 'crypto', weightsData, metadata);

    const legalArtifacts = manager.listArtifacts({ domain: 'legal' });
    const microArtifacts = manager.listArtifacts({ type: 'micro' });

    expect(legalArtifacts.length).toBeGreaterThanOrEqual(1);
    expect(microArtifacts.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// FAUCET GATEWAY TESTS
// ============================================================================

describe('FaucetGateway', () => {
  let gateway: FaucetGateway;

  beforeEach(async () => {
    await shutdownFaucetGateway();
    gateway = await initializeFaucetGateway();
  });

  afterEach(async () => {
    await shutdownFaucetGateway();
  });

  it('should initialize correctly', () => {
    expect(gateway.isInitialized()).toBe(true);
  });

  it('should have default policies', () => {
    const defaultPolicy = gateway.getPolicy('default');
    const externalPolicy = gateway.getPolicy('external');

    expect(defaultPolicy).toBeDefined();
    expect(defaultPolicy?.name).toBe('Default Policy');
    expect(externalPolicy).toBeDefined();
    expect(externalPolicy?.approval.requiredSignatures).toBe(2);
  });

  it('should submit auto-approved transactions', async () => {
    const tx = await gateway.submitTransaction(
      'api_call',
      'test-action',
      { key: 'value' },
      'user-1'
    );

    expect(tx).toBeDefined();
    expect(tx.authorization.approved).toBe(true);
    expect(tx.execution.status).toBe('completed');
  });

  it('should enforce rate limits', async () => {
    // Submit many requests to trigger rate limit
    for (let i = 0; i < 10; i++) {
      await gateway.submitTransaction(
        'api_call',
        `action-${i}`,
        {},
        'rate-test-user'
      );
    }

    // Check rate limit status
    const status = gateway.getRateLimitStatus('rate-test-user:api_call');
    expect(status.requestsLastMinute).toBeGreaterThan(0);
  });

  it('should reject blocked actions', async () => {
    await expect(
      gateway.submitTransaction(
        'external_action',
        'delete_all',
        {},
        'user-1'
      )
    ).rejects.toThrow('blocked');
  });

  it('should return gateway statistics', () => {
    const stats = gateway.getStats();

    expect(stats).toBeDefined();
    expect(typeof stats.totalTransactions).toBe('number');
    expect(typeof stats.policies).toBe('number');
    expect(stats.policies).toBeGreaterThan(0);
  });

  it('should maintain audit log', async () => {
    await gateway.submitTransaction('api_call', 'test', {}, 'audit-user');

    const auditLog = gateway.getAuditLog(10);

    expect(auditLog.length).toBeGreaterThan(0);
    expect(auditLog[0].action.type).toBeDefined();
  });
});

// ============================================================================
// EDGE WORKER MANAGER TESTS
// ============================================================================

describe('EdgeWorkerManager', () => {
  let manager: EdgeWorkerManager;

  beforeEach(async () => {
    await shutdownEdgeWorkerManager();
    manager = await initializeEdgeWorkerManager();
  });

  afterEach(async () => {
    await shutdownEdgeWorkerManager();
  });

  it('should initialize correctly', () => {
    expect(manager.isInitialized()).toBe(true);
  });

  it('should register edge workers', () => {
    const worker = manager.registerWorker(
      'device-123',
      {
        wasm: true,
        webgpu: true,
        webgl: true,
        simd: true,
        threads: true,
        memory: 4096,
        storage: 10240
      },
      'user-1'
    );

    expect(worker).toBeDefined();
    expect(worker.deviceId).toBe('device-123');
    expect(worker.status).toBe('online');
    expect(worker.capabilities.wasm).toBe(true);
  });

  it('should submit tasks to workers', async () => {
    const worker = manager.registerWorker(
      'device-456',
      { wasm: true, webgpu: false, webgl: true, simd: true, threads: true, memory: 2048, storage: 5120 }
    );

    const task = await manager.submitTask(
      worker.id,
      'inference',
      'model-123',
      { input: 'test input' }
    );

    expect(task).toBeDefined();
    expect(task.type).toBe('inference');
    expect(task.modelId).toBe('model-123');
  });

  it('should enable federated learning', () => {
    const worker = manager.registerWorker(
      'device-789',
      { wasm: true, webgpu: false, webgl: true, simd: false, threads: true, memory: 1024, storage: 2048 }
    );

    const result = manager.enableFederatedLearning(worker.id, 'high');

    expect(result).toBe(true);
    
    const updatedWorker = manager.getWorker(worker.id);
    expect(updatedWorker?.federatedLearning.enabled).toBe(true);
    expect(updatedWorker?.federatedLearning.privacyLevel).toBe('high');
  });

  it('should sync documents with CRDT', () => {
    const worker = manager.registerWorker(
      'device-crdt',
      { wasm: true, webgpu: false, webgl: true, simd: true, threads: true, memory: 2048, storage: 4096 }
    );

    const doc = manager.syncDocument(
      worker.id,
      'settings',
      'user-settings',
      { theme: 'dark', fontSize: 14 },
      { [worker.id]: 1 }
    );

    expect(doc).toBeDefined();
    expect(doc.collection).toBe('settings');
    expect(doc.state.value).toEqual({ theme: 'dark', fontSize: 14 });
  });

  it('should return edge worker statistics', () => {
    manager.registerWorker('device-1', { wasm: true, webgpu: false, webgl: true, simd: true, threads: true, memory: 1024, storage: 2048 });
    manager.registerWorker('device-2', { wasm: true, webgpu: true, webgl: true, simd: true, threads: true, memory: 4096, storage: 8192 });

    const stats = manager.getStats();

    expect(stats.totalWorkers).toBe(2);
    expect(stats.onlineWorkers).toBe(2);
  });
});

// ============================================================================
// VOLUNTEER COMPUTE MANAGER TESTS
// ============================================================================

describe('VolunteerComputeManager', () => {
  let manager: VolunteerComputeManager;

  beforeEach(async () => {
    await shutdownVolunteerComputeManager();
    manager = await initializeVolunteerComputeManager();
  });

  afterEach(async () => {
    await shutdownVolunteerComputeManager();
  });

  it('should initialize correctly', () => {
    expect(manager.isInitialized()).toBe(true);
  });

  it('should register volunteer workers', async () => {
    const worker = await manager.registerWorker(
      'owner-1',
      'attestation-data',
      'public-key-123',
      {
        gpuModel: 'RTX 4090',
        gpuMemory: 24,
        cpuCores: 16,
        ramGb: 64,
        diskGb: 500
      },
      {
        type: 'docker',
        version: '24.0',
        sandbox: true
      },
      {
        scope: ['training', 'inference', 'monte-carlo'],
        expiresAt: new Date(Date.now() + 86400000 * 30).toISOString()
      }
    );

    expect(worker).toBeDefined();
    expect(worker.ownerId).toBe('owner-1');
    expect(worker.hardware.gpuModel).toBe('RTX 4090');
    expect(worker.trustScore).toBe(70);
  });

  it('should submit compute tasks', async () => {
    const task = await manager.submitTask(
      'monte-carlo',
      {
        image: 'docker.io/4ji/monte-carlo:latest',
        entrypoint: '/run.sh',
        args: ['--iterations', '1000'],
        env: { MODE: 'production' },
        inputArtifacts: ['artifact-1'],
        outputSpec: ['results.json']
      },
      {
        minCpuCores: 4,
        minRamGb: 8,
        maxDurationHours: 2,
        preferGpu: true
      }
    );

    expect(task).toBeDefined();
    expect(task.type).toBe('monte-carlo');
    expect(task.status).toBe('pending');
  });

  it('should return queue status', async () => {
    // Submit some tasks
    await manager.submitTask(
      'inference',
      {
        image: 'test-image',
        entrypoint: '/run.sh',
        args: [],
        env: {},
        inputArtifacts: [],
        outputSpec: []
      },
      { minCpuCores: 2, minRamGb: 4, maxDurationHours: 1, preferGpu: false }
    );

    const queueStatus = manager.getQueueStatus();

    expect(queueStatus).toBeDefined();
    expect(queueStatus.pendingTasks).toBeGreaterThan(0);
  });

  it('should return pool statistics', async () => {
    await manager.registerWorker(
      'owner-stats',
      'attestation',
      'public-key',
      { cpuCores: 8, ramGb: 32, diskGb: 200 },
      { type: 'docker', version: '24.0', sandbox: true },
      { scope: ['inference'], expiresAt: new Date(Date.now() + 86400000).toISOString() }
    );

    const stats = manager.getPoolStats();

    expect(stats).toBeDefined();
    expect(stats.totalWorkers).toBe(1);
    expect(stats.totalCpuCores).toBe(8);
  });

  it('should list workers with filters', async () => {
    await manager.registerWorker(
      'owner-filter-1',
      'attestation',
      'key-1',
      { gpuModel: 'RTX 3090', gpuMemory: 24, cpuCores: 8, ramGb: 32, diskGb: 200 },
      { type: 'docker', version: '24.0', sandbox: true },
      { scope: ['training'], expiresAt: new Date(Date.now() + 86400000).toISOString() }
    );

    await manager.registerWorker(
      'owner-filter-2',
      'attestation',
      'key-2',
      { cpuCores: 4, ramGb: 16, diskGb: 100 },
      { type: 'wasm', version: '1.0', sandbox: true },
      { scope: ['inference'], expiresAt: new Date(Date.now() + 86400000).toISOString() }
    );

    const gpuWorkers = manager.listWorkers({ hasGpu: true });
    const availableWorkers = manager.listWorkers({ status: 'available' });

    expect(gpuWorkers.length).toBe(1);
    expect(availableWorkers.length).toBe(2);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('4JI Distributed Architecture Integration', () => {
  beforeEach(async () => {
    await shutdownModelArtifactManager();
    await shutdownFaucetGateway();
    await shutdownEdgeWorkerManager();
    await shutdownVolunteerComputeManager();
  });

  afterEach(async () => {
    await shutdownVolunteerComputeManager();
    await shutdownEdgeWorkerManager();
    await shutdownFaucetGateway();
    await shutdownModelArtifactManager();
  });

  it('should initialize all components together', async () => {
    const artifactManager = await initializeModelArtifactManager();
    const faucetGateway = await initializeFaucetGateway();
    const edgeManager = await initializeEdgeWorkerManager();
    const volunteerManager = await initializeVolunteerComputeManager();

    expect(artifactManager.isInitialized()).toBe(true);
    expect(faucetGateway.isInitialized()).toBe(true);
    expect(edgeManager.isInitialized()).toBe(true);
    expect(volunteerManager.isInitialized()).toBe(true);
  });

  it('should create artifact and distribute to edge workers', async () => {
    const artifactManager = await initializeModelArtifactManager();
    const edgeManager = await initializeEdgeWorkerManager();

    // Create model artifact
    const artifact = await artifactManager.createArtifact(
      'edge-model',
      '1.0.0',
      'student',
      'legal',
      new Uint8Array(500),
      {
        architecture: 'mini-transformer',
        parameters: 5000,
        layers: 2,
        inputShape: [1, 64],
        outputShape: [1, 64],
        capabilities: ['legal-analysis']
      }
    );

    // Register edge worker
    const worker = edgeManager.registerWorker(
      'edge-device',
      { wasm: true, webgpu: false, webgl: true, simd: true, threads: true, memory: 2048, storage: 4096 }
    );

    // Update worker's cached models
    edgeManager.updateCachedModels(worker.id, [artifact.id]);

    const updatedWorker = edgeManager.getWorker(worker.id);
    expect(updatedWorker?.cachedModels).toContain(artifact.id);
  });

  it('should process faucet transaction through gateway', async () => {
    const faucetGateway = await initializeFaucetGateway();

    // Submit transaction
    const tx = await faucetGateway.submitTransaction(
      'model_inference',
      'run-legal-analysis',
      { query: 'What are my rights?' },
      'test-user'
    );

    expect(tx.execution.status).toBe('completed');
    expect(tx.authorization.approved).toBe(true);
  });
});
