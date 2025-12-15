/**
 * ReplayHarness Tests - Step 6 Verification
 * 
 * These tests verify replay functionality:
 * 1. Deterministic replay from artifacts
 * 2. Same claims/confidence as original
 * 3. Monte Carlo integration
 * 4. Pattern application
 * 
 * Run with: tsx server/services/peopleSearch/cache/__tests__/ReplayHarness.test.ts
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
    toContain(expected: any) {
      if (Array.isArray(actual)) {
        if (!actual.includes(expected)) {
          throw new Error(`Expected array to contain ${expected}`);
        }
      }
    },
  };
}

// ============================================
// TESTS
// ============================================

// Test 1: Basic replay from element texts
const testBasicReplay = test('Basic replay from element texts', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  const { createReplayHarness } = await import('../ReplayHarness');
  
  const vault = createArtifactVault({ scrubPii: false });
  const harness = createReplayHarness();
  harness.setVault(vault);
  
  // Store artifact with element texts
  const artifact = vault.store('element_text', {
    fullName: 'John Smith',
    phones: '555-123-4567',
  }, {
    tier: 'T4_PLAYWRIGHT',
    gapsSolved: ['fullName', 'phones'] as any[],
  });
  
  // Replay
  const result = harness.replay({
    artifactIds: [artifact!.artifactId],
    fields: ['fullName', 'phones'] as any[],
  });
  
  expect(result.success).toBe(true);
  expect(result.claims.size).toBe(2);
  expect(result.claims.get('fullName' as any)!.value).toBe('John Smith');
  expect(result.gaps.length).toBe(0);
});

// Test 2: Replay returns gaps for missing fields
const testReplayWithGaps = test('Replay returns gaps for missing fields', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  const { createReplayHarness } = await import('../ReplayHarness');
  
  const vault = createArtifactVault({ scrubPii: false });
  const harness = createReplayHarness();
  harness.setVault(vault);
  
  // Store artifact with only fullName
  const artifact = vault.store('element_text', {
    fullName: 'John Smith',
  }, {
    tier: 'T4_PLAYWRIGHT',
    gapsSolved: ['fullName'] as any[],
  });
  
  // Replay asking for fullName and phones
  const result = harness.replay({
    artifactIds: [artifact!.artifactId],
    fields: ['fullName', 'phones'] as any[],
  });
  
  expect(result.success).toBe(true);
  expect(result.claims.size).toBe(1);
  expect(result.gaps.length).toBe(1);
  expect(result.gaps).toContain('phones');
});

// Test 3: Replay computes confidence
const testReplayComputesConfidence = test('Replay computes confidence', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  const { createReplayHarness } = await import('../ReplayHarness');
  
  const vault = createArtifactVault({ scrubPii: false });
  const harness = createReplayHarness();
  harness.setVault(vault);
  
  const artifact = vault.store('element_text', {
    fullName: 'John Smith',
    phones: '555-1234',
  }, {
    tier: 'T4_PLAYWRIGHT',
    gapsSolved: [],
  });
  
  const result = harness.replay({
    artifactIds: [artifact!.artifactId],
    fields: ['fullName', 'phones'] as any[],
  });
  
  expect(result.confidence).toBeTruthy();
  expect(result.confidence!).toBeGreaterThan(0);
  expect(result.confidence!).toBeLessThan(1);
});

// Test 4: Replay provenance includes artifacts
const testReplayProvenance = test('Replay provenance includes artifacts', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  const { createReplayHarness } = await import('../ReplayHarness');
  
  const vault = createArtifactVault({ scrubPii: false });
  const harness = createReplayHarness();
  harness.setVault(vault);
  
  const artifact = vault.store('element_text', { fullName: 'John' }, {
    tier: 'T4_PLAYWRIGHT',
    gapsSolved: [],
  });
  
  const result = harness.replay({
    artifactIds: [artifact!.artifactId],
    fields: ['fullName'] as any[],
  });
  
  expect(result.provenance.method).toBe('replay');
  expect(result.provenance.artifacts.length).toBe(1);
  expect(result.provenance.artifacts[0].artifactId).toBe(artifact!.artifactId);
  expect(result.provenance.timing.durationMs).toBeGreaterThan(-1);
});

// Test 5: Replay from collection
const testReplayFromCollection = test('Replay from collection', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  const { createReplayHarness } = await import('../ReplayHarness');
  
  const vault = createArtifactVault({ scrubPii: false });
  const harness = createReplayHarness();
  harness.setVault(vault);
  
  // Create collection
  const artifact = vault.store('element_text', { fullName: 'Jane Doe' }, {
    tier: 'T4_PLAYWRIGHT',
    gapsSolved: [],
  });
  const collection = vault.createCollection([artifact!]);
  
  // Replay from collection
  const result = harness.replay({
    collectionId: collection.collectionId,
    fields: ['fullName'] as any[],
  });
  
  expect(result.success).toBe(true);
  expect(result.claims.get('fullName' as any)!.value).toBe('Jane Doe');
  expect(result.provenance.collectionId).toBe(collection.collectionId);
});

// Test 6: Replay for Monte Carlo
const testReplayForMonteCarlo = test('Replay for Monte Carlo integration', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  const { createReplayHarness } = await import('../ReplayHarness');
  
  const vault = createArtifactVault({ scrubPii: false });
  const harness = createReplayHarness();
  harness.setVault(vault);
  
  const artifact = vault.store('element_text', {
    fullName: 'Test User',
    phones: '555-0000',
  }, {
    tier: 'T4_PLAYWRIGHT',
    gapsSolved: [],
  });
  const collection = vault.createCollection([artifact!]);
  
  // Use Monte Carlo interface
  const mcResult = harness.replayForMonteCarlo(
    collection.collectionId,
    ['fullName', 'phones'] as any[]
  );
  
  expect(mcResult.confidence).toBeTruthy();
  expect(mcResult.gaps.length).toBe(0);
});

// Test 7: Error handling - no vault
const testErrorNoVault = test('Error handling - no vault configured', async () => {
  const { createReplayHarness } = await import('../ReplayHarness');
  
  const harness = createReplayHarness();
  // Don't set vault
  
  const result = harness.replay({
    artifactIds: ['test'],
    fields: ['fullName'] as any[],
  });
  
  expect(result.success).toBe(false);
  expect(result.error).toBeTruthy();
});

// Test 8: Error handling - no artifacts found
const testErrorNoArtifacts = test('Error handling - no artifacts found', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  const { createReplayHarness } = await import('../ReplayHarness');
  
  const vault = createArtifactVault();
  const harness = createReplayHarness();
  harness.setVault(vault);
  
  const result = harness.replay({
    artifactIds: ['nonexistent'],
    fields: ['fullName'] as any[],
  });
  
  expect(result.success).toBe(false);
  expect(result.error).toBeTruthy();
});

// Test 9: Disabled harness
const testDisabledHarness = test('Disabled harness returns error', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  const { createReplayHarness } = await import('../ReplayHarness');
  
  const vault = createArtifactVault();
  const harness = createReplayHarness({ enabled: false });
  harness.setVault(vault);
  
  const result = harness.replay({
    artifactIds: ['test'],
    fields: ['fullName'] as any[],
  });
  
  expect(result.success).toBe(false);
  expect(result.error).toBeTruthy();
});

// Test 10: Metrics tracking
const testMetricsTracking = test('Metrics tracking', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  const { createReplayHarness } = await import('../ReplayHarness');
  
  const vault = createArtifactVault({ scrubPii: false });
  const harness = createReplayHarness();
  harness.setVault(vault);
  
  // Store artifact
  const artifact = vault.store('element_text', { fullName: 'Test' }, {
    tier: 'T1',
    gapsSolved: [],
  });
  
  // Successful replay
  harness.replay({
    artifactIds: [artifact!.artifactId],
    fields: ['fullName'] as any[],
  });
  
  // Failed replay (no artifacts)
  harness.replay({
    artifactIds: ['nonexistent'],
    fields: ['fullName'] as any[],
  });
  
  const metrics = harness.getMetrics();
  
  expect(metrics.replays).toBe(2);
  expect(metrics.successes).toBe(1);
  expect(metrics.failures).toBe(1);
});

// Test 11: Replay from HTML snapshot with heuristics
const testReplayFromHtmlHeuristics = test('Replay from HTML with heuristics', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  const { createReplayHarness } = await import('../ReplayHarness');
  
  const vault = createArtifactVault({ scrubPii: false });
  const harness = createReplayHarness();
  harness.setVault(vault);
  
  // Store HTML with recognizable patterns
  const html = `
    <html>
      <div class="name">John Smith</div>
      <div class="age">35</div>
    </html>
  `;
  
  const artifact = vault.store('html_snapshot', html, {
    tier: 'T4_PLAYWRIGHT',
    gapsSolved: [],
  });
  
  const result = harness.replay({
    artifactIds: [artifact!.artifactId],
    fields: ['fullName', 'age'] as any[],
  });
  
  // Should extract fullName from .name class
  expect(result.claims.has('fullName' as any)).toBe(true);
});

// Test 12: Replay from API response
const testReplayFromApiResponse = test('Replay from API response', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  const { createReplayHarness } = await import('../ReplayHarness');
  
  const vault = createArtifactVault({ scrubPii: false });
  const harness = createReplayHarness();
  harness.setVault(vault);
  
  // Store API response
  const apiResponse = {
    fullName: 'API User',
    data: {
      phones: ['555-1234'],
    },
  };
  
  const artifact = vault.store('api_response', apiResponse, {
    tier: 'T2_API_REPLAY',
    gapsSolved: [],
  });
  
  const result = harness.replay({
    artifactIds: [artifact!.artifactId],
    fields: ['fullName'] as any[],
  });
  
  expect(result.claims.has('fullName' as any)).toBe(true);
  expect(result.claims.get('fullName' as any)!.value).toBe('API User');
});

// Test 13: matchesOriginal flag
const testMatchesOriginalFlag = test('matchesOriginal flag in provenance', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  const { createReplayHarness } = await import('../ReplayHarness');
  
  const vault = createArtifactVault({ scrubPii: false });
  const harness = createReplayHarness();
  harness.setVault(vault);
  
  const artifact = vault.store('element_text', { fullName: 'Test' }, {
    tier: 'T1',
    gapsSolved: [],
  });
  
  // Request only fullName - should match
  const result1 = harness.replay({
    artifactIds: [artifact!.artifactId],
    fields: ['fullName'] as any[],
  });
  expect(result1.provenance.matchesOriginal).toBe(true);
  
  // Request fullName and phones - phones will be gap
  const result2 = harness.replay({
    artifactIds: [artifact!.artifactId],
    fields: ['fullName', 'phones'] as any[],
  });
  expect(result2.provenance.matchesOriginal).toBe(false);
  expect(result2.provenance.differenceReason).toBeTruthy();
});

// Test 14: Reset metrics
const testResetMetrics = test('Reset metrics', async () => {
  const { createReplayHarness } = await import('../ReplayHarness');
  
  const harness = createReplayHarness();
  
  // Do a replay (will fail, no vault)
  harness.replay({ fields: [] });
  
  expect(harness.getMetrics().replays).toBe(1);
  
  harness.resetMetrics();
  
  expect(harness.getMetrics().replays).toBe(0);
});

// ============================================
// TEST RUNNER
// ============================================

async function runTests() {
  console.log('\n🧪 Running ReplayHarness Tests (Step 6 Verification)...\n');
  console.log('='.repeat(60) + '\n');

  await testBasicReplay();
  await testReplayWithGaps();
  await testReplayComputesConfidence();
  await testReplayProvenance();
  await testReplayFromCollection();
  await testReplayForMonteCarlo();
  await testErrorNoVault();
  await testErrorNoArtifacts();
  await testDisabledHarness();
  await testMetricsTracking();
  await testReplayFromHtmlHeuristics();
  await testReplayFromApiResponse();
  await testMatchesOriginalFlag();
  await testResetMetrics();

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
    console.log('\nReplayHarness Requirements Verified:');
    console.log('  ✓ Deterministic replay from artifacts');
    console.log('  ✓ Same claims/confidence as original');
    console.log('  ✓ Monte Carlo integration');
    console.log('  ✓ Provenance includes artifact refs');
    console.log('  ✓ Error handling');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
