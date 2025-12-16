/**
 * ExtractionLedger Tests - Step 3 Verification
 * 
 * These tests verify the Step 3 requirements:
 * 1. Every extraction emits ExtractionResult with claims, gaps, confidence, provenance
 * 2. Confidence is deterministic (same inputs = same outputs)
 * 3. Escalation requires named missing fields
 * 4. Gap ledger tracks all unresolved fields
 * 
 * Run with: tsx server/services/peopleSearch/router/__tests__/ExtractionLedger.test.ts
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
  };
}

// ============================================
// MOCK DATA HELPERS
// ============================================

import type { RouterResult, TierProvenance, RequiredField } from '../CapabilityRouter';
import { CapabilityTier } from '../CapabilityRouter';
import type { SearchQuery } from '../../types';

function createMockProvenance(tier: CapabilityTier = CapabilityTier.T1_FETCH_PARSE): TierProvenance {
  const now = new Date();
  return {
    tier,
    method: 'fetch',
    timing: {
      startedAt: new Date(now.getTime() - 100),
      completedAt: now,
      durationMs: 100,
    },
    retryCount: 0,
    costHint: 10,
  };
}

function createMockRouterResult(
  success: boolean = true,
  data: any = { fullName: 'John Smith' },
  gaps: any[] = []
): RouterResult {
  return {
    success,
    data,
    claims: ['Found name from fetch'],
    confidence: null, // Step 2 placeholder
    provenance: createMockProvenance(),
    gaps,
    tiersAttempted: [CapabilityTier.T1_FETCH_PARSE],
    higherTierMayHelp: gaps.length > 0,
  };
}

// ============================================
// TESTS
// ============================================

// Test 1: ExtractionResult has all required fields
const testExtractionResultStructure = test('ExtractionResult has all required fields', async () => {
  const { ExtractionLedger } = await import('../ExtractionLedger');
  
  const ledger = new ExtractionLedger();
  const query: SearchQuery = { firstName: 'John', lastName: 'Smith' };
  const requiredFields: RequiredField[] = ['fullName'];
  const routerResult = createMockRouterResult();
  
  const result = ledger.createExtractionResult(routerResult, query, requiredFields);
  
  // Check all required properties
  expect(result).toHaveProperty('extractionId');
  expect(result).toHaveProperty('query');
  expect(result).toHaveProperty('requiredFields');
  expect(result).toHaveProperty('claims');
  expect(result).toHaveProperty('gaps');
  expect(result).toHaveProperty('confidence');
  expect(result).toHaveProperty('confidenceBreakdown');
  expect(result).toHaveProperty('provenance');
  expect(result).toHaveProperty('complete');
  expect(result).toHaveProperty('timestamp');
  
  // Verify types
  expect(typeof result.extractionId).toBe('string');
  expect(typeof result.confidence).toBe('number');
  expect(result.confidence).toBeGreaterThanOrEqual(0);
  expect(result.confidence).toBeLessThanOrEqual(1);
});

// Test 2: Claims record maps fields correctly
const testClaimsRecord = test('Claims record maps extracted fields correctly', async () => {
  const { ExtractionLedger } = await import('../ExtractionLedger');
  
  const ledger = new ExtractionLedger();
  const query: SearchQuery = { firstName: 'John', lastName: 'Smith' };
  const requiredFields: RequiredField[] = ['fullName', 'age'];
  
  const routerResult = createMockRouterResult(true, {
    fullName: 'John Smith',
    age: 35,
  });
  
  const result = ledger.createExtractionResult(routerResult, query, requiredFields);
  
  // fullName claim should exist
  expect(result.claims.fullName).toBeDefined();
  expect(result.claims.fullName).toHaveProperty('value');
  expect(result.claims.fullName?.value).toBe('John Smith');
  
  // age claim should exist
  expect(result.claims.age).toBeDefined();
  expect(result.claims.age?.value).toBe(35);
});

// Test 3: Gap ledger tracks missing fields
const testGapLedger = test('Gap ledger tracks all missing fields', async () => {
  const { ExtractionLedger } = await import('../ExtractionLedger');
  
  const ledger = new ExtractionLedger();
  const query: SearchQuery = { firstName: 'John', lastName: 'Smith' };
  const requiredFields: RequiredField[] = ['fullName', 'phones', 'emails'];
  
  // Only fullName found
  const routerResult = createMockRouterResult(true, { fullName: 'John Smith' }, [
    { field: 'phones', reason: 'Not found', attemptedTiers: [CapabilityTier.T1_FETCH_PARSE] },
    { field: 'emails', reason: 'Not found', attemptedTiers: [CapabilityTier.T1_FETCH_PARSE] },
  ]);
  
  const result = ledger.createExtractionResult(routerResult, query, requiredFields);
  
  // Should have 2 gaps
  expect(result.gaps.entries).toHaveLength(2);
  
  // Gaps should have correct fields
  const gapFields = result.gaps.entries.map(g => g.field);
  expect(gapFields).toContain('phones');
  expect(gapFields).toContain('emails');
  
  // Each gap should have required properties
  for (const gap of result.gaps.entries) {
    expect(gap).toHaveProperty('field');
    expect(gap).toHaveProperty('reason');
    expect(gap).toHaveProperty('attemptedTiers');
    expect(gap).toHaveProperty('recordedAt');
    expect(gap).toHaveProperty('escalationCandidate');
  }
});

// Test 4: Deterministic confidence - same inputs = same outputs
const testDeterministicConfidence = test('Confidence is deterministic (same inputs = same outputs)', async () => {
  const { calculateDeterministicConfidence, ExtractionLedger } = await import('../ExtractionLedger');
  
  // Create identical claims
  const referenceTime = new Date('2025-01-01T12:00:00Z');
  const claims1 = {
    fullName: {
      value: 'John Smith',
      source: 'test',
      extractedAt: referenceTime,
      method: 'fetch',
      tier: CapabilityTier.T1_FETCH_PARSE,
      fieldConfidence: 0.8,
    },
    age: null,
    addresses: null,
    phones: null,
    emails: null,
    relatives: null,
    aliases: null,
  };
  
  // Exactly same claims
  const claims2 = { ...claims1 };
  
  const requiredFields: RequiredField[] = ['fullName', 'age'];
  
  // Calculate confidence twice with same inputs
  const result1 = calculateDeterministicConfidence(claims1, requiredFields, referenceTime);
  const result2 = calculateDeterministicConfidence(claims2, requiredFields, referenceTime);
  
  // Results should be identical
  expect(result1.finalScore).toBe(result2.finalScore);
  expect(result1.fieldCoverageScore).toBe(result2.fieldCoverageScore);
  expect(result1.sourceQualityScore).toBe(result2.sourceQualityScore);
  expect(result1.recencyScore).toBe(result2.recencyScore);
});

// Test 5: Escalation requires named fields
const testEscalationRequiresNamedFields = test('Escalation requires named missing fields', async () => {
  const { ExtractionLedger } = await import('../ExtractionLedger');
  
  const ledger = new ExtractionLedger();
  const query: SearchQuery = { firstName: 'John', lastName: 'Smith' };
  const requiredFields: RequiredField[] = ['fullName', 'phones'];
  
  // Create result with gaps
  const routerResult = createMockRouterResult(true, { fullName: 'John Smith' }, [
    { field: 'phones', reason: 'Not found', attemptedTiers: [CapabilityTier.T1_FETCH_PARSE] },
  ]);
  
  const result = ledger.createExtractionResult(routerResult, query, requiredFields);
  
  // Check escalation eligibility
  const escalation = ledger.canEscalate(result);
  
  expect(escalation.canEscalate).toBe(true);
  expect(escalation.requiredFields).toContain('phones');
  expect(escalation.requiredFields.length).toBeGreaterThan(0);
});

// Test 6: Complete extraction cannot escalate
const testCompleteCannotEscalate = test('Complete extraction cannot escalate', async () => {
  const { ExtractionLedger } = await import('../ExtractionLedger');
  
  const ledger = new ExtractionLedger();
  const query: SearchQuery = { firstName: 'John', lastName: 'Smith' };
  const requiredFields: RequiredField[] = ['fullName'];
  
  // Create complete result
  const routerResult = createMockRouterResult(true, { fullName: 'John Smith' }, []);
  
  const result = ledger.createExtractionResult(routerResult, query, requiredFields);
  
  // Should be complete
  expect(result.complete).toBe(true);
  
  // Should not be able to escalate
  const escalation = ledger.canEscalate(result);
  expect(escalation.canEscalate).toBe(false);
});

// Test 7: Provenance has full audit trail
const testProvenanceAuditTrail = test('Provenance has full audit trail', async () => {
  const { ExtractionLedger } = await import('../ExtractionLedger');
  
  const ledger = new ExtractionLedger();
  const query: SearchQuery = { firstName: 'John', lastName: 'Smith' };
  const requiredFields: RequiredField[] = ['fullName'];
  const routerResult = createMockRouterResult();
  
  const result = ledger.createExtractionResult(routerResult, query, requiredFields);
  
  // Check provenance fields
  expect(result.provenance).toHaveProperty('extractionId');
  expect(result.provenance).toHaveProperty('startedAt');
  expect(result.provenance).toHaveProperty('completedAt');
  expect(result.provenance).toHaveProperty('durationMs');
  expect(result.provenance).toHaveProperty('tiersAttempted');
  expect(result.provenance).toHaveProperty('primaryTier');
  expect(result.provenance).toHaveProperty('totalCostHint');
  expect(result.provenance).toHaveProperty('finalReason');
  
  // Duration should be non-negative
  expect(result.provenance.durationMs).toBeGreaterThanOrEqual(0);
  
  // Tiers attempted should match router result
  expect(result.provenance.tiersAttempted).toContain(CapabilityTier.T1_FETCH_PARSE);
});

// Test 8: Confidence breakdown is transparent
const testConfidenceBreakdown = test('Confidence breakdown is transparent and explainable', async () => {
  const { ExtractionLedger } = await import('../ExtractionLedger');
  
  const ledger = new ExtractionLedger();
  const query: SearchQuery = { firstName: 'John', lastName: 'Smith' };
  const requiredFields: RequiredField[] = ['fullName', 'age'];
  
  const routerResult = createMockRouterResult(true, { fullName: 'John Smith' }, []);
  
  const result = ledger.createExtractionResult(routerResult, query, requiredFields);
  
  // Check breakdown structure
  expect(result.confidenceBreakdown).toHaveProperty('fieldCoverageScore');
  expect(result.confidenceBreakdown).toHaveProperty('sourceQualityScore');
  expect(result.confidenceBreakdown).toHaveProperty('recencyScore');
  expect(result.confidenceBreakdown).toHaveProperty('finalScore');
  expect(result.confidenceBreakdown).toHaveProperty('explanation');
  
  // All scores should be 0-1
  expect(result.confidenceBreakdown.fieldCoverageScore).toBeGreaterThanOrEqual(0);
  expect(result.confidenceBreakdown.fieldCoverageScore).toBeLessThanOrEqual(1);
  expect(result.confidenceBreakdown.sourceQualityScore).toBeGreaterThanOrEqual(0);
  expect(result.confidenceBreakdown.sourceQualityScore).toBeLessThanOrEqual(1);
  expect(result.confidenceBreakdown.recencyScore).toBeGreaterThanOrEqual(0);
  expect(result.confidenceBreakdown.recencyScore).toBeLessThanOrEqual(1);
  
  // Explanation should be non-empty
  expect(result.confidenceBreakdown.explanation.length).toBeGreaterThan(0);
});

// Test 9: Field coverage affects confidence
const testFieldCoverageAffectsConfidence = test('Field coverage affects confidence score', async () => {
  const { ExtractionLedger } = await import('../ExtractionLedger');
  
  const ledger = new ExtractionLedger();
  const query: SearchQuery = { firstName: 'John', lastName: 'Smith' };
  
  // Result with 1/2 fields
  const partialResult = createMockRouterResult(true, { fullName: 'John Smith' }, []);
  const partial = ledger.createExtractionResult(partialResult, query, ['fullName', 'age']);
  
  // Result with 2/2 fields
  const fullResult = createMockRouterResult(true, { fullName: 'John Smith', age: 35 }, []);
  const full = ledger.createExtractionResult(fullResult, query, ['fullName', 'age']);
  
  // Full coverage should have higher confidence
  expect(full.confidence).toBeGreaterThan(partial.confidence);
});

// Test 10: Source quality affects confidence
const testSourceQualityAffectsConfidence = test('Source quality affects confidence score', async () => {
  const { SOURCE_QUALITY_SCORES } = await import('../ExtractionLedger');
  
  // API should have higher quality than cache
  expect(SOURCE_QUALITY_SCORES['api']).toBeGreaterThan(SOURCE_QUALITY_SCORES['cache']);
  
  // All sources should have scores between 0 and 1
  for (const [source, score] of Object.entries(SOURCE_QUALITY_SCORES)) {
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  }
});

// Test 11: Merge extraction results works
const testMergeResults = test('Merge extraction results combines data correctly', async () => {
  const { ExtractionLedger } = await import('../ExtractionLedger');
  
  const ledger = new ExtractionLedger();
  const query: SearchQuery = { firstName: 'John', lastName: 'Smith' };
  const requiredFields: RequiredField[] = ['fullName', 'age'];
  
  // Create two partial results
  const result1 = ledger.createExtractionResult(
    createMockRouterResult(true, { fullName: 'John Smith' }, []),
    query,
    requiredFields
  );
  
  const result2 = ledger.createExtractionResult(
    createMockRouterResult(true, { age: 35 }, []),
    query,
    requiredFields
  );
  
  // Merge them
  const merged = ledger.mergeExtractionResults([result1, result2], query, requiredFields);
  
  // Merged should have both fields
  expect(merged.claims.fullName).toBeDefined();
  expect(merged.claims.age).toBeDefined();
  
  // Should have higher confidence than either individual result
  expect(merged.confidence).toBeGreaterThanOrEqual(result1.confidence);
  expect(merged.confidence).toBeGreaterThanOrEqual(result2.confidence);
});

// Test 12: Gap summary is human-readable
const testGapSummary = test('Gap summary is human-readable', async () => {
  const { ExtractionLedger } = await import('../ExtractionLedger');
  
  const ledger = new ExtractionLedger();
  const query: SearchQuery = { firstName: 'John', lastName: 'Smith' };
  const requiredFields: RequiredField[] = ['fullName', 'phones', 'emails'];
  
  const routerResult = createMockRouterResult(true, { fullName: 'John Smith' }, [
    { field: 'phones', reason: 'Not found', attemptedTiers: [CapabilityTier.T1_FETCH_PARSE] },
    { field: 'emails', reason: 'Not found', attemptedTiers: [CapabilityTier.T1_FETCH_PARSE] },
  ]);
  
  const result = ledger.createExtractionResult(routerResult, query, requiredFields);
  
  // Summary should mention missing fields
  expect(result.gaps.summary).toContain('phones');
  expect(result.gaps.summary).toContain('emails');
});

// Test 13: Extraction ID is unique
const testUniqueExtractionId = test('Extraction IDs are unique', async () => {
  const { ExtractionLedger } = await import('../ExtractionLedger');
  
  const ledger = new ExtractionLedger();
  const query: SearchQuery = { firstName: 'John', lastName: 'Smith' };
  const requiredFields: RequiredField[] = ['fullName'];
  const routerResult = createMockRouterResult();
  
  const result1 = ledger.createExtractionResult(routerResult, query, requiredFields);
  const result2 = ledger.createExtractionResult(routerResult, query, requiredFields);
  
  // IDs should be different
  expect(result1.extractionId === result2.extractionId).toBeFalsy();
  
  // IDs should start with expected prefix
  expect(result1.extractionId.startsWith('ext_')).toBeTruthy();
  expect(result2.extractionId.startsWith('ext_')).toBeTruthy();
});

// Test 14: Empty result handling
const testEmptyResultHandling = test('Empty result is handled gracefully', async () => {
  const { ExtractionLedger } = await import('../ExtractionLedger');
  
  const ledger = new ExtractionLedger();
  const query: SearchQuery = { firstName: 'John', lastName: 'Smith' };
  const requiredFields: RequiredField[] = ['fullName', 'phones'];
  
  // Router returned nothing
  const routerResult = createMockRouterResult(false, null, [
    { field: 'fullName', reason: 'Not found', attemptedTiers: [] },
    { field: 'phones', reason: 'Not found', attemptedTiers: [] },
  ]);
  
  const result = ledger.createExtractionResult(routerResult, query, requiredFields);
  
  // Should still have valid structure
  expect(result.extractionId).toBeDefined();
  expect(result.confidence).toBe(0);
  expect(result.complete).toBe(false);
  expect(result.gaps.entries.length).toBe(2);
});

// ============================================
// TEST RUNNER
// ============================================

async function runTests() {
  console.log('\n🧪 Running ExtractionLedger Tests (Step 3 Verification)...\n');
  console.log('='.repeat(60) + '\n');

  // Run all tests
  await testExtractionResultStructure();
  await testClaimsRecord();
  await testGapLedger();
  await testDeterministicConfidence();
  await testEscalationRequiresNamedFields();
  await testCompleteCannotEscalate();
  await testProvenanceAuditTrail();
  await testConfidenceBreakdown();
  await testFieldCoverageAffectsConfidence();
  await testSourceQualityAffectsConfidence();
  await testMergeResults();
  await testGapSummary();
  await testUniqueExtractionId();
  await testEmptyResultHandling();

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
    console.log('\nStep 3 Requirements Verified:');
    console.log('  ✓ ExtractionResult has claims, gaps, confidence, provenance');
    console.log('  ✓ Confidence is deterministic (same inputs = same outputs)');
    console.log('  ✓ Escalation requires named missing fields');
    console.log('  ✓ Gap ledger tracks all unresolved fields');
    console.log('  ✓ Confidence breakdown is transparent');
    console.log('  ✓ Provenance has full audit trail');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
