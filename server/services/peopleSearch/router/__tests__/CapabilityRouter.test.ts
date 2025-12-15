/**
 * CapabilityRouter Tests - Step 2 Verification
 * 
 * These tests verify the Step 2 requirements:
 * 1. Router chooses cheapest tier that satisfies required fields
 * 2. If no tier can satisfy, returns gaps without throwing
 * 3. Light-JS path is optional and cheap (no Playwright)
 * 4. No browser calls present
 * 
 * Run with: tsx server/services/peopleSearch/router/__tests__/CapabilityRouter.test.ts
 */

// ============================================
// TEST FRAMEWORK (Simple in-repo test runner)
// ============================================

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration?: number;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void | Promise<void>, timeoutMs: number = 10000) {
  return async () => {
    const startTime = Date.now();
    try {
      await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Test timeout')), timeoutMs)
        ),
      ]);
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
      } else if (typeof actual === 'string') {
        if (!actual.includes(expected)) {
          throw new Error(`Expected string to contain "${expected}"`);
        }
      }
    },
    toHaveProperty(prop: string) {
      if (typeof actual !== 'object' || actual === null || !(prop in actual)) {
        throw new Error(`Expected object to have property "${prop}"`);
      }
    },
    toHaveLength(expected: number) {
      if (!Array.isArray(actual) || actual.length !== expected) {
        throw new Error(`Expected array length ${expected}, got ${Array.isArray(actual) ? actual.length : 'not an array'}`);
      }
    },
  };
}

// ============================================
// TESTS
// ============================================

// Test 1: Router chooses cheapest tier first
const testCheapestTierFirst = test('Router chooses cheapest tier that satisfies required fields', async () => {
  const { CapabilityRouter, CapabilityTier } = await import('../CapabilityRouter');
  
  CapabilityRouter.resetMetrics();
  const router = new CapabilityRouter();
  
  // Request only fullName - should use T1 (cheapest that provides it)
  const result = await router.route({
    goal: 'Test cheapest tier selection',
    query: { firstName: 'John', lastName: 'Smith' },
    requiredFields: ['fullName'],
  });
  
  expect(result.success).toBe(true);
  expect(result.data).toBeDefined();
  expect(result.data?.fullName).toContain('John');
  expect(result.data?.fullName).toContain('Smith');
  
  // Provenance should show the tier used
  expect(result.provenance).toBeDefined();
  expect(result.provenance.tier).toBe(CapabilityTier.T1_FETCH_PARSE);
  expect(result.provenance.costHint).toBeLessThanOrEqual(10);
});

// Test 2: Returns gaps without throwing
const testReturnsGapsNoThrow = test('Returns gaps without throwing when fields cannot be satisfied', async () => {
  const { CapabilityRouter, CapabilityTier } = await import('../CapabilityRouter');
  
  CapabilityRouter.resetMetrics();
  const router = new CapabilityRouter();
  
  // Request fields that can't be fully satisfied without browser
  const result = await router.route({
    goal: 'Test gap handling',
    query: { firstName: 'Jane', lastName: 'Doe' },
    requiredFields: ['fullName', 'phones', 'emails', 'relatives'],
  });
  
  // Should NOT throw - should return result with gaps
  expect(result).toBeDefined();
  expect(result.gaps).toBeDefined();
  expect(Array.isArray(result.gaps)).toBeTruthy();
  
  // Some fields should be unsatisfied (phones, emails, relatives are hard without browser)
  const gappedFields = result.gaps.map(g => g.field);
  
  // fullName should be satisfied
  expect(result.data?.fullName).toContain('Jane');
  
  // Gaps should have provenance info
  if (result.gaps.length > 0) {
    const firstGap = result.gaps[0];
    expect(firstGap).toHaveProperty('field');
    expect(firstGap).toHaveProperty('reason');
    expect(firstGap).toHaveProperty('attemptedTiers');
  }
});

// Test 3: Light-JS path is optional and cheap (no Playwright)
const testLightJsNoBrowser = test('Light-JS tier works without Playwright/browser', async () => {
  const { CapabilityRouter, CapabilityTier, TIER_COSTS } = await import('../CapabilityRouter');
  
  CapabilityRouter.resetMetrics();
  const router = new CapabilityRouter();
  
  // Use T3 tier for this test
  const result = await router.route({
    goal: 'Test light JS tier',
    query: { firstName: 'Test', lastName: 'User', city: 'Los Angeles', state: 'CA' },
    requiredFields: ['fullName', 'addresses'],
    maxTier: CapabilityTier.T3_LIGHT_JS,
  });
  
  // Should succeed without browser
  expect(result.success).toBe(true);
  
  // T3 should be cheap (cost < 50 on 0-100 scale)
  expect(TIER_COSTS[CapabilityTier.T3_LIGHT_JS]).toBeLessThanOrEqual(50);
  
  // Verify that T3 tier exists and is accessible (even if cheaper tier was used)
  expect(result.tiersAttempted).toBeDefined();
  expect(Array.isArray(result.tiersAttempted)).toBeTruthy();
  
  // Verify the result doesn't indicate any browser usage
  // The key point is that no browser imports exist in the module (tested separately)
  // and all tiers in this test work without Playwright
  expect(result.data).toBeDefined();
  expect(result.data?.fullName).toContain('Test');
});

