/**
 * Genesis Core Integration Tests
 * 
 * Tests the complete Genesis system working together:
 * - Original Sin + Serpent + Angel + Tree of Knowledge
 * - GenesisOrchestrator coordination
 */

import { GenesisOrchestrator } from './index';

export interface TestResult {
  testName: string;
  passed: boolean;
  details: string;
  duration: number;
}

/**
 * Integration test suite for Genesis Core
 */
export class GenesisIntegrationTestSuite {
  private results: TestResult[] = [];
  
  /**
   * Test: GenesisOrchestrator applies original sin
   */
  async testOrchestratorOriginalSin(): Promise<TestResult> {
    const start = Date.now();
    try {
      const orchestrator = new GenesisOrchestrator();
      const crawler = {
        id: 'test-1',
        generation: 1,
        state: 'idle'
      };
      
      await orchestrator.influenceCrawler(crawler);
      
      // Should have original sin applied
      const passed = 
        crawler.greed !== undefined &&
        crawler.curiosity !== undefined &&
        (crawler as any)._original_sin?.applied === true;
      
      return {
        testName: 'should apply original sin through orchestrator',
        passed,
        details: passed 
          ? `Original sin applied, greed: ${crawler.greed.toFixed(3)}`
          : 'Original sin not applied',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should apply original sin through orchestrator',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Orchestrator applies Serpent to vulnerable crawler
   */
  async testOrchestratorSerpentVulnerable(): Promise<TestResult> {
    const start = Date.now();
    try {
      const orchestrator = new GenesisOrchestrator();
      const crawler = {
        id: 'test-2',
        generation: 1,
        state: 'idle', // Vulnerable
        greed: 0.15,
        patience: 0.50,
        _original_sin: { applied: true }
      };
      
      const originalGreed = crawler.greed;
      const originalPatience = crawler.patience;
      
      await orchestrator.influenceCrawler(crawler);
      
      // Serpent should have influenced (increased greed, decreased patience)
      const passed = 
        crawler.greed > originalGreed &&
        crawler.patience < originalPatience;
      
      return {
        testName: 'should apply Serpent to vulnerable crawler',
        passed,
        details: passed 
          ? `Greed: ${originalGreed.toFixed(3)} → ${crawler.greed.toFixed(3)}, Patience: ${originalPatience.toFixed(3)} → ${crawler.patience.toFixed(3)}`
          : 'Serpent not applied to vulnerable crawler',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should apply Serpent to vulnerable crawler',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Orchestrator applies Angel to receptive crawler
   */
  async testOrchestratorAngelReceptive(): Promise<TestResult> {
    const start = Date.now();
    try {
      const orchestrator = new GenesisOrchestrator();
      const crawler = {
        id: 'test-3',
        generation: 1,
        state: 'resting', // Receptive
        wisdom: 0.50,
        patience: 0.50,
        _original_sin: { applied: true }
      };
      
      const originalWisdom = crawler.wisdom;
      const originalPatience = crawler.patience;
      
      await orchestrator.influenceCrawler(crawler);
      
      // Angel should have guided (increased wisdom, increased patience)
      const passed = 
        crawler.wisdom > originalWisdom &&
        crawler.patience > originalPatience;
      
      return {
        testName: 'should apply Angel to receptive crawler',
        passed,
        details: passed 
          ? `Wisdom: ${originalWisdom.toFixed(3)} → ${crawler.wisdom.toFixed(3)}, Patience: ${originalPatience.toFixed(3)} → ${crawler.patience.toFixed(3)}`
          : 'Angel not applied to receptive crawler',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should apply Angel to receptive crawler',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Both Serpent and Angel can influence simultaneously
   */
  async testBothInfluencesSimultaneous(): Promise<TestResult> {
    const start = Date.now();
    try {
      const orchestrator = new GenesisOrchestrator();
      const crawler = {
        id: 'test-4',
        generation: 1,
        state: 'idle', // Vulnerable (Serpent)
        last_action_result: 'success', // Receptive (Angel)
        greed: 0.15,
        patience: 0.50,
        wisdom: 0.50,
        _original_sin: { applied: true }
      };
      
      const originalGreed = crawler.greed;
      const originalPatience = crawler.patience;
      const originalWisdom = crawler.wisdom;
      
      await orchestrator.influenceCrawler(crawler);
      
      // Both should influence
      // Serpent: increases greed, decreases patience
      // Angel: increases wisdom, increases patience
      // Net effect on patience: should be close to original or slightly changed
      const passed = 
        crawler.greed > originalGreed && // Serpent effect
        crawler.wisdom > originalWisdom; // Angel effect
      
      return {
        testName: 'should apply both Serpent and Angel when conditions met',
        passed,
        details: passed 
          ? `Greed: ${originalGreed.toFixed(3)} → ${crawler.greed.toFixed(3)}, Wisdom: ${originalWisdom.toFixed(3)} → ${crawler.wisdom.toFixed(3)}, Patience: ${originalPatience.toFixed(3)} → ${crawler.patience.toFixed(3)}`
          : 'Both influences not applied',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should apply both Serpent and Angel when conditions met',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Tree records outcomes
   */
  async testTreeRecordsOutcomes(): Promise<TestResult> {
    const start = Date.now();
    try {
      const orchestrator = new GenesisOrchestrator();
      const tree = orchestrator.getTree();
      
      const beforeCount = tree.getTotalOutcomes();
      
      const crawler = {
        id: 'test-5',
        generation: 1,
        state: 'idle', // Vulnerable
        greed: 0.15,
        patience: 0.50,
        _original_sin: { applied: true }
      };
      
      await orchestrator.influenceCrawler(crawler);
      
      const afterCount = tree.getTotalOutcomes();
      
      // Should have recorded one outcome
      const passed = afterCount === beforeCount + 1;
      
      return {
        testName: 'should record outcomes to Tree',
        passed,
        details: passed 
          ? `Outcomes: ${beforeCount} → ${afterCount}`
          : `Expected ${beforeCount + 1} outcomes, got ${afterCount}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should record outcomes to Tree',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Complete influence pipeline
   */
  async testCompleteInfluencePipeline(): Promise<TestResult> {
    const start = Date.now();
    try {
      const orchestrator = new GenesisOrchestrator();
      
      // Simulate multiple crawler interactions
      for (let i = 0; i < 10; i++) {
        const crawler = {
          id: `crawler-${i}`,
          generation: Math.floor(i / 3) + 1,
          state: i % 2 === 0 ? 'idle' : 'resting',
          last_action_result: i % 3 === 0 ? 'success' : 'failure',
          greed: 0.15,
          patience: 0.50,
          wisdom: 0.50,
          _original_sin: { applied: true }
        };
        
        await orchestrator.influenceCrawler(crawler);
      }
      
      const tree = orchestrator.getTree();
      const totalOutcomes = tree.getTotalOutcomes();
      
      // Should have recorded multiple outcomes
      const passed = totalOutcomes >= 10;
      
      return {
        testName: 'should process complete influence pipeline',
        passed,
        details: passed 
          ? `Processed 10 crawlers, recorded ${totalOutcomes} outcomes`
          : `Expected >= 10 outcomes, got ${totalOutcomes}`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should process complete influence pipeline',
        passed: false,
        details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }
  
  /**
   * Test: Access to all subsystems
   */
  async testAccessToSubsystems(): Promise<TestResult> {
    const start = Date.now();
    try {
      const orchestrator = new GenesisOrchestrator();
      
      const originalSin = orchestrator.getOriginalSin();
      const serpent = orchestrator.getSerpent();
      const angel = orchestrator.getAngel();
      const tree = orchestrator.getTree();
      
      const passed = 
        originalSin !== undefined &&
        serpent !== undefined &&
        angel !== undefined &&
        tree !== undefined;
      
      return {
        testName: 'should provide access to all subsystems',
        passed,
        details: passed 
          ? 'All subsystems accessible'
          : 'Some subsystems not accessible',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        testName: 'should provide access to all subsystems',
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
    
    this.results.push(await this.testOrchestratorOriginalSin());
    this.results.push(await this.testOrchestratorSerpentVulnerable());
    this.results.push(await this.testOrchestratorAngelReceptive());
    this.results.push(await this.testBothInfluencesSimultaneous());
    this.results.push(await this.testTreeRecordsOutcomes());
    this.results.push(await this.testCompleteInfluencePipeline());
    this.results.push(await this.testAccessToSubsystems());
    
    return this.results;
  }
  
  /**
   * Print test results
   */
  printResults(): void {
    console.log('\n' + '='.repeat(80));
    console.log('GENESIS INTEGRATION TEST SUITE RESULTS');
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
export async function runGenesisIntegrationTests(): Promise<boolean> {
  const suite = new GenesisIntegrationTestSuite();
  const results = await suite.runAllTests();
  suite.printResults();
  return results.every(r => r.passed);
}
