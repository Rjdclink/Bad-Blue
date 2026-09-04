const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function requireText(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`NIX_GEN_COMPLETION_MISSING: ${label}`);
}
function forbidText(text, needle, label) {
  if (text.includes(needle)) throw new Error(`NIX_GEN_COMPLETION_REGRESSION: ${label}`);
}

const index = read('server/services/cryptocrawl/optimization/nix-gen/index.ts');
const dual = read('server/services/cryptocrawl/optimization/nix-gen/dual-resource-pricing.ts');
const quanti = read('server/services/cryptocrawl/optimization/nix-gen/quanti-analysis.ts');
const globalLive = read('server/services/cryptocrawl/optimization/nix-gen/global-live-portfolio.ts');
const limbs = read('server/services/cryptocrawl/optimization/nix-gen/strategy-limb-registry.ts');
const portfolio = read('server/services/cryptocrawl/optimization/nix-gen/portfolio-view.ts');
const integration = read('server/services/cryptocrawl/optimization/nix-gen/integration-contract.ts');
const measuredAdapter = read('server/services/cryptocrawl/execution/measured-topology-execution-adapter.ts');

for (const moduleName of [
  'dual-resource-pricing',
  'quanti-analysis',
  'global-live-portfolio',
  'strategy-limb-registry',
  'capital-routing-advisory',
  'integration-contract',
]) {
  requireText(index, `./${moduleName}.js`, `index exports ${moduleName}`);
}

requireText(dual, "isDualDerived: true", 'dual prices are explicitly optimization-derived');
requireText(dual, "exactDualOptimalityClaim: false", 'integer allocation never claims exact strong duality');
requireText(dual, "projected_subgradient_lagrangian_relaxation", 'dual-price method is named honestly');
requireText(dual, "advisory: undefined", 'dual pricing strips advisory modifiers and uses canonical profit');

requireText(quanti, "from '../../../quantiComp/index.js'", 'heavy analysis uses canonical QuantiComp');
requireText(quanti, "computePath: 'quanti_comp' | 'inline_fallback'", 'QuantiComp has deterministic inline fallback');
requireText(quanti, "backendEligible: false", 'closure workload cannot be silently migrated to an incompatible backend');
requireText(quanti, "sideEffectFree: true", 'Quanti workload is side-effect free');
requireText(quanti, "return buildNixGenAnalysisInline", 'Quanti failure falls back rather than disabling Nix-Gen');

requireText(globalLive, "authority: 'nix_gen_global_live_portfolio'", 'mixed live portfolio has explicit authority');
requireText(globalLive, 'executionAuthority: false', 'mixed live portfolio cannot execute');
requireText(globalLive, 'filtersCanonicalCandidates: false', 'mixed live portfolio cannot filter canonical candidates');
requireText(globalLive, 'cexPreparedCount', 'mixed portfolio includes CEX preparation');
requireText(globalLive, 'measuredPreparedCount', 'mixed portfolio includes measured topology preparation');

requireText(limbs, 'requiresAuthoritativeExecutionPath: true', 'every strategy limb requires upstream execution capability');
requireText(limbs, 'requiresSettlementCapability: true', 'every strategy limb requires settlement capability');
requireText(limbs, 'executionAuthority: false', 'strategy limbs are not executors');
requireText(portfolio, 'resolveNixGenStrategyLimb', 'portfolio resolves strategy limbs');
requireText(portfolio, 'strategyLimbAvailable', 'portfolio exposes actual limb availability');

requireText(integration, "id: 'canonical_economics'", 'canonical economics integration is explicit');
requireText(integration, "id: 'cryptara_monte_carlo'", 'Cryptara/Monte Carlo integration is explicit');
requireText(integration, "id: 'tradingview_multi_oracle'", 'TradingView/MultiOracle integration is explicit');
requireText(integration, "id: 'quanti_comp'", 'QuantiComp integration is explicit');
requireText(integration, "id: 'dynamic_scale_physics'", 'DynamicScale integration is explicit');
requireText(integration, "id: 'profit_ladder_stage_risk'", 'ProfitLadder/stage/risk authority is explicit');
requireText(integration, "id: 'cognitive_fabric'", 'CognitiveFabric boundary is explicit');
requireText(integration, "mode: 'research_only'", 'research-only systems cannot enter hot execution truth');

requireText(measuredAdapter, 'orderSettlementCapableMeasuredDecisionsWithNixGen', 'measured live adapter consumes Nix-Gen ordering');
requireText(measuredAdapter, 'canonicalAdmissionChanged: false', 'measured ordering cannot alter canonical admission');
requireText(measuredAdapter, 'executionAuthorityChanged: false', 'measured ordering cannot alter execution authority');

for (const text of [dual, quanti, globalLive, limbs, portfolio, integration]) {
  forbidText(text, 'WALLET_PRIVATE_KEY', 'Nix-Gen must not access signer secrets');
  forbidText(text, '.sendTransaction(', 'Nix-Gen must not submit transactions');
  forbidText(text, '.transfer(', 'Nix-Gen must not move treasury funds');
}

console.log('NIX_GEN_COMPLETION_STATIC_OK');
