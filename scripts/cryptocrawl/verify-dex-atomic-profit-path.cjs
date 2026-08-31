'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`[dex-atomic] missing required source: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

function requirePattern(source, pattern, description) {
  if (!pattern.test(source)) throw new Error(`[dex-atomic] missing invariant: ${description}`);
}

function forbidPattern(source, pattern, description) {
  if (pattern.test(source)) throw new Error(`[dex-atomic] forbidden regression: ${description}`);
}

const discovery = read('server/services/cryptocrawl/discovery/dex-opportunity-generator.ts');
const executor = read('server/services/cryptocrawl/execution/dex-zerox-atomic-executor.ts');
const scheduler = read('server/services/cryptocrawl/execution/measured-topology-execution-scheduler.ts');
const router = read('server/services/cryptocrawl/execution/unified-execution-router.ts');
const topologyOptimizer = read('server/services/cryptocrawl/optimization/adaptive-topology-optimizer.ts');

// Read-only discovery may rank a route, but it cannot fabricate executable
// economics from indicative /price responses.
requirePattern(discovery, /purpose:\s*'discovery'/, 'DEX discovery uses read-only 0x price mode');
requirePattern(discovery, /quoteKind\s*===\s*'price'/, 'indicative evidence is explicitly identified as price-only');
requirePattern(discovery, /deterministicNetProfitUsd:\s*null/, 'indicative route does not claim deterministic net profit');
requirePattern(discovery, /prepareZeroXAtomicRoundTrip\s*\(/, 'near-profit discovery delegates firm hydration to atomic preparation authority');
requirePattern(discovery, /status\s*=\s*prepared\s*&&\s*prepared\.deterministicNetProfitUsd\s*>\s*0[\s\S]{0,100}'eligible'/, 'eligible DEX status requires prepared positive deterministic economics');
requirePattern(discovery, /unknown_flash_fee_is_not_zero/, 'unknown flash fee remains fail closed');

// Firm preparation must bind both 0x legs to the reviewed receiver, verify the
// AllowanceHolder spender/target relationship, measure flash fee + exact gas,
// simulate the complete receiver call, and require positive all-in economics.
requirePattern(executor, /purpose:\s*'execution'/g, 'firm 0x execution quotes are requested by the preparation authority');
requirePattern(executor, /allowance spender differs from transaction target; unsupported route fails closed/, 'unexpected allowance/target split fails closed');
requirePattern(executor, /getFlashLoanFeePercentage/, 'Balancer flash-loan fee is measured on-chain');
requirePattern(executor, /provider\.estimateGas\(/, 'full receiver gas is estimated');
requirePattern(executor, /provider\.call\(/, 'full receiver transaction is simulated before submission');
requirePattern(executor, /deterministicNetBaseUnits\.lte\(0\)/, 'non-positive all-in atomic economics are rejected');
requirePattern(executor, /expiresAt\s*<=\s*Date\.now\(\)/, 'stale prepared quotes are rejected');
requirePattern(executor, /FlashLoanExecuted/, 'terminal realized profit is sourced from the receiver event');
forbidPattern(executor, /estimatedProfit\s*=\s*amount\s*\*\s*0\.02/, 'legacy assumed two-percent flash-loan profit');

// The unified router remains the admission boundary and the measured scheduler
// may dispatch only already-admitted DEX_ATOMIC decisions. It must re-check
// StageManager/governance and only publish learning after terminal settlement.
requirePattern(router, /case\s+'DEX_ATOMIC':[\s\S]{0,80}return\s+'FLASH_LOAN'/, 'DEX_ATOMIC routes through the unified flash-loan path');
requirePattern(router, /deterministicPositive\s*=\s*Number\(candidate\.economics\.deterministicNetProfitUsd\)\s*>\s*0/, 'unified route admission requires positive deterministic net');
requirePattern(router, /candidate\.status\s*===\s*'eligible'/, 'unified route admission requires current eligible status');
requirePattern(scheduler, /decision\.admitted\s*&&\s*decision\.topology\s*===\s*'DEX_ATOMIC'/, 'scheduler accepts only admitted DEX atomic decisions');
requirePattern(scheduler, /stageManager\.isMarketOperationsAllowed\(\)[\s\S]{0,100}stageManager\.canExecuteTrades\(\)/, 'scheduler preserves StageManager execution authority');
requirePattern(scheduler, /governance\.requireAllowed\('EXECUTE_OPPORTUNITY'/, 'scheduler preserves governance execution gate');
requirePattern(scheduler, /result\.success\s*&&\s*result\.settlementConfirmed/, 'learning requires successful terminal settlement');
requirePattern(scheduler, /recordCryptaraExecutionEvidence\(/, 'terminal DEX settlement enters canonical learning lifecycle');
requirePattern(scheduler, /synthetic_evidence:false/, 'DEX terminal evidence explicitly forbids synthetic evidence');

// Cold-start topology attention may use current measured evidence but must stay
// bounded and advisory; terminal outcomes remain the learned authority.
requirePattern(topologyOptimizer, /liveOpportunityWeight\(/, 'topology optimizer has measured cold-start attention');
requirePattern(topologyOptimizer, /candidate\.status\s*===\s*'eligible'/, 'cold-start attention recognizes current eligible evidence');
requirePattern(topologyOptimizer, /return\s+clamp\(1\s*\+\s*Math\.tanh\(normalized\)\s*\*\s*0\.35,\s*0\.80,\s*1\.35\)/, 'live topology attention is tightly bounded');
requirePattern(topologyOptimizer, /Terminal settlement is the primary authority/, 'terminal settlement remains primary topology-learning authority');

console.log('[dex-atomic] read-only discovery, firm 0x receiver simulation, measured flash/gas economics, unified admission, terminal settlement learning, and bounded cold-start topology attention invariants passed');
