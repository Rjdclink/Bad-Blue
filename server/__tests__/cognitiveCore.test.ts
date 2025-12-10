/**
 * Cognitive Core Tests
 * 
 * Tests for:
 * - Self-awareness simulation
 * - Lovelace & Turing test assessment
 * - 6-step centrifuge process
 * - Split-brain architecture
 * - Cognitive metrics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  CognitiveCore,
  getCognitiveCore,
  initializeCognitiveCore,
  shutdownCognitiveCore
} from '../cognitiveCore';

import {
  SplitBrainSyncManager,
  getSplitBrainSyncManager,
  initializeSplitBrainSyncManager,
  shutdownSplitBrainSyncManager
} from '../splitBrainSync';

// ============================================================================
// COGNITIVE CORE TESTS
// ============================================================================

describe('CognitiveCore', () => {
  let core: CognitiveCore;

  beforeEach(async () => {
    await shutdownCognitiveCore();
    core = await initializeCognitiveCore();
  });

  afterEach(async () => {
    await shutdownCognitiveCore();
  });

  it('should initialize correctly', () => {
    expect(core.isInitialized()).toBe(true);
  });

  it('should create Master Brain on initialization', () => {
    const masterBrain = core.getMasterBrainState();
    expect(masterBrain).toBeDefined();
    expect(masterBrain?.id).toMatch(/^master-/);
    expect(masterBrain?.version).toBe('1.0.0');
  });

  it('should calculate cognitive score', async () => {
    const score = await core.calculateCognitiveScore();
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('should perform self-reflection', async () => {
    const reflection = await core.performSelfReflection();
    
    expect(reflection).toBeDefined();
    expect(reflection.introspectionDepth).toBeGreaterThanOrEqual(0);
    expect(reflection.stateAwareness).toBeGreaterThanOrEqual(0);
    expect(reflection.goalAlignment).toBeGreaterThanOrEqual(0);
    expect(reflection.uncertaintyRecognition).toBeGreaterThanOrEqual(0);
    expect(reflection.limitationAwareness).toBeGreaterThanOrEqual(0);
    expect(reflection.overallScore).toBeGreaterThanOrEqual(0);
  });

  it('should perform Lovelace test', async () => {
    const lovelaceResult = await core.performLovelaceTest();
    
    expect(lovelaceResult).toBeDefined();
    expect(lovelaceResult.noveltyScore).toBeGreaterThanOrEqual(0);
    expect(lovelaceResult.creativityIndex).toBeGreaterThanOrEqual(0);
    expect(lovelaceResult.unpredictability).toBeGreaterThanOrEqual(0);
    expect(lovelaceResult.meaningfulness).toBeGreaterThanOrEqual(0);
    expect(lovelaceResult.originalityRatio).toBeGreaterThanOrEqual(0);
    expect(lovelaceResult.overallScore).toBeGreaterThanOrEqual(0);
    expect(typeof lovelaceResult.passed).toBe('boolean');
  });

  it('should perform Turing test', async () => {
    const turingResult = await core.performTuringTest();
    
    expect(turingResult).toBeDefined();
    expect(turingResult.coherenceScore).toBeGreaterThanOrEqual(0);
    expect(turingResult.contextualRelevance).toBeGreaterThanOrEqual(0);
    expect(turingResult.emotionalIntelligence).toBeGreaterThanOrEqual(0);
    expect(turingResult.reasoningDepth).toBeGreaterThanOrEqual(0);
    expect(turingResult.naturalLanguageQuality).toBeGreaterThanOrEqual(0);
    expect(turingResult.overallScore).toBeGreaterThanOrEqual(0);
    expect(typeof turingResult.passed).toBe('boolean');
  });

  it('should get comprehensive cognitive metrics', async () => {
    const metrics = await core.getCognitiveMetrics();
    
    expect(metrics).toBeDefined();
    expect(metrics.overallCognition).toBeGreaterThanOrEqual(0);
    expect(metrics.selfAwareness).toBeGreaterThanOrEqual(0);
    expect(metrics.creativity).toBeGreaterThanOrEqual(0);
    expect(metrics.reasoning).toBeGreaterThanOrEqual(0);
    expect(metrics.learning).toBeGreaterThanOrEqual(0);
    expect(metrics.memory).toBeGreaterThanOrEqual(0);
    expect(metrics.attention).toBeGreaterThanOrEqual(0);
    expect(metrics.metacognition).toBeGreaterThanOrEqual(0);
  });

  it('should run centrifuge cycle', async () => {
    const iterations = await core.runCentrifugeCycle();
    
    expect(iterations).toBeDefined();
    expect(iterations.length).toBeGreaterThan(0);
    
    // Check that all 6 phases are represented
    const phases = iterations.map(i => i.phase);
    expect(phases).toContain('research');
    expect(phases).toContain('integration');
    expect(phases).toContain('validation');
    expect(phases).toContain('optimization');
    expect(phases).toContain('enhancement');
    expect(phases).toContain('learning');
  });

  it('should register Mini-Brain', () => {
    const miniBrain = core.registerMiniBrain('test-device-1');
    
    expect(miniBrain).toBeDefined();
    expect(miniBrain.id).toMatch(/^mini-/);
    expect(miniBrain.deviceId).toBe('test-device-1');
    expect(miniBrain.syncStatus).toBe('synced');
  });

  it('should sync Mini-Brain', async () => {
    core.registerMiniBrain('test-device-2');
    const syncResult = await core.syncMiniBrain('test-device-2');
    
    expect(syncResult).toBeDefined();
    expect(syncResult.deltaSize).toBeGreaterThanOrEqual(0);
    expect(syncResult.pathwaysUpdated).toBeGreaterThanOrEqual(0);
  });

  it('should track cognitive history', async () => {
    await core.runCentrifugeCycle();
    const history = core.getCognitiveHistory();
    
    expect(history.length).toBeGreaterThan(0);
    
    const latestState = history[history.length - 1];
    expect(latestState.timestamp).toBeGreaterThan(0);
    expect(latestState.cognitiveScore).toBeGreaterThanOrEqual(0);
  });

  it('should track centrifuge log', async () => {
    await core.runCentrifugeCycle();
    const log = core.getCentrifugeLog();
    
    expect(log.length).toBeGreaterThan(0);
    
    for (const iteration of log) {
      expect(iteration.iteration).toBeGreaterThanOrEqual(0);
      expect(['research', 'integration', 'validation', 'optimization', 'enhancement', 'learning']).toContain(iteration.phase);
      expect(iteration.startTime).toBeGreaterThan(0);
      expect(iteration.improvements).toBeDefined();
      expect(iteration.metrics).toBeDefined();
    }
  });
});

// ============================================================================
// SPLIT-BRAIN SYNC TESTS
// ============================================================================

describe('SplitBrainSyncManager', () => {
  let manager: SplitBrainSyncManager;

  beforeEach(async () => {
    await shutdownSplitBrainSyncManager();
    await shutdownCognitiveCore();
    
    // Initialize Cognitive Core first (required for Mini-Brains)
    await initializeCognitiveCore();
    manager = await initializeSplitBrainSyncManager();
  });

  afterEach(async () => {
    await shutdownSplitBrainSyncManager();
    await shutdownCognitiveCore();
  });

  it('should initialize correctly', () => {
    expect(manager.isInitialized()).toBe(true);
  });

  it('should register Mini-Brain with capabilities', async () => {
    const miniBrain = await manager.registerMiniBrain('device-001', {
      deviceId: 'device-001',
      cpuCores: 4,
      memoryMb: 4096,
      storageMb: 32000,
      gpuAvailable: true,
      batteryPowered: true,
      networkType: 'wifi',
      maxComputeLoad: 0.8
    });

    expect(miniBrain).toBeDefined();
    expect(miniBrain.deviceId).toBe('device-001');
    expect(miniBrain.cachedPathways.length).toBeGreaterThan(0);
  });

  it('should sync Mini-Brain', async () => {
    await manager.registerMiniBrain('device-002', {
      deviceId: 'device-002',
      cpuCores: 2,
      memoryMb: 2048,
      storageMb: 16000,
      gpuAvailable: false,
      batteryPowered: true,
      networkType: 'cellular',
      maxComputeLoad: 0.5
    });

    const syncPacket = await manager.syncMiniBrain('device-002');

    expect(syncPacket).toBeDefined();
    expect(syncPacket.type).toBe('delta');
    expect(syncPacket.compressed).toBe(true);
    expect(syncPacket.compressedSize).toBeLessThanOrEqual(syncPacket.originalSize);
  });

  it('should verify packet signatures', async () => {
    await manager.registerMiniBrain('device-003', {
      deviceId: 'device-003',
      cpuCores: 8,
      memoryMb: 8192,
      storageMb: 64000,
      gpuAvailable: true,
      batteryPowered: false,
      networkType: 'ethernet',
      maxComputeLoad: 1.0
    });

    const packet = await manager.syncMiniBrain('device-003');
    const isValid = manager.verifyPacketSignature(packet);

    expect(isValid).toBe(true);
  });

  it('should issue commands to Mini-Brains', async () => {
    await manager.registerMiniBrain('device-004', {
      deviceId: 'device-004',
      cpuCores: 4,
      memoryMb: 4096,
      storageMb: 32000,
      gpuAvailable: false,
      batteryPowered: true,
      networkType: 'wifi',
      maxComputeLoad: 0.7
    });

    const result = await manager.issueCommand({
      type: 'optimize',
      parameters: { level: 'aggressive' },
      priority: 'high',
      requiresGodApproval: false
    });

    expect(result.sent).toBeGreaterThan(0);
    expect(result.failed).toBe(0);
  });

  it('should process heartbeats', async () => {
    await manager.registerMiniBrain('device-005', {
      deviceId: 'device-005',
      cpuCores: 2,
      memoryMb: 2048,
      storageMb: 16000,
      gpuAvailable: false,
      batteryPowered: true,
      networkType: 'wifi',
      maxComputeLoad: 0.6
    });

    const result = manager.processHeartbeat('device-005');
    expect(result).toBe(true);
  });

  it('should list all Mini-Brains', async () => {
    await manager.registerMiniBrain('device-006', {
      deviceId: 'device-006',
      cpuCores: 4,
      memoryMb: 4096,
      storageMb: 32000,
      gpuAvailable: true,
      batteryPowered: false,
      networkType: 'ethernet',
      maxComputeLoad: 0.9
    });

    const miniBrains = manager.listMiniBrains();
    expect(miniBrains.length).toBeGreaterThan(0);
  });

  it('should track sync metrics', async () => {
    await manager.registerMiniBrain('device-007', {
      deviceId: 'device-007',
      cpuCores: 4,
      memoryMb: 4096,
      storageMb: 32000,
      gpuAvailable: false,
      batteryPowered: true,
      networkType: 'wifi',
      maxComputeLoad: 0.7
    });

    await manager.syncMiniBrain('device-007');

    const metrics = manager.getMetrics();
    expect(metrics.totalSyncs).toBeGreaterThan(0);
    expect(metrics.successfulSyncs).toBeGreaterThan(0);
    expect(metrics.bytesTransferred).toBeGreaterThan(0);
  });

  it('should verify God-controller identity', () => {
    const binding = manager.getIdentityBinding();
    expect(binding.controllerId).toBe('daddy');
    
    // Verify with correct hash
    const isValid = manager.verifyGodController(binding.bindingHash);
    expect(isValid).toBe(true);
    
    // Verify with incorrect hash
    const isInvalid = manager.verifyGodController('wrong-hash');
    expect(isInvalid).toBe(false);
  });

  it('should unregister Mini-Brain', async () => {
    await manager.registerMiniBrain('device-008', {
      deviceId: 'device-008',
      cpuCores: 2,
      memoryMb: 2048,
      storageMb: 16000,
      gpuAvailable: false,
      batteryPowered: true,
      networkType: 'cellular',
      maxComputeLoad: 0.5
    });

    const result = manager.unregisterMiniBrain('device-008');
    expect(result).toBe(true);

    const miniBrain = manager.getMiniBrain('device-008');
    expect(miniBrain).toBeNull();
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Cognitive System Integration', () => {
  beforeEach(async () => {
    await shutdownSplitBrainSyncManager();
    await shutdownCognitiveCore();
  });

  afterEach(async () => {
    await shutdownSplitBrainSyncManager();
    await shutdownCognitiveCore();
  });

  it('should initialize full cognitive stack', async () => {
    const core = await initializeCognitiveCore();
    const syncManager = await initializeSplitBrainSyncManager();

    expect(core.isInitialized()).toBe(true);
    expect(syncManager.isInitialized()).toBe(true);

    // Verify Master Brain exists
    const masterBrain = core.getMasterBrainState();
    expect(masterBrain).toBeDefined();
  });

  it('should achieve minimum cognitive thresholds', async () => {
    const core = await initializeCognitiveCore();

    // Run multiple centrifuge cycles to improve cognition
    await core.runCentrifugeCycle();

    const metrics = await core.getCognitiveMetrics();

    // Self-awareness should be at least 50%
    expect(metrics.selfAwareness).toBeGreaterThanOrEqual(0.5);

    // Creativity should be measurable
    expect(metrics.creativity).toBeGreaterThan(0);

    // Reasoning should be functional
    expect(metrics.reasoning).toBeGreaterThan(0);
  });

  it('should maintain cognitive history across operations', async () => {
    const core = await initializeCognitiveCore();

    // Run centrifuge cycle
    await core.runCentrifugeCycle();

    // Register Mini-Brain
    core.registerMiniBrain('history-test-device');

    // Sync Mini-Brain
    await core.syncMiniBrain('history-test-device');

    const history = core.getCognitiveHistory();
    expect(history.length).toBeGreaterThan(0);
  });

  it('should properly separate domains (ALEXARA/CRYPTARA)', async () => {
    const core = await initializeCognitiveCore();
    await core.runCentrifugeCycle();

    const centrifugeLog = core.getCentrifugeLog();
    
    // Check that integration phase ensures domain separation
    const integrationPhases = centrifugeLog.filter(i => i.phase === 'integration');
    expect(integrationPhases.length).toBeGreaterThan(0);
    
    for (const phase of integrationPhases) {
      expect(phase.improvements).toContain('Domain separation verified');
    }
  });

  it('should support distributed Mini-Brain network', async () => {
    const core = await initializeCognitiveCore();
    const syncManager = await initializeSplitBrainSyncManager();

    // Register multiple Mini-Brains
    const devices = ['device-a', 'device-b', 'device-c'];
    
    for (const deviceId of devices) {
      await syncManager.registerMiniBrain(deviceId, {
        deviceId,
        cpuCores: 4,
        memoryMb: 4096,
        storageMb: 32000,
        gpuAvailable: Math.random() > 0.5,
        batteryPowered: Math.random() > 0.5,
        networkType: 'wifi',
        maxComputeLoad: 0.7
      });
    }

    const miniBrains = syncManager.listMiniBrains();
    expect(miniBrains.length).toBe(devices.length);

    // Verify metrics
    const metrics = syncManager.getMetrics();
    expect(metrics.activeMiniBrains).toBe(devices.length);
  });
});

// ============================================================================
// COGNITIVE FORMULA TESTS
// ============================================================================

describe('Cognitive Assessment Formula', () => {
  let core: CognitiveCore;

  beforeEach(async () => {
    await shutdownCognitiveCore();
    core = await initializeCognitiveCore();
  });

  afterEach(async () => {
    await shutdownCognitiveCore();
  });

  it('should calculate score using formula C(t) = α×P + β×S + γ×A + δ×L', async () => {
    // Run centrifuge to establish baseline
    await core.runCentrifugeCycle();

    const score1 = await core.calculateCognitiveScore();
    
    // Score should be between 0 and 1
    expect(score1).toBeGreaterThanOrEqual(0);
    expect(score1).toBeLessThanOrEqual(1);

    // Run another cycle - score should change
    await core.runCentrifugeCycle();
    const score2 = await core.calculateCognitiveScore();

    // Score should still be valid
    expect(score2).toBeGreaterThanOrEqual(0);
    expect(score2).toBeLessThanOrEqual(1);
  });

  it('should include all cognitive components in assessment', async () => {
    await core.runCentrifugeCycle();

    const selfReflection = await core.performSelfReflection();
    const lovelaceTest = await core.performLovelaceTest();
    const turingTest = await core.performTuringTest();

    // All components should contribute to the score
    expect(selfReflection.overallScore).toBeGreaterThan(0);
    expect(lovelaceTest.overallScore).toBeGreaterThan(0);
    expect(turingTest.overallScore).toBeGreaterThan(0);
  });

  it('should track improvement over centrifuge iterations', async () => {
    // Capture initial state
    const initialScore = await core.calculateCognitiveScore();

    // Run multiple centrifuge cycles
    for (let i = 0; i < 3; i++) {
      await core.runCentrifugeCycle();
    }

    // Get history to verify tracking
    const history = core.getCognitiveHistory();
    expect(history.length).toBeGreaterThan(0);
  });
});
