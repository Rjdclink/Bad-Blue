import { PantheonCore, DEFAULT_CONFIG, CrawlerType, CrawlerTask, EntropySignature } from '../core';
import { BaseCrawler } from '../baseCrawler';

/**
 * Test implementation of BaseCrawler for testing purposes
 */
class TestCrawler extends BaseCrawler {
  async execute(): Promise<EntropySignature[]> {
    // Generate a simple entropy signature for testing
    const signature = this.generateEntropySignature({
      test: 'data',
      value: Math.random(),
      nested: { a: 1, b: 2 }
    });
    return [signature];
  }
}

export interface TestResult {
  testName: string;
  passed: boolean;
  details: string;
  duration: number;
}

export class PantheonCoreTestSuite {
  /**
   * Test PantheonCore initialization
   */
  async testCoreInitialization(): Promise<TestResult> {
    const start = Date.now();
    try {
      const core = new PantheonCore(DEFAULT_CONFIG);
      await core.initialize();
      
      const isActive = core.isActive();
      const queueSize = core.getQueueSize();
      
      core.shutdown();
      
      if (queueSize !== 0) {
        return {
          testName: 'Core initialization',
          passed: false,
          details: `Expected queue size 0, got ${queueSize}`,
          duration: Date.now() - start
        };
      }
      
      return {
        testName: 'Core initialization',
        passed: true,
        details: 'Core initialized successfully',
        duration: Date.now() - start
      };
    } catch (error) {
      return {
        testName: 'Core initialization',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start
      };
    }
  }

  /**
   * Test task queue functionality
   */
  async testTaskQueue(): Promise<TestResult> {
    const start = Date.now();
    try {
      const core = new PantheonCore(DEFAULT_CONFIG);
      await core.initialize();
      
      const task1: CrawlerTask = {
        id: 'task1',
        type: CrawlerType.WRAITH,
        target: 'http://example.com',
        priority: 5,
        quantum: 100,
        entropyBudget: 10
      };
      
      const task2: CrawlerTask = {
        id: 'task2',
        type: CrawlerType.HYDRA,
        target: 'http://example2.com',
        priority: 10,
        quantum: 100,
        entropyBudget: 10
      };
      
      core.enqueueTask(task1);
      core.enqueueTask(task2);
      
      const queueSize = core.getQueueSize();
      if (queueSize !== 2) {
        core.shutdown();
        return {
          testName: 'Task queue',
          passed: false,
          details: `Expected queue size 2, got ${queueSize}`,
          duration: Date.now() - start
        };
      }
      
      // Dequeue should return highest priority first (task2)
      const dequeuedTask = core.dequeueTask();
      if (dequeuedTask?.id !== 'task2') {
        core.shutdown();
        return {
          testName: 'Task queue',
          passed: false,
          details: `Expected task2, got ${dequeuedTask?.id}`,
          duration: Date.now() - start
        };
      }
      
      core.shutdown();
      return {
        testName: 'Task queue',
        passed: true,
        details: 'Task queue working correctly',
        duration: Date.now() - start
      };
    } catch (error) {
      return {
        testName: 'Task queue',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start
      };
    }
  }

  /**
   * Test entropy storage
   */
  async testEntropyStorage(): Promise<TestResult> {
    const start = Date.now();
    try {
      const core = new PantheonCore(DEFAULT_CONFIG);
      await core.initialize();
      
      const signature: EntropySignature = {
        hash: 'testhash12345678901234567890123',
        probability: 0.5,
        constraints: [1, 2, 3],
        temporalDrift: Date.now(),
        structuralDensity: 0.3,
        timestamp: new Date()
      };
      
      core.storeEntropy(signature);
      
      const field = core.getEntropyField();
      if (field.length !== 1) {
        core.shutdown();
        return {
          testName: 'Entropy storage',
          passed: false,
          details: `Expected 1 signature, got ${field.length}`,
          duration: Date.now() - start
        };
      }
      
      if (field[0].hash !== signature.hash) {
        core.shutdown();
        return {
          testName: 'Entropy storage',
          passed: false,
          details: `Expected hash ${signature.hash}, got ${field[0].hash}`,
          duration: Date.now() - start
        };
      }
      
      core.shutdown();
      return {
        testName: 'Entropy storage',
        passed: true,
        details: 'Entropy storage working correctly',
        duration: Date.now() - start
      };
    } catch (error) {
      return {
        testName: 'Entropy storage',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start
      };
    }
  }

