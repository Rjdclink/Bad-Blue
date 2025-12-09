import { macRotation, namespaceManager, MACRotationEngine, NamespaceManager } from '../index';
import { DEFAULT_HYDRA_CONFIG } from '../types';

describe('HYDRA Core - Startup Behavior', () => {
  it('should export macRotation singleton', () => {
    expect(macRotation).toBeDefined();
    expect(macRotation).toBeInstanceOf(MACRotationEngine);
  });

  it('should export namespaceManager singleton', () => {
    expect(namespaceManager).toBeDefined();
    expect(namespaceManager).toBeInstanceOf(NamespaceManager);
  });

  it('should have engines inactive by default', () => {
    expect(macRotation.isRunning()).toBe(false);
    expect(namespaceManager.isRunning()).toBe(false);
  });

  it('should export DEFAULT_HYDRA_CONFIG', () => {
    expect(DEFAULT_HYDRA_CONFIG).toBeDefined();
    expect(DEFAULT_HYDRA_CONFIG.maxNamespaces).toBe(50);
    expect(DEFAULT_HYDRA_CONFIG.maxCrawlersPerChain).toBe(10);
    expect(DEFAULT_HYDRA_CONFIG.namespaceRecycleMs).toBe(30000);
    expect(DEFAULT_HYDRA_CONFIG.shadowPoolSize).toBe(10);
    expect(DEFAULT_HYDRA_CONFIG.cooldownBaseMs).toBe(5000);
    expect(DEFAULT_HYDRA_CONFIG.detectionThreshold).toBe(3);
    expect(DEFAULT_HYDRA_CONFIG.priorityLevels).toBe(10);
  });
});

describe('HYDRA Core - MAC Rotation Engine', () => {
  beforeEach(() => {
    macRotation.reset();
  });

  afterEach(() => {
    macRotation.reset();
  });

  it('should start and stop correctly', () => {
    expect(macRotation.isRunning()).toBe(false);
    macRotation.start();
    expect(macRotation.isRunning()).toBe(true);
    macRotation.stop();
    expect(macRotation.isRunning()).toBe(false);
  });

  it('should generate valid MAC addresses', () => {
    const mac = macRotation.generateMAC();
    expect(mac).toMatch(/^[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}$/);
    const firstByte = parseInt(mac.split(':')[0], 16);
    expect(firstByte & 0x01).toBe(0);
    expect(firstByte & 0x02).toBe(0x02);
  });

  it('should not rotate MAC when engine is not running', async () => {
    const result = await macRotation.rotateMAC('eth0');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Engine not running');
  });

  it('should simulate MAC rotation when HYDRA_SIMULATION is true', async () => {
    process.env.HYDRA_SIMULATION = 'true';
    macRotation.start();
    const result = await macRotation.rotateMAC('eth0', '10.0.0');
    expect(result.success).toBe(true);
    expect(result.oldMac).toBeDefined();
    expect(result.newMac).toBeDefined();
    expect(result.newIp).toBeDefined();
    expect(result.latencyMs).toBeGreaterThan(0);
    macRotation.stop();
    delete process.env.HYDRA_SIMULATION;
  });

  it('should get IP quality map', () => {
    const map = macRotation.getIPQualityMap();
    expect(map).toBeInstanceOf(Map);
  });

  it('should return null for best subnet when map is empty', () => {
    const best = macRotation.getBestSubnetFor(50);
    expect(best).toBeNull();
  });
});

