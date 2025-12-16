/**
 * MonteCarloEngine Tests - Step 4 Verification
 * 
 * These tests verify the Step 4 requirements:
 * 1. Honors budget caps (time/run count)
 * 2. Decision logic matches thresholds
 * 3. Distribution present even when aborted early (with reason)
 * 4. No Playwright/browser invoked
 * 
 * Run with: tsx server/services/peopleSearch/router/__tests__/MonteCarloEngine.test.ts
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
    toBeLessThan(expected: number) {
      if (typeof actual !== 'number' || actual >= expected) {
        throw new Error(`Expected ${actual} to be less than ${expected}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error('Expected value to be defined');
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
    toContain(expected: string) {
      if (typeof actual !== 'string' || !actual.includes(expected)) {
        throw new Error(`Expected string to contain "${expected}"`);
      }
    },
  };
}

// ============================================
// MOCK DATA
// ============================================

import type { ExtractionResult, ClaimsRecord } from '../ExtractionLedger';
import { CapabilityTier } from '../CapabilityRouter';

function createMockExtraction(confidence: number = 0.75, complete: boolean = true): ExtractionResult {
  const now = new Date();
  
  const claims: ClaimsRecord = {
    fullName: {
      value: 'John Smith',
      source: 'test',
      extractedAt: now,
      method: 'fetch',
      tier: CapabilityTier.T1_FETCH_PARSE,
      fieldConfidence: 0.8,
    },
    age: complete ? {
      value: 35,
      source: 'test',
      extractedAt: now,
      method: 'api',
      tier: CapabilityTier.T2_API_REPLAY,
      fieldConfidence: 0.9,
    } : null,
    addresses: null,
    phones: null,
    emails: null,
    relatives: null,
    aliases: null,
  };
  
  return {
    extractionId: `ext_test_${Date.now()}`,
    query: { firstName: 'John', lastName: 'Smith' },
    requiredFields: ['fullName', 'age'],
    claims,
    gaps: {
      entries: complete ? [] : [{
        field: 'age',
        reason: 'Not found',
        attemptedTiers: [CapabilityTier.T1_FETCH_PARSE],
        recordedAt: now,
        escalationCandidate: true,
      }],
      escalationRequired: complete ? [] : ['age'],
      summary: complete ? 'All required fields satisfied' : 'Missing fields: [age]',
    },
    confidence,
    confidenceBreakdown: {
      fieldCoverageScore: complete ? 1.0 : 0.5,
      sourceQualityScore: 0.85,
      recencyScore: 1.0,
      finalScore: confidence,
      explanation: `Confidence ${Math.round(confidence * 100)}%`,
    },
    provenance: {
      extractionId: `ext_test_${Date.now()}`,
      startedAt: new Date(now.getTime() - 100),
      completedAt: now,
      durationMs: 100,
      tiersAttempted: [CapabilityTier.T1_FETCH_PARSE],
      primaryTier: CapabilityTier.T1_FETCH_PARSE,
      tierProvenance: [],
      totalCostHint: 10,
      escalationAttempted: false,
      finalReason: 'Success',
    },
    complete,
    timestamp: now,
  };
}

// ============================================
// TESTS
// ============================================

// Test 1: Result has all required fields
const testResultStructure = test('Monte Carlo result has all required fields', async () => {
  const { MonteCarloEngine } = await import('../MonteCarloEngine');
  
  const engine = new MonteCarloEngine();
  const extraction = createMockExtraction();
  
  const result = await engine.runWithMonteCarlo({
    extraction,
    budget: { maxRuns: 10 },
  });
  
  // Check all required properties
  expect(result).toHaveProperty('samples');
  expect(result).toHaveProperty('summary');
  expect(result).toHaveProperty('decision');
  expect(result).toHaveProperty('reason');
  expect(result).toHaveProperty('provenance');
  expect(result).toHaveProperty('baseExtraction');
  expect(result).toHaveProperty('probabilityMeetsThreshold');
  
  // Check summary structure
  expect(result.summary).toHaveProperty('mean');
  expect(result.summary).toHaveProperty('p10');
  expect(result.summary).toHaveProperty('p50');
  expect(result.summary).toHaveProperty('p90');
  expect(result.summary).toHaveProperty('stdev');
});

// Test 2: Honors run count budget
const testRunCountBudget = test('Honors run count budget', async () => {
  const { MonteCarloEngine } = await import('../MonteCarloEngine');
  
  const engine = new MonteCarloEngine();
  const extraction = createMockExtraction();
  
  const maxRuns = 50;
  const result = await engine.runWithMonteCarlo({
    extraction,
    budget: { maxRuns },
  });
  
  // Should have exactly maxRuns samples (unless time aborted)
  expect(result.samples.length).toBeLessThanOrEqual(maxRuns);
  expect(result.provenance.budgetUsed.runsUsed).toBeLessThanOrEqual(maxRuns);
});

// Test 3: Honors time budget
const testTimeBudget = test('Honors time budget (aborts early)', async () => {
  const { MonteCarloEngine } = await import('../MonteCarloEngine');
  
  const engine = new MonteCarloEngine();
  const extraction = createMockExtraction();
  
  // Very short time budget to force abort
  const maxTimeMs = 10;
  const result = await engine.runWithMonteCarlo({
    extraction,
    budget: { maxRuns: 10000, maxTimeMs },
  });
  
  // Should have completed within time budget (with some tolerance)
  expect(result.provenance.timing.durationMs).toBeLessThan(maxTimeMs + 50); // 50ms tolerance
});

// Test 4: Decision matches thresholds - STOP case
const testDecisionStop = test('Decision logic: STOP when probability exceeds threshold', async () => {
  const { MonteCarloEngine, DEFAULT_THRESHOLDS } = await import('../MonteCarloEngine');
  
  const engine = new MonteCarloEngine();
  // High confidence extraction
  const extraction = createMockExtraction(0.85, true);
  
  const result = await engine.runWithMonteCarlo({
    extraction,
    budget: { maxRuns: 100 },
    thresholds: { confidenceThreshold: 0.7, probabilityThreshold: 0.8 },
  });
  
  // With high base confidence, most samples should meet threshold
  // Decision should be STOP
  expect(result.decision).toBe('stop');
  expect(result.reason).toContain('STOP');
});

// Test 5: Decision matches thresholds - ESCALATE case
const testDecisionEscalate = test('Decision logic: ESCALATE when probability below threshold', async () => {
  const { MonteCarloEngine } = await import('../MonteCarloEngine');
  
  const engine = new MonteCarloEngine();
  // Low confidence extraction
  const extraction = createMockExtraction(0.3, false);
  
  const result = await engine.runWithMonteCarlo({
    extraction,
    budget: { maxRuns: 100 },
    thresholds: { confidenceThreshold: 0.9, probabilityThreshold: 0.9 },
  });
  
  // With low base confidence and high thresholds, should escalate
  expect(result.decision).toBe('escalate');
  expect(result.reason).toContain('ESCALATE');
});

// Test 6: Distribution present even when aborted
const testDistributionOnAbort = test('Distribution present even when aborted early', async () => {
  const { MonteCarloEngine } = await import('../MonteCarloEngine');
  
  const engine = new MonteCarloEngine();
  const extraction = createMockExtraction();
  
  // Force early abort with very short time
  const result = await engine.runWithMonteCarlo({
    extraction,
    budget: { maxRuns: 10000, maxTimeMs: 5 },
  });
  
  // Should have some samples even if aborted
  expect(result.samples.length).toBeGreaterThan(0);
  expect(result.summary.sampleCount).toBeGreaterThan(0);
  
  // If aborted, should have reason
  if (result.provenance.aborted) {
    expect(result.provenance.abortReason).toBeDefined();
    expect(result.reason).toContain('ABORTED');
  }
});

// Test 7: No browser/Playwright imports
const testNoBrowserImports = test('No Playwright/browser imports in module', async () => {
  const fs = await import('fs/promises');
  const path = await import('path');
  const url = await import('url');
  
  const currentDir = path.dirname(url.fileURLToPath(import.meta.url));
  const modulePath = path.join(currentDir, '..', 'MonteCarloEngine.ts');
  
  const source = await fs.readFile(modulePath, 'utf-8');
  
  // Should NOT contain Playwright imports
  expect(source.includes("from 'playwright'")).toBeFalsy();
  expect(source.includes("from 'puppeteer'")).toBeFalsy();
  expect(source.includes("import playwright")).toBeFalsy();
});

// Test 8: Summary statistics are valid
const testSummaryStatistics = test('Summary statistics are valid', async () => {
  const { MonteCarloEngine } = await import('../MonteCarloEngine');
  
  const engine = new MonteCarloEngine();
  const extraction = createMockExtraction();
  
  const result = await engine.runWithMonteCarlo({
    extraction,
    budget: { maxRuns: 100 },
  });
  
  // All values should be in [0, 1]
  expect(result.summary.mean).toBeGreaterThanOrEqual(0);
  expect(result.summary.mean).toBeLessThanOrEqual(1);
  expect(result.summary.p10).toBeGreaterThanOrEqual(0);
  expect(result.summary.p10).toBeLessThanOrEqual(1);
  expect(result.summary.p50).toBeGreaterThanOrEqual(0);
  expect(result.summary.p50).toBeLessThanOrEqual(1);
  expect(result.summary.p90).toBeGreaterThanOrEqual(0);
  expect(result.summary.p90).toBeLessThanOrEqual(1);
  
  // Percentiles should be ordered: p10 <= p50 <= p90
  expect(result.summary.p10).toBeLessThanOrEqual(result.summary.p50);
  expect(result.summary.p50).toBeLessThanOrEqual(result.summary.p90);
  
  // Min <= Mean <= Max
  expect(result.summary.min).toBeLessThanOrEqual(result.summary.mean);
  expect(result.summary.mean).toBeLessThanOrEqual(result.summary.max);
  
  // Stdev should be non-negative
  expect(result.summary.stdev).toBeGreaterThanOrEqual(0);
});

// Test 9: Probability calculation is correct
const testProbabilityCalculation = test('Probability meets threshold is calculated correctly', async () => {
  const { MonteCarloEngine } = await import('../MonteCarloEngine');
  
  const engine = new MonteCarloEngine();
  const extraction = createMockExtraction(0.75, true);
  
  const result = await engine.runWithMonteCarlo({
    extraction,
    budget: { maxRuns: 100 },
    thresholds: { confidenceThreshold: 0.7 },
  });
  
  // Manually verify probability calculation
  const meetsThreshold = result.samples.filter(s => s >= 0.7).length;
  const expectedProbability = meetsThreshold / result.samples.length;
  
  // Should be close (allowing for floating point)
  const diff = Math.abs(result.probabilityMeetsThreshold - expectedProbability);
  expect(diff).toBeLessThan(0.01);
});

// Test 10: Perturbation config is respected
const testPerturbationConfig = test('Perturbation configuration is respected', async () => {
  const { MonteCarloEngine } = await import('../MonteCarloEngine');
  
  const engine = new MonteCarloEngine();
  const extraction = createMockExtraction();
  
  // Run with custom perturbation config
  const result = await engine.runWithMonteCarlo({
    extraction,
    budget: { maxRuns: 50 },
    perturbation: {
      weightJitter: 0.2,
      sourceQualityJitter: 0.1,
    },
  });
  
  // Config should be recorded in provenance
  expect(result.provenance.perturbationConfig.weightJitter).toBe(0.2);
  expect(result.provenance.perturbationConfig.sourceQualityJitter).toBe(0.1);
  
  // Should have perturbation samples for debugging
  expect(result.provenance.perturbationSamples.length).toBeGreaterThan(0);
});

// Test 11: Seed produces reproducible results
const testSeedReproducibility = test('Seed produces reproducible results', async () => {
  const { MonteCarloEngine } = await import('../MonteCarloEngine');
  
  const engine = new MonteCarloEngine();
  const extraction = createMockExtraction();
  const seed = 12345;
  
  const result1 = await engine.runWithMonteCarlo({
    extraction,
    budget: { maxRuns: 20 },
    perturbation: { seed },
  });
  
  const result2 = await engine.runWithMonteCarlo({
    extraction,
    budget: { maxRuns: 20 },
    perturbation: { seed },
  });
  
  // Same seed should produce same samples
  expect(result1.samples.length).toBe(result2.samples.length);
  for (let i = 0; i < result1.samples.length; i++) {
    expect(Math.abs(result1.samples[i] - result2.samples[i])).toBeLessThan(0.0001);
  }
});

// Test 12: Quick escalation check works
const testQuickEscalationCheck = test('Quick escalation check works correctly', async () => {
  const { MonteCarloEngine } = await import('../MonteCarloEngine');
  
  const engine = new MonteCarloEngine();
  
  // High confidence - should not escalate
  const highConfidence = createMockExtraction(0.85, true);
  const result1 = engine.quickEscalationCheck(highConfidence);
  expect(result1.shouldEscalate).toBe(false);
  
  // Low confidence - should escalate
  const lowConfidence = createMockExtraction(0.2, false);
  const result2 = engine.quickEscalationCheck(lowConfidence);
  expect(result2.shouldEscalate).toBe(true);
});

// Test 13: Provenance contains all required info
const testProvenanceComplete = test('Provenance contains all required information', async () => {
  const { MonteCarloEngine } = await import('../MonteCarloEngine');
  
  const engine = new MonteCarloEngine();
  const extraction = createMockExtraction();
  
  const result = await engine.runWithMonteCarlo({
    extraction,
    budget: { maxRuns: 20 },
  });
  
  // Check provenance structure
  expect(result.provenance).toHaveProperty('runs');
  expect(result.provenance).toHaveProperty('budgetUsed');
  expect(result.provenance).toHaveProperty('perturbationConfig');
  expect(result.provenance).toHaveProperty('thresholds');
  expect(result.provenance).toHaveProperty('timing');
  
  // Timing should be valid
  expect(result.provenance.timing.durationMs).toBeGreaterThanOrEqual(0);
  
  // Budget usage should be tracked
  expect(result.provenance.budgetUsed.runsUsed).toBe(result.samples.length);
});

// Test 14: Cost budget is respected
const testCostBudget = test('Cost budget is respected', async () => {
  const { MonteCarloEngine } = await import('../MonteCarloEngine');
  
  const engine = new MonteCarloEngine();
  const extraction = createMockExtraction();
  
  // Very low cost budget
  const result = await engine.runWithMonteCarlo({
    extraction,
    budget: { maxRuns: 1000, maxCost: 10 },
  });
  
  // Should have stopped early due to cost
  expect(result.provenance.budgetUsed.costUsed).toBeLessThanOrEqual(10);
});

// ============================================
// TEST RUNNER
// ============================================

async function runTests() {
  console.log('\n🧪 Running MonteCarloEngine Tests (Step 4 Verification)...\n');
  console.log('='.repeat(60) + '\n');

  await testResultStructure();
  await testRunCountBudget();
  await testTimeBudget();
  await testDecisionStop();
  await testDecisionEscalate();
  await testDistributionOnAbort();
  await testNoBrowserImports();
  await testSummaryStatistics();
  await testProbabilityCalculation();
  await testPerturbationConfig();
  await testSeedReproducibility();
  await testQuickEscalationCheck();
  await testProvenanceComplete();
  await testCostBudget();

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
    console.log('\nStep 4 Requirements Verified:');
    console.log('  ✓ Honors budget caps (time/run count/cost)');
    console.log('  ✓ Decision logic matches thresholds');
    console.log('  ✓ Distribution present even when aborted');
    console.log('  ✓ No Playwright/browser invoked');
    console.log('  ✓ Summary statistics valid');
    console.log('  ✓ Reproducible with seed');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
