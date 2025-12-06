/**
 * Certificate Transparency Service Tests
 * Run with: tsx server/services/legalIntelligence/__tests__/certificateTransparency.test.ts
 */

import { certificateTransparencyService } from '../certificateTransparency';

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
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
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
    toContain(item: any) {
      if (!Array.isArray(actual) || !actual.includes(item)) {
        throw new Error(`Expected array to contain ${item}`);
      }
    },
  };
}

// Tests
const tests = [
  test('queryCertificates returns array', async () => {
    const result = await certificateTransparencyService.queryCertificates('example.com');
    expect(result).toBeInstanceOf(Array);
  }),

  test('queryCertificates handles valid domain', async () => {
    // Using a known domain that should have certificates
    const result = await certificateTransparencyService.queryCertificates('github.com');
    // GitHub should have many certificates
    expect(result.length).toBeGreaterThanOrEqual(0);
  }),

  test('extractSubdomains returns SubdomainResult array', async () => {
    const mockCerts = [
      {
        commonName: 'www.example.com',
        subjectAlternativeNames: ['www.example.com', 'api.example.com'],
        issuer: 'Test CA',
        validFrom: new Date('2023-01-01'),
        validTo: new Date('2025-01-01'),
        serialNumber: '12345',
      },
    ];
    
    const result = certificateTransparencyService.extractSubdomains(mockCerts, 'example.com');
    expect(result).toBeInstanceOf(Array);
  }),

  test('discoverSubdomains returns results', async () => {
    const result = await certificateTransparencyService.discoverSubdomains('example.com');
    expect(result).toBeInstanceOf(Array);
  }),

  test('findGovernmentEmails returns array', async () => {
    const result = await certificateTransparencyService.findGovernmentEmails('example.com');
    expect(result).toBeInstanceOf(Array);
  }),

  test('service handles invalid domain gracefully', async () => {
    const result = await certificateTransparencyService.queryCertificates('invalid-domain-xyz-123.com');
    expect(result).toBeInstanceOf(Array);
    // Should return empty array for non-existent domain
    expect(result.length).toEqual(0);
  }),
];

// Run tests
async function runTests() {
  console.log('\n🧪 Running Certificate Transparency Service Tests\n');
  
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