  /**
   * Test solution space compression
   */
  async testSolutionSpaceCompression(): Promise<TestResult> {
    const start = Date.now();
    try {
      const core = new PantheonCore(DEFAULT_CONFIG);
      await core.initialize();
      
      const signatures: EntropySignature[] = [];
      for (let i = 0; i < 20; i++) {
        signatures.push({
          hash: `hash${i}`,
          probability: Math.random(),
          constraints: [i, i * 2],
          temporalDrift: Date.now(),
          structuralDensity: Math.random(),
          timestamp: new Date()
        });
      }
      
      const compressed = core.compressSolutionSpace(signatures);
      
      // Should return top 10% = 2 signatures
      if (compressed.length !== 2) {
        core.shutdown();
        return {
          testName: 'Solution space compression',
          passed: false,
          details: `Expected 2 signatures, got ${compressed.length}`,
          duration: Date.now() - start
        };
      }
      
      core.shutdown();
      return {
        testName: 'Solution space compression',
        passed: true,
        details: 'Solution space compression working correctly',
        duration: Date.now() - start
      };
    } catch (error) {
      return {
        testName: 'Solution space compression',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start
      };
    }
  }

  /**
   * Test BaseCrawler entropy generation
   */
  async testCrawlerEntropyGeneration(): Promise<TestResult> {
    const start = Date.now();
    try {
      const task: CrawlerTask = {
        id: 'test-task',
        type: CrawlerType.WRAITH,
        target: 'http://test.com',
        priority: 5,
        quantum: 100,
        entropyBudget: 5
      };
      
      const crawler = new TestCrawler(task, CrawlerType.WRAITH);
      const signatures = await crawler.start();
      
      if (signatures.length === 0) {
        return {
          testName: 'Crawler entropy generation',
          passed: false,
          details: 'No entropy signatures generated',
          duration: Date.now() - start
        };
      }
      
      const sig = signatures[0];
      if (!sig.hash || typeof sig.probability !== 'number' || !Array.isArray(sig.constraints)) {
        return {
          testName: 'Crawler entropy generation',
          passed: false,
          details: 'Invalid signature structure',
          duration: Date.now() - start
        };
      }
      
      return {
        testName: 'Crawler entropy generation',
        passed: true,
        details: `Generated ${signatures.length} entropy signature(s)`,
        duration: Date.now() - start
      };
    } catch (error) {
      return {
        testName: 'Crawler entropy generation',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start
      };
    }
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<TestResult[]> {
    console.log('\n=== PANTHEON Core Test Suite ===\n');

    const tests = [
      this.testCoreInitialization(),
      this.testTaskQueue(),
      this.testEntropyStorage(),
      this.testSolutionSpaceCompression(),
      this.testCrawlerEntropyGeneration()
    ];

    const results = await Promise.all(tests);

    // Print results
    results.forEach((result) => {
      const status = result.passed ? '✓' : '✗';
      console.log(`${status} ${result.testName} (${result.duration}ms)`);
      if (!result.passed) {
        console.log(`  Details: ${result.details}`);
      }
    });

    const passedCount = results.filter(r => r.passed).length;
    const totalCount = results.length;
    console.log(`\nPassed: ${passedCount}/${totalCount}`);

    return results;
  }
}

// Export for use in test runner
export async function runPantheonTests(): Promise<boolean> {
  const suite = new PantheonCoreTestSuite();
  const results = await suite.runAllTests();
  return results.every(r => r.passed);
}

// Run tests if executed directly (ES module compatible)
const isMainModule = process.argv[1]?.includes('core.test');
if (isMainModule) {
  runPantheonTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(err => {
      console.error('Test execution failed:', err);
      process.exit(1);
    });
}
