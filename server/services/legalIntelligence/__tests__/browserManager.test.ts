/**
 * Browser Manager Tests
 * Tests for Playwright browser orchestration and pooling
 */

import { browserManager } from '../browserManager';

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
    toBe(expected: T) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, got ${actual}`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected truthy value, got ${actual}`);
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new Error(`Expected falsy value, got ${actual}`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be > ${expected}`);
      }
    },
    toContain(expected: any) {
      if (!Array.isArray(actual)) {
        throw new Error('toContain requires an array');
      }
      if (!actual.includes(expected)) {
        throw new Error(`Expected array to contain ${expected}`);
      }
    },
    toHaveProperty(prop: string) {
      if (!(prop in (actual as any))) {
        throw new Error(`Expected object to have property "${prop}"`);
      }
    },
  };
}

// Browser Manager Tests
const browserManagerTests = [
  test('getBrowser returns a browser instance', async () => {
    const browser = await browserManager.getBrowser('chromium');
    expect(browser).toBeTruthy();
    expect(typeof browser.close).toBe('function');
  }),

  test('getBrowser reuses existing browser', async () => {
    const browser1 = await browserManager.getBrowser('chromium');
    const browser2 = await browserManager.getBrowser('chromium');
    expect(browser1).toBe(browser2);
  }),

  test('createContext returns a browser context', async () => {
    const context = await browserManager.createContext('chromium');
    expect(context).toBeTruthy();
    expect(typeof context.newPage).toBe('function');
    await context.close();
  }),

  test('createPage returns a page instance', async () => {
    const page = await browserManager.createPage('chromium');
    expect(page).toBeTruthy();
    expect(typeof page.goto).toBe('function');
    await page.context().close();
  }),

  test('getStats returns browser statistics', async () => {
    // Ensure at least one browser is running
    await browserManager.getBrowser('chromium');
    
    const stats = browserManager.getStats();
    expect(stats).toBeTruthy();
    expect(typeof stats).toBe('object');
  }),

  test('createPage with custom config', async () => {
    const page = await browserManager.createPage('chromium', {
      headless: true,
      timeout: 10000,
      viewport: { width: 1024, height: 768 },
    });
    
    expect(page).toBeTruthy();
    const viewport = page.viewportSize();
    expect(viewport?.width).toBe(1024);
    expect(viewport?.height).toBe(768);
    
    await page.context().close();
  }),

  test('waitForContent handles timeout gracefully', async () => {
    const page = await browserManager.createPage('chromium');
    await page.goto('about:blank');
    
    // Should handle timeout without throwing
    const result = await browserManager.waitForContent(page, '.nonexistent', 1000);
    expect(result).toBe(false);
    
    await page.context().close();
  }),

  test('closeBrowser closes specific browser type', async () => {
    await browserManager.getBrowser('chromium');
    await browserManager.closeBrowser('chromium');
    
    // Verify it's closed by checking stats
    const stats = browserManager.getStats();
    expect(stats.chromium).toBeFalsy();
  }),
];

// Run all tests
async function runTests() {
  console.log('\n=== Browser Manager Tests ===\n');
  
  for (const testFn of browserManagerTests) {
    await testFn();
  }
  
  // Cleanup
  console.log('\nCleaning up...');
  await browserManager.closeAll();
  
  console.log('\n=== Test Summary ===');
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${results.filter(r => r.passed).length}`);
  console.log(`Failed: ${results.filter(r => !r.passed).length}`);
  
  if (results.every(r => r.passed)) {
    console.log('✓ All tests passed!\n');
    process.exit(0);
  } else {
    console.log('✗ Some tests failed\n');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
