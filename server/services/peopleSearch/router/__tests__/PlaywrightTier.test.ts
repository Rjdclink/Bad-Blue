/**
 * PlaywrightTier Tests - Step 5 Verification
 * 
 * These tests verify the Step 5 requirements:
 * 1. No Playwright call when no gaps or when Playwright disabled/misconfigured
 * 2. Playwright invoked only for named gaps and returns artifacts
 * 3. Fail-soft behavior when Playwright is unavailable (startup still clean)
 * 
 * Run with: tsx server/services/peopleSearch/router/__tests__/PlaywrightTier.test.ts
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
// MOCK DATA
// ============================================

import type { GapLedger, GapEntry } from '../ExtractionLedger';
import { CapabilityTier } from '../CapabilityRouter';

function createMockGapLedger(gaps: GapEntry[]): GapLedger {
  return {
    entries: gaps,
    escalationRequired: gaps.filter(g => g.escalationCandidate).map(g => g.field),
    summary: gaps.length > 0 
      ? `Missing fields: [${gaps.map(g => g.field).join(', ')}]`
      : 'All required fields satisfied',
  };
}

function createMockGapEntry(
  field: string,
  escalationCandidate: boolean = true
): GapEntry {
  return {
    field: field as any,
    reason: `Field ${field} not found`,
    attemptedTiers: [CapabilityTier.T1_FETCH_PARSE],
    recordedAt: new Date(),
    escalationCandidate,
  };
}

// ============================================
// TESTS
// ============================================

// Test 1: No Playwright call when no gaps
const testNoCallWhenNoGaps = test('No Playwright call when no gaps', async () => {
  const { PlaywrightProvider } = await import('../PlaywrightTier');
  
  const provider = new PlaywrightProvider({
    enabled: true,
    supportedFields: ['fullName', 'phones'],
    sources: [{ name: 'test', urlPattern: 'http://test', fields: ['fullName'], selectors: {} }],
  });
  
  // Empty gap ledger
  const gapLedger = createMockGapLedger([]);
  
  const decision = provider.canResolveGaps(gapLedger);
  
  expect(decision.shouldInvoke).toBe(false);
  expect(decision.reason).toContain('No gaps');
});

// Test 2: No Playwright call when disabled
const testNoCallWhenDisabled = test('No Playwright call when disabled in config', async () => {
  const { PlaywrightProvider, checkPlaywrightAvailability } = await import('../PlaywrightTier');
  
  // Playwright explicitly disabled
  const availability = checkPlaywrightAvailability({ enabled: false });
  
  expect(availability.available).toBe(false);
  expect(availability.reason).toContain('not enabled');
  
  const provider = new PlaywrightProvider({ enabled: false });
  const gapLedger = createMockGapLedger([createMockGapEntry('phones')]);
  
  const decision = provider.canResolveGaps(gapLedger);
  expect(decision.shouldInvoke).toBe(false);
});

// Test 3: No Playwright call when misconfigured (no sources)
const testNoCallWhenNoSources = test('No Playwright call when misconfigured (no sources)', async () => {
  const { PlaywrightProvider, checkPlaywrightAvailability } = await import('../PlaywrightTier');
  
  // Enabled but no sources
  const availability = checkPlaywrightAvailability({ enabled: true, sources: [] });
  
  expect(availability.available).toBe(false);
  expect(availability.reason).toContain('No Playwright data sources');
});

// Test 4: Playwright invoked only for named gaps
const testInvokedOnlyForNamedGaps = test('Playwright invoked only for named gaps', async () => {
  const { shouldInvokePlaywright } = await import('../PlaywrightTier');
  
  const config = {
    enabled: true,
    supportedFields: ['fullName', 'phones', 'emails'] as any[],
    sources: [{
      name: 'test',
      urlPattern: 'http://test/{firstName}/{lastName}',
      fields: ['fullName', 'phones'] as any[],
      selectors: { fullName: '.name', phones: '.phone' },
    }],
  };
  
  // Gap ledger with specific named gaps
  const gapLedger = createMockGapLedger([
    createMockGapEntry('phones', true),
    createMockGapEntry('emails', true),
  ]);
  
  const decision = shouldInvokePlaywright(gapLedger, config as any);
  
  expect(decision.shouldInvoke).toBe(true);
  // targetGaps should include phones (supported) and emails (supported)
  // Both are in supportedFields
  expect(decision.targetGaps.length).toBeGreaterThan(0);
  expect(decision.targetGaps.includes('phones' as any)).toBe(true);
  expect(decision.matchedSources.length).toBeGreaterThan(0);
});

// Test 5: No invocation for non-escalation gaps
const testNoInvocationForNonEscalationGaps = test('No invocation for non-escalation gaps', async () => {
  const { shouldInvokePlaywright } = await import('../PlaywrightTier');
  
  const config = {
    enabled: true,
    supportedFields: ['fullName', 'phones'] as any[],
    sources: [{
      name: 'test',
      urlPattern: 'http://test',
      fields: ['fullName'] as any[],
      selectors: {},
    }],
  };
  
  // Gap NOT marked as escalation candidate
  const gapLedger = createMockGapLedger([
    createMockGapEntry('fullName', false), // escalationCandidate = false
  ]);
  
  const decision = shouldInvokePlaywright(gapLedger, config as any);
  
  expect(decision.shouldInvoke).toBe(false);
  expect(decision.reason).toContain('No gaps marked as escalation candidates');
});

// Test 6: Fail-soft when Playwright unavailable
const testFailSoftWhenUnavailable = test('Fail-soft when Playwright unavailable', async () => {
  const { PlaywrightProvider } = await import('../PlaywrightTier');
  
  const provider = new PlaywrightProvider({
    enabled: true,
    supportedFields: ['phones'] as any[],
    sources: [{
      name: 'test',
      urlPattern: 'http://test',
      fields: ['phones'] as any[],
      selectors: { phones: '.phone' },
    }],
  });
  
  const gapLedger = createMockGapLedger([createMockGapEntry('phones')]);
  
  // Execute should NOT throw even if Playwright not installed
  const result = await provider.execute(
    { firstName: 'John', lastName: 'Smith' },
    gapLedger,
    ['phones']
  );
  
  // Should return structured result, not throw
  expect(result).toBeDefined();
  expect(result).toHaveProperty('success');
  expect(result).toHaveProperty('available');
  expect(result).toHaveProperty('provenance');
  
  // If Playwright not installed, should indicate unavailable
  if (!result.available) {
    expect(result.unavailableReason).toBeDefined();
  }
});

// Test 7: Result structure is correct
const testResultStructure = test('Result structure is correct', async () => {
  const { PlaywrightProvider } = await import('../PlaywrightTier');
  
  const provider = new PlaywrightProvider({ enabled: false });
  const gapLedger = createMockGapLedger([createMockGapEntry('phones')]);
  
  const result = await provider.execute(
    { firstName: 'John', lastName: 'Smith' },
    gapLedger,
    ['phones']
  );
  
  // Check all required properties
  expect(result).toHaveProperty('success');
  expect(result).toHaveProperty('available');
  expect(result).toHaveProperty('data');
  expect(result).toHaveProperty('claims');
  expect(result).toHaveProperty('satisfiedFields');
  expect(result).toHaveProperty('unsatisfiedFields');
  expect(result).toHaveProperty('artifacts');
  expect(result).toHaveProperty('updatedGaps');
  expect(result).toHaveProperty('provenance');
  
  // Check provenance structure
  expect(result.provenance).toHaveProperty('tier');
  expect(result.provenance).toHaveProperty('method');
  expect(result.provenance).toHaveProperty('timing');
  expect(result.provenance).toHaveProperty('wasInvoked');
  expect(result.provenance).toHaveProperty('invocationReason');
});

// Test 8: No side effects on import
const testNoSideEffectsOnImport = test('No side effects on module import', async () => {
  // Simply importing should not cause any side effects
  const startTime = Date.now();
  
  const module = await import('../PlaywrightTier');
  
  const importTime = Date.now() - startTime;
  
  // Import should be fast (no browser launch)
  expect(importTime).toBeLessThan(1000);
  
  // Module should export expected items
  expect(module.PlaywrightProvider).toBeDefined();
  expect(module.checkPlaywrightAvailability).toBeDefined();
  expect(module.shouldInvokePlaywright).toBeDefined();
  expect(module.PLAYWRIGHT_TIER).toBeDefined();
  expect(module.DEFAULT_PLAYWRIGHT_CONFIG).toBeDefined();
});

// Test 9: Provenance tracks invocation correctly
const testProvenanceTracking = test('Provenance tracks invocation correctly', async () => {
  const { PlaywrightProvider } = await import('../PlaywrightTier');
  
  // Provider with disabled config
  const provider = new PlaywrightProvider({ enabled: false });
  const gapLedger = createMockGapLedger([createMockGapEntry('phones')]);
  
  const result = await provider.execute(
    { firstName: 'John', lastName: 'Smith' },
    gapLedger,
    ['phones']
  );
  
  // Provenance should indicate not invoked
  expect(result.provenance.wasInvoked).toBe(false);
  expect(result.provenance.costHint).toBe(0); // No cost if not invoked
  expect(result.provenance.timing.durationMs).toBeDefined();
});

// Test 10: Supported fields filtering works
const testSupportedFieldsFiltering = test('Supported fields filtering works', async () => {
  const { shouldInvokePlaywright } = await import('../PlaywrightTier');
  
  const config = {
    enabled: true,
    supportedFields: ['fullName'] as any[], // Only supports fullName
    sources: [{
      name: 'test',
      urlPattern: 'http://test',
      fields: ['fullName'] as any[],
      selectors: {},
    }],
  };
  
  // Gap for unsupported field
  const gapLedger = createMockGapLedger([
    createMockGapEntry('phones', true), // phones not supported
  ]);
  
  const decision = shouldInvokePlaywright(gapLedger, config as any);
  
  expect(decision.shouldInvoke).toBe(false);
  expect(decision.reason).toContain('does not support');
});

// Test 11: Default config is safe
const testDefaultConfigSafe = test('Default config is safe (Playwright disabled)', async () => {
  const { DEFAULT_PLAYWRIGHT_CONFIG, checkPlaywrightAvailability } = await import('../PlaywrightTier');
  
  // Default should have Playwright disabled
  expect(DEFAULT_PLAYWRIGHT_CONFIG.enabled).toBe(false);
  
  // Checking with defaults should be unavailable
  const availability = checkPlaywrightAvailability();
  expect(availability.available).toBe(false);
});

// Test 12: Multiple sources are matched correctly
const testMultipleSourcesMatching = test('Multiple sources are matched correctly', async () => {
  const { shouldInvokePlaywright } = await import('../PlaywrightTier');
  
  const config = {
    enabled: true,
    supportedFields: ['fullName', 'phones', 'emails'] as any[],
    sources: [
      {
        name: 'source1',
        urlPattern: 'http://source1',
        fields: ['fullName'] as any[],
        selectors: {},
      },
      {
        name: 'source2',
        urlPattern: 'http://source2',
        fields: ['phones', 'emails'] as any[],
        selectors: {},
      },
    ],
  };
  
  const gapLedger = createMockGapLedger([
    createMockGapEntry('fullName', true),
    createMockGapEntry('phones', true),
  ]);
  
  const decision = shouldInvokePlaywright(gapLedger, config as any);
  
  expect(decision.shouldInvoke).toBe(true);
  expect(decision.matchedSources.length).toBe(2);
  expect(decision.targetGaps.includes('fullName' as any)).toBe(true);
  expect(decision.targetGaps.includes('phones' as any)).toBe(true);
});

// Test 13: Gaps are updated after execution
const testGapsUpdatedAfterExecution = test('Gaps are updated after execution', async () => {
  const { PlaywrightProvider } = await import('../PlaywrightTier');
  
  const provider = new PlaywrightProvider({ enabled: false });
  const gapLedger = createMockGapLedger([
    createMockGapEntry('phones'),
    createMockGapEntry('emails'),
  ]);
  
  const result = await provider.execute(
    { firstName: 'John', lastName: 'Smith' },
    gapLedger,
    ['phones', 'emails']
  );
  
  // Updated gaps should be returned
  expect(result.updatedGaps).toBeDefined();
  expect(result.updatedGaps.length).toBe(2);
});

// Test 14: Cleanup method exists
const testCleanupExists = test('Cleanup method exists and runs without error', async () => {
  const { PlaywrightProvider } = await import('../PlaywrightTier');
  
  const provider = new PlaywrightProvider();
  
  // Cleanup should not throw
  await provider.cleanup();
});

// ============================================
// TEST RUNNER
// ============================================

async function runTests() {
  console.log('\n🧪 Running PlaywrightTier Tests (Step 5 Verification)...\n');
  console.log('='.repeat(60) + '\n');

  await testNoCallWhenNoGaps();
  await testNoCallWhenDisabled();
  await testNoCallWhenNoSources();
  await testInvokedOnlyForNamedGaps();
  await testNoInvocationForNonEscalationGaps();
  await testFailSoftWhenUnavailable();
  await testResultStructure();
  await testNoSideEffectsOnImport();
  await testProvenanceTracking();
  await testSupportedFieldsFiltering();
  await testDefaultConfigSafe();
  await testMultipleSourcesMatching();
  await testGapsUpdatedAfterExecution();
  await testCleanupExists();

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
    console.log('\nStep 5 Requirements Verified:');
    console.log('  ✓ No Playwright call when no gaps');
    console.log('  ✓ No Playwright call when disabled/misconfigured');
    console.log('  ✓ Playwright invoked only for named gaps');
    console.log('  ✓ Fail-soft when Playwright unavailable');
    console.log('  ✓ No side effects on module import');
    console.log('  ✓ Result structure includes artifacts');
    console.log('  ✓ Default config has Playwright disabled');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
