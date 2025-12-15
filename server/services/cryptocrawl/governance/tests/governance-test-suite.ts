/**
 * GOVERNANCE SYSTEM TEST SUITE
 * 
 * Comprehensive testing for the 6-stage deployment system
 * 
 * Test Categories:
 * - Stage Management
 * - Risk Governor
 * - Kill-Switch
 * - Profit Ladder
 * - Integration Tests
 */

import { createLogger } from '../../../../logger';
import { stageManager, Stage } from '../stage-management';
import { riskGovernor, TradeProposal } from '../risk-governor';
import { killSwitch, KillSwitchType } from '../kill-switch';
import { profitLadder } from '../profit-ladder';
import { composer } from '../composer-interface';
import { cryptaraGovernance } from '../cryptara-integration';

const log = createLogger('GovernanceTests');

// ============================================================================
// TEST FRAMEWORK
// ============================================================================

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  error?: string;
  duration: number;
}

class TestRunner {
  private results: TestResult[] = [];
  
  async runTest(
    name: string,
    category: string,
    testFn: () => Promise<void>
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      await testFn();
      
      this.results.push({
        name,
        category,
        passed: true,
        duration: Date.now() - startTime,
      });
      
      log.info(`✅ PASS: ${name}`);
    } catch (error: any) {
      this.results.push({
        name,
        category,
        passed: false,
        error: error.message,
        duration: Date.now() - startTime,
      });
      
      log.error(`❌ FAIL: ${name}`, { error: error.message });
    }
  }
  
  getResults(): TestResult[] {
    return this.results;
  }
  
  getSummary(): {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
  } {
    const total = this.results.length;
    const passed = this.results.filter(r => r.passed).length;
    const failed = total - passed;
    const passRate = total > 0 ? (passed / total) * 100 : 0;
    
    return { total, passed, failed, passRate };
  }
}

// ============================================================================
// STAGE MANAGEMENT TESTS
// ============================================================================

async function testStageManagement(runner: TestRunner): Promise<void> {
  log.info('Running Stage Management tests...');
  
  // Test 1: Initial state should be Stage 1, Paused
  await runner.runTest(
    'Initial state is Stage 1 and paused',
    'Stage Management',
    async () => {
      const state = stageManager.getState();
      if (state.currentStage !== Stage.STAGE_1_CONSTRAINED_PILOT) {
        throw new Error(`Expected Stage 1, got Stage ${state.currentStage}`);
      }
      if (!state.isPaused) {
        throw new Error('Expected system to be paused initially');
      }
    }
  );
  
  // Test 2: UNPAUSE requires authority and scope
  await runner.runTest(
    'UNPAUSE requires authority and scope',
    'Stage Management',
    async () => {
      const result1 = await stageManager.requestUnpause('', 'test-scope');
      if (result1.success) {
        throw new Error('UNPAUSE should fail without authority');
      }
      
      const result2 = await stageManager.requestUnpause('test-authority', '');
      if (result2.success) {
        throw new Error('UNPAUSE should fail without scope');
      }
    }
  );
  
  // Test 3: Valid UNPAUSE succeeds
  await runner.runTest(
    'Valid UNPAUSE succeeds',
    'Stage Management',
    async () => {
      const result = await stageManager.requestUnpause(
        'test-composer',
        'Stage 1, 5 pairs, 2 venues, testnet chains',
        60000 // 1 minute
      );
      
      if (!result.success) {
        throw new Error(`UNPAUSE failed: ${result.message}`);
      }
      
      if (stageManager.isPaused()) {
        throw new Error('System should be unpaused');
      }
    }
  );
  
  // Test 4: PAUSE works
  await runner.runTest(
    'PAUSE stops system',
    'Stage Management',
    async () => {
      stageManager.pause('Test pause');
      
      if (!stageManager.isPaused()) {
        throw new Error('System should be paused');
      }
    }
  );
  
  // Test 5: Stage advancement requires criteria
  await runner.runTest(
    'Stage advancement requires proof metrics',
    'Stage Management',
    async () => {
      const result = await stageManager.requestStageAdvancement(
        'test-composer',
        Stage.STAGE_2_PROOF_OF_SIGNAL
      );
      
      if (result.success) {
        throw new Error('Should not advance without meeting criteria');
      }
    }
  );
}

// ============================================================================
// RISK GOVERNOR TESTS
// ============================================================================

