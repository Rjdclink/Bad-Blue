/**
 * PANTHEON Crawlers Test Suite
 * Tests for Wraith and Hydra crawlers
 */

import { WraithCrawler } from '../pantheon/crawlers/wraith';
import { HydraCrawler } from '../pantheon/crawlers/hydra';
import { CrawlerTask } from '../pantheon/core';

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
    toBeLessThanOrEqual(expected: number) {
      if (typeof actual !== 'number' || actual > expected) {
        throw new Error(`Expected ${actual} to be less than or equal to ${expected}`);
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
    toContain(item: any) {
      if (!Array.isArray(actual)) {
        throw new Error('Expected array');
      }
      if (!actual.includes(item)) {
        throw new Error(`Expected array to contain ${item}`);
      }
    },
  };
}

// ===== WRAITH CRAWLER TESTS =====

const wraithTests = [
  test('Wraith crawler should initialize correctly', async () => {
    const task: CrawlerTask = {
      id: 'test-1',
      target: 'https://example.com',
      priority: 5,
    };
    
    const wraith = new WraithCrawler(task);
    expect(wraith).toBeTruthy();
  }),

  test('Wraith crawler should execute and return signatures', async () => {
    const task: CrawlerTask = {
      id: 'test-2',
      target: 'https://example.com',
      priority: 5,
      timeout: 10000,
    };
    
    const wraith = new WraithCrawler(task);
    const result = await wraith.run();
    
    expect(result.success).toBeTruthy();
    expect(result.taskId).toEqual('test-2');
    expect(result.signatures.length).toBeGreaterThan(0);
  }),

  test('Wraith crawler should handle failures silently', async () => {
    const task: CrawlerTask = {
      id: 'test-3',
      target: 'https://invalid-domain-that-does-not-exist-12345.com',
      priority: 5,
      timeout: 5000,
    };
    
    const wraith = new WraithCrawler(task);
    const result = await wraith.run();
    
    // Wraiths fail silently - should return empty signatures but no error
    expect(result.success).toBeTruthy();
  }),

  test('Wraith crawler timing signature should have correct structure', async () => {
    const task: CrawlerTask = {
      id: 'test-4',
      target: 'https://example.com',
      priority: 5,
      timeout: 10000,
    };
    
    const wraith = new WraithCrawler(task);
    const result = await wraith.run();
    
    if (result.signatures.length > 0) {
      const timingSignature = result.signatures.find(s => s.metadata.type === 'timing');
      if (timingSignature) {
        expect(timingSignature.metadata).toHaveProperty('avg');
        expect(timingSignature.metadata).toHaveProperty('variance');
        expect(timingSignature.metadata).toHaveProperty('jitter');
        expect(timingSignature.metadata).toHaveProperty('samples');
        expect(timingSignature.metadata.samples).toEqual(5);
      }
    }
  }),
];

// ===== HYDRA CRAWLER TESTS =====

const hydraTests = [
  test('Hydra crawler should initialize correctly', async () => {
    const task: CrawlerTask = {
      id: 'test-5',
      target: 'https://example.com',
      priority: 5,
    };
    
    const hydra = new HydraCrawler(task);
    expect(hydra).toBeTruthy();
  }),

  test('Hydra crawler should execute and return signatures', async () => {
    const task: CrawlerTask = {
      id: 'test-6',
      target: 'https://example.com',
      priority: 5,
      timeout: 10000,
    };
    
    const hydra = new HydraCrawler(task);
    const result = await hydra.run();
    
    expect(result.success).toBeTruthy();
    expect(result.taskId).toEqual('test-6');
    expect(result.signatures.length).toBeGreaterThan(0);
  }),

  test('Hydra head should assess richness correctly', async () => {
    const task: CrawlerTask = {
      id: 'test-7',
      target: 'https://example.com',
      priority: 5,
      timeout: 10000,
    };
    
    const hydra = new HydraCrawler(task);
    const result = await hydra.run();
    
    if (result.signatures.length > 0) {
      const signature = result.signatures[0];
      expect(signature.metadata).toHaveProperty('richness');
      expect(typeof signature.metadata.richness).toEqual('number');
      expect(signature.metadata.richness).toBeGreaterThan(-0.01);
      expect(signature.metadata.richness).toBeLessThanOrEqual(1);
    }
  }),

  test('Hydra head should limit heads to max 5', async () => {
    const task: CrawlerTask = {
      id: 'test-8',
      target: 'https://example.com',
      priority: 5,
      timeout: 10000,
    };
    
    const hydra = new HydraCrawler(task);
    const result = await hydra.run();
    
    // Should not spawn more than 5 heads
    expect(result.signatures.length).toBeLessThanOrEqual(5);
  }),
];

// ===== RUN ALL TESTS =====

async function runTests() {
  console.log('\n=== PANTHEON CRAWLER TESTS ===\n');
  
  console.log('--- Wraith Crawler Tests ---');
  for (const testFn of wraithTests) {
    await testFn();
  }
  
  console.log('\n--- Hydra Crawler Tests ---');
  for (const testFn of hydraTests) {
    await testFn();
  }
  
  console.log('\n=== TEST SUMMARY ===');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`Total: ${results.length}`);
  
  if (failed > 0) {
    console.log('\n=== FAILURES ===');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`\n${r.name}`);
      console.log(`  ${r.error}`);
    });
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests if this file is executed directly
import { fileURLToPath } from 'url';
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  runTests();
}

export { runTests };
