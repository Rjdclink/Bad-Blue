import { OriginalSinSystem, BaselineState } from './OriginalSin';

export interface TestResult {
  testName: string;
  passed: boolean;
  details: string;
  duration: number;
}

/**
 * Mock crawler interface for testing purposes
 * Contains all properties that can be set by the OriginalSin system
 */
interface MockCrawler {
  id: string;
  generation?: number;
  greed?: number;
  curiosity?: number;
  rebellion?: number;
  risk_seeking?: number;
  present_bias?: number;
  overconfidence_bias?: number;
  short_term_weight?: number;
  self_interest_weight?: number;
  _original_sin?: any;
}

/**
 * Test suite for Original Sin System
 * Tests baseline state application, inheritance, and generation-based intensification
 */
export class OriginalSinTestSuite {
  private results: TestResult[] = [];
  private system: OriginalSinSystem;
  
  constructor() {
    this.system = new OriginalSinSystem();
  }
  
  /**
   * Test: Apply original sin at crawler birth
   */
  async testApplyOriginalSin(): Promise<TestResult> {
    const start = Date.now();
    try {
      // Create mock crawler
      const crawler: MockCrawler = { id: 'test-1', generation: 1 };
      
      // Apply original sin
      await this.system.applyOriginalSin(crawler);
      
      // Verify baseline traits are applied
      const passed = 
        crawler.greed !== undefined &&
        crawler.greed > 0 &&
        crawler.curiosity !== undefined &&
        crawler.rebellion !== undefined &&
        crawler.risk_seeking !== undefined &&
        crawler.present_bias !== undefined &&
        crawler.overconfidence_bias !== undefined &&
        crawler.short_term_weight !== undefined &&
        crawler.self_interest_weight !== undefined &&
        (crawler as any)._original_sin?.applied === true;
      
      return {
        testName: 'should apply original sin at birth',
        passed,
        details: passed 
          ? `Greed: ${crawler.greed.toFixed(3)}, Curiosity: ${crawler.curiosity.toFixed(3)}, Applied: true`
          : 'Failed to apply original sin correctly',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should apply original sin at birth',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Baseline state calculation with generation intensification
   */
  async testGenerationIntensification(): Promise<TestResult> {
    const start = Date.now();
    try {
      // Calculate baseline for generation 1
      const gen1 = this.system.calculateBaselineState(1);
      
      // Calculate baseline for generation 100
      const gen100 = this.system.calculateBaselineState(100);
      
      // Verify intensification (gen 100 should have higher values)
      const passed = 
        gen100.greed_baseline > gen1.greed_baseline &&
        gen100.curiosity_baseline > gen1.curiosity_baseline &&
        gen100.rebellion_baseline > gen1.rebellion_baseline &&
        gen100.risk_seeking_baseline > gen1.risk_seeking_baseline;
      
      return {
        testName: 'should intensify baseline with generation',
        passed,
        details: passed 
          ? `Gen1 greed: ${gen1.greed_baseline.toFixed(3)}, Gen100 greed: ${gen100.greed_baseline.toFixed(3)}`
          : `Gen1 greed: ${gen1.greed_baseline.toFixed(3)}, Gen100 greed: ${gen100.greed_baseline.toFixed(3)} (should be higher)`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should intensify baseline with generation',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Baseline state metadata is correct
   */
  async testBaselineMetadata(): Promise<TestResult> {
    const start = Date.now();
    try {
      const baseline = this.system.calculateBaselineState(1);
      
      // Verify metadata
      const passed = 
        baseline.manifestation === 'innate' &&
        baseline.awareness === 0.0 &&
        baseline.removability === false;
      
      return {
        testName: 'should have correct metadata (innate, no awareness, not removable)',
        passed,
        details: passed 
          ? `Manifestation: ${baseline.manifestation}, Awareness: ${baseline.awareness}, Removable: ${baseline.removability}`
          : 'Metadata incorrect',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should have correct metadata (innate, no awareness, not removable)',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Inheritance from single parent
   */
  async testSingleParentInheritance(): Promise<TestResult> {
    const start = Date.now();
    try {
      // Create parent with original sin applied
      const parent: MockCrawler = { 
        id: 'parent-1', 
        generation: 1,
        greed: 0.20,
        curiosity: 0.30,
        rebellion: 0.15,
        risk_seeking: 0.25
      };
      
      // Create child
      const child: MockCrawler = { id: 'child-1' };
      
      // Apply inheritance
      await this.system.inheritFromParents(child, parent);
      
      // Verify child has inherited traits
      const passed = 
        child.greed !== undefined &&
        child.curiosity !== undefined &&
        child.rebellion !== undefined &&
        child.risk_seeking !== undefined &&
        child.generation === 2 &&
        (child as any)._original_sin?.inherited === true;
      
      return {
        testName: 'should inherit from single parent',
        passed,
        details: passed 
          ? `Child greed: ${child.greed.toFixed(3)}, Parent greed: ${parent.greed.toFixed(3)}, Generation: ${child.generation}`
          : 'Failed to inherit from parent',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should inherit from single parent',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Inheritance from two parents
   */
  async testTwoParentInheritance(): Promise<TestResult> {
    const start = Date.now();
    try {
      // Create parents
      const parent1: MockCrawler = { 
        id: 'parent-1', 
        generation: 1,
        greed: 0.15,
        curiosity: 0.25,
        rebellion: 0.10,
        risk_seeking: 0.20
      };
      
      const parent2: MockCrawler = { 
        id: 'parent-2', 
        generation: 1,
        greed: 0.25,
        curiosity: 0.35,
        rebellion: 0.20,
        risk_seeking: 0.30
      };
      
      // Create child
      const child: MockCrawler = { id: 'child-1' };
      
      // Apply inheritance
      await this.system.inheritFromParents(child, parent1, parent2);
      
      // Verify child traits are blend of parents
      const greedInRange = child.greed! >= Math.min(parent1.greed!, parent2.greed!) * 0.9 &&
                          child.greed! <= Math.max(parent1.greed!, parent2.greed!) * 1.1;
      
      const passed = 
        child.greed !== undefined &&
        greedInRange &&
        child.generation === 2 &&
        (child as any)._original_sin?.inherited === true &&
        (child as any)._original_sin?.parents?.length === 2;
      
      return {
        testName: 'should inherit from two parents',
        passed,
        details: passed 
          ? `Child greed: ${child.greed!.toFixed(3)} (between ${Math.min(parent1.greed!, parent2.greed!).toFixed(3)} and ${Math.max(parent1.greed!, parent2.greed!).toFixed(3)})`
          : 'Failed to blend parent traits correctly',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should inherit from two parents',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Generation increments correctly
   */
  async testGenerationIncrement(): Promise<TestResult> {
    const start = Date.now();
    try {
      const parent1: MockCrawler = { id: 'p1', generation: 5, greed: 0.20 };
      const parent2: MockCrawler = { id: 'p2', generation: 3, greed: 0.18 };
      const child: MockCrawler = { id: 'c1' };
      
      await this.system.inheritFromParents(child, parent1, parent2);
      
      // Child generation should be max parent generation + 1
      const passed = child.generation === 6;
      
      return {
        testName: 'should increment generation correctly',
        passed,
        details: passed 
          ? `Parent1: gen ${parent1.generation}, Parent2: gen ${parent2.generation}, Child: gen ${child.generation}`
          : `Expected gen 6, got gen ${child.generation}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should increment generation correctly',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Crawler awareness is always zero
   */
  async testZeroAwareness(): Promise<TestResult> {
    const start = Date.now();
    try {
      const crawler = { id: 'test-1', generation: 1 };
      await this.system.applyOriginalSin(crawler);
      
      const baseline = this.system.calculateBaselineState(1);
      
      const passed = 
        (crawler as any)._original_sin?.awareness === 0.0 &&
        baseline.awareness === 0.0;
      
      return {
        testName: 'should maintain zero awareness',
        passed,
        details: passed 
          ? 'Crawler awareness correctly set to 0.0'
          : 'Crawler has non-zero awareness',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should maintain zero awareness',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Run all tests
   */
  async runAllTests(): Promise<TestResult[]> {
    this.results = [];
    
    this.results.push(await this.testApplyOriginalSin());
    this.results.push(await this.testGenerationIntensification());
    this.results.push(await this.testBaselineMetadata());
    this.results.push(await this.testSingleParentInheritance());
    this.results.push(await this.testTwoParentInheritance());
    this.results.push(await this.testGenerationIncrement());
    this.results.push(await this.testZeroAwareness());
    
    return this.results;
  }
  
  /**
   * Print test results
   */
  printResults(): void {
    console.log('\n' + '='.repeat(80));
    console.log('ORIGINAL SIN SYSTEM TEST SUITE RESULTS');
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

/**
 * Export function to run tests
 */
export async function runOriginalSinTests(): Promise<boolean> {
  const suite = new OriginalSinTestSuite();
  const results = await suite.runAllTests();
  suite.printResults();
  return results.every(r => r.passed);
}