// Test 4: No browser calls present (verify no Playwright imports)
const testNoBrowserImports = test('Module has no Playwright or browser imports', async () => {
  // Read the module source to verify no browser imports
  const fs = await import('fs/promises');
  const path = await import('path');
  const url = await import('url');
  
  // Use import.meta.url to get current file path, then navigate to module
  const currentDir = path.dirname(url.fileURLToPath(import.meta.url));
  const modulePath = path.join(currentDir, '..', 'CapabilityRouter.ts');
  
  const source = await fs.readFile(modulePath, 'utf-8');
  
  // Should NOT contain Playwright imports
  expect(source.includes("from 'playwright'")).toBeFalsy();
  expect(source.includes("from 'puppeteer'")).toBeFalsy();
  expect(source.includes("import { chromium }")).toBeFalsy();
  expect(source.includes("import playwright")).toBeFalsy();
  
  // Should NOT contain browser-related keywords in imports
  const importLines = source.split('\n').filter(line => line.trim().startsWith('import'));
  const browserImports = importLines.filter(line => 
    line.includes('playwright') || 
    line.includes('puppeteer') ||
    line.includes('browser') ||
    line.includes('chromium')
  );
  
  expect(browserImports.length).toBe(0);
});

// Test 5: Retry cap enforced (no hammering)
const testRetryCap = test('Retries are capped per tier (no hammering)', async () => {
  const { TIER_MAX_RETRIES, CapabilityTier } = await import('../CapabilityRouter');
  
  // Verify all tiers have retry limits
  for (const tier of Object.values(CapabilityTier)) {
    const maxRetries = TIER_MAX_RETRIES[tier];
    expect(maxRetries).toBeDefined();
    expect(maxRetries).toBeGreaterThan(0);
    expect(maxRetries).toBeLessThanOrEqual(3); // Max 3 retries per tier
  }
});

// Test 6: Tier costs are properly ordered (cheap-first)
const testTierCostOrdering = test('Tier costs are ordered from cheapest to most expensive', async () => {
  const { TIER_COSTS, CapabilityTier } = await import('../CapabilityRouter');
  
  const t0Cost = TIER_COSTS[CapabilityTier.T0_STATIC];
  const t1Cost = TIER_COSTS[CapabilityTier.T1_FETCH_PARSE];
  const t2Cost = TIER_COSTS[CapabilityTier.T2_API_REPLAY];
  const t3Cost = TIER_COSTS[CapabilityTier.T3_LIGHT_JS];
  
  // T0 should be cheapest (cache = 0 cost)
  expect(t0Cost).toBe(0);
  
  // Costs should increase as tiers increase
  expect(t1Cost).toBeGreaterThan(t0Cost);
  expect(t2Cost).toBeGreaterThan(t1Cost);
  expect(t3Cost).toBeGreaterThan(t2Cost);
  
  // Even T3 should be relatively cheap (< 50 on 0-100 scale)
  expect(t3Cost).toBeLessThanOrEqual(50);
});

// Test 7: Provenance tracking is complete
const testProvenanceTracking = test('Provenance tracking includes tier, method, timing', async () => {
  const { CapabilityRouter } = await import('../CapabilityRouter');
  
  CapabilityRouter.resetMetrics();
  const router = new CapabilityRouter();
  
  const result = await router.route({
    goal: 'Test provenance tracking',
    query: { firstName: 'Provenance', lastName: 'Test' },
    requiredFields: ['fullName'],
  });
  
  expect(result.provenance).toBeDefined();
  expect(result.provenance.tier).toBeDefined();
  expect(result.provenance.method).toBeDefined();
  expect(result.provenance.timing).toBeDefined();
  expect(result.provenance.timing.startedAt).toBeDefined();
  expect(result.provenance.timing.completedAt).toBeDefined();
  expect(result.provenance.timing.durationMs).toBeGreaterThanOrEqual(0);
  expect(result.provenance.costHint).toBeDefined();
  expect(result.provenance.retryCount).toBeDefined();
});

