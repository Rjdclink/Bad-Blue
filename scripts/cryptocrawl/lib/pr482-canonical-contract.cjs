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

function verifyCexExecutionContract() {
  const centralized = read('server/services/cryptocrawl/execution/centralized-exchange-executor.ts');
  const hyperHybrid = read('server/services/cryptocrawl/execution/hyper-hybrid-cex-execution.ts');
  const partialAccounting = read('server/services/cryptocrawl/compensation/hyper-hybrid-partial-profit-accounting.ts');
  const residualReplan = read('server/services/cryptocrawl/discovery/cex-residual-replan.ts');
  const capability = read('server/services/cryptocrawl/discovery/venue-capability-registry.ts');
  const fourMode = read('server/services/cryptocrawl/intelligence/cex-four-mode-matrix.ts');
  const maker = read('server/services/cryptocrawl/execution/stablecoin-maker-strategy.ts');
  const makerAdapters = read('server/services/cryptocrawl/execution/post-only-maker-adapters.ts');
  const hybrid = read('server/services/cryptocrawl/runtime/hybrid-cex-execution-wiring.ts');
  const spotProducts = read('server/services/cryptocrawl/execution/cex-spot-product-policy.ts');
  const submitGuard = read('server/services/cryptocrawl/execution/cex-submit-time-product-guard.ts');
  const coinbaseMarket = read('server/services/cryptocrawl/intelligence/coinbase-advanced-market-data.ts');

  // Parent -> children -> canonical terminal settlement.
  requirePattern(centralized, /\bexecuteHyperHybridCexPlan\s*\(/, 'centralized parent execution delegates to hyper-hybrid execution');
  requirePattern(hyperHybrid, /\bassertFreshCexProductConstraints\s*\(\s*child\s*\)/, 'every split child is submit-time product revalidated');
  requirePattern(hyperHybrid, /\bexecuteCexPlan\s*\(\s*child\b/, 'every admitted child reaches canonical CEX settlement');
  requirePattern(hyperHybrid, /plannedChildren\.slice\s*\(\s*0\s*,\s*concurrency\s*\)/, 'one bounded child batch is admitted');
  requirePattern(hyperHybrid, /Promise\.all\s*\(\s*admittedChildren\.map/s, 'admitted child batch executes concurrently');
  forbidPattern(hyperHybrid, /for\s*\(\s*let\s+offset[\s\S]{0,240}plannedChildren\.length[\s\S]{0,160}concurrency/, 'automatic sequential child waves');

  // Partial success is durable money truth but cannot create extra learning/rank samples.
  requirePattern(partialAccounting, /if\s*\(\s*input\.parentSucceeded\s*\)\s*return\s*;/, 'successful full parents are not double-counted by partial accounting');
  requirePattern(partialAccounting, /retainedProfitLedger\.recordTerminalSettlement\s*\(/, 'profitable terminal child subset reaches durable treasury accounting');
  requirePattern(partialAccounting, /finally\s*\{[\s\S]{0,900}queueCexResidualReplan\s*\(/, 'residual reassessment is independent of treasury persistence success');
  forbidPattern(partialAccounting, /recordCryptaraExecutionEvidence\s*\(|stageManager\.|profitLadder\./, 'partial child accounting entering rank/stage/ladder progression');
  requirePattern(residualReplan, /arbitrageVerifier\.evaluateOnce\s*\(/, 'residual notional receives fresh canonical economics verification');
  requirePattern(residualReplan, /cryptara\.assessOpportunity\s*\(/, 'fresh residual receives Cryptara/Monte Carlo reassessment');
  requirePattern(residualReplan, /measuredCandidateRegistry\.updateStatus\s*\([\s\S]{0,160}'eligible'/, 'freshly approved residual re-enters through the canonical eligible queue');
  forbidPattern(residualReplan, /\bexecuteHyperHybridCexPlan\s*\(|\bexecuteCexPlan\s*\(|\bsendTransaction\s*\(|\.submit\s*\(/, 'residual reassessment directly submitting execution');

  // Coinbase, Kraken and OKX are peer executable venues above venue adapters.
  requirePattern(capability, /\['coinbase',\s*'kraken',\s*'okx'\]/, 'canonical executable venue set contains Coinbase, Kraken and OKX');
  requirePattern(fourMode, /getActiveExecutableQuoteVenues\s*\(/, 'four-mode economics consumes the canonical executable venue set');
  requirePattern(maker, /CEX_VENUES[^=]*=\s*\['coinbase',\s*'kraken',\s*'okx'\]/, 'MM maker recovery evaluates all three executable venues');
  requirePattern(hybrid, /HYBRID_VENUES[^=]*=\s*\['coinbase',\s*'kraken',\s*'okx'\]/, 'MT/TM recovery evaluates all three executable venues');
  requirePattern(hybrid, /coinbase:\s*governedSymbols/, 'MT/TM authenticated fee prime includes Coinbase');
  requirePattern(makerAdapters, /venue:\s*ExecutableCexVenue/, 'post-only maker adapter is shared across executable venues');
  requirePattern(makerAdapters, /limit_limit_gtc/, 'Coinbase post-only maker translation is installed');
  forbidPattern(fourMode, /buyVenue:\s*'kraken'\s*\|\s*'okx'|sellVenue:\s*'kraken'\s*\|\s*'okx'/, 'four-mode matrix narrowing strategy authority to Kraken/OKX');

  // One product identity authority per venue family; submit guard may validate but not re-parse.
  requirePattern(spotProducts, /getSpotProductConstraints[\s\S]*forceFresh\s*=\s*false/, 'Kraken/OKX product authority supports forced-fresh reads');
  requirePattern(submitGuard, /getSpotProductConstraints\(venue,\s*symbol,\s*true\)/, 'submit-time Kraken/OKX drift guard force-refreshes canonical product authority');
  forbidPattern(submitGuard, /api\.kraken\.com|public\/instruments|match\(\/\^\(\[A-Z0-9\]/, 'submit-time guard implementing a second product directory/parser');
  requirePattern(coinbaseMarket, /resolveCoinbaseAdvancedProductId\s*\(/, 'Coinbase product ids resolve from the live product directory');
  forbidPattern(coinbaseMarket, /\(USDT\|USDC\|USD\)/, 'Coinbase live product authority using a stablecoin quote whitelist');
  forbidPattern(spotProducts, /\(USDT\|USDC\|USD\)/, 'Kraken/OKX live product authority using a stablecoin quote whitelist');

  return { centralized, hyperHybrid, partialAccounting, residualReplan, capability, fourMode, maker, makerAdapters, hybrid, spotProducts, submitGuard, coinbaseMarket };
}

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
  forbidPattern(sizing, /Math\.min\([^\n;]*stage\.maxPositionSizeUSD|requestedNotionalUsd\s*>\s*stage\.maxPositionSizeUSD/, 'progressive sizing using legacy stage position field as notional authority');
  requirePattern(zeroCapital, /getProfitLadderNotionalAuthority\s*\(\)\.maxNotionalUsd/, 'Stage2+ zero-capital sizing consumes the ladder ceiling');
  forbidPattern(zeroCapital, /stage\.maxPositionSizeUSD/, 'zero-capital sizing using legacy stage position cap');
  requirePattern(maker, /getProfitLadderNotionalAuthority\s*\(/, 'maker discovery consumes the same ladder ceiling');
  requirePattern(profitOps, /recommendedMaxNotionalUsd/, 'adaptive CEX discovery uses the current ladder-backed operating envelope');
  forbidPattern(profitOps, /notionalBias|getCryptaraAdaptiveStrategySnapshot/, 'Cryptara adaptive state becoming a second notional authority');

  return { ladder, risk, sizing, zeroCapital, maker, profitOps };
}

module.exports = { read, requirePattern, forbidPattern, verifyCexExecutionContract, verifyProfitLadderNotionalContract };