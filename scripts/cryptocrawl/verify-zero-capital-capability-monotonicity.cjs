'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = path => fs.readFileSync(path, 'utf8');

const coldstart = read('server/services/cryptocrawl/execution/builder-sponsored-zero-capital-coldstart.ts');
const bootstrap = read('server/services/cryptocrawl/execution/builder-sponsored-receiver-bootstrap.ts');
const executor = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const scheduler = read('server/services/cryptocrawl/execution/canonical-execution-scheduler.ts');
const resources = read('server/services/cryptocrawl/execution/zero-capital-resource-scheduler.ts');
const providerEconomics = read('server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.ts');
const providerWiring = read('server/services/cryptocrawl/integration/zero-capital-flash-provider-wiring.ts');
const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const measured = read('server/services/cryptocrawl/discovery/measured-candidate-registry.ts');
const stack = read('server/services/cryptocrawl/integration/zero-capital-atomic-stack-wiring.ts');
const multileg = read('server/services/cryptocrawl/optimization/unified-multileg-arbitrage-engine.ts');
const zeroEngine = read('server/services/cryptocrawl/core/zero-capital-engine.ts');
const rpcMesh = read('server/services/cryptocrawl/runtime/dynamic-rpc-provider-wiring.ts');

assert.doesNotMatch(coldstart, /opportunity\.(?:estimatedGasCostInInputToken|estimatedExecutionCostInInputToken|expectedProfit|netProfitBps)\s*=/, 'cold-start preparation must not mutate canonical economics');
assert.doesNotMatch(bootstrap, /opportunity\.(?:flashLoanFeeInInputToken|estimatedGasCostInInputToken|estimatedExecutionCostInInputToken|expectedProfit|netProfitBps)\s*=/, 'receiver-bootstrap preparation must not mutate canonical economics');
assert.doesNotMatch(coldstart, /builderSponsoredZeroCapitalRegistry\.remove\(opportunity\.id\)/, 'cold-start preparation must preserve still-fresh evidence until replacement succeeds');
assert.doesNotMatch(bootstrap, /builderSponsoredZeroCapitalRegistry\.remove\(opportunity\.id\)/, 'receiver-bootstrap preparation must preserve still-fresh evidence until replacement succeeds');
assert.match(coldstart, /30_000, 1_000, 120_000/, 'cold-start evidence lifetime must tolerate normal pipeline latency');
assert.match(bootstrap, /30_000, 1_000, 120_000/, 'receiver-bootstrap evidence lifetime must tolerate normal pipeline latency');
assert.match(providerEconomics, /\['morpho_blue', 'aave_v3', 'balancer_v2'\]/, 'default provider choice must preserve the full measured provider mesh');
assert.match(providerWiring, /const builderOpportunity: ZeroCapitalOpportunity = \{/, 'builder economics must advance via an immutable opportunity snapshot');
assert.match(
  providerWiring,
  /for \(const sourceOpportunity of input\.opportunities\)[\s\S]{0,500}const opportunity: ZeroCapitalOpportunity = \{[\s\S]{0,220}\.\.\.sourceOpportunity,[\s\S]{0,220}route: sourceOpportunity\.route\.map\(leg => \(\{ \.\.\.leg \}\)\)/,
  'provider repricing must operate on a deep-enough route/economics working copy rather than the canonical opportunity object',
);
assert.match(providerWiring, /provider_reprice_input_immutable:true/, 'provider repricing must publish its immutable-input provenance');
assert.match(
  discovery,
  /const selected = await repriceZeroCapitalProviderEconomics\([\s\S]{0,1800}const remaining = rescueReady\.filter\(opportunity => !flashSelectedIds\.has\(opportunity\.id\)\)[\s\S]{0,600}repriceZeroCapitalAlternativeCapital\([\s\S]{0,300}opportunities: remaining/,
  'alternative-capital repricing must derive its fallback set from the post-rescue candidate set after provider comparison',
);
assert.match(executor, /receiver_appeared:fell_through_to_verified_standard_path/, 'an already-deployed receiver must fall through to its verified normal path');
assert.match(executor, /economicReconciliationStatus: 'exception'/, 'confirmed execution must remain distinct from reconciliation exceptions');

// Cold-start liveness is independent of operator wallet telemetry. The existing
// route-local provider manager remains the balance telemetry path after startup.
assert.match(zeroEngine, /private walletResourceRefreshInFlight: Promise<void> \| null = null/, 'wallet telemetry refresh must be single-flight and asynchronous');
assert.match(zeroEngine, /if \(this\.initialized\) \{[\s\S]{0,120}this\.scheduleWalletResourceRefresh\(\)/, 'repeat initialization must not await wallet telemetry');
assert.doesNotMatch(zeroEngine, /if \(this\.initialized\) \{[\s\S]{0,120}await this\.refreshWalletResources\(\)/, 'wallet telemetry must not re-enter the startup critical path');
assert.match(zeroEngine, /this\.state\.isRunning = true;[\s\S]{0,120}this\.initialized = true;[\s\S]{0,120}this\.scheduleWalletResourceRefresh\(\)/, 'runtime must become live before optional wallet telemetry refresh');
assert.match(zeroEngine, /multiProviderRpcManager\.execute\(chain as RpcSupportedChain, 'json_rpc'/, 'wallet telemetry must preserve current provider failover');
assert.match(zeroEngine, /const providerOutcomes = await Promise\.allSettled\(chains\.map/, 'one slow chain must not serialize initialization of every chain');
assert.match(zeroEngine, /routeLocalFailure: true/, 'initial provider failure must remain route-local');
assert.match(zeroEngine, /sponsoredBootstrap: false/, 'receiver capability alone must not imply sponsored zero-cost gas');
assert.doesNotMatch(zeroEngine, /sponsoredBootstrap: supportsSponsoredReceiverChain\(chain\)/, 'receiver support must not masquerade as gas sponsorship');
assert.match(zeroEngine, /walletResourceTelemetryBlocksStartup: false/, 'startup telemetry must state its non-authoritative role');
assert.match(zeroEngine, /receiverCapabilityImpliesGasSponsorship: false/, 'runtime telemetry must expose fail-closed sponsorship semantics');

// Preserve the free pending-transaction lane as a streaming accelerator instead
// of letting ordinary quote/log traffic exhaust it ahead of general RPC transports.
assert.match(rpcMesh, /provider: 'dRPCPublicStreaming'[\s\S]{0,220}priority: 85/, 'dRPC streaming HTTP must rank below ordinary public RPC lanes');
assert.match(rpcMesh, /costSafePublicRpcPreferred: true/, 'ordinary cost-safe public RPC must remain preferred');
assert.match(rpcMesh, /streamingHttpIsGeneralAuthority: false/, 'streaming HTTP must not become general RPC authority');

for (const [name, source] of [['executor', executor], ['scheduler', scheduler], ['resources', resources], ['provider wiring', providerWiring], ['atomic stack', stack]]) {
  assert.doesNotMatch(source, /opportunity\.netProfitBps\s*>\s*0/, `${name} must not reject positive sub-BPS economics`);
}
assert.match(measured, /deterministicNetProfitUsd > 0/, 'minimum sufficient evidence must use canonical net profit truth');
assert.doesNotMatch(multileg, /netProfitBps !== null && netProfitBps <= 0/, 'multi-leg composition must not reject positive profit due rounded BPS');

console.log('[zero-capital-capability-monotonicity] PASS: exact-positive admission, immutable provider economics, post-rescue fallback, evidence continuity, provider diversity, non-blocking wallet telemetry, fail-closed sponsorship truth, streaming/general-RPC separation, and on-chain execution truth remain monotonic');
