/**
 * Stealth Integration Tests
 * Run with: tsx server/services/stealth/__tests__/integration.test.ts
 */

import { getStealthStats, tlsFingerprintRandomizer, headersPolyfill } from '../index';

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
  };
}

// Tests
const tests = [
  test('exports are available', () => {
    expect(tlsFingerprintRandomizer).toBeTruthy();
    expect(headersPolyfill).toBeTruthy();
    expect(typeof getStealthStats).toBe('function');
  }),

  test('getStealthStats returns combined stats', async () => {
    const stats = await getStealthStats();
    
    expect(stats).toHaveProperty('tls');
    expect(stats).toHaveProperty('headers');
  }),

  test('getStealthStats TLS stats structure', async () => {
    const stats = await getStealthStats();
    
    expect(stats.tls).toHaveProperty('currentProfile');
    expect(stats.tls).toHaveProperty('availableProfiles');
  }),

  test('getStealthStats headers stats structure', async () => {
    const stats = await getStealthStats();
    
    expect(stats.headers).toHaveProperty('currentProfile');
    expect(stats.headers).toHaveProperty('availableProfiles');
    expect(stats.headers).toHaveProperty('browser');
  }),

  test('TLS and headers work together', async () => {
    // Generate TLS profile
    const tlsOptions = tlsFingerprintRandomizer.generateTLSOptions();
    
    // Generate matching headers
    const headers = headersPolyfill.generateAuthenticHeaders({
      url: 'https://example.com',
    });
    
    // Both should be valid
    expect(tlsOptions).toHaveProperty('ciphers');
    expect(headers).toHaveProperty('user-agent');
  }),

  test('Combined stats after profile generation', async () => {
    // Generate profiles
    tlsFingerprintRandomizer.getRandomProfile();
    headersPolyfill.getRandomProfile();
    
    const stats = await getStealthStats();
    
    // Both should show active profiles
    expect(stats.tls.currentProfile).toBeTruthy();
    expect(stats.headers.currentProfile).toBeTruthy();
  }),

  test('Module exports correct types', () => {
    expect(typeof tlsFingerprintRandomizer.getRandomProfile).toBe('function');
    expect(typeof tlsFingerprintRandomizer.generateTLSOptions).toBe('function');
    expect(typeof headersPolyfill.getRandomProfile).toBe('function');
    expect(typeof headersPolyfill.generateAuthenticHeaders).toBe('function');
  }),

  test('Full workflow simulation', async () => {
    // 1. Generate TLS options
    const tlsOptions = tlsFingerprintRandomizer.generateTLSOptions();
    expect(tlsOptions.ciphers).toBeTruthy();
    
    // 2. Generate headers for a request
    const headers = headersPolyfill.generateAuthenticHeaders({
      url: 'https://api.example.com/data',
      referer: 'https://example.com',
      method: 'GET',
    });
    expect(headers['user-agent']).toBeTruthy();
    expect(headers['referer']).toBe('https://example.com');
    
    // 3. Check stats
    const stats = await getStealthStats();
    expect(stats.tls.availableProfiles).toBe(3);
    expect(stats.headers.availableProfiles).toBe(4);
  }),
];

// Run tests
async function runTests() {
  console.log('\n🧪 Running Stealth Integration Tests\n');
  
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
