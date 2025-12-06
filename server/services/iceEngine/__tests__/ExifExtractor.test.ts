import { ExifExtractor, type ConsentedUpload } from '../exif/ExifExtractor';

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

  async testConsentValidation(): Promise<TestResult> {
    const start = Date.now();
    try {
      const uploads: ConsentedUpload[] = [
        {
          file: Buffer.from('test'),
          filename: 'test1.jpg',
          uploadedBy: 'user1',
          consentGiven: true,
          purpose: 'legal-evidence',
        },
        {
          file: Buffer.from('test'),
          filename: 'test2.jpg',
          uploadedBy: 'user2',
          consentGiven: false,
          purpose: 'legal-evidence',
        },
      ];

      const result = this.extractor.validateConsent(uploads);
      const passed = result.valid.length === 1 && result.invalid.length === 1;

      return {
        testName: 'should validate consent correctly',
        passed,
        details: passed
          ? `Valid: ${result.valid.length}, Invalid: ${result.invalid.length}`
          : `Expected 1 valid and 1 invalid, got: ${result.valid.length} valid, ${result.invalid.length} invalid`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should validate consent correctly',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testNoConsentError(): Promise<TestResult> {
    const start = Date.now();
    try {
      const upload: ConsentedUpload = {
        file: Buffer.from('test'),
        filename: 'test.jpg',
        uploadedBy: 'user1',
        consentGiven: false,
        purpose: 'legal-evidence',
      };

      let errorThrown = false;
      try {
        await this.extractor.extractLocation(upload);
      } catch (error) {
        errorThrown = error instanceof Error && 
          error.message.includes('Cannot extract EXIF without explicit user consent');
      }

      return {
        testName: 'should throw error when consent is not given',
        passed: errorThrown,
        details: errorThrown
          ? 'Correctly threw consent error'
          : 'Did not throw expected consent error',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should throw error when consent is not given',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testNoGPSDataReturnsNull(): Promise<TestResult> {
    const start = Date.now();
    try {
      const upload: ConsentedUpload = {
        file: Buffer.from('not-a-valid-image'),
        filename: 'test.jpg',
        uploadedBy: 'user1',
        consentGiven: true,
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
      const uploads: ConsentedUpload[] = [
        {
          file: Buffer.from('test1'),
          filename: 'test1.jpg',
          uploadedBy: 'user1',
          consentGiven: true,
          purpose: 'legal-evidence',
        },
        {
          file: Buffer.from('test2'),
          filename: 'test2.jpg',
          uploadedBy: 'user2',
          consentGiven: true,
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

    this.results.push(await this.testConsentValidation());
    this.results.push(await this.testNoConsentError());
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
