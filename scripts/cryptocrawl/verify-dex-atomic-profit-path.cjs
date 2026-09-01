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

function forbidFile(relativePath, description) {
  if (fs.existsSync(path.join(root, relativePath))) throw new Error(`[dex-atomic] forbidden regression: ${description}`);
}

const discovery = read('server/services/cryptocrawl/discovery/dex-opportunity-generator.ts');
const provider = read('server/services/cryptocrawl/intelligence/market-data-providers.ts');
const receiverManager = read('server/services/cryptocrawl/execution/adapters/sponsored-receiver-manager.ts');
const executor = read('server/services/cryptocrawl/execution/dex-zerox-atomic-executor.ts');
const adapter = read('server/services/cryptocrawl/execution/measured-topology-execution-adapter.ts');
const canonicalScheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const router = read('server/services/cryptocrawl/execution/unified-execution-router.ts');
const topologyOptimizer = read('server/services/cryptocrawl/optimization/adaptive-topology-optimizer.ts');

// Read-only discovery may rank a route, but it cannot fabricate executable
// economics or directly mutate receiver infrastructure.
requirePattern(discovery, /purpose:\s*'discovery'/, 'DEX discovery uses read-only 0x price mode');
requirePattern(discovery, /quoteKind\s*===\s*'price'/, 'indicative evidence is explicitly identified as price-only');
requirePattern(discovery, /deterministicNetProfitUsd:\s*null/, 'indicative route does not claim deterministic net profit');
requirePattern(discovery, /prepareZeroXAtomicRoundTrip\s*\(/, 'near-profit discovery delegates firm hydration to read-only preparation');
requirePattern(discovery, /prepared\s*&&\s*prepared\.deterministicNetProfitUsd\s*>\s*0[\s\S]{0,100}'eligible'/, 'eligible DEX status requires prepared positive deterministic economics');
requirePattern(discovery, /supportsSponsoredReceiverChain/, 'DEX scans only chains with a reviewed/configured receiver surface');
requirePattern(discovery, /discovery_infrastructure_mutation:false/, 'DEX provenance explicitly forbids discovery infrastructure mutation');
requirePattern(discovery, /unknown_flash_fee_is_not_zero/, 'unknown flash fee remains fail closed');

// Preserve 0x v2 allowance evidence instead of silently treating transaction.to
// as the only field when issues.allowance.spender is present.
requirePattern(provider, /allowanceSpender\?:\s*string/, 'DEX quote type preserves v2 allowance spender');
requirePattern(provider, /payload\?\.issues\?\.allowance/, '0x issues.allowance is parsed');
requirePattern(provider, /allowanceSpender:\s*typeof\s+allowanceIssue\?\.spender/, 'issues.allowance.spender is copied into measured evidence');
requirePattern(provider, /simulationIncomplete:/, '0x simulation-incomplete evidence is preserved');

// Receiver authority must expose a read-only deterministic inspection path and a
// separate explicit permission computation path. Deployment remains in ensureReceiver.
requirePattern(receiverManager, /async\s+inspectExistingReceiver\s*\(/, 'receiver manager exposes read-only existing receiver inspection');
requirePattern(receiverManager, /if\s*\(code\s*===\s*'0x'\)\s*return\s+null/, 'read-only inspection does not deploy missing receiver');
requirePattern(receiverManager, /async\s+buildMissingExplicitPermissionCalls\s*\(/, 'receiver manager owns read-only explicit permission comparison');
requirePattern(receiverManager, /requireZeroCapitalInfrastructureDeploymentAllowed[\s\S]{0,900}receiver_deployment/, 'receiver deployment remains governance-gated inside deployment authority');

// Firm preparation binds both 0x legs to an already-existing reviewed receiver,
// verifies permissions read-only, measures flash fee/gas, simulates the whole call,
// and requires positive all-in economics. Missing readiness is queued, not mutated.
requirePattern(executor, /inspectExistingReceiver\s*\(/, 'firm preparation inspects an existing receiver instead of deploying');
requirePattern(executor, /buildMissingExplicitPermissionCalls\s*\(/, 'firm preparation verifies receiver permissions read-only');
requirePattern(executor, /rememberInfrastructureNeed\s*\(input\)/, 'missing DEX infrastructure is queued for canonical reconciliation');
requirePattern(executor, /reconcilePendingZeroXAtomicInfrastructure\s*\(/, 'bounded infrastructure reconciler exists');
requirePattern(executor, /tradeSubmitted:\s*false/, 'infrastructure reconciliation does not submit a trade');
requirePattern(executor, /allowance spender differs from transaction target/, 'unexpected AllowanceHolder spender/target split fails closed');
requirePattern(executor, /getFlashLoanFeePercentage/, 'Balancer flash-loan fee is measured on-chain');
requirePattern(executor, /provider\.estimateGas\(/, 'full receiver gas is estimated');
requirePattern(executor, /provider\.call\(/, 'full receiver transaction is simulated before submission');
requirePattern(executor, /deterministicNetBaseUnits\.lte\(0\)/, 'non-positive all-in atomic economics are rejected');
requirePattern(executor, /expiresAt\s*<=\s*Date\.now\(\)/, 'stale prepared quotes are rejected');
requirePattern(executor, /FlashLoanExecuted/, 'terminal realized profit is sourced from the receiver event');
requirePattern(executor, /receiptStatus\s*!==\s*1[\s\S]{0,300}settlementConfirmed:\s*true/, 'reverted receipt is terminal confirmed failure rather than unknown settlement');
forbidPattern(executor, /estimatedProfit\s*=\s*amount\s*\*\s*0\.02/, 'legacy assumed two-percent flash-loan profit');

// Infrastructure reconciliation and trade dispatch are both subordinate to the
// canonical scheduler through one timer-less adapter.
requirePattern(adapter, /reconcilePendingZeroXAtomicInfrastructure\(1\)/, 'canonical adapter performs bounded queued infrastructure readiness');
requirePattern(adapter, /decision\.admitted\s*&&\s*decision\.topology\s*===\s*'DEX_ATOMIC'/, 'adapter accepts only admitted DEX atomic decisions');
requirePattern(adapter, /stageManager\.isMarketOperationsAllowed\(\)[\s\S]{0,100}stageManager\.canExecuteTrades\(\)/, 'adapter preserves StageManager execution authority');
requirePattern(adapter, /governance\.requireAllowed\('EXECUTE_OPPORTUNITY'/, 'adapter preserves governance execution gate');
requirePattern(adapter, /recordCryptaraExecutionEvidence\(/, 'terminal DEX settlement enters canonical learning lifecycle');
requirePattern(adapter, /terminalSettlementConfirmed/, 'economic success is separated from terminal settlement confirmation');
requirePattern(adapter, /synthetic_evidence:false/, 'DEX terminal evidence explicitly forbids synthetic evidence');
forbidPattern(adapter, /setInterval|setTimeout\s*\(/, 'DEX adapter owns no independent scheduler timer');
requirePattern(canonicalScheduler, /measuredTopologyExecutionAdapter\.dispatch/, 'canonical scheduler alone invokes the measured topology adapter');
forbidFile('server/services/cryptocrawl/execution/measured-topology-execution-scheduler.ts', 'duplicate measured topology scheduler exists');

// Unified admission still requires eligible, deterministic positive evidence.
requirePattern(router, /case\s+'DEX_ATOMIC':[\s\S]{0,80}return\s+'FLASH_LOAN'/, 'DEX_ATOMIC routes through the unified flash-loan path');
requirePattern(router, /deterministicPositive\s*=\s*Number\(candidate\.economics\.deterministicNetProfitUsd\)\s*>\s*0/, 'unified route admission requires positive deterministic net');
requirePattern(router, /candidate\.status\s*===\s*'eligible'/, 'unified route admission requires current eligible status');

// Cold-start topology attention may use current measured evidence but must stay
// bounded and advisory; terminal outcomes remain the learned authority.
requirePattern(topologyOptimizer, /liveOpportunityWeight\(/, 'topology optimizer has measured cold-start attention');
requirePattern(topologyOptimizer, /candidate\.status\s*===\s*'eligible'/, 'cold-start attention recognizes current eligible evidence');
requirePattern(topologyOptimizer, /return\s+clamp\(1\s*\+\s*Math\.tanh\(normalized\)\s*\*\s*0\.35,\s*0\.80,\s*1\.35\)/, 'live topology attention is tightly bounded');
requirePattern(topologyOptimizer, /Terminal settlement is the primary authority/, 'terminal settlement remains primary topology-learning authority');

console.log('[dex-atomic] read-only discovery, v2 allowance evidence, scheduler-owned readiness reconciliation, exact atomic economics, terminal failure learning, and single scheduling authority invariants passed');