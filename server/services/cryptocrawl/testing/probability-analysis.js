#!/usr/bin/env node
/**
 * PROBABILITY ANALYSIS: Chance of Achieving Less Than $5,000/day
 * 
 * This script runs extensive Monte Carlo simulations to calculate
 * the exact probability of falling below the $5,000/day target
 * under real-world poor day conditions.
 */

// ============================================
// CONFIGURATION
// ============================================
const MONTE_CARLO_SIMULATIONS = 10000; // High count for accuracy
const TARGET_USD = 5000;

// Poor day conditions (same as main optimization)
const POOR_DAY_CONDITIONS = {
  enabled: true,
  opportunityReduction: 0.5,
  successRatePenalty: 0.15,
  profitReduction: 0.4,
  slippageIncrease: 2.0,
  gasSpikeProbability: 0.2,
  gasSpikeMultiplier: 3.0,
  competitionIncrease: 1.5,
  liquidityReduction: 0.3,
  networkCongestion: 0.15,
  flashLoanAvailability: 0.85
};

// Optimized strategy from previous run
const OPTIMIZED_STRATEGY = {
  name: 'Multi-DEX Flash Arbitrage (Optimized)',
  mechanism: 'flashLoans',
  baseSuccessRate: 0.60,           // After 15 iterations of optimization
  avgProfitPerTrade: 0.015,        // 1.5%
  avgLossPerTrade: 0.0001,
  tradesPerDay: 618,
  flashLoanFee: 0.000232,
  gasEstimate: 0.0002,
  slippageTolerance: 0.004,
  chains: ['polygon', 'arbitrum', 'base']
};

// ============================================
// SIMULATION ENGINE
// ============================================
function randomNormal(mean = 0, stdDev = 1) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z0 * stdDev + mean;
}

function simulateDay(strategy, poorDay) {
  let dailyProfit = 0;
  let wins = 0;
  let losses = 0;
  
  const effectiveTrades = poorDay.enabled 
    ? Math.floor(strategy.tradesPerDay * poorDay.opportunityReduction)
    : strategy.tradesPerDay;
  
  for (let trade = 0; trade < effectiveTrades; trade++) {
    // Opportunity check
    const baseOpportunityRate = poorDay.enabled ? 0.2 : 0.4;
    if (Math.random() >= baseOpportunityRate) continue;
    
    // Flash loan availability
    const availabilityRate = poorDay.enabled ? poorDay.flashLoanAvailability : 0.98;
    if (Math.random() >= availabilityRate) continue;
    
    // Liquidity check
    if (poorDay.enabled && Math.random() < poorDay.liquidityReduction) continue;
    
    // Network congestion
    if (poorDay.enabled && Math.random() < poorDay.networkCongestion) {
      losses++;
      continue;
    }
    
    // Success rate calculation
    let successRate = strategy.baseSuccessRate + randomNormal(0, 0.05);
    if (poorDay.enabled) {
      successRate -= poorDay.successRatePenalty;
      successRate *= (1 - poorDay.competitionIncrease * 0.1);
    }
    successRate = Math.max(0.05, Math.min(0.9, successRate));
    
    const isWin = Math.random() < successRate;
    
    if (isWin) {
      let profit = strategy.avgProfitPerTrade * (1 + randomNormal(0, 0.3));
      
      if (poorDay.enabled) {
        profit *= (1 - poorDay.profitReduction);
      }
      
      // Fees
      const baseFee = strategy.flashLoanFee;
      let fee = baseFee * (1 + randomNormal(0, 0.1));
      if (poorDay.enabled) fee *= 1.5;
      profit -= fee;
      
      // Gas
      let gasShare = strategy.gasEstimate;
      if (poorDay.enabled && Math.random() < poorDay.gasSpikeProbability) {
        gasShare *= poorDay.gasSpikeMultiplier;
      }
      profit -= gasShare;
      
      // Slippage
      let slippage = strategy.slippageTolerance * Math.random();
      if (poorDay.enabled) slippage *= poorDay.slippageIncrease;
      profit -= slippage;
      
      if (profit > 0) {
        dailyProfit += profit;
        wins++;
      } else {
        losses++;
      }
    } else {
      dailyProfit -= strategy.avgLossPerTrade;
      losses++;
    }
  }
  
  // Scale to USD ($100K flash loan size)
  const avgFlashLoanSize = 100000;
  return {
    profitUSD: dailyProfit * avgFlashLoanSize,
    wins,
    losses,
    winRate: (wins + losses) > 0 ? wins / (wins + losses) : 0
  };
}

