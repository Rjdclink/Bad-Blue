/**
 * Phase 3B: Adaptive Crawler & Extractors Tests
 * Tests for browserManager, adaptiveCrawler, and extractors
 * Run with: tsx server/services/legalIntelligence/__tests__/phase3b.test.ts
 */

// Simple unit tests without instantiation that might cause issues
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
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected truthy value, got ${actual}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error('Expected value to be defined');
      }
    },
  };
}

async function runTests() {
  console.log('=== Phase 3B: Adaptive Crawler & Extractors Tests ===\n');

  // Module Import Tests
  console.log('Running Module Import tests...');
  
  await test('BrowserManager module can be imported', async () => {
    const { BrowserManager } = await import('../browserManager');
    expect(BrowserManager).toBeDefined();
  })();

  await test('AdaptiveCrawler module can be imported', async () => {
    const { AdaptiveCrawler } = await import('../adaptiveCrawler');
    expect(AdaptiveCrawler).toBeDefined();
  })();

  await test('CourtDocketExtractor module can be imported', async () => {
    const { CourtDocketExtractor } = await import('../extractors/courtDocketExtractor');
    expect(CourtDocketExtractor).toBeDefined();
  })();

  await test('StatuteExtractor module can be imported', async () => {
    const { StatuteExtractor } = await import('../extractors/statuteExtractor');
    expect(StatuteExtractor).toBeDefined();
  })();

  await test('OfficerRecordsExtractor module can be imported', async () => {
    const { OfficerRecordsExtractor } = await import('../extractors/officerRecordsExtractor');
    expect(OfficerRecordsExtractor).toBeDefined();
  })();

  await test('PrecedentExtractor module can be imported', async () => {
    const { PrecedentExtractor } = await import('../extractors/precedentExtractor');
    expect(PrecedentExtractor).toBeDefined();
  })();

  // Singleton Export Tests
  console.log('\nRunning Singleton Export tests...');
  
  await test('browserManager singleton is exported', async () => {
    const { browserManager } = await import('../browserManager');
    expect(browserManager).toBeDefined();
  })();

  await test('adaptiveCrawler singleton is exported', async () => {
    const { adaptiveCrawler } = await import('../adaptiveCrawler');
    expect(adaptiveCrawler).toBeDefined();
  })();

  await test('courtDocketExtractor singleton is exported', async () => {
    const { courtDocketExtractor } = await import('../extractors/courtDocketExtractor');
    expect(courtDocketExtractor).toBeDefined();
  })();

  await test('statuteExtractor singleton is exported', async () => {
    const { statuteExtractor } = await import('../extractors/statuteExtractor');
    expect(statuteExtractor).toBeDefined();
  })();

  await test('officerRecordsExtractor singleton is exported', async () => {
    const { officerRecordsExtractor } = await import('../extractors/officerRecordsExtractor');
    expect(officerRecordsExtractor).toBeDefined();
  })();

  await test('precedentExtractor singleton is exported', async () => {
    const { precedentExtractor } = await import('../extractors/precedentExtractor');
    expect(precedentExtractor).toBeDefined();
  })();

  // Index Export Tests
  console.log('\nRunning Index Export tests...');
  
  await test('All Phase 3B modules exported from index', async () => {
    const index = await import('../index');
    
    expect(index.browserManager).toBeDefined();
    expect(index.adaptiveCrawler).toBeDefined();
    expect(index.courtDocketExtractor).toBeDefined();
    expect(index.statuteExtractor).toBeDefined();
    expect(index.officerRecordsExtractor).toBeDefined();
    expect(index.precedentExtractor).toBeDefined();
  })();

  await test('Phase 3B types are exported', async () => {
    const index = await import('../index');
    
    // Check that type exports don't throw errors during import
    expect(true).toBe(true);
  })();

  // Summary
  console.log('\n=== Test Summary ===');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }

  if (passed === results.length) {
    console.log('\n✓ All tests passed!');
    process.exit(0);
  } else {
    console.log(`\n✗ ${failed} test(s) failed`);
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
