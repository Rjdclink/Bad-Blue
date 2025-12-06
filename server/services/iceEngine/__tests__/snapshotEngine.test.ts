import { snapshotEngine } from '../core/SnapshotEngine';

export interface TestResult {
  testName: string;
  passed: boolean;
  details: string;
  duration: number;
}

export class SnapshotEngineTestSuite {
  private results: TestResult[] = [];

  async testCreateSnapshot(): Promise<TestResult> {
    const start = Date.now();
    try {
      const url = 'https://example.com/test';
      const content = '<html><body>Test content</body></html>';
      const metadata = {
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        contentType: 'text/html',
      };

      const snapshot = await snapshotEngine.createSnapshot(url, content, metadata);
      
      const passed = 
        snapshot.url === url &&
        snapshot.hash.length === 64 && // SHA-256 produces 64 hex chars
        snapshot.content.length > 0 && // Compressed content exists
        snapshot.metadata.statusCode === 200;

      return {
        testName: 'should create and compress snapshot',
        passed,
        details: passed
          ? `Created snapshot with hash: ${snapshot.hash.substring(0, 8)}..., compressed size: ${snapshot.content.length}`
          : 'Failed to create valid snapshot',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should create and compress snapshot',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testDetectChanges(): Promise<TestResult> {
    const start = Date.now();
    try {
      const url = 'https://example.com/change-test';
      const content1 = '<html><body>Original content</body></html>';
      const content2 = '<html><body>Modified content</body></html>';
      
      const metadata = {
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        contentType: 'text/html',
      };

      // Create initial snapshot
      await snapshotEngine.createSnapshot(url, content1, metadata);
      
      // Detect no change with same content
      const diff1 = await snapshotEngine.detectChanges(url, content1);
      
      // Detect change with different content
      const diff2 = await snapshotEngine.detectChanges(url, content2);
      
      const passed = !diff1.changed && diff2.changed;

      return {
        testName: 'should detect content changes',
        passed,
        details: passed
          ? `Correctly detected: no change=${!diff1.changed}, change=${diff2.changed}`
          : `Failed: no change=${!diff1.changed}, change=${diff2.changed}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should detect content changes',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testGetSnapshot(): Promise<TestResult> {
    const start = Date.now();
    try {
      const url = 'https://example.com/get-test';
      const originalContent = '<html><body>Test retrieval</body></html>';
      const metadata = {
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        contentType: 'text/html',
      };

      await snapshotEngine.createSnapshot(url, originalContent, metadata);
      const retrieved = await snapshotEngine.getSnapshot(url);
      
      const passed = retrieved === originalContent;

      return {
        testName: 'should retrieve and decompress snapshot',
        passed,
        details: passed
          ? 'Content retrieved and decompressed correctly'
          : `Content mismatch: expected ${originalContent.length} bytes, got ${retrieved?.length || 0}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should retrieve and decompress snapshot',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testClearOldSnapshots(): Promise<TestResult> {
    const start = Date.now();
    try {
      const url = 'https://example.com/cleanup-test';
      const content = '<html><body>Cleanup test</body></html>';
      const metadata = {
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        contentType: 'text/html',
      };

      await snapshotEngine.createSnapshot(url, content, metadata);
      const initialStats = snapshotEngine.getStats();
      
      // Clear snapshots older than 1 day (should not delete recent ones)
      const deleted = snapshotEngine.clearOldSnapshots(1);
      const afterStats = snapshotEngine.getStats();
      
      const passed = deleted === 0 && afterStats.totalSnapshots === initialStats.totalSnapshots;

      return {
        testName: 'should not delete fresh snapshots',
        passed,
        details: passed
          ? `Correctly preserved ${initialStats.totalSnapshots} fresh snapshot(s)`
          : `Incorrectly deleted ${deleted} snapshot(s), before: ${initialStats.totalSnapshots}, after: ${afterStats.totalSnapshots}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should not delete fresh snapshots',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testGetStats(): Promise<TestResult> {
    const start = Date.now();
    try {
      const stats = snapshotEngine.getStats();
      
      const passed = 
        typeof stats.totalSnapshots === 'number' &&
        typeof stats.totalSize === 'number' &&
        stats.totalSnapshots >= 0 &&
        stats.totalSize >= 0;

      return {
        testName: 'should return valid statistics',
        passed,
        details: passed
          ? `Stats: ${stats.totalSnapshots} snapshots, ${stats.totalSize} bytes`
          : 'Invalid statistics format',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should return valid statistics',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async runAllTests(): Promise<TestResult[]> {
    console.log('\n=== SnapshotEngine Test Suite ===\n');

    const tests = [
      this.testCreateSnapshot(),
      this.testDetectChanges(),
      this.testGetSnapshot(),
      this.testClearOldSnapshots(),
      this.testGetStats(),
    ];

    const results = await Promise.all(tests);
    this.results = results;

    // Print results
    results.forEach((result) => {
      const status = result.passed ? '✓' : '✗';
      console.log(`${status} ${result.testName} (${result.duration}ms)`);
      if (!result.passed) {
        console.log(`  Details: ${result.details}`);
      }
    });

    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    console.log(`\nResults: ${passed}/${total} passed\n`);

    return results;
  }
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const suite = new SnapshotEngineTestSuite();
  suite.runAllTests().then((results) => {
    const allPassed = results.every(r => r.passed);
    process.exit(allPassed ? 0 : 1);
  });
}