// ============================================
// MAIN ANALYSIS
// ============================================
function runProbabilityAnalysis() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║     PROBABILITY ANALYSIS: Chance of < $5,000/day in Real-World Application          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('\n');
  
  console.log(`Running ${MONTE_CARLO_SIMULATIONS.toLocaleString()} Monte Carlo simulations...\n`);
  
  const results = [];
  
  for (let i = 0; i < MONTE_CARLO_SIMULATIONS; i++) {
    const dayResult = simulateDay(OPTIMIZED_STRATEGY, POOR_DAY_CONDITIONS);
    results.push(dayResult.profitUSD);
    
    // Progress indicator
    if ((i + 1) % 1000 === 0) {
      process.stdout.write(`   Progress: ${((i + 1) / MONTE_CARLO_SIMULATIONS * 100).toFixed(0)}%\r`);
    }
  }
  
  console.log('\n');
  
  // Sort results
  const sorted = [...results].sort((a, b) => a - b);
  
  // Calculate statistics
  const avg = results.reduce((a, b) => a + b, 0) / results.length;
  const variance = results.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / results.length;
  const stdDev = Math.sqrt(variance);
  
  // Count days below target
  const daysBelow5K = results.filter(r => r < TARGET_USD).length;
  const daysBelow4K = results.filter(r => r < 4000).length;
  const daysBelow3K = results.filter(r => r < 3000).length;
  const daysBelow2K = results.filter(r => r < 2000).length;
  const daysBelow1K = results.filter(r => r < 1000).length;
  const daysBelow0 = results.filter(r => r < 0).length;
  
  const daysAbove5K = results.filter(r => r >= TARGET_USD).length;
  const daysAbove10K = results.filter(r => r >= 10000).length;
  const daysAbove15K = results.filter(r => r >= 15000).length;
  
  // Percentiles
  const getPercentile = (p) => sorted[Math.floor(sorted.length * p)];
  
  // ============================================
  // DISPLAY RESULTS
  // ============================================
  
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                           PROBABILITY RESULTS                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  console.log('📊 CORE STATISTICS');
  console.log('─'.repeat(70));
  console.log(`   Simulations Run:           ${MONTE_CARLO_SIMULATIONS.toLocaleString()}`);
  console.log(`   Average Daily Profit:      $${avg.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`   Median Daily Profit:       $${getPercentile(0.5).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`   Standard Deviation:        $${stdDev.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`   Minimum Day:               $${sorted[0].toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`   Maximum Day:               $${sorted[sorted.length - 1].toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log('');
  
  console.log('🎯 PROBABILITY OF FALLING BELOW TARGET');
  console.log('─'.repeat(70));
  console.log(`   P(Profit < $5,000/day):    ${(daysBelow5K / MONTE_CARLO_SIMULATIONS * 100).toFixed(2)}%  (${daysBelow5K.toLocaleString()} of ${MONTE_CARLO_SIMULATIONS.toLocaleString()} days)`);
  console.log(`   P(Profit < $4,000/day):    ${(daysBelow4K / MONTE_CARLO_SIMULATIONS * 100).toFixed(2)}%  (${daysBelow4K.toLocaleString()} days)`);
  console.log(`   P(Profit < $3,000/day):    ${(daysBelow3K / MONTE_CARLO_SIMULATIONS * 100).toFixed(2)}%  (${daysBelow3K.toLocaleString()} days)`);
  console.log(`   P(Profit < $2,000/day):    ${(daysBelow2K / MONTE_CARLO_SIMULATIONS * 100).toFixed(2)}%  (${daysBelow2K.toLocaleString()} days)`);
  console.log(`   P(Profit < $1,000/day):    ${(daysBelow1K / MONTE_CARLO_SIMULATIONS * 100).toFixed(2)}%  (${daysBelow1K.toLocaleString()} days)`);
  console.log(`   P(Profit < $0/day):        ${(daysBelow0 / MONTE_CARLO_SIMULATIONS * 100).toFixed(2)}%  (${daysBelow0.toLocaleString()} days) [LOSING DAY]`);
  console.log('');
  
  console.log('✅ PROBABILITY OF MEETING/EXCEEDING TARGET');
  console.log('─'.repeat(70));
  console.log(`   P(Profit >= $5,000/day):   ${(daysAbove5K / MONTE_CARLO_SIMULATIONS * 100).toFixed(2)}%  (${daysAbove5K.toLocaleString()} days)`);
  console.log(`   P(Profit >= $10,000/day):  ${(daysAbove10K / MONTE_CARLO_SIMULATIONS * 100).toFixed(2)}%  (${daysAbove10K.toLocaleString()} days)`);
  console.log(`   P(Profit >= $15,000/day):  ${(daysAbove15K / MONTE_CARLO_SIMULATIONS * 100).toFixed(2)}%  (${daysAbove15K.toLocaleString()} days)`);
  console.log('');
  
  console.log('📈 PERCENTILE DISTRIBUTION');
  console.log('─'.repeat(70));
  console.log(`   1st Percentile (Worst 1%): $${getPercentile(0.01).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`   5th Percentile:            $${getPercentile(0.05).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`   10th Percentile:           $${getPercentile(0.10).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`   25th Percentile:           $${getPercentile(0.25).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`   50th Percentile (Median):  $${getPercentile(0.50).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`   75th Percentile:           $${getPercentile(0.75).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`   90th Percentile:           $${getPercentile(0.90).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`   95th Percentile:           $${getPercentile(0.95).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`   99th Percentile (Best 1%): $${getPercentile(0.99).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log('');
  
  // Value at Risk
  const VaR95 = getPercentile(0.05);
  const VaR99 = getPercentile(0.01);
  
  console.log('⚠️  RISK METRICS');
  console.log('─'.repeat(70));
  console.log(`   Value at Risk (95%):       $${VaR95.toLocaleString(undefined, {maximumFractionDigits: 0})} (95% of days will be above this)`);
  console.log(`   Value at Risk (99%):       $${VaR99.toLocaleString(undefined, {maximumFractionDigits: 0})} (99% of days will be above this)`);
  console.log('');
  
  // Monthly/Annual projections
  const monthlyAvg = avg * 30;
  const annualAvg = avg * 365;
  const monthlyWorstCase = VaR95 * 30;
  const annualWorstCase = VaR95 * 365;
  
  console.log('💰 PROJECTED EARNINGS');
  console.log('─'.repeat(70));
  console.log(`   Expected Monthly:          $${monthlyAvg.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`   Expected Annual:           $${annualAvg.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`   Worst-Case Monthly (5%):   $${monthlyWorstCase.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`   Worst-Case Annual (5%):    $${annualWorstCase.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log('');
  
  // Final answer
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              FINAL ANSWER                                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`   🎯 PROBABILITY OF ACHIEVING LESS THAN $5,000/DAY:`);
  console.log('');
  console.log(`      ╔════════════════════════════════════════════╗`);
  console.log(`      ║                                            ║`);
  console.log(`      ║     ${(daysBelow5K / MONTE_CARLO_SIMULATIONS * 100).toFixed(2)}% chance of < $5,000/day     ║`);
  console.log(`      ║                                            ║`);
  console.log(`      ╚════════════════════════════════════════════╝`);
  console.log('');
  console.log(`   This means on ${(100 - daysBelow5K / MONTE_CARLO_SIMULATIONS * 100).toFixed(2)}% of days (even under poor conditions),`);
  console.log(`   you will achieve $5,000 or more.`);
  console.log('');
  console.log(`   In a typical month (30 days), you can expect:`);
  console.log(`   • ~${Math.round(daysBelow5K / MONTE_CARLO_SIMULATIONS * 30)} days below $5,000`);
  console.log(`   • ~${Math.round((1 - daysBelow5K / MONTE_CARLO_SIMULATIONS) * 30)} days at or above $5,000`);
  console.log('');
  
  // Output for programmatic use
  console.log(`PROBABILITY_BELOW_5K=${(daysBelow5K / MONTE_CARLO_SIMULATIONS * 100).toFixed(2)}%`);
  console.log(`PROBABILITY_ABOVE_5K=${(daysAbove5K / MONTE_CARLO_SIMULATIONS * 100).toFixed(2)}%`);
  console.log(`AVERAGE_DAILY_PROFIT=$${avg.toFixed(2)}`);
  console.log(`MEDIAN_DAILY_PROFIT=$${getPercentile(0.5).toFixed(2)}`);
}

// Run
runProbabilityAnalysis();
