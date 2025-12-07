import { ExifExtractor, type Upload } from '../exif/ExifExtractor';

export interface TestResult {
  testName: string;
  passed: boolean;
  details: string;
  duration: number;
}

export class ExifExtractorTestSuite {
  private results: TestResult[] = [];
  private extractor: ExifExtractor;

  constructor() {
    this.extractor = new ExifExtractor();
  }

  async testNoGPSDataReturnsNull(): Promise<TestResult> {
    const start = Date.now();
    try {
      const upload: Upload = {
        file: Buffer.from('not-a-valid-image'),
        filename: 'test.jpg',
        uploadedBy: 'user1',
        purpose: 'legal-evidence',
      };

      const result = await this.extractor.extractLocation(upload);
      const passed = result === null;

      return {
        testName: 'should return null for invalid or no GPS data',
        passed,
        details: passed
          ? 'Correctly returned null for invalid image'
          : 'Expected null but got result',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should return null for invalid or no GPS data',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testBatchProcessing(): Promise<TestResult> {
    const start = Date.now();
    try {
      const uploads: Upload[] = [
        {
          file: Buffer.from('test1'),
          filename: 'test1.jpg',
          uploadedBy: 'user1',
          purpose: 'legal-evidence',
        },
        {
          file: Buffer.from('test2'),
          filename: 'test2.jpg',
          uploadedBy: 'user2',
          purpose: 'legal-evidence',
        },
      ];

      const results = await this.extractor.extractBatch(uploads);
      // Since we're using invalid images, all results should be filtered out
      const passed = Array.isArray(results) && results.length === 0;

      return {
        testName: 'should process batch of uploads',
        passed,
        details: passed
          ? 'Batch processing returned array (empty for invalid images)'
          : 'Batch processing failed or returned wrong type',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should process batch of uploads',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async runAllTests(): Promise<TestResult[]> {
    this.results = [];

    this.results.push(await this.testNoGPSDataReturnsNull());
    this.results.push(await this.testBatchProcessing());

    return this.results;
  }

  printResults(): void {
    console.log('\n' + '='.repeat(80));
    console.log('EXIF EXTRACTOR TEST SUITE RESULTS');
    console.log('='.repeat(80));

    let passed = 0;
    let failed = 0;

    this.results.forEach((result) => {
      const status = result.passed ? '✓ PASS' : '✗ FAIL';
      console.log(`\n${status} - ${result.testName}`);
      console.log(`  Duration: ${result.duration}ms`);
      console.log(`  Details: ${result.details}`);

      if (result.passed) passed++;
      else failed++;
    });

    console.log('\n' + '='.repeat(80));
    console.log(`Total: ${this.results.length} | Passed: ${passed} | Failed: ${failed}`);
    console.log('='.repeat(80) + '\n');
  }
}

// Export function to run tests
export async function runExifExtractorTests(): Promise<boolean> {
  const suite = new ExifExtractorTestSuite();
  const results = await suite.runAllTests();
  suite.printResults();
  return results.every((r) => r.passed);
}
