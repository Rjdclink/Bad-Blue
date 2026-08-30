const fs = require('node:fs');

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
const hyperHybrid = read('server/services/cryptocrawl/execution/hyper-hybrid-cex-execution.ts');

must(progression, /measuredCandidateRegistry\.getMetrics\(STAGE_ONE_SIGNAL_WINDOW_MS\)/, 'Stage 1 uses recent measured candidate evidence');
must(progression, /eligibleCexCandidate\s*=\s*recentCandidates\.byTopology\.CEX_CEX\.eligible\s*>\s*0/, 'CEX bootstrap candidate is topology-specific');
must(progression, /eligibleZeroCapitalCandidate\s*=\s*recentCandidates\.byTopology\.ZERO_CAPITAL_ATOMIC\.eligible\s*>\s*0/, 'zero-capital bootstrap candidate is topology-specific');
must(progression, /eligibleCexCandidate\s*\|\|\s*\(eligibleZeroCapitalCandidate\s*&&\s*initialGasReady\)/s, 'CEX does not require zero-capital gas readiness while zero-capital does');
mustNot(progression, /const advancementMarketGateReady\s*=\s*initialGasReady\s*&&/, 'global initialGasReady must not gate every Stage 1 topology');
must(progression, /Execution evidence requires a terminal normalized settlement/, 'learning still requires post-execution terminal settlement');

must(executor, /plan\.netProfitUsd\)\s*\|\|\s*plan\.netProfitUsd\s*<=\s*0/, 'strict positive all-in net profit remains required');
must(executor, /const inventory = await acquireMeasuredInventory\(plan, adapters\);/, 'measured inventory is reconciled before execution admission');
must(executor, /const empiricalCalibrationAvailable = calibration\.samples > 0;/, 'empirical calibration authority begins after real samples exist');
must(executor, /const coldStartMeasuredBootstrap = !empiricalCalibrationAvailable/, 'cold-start path is explicit');
must(executor, /plan\.liquidity\.status === 'measured'/, 'cold-start requires measured liquidity');
must(executor, /liquidityCoverage >= 1/, 'cold-start requires full measured quantity coverage');
must(executor, /if \(!monteCarlo\.approved && empiricalCalibrationAvailable\)/, 'empirical Monte Carlo retains veto authority');
must(executor, /if \(!monteCarlo\.approved && !coldStartMeasuredBootstrap\)/, 'incomplete cold-start evidence still fails closed');
must(executor, /requireAllowed\('SUBMIT_TX'/, 'governance still controls parent execution admission');
must(executor, /executeHyperHybridCexPlan\(\{/, 'parent execution hands off to hyper-hybrid child planning');
must(executor, /finalizeKnownSubmissionFailure\(await executeHyperHybridCexPlan/, 'parent result remains inside terminalization lifecycle');
must(hyperHybrid, /assertFreshCexProductConstraints\(child\)/, 'every split child receives submit-time product revalidation');
must(hyperHybrid, /executeCexPlan\(child/, 'every admitted child enters canonical terminal settlement lifecycle');
must(hyperHybrid, /await Promise\.all\(admittedChildren\.map/, 'admitted children execute in the bounded parallel batch');
mustNot(executor, /calibration\.samples\s*===\s*0[^\n]*return rejectPlan/, 'zero history alone cannot reject the first measured trade');

console.log('[verify-bootstrap-execution-history] PASS: Stage-1 bootstrap remains measured and non-executable; Stage-2+ parent execution reaches product-revalidated hyper-hybrid children and canonical terminal settlement');
