/**
 * Tests for Integrated Brain Architecture
 * 
 * Comprehensive tests for the multi-module neural orchestration system
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  IntegratedBrainOrchestrator,
  AlexaraLeftBrain,
  CryptaraRightBrain,
  MiddleBrain,
  LittleBrain,
  ConnectionValidator,
  initializeIntegratedBrain,
  shutdownIntegratedBrain
} from '../integratedBrainArchitecture';

describe('IntegratedBrainArchitecture', () => {
  let orchestrator: IntegratedBrainOrchestrator;

  beforeAll(async () => {
    orchestrator = await initializeIntegratedBrain();
  });

  afterAll(async () => {
    await shutdownIntegratedBrain();
  });

  describe('Initialization', () => {
    it('should initialize all modules', () => {
      expect(orchestrator.isInitialized()).toBe(true);
    });

    it('should have all modules active', () => {
      const states = orchestrator.getModuleStates();
      expect(states.alexara.active).toBe(true);
      expect(states.cryptara.active).toBe(true);
      expect(states.middleBrain.active).toBe(true);
      expect(states.littleBrain.active).toBe(true);
    });

    it('should establish neural connections', () => {
      const metrics = orchestrator.getMetrics();
      expect(metrics.totalConnections).toBeGreaterThan(0);
    });
  });

  describe('Domain Isolation', () => {
    it('should have 100% cross-domain isolation', () => {
      const metrics = orchestrator.getMetrics();
      expect(metrics.crossDomainIsolation).toBe(1.0);
    });
  });

  describe('Connection Integrity', () => {
    it('should have high average integrity', () => {
      const metrics = orchestrator.getMetrics();
      expect(metrics.averageIntegrity).toBeGreaterThanOrEqual(0.9);
    });

    it('should have active connections', () => {
      const metrics = orchestrator.getMetrics();
      expect(metrics.activeConnections).toBeGreaterThan(0);
    });

    it('should have low latency', () => {
      const metrics = orchestrator.getMetrics();
      expect(metrics.averageLatency).toBeLessThan(20);
    });
  });

  describe('System Health', () => {
    it('should maintain high overall health', () => {
      const metrics = orchestrator.getMetrics();
      expect(metrics.overallHealth).toBeGreaterThan(0.5);
    });

    it('should track system uptime', () => {
      const metrics = orchestrator.getMetrics();
      expect(metrics.systemUptime).toBeGreaterThan(0);
    });
  });
});

describe('AlexaraLeftBrain', () => {
  let alexara: AlexaraLeftBrain;

  beforeAll(async () => {
    alexara = new AlexaraLeftBrain();
    await alexara.initialize();
  });

  describe('Initialization', () => {
    it('should initialize successfully', () => {
      expect(alexara.isActive()).toBe(true);
    });

    it('should have LEGAL domain', () => {
      const state = alexara.getState();
      expect(state.config.domain).toBe('LEGAL');
    });

    it('should forbid CRYPTO connections', () => {
      const state = alexara.getState();
      expect(state.config.forbiddenConnections).toContain('CRYPTO');
    });
  });

  describe('Legal Processing', () => {
    it('should process legal data', async () => {
      const result = await alexara.processLegalData({
        category: 'civil-rights',
        data: { case: 'Test case' },
        context: 'Federal court'
      });

      expect(result).toBeDefined();
      expect(result.analysis).toBeDefined();
      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.reasoningChain.length).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should generate output queue for Middle Brain', async () => {
      await alexara.processLegalData({
        category: 'contract-law',
        data: { contract: 'Test' }
      });

      const output = alexara.getOutputQueue();
      expect(output.length).toBeGreaterThan(0);
    });
  });

  describe('Domain Isolation', () => {
    it('should reject crypto data', async () => {
      await expect(alexara.processLegalData({
        category: 'invalid',
        data: { blockchain: 'ethereum', transaction_hash: '0x123' }
      })).rejects.toThrow('DOMAIN VIOLATION');
    });

    it('should validate allowed connections', () => {
      expect(alexara.validateConnection('META')).toBe(true);
      expect(alexara.validateConnection('MONITOR')).toBe(true);
      expect(alexara.validateConnection('LEGAL')).toBe(true);
    });

    it('should reject forbidden connections', () => {
      expect(alexara.validateConnection('CRYPTO')).toBe(false);
    });
  });

  describe('Crawler Queue', () => {
    it('should queue crawler tasks', () => {
      alexara.queueCrawlerTask({
        target: 'case-law-database',
        type: 'case_law',
        priority: 1
      });
      // Task should be queued without error
      expect(true).toBe(true);
    });
  });
});

describe('CryptaraRightBrain', () => {
  let cryptara: CryptaraRightBrain;

  beforeAll(async () => {
    cryptara = new CryptaraRightBrain();
    await cryptara.initialize();
  });

  describe('Initialization', () => {
    it('should initialize successfully', () => {
      expect(cryptara.isActive()).toBe(true);
    });

    it('should have CRYPTO domain', () => {
      const state = cryptara.getState();
      expect(state.config.domain).toBe('CRYPTO');
    });

    it('should forbid LEGAL connections', () => {
      const state = cryptara.getState();
      expect(state.config.forbiddenConnections).toContain('LEGAL');
    });
  });

  describe('Crypto Processing', () => {
    it('should process crypto data', async () => {
      const result = await cryptara.processCryptoData({
        network: 'ethereum',
        dataType: 'market',
        data: { price: 2000, volume: 1000000 }
      });

      expect(result).toBeDefined();
      expect(result.analysis).toBeDefined();
      expect(result.insights.length).toBeGreaterThan(0);
      expect(result.predictions.length).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should generate output queue for Middle Brain', async () => {
      await cryptara.processCryptoData({
        network: 'bitcoin',
        dataType: 'transaction',
        data: { hash: '0x456' }
      });

      const output = cryptara.getOutputQueue();
      expect(output.length).toBeGreaterThan(0);
    });
  });

  describe('Domain Isolation', () => {
    it('should reject legal data', async () => {
      await expect(cryptara.processCryptoData({
        network: 'invalid',
        dataType: 'market',
        data: { lawsuit: 'pending', court: 'federal' }
      })).rejects.toThrow('DOMAIN VIOLATION');
    });

    it('should validate allowed connections', () => {
      expect(cryptara.validateConnection('META')).toBe(true);
      expect(cryptara.validateConnection('MONITOR')).toBe(true);
      expect(cryptara.validateConnection('CRYPTO')).toBe(true);
    });

    it('should reject forbidden connections', () => {
      expect(cryptara.validateConnection('LEGAL')).toBe(false);
    });
  });

  describe('Predictive Models', () => {
    it('should run predictive models', async () => {
      const result = await cryptara.processCryptoData({
        network: 'solana',
        dataType: 'network',
        data: { tps: 50000 }
      });

      expect(result.predictions.length).toBeGreaterThan(0);
      for (const prediction of result.predictions) {
        expect(['bullish', 'bearish']).toContain(prediction.prediction);
        expect(prediction.confidence).toBeGreaterThan(0);
      }
    });
  });
});

describe('MiddleBrain', () => {
  let middleBrain: MiddleBrain;

  beforeAll(async () => {
    middleBrain = new MiddleBrain();
    await middleBrain.initialize();
  });

  describe('Initialization', () => {
    it('should initialize successfully', () => {
      expect(middleBrain.isActive()).toBe(true);
    });

    it('should have META domain', () => {
      const state = middleBrain.getState();
      expect(state.config.domain).toBe('META');
    });

    it('should allow all domain connections', () => {
      const state = middleBrain.getState();
      expect(state.config.allowedConnections).toContain('LEGAL');
      expect(state.config.allowedConnections).toContain('CRYPTO');
      expect(state.config.allowedConnections).toContain('META');
      expect(state.config.allowedConnections).toContain('MONITOR');
    });
  });

  describe('Integration', () => {
    it('should integrate outputs without cross-domain synthesis', async () => {
      const legalOutputs = [{ type: 'legal_analysis', data: { test: 1 } }];
      const cryptoOutputs = [{ type: 'crypto_analysis', data: { test: 2 } }];

      const result = await middleBrain.integrate(legalOutputs, cryptoOutputs, false);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.synthesizedOutput.integrated).toBe(false);
      expect(result.alignmentScore).toBeGreaterThan(0);
    });

    it('should integrate outputs with cross-domain synthesis when allowed', async () => {
      const legalOutputs = [{ type: 'legal_analysis', confidence: 0.8 }];
      const cryptoOutputs = [{ type: 'crypto_analysis', confidence: 0.9 }];

      const result = await middleBrain.integrate(legalOutputs, cryptoOutputs, true);

      expect(result).toBeDefined();
      expect(result.synthesizedOutput.combinedInsights).toBeDefined();
      expect(result.synthesizedOutput.actionableItems).toBeDefined();
    });

    it('should track integration history', async () => {
      await middleBrain.integrate([], [], true);
      
      const history = middleBrain.getIntegrationHistory();
      expect(history.length).toBeGreaterThan(0);
    });
  });

  describe('Alignment', () => {
    it('should calculate alignment score', async () => {
      const result = await middleBrain.integrate(
        [{ type: 'legal' }],
        [{ type: 'crypto' }],
        true
      );

      expect(result.alignmentScore).toBeGreaterThan(0);
      expect(result.alignmentScore).toBeLessThanOrEqual(1);
    });
  });
});

describe('LittleBrain', () => {
  let littleBrain: LittleBrain;
  let alexara: AlexaraLeftBrain;
  let cryptara: CryptaraRightBrain;
  let middleBrain: MiddleBrain;

  beforeAll(async () => {
    alexara = new AlexaraLeftBrain();
    cryptara = new CryptaraRightBrain();
    middleBrain = new MiddleBrain();
    littleBrain = new LittleBrain();

    await alexara.initialize();
    await cryptara.initialize();
    await middleBrain.initialize();
    await littleBrain.initialize(alexara, cryptara, middleBrain);
  });

  afterAll(async () => {
    await littleBrain.shutdown();
  });

  describe('Initialization', () => {
    it('should initialize successfully', () => {
      expect(littleBrain.isActive()).toBe(true);
    });

    it('should have MONITOR domain', () => {
      const state = littleBrain.getState();
      expect(state.config.domain).toBe('MONITOR');
    });
  });

  describe('Optimization Cycle', () => {
    it('should run optimization cycle', async () => {
      // Wait a bit for initial cycle
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const report = littleBrain.getLatestReport();
      expect(report).toBeDefined();
      if (report) {
        expect(report.modulesScanned).toBeGreaterThanOrEqual(0);
        expect(report.systemHealth).toBeGreaterThan(0);
      }
    });

    it('should track optimization reports', () => {
      const reports = littleBrain.getOptimizationReports();
      expect(Array.isArray(reports)).toBe(true);
    });
  });

  describe('Error Monitoring', () => {
    it('should maintain error log', () => {
      const errorLog = littleBrain.getErrorLog();
      expect(Array.isArray(errorLog)).toBe(true);
    });
  });
});

describe('ConnectionValidator', () => {
  let validator: ConnectionValidator;

  beforeAll(() => {
    validator = new ConnectionValidator();
  });

  describe('Connection Validation', () => {
    it('should validate a healthy connection', async () => {
      const connection = {
        id: 'test-connection',
        sourceModule: 'alexara',
        targetModule: 'middle',
        sourceDomain: 'LEGAL' as const,
        targetDomain: 'META' as const,
        signalStrength: 0.98,
        latencyMs: 5,
        integrity: 1.0,
        crosstalkLevel: 0,
        status: 'active' as const,
        direction: 'bidirectional' as const,
        lastValidation: 0,
        validationCount: 0,
        errorCount: 0,
        correctionApplied: 0,
        lastCorrection: 0
      };

      const result = await validator.validateConnection(connection);

      expect(result.passed).toBe(true);
      expect(result.signalIntegrity).toBeGreaterThanOrEqual(0.95);
      expect(result.latencyCheck).toBe(true);
      expect(result.crosstalkFree).toBe(true);
      expect(result.routingValid).toBe(true);
    });

    it('should detect and correct weak signal', async () => {
      const connection = {
        id: 'weak-signal',
        sourceModule: 'cryptara',
        targetModule: 'middle',
        sourceDomain: 'CRYPTO' as const,
        targetDomain: 'META' as const,
        signalStrength: 0.5, // Below threshold
        latencyMs: 5,
        integrity: 0.5,
        crosstalkLevel: 0,
        status: 'degraded' as const,
        direction: 'forward' as const,
        lastValidation: 0,
        validationCount: 0,
        errorCount: 0,
        correctionApplied: 0,
        lastCorrection: 0
      };

      const result = await validator.validateConnection(connection);

      // Correction should be applied
      expect(result.corrections.length).toBeGreaterThan(0);
      expect(connection.signalStrength).toBeGreaterThan(0.5);
    });

    it('should reject invalid cross-domain routing', async () => {
      const connection = {
        id: 'invalid-routing',
        sourceModule: 'alexara',
        targetModule: 'cryptara',
        sourceDomain: 'LEGAL' as const,
        targetDomain: 'CRYPTO' as const, // Invalid: LEGAL cannot connect to CRYPTO
        signalStrength: 0.98,
        latencyMs: 5,
        integrity: 1.0,
        crosstalkLevel: 0,
        status: 'active' as const,
        direction: 'forward' as const,
        lastValidation: 0,
        validationCount: 0,
        errorCount: 0,
        correctionApplied: 0,
        lastCorrection: 0
      };

      const result = await validator.validateConnection(connection);

      expect(result.routingValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should eliminate crosstalk', async () => {
      const connection = {
        id: 'crosstalk-test',
        sourceModule: 'little',
        targetModule: 'middle',
        sourceDomain: 'MONITOR' as const,
        targetDomain: 'META' as const,
        signalStrength: 0.98,
        latencyMs: 5,
        integrity: 0.9,
        crosstalkLevel: 0.1, // Crosstalk detected
        status: 'degraded' as const,
        direction: 'bidirectional' as const,
        lastValidation: 0,
        validationCount: 0,
        errorCount: 0,
        correctionApplied: 0,
        lastCorrection: 0
      };

      const result = await validator.validateConnection(connection);

      expect(connection.crosstalkLevel).toBe(0); // Should be eliminated
      expect(result.crosstalkFree).toBe(true);
    });

    it('should track validation log', async () => {
      const connection = {
        id: 'log-test',
        sourceModule: 'test',
        targetModule: 'middle',
        sourceDomain: 'META' as const,
        targetDomain: 'META' as const,
        signalStrength: 0.99,
        latencyMs: 2,
        integrity: 1.0,
        crosstalkLevel: 0,
        status: 'active' as const,
        direction: 'forward' as const,
        lastValidation: 0,
        validationCount: 0,
        errorCount: 0,
        correctionApplied: 0,
        lastCorrection: 0
      };

      await validator.validateConnection(connection);

      const log = validator.getValidationLog();
      expect(log.length).toBeGreaterThan(0);
    });
  });
});

describe('Integration Tests', () => {
  let orchestrator: IntegratedBrainOrchestrator;

  beforeAll(async () => {
    orchestrator = new IntegratedBrainOrchestrator();
    await orchestrator.initialize();
  });

  afterAll(async () => {
    await orchestrator.shutdown();
  });

  describe('End-to-End Processing', () => {
    it('should process legal input and integrate', async () => {
      // Process legal data
      await orchestrator.processLegal({
        category: 'civil-rights',
        data: { violation: 'excessive force' },
        context: 'Police misconduct case'
      });

      // Integrate
      const result = await orchestrator.integrate(false);

      expect(result).toBeDefined();
      expect(result.legalInputs.length).toBeGreaterThan(0);
    });

    it('should process crypto input and integrate', async () => {
      // Process crypto data
      await orchestrator.processCrypto({
        network: 'ethereum',
        dataType: 'market',
        data: { price: 2500, change: 5.2 }
      });

      // Integrate
      const result = await orchestrator.integrate(false);

      expect(result).toBeDefined();
      expect(result.cryptoInputs.length).toBeGreaterThan(0);
    });

    it('should maintain domain isolation during processing', async () => {
      // This should not throw
      await orchestrator.processLegal({
        category: 'contract-law',
        data: { parties: ['A', 'B'] }
      });

      await orchestrator.processCrypto({
        network: 'bitcoin',
        dataType: 'transaction',
        data: { confirmations: 6 }
      });

      const metrics = orchestrator.getMetrics();
      expect(metrics.crossDomainIsolation).toBe(1.0);
    });
  });
});
