/**
 * Hyper-Maximum Cryptocurrency Compensation System - Demo
 * 
 * This demo shows how to use the compensation enhancement layer
 * with all features enabled.
 */

import compensationSystem from './index';
import {
  compensationEngine,
  payoutScheduler,
  walletVerification,
  compensationGuarantee,
  computationalGrid,
  flashEngineRevenue,
  crawlerBounty,
  triBeamBroadcast,
} from './index';

/**
 * Demo 1: Complete System Startup
 */
async function demo1_startCompleteSystem() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DEMO 1: Complete System Startup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Start the entire compensation system
  await compensationSystem.start('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', {
    token: 'ETH',
    chain: 'ethereum',
    enableHourlyPayouts: true,
  });

  console.log('\n✅ Complete system is now running!\n');
}

/**
 * Demo 2: Recording Revenue Streams
 */
async function demo2_recordingRevenue() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DEMO 2: Recording Revenue from All 4 Sources');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 1. Computational Grid - GPU task
  console.log('📊 Recording GPU computational task...');
  const gpuTaskId = await computationalGrid.registerTask(
    'gpu',
    10000,  // 10,000 cycles
    'ethereum'
  );
  console.log(`   Task ID: ${gpuTaskId}\n`);

  // 2. Flash Engine - Arbitrage profit
  console.log('⚡ Recording flash arbitrage profit...');
  const profitId = await flashEngineRevenue.recordProfit(
    'arbitrage',
    '0.005',  // 0.005 ETH profit
    250,      // 250ms execution
    true      // reversible
  );
  console.log(`   Profit ID: ${profitId}\n`);

  // 3. Beneficial Crawler - Bounty completion
  console.log('🕷️ Recording crawler bounty...');
  const crawlerId = 'crawler-alpha-001';
  await crawlerBounty.claimTask(crawlerId);
  await crawlerBounty.completeTask(crawlerId, '0.0008');
  console.log(`   Crawler: ${crawlerId}\n`);

  // 4. Tri-Beam Broadcasting - Node revenue
  console.log('📡 Recording tri-beam broadcasting...');
  const nodeId = 'node-gamma-042';
  await triBeamBroadcast.registerNode(nodeId, 25); // 25 connections
  console.log(`   Node: ${nodeId}\n`);

  console.log('✅ All revenue streams recorded!\n');
}

/**
 * Demo 3: Manual Payout Trigger
 */
async function demo3_manualPayout() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DEMO 3: Manual Payout Trigger (Testing)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // First record some revenue
  await computationalGrid.registerTask('cpu', 5000, 'ethereum');
  await flashEngineRevenue.recordProfit('micro_delta', '0.002', 100, false);

  // Trigger immediate payout (instead of waiting for hourly schedule)
  console.log('💸 Triggering immediate payout...\n');
  const transaction = await payoutScheduler.triggerPayout();

  if (transaction) {
    console.log('\n✅ Payout completed!');
    console.log('   Transaction Hash:', transaction.txHash);
    console.log('   Amount:', transaction.amount, transaction.token);
    console.log('   Status:', transaction.status);
    console.log('   Verifications:', transaction.verifications.length, 'layers');
  }

  console.log('');
}

/**
 * Demo 4: Viewing System Statistics
 */
async function demo4_systemStatistics() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DEMO 4: System Statistics & Metrics');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const stats = compensationSystem.getStats();

  console.log('🔧 Engine State:');
  console.log('   Active:', stats.engine.isActive);
  console.log('   Current Cycle:', stats.engine.currentCycle);
  console.log('   Active Streams:', stats.engine.activeStreams);
  console.log('   Health:', stats.engine.healthStatus);
  console.log('');

  console.log('📈 HEPA Metrics:');
  if (stats.hepa) {
    console.log('   Current Yield:', stats.hepa.currentYield);
    console.log('   Target Yield:', stats.hepa.targetYield);
    console.log('   Opportunity Density:', stats.hepa.opportunityDensity.toFixed(2));
    console.log('   Reallocation Required:', stats.hepa.reallocationRequired);
    console.log('   High Priority Tasks:', stats.hepa.highPriorityTasks.length);
  }
  console.log('');

  console.log('🎯 SOCC Opportunities:');
  console.log('   Available Networks:', stats.socc.length);
  stats.socc.forEach(opp => {
    console.log(`   - ${opp.network}: Score ${opp.migrationScore.toFixed(2)}, ` +
                `Payment ${opp.paymentPerCycle}`);
  });
  console.log('');

  console.log('🔮 DORS Predictions:');
  console.log('   Active Predictions:', stats.dors.length);
  stats.dors.forEach(pred => {
    console.log(`   - ${pred.market}: ${(pred.priceSpikeProbability * 100).toFixed(0)}% ` +
                `spike probability, Premium: ${pred.premiumRate}`);
  });
  console.log('');

  console.log('💰 Revenue Breakdown:');
  console.log('   Grid Tasks:', stats.revenue.grid.activeTasks);
  console.log('   Flash Profits:', stats.revenue.flash.totalProfits);
  console.log('   Crawler Bounties:', stats.revenue.crawlers.length);
  console.log('   Tri-Beam Nodes:', stats.revenue.triBeam.totalNodes);
  console.log('');

  console.log('💸 Payout History:');
  console.log('   Total Payouts:', stats.payouts.history.length);
  console.log('   Pending Retries:', stats.payouts.pendingRetries.length);
  if (stats.payouts.current) {
    console.log('   Current Cycle:', stats.payouts.current.cycleNumber);
    console.log('   Status:', stats.payouts.current.status);
  }
  console.log('');
}

/**
 * Demo 5: Wallet Verification & Multi-Path Delivery
 */