async function testRiskGovernor(runner: TestRunner): Promise<void> {
  log.info('Running Risk Governor tests...');
  
  // Test 1: Trade proposal rejected when paused
  await runner.runTest(
    'Trade rejected when system paused',
    'Risk Governor',
    async () => {
      stageManager.pause('Test pause for risk governor');
      
      const proposal: TradeProposal = {
        id: 'test-1',
        strategy: 'test-strategy',
        chain: 'polygon',
        pair: 'ETH/USDC',
        venue: 'uniswap',
        positionSizeUSD: 50,
        estimatedProfitUSD: 5,
        estimatedRiskPercent: 0.02,
        timestamp: Date.now(),
      };
      
      const assessment = await riskGovernor.assessTradeProposal(proposal);
      
      if (assessment.approved) {
        throw new Error('Trade should be rejected when system is paused');
      }
    }
  );
  
  // Test 2: Trade requires unpause
  await runner.runTest(
    'Trade requires system unpause',
    'Risk Governor',
    async () => {
      await stageManager.requestUnpause('test-composer', 'test scope');
      
      const proposal: TradeProposal = {
        id: 'test-2',
        strategy: 'test-strategy',
        chain: 'polygon',
        pair: 'ETH/USDC',
        venue: 'uniswap',
        positionSizeUSD: 50,
        estimatedProfitUSD: 5,
        estimatedRiskPercent: 0.02,
        timestamp: Date.now(),
      };
      
      const assessment = await riskGovernor.assessTradeProposal(proposal);
      
      // Should pass pause check now
      if (!assessment.checksPass.pauseCheck) {
        throw new Error('Pause check should pass when unpaused');
      }
    }
  );
  
  // Test 3: Oversized position rejected
  await runner.runTest(
    'Oversized position rejected',
    'Risk Governor',
    async () => {
      const config = stageManager.getStageConfig();
      
      const proposal: TradeProposal = {
        id: 'test-3',
        strategy: 'test-strategy',
        chain: 'polygon',
        pair: 'ETH/USDC',
        venue: 'uniswap',
        positionSizeUSD: config.maxPositionSizeUSD * 2, // Double the limit
        estimatedProfitUSD: 50,
        estimatedRiskPercent: 0.02,
        timestamp: Date.now(),
      };
      
      const assessment = await riskGovernor.assessTradeProposal(proposal);
      
      if (assessment.checksPass.positionSizeCheck) {
        throw new Error('Position size check should fail for oversized positions');
      }
    }
  );
  
  // Test 4: Circuit breakers work
  await runner.runTest(
    'Circuit breakers trip on threshold',
    'Risk Governor',
    async () => {
      riskGovernor.updateCircuitBreaker('consecutive-losses', 6); // Threshold is 5
      
      const tripped = riskGovernor.getTrippedCircuitBreakers();
      
      if (tripped.length === 0) {
        throw new Error('Circuit breaker should have tripped');
      }
      
      // Reset for other tests
      riskGovernor.resetCircuitBreaker('consecutive-losses');
    }
  );
}

// ============================================================================
// KILL-SWITCH TESTS
// ============================================================================

async function testKillSwitch(runner: TestRunner): Promise<void> {
  log.info('Running Kill-Switch tests...');
  
  // Test 1: Kill-switch requires authority
  await runner.runTest(
    'Kill-switch requires valid authority',
    'Kill-Switch',
    async () => {
      const result = await killSwitch.activate(
        KillSwitchType.SOFT_HALT,
        'invalid-authority',
        'Test activation'
      );
      
      if (result.success) {
        throw new Error('Kill-switch should require valid authority');
      }
    }
  );
  
  // Test 2: Kill-switch activates with valid authority
  await runner.runTest(
    'Kill-switch activates with valid authority',
    'Kill-Switch',
    async () => {
      const result = await killSwitch.activate(
        KillSwitchType.SOFT_HALT,
        'system-admin',
        'Test activation',
        'test-auth-token-12345'
      );
      
      if (!result.success) {
        throw new Error(`Kill-switch failed: ${result.message}`);
      }
      
      if (!killSwitch.isActive()) {
        throw new Error('Kill-switch should be active');
      }
    }
  );
  
  // Test 3: Recovery requires authority
  await runner.runTest(
    'Recovery requires valid authority',
    'Kill-Switch',
    async () => {
      const result = await killSwitch.attemptRecovery('invalid-authority');
      
      if (result.success) {
        throw new Error('Recovery should require valid authority');
      }
    }
  );
  
  // Test 4: Recovery succeeds with valid authority
  await runner.runTest(
    'Recovery succeeds with valid authority',
    'Kill-Switch',
    async () => {
      const result = await killSwitch.attemptRecovery(
        'system-admin',
        'test-auth-token-12345'
      );
      
      if (!result.success) {
        throw new Error(`Recovery failed: ${result.message}`);
      }
      
      if (killSwitch.isActive()) {
        throw new Error('Kill-switch should be inactive after recovery');
      }
    }
  );
}

// ============================================================================
// PROFIT LADDER TESTS
// ============================================================================

