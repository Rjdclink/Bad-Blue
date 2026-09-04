const fs = require('fs');
const ts = require('typescript');

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

function stringLiteralUnionMembers(sourceText, aliasName) {
  const sourceFile = ts.createSourceFile('nix-gen-types.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = sourceFile.statements.find(statement =>
    ts.isTypeAliasDeclaration(statement) && statement.name.text === aliasName,
  );
  if (!declaration) throw new Error(`Missing type alias ${aliasName}`);
  if (!ts.isUnionTypeNode(declaration.type)) throw new Error(`${aliasName} must remain a string-literal union`);

  const members = new Set();
  for (const typeNode of declaration.type.types) {
    if (!ts.isLiteralTypeNode(typeNode) || !ts.isStringLiteral(typeNode.literal)) {
      throw new Error(`${aliasName} must contain only string-literal members`);
    }
    members.add(typeNode.literal.text);
  }
  return members;
}

const types = read('server/services/cryptocrawl/optimization/nix-gen/types.ts');
const optimizer = read('server/services/cryptocrawl/optimization/nix-gen/global-optimizer.ts');
const coordinator = read('server/services/cryptocrawl/optimization/nix-gen/coordinator.ts');
const adapters = read('server/services/cryptocrawl/optimization/nix-gen/canonical-bid-adapters.ts');
const cexOrdering = read('server/services/cryptocrawl/optimization/nix-gen/cex-ordering.ts');
const scarcity = read('server/services/cryptocrawl/optimization/nix-gen/scarcity-pricing.ts');
const replanner = read('server/services/cryptocrawl/optimization/nix-gen/replanner.ts');
const cexResources = read('server/services/cryptocrawl/execution/resource-scheduler.ts');
const zeroResources = read('server/services/cryptocrawl/execution/zero-capital-resource-scheduler.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');

const rejectionReasons = stringLiteralUnionMembers(types, 'NixGenBidRejectionReason');
const deferredReasons = stringLiteralUnionMembers(types, 'NixGenDeferredBidReason');

requirePattern(types, /decisionAuthority:\s*'advisory_only'/, 'Nix-Gen must remain advisory-only');
requirePattern(types, /executionAuthority:\s*false/, 'Nix-Gen must not gain execution authority');
requirePattern(types, /canonicalEconomicsAuthority:\s*false/, 'Nix-Gen must not gain canonical economics authority');
requirePattern(types, /netBps:\s*number\s*\|\s*null/, 'Nix-Gen must preserve unknown canonical BPS instead of recalculating it');
requirePattern(types, /priorityOrderOpportunityIds/, 'Nix-Gen must preserve a complete advisory priority order');
requirePattern(types, /deferred:\s*NixGenDeferredBid\[\]/, 'Nix-Gen must distinguish advisory deferral from hard rejection');
if (!deferredReasons.has('resource_unavailable')) throw new Error('Temporary resource unavailability must be representable as advisory deferral');
if (!deferredReasons.has('mutual_exclusion')) throw new Error('Mutual exclusion must be representable as advisory deferral');
if (!rejectionReasons.has('resource_budget_missing')) throw new Error('Missing resource evidence must remain a hard-invalid input');
for (const reason of ['not_selected_by_optimizer', 'mutual_exclusion', 'resource_unavailable']) {
  if (rejectionReasons.has(reason)) throw new Error(`${reason} must not be represented as hard rejection`);
}

