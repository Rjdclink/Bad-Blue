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
  const feeResolver = read('server/services/cryptocrawl/intelligence/cex-fee-resolver.ts');
  const arbVerifier = read('server/services/cryptocrawl/arbitrage/arbitrage-verifier.ts');
  const maker = read('server/services/cryptocrawl/execution/stablecoin-maker-strategy.ts');
  const makerDiscovery = read('server/services/cryptocrawl/discovery/maker-opportunity-generator.ts');
  const makerAdapters = read('server/services/cryptocrawl/execution/post-only-maker-adapters.ts');
  const hybrid = read('server/services/cryptocrawl/runtime/hybrid-cex-execution-wiring.ts');
  const positiveCapture = read('server/services/cryptocrawl/runtime/positive-profit-capture-wiring.ts');
  const spotProducts = read('server/services/cryptocrawl/execution/cex-spot-product-policy.ts');
  const submitGuard = read('server/services/cryptocrawl/execution/cex-submit-time-product-guard.ts');
  const coinbaseMarket = read('server/services/cryptocrawl/intelligence/coinbase-advanced-market-data.ts');
  const timingGuard = read('server/services/cryptocrawl/integration/cross-venue-timing-guard-wiring.ts');
  const canonicalRuntime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
  const inventoryReadiness = read('server/services/cryptocrawl/integration/cex-inventory-readiness-wiring.ts');
  const adaptiveSearch = read('server/services/cryptocrawl/optimization/adaptive-profitability-search-policy.ts');
  const feeSurface = read('server/services/cryptocrawl/optimization/fee-surface-hyperdynamic-strategy-engine.ts');
  const stageProgression = read('server/services/cryptocrawl/governance/automatic-stage-progression.ts');
  const stageBootstrap = read('server/services/cryptocrawl/governance/stage-one-bootstrap-authority.ts');
  const stageHydrator = read('server/services/cryptocrawl/governance/stage-one-evidence-hydrator.ts');
  const rpiCapability = read('server/services/cryptocrawl/intelligence/okx-rpi-capability.ts');
  const gasFunding = read('server/services/cryptocrawl/capital-free/dynamic-gas-funding-engine.ts');
  const dynamicRoutes = read('server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts');
  const zeroResource = read('server/services/cryptocrawl/integration/zero-capital-resource-wiring.ts');
  const coreRuntime = read('server/services/cryptocrawl/runtime/core-runtime.ts');
  const graphlessScout = read('server/services/cryptocrawl/discovery/graphless-dex-scout.ts');

  // Parent -> children -> canonical terminal settlement.
  requirePattern(centralized, /\bexecuteHyperHybridCexPlan\s*\(/, 'centralized parent execution delegates to hyper-hybrid execution');
  requirePattern(hyperHybrid, /\bassertFreshCexProductConstraints\s*\(\s*child\s*\)/, 'every split child is submit-time product revalidated');
  requirePattern(hyperHybrid, /\bexecuteCexPlan\s*\(\s*child\b/, 'every admitted child reaches canonical CEX settlement');
  requirePattern(hyperHybrid, /plannedChildren\.slice\s*\(\s*0\s*,\s*concurrency\s*\)/, 'one bounded child batch is admitted');
  requirePattern(hyperHybrid, /Promise\.all\s*\(\s*admittedChildren\.map/s, 'admitted child batch executes concurrently');
  forbidPattern(hyperHybrid, /for\s*\(\s*let\s+offset[\s\S]{0,240}plannedChildren\.length[\s\S]{0,160}concurrency/, 'automatic sequential child waves');

  // Order maxima constrain child orders, never the full strategy parent. The
  // shared revalidator must preserve TT, MT, TM and MM execution semantics.
  requirePattern(hyperHybrid, /makerExecution\?:[\s\S]{0,180}buyMode\?:\s*PlannedLegMode[\s\S]{0,180}sellMode\?:\s*PlannedLegMode/, 'split revalidation recognizes maker/maker execution metadata');
  requirePattern(hyperHybrid, /shape\.hybridExecution\s*\?\?\s*shape\.makerExecution/, 'split revalidation resolves hybrid or maker execution modes');
  requirePattern(hyperHybrid, /'GTC_POST_ONLY'/, 'split maker children report post-only GTC order semantics');
  requirePattern(hyperHybrid, /'STRATEGY_SPECIFIC'/, 'strategy-specific hybrid children report delegated order semantics truthfully');
  requirePattern(hyperHybrid, /getOkxRpiExecutionCapability\(parent\.symbol,\s*true\)/, 'RPI-dependent parents refresh account capability before child sizing');
  requirePattern(hyperHybrid, /minimumRpiNotionalUsd/, 'RPI minimum notional constrains split children rather than being discovered after submit');
  requirePattern(hyperHybrid, /rebateOrderCountObjective:\s*false/, 'child splitting explicitly rejects rebate order-count farming as an objective');
  requirePattern(maker, /const\s+parentCeilingUsd\s*=\s*canary\.amount/, 'MM parent keeps the measured canary/ladder strategy ceiling');
  forbidPattern(maker, /maxOrderNotionalUsd|singleOrderEnvelopeUsd|directOrderCeilingUsd/, 'MM strategy treating a venue single-order maximum as the parent trade ceiling');

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
  requirePattern(makerDiscovery, /coinbase:\s*coinbaseSymbols/, 'maker discovery primes authenticated Coinbase fees alongside Kraken and OKX');
  requirePattern(makerDiscovery, /venue\s*===\s*'coinbase'\s*\|\|\s*venue\s*===\s*'kraken'\s*\|\|\s*venue\s*===\s*'okx'/, 'maker discovery consumes all three canonical executable venues');
  forbidPattern(makerDiscovery, /venue\s*!==\s*'coinbase'|coinbase_maker:false|coinbase_dependency:false/, 'maker discovery carrying a stale Coinbase exclusion');
  requirePattern(makerAdapters, /venue:\s*ExecutableCexVenue/, 'post-only maker adapter is shared across executable venues');
  requirePattern(makerAdapters, /limit_limit_gtc/, 'Coinbase post-only maker translation is installed');
  forbidPattern(fourMode, /buyVenue:\s*'kraken'\s*\|\s*'okx'|sellVenue:\s*'kraken'\s*\|\s*'okx'/, 'four-mode matrix narrowing strategy authority to Kraken/OKX');
  requirePattern(feeSurface, /buyVenue:\s*CexFeeVenue/, 'hyperdynamic fee routing consumes the three-venue canonical CEX fee type');
  forbidPattern(feeSurface, /buyVenue:\s*'kraken'\s*\|\s*'okx'|sellVenue:\s*'kraken'\s*\|\s*'okx'/, 'hyperdynamic fee routing narrowing its surface to Kraken/OKX');
  requirePattern(feeSurface, /artificial_tier_volume/, 'fee-surface policy explicitly prohibits artificial volume for fee tiers');
  requirePattern(timingGuard, /supportedModes:\s*\['TT',\s*'MT',\s*'TM',\s*'MM'\]/, 'cross-venue freshness timing covers all four CEX execution modes');
  requirePattern(timingGuard, /makerExecution/, 'MM timing guard recognizes canonical maker execution metadata');
  requirePattern(canonicalRuntime, /coinbaseMakerExecutionAuthority:\s*true/, 'runtime telemetry reflects actual Coinbase post-only maker authority');
  requirePattern(canonicalRuntime, /cexMakerExecution:\s*'coinbase_kraken_okx_post_only/, 'runtime telemetry reports the full Coinbase/Kraken/OKX post-only maker surface');
  forbidPattern(canonicalRuntime, /cexMakerExecution:\s*'kraken_okx_post_only/, 'runtime telemetry narrowing maker execution to Kraken/OKX');

  // High-probability measured recovery may recheck at ~1.75s, while broad scans
  // remain adaptive and fee/product private traffic stays under shared caches.
  requirePattern(adaptiveSearch, /highProbabilityFastLane/, 'adaptive search explicitly identifies the measured CEX fast lane');
  requirePattern(adaptiveSearch, /1_750/, 'measured high-probability CEX fast lane can reach 1750ms');
  requirePattern(adaptiveSearch, /feeFreshnessShare\s*>=\s*0\.75/, 'fast lane requires fresh-enough authenticated fee evidence');

  // Stage 1 never advances on unknown critical information. Instead it actively
  // refreshes canonical proof sources, and fully measured maker CEX plans count as
  // legitimate bootstrap evidence alongside standard CEX and zero-capital routes.
  requirePattern(stageHydrator, /measuredOpportunityGraph\.scanOnce\(\)/, 'Stage 1 proactively refreshes the canonical measured CEX graph');
  requirePattern(stageHydrator, /refreshCexInventoryReadinessNow\(\)/, 'Stage 1 proactively refreshes authenticated CEX inventory evidence');
  requirePattern(stageHydrator, /executionAuthority:\s*false/, 'Stage evidence hydration cannot grant execution authority');
  requirePattern(stageBootstrap, /candidate\.topology\s*!==\s*'MAKER_CEX'/, 'fully measured maker CEX candidates participate in Stage 1 validation');
  requirePattern(stageProgression, /eligibleMakerCexCandidate/, 'automatic progression recognizes fully measured maker CEX resource readiness');
  requirePattern(stageProgression, /missingEvidenceBypass:\s*false/, 'automatic progression remains fail closed when proof hydration is incomplete');

  // Universal product representation must never fabricate USD-denominated economics.
  requirePattern(maker, /USD_NORMALIZED_QUOTES/, 'maker planning has an explicit USD-normalization boundary');
  requirePattern(maker, /USD_NORMALIZED_QUOTES\.has\(quoteAsset\)/, 'maker planning rejects non-normalized quote assets before producing USD P&L');
  requirePattern(makerAdapters, /assertUsdNormalizedMakerEconomics\s*\(/, 'maker submission independently fails closed without USD normalization');
  requirePattern(positiveCapture, /venues:\s*\['coinbase',\s*'kraken',\s*'okx'\]/, 'profit-capture telemetry reports the actual three-venue maker surface');
  requirePattern(positiveCapture, /hardMaxCanaryUsd:\s*makerCanary\.hardMaxUsd/, 'maker status reports the real tighten-only ladder-bounded hard maximum');
  forbidPattern(positiveCapture, /hardMaxCanaryUsd:\s*finiteBoundedEnv\([^\n]*1_000_000/, 'legacy $1M telemetry presented as maker authority');

  // One product identity authority per venue family. Directory misses trigger a
  // forced live catalog hydration before a short authoritative negative cache.
  requirePattern(spotProducts, /getSpotProductConstraints[\s\S]*forceFresh\s*=\s*false/, 'Kraken/OKX product authority supports forced-fresh reads');
  requirePattern(spotProducts, /fetchKrakenSnapshot\(true\)/, 'Kraken directory miss triggers authoritative live catalog refresh');
  requirePattern(spotProducts, /fetchOkxSnapshot\(true\)/, 'OKX directory miss triggers authoritative live catalog refresh');
  requirePattern(spotProducts, /NEGATIVE_TTL_MS/, 'unsupported products use bounded negative caching rather than permanent local absence');
  requirePattern(spotProducts, /row\.base,\s*row\.quote/, 'Kraken canonical product identity consumes live base/quote fields');
  requirePattern(spotProducts, /raw\.baseCcy,\s*raw\.quoteCcy/, 'OKX canonical product identity consumes live base/quote fields');
  requirePattern(submitGuard, /getSpotProductConstraints\(venue,\s*symbol,\s*true\)/, 'submit-time Kraken/OKX drift guard force-refreshes canonical product authority');
  forbidPattern(submitGuard, /api\.kraken\.com|public\/instruments|match\(\/\^\(\[A-Z0-9\]/, 'submit-time guard implementing a second product directory/parser');
  requirePattern(coinbaseMarket, /resolveCoinbaseAdvancedProductId\s*\(/, 'Coinbase product ids resolve from the live product directory');
  forbidPattern(coinbaseMarket, /\(USDT\|USDC\|USD\)/, 'Coinbase live product authority using a stablecoin quote whitelist');
  forbidPattern(spotProducts, /\(USDT\|USDC\|USD\)/, 'Kraken/OKX live product authority using a stablecoin quote whitelist');
  requirePattern(feeResolver, /getSpotProductConstraints/, 'authenticated fee routing consumes canonical live product authority');
  forbidPattern(feeResolver, /const\s+quotes\s*=\s*\['USDT'|\(USDT\|USDC\|USD\)/, 'fee resolver carrying an independent quote-currency product parser');
  requirePattern(arbVerifier, /getSpotProductConstraints\('kraken',\s*symbol\)/, 'Kraken executable REST depth resolves exact live exchange symbol');
  requirePattern(arbVerifier, /getSpotProductConstraints\('okx',\s*symbol\)/, 'OKX executable REST depth resolves exact regional live exchange symbol');
  forbidPattern(arbVerifier, /function\s+okxInstId|\(USDT\|USDC\|USD\)/, 'arbitrage verifier reintroducing a quote-currency instrument parser');

  // Authenticated RPI capability is account/product specific and cannot be a
  // public-fee assumption or an advisory-only substitute at execution time.
  requirePattern(rpiCapability, /makerPermission:\s*permissionState\s*===\s*'2'/, 'OKX RPI maker permission is authenticated per account/product');
  requirePattern(rpiCapability, /minimumRpiNotionalUsd/, 'OKX RPI capability carries the current minimum-notional rule');
  requirePattern(rpiCapability, /rpiMinLevel/, 'OKX RPI capability measures spacing constraints');

  // Authenticated inventory rows with zero balances cannot masquerade as funded
  // assets or alter readiness pressure.
  requirePattern(inventoryReadiness, /positiveBalanceAssets/, 'inventory readiness distinguishes funded assets from zero-balance rows');
  requirePattern(inventoryReadiness, /inventoryAssetCount:\s*metrics\.positiveBalanceAssetCount/, 'readiness pressure consumes funded asset count');
  requirePattern(inventoryReadiness, /syntheticBalancesAllowed:\s*false/, 'inventory readiness remains authenticated and fail closed');
  requirePattern(inventoryReadiness, /refreshCexInventoryReadinessNow/, 'governance can request the same single-flight authenticated inventory authority on demand');

  // Sponsored/user-op gas is an execution property, not a synthetic discount.
  // The live funding decision is bound before route ranking; native execution is
  // admitted only because receipt gas is terminally converted and subtracted.
  requirePattern(gasFunding, /mode:\s*'native'/, 'sufficient native reserve can use terminal-accounted native gas execution');
  requirePattern(gasFunding, /actual receipt gas is terminally converted and subtracted/, 'native funding explicitly depends on terminal gas accounting');
  requirePattern(canonicalRuntime, /ensureZeroCapitalRealizedProfitWiring\(\);[\s\S]{0,240}ensureDynamicRpcProviderWiring\(\)[\s\S]{0,160}startCanonicalZeroCapitalRuntime/, 'realized-profit wiring is installed before zero-capital lifecycle start');
  requirePattern(coreRuntime, /ensureZeroCapitalRealizedProfitWiring\(\);/, 'core lifecycle reasserts the same idempotent realized-profit authority synchronously');
  forbidPattern(coreRuntime, /scheduleZeroCapitalProfitWiring|zeroCapitalRealizedProfitPolicyScheduled/, 'deferred duplicate realized-profit authority scheduling');
  requirePattern(zeroResource, /discoverDynamicZeroCapitalQuotes\(chain,\s*provider,\s*funding\.mode\)/, 'dynamic quote economics consume the live gas-funding decision');
  requirePattern(dynamicRoutes, /fundingMode\s*===\s*'sponsored'/, 'dynamic route gas compression recognizes verified sponsored funding');
  requirePattern(dynamicRoutes, /gasCostAuthority:\s*'verified_sponsored_user_cost_zero'/, 'sponsored zero-user-gas economics are explicitly provenance-bound');
  requirePattern(dynamicRoutes, /recoveryQuoteRoutes\s*\(/, 'zero-measured-quote funnel has a bounded recovery quote lane');
  requirePattern(dynamicRoutes, /minNetProfitBps:\s*0/, 'dynamic route compatibility field has no artificial positive BPS floor');
  requirePattern(graphlessScout, /archiveRestrictedKeys/, 'public RPC archive capability is learned and cached');
  requirePattern(graphlessScout, /recentFilter\s*\(/, 'archive-restricted RPC discovery falls back to bounded recent logs');

  return {
    centralized, hyperHybrid, partialAccounting, residualReplan, capability, fourMode, feeResolver, arbVerifier,
    maker, makerDiscovery, makerAdapters, hybrid, positiveCapture, spotProducts, submitGuard, coinbaseMarket,
    timingGuard, canonicalRuntime, inventoryReadiness, adaptiveSearch, feeSurface, stageProgression, stageBootstrap,
    stageHydrator, rpiCapability, gasFunding, dynamicRoutes, zeroResource, coreRuntime, graphlessScout,
  };
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
