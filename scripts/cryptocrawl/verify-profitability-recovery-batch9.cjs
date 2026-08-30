const fs = require('fs');
const path = require('path');

const root = process.cwd();
const batchPath = path.join(root, 'server/services/cryptocrawl/integration/profitability-recovery-batch9.ts');
const wiringPath = path.join(root, 'server/services/cryptocrawl/integration/dynamic-profitability-admission-wiring.ts');

for (const file of [batchPath, wiringPath]) {
  if (!fs.existsSync(file)) throw new Error(`[profitability-recovery-batch9] missing ${path.relative(root, file)}`);
}

const batch = fs.readFileSync(batchPath, 'utf8');
const wiring = fs.readFileSync(wiringPath, 'utf8');

const requiredSignals = [
  'gapWithin1Bps','gapWithin2Bps','gapWithin3Bps','gapWithin5Bps','gapWithin10Bps','gapWithin20Bps','gapWithin25Bps','gapWithin50Bps',
  'riskGapWithin2Bps','riskGapWithin5Bps','riskGapWithin10Bps','riskGapWithin25Bps','feeGapP10Bps','feeGapP20Bps','feeGapP40Bps','feeGapP60Bps','feeGapP80Bps','feeGapP95Bps',
  'riskGapP10Bps','riskGapP25Bps','riskGapP50Bps','riskGapP75Bps','riskGapP95Bps','recoveryEfficiencyP10','recoveryEfficiencyP25','recoveryEfficiencyP50','recoveryEfficiencyP75','recoveryEfficiencyP90',
  'freshnessP10','freshnessP25','freshnessP50','freshnessP75','freshnessP90','freshnessBelow50PctShare','freshnessBelow75PctShare','freshnessAbove90PctShare',
  'combinedFeeP10Bps','combinedFeeP25Bps','combinedFeeP50Bps','combinedFeeP75Bps','combinedFeeP90Bps','combinedFeeMeanBps','combinedFeeSpreadBps',
  'grossSpreadP10Bps','grossSpreadP25Bps','grossSpreadP50Bps','grossSpreadP75Bps','grossSpreadP90Bps','grossSpreadMeanBps','grossSpreadRangeBps',
  'netAfterFeesP10Bps','netAfterFeesP25Bps','netAfterFeesP50Bps','netAfterFeesP75Bps','netAfterFeesP90Bps','netAfterFeesMeanBps','netAfterFeesBestBps',
  'expectedAdjustedP10Bps','expectedAdjustedP25Bps','expectedAdjustedP50Bps','expectedAdjustedP75Bps','expectedAdjustedP90Bps','expectedAdjustedMeanBps','expectedAdjustedBestBps',
  'hybridCountMT','hybridCountTM','hybridBestMTGapBps','hybridBestTMGapBps','hybridMeanGapBps','hybridMedianGapBps','hybridMeanRecoveryEfficiency','hybridFreshEvidenceShare',
  'modeCoverageTT','modeCoverageMT','modeCoverageTM','modeCoverageMM','modeBestGapTTBps','modeBestGapMTBps','modeBestGapTMBps','modeBestGapMMBps',
  'zeroCapitalStructuralPerChainMean','zeroCapitalStructuralPerChainMax','zeroCapitalMeasuredPerChainMean','zeroCapitalMeasuredPerChainMax','zeroCapitalPositivePerChainTotal','zeroCapitalPositiveYieldMean','zeroCapitalQuoteUtilizationMean','zeroCapitalQuoteUtilizationMax',
  'zeroCapitalExplorationShareMean','zeroCapitalExploitationShareMean','zeroCapitalScoredShareMean','zeroCapitalGasCostMeanUsd','zeroCapitalGasCostMaxUsd','zeroCapitalCandidateToBudgetRatioMean',
  'recoveryPriorityTopScore','recoveryPriorityMeanScore','recoveryPriorityTopFreshness','recoveryPriorityTopEfficiency','recoveryPriorityTopRiskGapBps','recoveryPriorityCoverageShare',
];

if (requiredSignals.length !== 100) throw new Error(`[profitability-recovery-batch9] verifier expected 100 signals, got ${requiredSignals.length}`);
for (const signal of requiredSignals) {
  if (!batch.includes(`${signal}:`)) throw new Error(`[profitability-recovery-batch9] missing signal ${signal}`);
}

if (!batch.includes('signalCount: 100')) throw new Error('[profitability-recovery-batch9] signalCount must remain 100');
if (!batch.includes("authority: 'advisory_recovery_intelligence_only'")) throw new Error('[profitability-recovery-batch9] advisory authority missing');
if (!batch.includes('executionAuthority: false')) throw new Error('[profitability-recovery-batch9] execution authority must remain false');
if (!batch.includes('syntheticEvidenceAllowed: false')) throw new Error('[profitability-recovery-batch9] synthetic evidence must remain disabled');
if (!wiring.includes('ensureProfitabilityRecoveryBatch9();')) throw new Error('[profitability-recovery-batch9] canonical bootstrap wiring missing');
if (!wiring.includes('batch9RecoveryEnhancements: 100')) throw new Error('[profitability-recovery-batch9] runtime enhancement-count attestation missing');

console.log('[profitability-recovery-batch9] PASS: one hundred measured advisory recovery enhancements wired with no execution authority');
