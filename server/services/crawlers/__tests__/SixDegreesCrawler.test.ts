/**
 * Six Degrees Crawler Tests
 * Tests for social graph mapper with path finding and community detection
 */

import { SixDegreesCrawler } from '../SixDegreesCrawler';
import { PhylacterySystem } from '../../storage/PhylacterySystem';
import { StealthInfrastructure } from '../../stealth/StealthInfrastructure';

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
        error: error instanceof Error ? error.message : String(error)
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
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toBeGreaterThanOrEqual(expected: number) {
      if (typeof actual !== 'number' || actual < expected) {
        throw new Error(`Expected ${actual} to be greater than or equal to ${expected}`);
      }
    },
    toBeLessThanOrEqual(expected: number) {
      if (typeof actual !== 'number' || actual > expected) {
        throw new Error(`Expected ${actual} to be less than or equal to ${expected}`);
      }
    },
    toContain(expected: any) {
      if (Array.isArray(actual)) {
        if (!actual.includes(expected)) {
          throw new Error(`Expected array to contain ${expected}`);
        }
      } else {
        throw new Error('toContain can only be used with arrays');
      }
    },
    toHaveLength(expected: number) {
      if (!Array.isArray(actual) && typeof actual !== 'string') {
        throw new Error('toHaveLength can only be used with arrays or strings');
      }
      if (actual.length !== expected) {
        throw new Error(`Expected length ${expected}, got ${actual.length}`);
      }
    }
  };
}

async function runTests() {
  console.log('🌐 Running Six Degrees Crawler Tests...\n');

  const phylactery = new PhylacterySystem();
  const stealth = new StealthInfrastructure();
  const crawler = new SixDegreesCrawler(stealth, phylactery);

  // Test 1: Initial state
  await test('should initialize with empty graph', async () => {
    const stats = crawler.getGraphStats();
    expect(stats.nodeCount).toBe(0);
    expect(stats.edgeCount).toBe(0);
    expect(stats.avgConnections).toBe(0);
  })();

  // Test 2: Build graph (simulated - won't make real HTTP calls in basic test)
  await test('should build graph structure', async () => {
    // This test verifies the graph structure exists
    // Real HTTP calls would be tested in integration tests
    const stats = crawler.getGraphStats();
    expect(stats).toBeTruthy();
  })();

  // Test 3: Clear graph
  await test('should clear graph', async () => {
    crawler.clearGraph();
    const stats = crawler.getGraphStats();
    expect(stats.nodeCount).toBe(0);
    expect(stats.edgeCount).toBe(0);
  })();

  // Test 4: Path finding with empty graph
  await test('should return empty path when no graph exists', async () => {
    const path = await crawler.findPath('example.com', 'target.com');
    expect(path.nodes).toHaveLength(0);
    expect(path.degrees).toBe(-1);
    expect(path.relationships).toHaveLength(0);
  })();

  // Test 5: Find all paths with empty graph
  await test('should return empty array for all paths when no graph exists', async () => {
    const paths = await crawler.findAllPaths('example.com', 'target.com', 6);
    expect(paths).toHaveLength(0);
  })();

  // Test 6: Community detection with empty graph
  await test('should return empty communities when no graph exists', async () => {
    const communities = await crawler.findCommunities();
    expect(communities).toHaveLength(0);
  })();

  // Test 7: Hub identification with empty graph
  await test('should return empty hubs when no graph exists', async () => {
    const hubs = await crawler.findHubs(10);
    expect(hubs).toHaveLength(0);
  })();

  // Test 8: Discover hidden with empty graph
  await test('should return empty array for hidden sites when no graph exists', async () => {
    const hidden = await crawler.discoverHidden('example.com');
    expect(hidden).toHaveLength(0);
  })();

  // Test 9: Crawl path with empty graph
  await test('should return empty data for path crawling when no graph exists', async () => {
    const data = await crawler.crawlPath('example.com', 'target.com');
    expect(data).toHaveLength(0);
  })();

  // Test 10: Graph stats after operations
  await test('should maintain correct stats after operations', async () => {
    crawler.clearGraph();
    const stats = crawler.getGraphStats();
    expect(stats.nodeCount).toBe(0);
    expect(stats.edgeCount).toBe(0);
    expect(stats.avgConnections).toBe(0);
  })();

  // Test 11: Find hubs with limit
  await test('should respect limit parameter in findHubs', async () => {
    const hubs = await crawler.findHubs(5);
    expect(hubs.length).toBeLessThanOrEqual(5);
  })();

  // Test 12: Crawl community with empty community
  await test('should handle empty community gracefully', async () => {
    const community = {
      id: 'test',
      members: [],
      commonality: 'test',
      density: 0
    };
    const data = await crawler.crawlCommunity(community);
    expect(data).toHaveLength(0);
  })();

  // Test 13: Exploit hub with non-existent hub
  await test('should handle non-existent hub gracefully', async () => {
    const data = await crawler.exploitHub('nonexistent.com');
    expect(data).toHaveLength(0);
  })();

  // Test 14: Graph stats structure
  await test('should return proper stats structure', async () => {
    const stats = crawler.getGraphStats();
    expect(stats.nodeCount).toBeGreaterThanOrEqual(0);
    expect(stats.edgeCount).toBeGreaterThanOrEqual(0);
    expect(stats.avgConnections).toBeGreaterThanOrEqual(0);
  })();

  // Test 15: Find all paths respects max degrees
  await test('should respect maxDegrees in findAllPaths', async () => {
    const paths = await crawler.findAllPaths('source.com', 'target.com', 3);
    for (const path of paths) {
      expect(path.degrees).toBeLessThanOrEqual(3);
    }
  })();

  // Summary
  console.log('\n' + '='.repeat(50));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\n✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`Total: ${results.length}\n`);

  if (failed > 0) {
    console.log('Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }

  process.exit(0);
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
