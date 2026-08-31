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
const executor = read('server/services/cryptocrawl/execution/centralized-exchange-executor.ts');

// Parent/child/product/settlement path verification is shared with the other
// PR482 production gates so this file cannot retain an obsolete direct-call path.
verifyCexExecutionContract();

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
must(executor, /empiricalCalibrationAvailable\s*=\s*calibration\.samples\s*>\s*0/, 'empirical calibration authority begins after real samples exist');
must(executor, /coldStartMeasuredBootstrap\s*=\s*!empiricalCalibrationAvailable/, 'cold-start path is explicit');
must(executor, /plan\.liquidity\.status\s*===\s*'measured'/, 'cold-start requires measured liquidity');
must(executor, /liquidityCoverage\s*>=\s*1/, 'cold-start requires full measured quantity coverage');
must(executor, /!monteCarlo\.approved\s*&&\s*empiricalCalibrationAvailable/, 'empirical Monte Carlo retains veto authority');
must(executor, /!monteCarlo\.approved\s*&&\s*!coldStartMeasuredBootstrap/, 'incomplete cold-start evidence still fails closed');
must(executor, /requireAllowed\s*\(\s*'SUBMIT_TX'/, 'governance still controls parent execution admission');
mustNot(executor, /calibration\.samples\s*===\s*0[^\n]*return rejectPlan/, 'zero history alone cannot reject the first measured trade');

console.log('[verify-bootstrap-execution-history] PASS: Stage-1 bootstrap remains measured and non-executable across standard CEX, fully measured maker CEX, and topology-ready zero-capital evidence; shared PR482 execution contract verifies Stage-2+ parent/child/product/settlement routing');
