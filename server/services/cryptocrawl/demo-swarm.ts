// Demo - Ultimate Hyper-Evolving Swarm Strategy
// Demonstrates initialization and operation of the swarm

import { swarmOrchestrator } from './agents/swarm-orchestrator';
import { eden } from './eden/service';
import { LuxSwarm } from './core/lux-swarm';
import type { Opportunity } from './core/lux-swarm';

async function demoSwarmInitialization() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ULTIMATE HYPER-EVOLVING SWARM STRATEGY - DEMO');
  console.log('  "The name of God is profitability"');
  console.log('═══════════════════════════════════════════════════════\n');

  try {
    // Initialize the swarm
    console.log('🚀 Initializing swarm...\n');
    await swarmOrchestrator.initialize();

    // Get initial statistics
    console.log('\n📊 Initial Swarm Statistics:');
    const initialStats = swarmOrchestrator.getStatistics();
    console.log(JSON.stringify(initialStats, null, 2));

    // Simulate some opportunities
    console.log('\n💰 Simulating opportunities...\n');
    const opportunities: Opportunity[] = [
      {
        asset: 'USDC',
        pair: 'USDC/USDT',
        chain: 'polygon',
        priority: 75,
        profitEstimate: 0.05,
        timestamp: Date.now(),
      },
      {
        asset: 'WETH',
        pair: 'WETH/USDC',
        chain: 'arbitrum',
        priority: 85,
        profitEstimate: 0.12,
        timestamp: Date.now(),
      },
      {
        asset: 'AVAX',
        pair: 'AVAX/USDT',
        chain: 'avalanche',
        priority: 65,
        profitEstimate: 0.03,
        timestamp: Date.now(),
      },
    ];

    // Emit opportunities to Lux Swarm
    LuxSwarm.emit({ opportunities });

    console.log('✅ Opportunities emitted to Lux Swarm\n');

    // Demonstrate Eden functions
    console.log('🌳 Testing Eden Knowledge Repository...\n');

    // Check profitability objective
    const profit = 0.05;
    const risk = 0.1;
    const cost = 0.001;
    const objective = eden.calculateProfitabilityObjective(profit, risk, cost, 0);
    console.log(`📈 Profitability Objective: ${objective.toFixed(4)}`);

    // Calculate priority score
    const priorityScore = eden.calculatePriorityScore(profit, risk, 250, 10000);
    console.log(`🎯 Priority Score: ${priorityScore.toFixed(4)}\n`);

    // Check ethical guards
    console.log('🛡️ Checking ethical guards...');
    const ethicalCheck = await eden.checkEthicalGuards({
      type: 'execution',
      opportunity: opportunities[0],
    });
    console.log(`   Status: ${ethicalCheck.passed ? '✅ PASSED' : '❌ FAILED'}`);
    if (!ethicalCheck.passed) {
      console.log(`   Violations: ${ethicalCheck.violations.join(', ')}`);
    }
    console.log('');

    // Get Cain states
    console.log('👑 Cain Crawler States:');
    const cainStates = eden.getCainStates();
    cainStates.forEach((state, id) => {
      console.log(`   ${id}: ${state.type} (${state.status})`);
    });
    console.log('');

    // Get strategy templates
    console.log('📚 Strategy Templates:');
    const strategies = eden.getStrategyTemplates();
    strategies.forEach((template, id) => {
      console.log(`   ${template.name} v${template.version}`);
      console.log(`      Profitability: ${template.profitabilityScore.toFixed(2)}`);
      console.log(`      Success Rate: ${(template.successRate * 100).toFixed(1)}%`);
    });
    console.log('');

    // Run for a short time
    console.log('⏱️  Running swarm for 10 seconds...\n');
    
    // Start swarm (non-blocking)
    const swarmPromise = swarmOrchestrator.start();
    
    // Wait 10 seconds
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Stop swarm
    console.log('🛑 Stopping swarm...\n');
    await swarmOrchestrator.stop();

    // Get final statistics
    console.log('📊 Final Swarm Statistics:');
    const finalStats = swarmOrchestrator.getStatistics();
    console.log(JSON.stringify(finalStats, null, 2));

    console.log('\n✅ Demo completed successfully!');
    console.log('\n═══════════════════════════════════════════════════════');

  } catch (error) {
    console.error('\n❌ Demo error:', error);
    throw error;
  }
}

// Run demo if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demoSwarmInitialization()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { demoSwarmInitialization };
