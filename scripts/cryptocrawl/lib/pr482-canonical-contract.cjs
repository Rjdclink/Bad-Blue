'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`[pr482-contract] required source missing: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

function requirePattern(source, pattern, description) {
  if (!pattern.test(source)) throw new Error(`[pr482-contract] missing invariant: ${description}`);
}

function forbidPattern(source, pattern, description) {
  if (pattern.test(source)) throw new Error(`[pr482-contract] forbidden regression: ${description}`);
}

/**
 * Canonical CEX route contract introduced by PR #482.
 *
 * Verify behavior across module boundaries instead of pinning callers to one
 * exact statement or telemetry string. Internal refactors may move a guard or
 * rename observability without breaking deployment as long as the authoritative
 * route remains true:
 * parent admission -> hyper-hybrid planner -> product-revalidated child ->
 * canonical settlement. Partial realized profit is treasury-only and residual
 * exposure can only re-enter through fresh verification/assessment.
 */
function verifyCexExecutionContract() {
  const centralized = read('server/services/cryptocrawl/execution/centralized-exchange-executor.ts');
  const hyperHybrid = read('server/services/cryptocrawl/execution/hyper-hybrid-cex-execution.ts');
  const partialAccounting = read('server/services/cryptocrawl/compensation/hyper-hybrid-partial-profit-accounting.ts');
  const residualReplan = read('server/services/cryptocrawl/discovery/cex-residual-replan.ts');

  requirePattern(centralized, /\bexecuteHyperHybridCexPlan\s*\(/, 'centralized parent execution delegates to hyper-hybrid execution');
  requirePattern(hyperHybrid, /\bassertFreshCexProductConstraints\s*\(\s*child\s*\)/, 'every split child is submit-time product revalidated');
  requirePattern(hyperHybrid, /\bexecuteCexPlan\s*\(\s*child\b/, 'every admitted child reaches canonical CEX settlement');
  requirePattern(hyperHybrid, /plannedChildren\.slice\s*\(\s*0\s*,\s*concurrency\s*\)/, 'one bounded child batch is admitted');
  requirePattern(hyperHybrid, /Promise\.all\s*\(\s*admittedChildren\.map/s, 'admitted child batch executes concurrently');
  forbidPattern(hyperHybrid, /for\s*\(\s*let\s+offset[\s\S]{0,240}plannedChildren\.length[\s\S]{0,160}concurrency/, 'automatic sequential child waves');

  requirePattern(partialAccounting, /if\s*\(\s*input\.parentSucceeded\s*\)\s*return\s*;/, 'successful full parents are not double-counted by partial accounting');
  requirePattern(partialAccounting, /retainedProfitLedger\.recordTerminalSettlement\s*\(/, 'profitable terminal child subset reaches durable treasury accounting');
  requirePattern(partialAccounting, /finally\s*\{[\s\S]{0,900}queueCexResidualReplan\s*\(/, 'residual reassessment is independent of treasury persistence success');
  forbidPattern(partialAccounting, /recordCryptaraExecutionEvidence\s*\(|stageManager\.|profitLadder\./, 'partial child accounting entering rank/stage/ladder progression');

  requirePattern(residualReplan, /arbitrageVerifier\.evaluateOnce\s*\(/, 'residual notional receives a fresh canonical economics verification');
  requirePattern(residualReplan, /cryptara\.assessOpportunity\s*\(/, 'fresh residual receives Cryptara/Monte Carlo reassessment');
  requirePattern(residualReplan, /measuredCandidateRegistry\.updateStatus\s*\([\s\S]{0,160}'eligible'/, 'freshly approved residual re-enters only through the canonical eligible queue');
  forbidPattern(residualReplan, /\bexecuteHyperHybridCexPlan\s*\(|\bexecuteCexPlan\s*\(|\bsendTransaction\s*\(|\.submit\s*\(/, 'residual reassessment directly submitting execution');

  return { centralized, hyperHybrid, partialAccounting, residualReplan };
}

/**
 * Canonical capital-size contract introduced by PR #482.
 * Profit Ladder owns the outer notional ceiling. StageManager remains execution,
 * progression and safety authority, while liquidity/inventory/slippage/risk may
 * only tighten the size beneath the ladder. This checks functional use rather
 * than duplicate telemetry labels.
 */
function verifyProfitLadderNotionalContract() {
  const ladder = read('server/services/cryptocrawl/governance/profit-ladder-notional-authority.ts');
  const risk = read('server/services/cryptocrawl/governance/risk-governor.ts');
  const sizing = read('server/services/cryptocrawl/risk/progressive-position-sizing.ts');
  const zeroCapital = read('server/services/cryptocrawl/integration/zero-capital-size-refinement-wiring.ts');
  const maker = read('server/services/cryptocrawl/discovery/maker-opportunity-generator.ts');
  const profitOps = read('server/services/cryptocrawl/runtime/adaptive-profit-operations-wiring.ts');

  requirePattern(ladder, /SYSTEM_MAX_NOTIONAL_USD\s*=\s*100_000_000/, 'institutional ceiling supports the explicit $100M rung');
  requirePattern(ladder, /key:\s*'institutional_100m'/, 'institutional ladder contains the $100M evidence rung');
  requirePattern(ladder, /authority:\s*'profit_ladder_capital_allowance'/, 'Profit Ladder declares the canonical notional authority');
  requirePattern(ladder, /aligned\s*&&\s*stage\.canExecuteTrades/, 'stage/tier alignment and execution authority fail closed before notional is exposed');

  requirePattern(risk, /getProfitLadderNotionalAuthority\s*\(/, 'RiskGovernor consumes the canonical ladder notional authority');
  requirePattern(risk, /proposal\.positionSizeUSD\s*>\s*notionalAuthority\.maxNotionalUsd/, 'RiskGovernor rejects exposure above the ladder ceiling');
  forbidPattern(risk, /proposal\.positionSizeUSD\s*>\s*stageConfig\.maxPositionSizeUSD/, 'legacy StageManager position cap acting as a second notional ceiling');

  requirePattern(sizing, /getProfitLadderNotionalAuthority\s*\(/, 'progressive sizing consumes the canonical ladder ceiling');
  requirePattern(sizing, /Math\.min\(ladderMaxNotionalUsd,\s*capitalLimit\)/, 'progressive sizing may only tighten beneath the ladder');
  forbidPattern(sizing, /Math\.min\([^\n;]*stage\.maxPositionSizeUSD|requestedNotionalUsd\s*>\s*stage\.maxPositionSizeUSD/, 'progressive sizing using the legacy stage position field as a notional authority');

  requirePattern(zeroCapital, /getProfitLadderNotionalAuthority\s*\(\)\.maxNotionalUsd/, 'Stage2+ zero-capital sizing consumes the ladder ceiling');
  forbidPattern(zeroCapital, /stage\.maxPositionSizeUSD/, 'zero-capital sizing using the legacy stage position cap');

  requirePattern(maker, /getProfitLadderNotionalAuthority\s*\(/, 'maker discovery consumes the same ladder ceiling');
  requirePattern(profitOps, /recommendedMaxNotionalUsd/, 'adaptive CEX discovery uses the current ladder-backed operating envelope');
  forbidPattern(profitOps, /notionalBias|getCryptaraAdaptiveStrategySnapshot/, 'Cryptara adaptive state becoming a second notional authority');

  return { ladder, risk, sizing, zeroCapital, maker, profitOps };
}

module.exports = {
  read,
  requirePattern,
  forbidPattern,
  verifyCexExecutionContract,
  verifyProfitLadderNotionalContract,
};
