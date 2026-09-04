const fs = require('fs');

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
  return fs.readFileSync(path, 'utf8');
}

function requirePattern(text, pattern, message) {
  if (!pattern.test(text)) throw new Error(message);
}

function forbidPattern(text, pattern, message) {
  if (pattern.test(text)) throw new Error(message);
}

const types = read('server/services/cryptocrawl/optimization/nix-gen/types.ts');
const optimizer = read('server/services/cryptocrawl/optimization/nix-gen/global-optimizer.ts');
const coordinator = read('server/services/cryptocrawl/optimization/nix-gen/coordinator.ts');
const adapters = read('server/services/cryptocrawl/optimization/nix-gen/canonical-bid-adapters.ts');
const cexResources = read('server/services/cryptocrawl/execution/resource-scheduler.ts');
const zeroResources = read('server/services/cryptocrawl/execution/zero-capital-resource-scheduler.ts');

requirePattern(types, /decisionAuthority:\s*'advisory_only'/, 'Nix-Gen must remain advisory-only');
requirePattern(types, /executionAuthority:\s*false/, 'Nix-Gen must not gain execution authority');
requirePattern(types, /canonicalEconomicsAuthority:\s*false/, 'Nix-Gen must not gain canonical economics authority');
requirePattern(types, /netBps:\s*number\s*\|\s*null/, 'Nix-Gen must preserve unknown canonical BPS instead of recalculating it');
requirePattern(types, /priorityOrderOpportunityIds/, 'Nix-Gen must preserve a complete advisory priority order');

requirePattern(optimizer, /non_positive_canonical_economics/, 'Nix-Gen must reject non-positive canonical economics from its optimizer input');
requirePattern(optimizer, /not_canonically_eligible/, 'Nix-Gen must consume already-eligible opportunities only');
requirePattern(optimizer, /execution_not_authoritative/, 'Nix-Gen must require an existing authoritative execution path');
requirePattern(optimizer, /settlement_not_capable/, 'Nix-Gen must require settlement capability');
requirePattern(optimizer, /expiresAt\s*<=\s*now/, 'Nix-Gen must reject expired bids');
requirePattern(optimizer, /duplicate_bid_id/, 'Nix-Gen must reject duplicate bid identities');
requirePattern(optimizer, /Math\.min\(MAX_EXACT_BID_LIMIT/, 'Exact optimization must have a hard bounded candidate limit');
requirePattern(optimizer, /exact_branch_and_bound/, 'Nix-Gen must retain an exact bounded optimization path');
requirePattern(optimizer, /deterministic_greedy/, 'Nix-Gen must have a deterministic bounded-cost fallback');
requirePattern(optimizer, /priorityOrder\s*=\s*\[\.\.\.selectedOrdered,\s*\.\.\.remainderOrdered\]/, 'Valid non-selected bids must remain in the advisory priority order');

requirePattern(coordinator, /filtersCanonicalCandidates:\s*false/, 'Nix-Gen coordination must explicitly preserve canonical candidates');
requirePattern(coordinator, /executionAuthority:\s*false/, 'Nix-Gen coordination must not become execution authority');
requirePattern(coordinator, /scheduler:dispatch_batch/, 'Nix-Gen must model the existing dispatch batch as a shared advisory resource');
requirePattern(coordinator, /fallbackComparator\(left, right\)/, 'Nix-Gen ordering must fall back to the existing scheduler order');

requirePattern(adapters, /getCexPlanningProjection\(plan\)/, 'CEX Nix-Gen bids must consume the existing resource scheduler projection');
requirePattern(adapters, /getMeasuredAtomicPlanningProjection/, 'Atomic Nix-Gen bids must consume the existing zero-capital resource scheduler projection');
requirePattern(adapters, /resourceProjectionMutatesState:\s*projection\.mutatesResourceState/, 'Nix-Gen bid provenance must carry resource projection mutation truth');

requirePattern(cexResources, /getCexPlanningProjection\(plan: VerifiedArbitragePlan\)/, 'CEX resource scheduler must expose a read-only planning projection');
requirePattern(cexResources, /authority:\s*'execution_resource_scheduler_read_only'/, 'CEX planning projection must identify its authority boundary');
requirePattern(cexResources, /mutatesResourceState:\s*false/, 'CEX planning projection must be non-mutating');
requirePattern(zeroResources, /getMeasuredAtomicPlanningProjection/, 'Zero-capital resource scheduler must expose a read-only planning projection');
requirePattern(zeroResources, /authority:\s*'zero_capital_resource_scheduler_read_only'/, 'Atomic planning projection must identify its authority boundary');
requirePattern(zeroResources, /mutatesResourceState:\s*false/, 'Atomic planning projection must be non-mutating');

for (const [name, text] of [['optimizer', optimizer], ['coordinator', coordinator], ['adapters', adapters]]) {
  forbidPattern(text, /executeVerifiedArbitragePlan|submitOrder|placeOrder|broadcastTransaction|sendTransaction/, `${name} must not submit or execute trades`);
  forbidPattern(text, /stageManager\.|killSwitch\.|profitLadder\./, `${name} must not override governance authorities`);
  forbidPattern(text, /recordSettlement|recordProfit|learnFrom|training/, `${name} must not create settlement or learning authority`);
}

console.log('NIX-GEN FOUNDATION VERIFIER PASSED');
