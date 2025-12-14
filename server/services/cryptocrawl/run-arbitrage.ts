#!/usr/bin/env node
/**
 * ONE-SCREEN ARBITRAGE RUNNER
 * 
 * Run automated arbitrage with real price feeds and proper cost calculations.
 * 
 * Usage:
 *   npm run arbitrage              # Dry run (safe, no real transactions)
 *   npm run arbitrage -- --live    # Live mode (real transactions)
 */

import { AutomatedArbitrageController } from './arbitrage-automation';
import { createLogger } from '../../logger';

const log = createLogger('ArbitrageRunner');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  pair: process.env.ARB_PAIR || 'ETH/USDC',
  tradeSize: parseInt(process.env.ARB_TRADE_SIZE || '10000'),
  maxCycles: parseInt(process.env.ARB_MAX_CYCLES || '10'),
  dryRun: !process.argv.includes('--live'),
};

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('🎯 AUTOMATED ARBITRAGE CONTROLLER - STAGE TWO');
  console.log('═'.repeat(70));
  console.log();
  console.log('Configuration:');
  console.log('  Pair:', CONFIG.pair);
  console.log('  Trade Size:', `$${CONFIG.tradeSize.toLocaleString()}`);
  console.log('  Max Cycles:', CONFIG.maxCycles);
  console.log('  Mode:', CONFIG.dryRun ? '🟢 DRY RUN (SAFE)' : '🔴 LIVE (REAL MONEY)');
  console.log();
  
  if (!CONFIG.dryRun) {
    console.log('⚠️  WARNING: LIVE MODE ENABLED ⚠️');
    console.log('Real transactions will be executed on the blockchain!');
    console.log();
    console.log('Waiting 10 seconds... Press Ctrl+C to cancel');
    await sleep(10000);
  }
  
  console.log('═'.repeat(70));
  console.log();
  
  // Initialize controller
  const controller = new AutomatedArbitrageController();
  await controller.initialize();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutdown signal received');
    controller.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('\n\n🛑 Shutdown signal received');
    controller.stop();
    process.exit(0);
  });
  
  // Start arbitrage cycles
  await controller.start(
    CONFIG.pair,
    CONFIG.tradeSize,
    CONFIG.maxCycles,
    CONFIG.dryRun
  );
  
  console.log('\n✅ Arbitrage controller stopped gracefully\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run
main().catch(error => {
  log.error('Fatal error', { error });
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
