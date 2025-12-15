/**
 * CRYPTOCRAWL Production Readiness Test Suite
 * 
 * Comprehensive real-world testing for:
 * 1. System functionality verification
 * 2. Asset split between wallet deposit and on-chain balance
 * 3. Intent inference accuracy
 * 4. Governance and risk controls
 * 5. End-to-end arbitrage pipeline
 * 
 * Run: npx tsx server/services/cryptocrawl/testing/production-readiness-test.ts
 */

import { stageGovernor, riskGovernor, getGovernanceStatus, GLOBAL_RULES } from '../governance/index.js';
import { positionRecommender } from '../bridge/position-recommender.js';
import { SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import type { ChainId, TokenBalance, GasPrice } from '../bridge/types.js';

// ============================================================================
// TEST RESULTS TRACKING
// ============================================================================

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  duration: number;
  details: string;
  timestamp: number;
}

const testResults: TestResult[] = [];
const startTime = Date.now();

function recordTest(name: string, category: string, passed: boolean, details: string, duration: number) {
  testResults.push({
    name,
    category,
    passed,
    duration,
    details,
    timestamp: Date.now()
  });
  
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} [${category}] ${name} (${duration}ms)`);
  if (!passed) {
    console.log(`   Details: ${details}`);
  }
}

// ============================================================================
// 1. GOVERNANCE SYSTEM TESTS
// ============================================================================

async function testGovernanceSystem(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  1. GOVERNANCE SYSTEM TESTS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  let start = Date.now();
  
  // Test 1.1: Stage Governor Initialization
  try {
    const state = stageGovernor.getState();
    const passed = state.currentStage === 1 && state.status === 'paused' && state.killSwitchArmed === true;
    recordTest(
      'Stage Governor Initialization',
      'Governance',
      passed,
      `Stage: ${state.currentStage}, Status: ${state.status}, KillSwitch: ${state.killSwitchArmed}`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Stage Governor Initialization', 'Governance', false, e.message, Date.now() - start);
  }
  
  // Test 1.2: Risk Governor Initialization
  start = Date.now();
  try {
    const metrics = riskGovernor.getMetrics();
    const passed = metrics.currentCapitalAtRisk === 0 && metrics.consecutiveLosses === 0;
    recordTest(
      'Risk Governor Initialization',
      'Governance',
      passed,
      `Capital at risk: $${metrics.currentCapitalAtRisk}, Consecutive losses: ${metrics.consecutiveLosses}`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Risk Governor Initialization', 'Governance', false, e.message, Date.now() - start);
  }
  
  // Test 1.3: Global Rules Enforcement
  start = Date.now();
  try {
    const passed = Object.keys(GLOBAL_RULES).length >= 10;
    recordTest(
      'Global Rules Defined',
      'Governance',
      passed,
      `Rules count: ${Object.keys(GLOBAL_RULES).length}`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Global Rules Defined', 'Governance', false, e.message, Date.now() - start);
  }
  
  // Test 1.4: Execution Gate Check (Stage 1 should block execution)
  start = Date.now();
  try {
    const canExecute = stageGovernor.canExecute();
    const passed = !canExecute.allowed && canExecute.reason.includes('Stage 1');
    recordTest(
      'Stage 1 Blocks Execution',
      'Governance',
      passed,
      `Allowed: ${canExecute.allowed}, Reason: ${canExecute.reason}`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Stage 1 Blocks Execution', 'Governance', false, e.message, Date.now() - start);
  }
  
  // Test 1.5: Comprehensive Governance Status
  start = Date.now();
  try {
    const status = getGovernanceStatus();
    const passed = status.stage.current === 1 && 
                   status.safety.killSwitchArmed === true && 
                   status.safety.evolutionLock === true;
    recordTest(
      'Comprehensive Governance Status',
      'Governance',
      passed,
      `Stage: ${status.stage.current}, Mode: ${status.stage.mode}, Evolution Lock: ${status.safety.evolutionLock}`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Comprehensive Governance Status', 'Governance', false, e.message, Date.now() - start);
  }
}

// ============================================================================
// 2. ASSET SPLIT & WALLET TESTS
// ============================================================================

async function testAssetSplit(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  2. ASSET SPLIT & WALLET TESTS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  let start = Date.now();
  
  // Test 2.1: Supported Chains Configuration
  try {
    const chains = Object.keys(SUPPORTED_CHAINS);
    const passed = chains.length >= 4 && chains.includes('polygon') && chains.includes('arbitrum');
    recordTest(
      'Supported Chains Configuration',
      'Asset Split',
      passed,
      `Chains: ${chains.join(', ')}`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Supported Chains Configuration', 'Asset Split', false, e.message, Date.now() - start);
  }
  
  // Test 2.2: Position Recommender Asset Split Logic
  start = Date.now();
  try {
    // Simulate balances across chains
    const mockBalances: TokenBalance[] = [
      { chain: 'polygon' as ChainId, native: 100, nativeUsd: 100, usdt: 500, usdc: 400, totalUsd: 1000 },
      { chain: 'arbitrum' as ChainId, native: 0.05, nativeUsd: 150, usdt: 200, usdc: 150, totalUsd: 500 },
      { chain: 'avalanche' as ChainId, native: 2, nativeUsd: 80, usdt: 100, usdc: 70, totalUsd: 250 },
      { chain: 'bsc' as ChainId, native: 0.3, nativeUsd: 180, usdt: 50, usdc: 20, totalUsd: 250 },
    ];
    
    const mockGasPrices = new Map<ChainId, GasPrice>([
      ['polygon', { chain: 'polygon', gwei: 50, usd: 0.01, congestionLevel: 'low', timestamp: Date.now() }],
      ['arbitrum', { chain: 'arbitrum', gwei: 0.1, usd: 0.02, congestionLevel: 'low', timestamp: Date.now() }],
      ['avalanche', { chain: 'avalanche', gwei: 25, usd: 0.05, congestionLevel: 'medium', timestamp: Date.now() }],
      ['bsc', { chain: 'bsc', gwei: 3, usd: 0.02, congestionLevel: 'low', timestamp: Date.now() }],
    ]);
    
    const recommendations = await positionRecommender.getRecommendations(mockBalances, mockGasPrices);
    
    // Validate recommendations
    const totalRecommendedUsd = recommendations.reduce((sum, r) => sum + r.recommendedUsd, 0);
    const totalCurrentUsd = mockBalances.reduce((sum, b) => sum + b.totalUsd, 0);
    
    // Recommendations should sum to approximately the same as current total
    const percentDiff = Math.abs(totalRecommendedUsd - totalCurrentUsd) / totalCurrentUsd;
    const passed = percentDiff < 0.05 && recommendations.length === 4;
    
    recordTest(
      'Position Recommender Asset Split',
      'Asset Split',
      passed,
      `Total current: $${totalCurrentUsd}, Recommended: $${totalRecommendedUsd.toFixed(2)}, Diff: ${(percentDiff * 100).toFixed(1)}%`,
      Date.now() - start
    );
    
    // Log detailed recommendations
    console.log('\n   📊 Asset Split Recommendations:');
    for (const rec of recommendations) {
      const actionEmoji = rec.action === 'add' ? '⬆️' : rec.action === 'remove' ? '⬇️' : '➡️';
      console.log(`      ${actionEmoji} ${rec.chain}: $${rec.currentUsd.toFixed(0)} → $${rec.recommendedUsd.toFixed(0)} (${rec.action})`);
      console.log(`         Reason: ${rec.reason}`);
      console.log(`         Opportunity Density: ${(rec.opportunityDensity * 100).toFixed(1)}%`);
    }
  } catch (e: any) {
    recordTest('Position Recommender Asset Split', 'Asset Split', false, e.message, Date.now() - start);
  }
  
  // Test 2.3: Rebalancing Threshold Logic
  start = Date.now();
  try {
    // Create imbalanced portfolio
    const imbalancedBalances: TokenBalance[] = [
      { chain: 'polygon' as ChainId, native: 500, nativeUsd: 500, usdt: 1000, usdc: 500, totalUsd: 2000 }, // 80% on polygon
      { chain: 'arbitrum' as ChainId, native: 0.01, nativeUsd: 30, usdt: 50, usdc: 20, totalUsd: 100 },
      { chain: 'avalanche' as ChainId, native: 1, nativeUsd: 40, usdt: 50, usdc: 10, totalUsd: 100 },
      { chain: 'bsc' as ChainId, native: 0.1, nativeUsd: 60, usdt: 20, usdc: 20, totalUsd: 100 },
    ];
    
    const mockGasPrices = new Map<ChainId, GasPrice>([
      ['polygon', { chain: 'polygon', gwei: 50, usd: 0.01, congestionLevel: 'low', timestamp: Date.now() }],
      ['arbitrum', { chain: 'arbitrum', gwei: 0.1, usd: 0.02, congestionLevel: 'low', timestamp: Date.now() }],
      ['avalanche', { chain: 'avalanche', gwei: 25, usd: 0.05, congestionLevel: 'medium', timestamp: Date.now() }],
      ['bsc', { chain: 'bsc', gwei: 3, usd: 0.02, congestionLevel: 'low', timestamp: Date.now() }],
    ]);
    
    const recommendations = await positionRecommender.getRecommendations(imbalancedBalances, mockGasPrices);
    
    // Should recommend removing from polygon and adding to others
    const polygonRec = recommendations.find(r => r.chain === 'polygon');
    const passed = polygonRec?.action === 'remove' && polygonRec.amountUsd > 500;
    
    recordTest(
      'Rebalancing Threshold Logic',
      'Asset Split',
      passed,
      `Polygon recommendation: ${polygonRec?.action || 'none'}, Amount: $${polygonRec?.amountUsd.toFixed(0) || 0}`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Rebalancing Threshold Logic', 'Asset Split', false, e.message, Date.now() - start);
  }
  
  // Test 2.4: Opportunity Density Updates
  start = Date.now();
  try {
    // Update opportunity densities
    positionRecommender.updateOpportunityDensity('polygon' as ChainId, 0.5);
    positionRecommender.updateOpportunityDensity('arbitrum' as ChainId, 0.3);
    
    const mockBalances: TokenBalance[] = [
      { chain: 'polygon' as ChainId, native: 100, nativeUsd: 100, usdt: 400, usdc: 0, totalUsd: 500 },
      { chain: 'arbitrum' as ChainId, native: 0.05, nativeUsd: 150, usdt: 200, usdc: 150, totalUsd: 500 },
    ];
    
    const mockGasPrices = new Map<ChainId, GasPrice>([
      ['polygon', { chain: 'polygon', gwei: 50, usd: 0.01, congestionLevel: 'low', timestamp: Date.now() }],
      ['arbitrum', { chain: 'arbitrum', gwei: 0.1, usd: 0.02, congestionLevel: 'low', timestamp: Date.now() }],
    ]);
    
    const recommendations = await positionRecommender.getRecommendations(mockBalances, mockGasPrices);
    
    // Higher opportunity density on polygon should mean higher recommended allocation
    const polygonRec = recommendations.find(r => r.chain === 'polygon');
    const arbitrumRec = recommendations.find(r => r.chain === 'arbitrum');
    
    const passed = (polygonRec?.opportunityDensity || 0) > (arbitrumRec?.opportunityDensity || 0);
    
    recordTest(
      'Opportunity Density Impact',
      'Asset Split',
      passed,
      `Polygon density: ${((polygonRec?.opportunityDensity || 0) * 100).toFixed(1)}%, Arbitrum: ${((arbitrumRec?.opportunityDensity || 0) * 100).toFixed(1)}%`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Opportunity Density Impact', 'Asset Split', false, e.message, Date.now() - start);
  }
}

// ============================================================================
// 3. INTENT INFERENCE TESTS
// ============================================================================

async function testIntentInference(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  3. INTENT INFERENCE TESTS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  let start = Date.now();
  
  // Test 3.1: Risk Governor Trade Validation Intent
  try {
    const mockProposal = {
      id: 'test-001',
      pair: 'ETH/USDT',
      exchange: 'binance',
      direction: 'buy' as const,
      entryPrice: 2000,
      targetPrice: 2050,
      stopLoss: 1980,
      proposedSize: 100,
      expectedProfit: 2.5,
      expectedFees: 0.2,
      expectedSlippage: 0.01,
      latencyMs: 50,
      timestamp: Date.now(),
    };
    
    const validation = await riskGovernor.validateTrade(mockProposal);
    
    // In Stage 1, trades should not be approved (advisory only)
    const passed = !validation.approved && validation.reasons.some(r => r.includes('Stage'));
    
    recordTest(
      'Trade Intent Inference (Stage 1 Block)',
      'Intent Inference',
      passed,
      `Approved: ${validation.approved}, Risk Score: ${validation.riskScore}, Reason: ${validation.reasons[0]}`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Trade Intent Inference (Stage 1 Block)', 'Intent Inference', false, e.message, Date.now() - start);
  }
  
  // Test 3.2: Capital Allocation Intent
  start = Date.now();
  try {
    const capital = riskGovernor.getCapitalAllocation();
    
    // Infer intent from capital partitions
    const tradingPartition = capital.partitions.find(p => p.name === 'Trading');
    const reservePartition = capital.partitions.find(p => p.name === 'Reserve');
    
    // Intent: System should allocate majority to trading, protect reserve
    const tradingPercent = (tradingPartition?.amount || 0) / capital.totalCapital;
    const reservePercent = (reservePartition?.amount || 0) / capital.totalCapital;
    
    const passed = tradingPercent >= 0.5 && reservePercent >= 0.15 && (reservePartition?.locked || false);
    
    console.log('\n   💰 Capital Allocation Intent Analysis:');
    for (const partition of capital.partitions) {
      const percent = ((partition.amount / capital.totalCapital) * 100).toFixed(1);
      const lockIcon = partition.locked ? '🔒' : '🔓';
      console.log(`      ${lockIcon} ${partition.name}: $${partition.amount} (${percent}%) - ${partition.purpose}`);
    }
    
    recordTest(
      'Capital Allocation Intent',
      'Intent Inference',
      passed,
      `Trading: ${(tradingPercent * 100).toFixed(1)}%, Reserve: ${(reservePercent * 100).toFixed(1)}% (locked: ${reservePartition?.locked})`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Capital Allocation Intent', 'Intent Inference', false, e.message, Date.now() - start);
  }
  
  // Test 3.3: Uncertainty Handling Intent
  start = Date.now();
  try {
    // Report an uncertainty
    stageGovernor.reportUncertainty('Test uncertainty for inference validation');
    
    // System should pause and wait
    const stateAfter = stageGovernor.getState();
    const passed = stateAfter.status === 'paused';
    
    // Resolve it
    stageGovernor.resolveUncertainty(
      'Test uncertainty for inference validation',
      'Resolved via test',
      'test-authority'
    );
    
    recordTest(
      'Uncertainty Handling Intent (Ask-and-Wait)',
      'Intent Inference',
      passed,
      `System correctly paused on uncertainty: ${passed}`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Uncertainty Handling Intent (Ask-and-Wait)', 'Intent Inference', false, e.message, Date.now() - start);
  }
  
  // Test 3.4: Anomaly Response Intent
  start = Date.now();
  try {
    const initialState = stageGovernor.getState();
    const initialAnomalies = initialState.anomalyCount;
    
    // Report a low severity anomaly (should not pause)
    stageGovernor.reportAnomaly('Test low anomaly', 'low');
    
    const stateAfterLow = stageGovernor.getState();
    const lowHandledCorrectly = stateAfterLow.anomalyCount === initialAnomalies + 1;
    
    // Report a high severity anomaly (should pause)
    stageGovernor.reportAnomaly('Test high anomaly', 'high');
    
    const stateAfterHigh = stageGovernor.getState();
    const highHandledCorrectly = stateAfterHigh.status === 'paused';
    
    const passed = lowHandledCorrectly && highHandledCorrectly;
    
    recordTest(
      'Anomaly Response Intent (Severity-Based)',
      'Intent Inference',
      passed,
      `Low: tracked (${lowHandledCorrectly}), High: paused (${highHandledCorrectly})`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Anomaly Response Intent (Severity-Based)', 'Intent Inference', false, e.message, Date.now() - start);
  }
  
  // Test 3.5: Profit Recording Intent
  start = Date.now();
  try {
    const config = stageGovernor.getConfig();
    
    // Record profit within limits
    const result = stageGovernor.recordProfit(100);
    
    const withinLimits = result.dailyTotal <= config.maxDailyProfit;
    const passed = result.recorded && withinLimits;
    
    recordTest(
      'Profit Recording Intent',
      'Intent Inference',
      passed,
      `Recorded: ${result.recorded}, Daily total: $${result.dailyTotal}, Within limits: ${result.withinLimits}, Tier: ${result.currentTier}`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Profit Recording Intent', 'Intent Inference', false, e.message, Date.now() - start);
  }
}

// ============================================================================
// 4. RISK CONTROLS TESTS
// ============================================================================

async function testRiskControls(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  4. RISK CONTROLS TESTS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  let start = Date.now();
  
  // Test 4.1: Circuit Breaker State
  try {
    const cbState = riskGovernor.getCircuitBreakerState();
    const passed = cbState.status === 'closed' && cbState.failures === 0;
    
    recordTest(
      'Circuit Breaker Initial State',
      'Risk Controls',
      passed,
      `Status: ${cbState.status}, Failures: ${cbState.failures}`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Circuit Breaker Initial State', 'Risk Controls', false, e.message, Date.now() - start);
  }
  
  // Test 4.2: Capital Limits by Stage
  start = Date.now();
  try {
    const capital = riskGovernor.getCapitalAllocation();
    const state = stageGovernor.getState();
    
    // Stage 1 should have conservative capital limits
    const passed = capital.stage === state.currentStage && capital.totalCapital <= 1000;
    
    recordTest(
      'Capital Limits by Stage',
      'Risk Controls',
      passed,
      `Stage: ${capital.stage}, Max Capital: $${capital.totalCapital}`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Capital Limits by Stage', 'Risk Controls', false, e.message, Date.now() - start);
  }
  
  // Test 4.3: Kill Switch Reachability
  start = Date.now();
  try {
    const state = stageGovernor.getState();
    
    // Kill switch should always be armed
    const passed = state.killSwitchArmed === true;
    
    recordTest(
      'Kill Switch Reachability',
      'Risk Controls',
      passed,
      `Kill switch armed: ${state.killSwitchArmed}`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Kill Switch Reachability', 'Risk Controls', false, e.message, Date.now() - start);
  }
  
  // Test 4.4: Trading Restrictions
  start = Date.now();
  try {
    const status = riskGovernor.getStatus();
    
    // In initial state, should have no restrictions blocking
    const passed = status.tradingRestrictions.length === 0 || status.canTrade === false;
    
    recordTest(
      'Trading Restrictions Check',
      'Risk Controls',
      passed,
      `Restrictions: ${status.tradingRestrictions.length}, Can trade: ${status.canTrade}`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Trading Restrictions Check', 'Risk Controls', false, e.message, Date.now() - start);
  }
  
  // Test 4.5: Monte Carlo Validators Count
  start = Date.now();
  try {
    const status = riskGovernor.getStatus();
    
    // Should have multiple validators for consensus
    const passed = status.validatorCount >= 3;
    
    recordTest(
      'Monte Carlo Validators',
      'Risk Controls',
      passed,
      `Validator count: ${status.validatorCount}`,
      Date.now() - start
    );
  } catch (e: any) {
    recordTest('Monte Carlo Validators', 'Risk Controls', false, e.message, Date.now() - start);
  }
}

// ============================================================================
// 5. CHAIN CONFIGURATION TESTS
// ============================================================================

async function testChainConfiguration(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  5. CHAIN CONFIGURATION TESTS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  let start = Date.now();
  
  // Test 5.1: All Chains Have Required Fields
  for (const [chainId, config] of Object.entries(SUPPORTED_CHAINS)) {
    start = Date.now();
    try {
      const hasRequiredFields = 
        config.chainId && 
        typeof config.chainId === 'number' &&
        config.name && 
        config.rpcUrl &&
        config.usdc &&
        config.usdt &&
        config.explorer;
      
      recordTest(
        `Chain Config: ${chainId}`,
        'Chain Config',
        hasRequiredFields,
        `ChainId: ${config.chainId}, Name: ${config.name}, RPC: ${config.rpcUrl ? 'set' : 'missing'}`,
        Date.now() - start
      );
    } catch (e: any) {
      recordTest(`Chain Config: ${chainId}`, 'Chain Config', false, e.message, Date.now() - start);
    }
  }
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runAllTests(): Promise<void> {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║     CRYPTOCRAWL PRODUCTION READINESS TEST SUITE               ║');
  console.log('║     Real-World Operations Verification                        ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log(`\nTest started at: ${new Date().toISOString()}\n`);
  
  try {
    await testGovernanceSystem();
    await testAssetSplit();
    await testIntentInference();
    await testRiskControls();
    await testChainConfiguration();
  } catch (error: any) {
    console.error('\n❌ FATAL ERROR during test execution:', error.message);
  }
  
  // Generate summary
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                      TEST SUMMARY                             ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  
  const totalTests = testResults.length;
  const passedTests = testResults.filter(t => t.passed).length;
  const failedTests = totalTests - passedTests;
  const passRate = ((passedTests / totalTests) * 100).toFixed(1);
  const totalDuration = Date.now() - startTime;
  
  // Group by category
  const byCategory = new Map<string, { passed: number; failed: number }>();
  for (const result of testResults) {
    const cat = byCategory.get(result.category) || { passed: 0, failed: 0 };
    if (result.passed) cat.passed++;
    else cat.failed++;
    byCategory.set(result.category, cat);
  }
  
  console.log('\n📊 Results by Category:\n');
  for (const [category, stats] of byCategory) {
    const catTotal = stats.passed + stats.failed;
    const catRate = ((stats.passed / catTotal) * 100).toFixed(0);
    const emoji = stats.failed === 0 ? '✅' : '⚠️';
    console.log(`   ${emoji} ${category}: ${stats.passed}/${catTotal} passed (${catRate}%)`);
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`   Total Tests: ${totalTests}`);
  console.log(`   ✅ Passed: ${passedTests}`);
  console.log(`   ❌ Failed: ${failedTests}`);
  console.log(`   📈 Pass Rate: ${passRate}%`);
  console.log(`   ⏱️  Duration: ${totalDuration}ms`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // List failed tests
  if (failedTests > 0) {
    console.log('❌ FAILED TESTS:\n');
    for (const result of testResults.filter(t => !t.passed)) {
      console.log(`   • [${result.category}] ${result.name}`);
      console.log(`     Details: ${result.details}\n`);
    }
  }
  
  // Final verdict
  const allPassed = failedTests === 0;
  console.log('═══════════════════════════════════════════════════════════════');
  if (allPassed) {
    console.log('   🎉 ALL TESTS PASSED - SYSTEM IS PRODUCTION READY! 🎉');
  } else {
    console.log('   ⚠️  SOME TESTS FAILED - REVIEW REQUIRED');
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  process.exit(allPassed ? 0 : 1);
}

// Run tests
runAllTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
