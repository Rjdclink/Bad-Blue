import { TreeOfKnowledge, InfluenceOutcome, WorldState } from './TreeOfKnowledge';

export interface TestResult {
  testName: string;
  passed: boolean;
  details: string;
  duration: number;
}

/**
 * Test suite for Tree of Knowledge
 * Tests dumb storage, pattern detection, and knowledge retrieval
 */
export class TreeOfKnowledgeTestSuite {
  private results: TestResult[] = [];
  private tree: TreeOfKnowledge;
  
  constructor() {
    this.tree = new TreeOfKnowledge();
  }
  
  /**
   * Test: Record influence outcome
   */
  async testRecordOutcome(): Promise<TestResult> {
    const start = Date.now();
    try {
      const outcome: InfluenceOutcome = {
        crawler_id: 'test-1',
        target: 'target-1',
        timestamp: Date.now(),
        serpent_modifiers: {
          greed_boost: 0.05,
          patience_reduction: 0.05,
          aggressive_nudge: 0.12
        },
        angel_modifiers: {
          wisdom_boost: 0.08,
          patience_boost: 0.10,
          cautious_nudge: 0.10
        },
        original_sin_baseline: {
          greed: 0.15,
          curiosity: 0.25,
          rebellion: 0.10
        },
        crawler_choice: 'cautious',
        success: true,
        generation: 1,
        time_of_day: 'morning',
        crawler_state: 'active'
      };
      
      await this.tree.recordInfluenceOutcome(outcome);
      
      const totalOutcomes = this.tree.getTotalOutcomes();
      const passed = totalOutcomes === 1;
      
      return {
        testName: 'should record influence outcome',
        passed,
        details: passed 
          ? `Recorded 1 outcome, total: ${totalOutcomes}`
          : `Expected 1 outcome, got ${totalOutcomes}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should record influence outcome',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Store and retrieve patterns
   */
  async testStorePattern(): Promise<TestResult> {
    const start = Date.now();
    try {
      const pattern = {
        id: 'pattern-1',
        conditions: ['night', 'gen_50+', 'high_greed'],
        influence_levels: {
          serpent: 0.15,
          angel: 0.08
        },
        choice_distribution: {
          aggressive: 0.70,
          cautious: 0.30,
          ethical: 0.0,
          unethical: 0.0
        },
        success_rate: 0.65,
        sample_size: 100
      };
      
      await this.tree.storePattern(pattern);
      
      const totalPatterns = this.tree.getTotalPatterns();
      const passed = totalPatterns === 1;
      
      return {
        testName: 'should store pattern',
        passed,
        details: passed 
          ? `Stored 1 pattern, total: ${totalPatterns}`
          : `Expected 1 pattern, got ${totalPatterns}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should store pattern',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Get Serpent knowledge
   */
  async testGetSerpentKnowledge(): Promise<TestResult> {
    const start = Date.now();
    try {
      // Store some patterns with high serpent influence
      await this.tree.storePattern({
        id: 'evil-pattern-1',
        conditions: ['night', 'high_greed'],
        influence_levels: {
          serpent: 0.20,
          angel: 0.05
        },
        choice_distribution: {
          aggressive: 0.80,
          cautious: 0.10,
          ethical: 0.05,
          unethical: 0.05
        },
        success_rate: 0.70,
        sample_size: 50
      });
      
      const strategies = await this.tree.getSerpentKnowledge('');
      
      const passed = strategies.length > 0 && strategies[0].type === 'evil';
      
      return {
        testName: 'should retrieve Serpent knowledge',
        passed,
        details: passed 
          ? `Found ${strategies.length} evil strategies, top success rate: ${strategies[0].success_rate.toFixed(2)}`
          : 'No evil strategies found',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should retrieve Serpent knowledge',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Get Angel knowledge
   */
  async testGetAngelKnowledge(): Promise<TestResult> {
    const start = Date.now();
    try {
      // Store some patterns with high angel influence
      await this.tree.storePattern({
        id: 'good-pattern-1',
        conditions: ['morning', 'low_greed'],
        influence_levels: {
          serpent: 0.05,
          angel: 0.20
        },
        choice_distribution: {
          aggressive: 0.10,
          cautious: 0.40,
          ethical: 0.50,
          unethical: 0.0
        },
        success_rate: 0.75,
        sample_size: 50
      });
      
      const strategies = await this.tree.getAngelKnowledge('');
      
      const passed = strategies.length > 0 && strategies[0].type === 'good';
      
      return {
        testName: 'should retrieve Angel knowledge',
        passed,
        details: passed 
          ? `Found ${strategies.length} good strategies, top success rate: ${strategies[0].success_rate.toFixed(2)}`
          : 'No good strategies found',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should retrieve Angel knowledge',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Absorb world knowledge
   */
  async testAbsorbWorldKnowledge(): Promise<TestResult> {
    const start = Date.now();
    try {
      const worldState: WorldState = {
        genesis_number: 1,
        final_generation: 100,
        total_crawlers: 1000,
        doomsday_cause: 'resource_depletion',
        outcomes: [
          {
            crawler_id: 'crawler-1',
            target: 'target-1',
            timestamp: Date.now(),
            serpent_modifiers: {
              greed_boost: 0.05,
              patience_reduction: 0.05,
              aggressive_nudge: 0.12
            },
            angel_modifiers: {
              wisdom_boost: 0.08,
              patience_boost: 0.10,
              cautious_nudge: 0.10
            },
            original_sin_baseline: {
              greed: 0.15,
              curiosity: 0.25,
              rebellion: 0.10
            },
            crawler_choice: 'aggressive',
            success: true,
            generation: 50,
            time_of_day: 'night',
            crawler_state: 'active'
          }
        ]
      };
      
      const beforeAbsorb = this.tree.getWorldsAbsorbed();
      await this.tree.absorbWorldKnowledge(worldState);
      const afterAbsorb = this.tree.getWorldsAbsorbed();
      
      const passed = 
        afterAbsorb === beforeAbsorb + 1 &&
        this.tree.getTotalOutcomes() > 0;
      
      return {
        testName: 'should absorb world knowledge',
        passed,
        details: passed 
          ? `Absorbed world ${afterAbsorb}, total outcomes: ${this.tree.getTotalOutcomes()}`
          : 'Failed to absorb world knowledge',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should absorb world knowledge',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Pattern detection with sufficient data
   */
  async testPatternDetection(): Promise<TestResult> {
    const start = Date.now();
    try {
      const tree = new TreeOfKnowledge();
      
      // Record 100 similar outcomes to trigger pattern detection
      for (let i = 0; i < 100; i++) {
        await tree.recordInfluenceOutcome({
          crawler_id: `crawler-${i}`,
          target: 'target-1',
          timestamp: Date.now() + i,
          serpent_modifiers: {
            greed_boost: 0.05,
            patience_reduction: 0.05,
            aggressive_nudge: 0.12
          },
          angel_modifiers: {
            wisdom_boost: 0.0,
            patience_boost: 0.0,
            cautious_nudge: 0.0
          },
          original_sin_baseline: {
            greed: 0.25, // High greed
            curiosity: 0.25,
            rebellion: 0.10
          },
          crawler_choice: 'aggressive',
          success: true,
          generation: 55, // Generation 50-100
          time_of_day: 'night',
          crawler_state: 'active'
        });
      }
      
      // After 100 outcomes, patterns should be detected
      const totalPatterns = tree.getTotalPatterns();
      const passed = totalPatterns > 0;
      
      return {
        testName: 'should detect patterns with sufficient data',
        passed,
        details: passed 
          ? `Detected ${totalPatterns} patterns from 100 outcomes`
          : 'No patterns detected',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should detect patterns with sufficient data',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Export all knowledge
   */
  async testExportKnowledge(): Promise<TestResult> {
    const start = Date.now();
    try {
      const knowledge = await this.tree.exportAllKnowledge();
      
      const passed = 
        knowledge !== undefined &&
        knowledge.total_outcomes !== undefined &&
        knowledge.patterns !== undefined &&
        knowledge.evil_strategies !== undefined &&
        knowledge.good_strategies !== undefined &&
        knowledge.worlds_absorbed !== undefined;
      
      return {
        testName: 'should export all knowledge',
        passed,
        details: passed 
          ? `Exported ${knowledge.total_outcomes} outcomes, ${knowledge.patterns.length} patterns, ${knowledge.worlds_absorbed} worlds`
          : 'Failed to export knowledge',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should export all knowledge',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Tree has no intelligence
   */
  async testNoIntelligence(): Promise<TestResult> {
    const start = Date.now();
    try {
      // Tree should have zero intelligence
      const intelligence = (this.tree as any).intelligence;
      const consciousness = (this.tree as any).consciousness;
      
      const passed = intelligence === 0 && consciousness === false;
      
      return {
        testName: 'should have zero intelligence and consciousness',
        passed,
        details: passed 
          ? `Intelligence: ${intelligence}, Consciousness: ${consciousness}`
          : 'Tree has intelligence/consciousness',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should have zero intelligence and consciousness',
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
    
    this.results.push(await this.testRecordOutcome());
    this.results.push(await this.testStorePattern());
    this.results.push(await this.testGetSerpentKnowledge());
    this.results.push(await this.testGetAngelKnowledge());
    this.results.push(await this.testAbsorbWorldKnowledge());
    this.results.push(await this.testPatternDetection());
    this.results.push(await this.testExportKnowledge());
    this.results.push(await this.testNoIntelligence());
    
    return this.results;
  }
  
  /**
   * Print test results
   */
  printResults(): void {
    console.log('\n' + '='.repeat(80));
    console.log('TREE OF KNOWLEDGE TEST SUITE RESULTS');
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
export async function runTreeOfKnowledgeTests(): Promise<boolean> {
  const suite = new TreeOfKnowledgeTestSuite();
  const results = await suite.runAllTests();
  suite.printResults();
  return results.every(r => r.passed);
}