describe('HYDRA Core - Namespace Manager', () => {
  beforeEach(async () => {
    namespaceManager.reset();
    macRotation.reset();
  });

  afterEach(async () => {
    namespaceManager.reset();
    macRotation.reset();
  });

  it('should start and stop correctly', async () => {
    expect(namespaceManager.isRunning()).toBe(false);
    await namespaceManager.start();
    expect(namespaceManager.isRunning()).toBe(true);
    await namespaceManager.stop();
    expect(namespaceManager.isRunning()).toBe(false);
  });

  it('should not create namespace when manager is not running', async () => {
    const result = await namespaceManager.createNamespace();
    expect(result.success).toBe(false);
    expect(result.error).toBe('Manager not running');
  });

  it('should simulate namespace creation when HYDRA_SIMULATION is true', async () => {
    process.env.HYDRA_SIMULATION = 'true';
    await namespaceManager.start();
    const result = await namespaceManager.createNamespace('10.0.0');
    expect(result.success).toBe(true);
    expect(result.namespace).toBeDefined();
    expect(result.namespace?.id).toContain('hydra-ns-');
    expect(result.namespace?.mac).toMatch(/^[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}$/);
    expect(result.namespace?.status).toBe('active');
    await namespaceManager.stop();
    delete process.env.HYDRA_SIMULATION;
  });

  it('should get namespace stats', () => {
    const stats = namespaceManager.getStats();
    expect(stats.total).toBeGreaterThanOrEqual(0);
    expect(stats.active).toBeGreaterThanOrEqual(0);
    expect(stats.available).toBeGreaterThanOrEqual(0);
  });

  it('should return empty array for getAllNamespaces when no namespaces exist', () => {
    const namespaces = namespaceManager.getAllNamespaces();
    expect(namespaces).toEqual([]);
  });

  it('should return null for getAvailableNamespace when no namespaces exist', () => {
    const ns = namespaceManager.getAvailableNamespace();
    expect(ns).toBeNull();
  });

  it('should manage crawler assignments', async () => {
    process.env.HYDRA_SIMULATION = 'true';
    await namespaceManager.start();
    const result = await namespaceManager.createNamespace();
    expect(result.success).toBe(true);
    const nsId = result.namespace!.id;
    
    const assigned = namespaceManager.assignCrawler(nsId, 'crawler-1');
    expect(assigned).toBe(true);
    
    const assignedAgain = namespaceManager.assignCrawler(nsId, 'crawler-2');
    expect(assignedAgain).toBe(false);
    
    namespaceManager.releaseCrawler(nsId);
    const ns = namespaceManager.getNamespace(nsId);
    expect(ns?.crawlerId).toBeNull();
    
    await namespaceManager.stop();
    delete process.env.HYDRA_SIMULATION;
  });

  it('should destroy namespace', async () => {
    process.env.HYDRA_SIMULATION = 'true';
    await namespaceManager.start();
    const result = await namespaceManager.createNamespace();
    expect(result.success).toBe(true);
    const nsId = result.namespace!.id;
    
    const destroyed = await namespaceManager.destroyNamespace(nsId);
    expect(destroyed).toBe(true);
    
    const ns = namespaceManager.getNamespace(nsId);
    expect(ns).toBeUndefined();
    
    await namespaceManager.stop();
    delete process.env.HYDRA_SIMULATION;
  });

  it('should cycle namespace', async () => {
    process.env.HYDRA_SIMULATION = 'true';
    await namespaceManager.start();
    const result = await namespaceManager.createNamespace('10.0.0');
    expect(result.success).toBe(true);
    const oldId = result.namespace!.id;
    
    const cycled = await namespaceManager.cycleNamespace(oldId);
    expect(cycled.success).toBe(true);
    expect(cycled.namespace?.id).not.toBe(oldId);
    expect(cycled.namespace?.subnet).toBe('10.0.0');
    
    await namespaceManager.stop();
    delete process.env.HYDRA_SIMULATION;
  });
});

