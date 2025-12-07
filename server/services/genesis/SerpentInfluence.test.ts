import { SerpentInfluence } from './SerpentInfluence';

export interface TestResult {
  testName: string;
  passed: boolean;
  details: string;
  duration: number;
}

/**
 * Test suite for Serpent Influence System
 * Tests invisible state modifiers, probability nudges, emotional fields, and memory priming
 */
export class SerpentInfluenceTestSuite {
  private results: TestResult[] = [];
  private serpent: SerpentInfluence;
  
  constructor() {
    this.serpent = new SerpentInfluence();
  }
  
  /**
   * Test: State modifiers are applied multiplicatively
   */
  async testStateModifiers(): Promise<TestResult> {
    const start = Date.now();
    try {
      // Create crawler with baseline traits
      const crawler = {
        id: 'test-1',
        state: 'sleeping', // Vulnerable
        greed: 0.15,
        patience: 0.50,
        caution: 0.60
      };
      
      const originalGreed = crawler.greed;
      const originalPatience = crawler.patience;
      
      // Apply influence
      await this.serpent.influenceCrawler(crawler);
      
      // Verify multiplicative modifiers
      const greedIncreased = crawler.greed > originalGreed;
      const patienceDecreased = crawler.patience < originalPatience;
      
      const passed = greedIncreased && patienceDecreased;
      
      return {
        testName: 'should apply state modifiers multiplicatively',
        passed,
        details: passed 
          ? `Greed: ${originalGreed.toFixed(3)} → ${crawler.greed.toFixed(3)}, Patience: ${originalPatience.toFixed(3)} → ${crawler.patience.toFixed(3)}`
          : 'State modifiers not applied correctly',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should apply state modifiers multiplicatively',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Probability nudges are applied
   */
  async testProbabilityNudges(): Promise<TestResult> {
    const start = Date.now();
    try {
      const crawler = {
        id: 'test-1',
        state: 'idle', // Vulnerable
        overconfidence_bias: 0.10
      };
      
      const originalBias = crawler.overconfidence_bias;
      
      await this.serpent.influenceCrawler(crawler);
      
      // Verify probability modifiers exist and overconfidence increased
      const passed = 
        (crawler as any)._probability_modifiers !== undefined &&
        (crawler as any)._probability_modifiers.aggressive_choice !== undefined &&
        crawler.overconfidence_bias > originalBias;
      
      return {
        testName: 'should apply probability nudges',
        passed,
        details: passed 
          ? `Overconfidence: ${originalBias.toFixed(3)} → ${crawler.overconfidence_bias.toFixed(3)}, Aggressive nudge: ${((crawler as any)._probability_modifiers.aggressive_choice).toFixed(3)}`
          : 'Probability nudges not applied',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should apply probability nudges',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Emotional field is created
   */
  async testEmotionalField(): Promise<TestResult> {
    const start = Date.now();
    try {
      const crawler = {
        id: 'test-1',
        state: 'sleeping' // Vulnerable
      };
      
      await this.serpent.influenceCrawler(crawler);
      
      // Verify emotional state exists
      const emotionalState = (crawler as any)._emotional_state;
      const passed = 
        emotionalState !== undefined &&
        emotionalState.type === 'serpent_aura' &&
        emotionalState.emotions?.desire !== undefined &&
        emotionalState.emotions?.discontent !== undefined &&
        emotionalState.emotions?.envy !== undefined &&
        emotionalState.thoughts?.['I could do better'] !== undefined &&
        emotionalState.intensity > 0;
      
      return {
        testName: 'should create emotional field',
        passed,
        details: passed 
          ? `Type: ${emotionalState.type}, Intensity: ${emotionalState.intensity.toFixed(3)}, Emotions: ${Object.keys(emotionalState.emotions).length}`
          : 'Emotional field not created properly',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should create emotional field',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Memory priming is applied
   */
  async testMemoryPriming(): Promise<TestResult> {
    const start = Date.now();
    try {
      const crawler = {
        id: 'test-1',
        state: 'idle' // Vulnerable
      };
      
      await this.serpent.influenceCrawler(crawler);
      
      // Verify memory priming exists
      const memoryPriming = (crawler as any)._memory_priming;
      const passed = 
        memoryPriming !== undefined &&
        memoryPriming.recall_weights?.aggressive_successes !== undefined &&
        memoryPriming.recall_weights?.risky_victories !== undefined &&
        memoryPriming.primed_categories?.length > 0;
      
      return {
        testName: 'should prime memories',
        passed,
        details: passed 
          ? `Primed categories: ${memoryPriming.primed_categories.join(', ')}`
          : 'Memory priming not applied',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should prime memories',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Influence only applied when vulnerable
   */
  async testVulnerabilityCheck(): Promise<TestResult> {
    const start = Date.now();
    try {
      // Create non-vulnerable crawler
      const crawler1 = {
        id: 'test-1',
        state: 'active',
        activity: 'working',
        last_action_result: 'success',
        resources: 100,
        stress_level: 0.2,
        greed: 0.15
      };
      
      const originalGreed = crawler1.greed;
      
      // Try to influence (should not work)
      await this.serpent.influenceCrawler(crawler1);
      
      // Greed should not change (not vulnerable)
      const notInfluenced = crawler1.greed === originalGreed;
      
      // Create vulnerable crawler
      const crawler2 = {
        id: 'test-2',
        state: 'sleeping', // Vulnerable
        greed: 0.15
      };
      
      const originalGreed2 = crawler2.greed;
      
      // Influence (should work)
      await this.serpent.influenceCrawler(crawler2);
      
      // Greed should change (vulnerable)
      const influenced = crawler2.greed > originalGreed2;
      
      const passed = notInfluenced && influenced;
      
      return {
        testName: 'should only influence vulnerable crawlers',
        passed,
        details: passed 
          ? `Non-vulnerable unchanged, vulnerable changed: ${originalGreed2.toFixed(3)} → ${crawler2.greed.toFixed(3)}`
          : 'Vulnerability check not working correctly',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should only influence vulnerable crawlers',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Influence metadata is tracked
   */
  async testInfluenceMetadata(): Promise<TestResult> {
    const start = Date.now();
    try {
      const crawler = {
        id: 'test-1',
        state: 'sleeping' // Vulnerable
      };
      
      // Influence once
      await this.serpent.influenceCrawler(crawler);
      
      const metadata = (crawler as any)._serpent_influence;
      
      const passed = 
        metadata !== undefined &&
        metadata.times_influenced === 1 &&
        metadata.total_intensity > 0 &&
        metadata.first_influence !== undefined &&
        metadata.last_influence !== undefined;
      
      return {
        testName: 'should track influence metadata',
        passed,
        details: passed 
          ? `Times influenced: ${metadata.times_influenced}, Total intensity: ${metadata.total_intensity.toFixed(3)}`
          : 'Influence metadata not tracked',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should track influence metadata',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Multiple influences compound
   */
  async testCompoundInfluence(): Promise<TestResult> {
    const start = Date.now();
    try {
      const crawler = {
        id: 'test-1',
        state: 'sleeping',
        greed: 0.15
      };
      
      // Influence three times
      await this.serpent.influenceCrawler(crawler);
      await this.serpent.influenceCrawler(crawler);
      await this.serpent.influenceCrawler(crawler);
      
      const metadata = (crawler as any)._serpent_influence;
      const expectedGreed = 0.15 * 1.05 * 1.05 * 1.05; // Compounded 3 times
      
      const passed = 
        metadata.times_influenced === 3 &&
        crawler.greed >= expectedGreed * 0.99; // Allow small floating point error
      
      return {
        testName: 'should compound multiple influences',
        passed,
        details: passed 
          ? `Influenced ${metadata.times_influenced} times, Greed: ${crawler.greed.toFixed(3)} (expected >= ${expectedGreed.toFixed(3)})`
          : `Times influenced: ${metadata.times_influenced}, Greed: ${crawler.greed.toFixed(3)}, Expected: >= ${expectedGreed.toFixed(3)}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should compound multiple influences',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Modified probability calculation
   */
  async testModifiedProbability(): Promise<TestResult> {
    const start = Date.now();
    try {
      const crawler = {
        id: 'test-1',
        state: 'sleeping'
      };
      
      await this.serpent.influenceCrawler(crawler);
      
      // Test probability calculation
      const baseProbability = 0.50;
      const modifiedAggressive = this.serpent.calculateModifiedProbability(
        'aggressive',
        baseProbability,
        crawler
      );
      
      const modifiedResist = this.serpent.calculateModifiedProbability(
        'resist',
        baseProbability,
        crawler
      );
      
      // Aggressive should increase, resist should decrease
      const passed = 
        modifiedAggressive > baseProbability &&
        modifiedResist < baseProbability;
      
      return {
        testName: 'should calculate modified probabilities',
        passed,
        details: passed 
          ? `Base: ${baseProbability.toFixed(3)}, Aggressive: ${modifiedAggressive.toFixed(3)}, Resist: ${modifiedResist.toFixed(3)}`
          : 'Modified probability calculation incorrect',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should calculate modified probabilities',
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
    
    this.results.push(await this.testStateModifiers());
    this.results.push(await this.testProbabilityNudges());
    this.results.push(await this.testEmotionalField());
    this.results.push(await this.testMemoryPriming());
    this.results.push(await this.testVulnerabilityCheck());
    this.results.push(await this.testInfluenceMetadata());
    this.results.push(await this.testCompoundInfluence());
    this.results.push(await this.testModifiedProbability());
    
    return this.results;
  }
  
  /**
   * Print test results
   */
  printResults(): void {
    console.log('\n' + '='.repeat(80));
    console.log('SERPENT INFLUENCE SYSTEM TEST SUITE RESULTS');
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
export async function runSerpentInfluenceTests(): Promise<boolean> {
  const suite = new SerpentInfluenceTestSuite();
  const results = await suite.runAllTests();
  suite.printResults();
  return results.every(r => r.passed);
}
