/**
 * StealthInfrastructure Integration Tests
 * Run with: tsx server/services/stealth/__tests__/StealthInfrastructure.test.ts
 */

import { StealthInfrastructure } from '../StealthInfrastructure';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void | Promise<void>) {
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
    toBe(expected: T) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, got ${actual}`);
      }
    },
    toHaveProperty(prop: string) {
      if (!(prop in (actual as any))) {
        throw new Error(`Expected object to have property "${prop}"`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected ${actual} to be truthy`);
      }
    },
    toBeGreaterThan(value: number) {
      if (typeof actual !== 'number') {
        throw new Error(`Expected ${actual} to be a number`);
      }
      if (actual <= value) {
        throw new Error(`Expected ${actual} to be greater than ${value}`);
      }
    },
    toBeGreaterThanOrEqual(value: number) {
      if (typeof actual !== 'number') {
        throw new Error(`Expected ${actual} to be a number`);
      }
      if (actual < value) {
        throw new Error(`Expected ${actual} to be greater than or equal to ${value}`);
      }
    },
    toBeLessThan(value: number) {
      if (typeof actual !== 'number') {
        throw new Error(`Expected ${actual} to be a number`);
      }
      if (actual >= value) {
        throw new Error(`Expected ${actual} to be less than ${value}`);
      }
    },
    toContain(substring: string) {
      if (typeof actual !== 'string') {
        throw new Error(`Expected ${actual} to be a string`);
      }
      if (!actual.includes(substring)) {
        throw new Error(`Expected "${actual}" to contain "${substring}"`);
      }
    },
  };
}

// Tests
const tests = [
  test('StealthInfrastructure can be instantiated', () => {
    const stealth = new StealthInfrastructure();
    expect(stealth).toBeTruthy();
  }),

  test('StealthInfrastructure has required methods', () => {
    const stealth = new StealthInfrastructure();
    expect(typeof stealth.initialize).toBe('function');
    expect(typeof stealth.connect).toBe('function');
    expect(typeof stealth.rotateIdentity).toBe('function');
    expect(typeof stealth.getMetrics).toBe('function');
  }),

  test('getMetrics returns correct structure', () => {
    const stealth = new StealthInfrastructure();
    const metrics = stealth.getMetrics();
    
    expect(metrics).toHaveProperty('vpn');
    expect(metrics).toHaveProperty('tor');
    expect(metrics).toHaveProperty('proxies');
    expect(metrics).toHaveProperty('performance');
    expect(metrics).toHaveProperty('success');
  }),

  test('VPN metrics have correct structure', () => {
    const stealth = new StealthInfrastructure();
    const metrics = stealth.getMetrics();
    
    expect(metrics.vpn).toHaveProperty('provider');
    expect(metrics.vpn).toHaveProperty('connected');
    expect(metrics.vpn).toHaveProperty('uptime');
  }),

  test('Tor metrics have correct structure', () => {
    const stealth = new StealthInfrastructure();
    const metrics = stealth.getMetrics();
    
    expect(metrics.tor).toHaveProperty('instances');
    expect(metrics.tor).toHaveProperty('circuits');
    expect(metrics.tor).toHaveProperty('avgLatency');
  }),

  test('Proxy metrics have correct structure', () => {
    const stealth = new StealthInfrastructure();
    const metrics = stealth.getMetrics();
    
    expect(metrics.proxies).toHaveProperty('total');
    expect(metrics.proxies).toHaveProperty('healthy');
    expect(metrics.proxies).toHaveProperty('avgScore');
  }),

  test('Performance metrics have correct structure', () => {
    const stealth = new StealthInfrastructure();
    const metrics = stealth.getMetrics();
    
    expect(metrics.performance).toHaveProperty('lowRisk');
    expect(metrics.performance).toHaveProperty('mediumRisk');
    expect(metrics.performance).toHaveProperty('highRisk');
  }),

  test('Success metrics have correct structure', () => {
    const stealth = new StealthInfrastructure();
    const metrics = stealth.getMetrics();
    
    expect(metrics.success).toHaveProperty('total');
    expect(metrics.success).toHaveProperty('failed');
    expect(metrics.success).toHaveProperty('rate');
  }),

  test('Initial metrics show no VPN connection', () => {
    const stealth = new StealthInfrastructure();
    const metrics = stealth.getMetrics();
    
    expect(metrics.vpn.connected).toBe(false);
    expect(metrics.vpn.provider).toBe(null);
  }),

  test('Initial metrics show no Tor instances', () => {
    const stealth = new StealthInfrastructure();
    const metrics = stealth.getMetrics();
    
    expect(metrics.tor.instances).toBe(0);
    expect(metrics.tor.circuits).toBe(0);
  }),

  test('Initial success rate is zero', () => {
    const stealth = new StealthInfrastructure();
    const metrics = stealth.getMetrics();
    
    expect(metrics.success.total).toBe(0);
    expect(metrics.success.failed).toBe(0);
    expect(metrics.success.rate).toBe(0);
  }),

  test('Performance metrics start at zero', () => {
    const stealth = new StealthInfrastructure();
    const metrics = stealth.getMetrics();
    
    expect(metrics.performance.lowRisk).toBe(0);
    expect(metrics.performance.mediumRisk).toBe(0);
    expect(metrics.performance.highRisk).toBe(0);
  }),

  test('Metrics are consistent across multiple calls', () => {
    const stealth = new StealthInfrastructure();
    const metrics1 = stealth.getMetrics();
    const metrics2 = stealth.getMetrics();
    
    // Check structural equality
    expect(metrics1.vpn.connected).toBe(metrics2.vpn.connected);
    expect(metrics1.tor.instances).toBe(metrics2.tor.instances);
    expect(metrics1.success.total).toBe(metrics2.success.total);
  }),

  test('Can call getMetrics before initialize', () => {
    const stealth = new StealthInfrastructure();
    const metrics = stealth.getMetrics();
    
    expect(metrics).toBeTruthy();
  }),

  test('rotateIdentity can be called without error', async () => {
    const stealth = new StealthInfrastructure();
    await stealth.rotateIdentity();
  }),
];

// Run tests
async function runTests() {
  console.log('\n🧪 Running StealthInfrastructure Integration Tests\n');
  
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
