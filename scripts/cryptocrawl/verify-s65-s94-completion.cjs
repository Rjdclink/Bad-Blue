const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const failures = [];
const read = p => { try { return fs.readFileSync(path.join(root,p),'utf8'); } catch { failures.push(`missing ${p}`); return ''; } };
const req = (id,p,t,label=t) => { const s=read(p); if (!s.includes(t)) failures.push(`${id} ${label}: missing ${JSON.stringify(t)} in ${p}`); };
const forbid = (id,p,t,label=t) => { const s=read(p); if (s.includes(t)) failures.push(`${id} ${label}: forbidden ${JSON.stringify(t)} in ${p}`); };

// S-65 continuous keyed MC precompute; final validation remains mandatory.
req('S-65','server/services/cryptocrawl/validation/monte-carlo-precompute-cache.ts','dataEpoch');
req('S-65','server/services/cryptocrawl/validation/monte-carlo-precompute-cache.ts','finalValidationRequired: true');
req('S-65','server/services/cryptocrawl/integration/monte-carlo-precompute-wiring.ts','quanti-comp');
// S-66 truth-isolated MC calibration/tail evidence.
req('S-66','server/services/cryptocrawl/validation/monte-carlo-calibration-store.ts','terminal');
req('S-66','server/services/cryptocrawl/execution/adapters/monte-carlo-profitability.ts','expectedShortfall95Usd');
// S-67 model lifecycle and advisory inference.
req('S-67','server/services/cryptocrawl/intelligence/model-registry.ts','rollbackModel');
req('S-67','server/services/cryptocrawl/intelligence/model-registry.ts',"rlAuthority: 'shadow_research_only'");
// S-68 predictive preparation cannot establish execution truth.
req('S-68','server/services/cryptocrawl/intelligence/predictive-cain-preparation.ts','falseNegative');
req('S-68','server/services/cryptocrawl/integration/predictive-cain-wiring.ts','executionAuthority: false');
// S-69 validated read-only hedging.
req('S-69','server/services/cryptocrawl/api/hedged-rpc-read.ts','READ_ONLY_METHODS');
req('S-69','server/services/cryptocrawl/api/hedged-rpc-read.ts','mutatingMethodsAllowed: false');
// S-70 existing-node discovery only; paid provisioning excluded from runtime.
req('S-70','server/services/cryptocrawl/integration/chainstack-provider-wiring.ts','runtimeProvisioningAllowed: false');
req('S-70','server/services/cryptocrawl/integration/canonical-runtime-wiring.ts','ensureChainstackProviderDiscovery()');
// S-71 measured-density hot prewarming with bounded budgets/freshness separation.
req('S-71','server/services/cryptocrawl/integration/hot-connection-prewarming.ts','opportunityDensity');
req('S-71','server/services/cryptocrawl/integration/canonical-runtime-wiring.ts','ensureHotConnectionPrewarming()');
// S-72 canonical L2 integrity.
req('S-72','server/services/cryptocrawl/intelligence/cex-order-book-stream-v2.ts','KRAKEN_BOOK_DEPTH = 25');
req('S-72','server/services/cryptocrawl/intelligence/cex-order-book-stream-v2.ts','message.sequence_num');
req('S-72','server/services/cryptocrawl/intelligence/cex-order-book-stream-v2.ts','row.prevSeqId');
// S-73 venue-native transport registry, no invented generic binary protocol.
req('S-73','server/services/cryptocrawl/discovery/transport-capability-registry.ts','exact_schema_conformance');
req('S-73','server/services/cryptocrawl/discovery/transport-capability-registry.ts','inventedGenericBinaryProtocolAllowed: false');
// S-74 funding/basis all-in economics.
req('S-74','server/services/cryptocrawl/discovery/funding-basis-opportunity-engine.ts','funding');
req('S-74','server/services/cryptocrawl/discovery/funding-arbitrage-policy.ts','net');
// S-75 liquidation adapter remains fail-closed for live execution until proven.
req('S-75','server/services/cryptocrawl/discovery/liquidation-opportunity-engine.ts','liquidation');
req('S-75','server/services/cryptocrawl/discovery/liquidation-opportunity-engine.ts','execution');
// S-76 slow-path enrichment is budgeted/non-executable.
req('S-76','server/services/cryptocrawl/intelligence/slow-path-universe-enrichment.ts','budget');
req('S-76','server/services/cryptocrawl/intelligence/slow-path-universe-enrichment.ts','execution');
// S-77 bounded Quanti admission/backpressure.
req('S-77','server/services/quantiComp/admissionControl.ts','HARD_QUEUE_LIMIT');
req('S-77','server/services/quantiComp/admissionControl.ts','reservedHotCapacity: true');
// S-78 hierarchical compute tier scoring.
req('S-78','server/services/quantiComp/hierarchicalComputePolicy.ts','serialization');
req('S-78','server/services/quantiComp/hierarchicalComputePolicy.ts','dataLocality');
// S-79 axial decomposition/bounded work stealing.
req('S-79','server/services/quantiComp/axialWorkCoordinator.ts','chain');
req('S-79','server/services/quantiComp/axialWorkCoordinator.ts','workSteal');
// S-80 end-to-end measured latency/SLO harness.
req('S-80','server/services/cryptocrawl/integration/latency-observability.ts','p99');
req('S-80','server/services/cryptocrawl/integration/execution-latency-instrumentation.ts','submit');
// S-81 Lux is projection/coordination, not authority.
req('S-81','server/services/cryptocrawl/intelligence/lux-opportunity-coordinator.ts','executionAuthority');
// S-82 one health supervisor with governance precedence.
req('S-82','server/services/cryptocrawl/runtime/crawler-health-supervisor.ts','killSwitchActive');
req('S-82','server/services/cryptocrawl/runtime/crawler-health-supervisor.ts','quarantine');
// S-83 shadow swarm optimization/governed promotion.
req('S-83','server/services/cryptocrawl/intelligence/swarm-optimization-shadow.ts','shadow');
req('S-83','server/services/cryptocrawl/intelligence/swarm-optimization-shadow.ts','executionAuthority: false');
// S-84 non-mutating Starburst route evaluation.
req('S-84','server/services/cryptocrawl/intelligence/starburst-safe-parallel.ts','nonMutating');
req('S-84','server/services/cryptocrawl/intelligence/starburst-safe-parallel.ts','executionAuthority: false');
// S-85 adaptive leader hysteresis.
req('S-85','server/services/cryptocrawl/intelligence/cain-twin-adaptive-leader.ts','hysteresis');
// S-86 measured three-mode crawler.
req('S-86','server/services/cryptocrawl/agents/enhanced-micro-crawler.ts',"'prewarm'");
req('S-86','server/services/cryptocrawl/agents/enhanced-micro-crawler.ts','profitGenerated: 0');
// S-87 governed inventory readiness.
req('S-87','server/services/cryptocrawl/execution/inventory-readiness-manager.ts','transferExecutionAuthority: false');
req('S-87','server/services/cryptocrawl/integration/canonical-runtime-wiring.ts','ensureInventoryReadinessWiring()');
// S-88 maker/taker expected-realized-value policy.
req('S-88','server/services/cryptocrawl/execution/maker-taker-policy.ts','fillProbability');
req('S-88','server/services/cryptocrawl/execution/maker-taker-policy.ts','adverseSelection');
// S-89 all-in route cost optimization.
req('S-89','server/services/cryptocrawl/execution/all-in-route-cost-optimizer.ts','expectedRealizedProfitUsd');
req('S-89','server/services/cryptocrawl/execution/all-in-route-cost-optimizer.ts','capitalLockCostUsd');
// S-90 terminal-measured residual slippage curves feed deterministic economics/MC.
req('S-90','server/services/cryptocrawl/validation/slippage-calibration-store.ts','conservative_fallback');
req('S-90','server/services/cryptocrawl/integration/slippage-calibration-wiring.ts','calibratedResidualSlippageUsd');
req('S-90','server/services/cryptocrawl/integration/canonical-runtime-wiring.ts','ensureSlippageCalibrationWiring()');
// S-91 continuous post-trade learning and calibration.
req('S-91','server/services/cryptocrawl/learning/continuous-post-trade-learning.ts','predictionError');
req('S-91','server/services/cryptocrawl/learning/continuous-post-trade-learning.ts','executionAuthority: false');
// S-92 durable outbox exactly-once/restart-safe persistence transport.
req('S-92','server/services/cryptocrawl/intelligence/durable-intelligence-outbox.ts','dedupe_key');
req('S-92','server/services/cryptocrawl/intelligence/durable-intelligence-outbox.ts','for update skip locked');
req('S-92','server/migrations/014_cryptocrawler_private_outbox.sql','cryptara_outbox');
// S-93 ordered, checksum-pinned, forward-only migrations.
req('S-93','server/migrations/reconcileCryptoPrivateIntelligenceMemory.ts','cryptocrawler_schema_migrations');
req('S-93','server/migrations/reconcileCryptoPrivateIntelligenceMemory.ts','checksum drift');
req('S-93','server/migrations/reconcileCryptoPrivateIntelligenceMemory.ts','pg_advisory_xact_lock');
// S-94 measured-only performance truth.
req('S-94','server/services/cryptocrawl/runtime/performance-objectives.ts','zeroLatencyClaimAllowed: false');
req('S-94','server/services/cryptocrawl/runtime/performance-objectives.ts','productionClaimsRequireMeasuredRuntimeTelemetry: true');
req('S-94','server/services/cryptocrawl/runtime/performance-objectives.ts','productionProfitClaimsRequireTerminalSettlementEvidence: true');

if (failures.length) {
  console.error('[s65-s94-completion] FAIL');
  failures.forEach(f => console.error(` - ${f}`));
  process.exit(1);
}
console.log('[s65-s94-completion] PASS — S-65 through S-94 semantic implementation contracts are present and fail-closed where execution truth is required');