async function demo5_walletVerification() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DEMO 5: Wallet Verification & Multi-Path Delivery');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';

  // Tier 1: Verify wallet integrity
  console.log('🔐 Tier 1: Verifying wallet integrity...');
  const verified = await walletVerification.verifyWalletIntegrity(walletAddress);
  console.log('   Verified:', verified);
  console.log('');

  // Tier 2: Multi-path route setup
  console.log('🛣️ Tier 2: Setting up multi-path routes...');
  const route = walletVerification.setupMultiPathRoute(
    'ethereum',
    'https://mainnet.infura.io/v3/YOUR_KEY',
    'https://mainnet-secondary.infura.io/v3/YOUR_KEY',
    'polygon',
    'polygon-ethereum-bridge'
  );
  console.log('   Primary:', route.primary.network);
  console.log('   Secondary:', route.secondary.network);
  console.log('   Backup Chain:', route.backup.chain);
  console.log('');

  // View all wallet bindings
  console.log('📊 Current Wallet Bindings:');
  const bindings = walletVerification.getWalletBindings();
  bindings.forEach(binding => {
    console.log(`   - ${binding.address.substring(0, 10)}...`);
    console.log(`     Chain: ${binding.chainId}`);
    console.log(`     Verified: ${binding.verified}`);
    console.log(`     Integrity Checks: ${binding.integrityChecks}`);
  });
  console.log('');
}

/**
 * Demo 6: Compensation Guarantee System
 */
async function demo6_compensationGuarantee() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DEMO 6: Fail-Proof Compensation Guarantee');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Record some revenue and trigger payout
  await computationalGrid.registerTask('gpu', 8000, 'ethereum');
  const transaction = await payoutScheduler.triggerPayout();

  if (transaction) {
    // Create compensation assurance
    console.log('🛡️ Creating compensation assurance...');
    const assurance = await compensationGuarantee.createAssurance(
      transaction.id,
      transaction
    );

    console.log('\n✅ Assurance Created:');
    console.log('   Guarantee Level:', assurance.guaranteeLevel);
    console.log('   Guaranteed:', assurance.guaranteed);
    console.log('   Crawler Verifications:', assurance.crawlerVerifications);
    console.log('   Consensus Confirmations:', assurance.consensusConfirmations);
    console.log('   Redundant Issues:', assurance.redundantIssues);
    console.log('   Correction Cycles:', assurance.correctionCycles);
    console.log('');

    // Verify guarantee
    const guaranteed = await compensationGuarantee.verifyGuarantee(transaction.id);
    console.log('🔍 Guarantee Verification:', guaranteed ? '✅ ABSOLUTE' : '⚠️ Pending');
  }

  console.log('');
}

/**
 * Demo 7: Real-time Event Monitoring
 */
async function demo7_eventMonitoring() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DEMO 7: Real-time Event Monitoring');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('📡 Setting up event listeners...\n');

  // Listen to compensation events
  compensationEngine.on('compensation', (stream) => {
    console.log('💵 New compensation received:', {
      source: stream.source,
      amount: stream.amount,
      token: stream.token,
    });
  });

  // Listen to HEPA reallocation events
  compensationEngine.on('hepa-reallocation', (metrics) => {
    console.log('📈 HEPA recommends reallocation:', {
      opportunityDensity: metrics.opportunityDensity.toFixed(2),
      highPriorityTasks: metrics.highPriorityTasks.length,
    });
  });

  // Listen to payout events
  payoutScheduler.on('payout-completed', (tx) => {
    console.log('✅ Payout completed:', {
      txHash: tx.txHash,
      amount: tx.amount,
      token: tx.token,
    });
  });

  // Listen to verification events
  walletVerification.on('wallet-bound', (binding) => {
    console.log('🔗 Wallet bound:', binding.address.substring(0, 10) + '...');
  });

  // Trigger some events
  console.log('⚡ Triggering events...\n');
  await computationalGrid.registerTask('gpu', 3000, 'ethereum');
  await flashEngineRevenue.recordProfit('arbitrage', '0.003', 120, true);

  console.log('\n✅ Event monitoring active!\n');
}

/**
 * Main Demo Runner
 */
async function runAllDemos() {
  try {
    await demo1_startCompleteSystem();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await demo2_recordingRevenue();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await demo3_manualPayout();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await demo4_systemStatistics();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await demo5_walletVerification();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await demo6_compensationGuarantee();
    await new Promise(resolve => setTimeout(resolve, 2000));

    await demo7_eventMonitoring();
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Stop the system
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🛑 Shutting down compensation system...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    await compensationSystem.stop();
    
    console.log('✅ Demo complete! System shut down successfully.\n');

  } catch (error) {
    console.error('❌ Demo error:', error);
  }
}

/**
 * Run specific demo
 */
async function runDemo(demoNumber: number) {
  const demos = [
    demo1_startCompleteSystem,
    demo2_recordingRevenue,
    demo3_manualPayout,
    demo4_systemStatistics,
    demo5_walletVerification,
    demo6_compensationGuarantee,
    demo7_eventMonitoring,
  ];

  if (demoNumber < 1 || demoNumber > demos.length) {
    console.error('Invalid demo number. Choose 1-7 or run runAllDemos()');
    return;
  }

  await demos[demoNumber - 1]();
}

// Export for use
export {
  runAllDemos,
  runDemo,
  demo1_startCompleteSystem,
  demo2_recordingRevenue,
  demo3_manualPayout,
  demo4_systemStatistics,
  demo5_walletVerification,
  demo6_compensationGuarantee,
  demo7_eventMonitoring,
};

// If running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const demoNum = parseInt(process.argv[2] || '0');
  
  if (demoNum === 0) {
    runAllDemos();
  } else {
    runDemo(demoNum);
  }
}
