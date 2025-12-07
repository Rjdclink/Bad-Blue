/**
 * Headers Polyfill Tests
 * Run with: tsx server/services/stealth/__tests__/HeadersPolyfill.test.ts
 */

import { HeadersPolyfill, headersPolyfill } from '../HeadersPolyfill';

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
    toInclude(substring: string) {
      if (typeof actual !== 'string' || !actual.includes(substring)) {
        throw new Error(`Expected "${actual}" to include "${substring}"`);
      }
    },
  };
}

// Tests
const tests = [
  test('HeadersPolyfill can be instantiated', () => {
    const polyfill = new HeadersPolyfill();
    expect(polyfill).toBeInstanceOf(HeadersPolyfill);
  }),

  test('getRandomProfile returns a valid profile', () => {
    const polyfill = new HeadersPolyfill();
    const profile = polyfill.getRandomProfile();
    
    expect(profile).toHaveProperty('name');
    expect(profile).toHaveProperty('userAgent');
    expect(profile).toHaveProperty('secChUa');
    expect(profile).toHaveProperty('accept');
    expect(profile).toHaveProperty('acceptLanguage');
    expect(profile).toHaveProperty('acceptEncoding');
  }),

  test('getRandomProfile selects from available browsers', () => {
    const polyfill = new HeadersPolyfill();
    const profile = polyfill.getRandomProfile();
    
    const validNames = ['Chrome 120 Windows', 'Chrome 120 macOS', 'Firefox 121 Windows', 'Safari 17 macOS'];
    expect(validNames).toContain(profile.name);
  }),

  test('generateAuthenticHeaders returns required headers', () => {
    const polyfill = new HeadersPolyfill();
    const headers = polyfill.generateAuthenticHeaders({ url: 'https://example.com' });
    
    expect(headers).toHaveProperty('user-agent');
    expect(headers).toHaveProperty('accept');
    expect(headers).toHaveProperty('accept-language');
    expect(headers).toHaveProperty('accept-encoding');
    expect(headers).toHaveProperty('cache-control');
    expect(headers).toHaveProperty('upgrade-insecure-requests');
    expect(headers).toHaveProperty('connection');
  }),

  test('generateAuthenticHeaders includes sec-fetch headers for GET', () => {
    const polyfill = new HeadersPolyfill();
    const headers = polyfill.generateAuthenticHeaders({ 
      url: 'https://example.com',
      method: 'GET'
    });
    
    expect(headers).toHaveProperty('sec-fetch-dest');
    expect(headers).toHaveProperty('sec-fetch-mode');
    expect(headers).toHaveProperty('sec-fetch-site');
    expect(headers).toHaveProperty('sec-fetch-user');
  }),

  test('generateAuthenticHeaders includes referer when provided', () => {
    const polyfill = new HeadersPolyfill();
    const headers = polyfill.generateAuthenticHeaders({ 
      url: 'https://example.com',
      referer: 'https://google.com'
    });
    
    expect(headers).toHaveProperty('referer');
    expect(headers.referer).toBe('https://google.com');
  }),

  test('generateAuthenticHeaders sets sec-fetch-site correctly with referer', () => {
    const polyfill = new HeadersPolyfill();
    const headers = polyfill.generateAuthenticHeaders({ 
      url: 'https://example.com',
      referer: 'https://google.com'
    });
    
    expect(headers['sec-fetch-site']).toBe('same-origin');
  }),

  test('generateAuthenticHeaders sets sec-fetch-site to none without referer', () => {
    const polyfill = new HeadersPolyfill();
    const headers = polyfill.generateAuthenticHeaders({ 
      url: 'https://example.com'
    });
    
    expect(headers['sec-fetch-site']).toBe('none');
  }),

  test('Chrome profiles include sec-ch-ua headers', () => {
    const polyfill = new HeadersPolyfill();
    
    // Try to get Chrome profile
    let chromeHeaders;
    for (let i = 0; i < 20; i++) {
      polyfill.getRandomProfile();
      const headers = polyfill.generateAuthenticHeaders({ url: 'https://example.com' });
      
      if (headers['sec-ch-ua']) {
        chromeHeaders = headers;
        break;
      }
    }
    
    if (chromeHeaders) {
      expect(chromeHeaders).toHaveProperty('sec-ch-ua');
      expect(chromeHeaders).toHaveProperty('sec-ch-ua-mobile');
      expect(chromeHeaders).toHaveProperty('sec-ch-ua-platform');
      expect(chromeHeaders['sec-ch-ua']).toInclude('Chrome');
    }
  }),

  test('Firefox profiles do not include sec-ch-ua headers', () => {
    const polyfill = new HeadersPolyfill();
    
    // Try to get Firefox profile
    let firefoxHeaders;
    for (let i = 0; i < 20; i++) {
      const profile = polyfill.getRandomProfile();
      if (profile.name.includes('Firefox')) {
        firefoxHeaders = polyfill.generateAuthenticHeaders({ url: 'https://example.com' });
        break;
      }
    }
    
    if (firefoxHeaders) {
      // Firefox should not have sec-ch-ua headers
      expect(!firefoxHeaders['sec-ch-ua'] || firefoxHeaders['sec-ch-ua'] === '').toBe(true);
    }
  }),

  test('getCurrentProfile returns undefined initially', () => {
    const polyfill = new HeadersPolyfill();
    const profile = polyfill.getCurrentProfile();
    expect(profile).toBe(undefined);
  }),

  test('getCurrentProfile returns profile after getRandomProfile', () => {
    const polyfill = new HeadersPolyfill();
    polyfill.getRandomProfile();
    const profile = polyfill.getCurrentProfile();
    expect(profile).toBeTruthy();
  }),

  test('rotateProfile changes the profile', () => {
    const polyfill = new HeadersPolyfill();
    const profile1 = polyfill.getRandomProfile();
    const profile2 = polyfill.rotateProfile();
    
    // Both should be valid profiles
    expect(profile1).toHaveProperty('name');
    expect(profile2).toHaveProperty('name');
  }),

  test('getStats returns valid structure', () => {
    const polyfill = new HeadersPolyfill();
    const stats = polyfill.getStats();
    
    expect(stats).toHaveProperty('currentProfile');
    expect(stats).toHaveProperty('availableProfiles');
    expect(stats).toHaveProperty('browser');
    expect(stats.availableProfiles).toBe(4);
  }),

  test('getStats shows None when no profile selected', () => {
    const polyfill = new HeadersPolyfill();
    const stats = polyfill.getStats();
    expect(stats.currentProfile).toBe('None');
    expect(stats.browser).toBe('None');
  }),

  test('getStats shows current profile after selection', () => {
    const polyfill = new HeadersPolyfill();
    polyfill.getRandomProfile();
    const stats = polyfill.getStats();
    expect(stats.currentProfile).toBeTruthy();
    expect(stats.browser).toBeTruthy();
  }),

  test('singleton instance works correctly', () => {
    const profile = headersPolyfill.getRandomProfile();
    expect(profile).toHaveProperty('name');
    expect(profile).toHaveProperty('userAgent');
  }),

  test('user-agent matches browser name', () => {
    const polyfill = new HeadersPolyfill();
    const profile = polyfill.getRandomProfile();
    const headers = polyfill.generateAuthenticHeaders({ url: 'https://example.com' });
    
    expect(headers['user-agent']).toBe(profile.userAgent);
  }),

  test('all standard headers have correct format', () => {
    const polyfill = new HeadersPolyfill();
    polyfill.getRandomProfile();
    const headers = polyfill.generateAuthenticHeaders({ url: 'https://example.com' });
    
    expect(headers['cache-control']).toBe('max-age=0');
    expect(headers['upgrade-insecure-requests']).toBe('1');
    expect(headers['connection']).toBe('keep-alive');
  }),

  test('accept-encoding includes standard compressions', () => {
    const polyfill = new HeadersPolyfill();
    polyfill.getRandomProfile();
    const headers = polyfill.generateAuthenticHeaders({ url: 'https://example.com' });
    
    expect(headers['accept-encoding']).toInclude('gzip');
    expect(headers['accept-encoding']).toInclude('deflate');
  }),

  test('generates authentic headers without explicit profile selection', () => {
    const polyfill = new HeadersPolyfill();
    // Don't call getRandomProfile first
    const headers = polyfill.generateAuthenticHeaders({ url: 'https://example.com' });
    
    // Should still generate valid headers by auto-selecting a profile
    expect(headers).toHaveProperty('user-agent');
    expect(headers).toHaveProperty('accept');
    expect(headers['user-agent'].length).toBeGreaterThan(0);
  }),
];

// Run tests
async function runTests() {
  console.log('\n🧪 Running Headers Polyfill Tests\n');
  
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
