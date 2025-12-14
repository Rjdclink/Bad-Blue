#!/usr/bin/env npx ts-node
/**
 * Arbitrage Auto-Pilot Test Runner
 * 
 * Stage Two: Run small, controlled live cycles to prove consistency
 * 
 * Usage:
 *   npx ts-node server/services/cryptocrawl/faucet/run-autopilot-test.ts
 * 
 * Environment:
 *   TARGET_WALLET - The wallet address for profits (required)
 *   ALCHEMY_API_KEY - Alchemy API key for RPC
 *   TEST_CYCLES - Number of cycles to run (default: 3)
 */

import { arbitrageAutopilot } from './arbitrage-autopilot.js';
import { gasOracle } from '../bridge/gas-oracle.js';
import { createLogger } from '../../../logger.js';

const log = createLogger('AutopilotTest');

// Test configuration
const TEST_CONFIG = {
  targetWallet: process.env.TARGET_WALLET || '',
  testCycles: parseInt(process.env.TEST_CYCLES || '3', 10),
  tradeSizeUsd: 100,    // Small controlled trades
  minProfitUsd: 2,      // Lower threshold for testing
  maxGasCostUsd: 3,     // Higher tolerance for testing
  cycleDelayMs: 10000,  // 10 seconds between cycles
};

async function runTest(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 ARBITRAGE AUTO-PILOT TEST');
  console.log('   Stage Two: Controlled Live Cycles');
  console.log('='.repeat(60) + '\n');

  // Validate environment
  if (!TEST_CONFIG.targetWallet) {
    console.error('❌ TARGET_WALLET environment variable is required');
    console.error('   Set it to your wallet address: export TARGET_WALLET=0x...');
    process.exit(1);
  }

  console.log('📋 Test Configuration:');
  console.log(`   Target Wallet: ${TEST_CONFIG.targetWallet.substring(0, 10)}...`);
  console.log(`   Test Cycles: ${TEST_CONFIG.testCycles}`);
  console.log(`   Trade Size: $${TEST_CONFIG.tradeSizeUsd}`);
  console.log(`   Min Profit: $${TEST_CONFIG.minProfitUsd}`);
  console.log(`   Max Gas: $${TEST_CONFIG.maxGasCostUsd}`);
  console.log('');

  // Initialize systems
  console.log('🔧 Initializing systems...');
  
  try {
    // Start gas oracle
    await gasOracle.start();
    console.log('   ✓ Gas oracle started');

    // Configure autopilot
    arbitrageAutopilot.setTargetWallet(TEST_CONFIG.targetWallet);
    arbitrageAutopilot.configure({
      tradeSizeUsd: TEST_CONFIG.tradeSizeUsd,
      minProfitUsd: TEST_CONFIG.minProfitUsd,
      maxGasCostUsd: TEST_CONFIG.maxGasCostUsd,
    });
    console.log('   ✓ Autopilot configured');

    // Health check
    const health = await arbitrageAutopilot.healthCheck();
    console.log(`   ✓ Health status: ${health.status}`);
    health.checks.forEach(c => {
      console.log(`     ${c.pass ? '✓' : '✗'} ${c.name}: ${c.details}`);
    });

    if (health.status === 'unhealthy') {
      console.error('\n❌ System unhealthy - aborting test');
      await gasOracle.stop();
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Initialization failed:', error);
    await gasOracle.stop();
    process.exit(1);
  }

  console.log('\n' + '-'.repeat(60));
  console.log('🚀 STARTING TEST CYCLES');
  console.log('-'.repeat(60) + '\n');

  // Run test cycles
  const results: Array<{
    cycle: number;
    success: boolean;
    profit: number;
    duration: number;
    opportunities: number;
  }> = [];

  for (let i = 1; i <= TEST_CONFIG.testCycles; i++) {
    console.log(`\n📊 Cycle ${i}/${TEST_CONFIG.testCycles}`);
    console.log('-'.repeat(40));

    try {
      const report = await arbitrageAutopilot.runControlledCycle();
      
      results.push({
        cycle: i,
        success: report.successful > 0,
        profit: report.totalProfit,
        duration: report.endTime - report.startTime,
        opportunities: report.validOpportunities,
      });

      console.log(`   Result: ${report.successful > 0 ? '✓ SUCCESS' : '○ NO TRADE'}`);
      console.log(`   Opportunities: ${report.validOpportunities} valid`);
      console.log(`   Profit: $${report.totalProfit.toFixed(2)}`);
      console.log(`   Duration: ${report.endTime - report.startTime}ms`);

    } catch (error) {
      console.error(`   ❌ Cycle failed:`, error);
      results.push({
        cycle: i,
        success: false,
        profit: 0,
        duration: 0,
        opportunities: 0,
      });
    }

    // Wait between cycles
    if (i < TEST_CONFIG.testCycles) {
      console.log(`\n⏳ Waiting ${TEST_CONFIG.cycleDelayMs / 1000}s before next cycle...`);
      await new Promise(resolve => setTimeout(resolve, TEST_CONFIG.cycleDelayMs));
    }
  }

  // Generate summary
  console.log('\n' + '='.repeat(60));
  console.log('📈 TEST SUMMARY');
  console.log('='.repeat(60));

  const successful = results.filter(r => r.success).length;
  const totalProfit = results.reduce((sum, r) => sum + r.profit, 0);
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const totalOpportunities = results.reduce((sum, r) => sum + r.opportunities, 0);

  console.log(`\n   Cycles Run: ${results.length}`);
  console.log(`   Successful: ${successful} (${(successful / results.length * 100).toFixed(1)}%)`);
  console.log(`   Total Profit: $${totalProfit.toFixed(2)}`);
  console.log(`   Avg Duration: ${avgDuration.toFixed(0)}ms`);
  console.log(`   Opportunities Found: ${totalOpportunities}`);

  // Individual cycle results
  console.log('\n   Cycle Details:');
  results.forEach(r => {
    const status = r.success ? '✓' : '○';
    console.log(`     ${status} Cycle ${r.cycle}: $${r.profit.toFixed(2)} profit, ${r.opportunities} opps, ${r.duration}ms`);
  });

  // Final status
  const status = arbitrageAutopilot.getStatus();
  console.log('\n   Final Status:');
  console.log(`     Total Cycles: ${status.cycles}`);
  console.log(`     Total Profit: $${status.totalProfit.toFixed(2)}`);

  // Cleanup
  console.log('\n🛑 Cleaning up...');
  await gasOracle.stop();
  console.log('   ✓ Gas oracle stopped');

  console.log('\n' + '='.repeat(60));
  console.log('✅ TEST COMPLETE');
  console.log('='.repeat(60) + '\n');

  process.exit(successful > 0 ? 0 : 1);
}

// Handle errors
process.on('unhandledRejection', async (reason) => {
  console.error('❌ Unhandled rejection:', reason);
  await gasOracle.stop();
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Interrupted - cleaning up...');
  arbitrageAutopilot.stopAutopilot();
  await gasOracle.stop();
  process.exit(0);
});

// Run test
runTest().catch(async (error) => {
  console.error('❌ Test failed:', error);
  await gasOracle.stop();
  process.exit(1);
});
