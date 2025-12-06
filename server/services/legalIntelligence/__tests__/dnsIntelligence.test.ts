/**
 * DNS Intelligence Service Tests
 * Run with: tsx server/services/legalIntelligence/__tests__/dnsIntelligence.test.ts
 */

import { dnsIntelligenceService } from '../dnsIntelligence';

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
    toBeGreaterThanOrEqual(expected: number) {
      if (typeof actual !== 'number' || actual < expected) {
        throw new Error(`Expected ${actual} to be >= ${expected}`);
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
  };
}

// Tests
const tests = [
  test('discoverSubdomains returns SubdomainResult array', async () => {
    const result = await dnsIntelligenceService.discoverSubdomains('example.com');
    expect(result).toBeInstanceOf(Array);
  }),

  test('subdomain results have required fields', async () => {
    const result = await dnsIntelligenceService.discoverSubdomains('github.com');
    
    if (result.length > 0) {
      const subdomain = result[0];
      expect(subdomain).toHaveProperty('subdomain');
      expect(subdomain).toHaveProperty('ipAddresses');
      expect(subdomain).toHaveProperty('source');
      expect(subdomain).toHaveProperty('status');
    }
  }),

  test('queryMXRecords returns DNSRecord array', async () => {
    const result = await dnsIntelligenceService.queryMXRecords('example.com');
    expect(result).toBeInstanceOf(Array);
  }),

  test('MX records have correct structure', async () => {
    const result = await dnsIntelligenceService.queryMXRecords('gmail.com');
    
    if (result.length > 0) {
      const record = result[0];
      expect(record).toHaveProperty('type');
      expect(record).toHaveProperty('name');
      expect(record).toHaveProperty('value');
    }
  }),

  test('mapAgencyPresence returns structured result', async () => {
    const result = await dnsIntelligenceService.mapAgencyPresence('example.com');
    expect(result).toHaveProperty('mainSite');
    expect(result).toHaveProperty('emailServers');
    expect(result).toHaveProperty('departments');
    expect(result).toHaveProperty('portalServices');
  }),

  test('mapAgencyPresence handles domain without subdomains', async () => {
    const result = await dnsIntelligenceService.mapAgencyPresence('nonexistent-xyz-123.com');
    expect(result.emailServers).toBeInstanceOf(Array);
    expect(result.departments).toBeInstanceOf(Array);
    expect(result.portalServices).toBeInstanceOf(Array);
  }),

  test('service handles invalid domain gracefully', async () => {
    const result = await dnsIntelligenceService.discoverSubdomains('invalid-domain-xyz-123.local');
    expect(result).toBeInstanceOf(Array);
  }),
];

// Run tests
async function runTests() {
  console.log('\n🧪 Running DNS Intelligence Service Tests\n');
  
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
