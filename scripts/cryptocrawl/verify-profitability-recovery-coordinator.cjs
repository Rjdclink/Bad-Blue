const fs = require('fs');
const path = require('path');

const root = process.cwd();
const coordinatorPath = path.join(root, 'server/services/cryptocrawl/integration/profitability-recovery-coordinator.ts');
const wiringPath = path.join(root, 'server/services/cryptocrawl/integration/dynamic-profitability-admission-wiring.ts');

for (const file of [coordinatorPath, wiringPath]) {
  if (!fs.existsSync(file)) throw new Error(`[profitability-recovery-coordinator] missing ${path.relative(root, file)}`);
}

const coordinator = fs.readFileSync(coordinatorPath, 'utf8');
const wiring = fs.readFileSync(wiringPath, 'utf8');

const requiredSignals = [
  'cexObservedModes',
  'cexSymbols',
  'cexPositiveModes',
  'closestFeeOnlyGapBps',
  'closestRiskAdjustedGapBps',
  'bestRecoveryEfficiency',
  'hybridNearMisses',
  'bestHybridGapBps',
  'maximumMakerFeeSavingsBps',
  'staleFeeEvidenceModes',
  'withinFiveBps',
  'withinTenBps',
  'withinTwentyFiveBps',
  'nearMissConcentrationTopSymbol',
  'bestGapByMode',
  'symbolsWithMultipleObservedModes',
  'meanObservedModesPerSymbol',
  'zeroCapitalQuoteUtilization',
  'zeroCapitalPositiveYield',
  'recoveryPriority',
];

for (const signal of requiredSignals) {
  if (!coordinator.includes(signal)) throw new Error(`[profitability-recovery-coordinator] missing signal ${signal}`);
}

if (!coordinator.includes("authority: 'advisory_recovery_intelligence_only'")) {
  throw new Error('[profitability-recovery-coordinator] advisory-only authority declaration missing');
}
if (!coordinator.includes('executionAuthority: false')) {
  throw new Error('[profitability-recovery-coordinator] execution authority must remain false');
}
if (!coordinator.includes('syntheticEvidenceAllowed: false')) {
  throw new Error('[profitability-recovery-coordinator] synthetic evidence must remain disabled');
}
if (!wiring.includes('ensureProfitabilityRecoveryCoordinator();')) {
  throw new Error('[profitability-recovery-coordinator] canonical profitability bootstrap wiring missing');
}

console.log('[profitability-recovery-coordinator] PASS: twenty measured recovery signals are wired advisory-only with no execution authority');