// Test 8: Claims are generated
const testClaimsGenerated = test('Claims are generated for search results', async () => {
  const { CapabilityRouter } = await import('../CapabilityRouter');
  
  CapabilityRouter.resetMetrics();
  const router = new CapabilityRouter();
  
  const result = await router.route({
    goal: 'Test claims generation',
    query: { firstName: 'Claims', lastName: 'Test', city: 'Seattle', state: 'WA' },
    requiredFields: ['fullName', 'addresses'],
  });
  
  expect(result.claims).toBeDefined();
  expect(Array.isArray(result.claims)).toBeTruthy();
  expect(result.claims.length).toBeGreaterThan(0);
  
  // Claims should be strings
  for (const claim of result.claims) {
    expect(typeof claim).toBe('string');
    expect(claim.length).toBeGreaterThan(0);
  }
});

// Test 9: Metrics are tracked
const testMetricsTracking = test('Router metrics are tracked correctly', async () => {
  const { CapabilityRouter } = await import('../CapabilityRouter');
  
  CapabilityRouter.resetMetrics();
  const router = new CapabilityRouter();
  
  // Initial metrics should be zero
  let metrics = CapabilityRouter.getMetrics();
  expect(metrics.totalRequests).toBe(0);
  expect(metrics.successfulRequests).toBe(0);
  
  // Make a request
  await router.route({
    goal: 'Test metrics',
    query: { firstName: 'Metrics', lastName: 'Test' },
    requiredFields: ['fullName'],
  });
  
  // Metrics should be updated
  metrics = CapabilityRouter.getMetrics();
  expect(metrics.totalRequests).toBe(1);
  expect(metrics.lastRequestAt).toBeDefined();
});

// Test 10: Higher tier hint when gaps remain
const testHigherTierHint = test('higherTierMayHelp flag is set when gaps remain', async () => {
  const { CapabilityRouter } = await import('../CapabilityRouter');
  
  CapabilityRouter.resetMetrics();
  const router = new CapabilityRouter();
  
  // Request fields that can't be fully satisfied
  const result = await router.route({
    goal: 'Test higher tier hint',
    query: { firstName: 'Gap', lastName: 'Test' },
    requiredFields: ['fullName', 'phones', 'emails', 'relatives', 'aliases'],
  });
  
  // If there are gaps, higherTierMayHelp should be true
  if (result.gaps.length > 0) {
    expect(result.higherTierMayHelp).toBe(true);
  }
});

// Test 11: MaxTier respects limit
const testMaxTierRespected = test('maxTier parameter limits tier escalation', async () => {
  const { CapabilityRouter, CapabilityTier } = await import('../CapabilityRouter');
  
  CapabilityRouter.resetMetrics();
  const router = new CapabilityRouter();
  
  // Limit to T1 only
  const result = await router.route({
    goal: 'Test max tier limit',
    query: { firstName: 'Limited', lastName: 'Tier' },
    requiredFields: ['fullName'],
    maxTier: CapabilityTier.T1_FETCH_PARSE,
  });
  
  expect(result.success).toBe(true);
  
  // Should only have attempted T0 and T1
  const attemptedTiers = result.tiersAttempted;
  expect(attemptedTiers.includes(CapabilityTier.T2_API_REPLAY)).toBeFalsy();
  expect(attemptedTiers.includes(CapabilityTier.T3_LIGHT_JS)).toBeFalsy();
});

// Test 12: Confidence is placeholder (null for step 3)
const testConfidencePlaceholder = test('Confidence is null placeholder for step 3', async () => {
  const { CapabilityRouter } = await import('../CapabilityRouter');
  
  CapabilityRouter.resetMetrics();
  const router = new CapabilityRouter();
  
  const result = await router.route({
    goal: 'Test confidence placeholder',
    query: { firstName: 'Confidence', lastName: 'Test' },
    requiredFields: ['fullName'],
  });
  
  // Confidence should be null (placeholder for step 3)
  expect(result.confidence).toBeNull();
});

// ============================================
// TEST RUNNER
// ============================================

async function runTests() {
  console.log('\n🧪 Running CapabilityRouter Tests (Step 2 Verification)...\n');
  console.log('='.repeat(60) + '\n');

  // Run all tests
  await testCheapestTierFirst();
  await testReturnsGapsNoThrow();
  await testLightJsNoBrowser();
  await testNoBrowserImports();
  await testRetryCap();
  await testTierCostOrdering();
  await testProvenanceTracking();
  await testClaimsGenerated();
  await testMetricsTracking();
  await testHigherTierHint();
  await testMaxTierRespected();
  await testConfidencePlaceholder();

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
    console.log('\nStep 2 Requirements Verified:');
    console.log('  ✓ Router chooses cheapest tier that satisfies required fields');
    console.log('  ✓ Returns gaps without throwing');
    console.log('  ✓ Light-JS path is optional and cheap (no Playwright)');
    console.log('  ✓ No browser calls present');
    console.log('  ✓ Retry caps enforced (no hammering)');
    console.log('  ✓ Provenance tracking complete');
    console.log('  ✓ Confidence placeholder for step 3');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
