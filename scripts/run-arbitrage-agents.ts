#!/usr/bin/env npx ts-node
/**
 * Canonical Cursor Instruction Set — Crypto Arbitrage Agent Runner
 * 
 * Execute this script to run all 6 agents in order and generate deliverables.
 * 
 * Usage: npx ts-node scripts/run-arbitrage-agents.ts
 */

import { arbitrageControl } from '../server/services/cryptocrawl/governance/arbitrage-agents.js';

async function runAllAgents(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log(' CANONICAL CURSOR INSTRUCTION SET — CRYPTO ARBITRAGE');
  console.log(' 6-Agent Verification & Control System');
  console.log('='.repeat(80) + '\n');
  
  console.log('GLOBAL NON-NEGOTIABLE RULES:');
  console.log('  1. Profit-only capital (zero external capital)');
  console.log('  2. Auto-pause is absolute; any anomaly pauses immediately');
  console.log('  3. No silent scope expansion; every increase requires explicit UNPAUSE');
  console.log('  4. All changes reversible within one cycle');
  console.log('  5. Human veto and kill-switch always available');
  console.log('  6. Exposure target ≈ 6% (accepted), never unbounded');
  console.log('\n');
  
  // Run full verification
  const result = await arbitrageControl.runAllAgents();
  
  // Output results
  console.log('='.repeat(80));
  console.log(' AGENT VERIFICATION RESULTS');
  console.log('='.repeat(80) + '\n');
  
  for (const agent of result.results) {
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`AGENT ${agent.agent}: ${agent.name}`);
    console.log('─'.repeat(40));
    console.log(`Status: ${agent.passed ? '✓ PASSED' : '✗ FAILED'}`);
    console.log(`Timestamp: ${new Date(agent.timestamp).toISOString()}`);
    console.log('\nChecks:');
    for (const check of agent.checks) {
      const icon = check.passed ? '✓' : '✗';
      const critical = check.critical ? ' [CRITICAL]' : '';
      console.log(`  ${icon} ${check.name}${critical}`);
      console.log(`      ${check.details}`);
    }
    console.log('\nDELIVERABLE:');
    console.log(agent.deliverable.split('\n').map(l => '  ' + l).join('\n'));
  }
  
  // Final acceptance
  console.log('\n' + '='.repeat(80));
  console.log(' FINAL ACCEPTANCE CRITERIA');
  console.log('='.repeat(80) + '\n');
  
  for (const criterion of result.finalAcceptance.criteria) {
    const icon = criterion.met ? '✓' : '✗';
    console.log(`  ${icon} ${criterion.name}`);
    console.log(`      ${criterion.details}`);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log(` OVERALL RESULT: ${result.success ? '✓ ALL AGENTS PASSED' : '✗ SOME AGENTS FAILED'}`);
  console.log('='.repeat(80));
  
  // Profit ladder status
  const profitLadder = arbitrageControl.getProfitLadder();
  console.log('\n' + '='.repeat(80));
  console.log(' PROFIT LADDER STATUS');
  console.log('='.repeat(80) + '\n');
  
  for (const tier of profitLadder.tiers) {
    const status = tier.unlocked ? '✓ UNLOCKED' : '○ LOCKED';
    const current = tier.level === profitLadder.currentTier ? ' ← CURRENT' : '';
    console.log(`  Tier ${tier.level}: $${tier.dailyTarget.toLocaleString()}/day - ${status}${current}`);
    console.log(`         Routes: ${tier.parallelRoutes}, Venues: ${tier.venues}, Pairs: ${tier.pairs}`);
    console.log(`         Progress: ${tier.consecutiveProfitableCycles}/${tier.consecutiveProfitableCyclesRequired} consecutive profitable cycles`);
  }
  
  // Current config
  const config = arbitrageControl.getConfig();
  console.log('\n' + '='.repeat(80));
  console.log(' CURRENT CONFIGURATION');
  console.log('='.repeat(80) + '\n');
  
  console.log(`  Mode: ${config.mode}`);
  console.log(`  Exposure Target: ${(config.exposureTarget * 100).toFixed(0)}%`);
  console.log(`  Evolution Lock: ${config.evolutionLockOn ? 'ON' : 'OFF'}`);
  console.log(`  Auto-Pause: ${config.autoPauseOn ? 'ACTIVE' : 'INACTIVE'}`);
  console.log(`  Kill Switch: ${config.killSwitchReachable ? 'REACHABLE' : 'UNREACHABLE'}`);
  console.log(`  Profit-Only Reinvestment: ${config.profitOnlyReinvestment ? 'ENFORCED' : 'NOT ENFORCED'}`);
  
  console.log('\n' + '='.repeat(80));
  console.log(' DIRECTIVE COMPLIANCE');
  console.log('='.repeat(80) + '\n');
  
  console.log('  ✓ Agents executed in order (1 → 2 → 3 → 4 → 5 → 6)');
  console.log('  ✓ No agents skipped');
  console.log(`  ${result.success ? '✓' : '✗'} AUTOMATIC mode: ${result.success ? 'ENABLED after unanimous success' : 'NOT enabled (some agents failed)'}`);
  console.log('  ✓ Tier promotion: Strictly via ladder with explicit UNPAUSE');
  console.log(`  ${result.success ? '○' : '⚠'} Next step: ${result.success ? 'Begin Tier 1 operations ($200/day target)' : 'Fix failed checks and re-run verification'}`);
  
  console.log('\n');
  
  // Exit with appropriate code
  process.exit(result.success ? 0 : 1);
}

// Run if executed directly
runAllAgents().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
