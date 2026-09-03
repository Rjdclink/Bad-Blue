const fs = require('node:fs');
const { verifyCexExecutionContract } = require('./lib/pr482-canonical-contract.cjs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function must(source, pattern, label) {
  if (!pattern.test(source)) throw new Error(`Missing invariant: ${label}`);
}

function mustNot(source, pattern, label) {
  if (pattern.test(source)) throw new Error(`Forbidden invariant: ${label}`);
}

const progression = read('server/services/cryptocrawl/governance/automatic-stage-progression.ts');
const stageManager = read('server/services/cryptocrawl/governance/stage-management.ts');
const executor = read('server/services/cryptocrawl/execution/centralized-exchange-executor.ts');

// Parent/child/product/settlement path verification is shared with the other
// PR482 production gates so this file cannot retain an obsolete direct-call path.
verifyCexExecutionContract();

must(stageManager, /\[Stage\.STAGE_1_CONSTRAINED_PILOT\][\s\S]*?canExecuteTrades:\s*true[\s\S]*?\[Stage\.STAGE_2_PROOF_OF_SIGNAL\]/, 'Stage 1 directly permits constrained canonical live execution');
must(progression, /measuredCandidateRegistry\.getMetrics\(STAGE_ONE_SIGNAL_WINDOW_MS\)/, 'Stage 1 uses recent measured candidate evidence');
must(progression, /eligibleStandardCexCandidate\s*=\s*recentCandidates\.byTopology\.CEX_CEX\.eligible\s*>\s*0/, 'standard CEX bootstrap candidate is topology-specific');
must(progression, /eligibleMakerCexCandidate\s*=\s*recentCandidates\.byTopology\.MAKER_CEX\.eligible\s*>\s*0/, 'fully measured maker CEX bootstrap candidate is topology-specific');
must(progression, /eligibleCexCandidate\s*=\s*eligibleStandardCexCandidate\s*\|\|\s*eligibleMakerCexCandidate/, 'CEX bootstrap readiness combines standard and fully measured maker CEX evidence without changing authority');
must(progression, /eligibleZeroCapitalCandidate\s*=\s*recentCandidates\.byTopology\.ZERO_CAPITAL_ATOMIC\.eligible\s*>\s*0/, 'zero-capital bootstrap candidate is topology-specific');
must(progression, /eligibleCexCandidate\s*\|\|\s*\(eligibleZeroCapitalCandidate\s*&&\s*initialGasReady\)/s, 'CEX does not require zero-capital gas readiness while zero-capital does');
mustNot(progression, /const advancementMarketGateReady\s*=\s*initialGasReady\s*&&/, 'global initialGasReady must not gate every Stage 1 topology');
must(progression, /Execution evidence requires a terminal normalized settlement/, 'learning still requires post-execution terminal settlement');

must(executor, /plan\.netProfitUsd\)\s*\|\|\s*plan\.netProfitUsd\s*<=\s*0/, 'strict positive all-in net profit remains required');
must(executor, /acquireMeasuredInventory\s*\(\s*plan\s*,\s*adapters\s*\)/, 'measured inventory is reconciled before execution admission');
must(executor, /calibration\.samples/, 'terminal calibration history remains available to advisory Monte Carlo');
must(executor, /plan\.liquidity\.status\s*!==\s*'measured'/, 'measured liquidity remains a hard deterministic input upstream');
must(executor, /void parallelMonteCarloPool\.run/, 'Monte Carlo runs concurrently off the CEX critical path');
must(executor, /monteCarloExecutionAuthority:\s*false/, 'Monte Carlo explicitly has no current execution authority');
must(executor, /currentPlanAdmissionAuthority:\s*'deterministic_positive_all_in_economics_plus_hard_execution_facts'/, 'deterministic current facts own CEX admission');
must(executor, /requireAllowed\s*\(\s*'SUBMIT_TX'/, 'canonical governance still controls parent execution admission');
must(executor, /REJECT_STALE_QUOTE/, 'fresh quote evidence remains a hard execution requirement');
mustNot(executor, /REJECT_MC(?:_COMPUTE|_COLD_START_EVIDENCE)?:/, 'Monte Carlo cannot reject a current deterministic-positive CEX plan');
mustNot(executor, /await\s+parallelMonteCarloPool\.run/, 'CEX execution cannot wait for Monte Carlo before submission');
mustNot(executor, /calibration\.samples\s*===\s*0[^\n]*return rejectPlan/, 'zero history alone cannot reject the first measured trade');

console.log('[verify-bootstrap-execution-history] PASS: Stage-1 bootstrap is canonical live-positive across standard CEX, fully measured maker CEX, and topology-ready zero-capital evidence; no historical-profit prerequisite exists, Monte Carlo is parallel advisory only, and shared PR482 execution contract preserves parent/child/product/settlement truth');