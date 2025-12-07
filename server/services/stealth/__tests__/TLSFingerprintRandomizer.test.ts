/**
 * TLS Fingerprint Randomizer Tests
 * Run with: tsx server/services/stealth/__tests__/TLSFingerprintRandomizer.test.ts
 */

import { TLSFingerprintRandomizer, tlsFingerprintRandomizer } from '../TLSFingerprintRandomizer';

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
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
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
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected ${actual} to be truthy`);
      }
    },
  };
}

// Tests
const tests = [
  test('TLSFingerprintRandomizer can be instantiated', () => {
    const randomizer = new TLSFingerprintRandomizer();
    expect(randomizer).toBeInstanceOf(TLSFingerprintRandomizer);
  }),

  test('getRandomProfile returns a valid profile', () => {
    const randomizer = new TLSFingerprintRandomizer();
    const profile = randomizer.getRandomProfile();
    
    expect(profile).toHaveProperty('name');
    expect(profile).toHaveProperty('ciphers');
    expect(profile).toHaveProperty('minVersion');
    expect(profile).toHaveProperty('maxVersion');
  }),

  test('getRandomProfile selects from available browsers', () => {
    const randomizer = new TLSFingerprintRandomizer();
    const profile = randomizer.getRandomProfile();
    
    const validNames = ['Chrome 120', 'Firefox 121', 'Safari 17'];
    expect(validNames).toContain(profile.name);
  }),

  test('generateTLSOptions returns proper structure', () => {
    const randomizer = new TLSFingerprintRandomizer();
    const options = randomizer.generateTLSOptions();
    
    expect(options).toHaveProperty('ciphers');
    expect(options).toHaveProperty('minVersion');
    expect(options).toHaveProperty('maxVersion');
    expect(options).toHaveProperty('honorCipherOrder');
    expect(options).toHaveProperty('ecdhCurve');
    expect(options).toHaveProperty('sessionTimeout');
  }),

  test('generateTLSOptions has correct values', () => {
    const randomizer = new TLSFingerprintRandomizer();
    const options = randomizer.generateTLSOptions();
    
    expect(options.honorCipherOrder).toBe(true);
    expect(options.ecdhCurve).toBe('prime256v1:secp384r1:secp521r1');
    expect(options.sessionTimeout).toBe(300);
  }),

  test('generateTLSOptions ciphers are colon-separated', () => {
    const randomizer = new TLSFingerprintRandomizer();
    const options = randomizer.generateTLSOptions();
    
    expect(typeof options.ciphers).toBe('string');
    expect(options.ciphers.includes(':')).toBe(true);
  }),

  test('getCurrentProfile returns undefined initially', () => {
    const randomizer = new TLSFingerprintRandomizer();
    const profile = randomizer.getCurrentProfile();
    expect(profile).toBe(undefined);
  }),

  test('getCurrentProfile returns profile after getRandomProfile', () => {
    const randomizer = new TLSFingerprintRandomizer();
    randomizer.getRandomProfile();
    const profile = randomizer.getCurrentProfile();
    expect(profile).toBeTruthy();
  }),

  test('getStats returns valid structure', () => {
    const randomizer = new TLSFingerprintRandomizer();
    const stats = randomizer.getStats();
    
    expect(stats).toHaveProperty('currentProfile');
    expect(stats).toHaveProperty('availableProfiles');
    expect(stats.availableProfiles).toBe(3);
  }),

  test('getStats shows None when no profile selected', () => {
    const randomizer = new TLSFingerprintRandomizer();
    const stats = randomizer.getStats();
    expect(stats.currentProfile).toBe('None');
  }),

  test('getStats shows current profile after selection', () => {
    const randomizer = new TLSFingerprintRandomizer();
    randomizer.getRandomProfile();
    const stats = randomizer.getStats();
    expect(stats.currentProfile).toBeTruthy();
  }),

  test('singleton instance works correctly', () => {
    const profile = tlsFingerprintRandomizer.getRandomProfile();
    expect(profile).toHaveProperty('name');
    expect(profile).toHaveProperty('ciphers');
  }),

  test('all browser profiles have required ciphers', () => {
    const randomizer = new TLSFingerprintRandomizer();
    
    // Test each profile by calling multiple times
    for (let i = 0; i < 10; i++) {
      const profile = randomizer.getRandomProfile();
      expect(profile.ciphers.length).toBeGreaterThan(0);
      expect(profile.minVersion).toBe('TLSv1.2');
      expect(profile.maxVersion).toBe('TLSv1.3');
    }
  }),

  test('Chrome 120 profile has correct ciphers', () => {
    const randomizer = new TLSFingerprintRandomizer();
    let chromeProfile;
    
    // Try up to 20 times to get Chrome profile
    for (let i = 0; i < 20; i++) {
      const profile = randomizer.getRandomProfile();
      if (profile.name === 'Chrome 120') {
        chromeProfile = profile;
        break;
      }
    }
    
    if (chromeProfile) {
      expect(chromeProfile.ciphers).toContain('TLS_AES_128_GCM_SHA256');
      expect(chromeProfile.ciphers).toContain('TLS_AES_256_GCM_SHA384');
      expect(chromeProfile.ciphers).toContain('TLS_CHACHA20_POLY1305_SHA256');
    }
  }),
];

// Run tests
async function runTests() {
  console.log('\n🧪 Running TLS Fingerprint Randomizer Tests\n');
  
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
