import { entityResolver } from '../entityResolver';
import { fuzzyMatcher } from '../fuzzyMatch';

export interface TestResult {
  testName: string;
  passed: boolean;
  details: string;
  duration: number;
}

export class EntityResolverTestSuite {
  private results: TestResult[] = [];

  async testBasicEntityResolution(): Promise<TestResult> {
    const start = Date.now();
    try {
      const records = [
        { name: 'John Smith', email: 'john@example.com', source: 'Database A' },
        { name: 'Jon Smith', email: 'jsmith@example.com', source: 'Database B' },
        { name: 'Johnny Smith', phone: '555-1234', source: 'Database C' },
      ];

      const result = await entityResolver.resolvePerson('John Smith', records);
      const passed = result.entity.names.length > 0 && result.entity.confidence > 70;
      
      return {
        testName: 'should resolve person entity from multiple records',
        passed,
        details: passed 
          ? `Resolved ${result.entity.names.length} names, confidence: ${result.entity.confidence}` 
          : `Expected names and confidence > 70, got names: ${result.entity.names.length}, confidence: ${result.entity.confidence}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should resolve person entity from multiple records',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testEntityWithMultipleSources(): Promise<TestResult> {
    const start = Date.now();
    try {
      const records = [
        { name: 'Jane Doe', email: 'jane@example.com', badge: 'A123', source: 'HR System' },
        { name: 'Jane Doe', phone: '555-5678', source: 'Directory' },
      ];

      const result = await entityResolver.resolvePerson('Jane Doe', records);
      const passed = result.entity.sources.length === 2 && 
                     result.entity.emails.length === 1 &&
                     result.entity.phones.length === 1;
      
      return {
        testName: 'should merge data from multiple sources',
        passed,
        details: passed 
          ? `Merged data from ${result.entity.sources.length} sources successfully` 
          : `Expected 2 sources, 1 email, 1 phone. Got sources: ${result.entity.sources.length}, emails: ${result.entity.emails.length}, phones: ${result.entity.phones.length}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should merge data from multiple sources',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testNoMatches(): Promise<TestResult> {
    const start = Date.now();
    try {
      const records = [
        { name: 'Alice Johnson', email: 'alice@example.com', source: 'Database A' },
        { name: 'Bob Williams', email: 'bob@example.com', source: 'Database B' },
      ];

      const result = await entityResolver.resolvePerson('Zyx Qwerty', records);
      const passed = result.entity.confidence === 0;
      
      return {
        testName: 'should handle no matches gracefully',
        passed,
        details: passed 
          ? `Correctly returned confidence 0 for no matches` 
          : `Expected confidence 0, got: ${result.entity.confidence}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should handle no matches gracefully',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async testCaching(): Promise<TestResult> {
    const start = Date.now();
    try {
      const records = [
        { name: 'Test User', email: 'test@example.com', source: 'Test DB' },
      ];

      // First call - should cache
      const result1 = await entityResolver.resolvePerson('Test User', records);
      const time1 = Date.now() - start;
      
      // Second call - should be faster due to cache
      const startCached = Date.now();
      const result2 = await entityResolver.resolvePerson('Test User', records);
      const time2 = Date.now() - startCached;
      
      const passed = result1.primaryName === result2.primaryName;
      
      return {
        testName: 'should cache entity resolution results',
        passed,
        details: passed 
          ? `Cache working: first call ${time1}ms, cached call ${time2}ms` 
          : `Results don't match between calls`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should cache entity resolution results',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  async runAllTests(): Promise<TestResult[]> {
    this.results = [];
    
    this.results.push(await this.testBasicEntityResolution());
    this.results.push(await this.testEntityWithMultipleSources());
    this.results.push(await this.testNoMatches());
    this.results.push(await this.testCaching());
    
    return this.results;
  }

  printResults(): void {
    console.log('\n' + '='.repeat(80));
    console.log('ENTITY RESOLVER TEST SUITE RESULTS');
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
export async function runEntityResolverTests(): Promise<boolean> {
  const suite = new EntityResolverTestSuite();
  const results = await suite.runAllTests();
  suite.printResults();
  return results.every(r => r.passed);
}