requirePattern(optimizer, /non_positive_canonical_economics/, 'Nix-Gen must reject non-positive canonical economics from its optimizer input');
requirePattern(optimizer, /not_canonically_eligible/, 'Nix-Gen must consume already-eligible opportunities only');
requirePattern(optimizer, /execution_not_authoritative/, 'Nix-Gen must require an existing authoritative execution path');
requirePattern(optimizer, /settlement_not_capable/, 'Nix-Gen must require settlement capability');
requirePattern(optimizer, /expiresAt\s*<=\s*now/, 'Nix-Gen must reject expired bids');
requirePattern(optimizer, /duplicate_bid_id/, 'Nix-Gen must reject duplicate bid identities');
requirePattern(optimizer, /resource_budget_missing/, 'Nix-Gen must reject missing resource-capacity evidence without inventing capacity');
requirePattern(optimizer, /Math\.min\(MAX_EXACT_BID_LIMIT/, 'Exact optimization must have a hard bounded candidate limit');
requirePattern(optimizer, /exact_branch_and_bound/, 'Nix-Gen must retain an exact bounded optimization path');
requirePattern(optimizer, /deterministic_greedy/, 'Nix-Gen must have a deterministic bounded-cost fallback');
requirePattern(optimizer, /priorityOrder\s*=\s*\[\.\.\.selectedOrdered,\s*\.\.\.remainderOrdered\]/, 'Valid non-selected bids must remain in the advisory priority order');
requirePattern(optimizer, /const deferred:\s*NixGenDeferredBid\[\]\s*=\s*\[\]/, 'Nix-Gen must track valid non-selected bids as deferred');
requirePattern(optimizer, /unavailableAgainstCurrentBudget/, 'Nix-Gen must distinguish current capacity insufficiency from invalid resource evidence');
requirePattern(optimizer, /\?\s*'resource_unavailable'\s*:\s*'resource_contention'/, 'Nix-Gen deferral reason must distinguish unavailable capacity from contention');
forbidPattern(optimizer, /rejected\.push\([\s\S]{0,220}'not_selected_by_optimizer'/, 'Valid advisory non-selection must never enter rejected state');

requirePattern(coordinator, /filtersCanonicalCandidates:\s*false/, 'Nix-Gen coordination must explicitly preserve canonical candidates');
requirePattern(coordinator, /executionAuthority:\s*false/, 'Nix-Gen coordination must not become execution authority');
requirePattern(coordinator, /scheduler:dispatch_batch/, 'Nix-Gen must model the existing dispatch batch as a shared advisory resource');
requirePattern(coordinator, /fallbackComparator\(left, right\)/, 'Nix-Gen ordering must fall back to the existing scheduler order');

requirePattern(adapters, /getCanonicalExecutionCapabilities/, 'CEX Nix-Gen execution capability must come from the existing canonical capability authority');
requirePattern(adapters, /supportedCentralizedVenues/, 'CEX Nix-Gen must consume canonical supported venue truth');
requirePattern(adapters, /executable:\s*executionSupported/, 'CEX Nix-Gen executable truth must be derived from canonical capability support');
requirePattern(adapters, /settlementCapable:\s*executionSupported/, 'CEX Nix-Gen settlement capability must be derived from canonical capability support');
requirePattern(adapters, /getCexPlanningProjection\(plan\)/, 'CEX Nix-Gen bids must consume the existing resource scheduler projection');
requirePattern(adapters, /getMeasuredAtomicPlanningProjection/, 'Atomic Nix-Gen bids must consume the existing zero-capital resource scheduler projection');
requirePattern(adapters, /resourceProjectionMutatesState:\s*projection\.mutatesResourceState/, 'Nix-Gen bid provenance must carry resource projection mutation truth');
requirePattern(adapters, /profitabilityScore[\s\S]{0,220}double-count/, 'Measured-topology adapter must document profitability-score double-count prevention');
forbidPattern(adapters, /rankScore:\s*Number\.isFinite\(decision\.score\.profitabilityScore\)/, 'Measured-topology profitabilityScore must not be re-applied as Nix-Gen rank');

requirePattern(cexOrdering, /CRYPTOCRAWL_NIX_GEN_ADVISORY_ORDERING\s*!==\s*'false'/, 'Completed CEX Nix-Gen advisory ordering must remain default-on with an explicit false rollback switch');
requirePattern(cexOrdering, /if \(!enabled\)/, 'Disabled Nix-Gen ordering must immediately preserve canonical order');
requirePattern(cexOrdering, /if \(original\.length === 0\)/, 'Empty CEX candidate sets must preserve canonical ordering without advisory work');
requirePattern(cexOrdering, /catch \(error\)[\s\S]{0,450}candidates:\s*original/, 'Nix-Gen ordering errors must fail open to canonical ordering');
forbidPattern(cexOrdering, /settlementCapable:\s*true/, 'CEX ordering caller must not assert settlement capability');
forbidPattern(cexOrdering, /\.filter\([^\n]*candidate/, 'CEX Nix-Gen ordering must not filter canonical candidates');

requirePattern(scarcity, /authority:\s*'nix_gen_advisory_scarcity'/, 'Scarcity signaling must identify itself as advisory');
requirePattern(scarcity, /executionAuthority:\s*false/, 'Scarcity signaling must not gain execution authority');
requirePattern(scarcity, /resourceAuthority:\s*false/, 'Scarcity signaling must not become resource authority');
requirePattern(scarcity, /normalizedScarcitySignal/, 'Scarcity signaling must expose a bounded advisory scarcity signal');
requirePattern(scarcity, /Math\.max\(0,\s*Math\.min\(1,\s*value\)\)/, 'Scarcity signal normalization must be explicitly bounded');
forbidPattern(scarcity, /normalizedShadowPrice/, 'Heuristic scarcity must not be mislabeled as a shadow price');
forbidPattern(scarcity, /acquire|reserve|release\(/, 'Scarcity signaling must not mutate or reserve canonical resources');

requirePattern(replanner, /authority:\s*'nix_gen_advisory_replanner'/, 'Replanner must identify itself as advisory');
requirePattern(replanner, /executionAuthority:\s*false/, 'Replanner must not gain execution authority');
requirePattern(replanner, /resourceAuthority:\s*false/, 'Replanner must not gain resource authority');
requirePattern(replanner, /filtersCanonicalCandidates:\s*false/, 'Replanner must not filter canonical candidates');
requirePattern(replanner, /createHash\('sha256'\)/, 'Replanner must fingerprint planning truth deterministically');
for (const requiredTruth of ['netProfitUsd', 'notionalUsd', 'netBps', 'measuredAt', 'authority', 'resources', 'budgets', 'dispatchCapacity']) {
  if (!replanner.includes(requiredTruth)) throw new Error(`Replanner fingerprint must include ${requiredTruth}`);
}
requirePattern(replanner, /planMaxAgeAt/, 'Replanner must bound advisory plan age');
requirePattern(replanner, /temporalBoundaryAt/, 'Replanner must invalidate reuse at bid/evidence temporal boundaries');
requirePattern(replanner, /reason === 'unchanged'[\s\S]{0,160}now < previous\.validUntil/, 'Replanner may reuse only unchanged still-valid advisory plans');
forbidPattern(replanner, /setInterval|setTimeout|queueMicrotask/, 'Replanner must not create a competing scheduling loop');

requirePattern(cexResources, /getCexPlanningProjection\(plan: VerifiedArbitragePlan\)/, 'CEX resource scheduler must expose a read-only planning projection');
requirePattern(cexResources, /authority:\s*'execution_resource_scheduler_read_only'/, 'CEX planning projection must identify its authority boundary');
requirePattern(cexResources, /mutatesResourceState:\s*false/, 'CEX planning projection must be non-mutating');
requirePattern(zeroResources, /getMeasuredAtomicPlanningProjection/, 'Zero-capital resource scheduler must expose a read-only planning projection');
requirePattern(zeroResources, /authority:\s*'zero_capital_resource_scheduler_read_only'/, 'Atomic planning projection must identify its authority boundary');
requirePattern(zeroResources, /mutatesResourceState:\s*false/, 'Atomic planning projection must be non-mutating');

requirePattern(scheduler, /\.filter\(snapshot => snapshot\.status === 'eligible'\)/, 'Canonical eligible filter must remain ahead of Nix-Gen ordering');
requirePattern(scheduler, /runtimeInvariantMonitor\.evaluate\(snapshot\)\.allowed/, 'Runtime invariant hard gate must remain ahead of Nix-Gen ordering');
requirePattern(scheduler, /snapshot\.plan\.netProfitUsd > 0/, 'Positive deterministic economics hard gate must remain ahead of Nix-Gen ordering');
requirePattern(scheduler, /snapshot\.plan\.quoteAgeMs <= maxQuoteAgeMs/, 'Canonical quote freshness gate must remain ahead of Nix-Gen ordering');
requirePattern(scheduler, /snapshot\.governance\.killSwitchActive === false/, 'Kill-switch gate must remain ahead of Nix-Gen ordering');
requirePattern(scheduler, /snapshot\.governance\.paused === false/, 'Governance pause gate must remain ahead of Nix-Gen ordering');
const schedulerSort = scheduler.indexOf('.sort((left, right) =>');
const nixCall = scheduler.indexOf('orderCexCandidatesWithNixGen({');
if (schedulerSort < 0 || nixCall < 0 || nixCall <= schedulerSort) throw new Error('Nix-Gen ordering must occur only after canonical filters and canonical fallback sort');
requirePattern(scheduler, /Nix-Gen advisory ordering failed open to canonical order/, 'Scheduler must explicitly fail open on Nix-Gen advisory errors');
requirePattern(scheduler, /nixGenExecutionAuthority:\s*false/, 'Scheduler telemetry must state Nix-Gen has no execution authority');

for (const [name, text] of [
  ['optimizer', optimizer],
  ['coordinator', coordinator],
  ['adapters', adapters],
  ['cexOrdering', cexOrdering],
  ['scarcity', scarcity],
  ['replanner', replanner],
]) {
  forbidPattern(text, /executeVerifiedArbitragePlan|submitOrder|placeOrder|broadcastTransaction|sendTransaction/, `${name} must not submit or execute trades`);
  forbidPattern(text, /stageManager\.|killSwitch\.|profitLadder\./, `${name} must not override governance authorities`);
  forbidPattern(text, /recordSettlement|recordProfit|learnFrom|training/, `${name} must not create settlement or learning authority`);
}

console.log('NIX-GEN FOUNDATION VERIFIER PASSED');
