/**
 * PhylacterySystem Tests
 * 
 * Run from project root with:
 *   npx tsx server/services/__tests__/PhylacterySystem.test.ts
 * 
 * Or add to package.json scripts:
 *   "test:phylactery": "tsx server/services/__tests__/PhylacterySystem.test.ts"
 */

import { PhylacterySystem, type LichState, type DeathMemory, type KnowledgeEntry, type BrowserFingerprint } from '../storage/PhylacterySystem';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => Promise<void>) {
  return async () => {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`✓ ${name}`);
    } catch (error) {
      results.push({
        name,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`✗ ${name}`);
      console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

function expect<T>(actual: T) {
  return {
    toEqual(expected: T) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toHaveProperty(prop: string) {
      if (!(prop in (actual as any))) {
        throw new Error(`Expected object to have property "${prop}"`);
      }
    },
    toBeInstanceOf(constructor: any) {
      if (!(actual instanceof constructor)) {
        throw new Error(`Expected instance of ${constructor.name}`);
      }
    },
    toBeTypeOf(type: string) {
      if (typeof actual !== type) {
        throw new Error(`Expected type ${type}, got ${typeof actual}`);
      }
    },
    toBeGreaterThan(value: number) {
      if (typeof actual !== 'number' || actual <= value) {
        throw new Error(`Expected ${actual} to be greater than ${value}`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected truthy value, got ${JSON.stringify(actual)}`);
      }
    },
  };
}

// Test Data
const mockFingerprint: BrowserFingerprint = {
  userAgent: 'Mozilla/5.0',
  platform: 'Linux',
  vendor: 'Google Inc.',
  languages: ['en-US'],
  screenResolution: '1920x1080',
  timezone: 'America/New_York'
};

const mockLichState: LichState = {
  lichId: 'lich-001',
  powerLevel: 10,
  lichAge: 30,
  currentForm: 'material',
  soulsHarvested: 50,
  lastActive: Date.now(),
  phylacteryLocation: 'oracle-3-magic-1'
};

const mockDeathMemory: DeathMemory = {
  zombieId: 'zombie-001',
  target: 'example.com',
  causeOfDeath: 'captcha',
  timestamp: Date.now(),
  fingerprint: mockFingerprint,
  requestCount: 15,
  sessionAge: 300000,
  triggerPattern: 'rapid-requests'
};

const mockKnowledgeEntry: KnowledgeEntry = {
  target: 'example.com',
  type: 'threat-assessment',
  timestamp: Date.now(),
  data: { threatLevel: 'high', details: 'Aggressive bot detection' },
  discoveredBy: 'cerberus'
};

// Tests
const tests = [
  // Lich Soul Storage Tests
  test('storeLichSoul stores state correctly', async () => {
    const phylactery = new PhylacterySystem();
    await phylactery.storeLichSoul('lich-001', mockLichState);
    const loaded = await phylactery.loadLichSoul('lich-001');
    expect(loaded).toBeTruthy();
    expect(loaded?.lichId).toEqual('lich-001');
    expect(loaded?.powerLevel).toEqual(10);
  }),

  test('loadLichSoul returns null for non-existent soul', async () => {
    const phylactery = new PhylacterySystem();
    const loaded = await phylactery.loadLichSoul('non-existent');
    expect(loaded).toBeNull();
  }),

  test('reformLich restores and modifies state', async () => {
    const phylactery = new PhylacterySystem();
    await phylactery.storeLichSoul('lich-002', mockLichState);
    const reformed = await phylactery.reformLich('lich-002');
    expect(reformed.currentForm).toEqual('ethereal');
    expect(reformed.powerLevel).toBeGreaterThan(0);
  }),

  test('reformLich throws error for non-existent soul', async () => {
    const phylactery = new PhylacterySystem();
    try {
      await phylactery.reformLich('non-existent');
      throw new Error('Should have thrown error');
    } catch (error) {
      expect((error as Error).message).toEqual('Cannot reform Lich non-existent: phylactery not found');
    }
  }),

  test('listLichSouls returns stored souls', async () => {
    const phylactery = new PhylacterySystem();
    await phylactery.storeLichSoul('lich-003', mockLichState);
    const souls = await phylactery.listLichSouls();
    expect(souls).toBeInstanceOf(Array);
    expect(souls.length).toBeGreaterThan(0);
  }),

  // Zombie Hive Mind Tests
  test('recordDeath stores death memory', async () => {
    const phylactery = new PhylacterySystem();
    await phylactery.recordDeath(mockDeathMemory);
    const deaths = await phylactery.queryDeaths('example.com');
    expect(deaths).toBeInstanceOf(Array);
    expect(deaths.length).toBeGreaterThan(0);
  }),

  test('queryDeaths filters by target', async () => {
    const phylactery = new PhylacterySystem();
    await phylactery.recordDeath(mockDeathMemory);
    await phylactery.recordDeath({ ...mockDeathMemory, target: 'other.com' });
    const deaths = await phylactery.queryDeaths('example.com');
    expect(deaths.every(d => d.target === 'example.com')).toEqual(true);
  }),

  test('getLearnedStrategy returns strategy for target', async () => {
    const phylactery = new PhylacterySystem();
    await phylactery.recordDeath(mockDeathMemory);
    await phylactery.recordDeath({ ...mockDeathMemory, timestamp: Date.now() + 1 });
    const strategy = await phylactery.getLearnedStrategy('example.com');
    expect(strategy).toBeTruthy();
    expect(strategy?.name).toEqual('avoid-captcha');
    expect(strategy?.confidence).toBeGreaterThan(0);
  }),

  test('getLearnedStrategy returns null for no deaths', async () => {
    const phylactery = new PhylacterySystem();
    const strategy = await phylactery.getLearnedStrategy('no-deaths.com');
    expect(strategy).toBeNull();
  }),

  // Cerberus Vault Tests
  test('storeKnowledge stores entry', async () => {
    const phylactery = new PhylacterySystem();
    await phylactery.storeKnowledge('example.com', mockKnowledgeEntry);
    const vault = await phylactery.queryVault('example.com');
    expect(vault).toBeInstanceOf(Array);
    expect(vault.length).toBeGreaterThan(0);
  }),

  test('queryVault filters by target', async () => {
    const phylactery = new PhylacterySystem();
    await phylactery.storeKnowledge('example.com', mockKnowledgeEntry);
    await phylactery.storeKnowledge('other.com', { ...mockKnowledgeEntry, target: 'other.com' });
    const vault = await phylactery.queryVault('example.com');
    expect(vault.every(e => e.target === 'example.com')).toEqual(true);
  }),

  test('getThreatsForTarget filters threat assessments', async () => {
    const phylactery = new PhylacterySystem();
    await phylactery.storeKnowledge('example.com', mockKnowledgeEntry);
    await phylactery.storeKnowledge('example.com', { ...mockKnowledgeEntry, type: 'success', timestamp: Date.now() + 1 });
    const threats = await phylactery.getThreatsForTarget('example.com');
    expect(threats.every(e => e.type === 'threat-assessment')).toEqual(true);
  }),

  test('getSuccessHistory filters success entries', async () => {
    const phylactery = new PhylacterySystem();
    await phylactery.storeKnowledge('example.com', { ...mockKnowledgeEntry, type: 'success' });
    const successes = await phylactery.getSuccessHistory('example.com');
    expect(successes.every(e => e.type === 'success')).toEqual(true);
  }),

  // Blizzard Cache Tests
  test('freezeData stores data with permanence', async () => {
    const phylactery = new PhylacterySystem();
    await phylactery.freezeData('test-key', { foo: 'bar' }, 50);
    const thawed = await phylactery.thawData('test-key');
    expect(thawed).toEqual({ foo: 'bar' });
  }),

  test('thawData returns null for non-existent key', async () => {
    const phylactery = new PhylacterySystem();
    const thawed = await phylactery.thawData('non-existent');
    expect(thawed).toBeNull();
  }),

  test('meltExpired removes expired crystals', async () => {
    const phylactery = new PhylacterySystem();
    await phylactery.freezeData('temp-key', { temp: true }, 0);
    await new Promise(resolve => setTimeout(resolve, 100));
    const melted = await phylactery.meltExpired();
    expect(melted).toBeTypeOf('number');
  }),

  // Intelligence Synthesis Tests
  test('synthesize returns unified intelligence', async () => {
    const phylactery = new PhylacterySystem();
    await phylactery.recordDeath(mockDeathMemory);
    await phylactery.storeKnowledge('example.com', mockKnowledgeEntry);
    const intel = await phylactery.synthesize('example.com');
    expect(intel).toHaveProperty('target');
    expect(intel).toHaveProperty('confidence');
    expect(intel).toHaveProperty('lastUpdated');
    expect(intel.target).toEqual('example.com');
  }),

  test('synthesize calculates confidence score', async () => {
    const phylactery = new PhylacterySystem();
    await phylactery.recordDeath(mockDeathMemory);
    await phylactery.storeKnowledge('example.com', mockKnowledgeEntry);
    await phylactery.freezeData('cache:example.com', { cached: true }, 50);
    const intel = await phylactery.synthesize('example.com');
    expect(intel.confidence).toBeGreaterThan(0);
  }),

  test('synthesizeMultiple handles multiple targets', async () => {
    const phylactery = new PhylacterySystem();
    await phylactery.recordDeath(mockDeathMemory);
    await phylactery.recordDeath({ ...mockDeathMemory, target: 'other.com' });
    const intels = await phylactery.synthesizeMultiple(['example.com', 'other.com']);
    expect(intels).toBeInstanceOf(Array);
    expect(intels.length).toEqual(2);
  }),

  test('getSystemHealth returns health status', async () => {
    const phylactery = new PhylacterySystem();
    const health = await phylactery.getSystemHealth();
    expect(health).toHaveProperty('healthy');
    expect(health).toHaveProperty('stats');
    expect(health.healthy).toEqual(true);
  }),
];

// Run tests
async function runTests() {
  console.log('\n🧪 Running PhylacterySystem Tests\n');
  
  for (const testFn of tests) {
    await testFn();
  }
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${results.length} tests\n`);
  
  if (failed > 0) {
    console.error('❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
  }
}

runTests().catch(console.error);
