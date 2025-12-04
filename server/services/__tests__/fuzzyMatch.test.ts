import { fuzzyMatcher } from '../fuzzyMatch';

export interface TestResult {
  testName: string;
  passed: boolean;
  details: string;
  duration: number;
}

export class FuzzyMatchTestSuite {
  private results: TestResult[] = [];

  async testIdenticalStrings(): Promise<TestResult> {
    const start = Date.now();
    try {
      const result = fuzzyMatcher.match('John Smith', 'John Smith');
      const passed = result.score > 95 && result.isMatch === true;
      
      return {
        testName: 'should match identical strings',
        passed,
        details: passed 
          ? `Score: ${result.score}, isMatch: ${result.isMatch}` 
          : `Expected score > 95 and isMatch=true, got score: ${result.score}, isMatch: ${result.isMatch}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should match identical strings',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testTypos(): Promise<TestResult> {
    const start = Date.now();
    try {
      const result = fuzzyMatcher.match('John Smith', 'Jon Smyth');
      const passed = result.score > 60;
      
      return {
        testName: 'should match with typos',
        passed,
        details: passed 
          ? `Score: ${result.score}` 
          : `Expected score > 60, got: ${result.score}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should match with typos',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testFindBestMatch(): Promise<TestResult> {
    const start = Date.now();
    try {
      const result = fuzzyMatcher.findBestMatch('John Smith', ['Jane Doe', 'Jon Smith', 'Mary Kay']);
      const passed = result.bestMatch === 'Jon Smith';
      
      return {
        testName: 'should find best match',
        passed,
        details: passed 
          ? `Best match: ${result.bestMatch}, score: ${result.score}` 
          : `Expected 'Jon Smith', got: ${result.bestMatch}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should find best match',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testNormalization(): Promise<TestResult> {
    const start = Date.now();
    try {
      const normalized1 = fuzzyMatcher.normalize('John Smith!!!');
      const normalized2 = fuzzyMatcher.normalize('JOHN   SMITH');
      const passed = normalized1 === 'john smith' && normalized2 === 'john smith';
      
      return {
        testName: 'should normalize strings correctly',
        passed,
        details: passed 
          ? `Normalized strings match: "${normalized1}"` 
          : `Expected "john smith", got: "${normalized1}" and "${normalized2}"`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should normalize strings correctly',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testNameMatching(): Promise<TestResult> {
    const start = Date.now();
    try {
      const result = fuzzyMatcher.matchName('John Smith', 'Smith John');
      const passed = result.score > 70;
      
      return {
        testName: 'should match reversed names',
        passed,
        details: passed 
          ? `Score: ${result.score}, isMatch: ${result.isMatch}` 
          : `Expected score > 70, got: ${result.score}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should match reversed names',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async runAllTests(): Promise<TestResult[]> {
    this.results = [];
    
    this.results.push(await this.testIdenticalStrings());
    this.results.push(await this.testTypos());
    this.results.push(await this.testFindBestMatch());
    this.results.push(await this.testNormalization());
    this.results.push(await this.testNameMatching());
    
    return this.results;
  }

  printResults(): void {
    console.log('\n' + '='.repeat(80));
    console.log('FUZZY MATCH TEST SUITE RESULTS');
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
export async function runFuzzyMatchTests(): Promise<boolean> {
  const suite = new FuzzyMatchTestSuite();
  const results = await suite.runAllTests();
  suite.printResults();
  return results.every(r => r.passed);
}
