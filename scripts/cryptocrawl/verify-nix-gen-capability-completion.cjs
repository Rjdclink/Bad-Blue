const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function must(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`NIX_GEN_CAPABILITY_COMPLETION_MISSING: ${label}`);
}
function mustNot(text, needle, label) {
  if (text.includes(needle)) throw new Error(`NIX_GEN_CAPABILITY_COMPLETION_REGRESSION: ${label}`);
}

const index = read('server/services/cryptocrawl/optimization/nix-gen/index.ts');
const bids = read('server/services/cryptocrawl/optimization/nix-gen/canonical-bid-adapters.ts');
const live = read('server/services/cryptocrawl/optimization/nix-gen/live-priority-registry.ts');
const zeroOrdering = read('server/services/cryptocrawl/optimization/nix-gen/zero-capital-ordering.ts');
const zeroWiring = read('server/services/cryptocrawl/integration/zero-capital-shadow-priority-wiring.ts');
const cexOrdering = read('server/services/cryptocrawl/optimization/nix-gen/cex-ordering.ts');
const measuredOrdering = read('server/services/cryptocrawl/optimization/nix-gen/measured-portfolio-preparation.ts');
const crossChain = read('server/services/cryptocrawl/discovery/cross-chain-opportunity-generator.ts');
const funding = read('server/services/cryptocrawl/discovery/funding-rate-monitor.ts');
const manifest = read('server/services/cryptocrawl/optimization/nix-gen/completion-manifest.ts');

must(index, "./zero-capital-ordering.js", 'zero-capital ordering is exported');
must(index, "./live-priority-registry.js", 'shared live priority registry is exported');

must(bids, "strategyClass: 'market_making'", 'maker CEX plans map to the market-making finger');
must(bids, "zero_capital_engine:dispatchExecutableOpportunities", 'zero-capital authoritative execution path is explicit');
must(bids, "zero_capital_engine:terminal_realized_profit_wiring", 'zero-capital terminal settlement capability authority is explicit');

must(zeroWiring, 'orderZeroCapitalOpportunitiesWithNixGen', 'existing zero-capital queue consumes Nix-Gen ordering');
must(zeroWiring, 'applyPreviousResourceShadowOrdering', 'previous zero-capital ordering remains fail-open fallback');
must(zeroWiring, 'executionAuthorityChanged: false', 'zero-capital Nix-Gen wiring does not acquire execution authority');

must(live, "authority: 'nix_gen_shared_live_priority_registry'", 'shared global live priority authority is explicit');
must(live, 'executionAuthority: false', 'shared registry cannot execute');
must(live, 'resourceAuthority: false', 'shared registry cannot acquire resources');
must(live, 'filtersCanonicalCandidates: false', 'shared registry cannot filter canonical candidates');
must(cexOrdering, "source: 'cex'", 'CEX lane publishes to global live priority');
must(measuredOrdering, "source: 'measured_atomic'", 'measured atomic lane publishes to global live priority');
must(zeroOrdering, "source: 'zero_capital'", 'zero-capital lane publishes to global live priority');

must(crossChain, "'cross_chain_source_destination_profit_leg'", 'cross-chain still requires a real revenue leg');
must(crossChain, 'executableCapability: false', 'cross-chain transport is not falsely promoted to profitable execution');
must(funding, "'funding_venue_lifecycle_adapter'", 'funding still requires a lifecycle adapter');
must(funding, 'executableCapability: false', 'funding public discovery is not falsely promoted');

must(manifest, "zero_capital_live_finger', state: 'implemented'", 'manifest records zero-capital finger completion');
must(manifest, "market_making_live_finger', state: 'implemented'", 'manifest records market-making finger completion');
must(manifest, "cross_chain_live_finger', state: 'upstream_capability_required'", 'manifest truthfully preserves cross-chain dependency');
must(manifest, "funding_rate_live_finger', state: 'upstream_capability_required'", 'manifest truthfully preserves funding dependency');

for (const text of [bids, live, zeroOrdering]) {
  mustNot(text, 'WALLET_PRIVATE_KEY', 'Nix-Gen capability layer must not access signer secrets');
  mustNot(text, '.sendTransaction(', 'Nix-Gen capability layer must not submit transactions');
  mustNot(text, '.transfer(', 'Nix-Gen capability layer must not move funds');
}

console.log('NIX_GEN_CAPABILITY_COMPLETION_OK');
