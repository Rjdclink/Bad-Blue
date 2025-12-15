/**
 * ArtifactVault Tests - Step 6 Verification
 * 
 * These tests verify artifact storage and retrieval:
 * 1. Artifact storage and retrieval
 * 2. PII scrubbing
 * 3. TTL-based expiration
 * 4. Storage limits and eviction
 * 5. Collections
 * 
 * Run with: tsx server/services/peopleSearch/cache/__tests__/ArtifactVault.test.ts
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
    toContain(expected: string) {
      if (typeof actual !== 'string' || !actual.includes(expected)) {
        throw new Error(`Expected string to contain "${expected}"`);
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
    toNotContain(expected: string) {
      if (typeof actual === 'string' && actual.includes(expected)) {
        throw new Error(`Expected string to NOT contain "${expected}"`);
      }
    },
  };
}

// ============================================
// TESTS
// ============================================

// Test 1: Artifact storage and retrieval
const testArtifactStorageRetrieval = test('Artifact storage and retrieval', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  
  const vault = createArtifactVault();
  
  const artifact = vault.store(
    'html_snapshot',
    '<html><body>Test</body></html>',
    {
      tier: 'T4_PLAYWRIGHT',
      gapsSolved: ['fullName' as any],
      url: 'https://example.com',
    }
  );
  
  expect(artifact).toBeTruthy();
  expect(artifact!.type).toBe('html_snapshot');
  expect(artifact!.sizeBytes).toBeGreaterThan(0);
  
  // Retrieve
  const retrieved = vault.retrieve(artifact!.artifactId);
  expect(retrieved).toBeTruthy();
  expect(retrieved!.data).toBe('<html><body>Test</body></html>');
});

// Test 2: PII scrubbing for SSN
const testPiiScrubbingSsn = test('PII scrubbing for SSN', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  
  const vault = createArtifactVault({ scrubPii: true });
  
  const htmlWithSsn = '<html>SSN: 123-45-6789</html>';
  const artifact = vault.store('html_snapshot', htmlWithSsn, {
    tier: 'T4_PLAYWRIGHT',
    gapsSolved: [],
  });
  
  expect(artifact).toBeTruthy();
  expect(artifact!.data as string).toContain('[REDACTED]');
  expect(artifact!.data as string).toNotContain('123-45-6789');
});

// Test 3: PII scrubbing for credit card
const testPiiScrubbingCreditCard = test('PII scrubbing for credit card', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  
  const vault = createArtifactVault({ scrubPii: true });
  
  const htmlWithCard = '<html>Card: 1234-5678-9012-3456</html>';
  const artifact = vault.store('html_snapshot', htmlWithCard, {
    tier: 'T4_PLAYWRIGHT',
    gapsSolved: [],
  });
  
  expect(artifact).toBeTruthy();
  expect(artifact!.data as string).toContain('[REDACTED]');
  expect(artifact!.data as string).toNotContain('1234-5678-9012-3456');
});

// Test 4: PII scrubbing for phone
const testPiiScrubbingPhone = test('PII scrubbing for phone', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  
  const vault = createArtifactVault({ scrubPii: true });
  
  const htmlWithPhone = '<html>Phone: 555-123-4567</html>';
  const artifact = vault.store('html_snapshot', htmlWithPhone, {
    tier: 'T4_PLAYWRIGHT',
    gapsSolved: [],
  });
  
  expect(artifact).toBeTruthy();
  expect(artifact!.data as string).toContain('[REDACTED]');
  expect(artifact!.data as string).toNotContain('555-123-4567');
});

// Test 5: TTL-based expiration
const testTtlExpiration = test('TTL-based expiration', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  
  const vault = createArtifactVault({ defaultTtlMs: 1 }); // 1ms TTL
  
  const artifact = vault.store('html_snapshot', 'test data', {
    tier: 'T1',
    gapsSolved: [],
  });
  
  // Wait for TTL to expire
  await new Promise(resolve => setTimeout(resolve, 10));
  
  // Should be expired
  const retrieved = vault.retrieve(artifact!.artifactId);
  expect(retrieved).toBeNull();
});

// Test 6: Storage limit eviction
const testStorageLimitEviction = test('Storage limit eviction', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  
  const vault = createArtifactVault({ 
    maxStorageBytes: 100,
    scrubPii: false,
  });
  
  // Store first artifact
  const artifact1 = vault.store('html_snapshot', 'A'.repeat(40), {
    tier: 'T1',
    gapsSolved: [],
  });
  
  // Store second artifact that triggers eviction
  vault.store('html_snapshot', 'B'.repeat(80), {
    tier: 'T1',
    gapsSolved: [],
  });
  
  // First artifact should be evicted
  const retrieved = vault.retrieve(artifact1!.artifactId);
  expect(retrieved).toBeNull();
});

// Test 7: Artifact collections
const testArtifactCollections = test('Artifact collections', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  
  const vault = createArtifactVault();
  
  // Store multiple artifacts
  const artifact1 = vault.store('html_snapshot', 'html data', {
    tier: 'T4_PLAYWRIGHT',
    gapsSolved: ['fullName' as any],
  });
  
  const artifact2 = vault.store('network_log', [{ url: 'test.com' }], {
    tier: 'T4_PLAYWRIGHT',
    gapsSolved: [],
  });
  
  // Create collection
  const collection = vault.createCollection(
    [artifact1!, artifact2!],
    { firstName: 'John', lastName: 'Smith' }
  );
  
  expect(collection.artifacts.length).toBe(2);
  expect(collection.searchContext?.firstName).toBe('John');
  
  // Retrieve collection
  const retrieved = vault.retrieveCollection(collection.collectionId);
  expect(retrieved.length).toBe(2);
});

// Test 8: Store Playwright artifacts helper
const testStorePlaywrightArtifacts = test('Store Playwright artifacts helper', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  
  const vault = createArtifactVault({ scrubPii: false });
  
  const collection = vault.storePlaywrightArtifacts(
    '<html>snapshot</html>',
    { fullName: 'John Smith', phone: '555-1234' },
    [{ url: 'http://test.com', method: 'GET' }],
    [{ type: 'log', message: 'test' }],
    {
      tier: 'T4_PLAYWRIGHT',
      gapsSolved: ['fullName' as any],
      url: 'http://test.com',
      searchContext: { firstName: 'John', lastName: 'Smith' },
    }
  );
  
  expect(collection.artifacts.length).toBe(4); // html, element_text, network, console
  expect(collection.totalSizeBytes).toBeGreaterThan(0);
});

// Test 9: Artifact handle creation
const testArtifactHandleCreation = test('Artifact handle creation', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  
  const vault = createArtifactVault();
  
  const artifact = vault.store('html_snapshot', 'test', {
    tier: 'T1',
    gapsSolved: [],
  });
  
  const handle = vault.createHandle(artifact!);
  
  expect(handle.artifactId).toBe(artifact!.artifactId);
  expect(handle.type).toBe('html_snapshot');
  expect(handle.sizeBytes).toBe(artifact!.sizeBytes);
});

// Test 10: Metrics tracking
const testMetricsTracking = test('Metrics tracking', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  
  const vault = createArtifactVault();
  
  // Store and retrieve
  const artifact = vault.store('html_snapshot', 'test', {
    tier: 'T1',
    gapsSolved: [],
  });
  vault.retrieve(artifact!.artifactId);
  vault.retrieve('nonexistent');
  
  const metrics = vault.getMetrics();
  
  expect(metrics.stores).toBe(1);
  expect(metrics.retrievals).toBe(2);
  expect(metrics.artifactCount).toBe(1);
  expect(metrics.totalSizeBytes).toBeGreaterThan(0);
});

// Test 11: Disabled vault returns null
const testDisabledVault = test('Disabled vault returns null', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  
  const vault = createArtifactVault({ enabled: false });
  
  const artifact = vault.store('html_snapshot', 'test', {
    tier: 'T1',
    gapsSolved: [],
  });
  
  expect(artifact).toBeNull();
});

// Test 12: Export and import
const testExportImport = test('Export and import', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  
  const vault1 = createArtifactVault();
  
  const artifact = vault1.store('html_snapshot', 'test data', {
    tier: 'T1',
    gapsSolved: [],
  });
  vault1.createCollection([artifact!]);
  
  // Export
  const exported = vault1.export();
  expect(exported.artifacts.length).toBe(1);
  expect(exported.collections.length).toBe(1);
  
  // Import into new vault
  const vault2 = createArtifactVault();
  vault2.import(exported);
  
  // Verify
  const retrieved = vault2.retrieve(artifact!.artifactId);
  expect(retrieved).toBeTruthy();
  expect(retrieved!.data).toBe('test data');
});

// Test 13: Clear all artifacts
const testClearArtifacts = test('Clear all artifacts', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  
  const vault = createArtifactVault();
  
  vault.store('html_snapshot', 'test', {
    tier: 'T1',
    gapsSolved: [],
  });
  
  vault.clear();
  
  const metrics = vault.getMetrics();
  expect(metrics.artifactCount).toBe(0);
  expect(metrics.totalSizeBytes).toBe(0);
});

// Test 14: Object data storage
const testObjectDataStorage = test('Object data storage', async () => {
  const { createArtifactVault } = await import('../ArtifactVault');
  
  const vault = createArtifactVault();
  
  const data = { name: 'John', phones: ['555-1234'] };
  const artifact = vault.store('extracted_data', data, {
    tier: 'T1',
    gapsSolved: ['fullName' as any],
  });
  
  expect(artifact).toBeTruthy();
  const retrieved = vault.retrieve(artifact!.artifactId);
  expect((retrieved!.data as any).name).toBe('John');
});

// ============================================
// TEST RUNNER
// ============================================

async function runTests() {
  console.log('\n🧪 Running ArtifactVault Tests (Step 6 Verification)...\n');
  console.log('='.repeat(60) + '\n');

  await testArtifactStorageRetrieval();
  await testPiiScrubbingSsn();
  await testPiiScrubbingCreditCard();
  await testPiiScrubbingPhone();
  await testTtlExpiration();
  await testStorageLimitEviction();
  await testArtifactCollections();
  await testStorePlaywrightArtifacts();
  await testArtifactHandleCreation();
  await testMetricsTracking();
  await testDisabledVault();
  await testExportImport();
  await testClearArtifacts();
  await testObjectDataStorage();

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
    console.log('\nArtifactVault Requirements Verified:');
    console.log('  ✓ Artifact storage and retrieval');
    console.log('  ✓ PII scrubbing (SSN, credit card, phone)');
    console.log('  ✓ TTL-based expiration');
    console.log('  ✓ Storage limit eviction');
    console.log('  ✓ Artifact collections');
    console.log('  ✓ Provenance handles');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
