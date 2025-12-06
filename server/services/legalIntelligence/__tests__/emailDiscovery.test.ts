/**
 * Email Discovery Service Tests
 * Run with: tsx server/services/legalIntelligence/__tests__/emailDiscovery.test.ts
 */

import { emailDiscoveryService } from '../emailDiscovery';

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
  test('discoverEmails returns EmailDiscoveryResult structure', async () => {
    const result = await emailDiscoveryService.discoverEmails('test query');
    expect(result).toHaveProperty('emails');
    expect(result).toHaveProperty('subdomains');
    expect(result).toHaveProperty('totalFound');
    expect(result).toHaveProperty('sources');
    expect(result).toHaveProperty('searchDuration');
    expect(result).toHaveProperty('errors');
  }),

  test('discoverEmails returns array of emails', async () => {
    const result = await emailDiscoveryService.discoverEmails('test query');
    expect(result.emails).toBeInstanceOf(Array);
  }),

  test('discoverFOIAOfficerEmails returns FOIAContact array', async () => {
    const result = await emailDiscoveryService.discoverFOIAOfficerEmails('Test Agency');
    expect(result).toBeInstanceOf(Array);
  }),

  test('discoverFOIAOfficerEmails includes required contact fields', async () => {
    const result = await emailDiscoveryService.discoverFOIAOfficerEmails('Sample Police Department', 'example.gov');
    
    if (result.length > 0) {
      const contact = result[0];
      expect(contact).toHaveProperty('email');
      expect(contact).toHaveProperty('department');
      expect(contact).toHaveProperty('agency');
      expect(contact).toHaveProperty('confidence');
      expect(contact).toHaveProperty('sources');
    }
  }),

  test('discoverAttorneyEmail returns EmailResult array', async () => {
    const result = await emailDiscoveryService.discoverAttorneyEmail('John Smith');
    expect(result).toBeInstanceOf(Array);
  }),

  test('discoverAttorneyEmail with firm parameter works', async () => {
    const result = await emailDiscoveryService.discoverAttorneyEmail('Jane Doe', 'Smith & Associates');
    expect(result).toBeInstanceOf(Array);
  }),

  test('email results have required fields', async () => {
    const result = await emailDiscoveryService.discoverEmails('contact email');
    
    if (result.emails.length > 0) {
      const email = result.emails[0];
      expect(email).toHaveProperty('email');
      expect(email).toHaveProperty('source');
      expect(email).toHaveProperty('confidence');
      expect(email).toHaveProperty('metadata');
    }
  }),

  test('service handles empty results gracefully', async () => {
    const result = await emailDiscoveryService.discoverEmails('xyz123nonexistent456query789');
    expect(result.emails).toBeInstanceOf(Array);
    expect(result.totalFound).toBeGreaterThanOrEqual(0);
  }),
];

// Run tests
async function runTests() {
  console.log('\n🧪 Running Email Discovery Service Tests\n');
  
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
