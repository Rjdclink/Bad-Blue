/**
 * PatternLearner Tests - Step 6 Verification
 * 
 * These tests verify pattern learning and caching functionality:
 * 1. Pattern storage and retrieval
 * 2. TTL-based expiration
 * 3. Quality thresholds
 * 4. Domain/field scoping
 * 5. LRU eviction
 * 
 * Run with: tsx server/services/peopleSearch/cache/__tests__/PatternLearner.test.ts
 */

// ============================================
// TEST FRAMEWORK
// ============================================

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration?: number;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  return async () => {
    const startTime = Date.now();
    try {
      await fn();
      const duration = Date.now() - startTime;
      results.push({ name, passed: true, duration });
      console.log(`✓ ${name} (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;
      results.push({
        name,
        passed: false,
        duration,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`✗ ${name} (${duration}ms)`);
      console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

function expect<T>(actual: T) {
  return {
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
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null, got ${actual}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error('Expected value to be defined');
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toBeLessThan(expected: number) {
      if (typeof actual !== 'number' || actual >= expected) {
        throw new Error(`Expected ${actual} to be less than ${expected}`);
      }
    },
  };
}

// ============================================
// TESTS
// ============================================

// Test 1: Pattern storage and retrieval
const testPatternStorageAndRetrieval = test('Pattern storage and retrieval', async () => {
  const { createPatternLearner } = await import('../PatternLearner');
  
  const learner = createPatternLearner();
  
  const pattern = learner.learnFromSuccess(
    'example.com',
    'fullName' as any,
    'selector',
    '.person-name',
    0.85,
    'T1_FETCH_PARSE'
  );
  
  expect(pattern).toBeTruthy();
  expect(pattern!.domain).toBe('example.com');
  expect(pattern!.field).toBe('fullName');
  expect(pattern!.strategy).toBe('.person-name');
  
  // Retrieve
  const lookup = learner.lookup({ domain: 'example.com', field: 'fullName' as any });
  expect(lookup.found).toBe(true);
  expect(lookup.cacheHit).toBe(true);
  expect(lookup.pattern!.patternId).toBe(pattern!.patternId);
});

// Test 2: Pattern not found returns structured result
const testPatternNotFound = test('Pattern not found returns structured result', async () => {
  const { createPatternLearner } = await import('../PatternLearner');
  
  const learner = createPatternLearner();
  
  const lookup = learner.lookup({ domain: 'unknown.com', field: 'phones' as any });
  
  expect(lookup.found).toBe(false);
  expect(lookup.cacheHit).toBe(false);
  expect(lookup.pattern).toBeNull();
  expect(lookup.reason).toBeTruthy();
});

// Test 3: TTL-based expiration
const testTtlExpiration = test('TTL-based expiration', async () => {
  const { createPatternLearner } = await import('../PatternLearner');
  
  // Create learner with very short TTL
  const learner = createPatternLearner({ defaultTtlMs: 1 }); // 1ms TTL
  
  learner.learnFromSuccess(
    'example.com',
    'fullName' as any,
    'selector',
    '.name',
    0.9,
    'T1_FETCH_PARSE'
  );
  
  // Wait for TTL to expire
  await new Promise(resolve => setTimeout(resolve, 10));
  
  // Should be expired
  const lookup = learner.lookup({ domain: 'example.com', field: 'fullName' as any });
  expect(lookup.found).toBe(false);
  expect(lookup.reason).toBeTruthy();
});

// Test 4: Quality threshold filtering
const testQualityThreshold = test('Quality threshold filtering', async () => {
  const { createPatternLearner } = await import('../PatternLearner');
  
  const learner = createPatternLearner({
    minSuccessRateToUse: 0.8,
    minConfidenceToStore: 0.5,
  });
  
  // Store pattern with initial success rate of 1.0
  learner.learnFromSuccess(
    'example.com',
    'fullName' as any,
    'selector',
    '.name',
    0.6,
    'T1_FETCH_PARSE'
  );
  
  // Record failures to bring success rate below threshold
  learner.recordUse({ domain: 'example.com', field: 'fullName' as any }, false);
  learner.recordUse({ domain: 'example.com', field: 'fullName' as any }, false);
  learner.recordUse({ domain: 'example.com', field: 'fullName' as any }, false);
  
  // Should not meet quality threshold now
  const lookup = learner.lookup({ domain: 'example.com', field: 'fullName' as any });
  expect(lookup.found).toBe(false);
  expect(lookup.reason).toBeTruthy();
});

// Test 5: Domain/field scoping prevents leakage
const testDomainFieldScoping = test('Domain/field scoping prevents leakage', async () => {
  const { createPatternLearner } = await import('../PatternLearner');
  
  const learner = createPatternLearner();
  
  // Store pattern for domain A
  learner.learnFromSuccess(
    'domainA.com',
    'fullName' as any,
    'selector',
    '.name-a',
    0.9,
    'T1_FETCH_PARSE'
  );
  
  // Store pattern for domain B
  learner.learnFromSuccess(
    'domainB.com',
    'fullName' as any,
    'selector',
    '.name-b',
    0.9,
    'T1_FETCH_PARSE'
  );
  
  // Lookup for domain A should not return domain B's pattern
  const lookupA = learner.lookup({ domain: 'domainA.com', field: 'fullName' as any });
  expect(lookupA.found).toBe(true);
  expect(lookupA.pattern!.strategy).toBe('.name-a');
  
  // Lookup for domain B should not return domain A's pattern
  const lookupB = learner.lookup({ domain: 'domainB.com', field: 'fullName' as any });
  expect(lookupB.found).toBe(true);
  expect(lookupB.pattern!.strategy).toBe('.name-b');
  
  // Lookup for domain C should find nothing
  const lookupC = learner.lookup({ domain: 'domainC.com', field: 'fullName' as any });
  expect(lookupC.found).toBe(false);
});

// Test 6: LRU eviction when at capacity
const testLruEviction = test('LRU eviction when at capacity', async () => {
  const { createPatternLearner } = await import('../PatternLearner');
  
  const learner = createPatternLearner({ maxPatterns: 2 });
  
  // Store first pattern
  learner.learnFromSuccess('domain1.com', 'fullName' as any, 'selector', '.name1', 0.9, 'T1');
  
  // Wait a bit to ensure different timestamps
  await new Promise(resolve => setTimeout(resolve, 5));
  
  // Store second pattern
  learner.learnFromSuccess('domain2.com', 'fullName' as any, 'selector', '.name2', 0.9, 'T1');
  
  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 5));
  
  // Use domain2 to make it more recent
  learner.recordUse({ domain: 'domain2.com', field: 'fullName' as any }, true);
  
  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 5));
  
  // Store third pattern - should evict domain1 (least recently used)
  learner.learnFromSuccess('domain3.com', 'fullName' as any, 'selector', '.name3', 0.9, 'T1');
  
  // domain1 should be evicted
  const lookup1 = learner.lookup({ domain: 'domain1.com', field: 'fullName' as any });
  expect(lookup1.found).toBe(false);
  
  // domain2 and domain3 should still exist
  const lookup2 = learner.lookup({ domain: 'domain2.com', field: 'fullName' as any });
  expect(lookup2.found).toBe(true);
  
  const lookup3 = learner.lookup({ domain: 'domain3.com', field: 'fullName' as any });
  expect(lookup3.found).toBe(true);
});

// Test 7: Metrics tracking
const testMetricsTracking = test('Metrics tracking', async () => {
  const { createPatternLearner } = await import('../PatternLearner');
  
  const learner = createPatternLearner();
  
  // Store a pattern
  learner.learnFromSuccess('example.com', 'fullName' as any, 'selector', '.name', 0.9, 'T1');
  
  // Do some lookups
  learner.lookup({ domain: 'example.com', field: 'fullName' as any }); // Hit
  learner.lookup({ domain: 'unknown.com', field: 'fullName' as any }); // Miss
  
  const metrics = learner.getMetrics();
  
  expect(metrics.stores).toBe(1);
  expect(metrics.lookups).toBe(2);
  expect(metrics.hits).toBe(1);
  expect(metrics.misses).toBe(1);
  expect(metrics.hitRate).toBe(0.5);
});

// Test 8: Disabled learner returns empty results
const testDisabledLearner = test('Disabled learner returns empty results', async () => {
  const { createPatternLearner } = await import('../PatternLearner');
  
  const learner = createPatternLearner({ enabled: false });
  
  // Store should return null
  const pattern = learner.learnFromSuccess(
    'example.com', 'fullName' as any, 'selector', '.name', 0.9, 'T1'
  );
  expect(pattern).toBeNull();
  
  // Lookup should return not found
  const lookup = learner.lookup({ domain: 'example.com', field: 'fullName' as any });
  expect(lookup.found).toBe(false);
  expect(lookup.reason).toBeTruthy();
});

// Test 9: Min confidence to store
const testMinConfidenceToStore = test('Min confidence to store', async () => {
  const { createPatternLearner } = await import('../PatternLearner');
  
  const learner = createPatternLearner({ minConfidenceToStore: 0.7 });
  
  // Low confidence - should not store
  const pattern1 = learner.learnFromSuccess(
    'example.com', 'fullName' as any, 'selector', '.name', 0.5, 'T1'
  );
  expect(pattern1).toBeNull();
  
  // High confidence - should store
  const pattern2 = learner.learnFromSuccess(
    'example.com', 'phones' as any, 'selector', '.phone', 0.8, 'T1'
  );
  expect(pattern2).toBeTruthy();
});

// Test 10: Export and import patterns
const testExportImport = test('Export and import patterns', async () => {
  const { createPatternLearner } = await import('../PatternLearner');
  
  const learner1 = createPatternLearner();
  
  // Store patterns
  learner1.learnFromSuccess('example.com', 'fullName' as any, 'selector', '.name', 0.9, 'T1');
  learner1.learnFromSuccess('example.com', 'phones' as any, 'selector', '.phone', 0.8, 'T1');
  
  // Export
  const exported = learner1.export();
  expect(exported.length).toBe(2);
  
  // Import into new learner
  const learner2 = createPatternLearner();
  learner2.import(exported);
  
  // Verify patterns exist
  const lookup1 = learner2.lookup({ domain: 'example.com', field: 'fullName' as any });
  expect(lookup1.found).toBe(true);
  
  const lookup2 = learner2.lookup({ domain: 'example.com', field: 'phones' as any });
  expect(lookup2.found).toBe(true);
});

// Test 11: Get patterns for domain
const testGetPatternsForDomain = test('Get patterns for domain', async () => {
  const { createPatternLearner } = await import('../PatternLearner');
  
  const learner = createPatternLearner();
  
  // Store multiple patterns for same domain
  learner.learnFromSuccess('example.com', 'fullName' as any, 'selector', '.name', 0.9, 'T1');
  learner.learnFromSuccess('example.com', 'phones' as any, 'selector', '.phone', 0.8, 'T1');
  learner.learnFromSuccess('other.com', 'fullName' as any, 'selector', '.name', 0.9, 'T1');
  
  const patterns = learner.getPatternsForDomain('example.com');
  expect(patterns.length).toBe(2);
});

// Test 12: Clear all patterns
const testClearPatterns = test('Clear all patterns', async () => {
  const { createPatternLearner } = await import('../PatternLearner');
  
  const learner = createPatternLearner();
  
  learner.learnFromSuccess('example.com', 'fullName' as any, 'selector', '.name', 0.9, 'T1');
  
  learner.clear();
  
  const lookup = learner.lookup({ domain: 'example.com', field: 'fullName' as any });
  expect(lookup.found).toBe(false);
  
  const metrics = learner.getMetrics();
  expect(metrics.patternCount).toBe(0);
});

// ============================================
// TEST RUNNER
// ============================================

async function runTests() {
  console.log('\n🧪 Running PatternLearner Tests (Step 6 Verification)...\n');
  console.log('='.repeat(60) + '\n');

  await testPatternStorageAndRetrieval();
  await testPatternNotFound();
  await testTtlExpiration();
  await testQualityThreshold();
  await testDomainFieldScoping();
  await testLruEviction();
  await testMetricsTracking();
  await testDisabledLearner();
  await testMinConfidenceToStore();
  await testExportImport();
  await testGetPatternsForDomain();
  await testClearPatterns();

  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));

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
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    console.log('\nPatternLearner Requirements Verified:');
    console.log('  ✓ Pattern storage and retrieval');
    console.log('  ✓ TTL-based expiration');
    console.log('  ✓ Quality threshold filtering');
    console.log('  ✓ Domain/field scoping');
    console.log('  ✓ LRU eviction');
    console.log('  ✓ Metrics tracking');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