async function testProfitLadder(runner: TestRunner): Promise<void> {
  log.info('Running Profit Ladder tests...');
  
  // Test 1: Starts at Tier 0
  await runner.runTest(
    'System starts at Tier 0',
    'Profit Ladder',
    async () => {
      const tier = profitLadder.getCurrentTier();
      
      if (tier.id !== 0) {
        throw new Error(`Expected Tier 0, got Tier ${tier.id}`);
      }
    }
  );
  
  // Test 2: Capital requirements work
  await runner.runTest(
    'Capital requirements enforced',
    'Profit Ladder',
    async () => {
      profitLadder.setCapital(1000);
      
      const req = profitLadder.getCapitalRequirement();
      
      if (req.current !== 1000) {
        throw new Error('Capital not set correctly');
      }
    }
  );
  
  // Test 3: Performance recording works
  await runner.runTest(
    'Performance recording updates metrics',
    'Profit Ladder',
    async () => {
      profitLadder.recordDailyPerformance(250, 0.7, 1.5, 0.05);
      
      const performance = profitLadder.getCurrentPerformance();
      
      if (!performance) {
        throw new Error('Performance not recorded');
      }
      
      if (performance.avgDailyProfit !== 250) {
        throw new Error('Average profit not calculated correctly');
      }
    }
  );
  
  // Test 4: Roadmap to $35K calculated
  await runner.runTest(
    'Roadmap to $35K calculated correctly',
    'Profit Ladder',
    async () => {
      const roadmap = profitLadder.getRoadmapTo35K();
      
      if (roadmap.currentTier !== 0) {
        throw new Error('Current tier should be 0');
      }
      
      if (roadmap.tiersRemaining !== 5) {
        throw new Error('Should have 5 tiers remaining');
      }
      
      if (roadmap.tierMilestones.length !== 5) {
        throw new Error('Should have 5 milestones');
      }
    }
  );
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

async function testIntegration(runner: TestRunner): Promise<void> {
  log.info('Running Integration tests...');
  
  // Test 1: Composer interface works
  await runner.runTest(
    'Composer interface coordinates components',
    'Integration',
    async () => {
      const status = composer.getSystemStatus();
      
      if (!status.currentStage) {
        throw new Error('System status should include stage info');
      }
      
      if (status.killSwitchArmed === undefined) {
        throw new Error('System status should include kill-switch info');
      }
    }
  );
  
  // Test 2: Full unpause flow
  await runner.runTest(
    'Full unpause flow works end-to-end',
    'Integration',
    async () => {
      // Ensure paused
      composer.pause('test-composer', 'Test pause');
      
      // Unpause with scope
      const result = await composer.unpause(
        'test-composer',
        {
          allowedChains: ['polygon', 'arbitrum'],
          maxPairs: 10,
          maxVenues: 3,
          maxDailyProfit: 500,
        },
        60000
      );
      
      if (!result.success) {
        throw new Error(`Unpause failed: ${result.message}`);
      }
      
      const status = composer.getSystemStatus();
      if (status.isPaused) {
        throw new Error('System should be unpaused');
      }
    }
  );
  
  // Test 3: Cryptara integration initialized
  await runner.runTest(
    'Cryptara integration initializes',
    'Integration',
    async () => {
      await cryptaraGovernance.initialize();
      
      const status = cryptaraGovernance.getStatus();
      
      if (!status.initialized) {
        throw new Error('Cryptara governance should be initialized');
      }
    }
  );
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

export async function runGovernanceTests(): Promise<{
  summary: any;
  results: TestResult[];
}> {
  log.info('');
  log.info('═══════════════════════════════════════════════════');
  log.info('  GOVERNANCE SYSTEM TEST SUITE');
  log.info('═══════════════════════════════════════════════════');
  log.info('');
  
  const runner = new TestRunner();
  
  await testStageManagement(runner);
  await testRiskGovernor(runner);
  await testKillSwitch(runner);
  await testProfitLadder(runner);
  await testIntegration(runner);
  
  const summary = runner.getSummary();
  const results = runner.getResults();
  
  log.info('');
  log.info('═══════════════════════════════════════════════════');
  log.info('  TEST SUMMARY');
  log.info('═══════════════════════════════════════════════════');
  log.info(`Total Tests: ${summary.total}`);
  log.info(`Passed: ${summary.passed} ✅`);
  log.info(`Failed: ${summary.failed} ❌`);
  log.info(`Pass Rate: ${summary.passRate.toFixed(1)}%`);
  log.info('');
  
  // Print failed tests
  const failed = results.filter(r => !r.passed);
  if (failed.length > 0) {
    log.info('Failed Tests:');
    failed.forEach(test => {
      log.error(`  ❌ ${test.name}: ${test.error}`);
    });
    log.info('');
  }
  
  return { summary, results };
}

// Export for CLI usage
if (require.main === module) {
  runGovernanceTests()
    .then(({ summary }) => {
      process.exit(summary.failed > 0 ? 1 : 0);
    })
    .catch(error => {
      log.error('Test suite failed', { error });
      process.exit(1);
    });
}
