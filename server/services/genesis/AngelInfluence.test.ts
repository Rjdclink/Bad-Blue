import { AngelInfluence } from './AngelInfluence';

export interface TestResult {
  testName: string;
  passed: boolean;
  details: string;
  duration: number;
}

/**
 * Test suite for Angel Influence System
 * Tests invisible state modifiers, probability nudges, emotional fields, and memory priming
 */
export class AngelInfluenceTestSuite {
  private results: TestResult[] = [];
  private angel: AngelInfluence;
  
  constructor() {
    this.angel = new AngelInfluence();
  }
  
  /**
   * Test: State modifiers are applied multiplicatively (opposite of Serpent)
   */
  async testStateModifiers(): Promise<TestResult> {
    const start = Date.now();
    try {
      // Create crawler with baseline traits
      const crawler = {
        id: 'test-1',
        state: 'resting', // Receptive
        wisdom: 0.50,
        patience: 0.50,
        compassion: 0.50
      };
      
      const originalWisdom = crawler.wisdom;
      const originalPatience = crawler.patience;
      const originalCompassion = crawler.compassion;
      
      // Apply guidance
      await this.angel.guideCrawler(crawler);
      
      // Verify multiplicative modifiers (should increase)
      const wisdomIncreased = crawler.wisdom > originalWisdom;
      const patienceIncreased = crawler.patience > originalPatience;
      const compassionIncreased = crawler.compassion > originalCompassion;
      
      const passed = wisdomIncreased && patienceIncreased && compassionIncreased;
      
      return {
        testName: 'should apply state modifiers multiplicatively',
        passed,
        details: passed 
          ? `Wisdom: ${originalWisdom.toFixed(3)} → ${crawler.wisdom.toFixed(3)}, Patience: ${originalPatience.toFixed(3)} → ${crawler.patience.toFixed(3)}, Compassion: ${originalCompassion.toFixed(3)} → ${crawler.compassion.toFixed(3)}`
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
   * Test: Probability nudges are applied toward good choices
   */
  async testProbabilityNudges(): Promise<TestResult> {
    const start = Date.now();
    try {
      const crawler = {
        id: 'test-1',
        state: 'calm', // Receptive
      };
      
      await this.angel.guideCrawler(crawler);
      
      // Verify probability modifiers exist and nudge toward good
      const passed = 
        (crawler as any)._probability_modifiers !== undefined &&
        (crawler as any)._probability_modifiers.cautious_choice !== undefined &&
        (crawler as any)._probability_modifiers.ethical_choice !== undefined &&
        (crawler as any)._probability_modifiers.resist_temptation !== undefined;
      
      return {
        testName: 'should apply probability nudges toward good',
        passed,
        details: passed 
          ? `Cautious nudge: ${((crawler as any)._probability_modifiers.cautious_choice).toFixed(3)}, Ethical nudge: ${((crawler as any)._probability_modifiers.ethical_choice).toFixed(3)}, Resist temptation: ${((crawler as any)._probability_modifiers.resist_temptation).toFixed(3)}`
          : 'Probability nudges not applied',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should apply probability nudges toward good',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Emotional field creates peaceful atmosphere
   */
  async testEmotionalField(): Promise<TestResult> {
    const start = Date.now();
    try {
      const crawler = {
        id: 'test-1',
        last_action_result: 'success', // Receptive
      };
      
      await this.angel.guideCrawler(crawler);
      
      // Verify peaceful emotional field
      const emotionalState = (crawler as any)._emotional_state;
      const passed = 
        emotionalState !== undefined &&
        emotionalState.type === 'angel_aura' &&
        emotionalState.emotions.peace !== undefined &&
        emotionalState.emotions.inner_calm !== undefined &&
        emotionalState.thoughts['Good things take time'] !== undefined;
      
      const emotionCount = emotionalState ? Object.keys(emotionalState.emotions).length : 0;
      const thoughtCount = emotionalState ? Object.keys(emotionalState.thoughts).length : 0;
      
      return {
        testName: 'should create peaceful emotional field',
        passed,
        details: passed 
          ? `Type: ${emotionalState.type}, Intensity: ${emotionalState.intensity.toFixed(3)}, Emotions: ${emotionCount}, Thoughts: ${thoughtCount}`
          : 'Emotional field not created correctly',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should create peaceful emotional field',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Memory priming for wise experiences
   */
  async testMemoryPriming(): Promise<TestResult> {
    const start = Date.now();
    try {
      const crawler = {
        id: 'test-1',
        state: 'resting', // Receptive
      };
      
      await this.angel.guideCrawler(crawler);
      
      // Verify memory priming
      const memoryPriming = (crawler as any)._memory_priming;
      const passed = 
        memoryPriming !== undefined &&
        memoryPriming.recall_weights.patient_successes !== undefined &&
        memoryPriming.recall_weights.ethical_victories !== undefined &&
        memoryPriming.primed_categories.includes('patient_successes');
      
      const primedCategories = memoryPriming ? memoryPriming.primed_categories.join(', ') : 'none';
      
      return {
        testName: 'should prime memories for wise experiences',
        passed,
        details: passed 
          ? `Primed categories: ${primedCategories}`
          : 'Memory priming not applied',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should prime memories for wise experiences',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Only influences receptive crawlers
   */
  async testReceptivityCheck(): Promise<TestResult> {
    const start = Date.now();
    try {
      // Create non-receptive crawler
      const nonReceptive = {
        id: 'test-1',
        state: 'active', // Not receptive
        last_action_result: 'failure',
        wisdom: 0.50
      };
      
      const originalWisdom = nonReceptive.wisdom;
      await this.angel.guideCrawler(nonReceptive);
      
      // Create receptive crawler
      const receptive = {
        id: 'test-2',
        state: 'resting', // Receptive
        wisdom: 0.50
      };
      
      await this.angel.guideCrawler(receptive);
      
      // Non-receptive should be unchanged, receptive should change
      const passed = 
        nonReceptive.wisdom === originalWisdom &&
        receptive.wisdom > 0.50;
      
      return {
        testName: 'should only guide receptive crawlers',
        passed,
        details: passed 
          ? `Non-receptive unchanged, receptive changed: ${0.50} → ${receptive.wisdom.toFixed(3)}`
          : 'Receptivity check failed',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should only guide receptive crawlers',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Guidance metadata is tracked
   */
  async testGuidanceMetadata(): Promise<TestResult> {
    const start = Date.now();
    try {
      const crawler = {
        id: 'test-1',
        state: 'resting', // Receptive
      };
      
      await this.angel.guideCrawler(crawler);
      
      const metadata = (crawler as any)._angel_influence;
      const passed = 
        metadata !== undefined &&
        metadata.times_guided === 1 &&
        metadata.total_intensity > 0;
      
      return {
        testName: 'should track guidance metadata',
        passed,
        details: passed 
          ? `Times guided: ${metadata.times_guided}, Total intensity: ${metadata.total_intensity.toFixed(3)}`
          : 'Metadata not tracked correctly',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should track guidance metadata',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Multiple guidances compound
   */
  async testCompoundGuidance(): Promise<TestResult> {
    const start = Date.now();
    try {
      const crawler = {
        id: 'test-1',
        state: 'resting', // Receptive
        wisdom: 0.50
      };
      
      // Apply guidance multiple times
      await this.angel.guideCrawler(crawler);
      await this.angel.guideCrawler(crawler);
      await this.angel.guideCrawler(crawler);
      
      const metadata = (crawler as any)._angel_influence;
      
      // After 3 guidances, wisdom should compound
      // Each guidance: wisdom *= 1.08
      // Expected: 0.50 * 1.08^3 ≈ 0.630
      const expectedMinWisdom = 0.50 * 1.08 * 1.08 * 1.08;
      
      const passed = 
        metadata.times_guided === 3 &&
        crawler.wisdom >= expectedMinWisdom;
      
      return {
        testName: 'should compound multiple guidances',
        passed,
        details: passed 
          ? `Guided 3 times, Wisdom: ${crawler.wisdom.toFixed(3)} (expected >= ${expectedMinWisdom.toFixed(3)})`
          : `Wisdom ${crawler.wisdom.toFixed(3)} < expected ${expectedMinWisdom.toFixed(3)}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should compound multiple guidances',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Calculate modified probabilities
   */
  async testModifiedProbabilities(): Promise<TestResult> {
    const start = Date.now();
    try {
      const crawler = {
        id: 'test-1',
        state: 'resting', // Receptive
      };
      
      await this.angel.guideCrawler(crawler);
      
      // Test probability calculations
      const baseProbability = 0.50;
      const cautiousProbability = this.angel.calculateModifiedProbability('cautious_approach', baseProbability, crawler);
      const ethicalProbability = this.angel.calculateModifiedProbability('ethical_choice', baseProbability, crawler);
      const resistProbability = this.angel.calculateModifiedProbability('resist_temptation', baseProbability, crawler);
      
      // All should be higher than base
      const passed = 
        cautiousProbability > baseProbability &&
        ethicalProbability > baseProbability &&
        resistProbability > baseProbability;
      
      return {
        testName: 'should calculate modified probabilities',
        passed,
        details: passed 
          ? `Base: ${baseProbability.toFixed(3)}, Cautious: ${cautiousProbability.toFixed(3)}, Ethical: ${ethicalProbability.toFixed(3)}, Resist: ${resistProbability.toFixed(3)}`
          : 'Probability calculations incorrect',
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
    this.results.push(await this.testReceptivityCheck());
    this.results.push(await this.testGuidanceMetadata());
    this.results.push(await this.testCompoundGuidance());
    this.results.push(await this.testModifiedProbabilities());
    
    return this.results;
  }
  
  /**
   * Print test results
   */
  printResults(): void {
    console.log('\n' + '='.repeat(80));
    console.log('ANGEL INFLUENCE SYSTEM TEST SUITE RESULTS');
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
export async function runAngelInfluenceTests(): Promise<boolean> {
  const suite = new AngelInfluenceTestSuite();
  const results = await suite.runAllTests();
  suite.printResults();
  return results.every(r => r.passed);
}
