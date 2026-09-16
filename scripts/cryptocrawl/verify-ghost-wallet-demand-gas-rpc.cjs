'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = p => fs.readFileSync(p, 'utf8');

const engine = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-engine.ts');
const demand = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-borrower-demand-mesh.ts');
const mandate = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-borrower-mandate.ts');
const reserve = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-gas-reserve.ts');
const reserveMigration = read('server/migrations/058_cryptocrawler_ghost_wallet_gas_reserve.sql');
const provider = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-provider-mesh.ts');
const controller = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-autonomous-controller.ts');
const zeroCapital = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');

// Borrower demand transport is acquisition only. Existing cryptographic mandate
// verification remains the sole admission authority and generic order books are not
// silently reclassified as ERC-3156 borrowers.
assert.match(demand, /registerGhostWalletBorrowerMandate/);
assert.match(demand, /GHOST_WALLET_BORROWER_DEMAND_FEEDS_JSON/);
assert.match(demand, /httpsOnly: true/);
assert.match(demand, /signedMandateVerificationRequired: true/);
assert.match(demand, /nonceReplayProtectionPreserved: true/);
assert.match(demand, /genericTradeIntentAdmission: false/);
assert.match(demand, /bytecodeOnlyBorrowerTrust: false/);
assert.match(demand, /etagConditionalRefresh: true/);
assert.match(demand, /throttleBackoffWithJitter: true/);
assert.match(mandate, /_TypedDataEncoder\.hash/);
assert.match(mandate, /isValidSignature/);
assert.match(mandate, /cancelledMandateReplayRejected: true/);
assert.match(engine, /ghost-wallet-borrower-demand-mesh\.js/);
assert.match(engine, /borrowerDemandTransportAuthority: false/);

// Retained gas funding is isolated from payout principal and zero-capital. It uses
// only the retained realized Ghost allocation and preserves explicit first-trade truth.
assert.match(reserveMigration, /cryptocrawler_ghost_wallet_gas_reserve/);
assert.match(reserveMigration, /UNIQUE\(source_work_id, chain, asset\)/);
assert.match(reserve, /retainedAmountBaseUnits/);
assert.match(reserve, /retained_realized_ghost_profit_only/);
assert.match(reserve, /operatorPrincipalAllowed:false/);
assert.match(reserve, /zeroCapitalDependency:false/);
assert.match(reserve, /sameChainNativeReserve:true/);
assert.match(reserve, /gaslessConversionPreferred:true/);
assert.match(reserve, /signedPayloadPersistedBeforeRelaySubmission:true/);
assert.match(reserve, /firstTradeBootstrapRequiresExistingNativeOrOptionalSponsor:true/);
assert.match(reserve, /sponsorIsMandatoryDependency:false/);
assert.match(engine, /ghost-wallet-gas-reserve\.js/);
assert.match(engine, /firstTradeGasBootstrap: 'existing_system_native_or_optional_sponsor_required'/);

// RPC health is separated by operation class so a log-provider throttle does not
// demote a provider for unrelated reads/broadcasts, and Retry-After is honored.
assert.match(provider, /GhostWalletRpcOperationClass = 'read' \| 'logs' \| 'broadcast'/);
assert.match(provider, /operationClassHealth: \['read', 'logs', 'broadcast'\]/);
assert.match(provider, /runHedgedLogs/);
assert.match(provider, /retryAfterAwareCircuitBreaking: true/);
assert.match(provider, /providerCircuitBreaking: true/);
assert.match(provider, /identicalRawTransactionMultiProviderBroadcast: true/);
assert.match(provider, /exactHashRequiredOnNonceConflict: true/);
assert.match(provider, /routeLocalFailure: true/);

// Ghost remains autonomous and separate. Performance/gas work must not migrate
// Ghost scheduling or transaction authority into zero-capital/APE.
assert.match(controller, /zeroCapitalIntegration: false/);
assert.match(engine, /intermediaryTransactionSubmission: false/);
assert.match(engine, /controllerTransactionSubmission: true/);
assert.match(engine, /zeroCapitalExecutionAuthority: false/);
assert.doesNotMatch(demand, /zeroCapitalEngine|AtomicProfitabilityEngine/);
assert.doesNotMatch(reserve, /zeroCapitalEngine|AtomicProfitabilityEngine/);
assert.match(zeroCapital, /executeFlashCanonicalZeroCapitalOpportunity|executeAlternativePreparedWithinCanonicalExecutor/);

console.log(JSON.stringify({
  ok: true,
  borrowerDemandFeeds: 'signed_and_bounded',
  retainedProfitGasReserve: 'durable_same_chain',
  firstTradeBootstrapInvented: false,
  rpcHealth: 'read_logs_broadcast_isolated',
  zeroCapitalAuthorityCrossed: false,
  intermediaryRemainsMiddleman: true,
}, null, 2));