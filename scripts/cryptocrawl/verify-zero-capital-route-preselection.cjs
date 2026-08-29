const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

const preselection = read('server/services/cryptocrawl/discovery/zero-capital-route-preselection.ts');
const discovery = read('server/services/cryptocrawl/discovery/dynamic-zero-capital-routes.ts');
const quoter = read('server/services/cryptocrawl/execution/adapters/onchain-route-quoter.ts');

requireText(preselection, "authority: 'quote_budget_advisory_only'", 'preselection declares advisory-only quote-budget authority');
requireText(preselection, 'deterministicProfitAuthority: false', 'preselection cannot become deterministic-profit authority');
requireText(preselection, 'executionAuthority: false', 'preselection cannot become execution authority');
requireText(preselection, 'deterministicExploration', 'preselection preserves deterministic exploration');
requireText(preselection, 'oldestFirst', 'exploration prioritizes oldest/unobserved evidence');
requireText(preselection, 'ZERO_CAPITAL_ROUTE_EXPLORATION_FRACTION', 'exploration share is explicit and bounded');
requireText(preselection, 'Math.max(1, Math.min(quoteBudget', 'non-full quote cycles preserve at least one exploration slot');
requireText(preselection, 'ZERO_CAPITAL_DYNAMIC_QUOTE_BUDGET', 'fresh quote work has an explicit local budget');
requireText(preselection, 'return (item.positiveQuotes + 1) / (item.attempts + 2)', 'historical positive yield remains smoothed measured evidence');
requireText(preselection, 'lastMeasuredAt', 'measured near-miss freshness is retained separately from positive history');
requireText(preselection, 'recentMeasuredNotionalUsd', 'measured notional evidence can rank negative and positive observations');
requireText(preselection, 'measuredEdgePotential', 'measured BPS distance contributes only to advisory quote allocation');
requireText(preselection, 'ZERO_CAPITAL_NEAR_BREAK_EVEN_SCALE_BPS', 'near-break-even prioritization scale is explicit and bounded');
requireText(preselection, 'item.recentNetProfitBps > 0', 'positive measured edges retain preferential score treatment');
requireText(preselection, 'Math.abs(netProfitBps)', 'negative measured edges are ranked by distance to break-even rather than fabricated profit');
requireText(preselection, 'Math.max(0, item.recentNetProfitBps)', 'negative evidence cannot be converted into positive economic consequence for formation authority');
requireText(preselection, 'gasCostUsd / Math.max', 'ranking accounts for measured gas pressure');
requireText(preselection, 'quoteCost(route)', 'ranking accounts for bounded quote cost');
forbidText(preselection, 'Math.random', 'quote-budget exploration cannot use nondeterministic random starvation');
forbidText(preselection, 'stageManager', 'quote-budget preselection cannot become governance authority');
forbidText(preselection, 'executeVerifiedArbitragePlan', 'quote-budget preselection cannot execute trades');

requireText(discovery, 'buildDynamicZeroCapitalRouteTemplates(chain)', 'full structural universe is still enumerated before preselection');
requireText(discovery, 'state.structuralCandidates += templates.length', 'structural coverage remains independently observable');
requireText(discovery, 'selectZeroCapitalRoutesForQuote(enriched.routes, enriched.gasCostUsd)', 'preselection occurs only after measured gas enrichment');
requireText(discovery, 'quoteConfiguredZeroCapitalRoutesForChain(chain, provider, selected)', 'only admitted fresh quote work is sent to the expensive quoter');
requireText(discovery, 'recordZeroCapitalRouteQuoteCycle(selected, quotes)', 'fresh measured results feed future quote-budget evidence');
requireText(discovery, 'syntheticEvidenceAllowed: false', 'dynamic zero-capital discovery rejects synthetic evidence');

requireText(quoter, 'grossProfit - allInCost', 'all-in economics remain independent of advisory pre-score');
requireText(quoter, 'if (netProfitBps < discoveryFloorBps) return null', 'observation-only near-miss envelope remains bounded');
requireText(quoter, 'executablePositive: netProfit > 0n', 'strict deterministic positive all-in net economics remain executable authority');
requireText(quoter, 'const selectionPool = admissible.length > 0 ? admissible : observed', 'positive executable size remains preferred over observation-only near misses');
forbidText(quoter, 'preScore', 'advisory pre-score cannot leak into deterministic profitability');

if (failures.length > 0) {
  console.error('[zero-capital-route-preselection] FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[zero-capital-route-preselection] PASS — structural breadth and deterministic exploration are preserved while measured positive and near-break-even BPS can steer advisory exploitation; strict all-in net-positive execution authority is unchanged');
