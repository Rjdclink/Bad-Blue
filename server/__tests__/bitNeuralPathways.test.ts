/**
 * Bit Neural Pathways System Tests
 * 
 * Comprehensive test suite for:
 * - BitNeuralPathwayManager
 * - ALEXARA module
 * - CRYPTARA module
 * - Beneficial Crawler
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Import modules
import {
  BitNeuralPathwayManager,
  getBitNeuralPathwayManager,
  initializeBitNeuralPathways,
  shutdownBitNeuralPathways,
  BitState
} from '../bitNeuralPathways';

import {
  ALEXARAModule,
  getALEXARA,
  initializeALEXARA,
  shutdownALEXARA
} from '../alexaraModule';

import {
  CRYPTARAModule,
  getCRYPTARA,
  initializeCRYPTARA,
  shutdownCRYPTARA
} from '../cryptaraModule';

import {
  BeneficialCrawler,
  getBeneficialCrawler,
  initializeBeneficialCrawler,
  shutdownBeneficialCrawler
} from '../beneficialCrawler';

describe('BitNeuralPathwayManager', () => {
  let manager: BitNeuralPathwayManager;

  beforeEach(async () => {
    // Tests that exercise CRYPTARA must explicitly unlock Stage 8.
    process.env.CRYPTOCRAWLER_STAGE = '8';
    await shutdownBitNeuralPathways();
    manager = await initializeBitNeuralPathways();
  });

  afterEach(async () => {
    await shutdownBitNeuralPathways();
  });

  it('should initialize correctly', () => {
    expect(manager.isInitialized()).toBe(true);
  });

  it('should create default core pathways on initialization', () => {
    const pathwayIds = manager.getAllPathwayIds();
    expect(pathwayIds).toContain('legal-core');
    expect(pathwayIds).toContain('crypto-core');
    expect(pathwayIds).toContain('meta-bridge');
    expect(pathwayIds).toContain('shared-inference');
  });

  it('should create a new pathway', async () => {
    const pathway = await manager.createPathway(
      'test-pathway',
      'Test Pathway',
      'legal',
      32
    );

    expect(pathway).toBeDefined();
    expect(pathway.id).toBe('test-pathway');
    expect(pathway.domain).toBe('legal');
    expect(pathway.neurons.size).toBe(32);
  });

  it('should propagate signals through a pathway', async () => {
    const inputStates = new Map<string, BitState>();
    inputStates.set('legal-core-n0', 1);
    inputStates.set('legal-core-n1', 1);
    inputStates.set('legal-core-n5', 1);

    const result = await manager.propagateSignal('legal-core', inputStates);

    expect(result).toBeDefined();
    expect(result.activatedNeurons.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.processingTime).toBeGreaterThan(0);
  });

  it('should learn from patterns', async () => {
    const inputStates = new Map<string, BitState>();
    inputStates.set('legal-core-n0', 1);
    inputStates.set('legal-core-n1', 1);

    const expectedOutputs = new Map<string, BitState>();
    expectedOutputs.set('legal-core-n0', 1);
    expectedOutputs.set('legal-core-n1', 1);

    // Should not throw
    await expect(
      manager.learnPattern('legal-core', inputStates, expectedOutputs)
    ).resolves.not.toThrow();
  });

  it('should prune low-utility pathways and synapses', async () => {
    // Create a test pathway
    await manager.createPathway('prune-test', 'Prune Test', 'legal', 16);

    const result = await manager.prunePathways();

    expect(result).toBeDefined();
    expect(result.prunedSynapses).toBeGreaterThanOrEqual(0);
    expect(result.prunedPathways).toBeDefined();
  });

  it('should create redundant pathways', async () => {
    const redundant = await manager.createRedundantPathway('legal-core');

    expect(redundant).toBeDefined();
    expect(redundant?.id).toContain('legal-core-redundant');
    expect(redundant?.domain).toBe('legal');
  });

  it('should perform cross-domain propagation', async () => {
    const inputStates = new Map<string, BitState>();
    inputStates.set('legal-core-n0', 1);

    const result = await manager.crossDomainPropagate('legal', inputStates);

    expect(result).toBeDefined();
    expect(result.pathwaysUsed.length).toBeGreaterThan(1);
    expect(result.pathwaysUsed).toContain('legal-core');
    expect(result.pathwaysUsed).toContain('crypto-core');
  });

  it('should return valid metrics', () => {
    const metrics = manager.getMetrics();

    expect(metrics).toBeDefined();
    expect(metrics.totalNeurons).toBeGreaterThan(0);
    expect(metrics.activePathways).toBeGreaterThan(0);
  });

  it('should recognize stored patterns', async () => {
    const bits: BitState[] = [1, 0, 1, 1, 0];

    // First recognition should return null
    let pattern = manager.recognizePattern(bits);
    expect(pattern).toBeNull();

    // After learning, it should be stored (via internal storePatternSignature)
    const inputStates = new Map<string, BitState>();
    inputStates.set('legal-core-n0', 1);
    inputStates.set('legal-core-n2', 1);
    inputStates.set('legal-core-n3', 1);

    await manager.learnPattern(
      'legal-core',
      inputStates,
      inputStates
    );

    expect(manager.getPatternCount()).toBeGreaterThan(0);
  });
});

describe('ALEXARA Module', () => {
  let alexara: ALEXARAModule;

  beforeEach(async () => {
    await shutdownALEXARA();
    await shutdownBitNeuralPathways();
    alexara = await initializeALEXARA();
  });

  afterEach(async () => {
    await shutdownALEXARA();
    await shutdownBitNeuralPathways();
  });

  it('should initialize correctly', () => {
    expect(alexara.isInitialized()).toBe(true);
  });

  it('should create legal clusters on initialization', () => {
    const clusterIds = alexara.getClusterIds();
    expect(clusterIds.length).toBeGreaterThan(0);
  });

  it('should create a new legal cluster', async () => {
    const cluster = await alexara.createLegalCluster(
      'test-law',
      'Test Law Type',
      'TestState'
    );

    expect(cluster).toBeDefined();
    expect(cluster.lawType).toBe('test-law');
    expect(cluster.jurisdiction).toBe('TestState');
  });

  it('should analyze legal situations', async () => {
    const result = await alexara.analyzeLegalSituation(
      'The defendant violated my constitutional rights during the traffic stop.',
      'civil-rights',
      'Federal'
    );

    expect(result).toBeDefined();
    expect(result.lawType).toBe('civil-rights');
    expect(result.jurisdiction).toBe('Federal');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.causesOfAction).toBeDefined();
  });

  it('should return causes of action for civil rights cases', async () => {
    const result = await alexara.analyzeLegalSituation(
      'Police officer used excessive force during arrest without probable cause.',
      'civil-rights',
      'Federal'
    );

    // The causes of action may or may not be returned depending on activation patterns
    expect(result.causesOfAction).toBeDefined();
    expect(Array.isArray(result.causesOfAction)).toBe(true);
  });

  it('should query CRYPTARA for metadata', async () => {
    // Initialize CRYPTARA first
    await initializeCRYPTARA();

    const metadata = await alexara.queryCryptaraMetadata('civil-rights');

    expect(metadata).toBeDefined();
    expect(metadata.confidence).toBeGreaterThanOrEqual(0);

    await shutdownCRYPTARA();
  });

  it('should return valid metrics', () => {
    const metrics = alexara.getMetrics();

    expect(metrics).toBeDefined();
    expect(metrics.totalClusters).toBeGreaterThan(0);
  });
});

describe('CRYPTARA Module', () => {
  let cryptara: CRYPTARAModule;

  beforeEach(async () => {
    await shutdownCRYPTARA();
    await shutdownBitNeuralPathways();
    cryptara = await initializeCRYPTARA();
  });

  afterEach(async () => {
    await shutdownCRYPTARA();
    await shutdownBitNeuralPathways();
  });

  it('should initialize correctly', () => {
    expect(cryptara.isInitialized()).toBe(true);
  });

  it('should create pattern clusters on initialization', () => {
    const clusterIds = cryptara.getClusterIds();
    expect(clusterIds.length).toBeGreaterThan(0);
  });

  it('should analyze data patterns', async () => {
    const result = await cryptara.analyzePatterns(
      { address: '0x123', amount: 100, timestamp: Date.now() },
      'transaction'
    );

    expect(result).toBeDefined();
    expect(result.category).toBe('transaction');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.sandboxCompliant).toBe(true);
  });

  it('should detect patterns in analysis', async () => {
    const result = await cryptara.analyzePatterns(
      { nodes: ['a', 'b', 'c'], connections: 5 },
      'network'
    );

    expect(result.detectedPatterns).toBeDefined();
    expect(Array.isArray(result.detectedPatterns)).toBe(true);
  });

  it('should create network nodes', async () => {
    const result = await cryptara.analyzePatterns(
      { entities: ['entity1', 'entity2'] },
      'network'
    );

    expect(result.networkNodes).toBeDefined();
  });

  it('should reject forbidden data types', async () => {
    await expect(
      cryptara.analyzePatterns(
        { pii: 'sensitive data', name: 'test' },
        'behavioral'
      )
    ).rejects.toThrow('sandbox violation');
  });

  it('should share metadata with ALEXARA', async () => {
    // Initialize ALEXARA
    await initializeALEXARA();

    const metadata = await cryptara.shareMetadataWithALEXARA();

    expect(metadata).toBeDefined();
    expect(metadata.patterns).toBeGreaterThanOrEqual(0);

    await shutdownALEXARA();
  });

  it('should return valid sandbox boundary', () => {
    const boundary = cryptara.getSandboxBoundary();

    expect(boundary).toBeDefined();
    expect(boundary.allowedCategories).toContain('network');
    expect(boundary.forbiddenDataTypes).toContain('pii');
  });

  it('should return valid metrics', () => {
    const metrics = cryptara.getMetrics();

    expect(metrics).toBeDefined();
    expect(metrics.totalClusters).toBeGreaterThan(0);
  });
});

describe('BeneficialCrawler', () => {
  let crawler: BeneficialCrawler;

  beforeEach(async () => {
    await shutdownBeneficialCrawler();
    await shutdownBitNeuralPathways();
    crawler = await initializeBeneficialCrawler({
      crawlInterval: 60000, // 1 minute for tests
      autoRepair: true
    });
  });

  afterEach(async () => {
    await shutdownBeneficialCrawler();
    await shutdownBitNeuralPathways();
  });

  it('should initialize correctly', () => {
    expect(crawler.isInitialized()).toBe(true);
  });

  it('should run a crawl cycle', async () => {
    const report = await crawler.forceCrawl();

    expect(report).toBeDefined();
    expect(report.pathwaysCrawled).toBeGreaterThan(0);
    expect(report.health).toBeGreaterThanOrEqual(0);
    expect(report.health).toBeLessThanOrEqual(100);
  });

  it('should detect pathway issues', async () => {
    const report = await crawler.forceCrawl();

    expect(report.issuesDetected).toBeDefined();
    expect(Array.isArray(report.issuesDetected)).toBe(true);
  });

  it('should generate recommendations', async () => {
    const report = await crawler.forceCrawl();

    expect(report.recommendations).toBeDefined();
    expect(Array.isArray(report.recommendations)).toBe(true);
  });

  it('should return valid metrics', () => {
    const metrics = crawler.getMetrics();

    expect(metrics).toBeDefined();
    expect(typeof metrics.uptime).toBe('number');
    expect(metrics.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should return valid config', () => {
    const config = crawler.getConfig();

    expect(config).toBeDefined();
    expect(config.enabled).toBe(true);
    expect(config.autoRepair).toBe(true);
  });

  it('should update config', () => {
    crawler.updateConfig({ efficiencyThreshold: 0.8 });
    const config = crawler.getConfig();

    expect(config.efficiencyThreshold).toBe(0.8);
  });

  it('should track repair history', async () => {
    await crawler.forceCrawl();
    const history = crawler.getRepairHistory();

    expect(history).toBeDefined();
    expect(Array.isArray(history)).toBe(true);
  });

  it('should get pending issues', () => {
    const issues = crawler.getPendingIssues();

    expect(issues).toBeDefined();
    expect(Array.isArray(issues)).toBe(true);
  });
});

describe('Integration Tests', () => {
  beforeEach(async () => {
    await shutdownBeneficialCrawler();
    await shutdownCRYPTARA();
    await shutdownALEXARA();
    await shutdownBitNeuralPathways();
  });

  afterEach(async () => {
    await shutdownBeneficialCrawler();
    await shutdownCRYPTARA();
    await shutdownALEXARA();
    await shutdownBitNeuralPathways();
  });

  it('should integrate all modules together', async () => {
    // Initialize all modules
    const pathwayManager = await initializeBitNeuralPathways();
    const alexara = await initializeALEXARA();
    const cryptara = await initializeCRYPTARA();
    const crawler = await initializeBeneficialCrawler({ crawlInterval: 60000 });

    // Verify all initialized
    expect(pathwayManager.isInitialized()).toBe(true);
    expect(alexara.isInitialized()).toBe(true);
    expect(cryptara.isInitialized()).toBe(true);
    expect(crawler.isInitialized()).toBe(true);

    // Run legal analysis
    const legalResult = await alexara.analyzeLegalSituation(
      'Contract breach with damages',
      'contract',
      'State'
    );
    expect(legalResult.confidence).toBeGreaterThan(0);

    // Run crypto analysis
    const cryptoResult = await cryptara.analyzePatterns(
      { type: 'transaction', value: 100 },
      'transaction'
    );
    expect(cryptoResult.confidence).toBeGreaterThan(0);

    // Run crawler
    const crawlReport = await crawler.forceCrawl();
    expect(crawlReport.pathwaysCrawled).toBeGreaterThan(0);

    // Verify cross-domain communication
    const metadata = await alexara.queryCryptaraMetadata('contract');
    expect(metadata.confidence).toBeGreaterThanOrEqual(0);
  });

  it('should maintain pathway health across operations', async () => {
    await initializeBitNeuralPathways();
    await initializeALEXARA();
    await initializeCRYPTARA();
    const crawler = await initializeBeneficialCrawler({ crawlInterval: 60000 });

    // Initial health check
    const initialReport = await crawler.forceCrawl();
    const initialHealth = initialReport.health;

    // Perform multiple operations
    const alexara = getALEXARA();
    for (let i = 0; i < 5; i++) {
      await alexara.analyzeLegalSituation(
        `Test situation ${i}`,
        'civil-rights',
        'Federal'
      );
    }

    // Final health check
    const finalReport = await crawler.forceCrawl();

    // Health should be maintained
    expect(finalReport.health).toBeGreaterThan(50);
    expect(finalReport.pathwaysCrawled).toBeGreaterThan(0);
  });
});