describe('HYDRA Core - Edge Cases and Additional Coverage', () => {
  beforeEach(async () => {
    namespaceManager.reset();
    macRotation.reset();
  });

  afterEach(async () => {
    namespaceManager.reset();
    macRotation.reset();
  });

  it('should reject interface names with leading hyphen', async () => {
    process.env.HYDRA_SIMULATION = 'true';
    macRotation.start();
    const result = await macRotation.rotateMAC('-eth0', '10.0.0');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid interface name');
    macRotation.stop();
    delete process.env.HYDRA_SIMULATION;
  });

  it('should handle getBestSubnetFor with target latency', async () => {
    process.env.HYDRA_SIMULATION = 'true';
    macRotation.start();
    
    // Rotate a few times to populate IP quality map
    await macRotation.rotateMAC('eth0', '10.0.0');
    await macRotation.rotateMAC('eth1', '10.1.0');
    
    // Should return null if target latency is too strict
    const best = macRotation.getBestSubnetFor(5);
    // Since simulated latencies are 10-60ms, a 5ms target should return null
    expect(best).toBeNull();
    
    // Should return subnet if target latency is reasonable
    const best2 = macRotation.getBestSubnetFor(100);
    expect(best2).toBeTruthy();
    
    macRotation.stop();
    delete process.env.HYDRA_SIMULATION;
  });

  it('should handle getBestSubnetFor with empty latency map', () => {
    const best = macRotation.getBestSubnetFor(50);
    expect(best).toBeNull();
  });

  it('should only manage MAC rotation lifecycle if started by manager', async () => {
    process.env.HYDRA_SIMULATION = 'true';
    
    // Start MAC rotation independently
    macRotation.start();
    expect(macRotation.isRunning()).toBe(true);
    
    // Start namespace manager - should not restart MAC rotation
    await namespaceManager.start();
    expect(macRotation.isRunning()).toBe(true);
    
    // Stop namespace manager - should not stop MAC rotation
    await namespaceManager.stop();
    expect(macRotation.isRunning()).toBe(true);
    
    // Clean up
    macRotation.stop();
    delete process.env.HYDRA_SIMULATION;
  });

  it('should manage MAC rotation lifecycle if started by manager', async () => {
    process.env.HYDRA_SIMULATION = 'true';
    
    expect(macRotation.isRunning()).toBe(false);
    
    // Start namespace manager - should start MAC rotation
    await namespaceManager.start();
    expect(macRotation.isRunning()).toBe(true);
    
    // Stop namespace manager - should stop MAC rotation
    await namespaceManager.stop();
    expect(macRotation.isRunning()).toBe(false);
    
    delete process.env.HYDRA_SIMULATION;
  });

  it('should return null for getAvailableNamespace when all are assigned', async () => {
    process.env.HYDRA_SIMULATION = 'true';
    await namespaceManager.start();
    
    const ns1 = await namespaceManager.createNamespace();
    const ns2 = await namespaceManager.createNamespace();
    
    namespaceManager.assignCrawler(ns1.namespace!.id, 'crawler-1');
    namespaceManager.assignCrawler(ns2.namespace!.id, 'crawler-2');
    
    const available = namespaceManager.getAvailableNamespace();
    expect(available).toBeNull();
    
    await namespaceManager.stop();
    delete process.env.HYDRA_SIMULATION;
  });

  it('should validate interface name in getCurrentMAC and getCurrentIP', async () => {
    // These are private methods, but we can test through rotateMAC
    process.env.HYDRA_SIMULATION = 'false'; // Use real mode to test validation
    macRotation.start();
    
    // With invalid interface, should fail gracefully
    const result = await macRotation.rotateMAC('invalid;name', '10.0.0');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid interface name');
    
    macRotation.stop();
  });

  it('should reset MAC rotation engine completely', () => {
    macRotation.start();
    expect(macRotation.isRunning()).toBe(true);
    
    macRotation.reset();
    expect(macRotation.isRunning()).toBe(false);
    expect(macRotation.getIPQualityMap().size).toBe(0);
  });

  it('should reset namespace manager completely', async () => {
    process.env.HYDRA_SIMULATION = 'true';
    await namespaceManager.start();
    await namespaceManager.createNamespace();
    
    expect(namespaceManager.isRunning()).toBe(true);
    expect(namespaceManager.getStats().total).toBe(1);
    
    namespaceManager.reset();
    expect(namespaceManager.isRunning()).toBe(false);
    expect(namespaceManager.getStats().total).toBe(0);
    
    delete process.env.HYDRA_SIMULATION;
  });
});
