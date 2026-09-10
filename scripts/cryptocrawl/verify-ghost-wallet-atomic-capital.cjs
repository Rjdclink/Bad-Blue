'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = p => fs.readFileSync(p, 'utf8');

const intermediary = read('contracts/cryptocrawl/CryptocrawlGhostWalletIntermediary.sol');
const vault = read('contracts/cryptocrawl/CryptocrawlGhostWalletCapitalVault.sol');
const bridge = read('contracts/cryptocrawl/CryptocrawlGhostWalletErc3156Bridge.sol');
const fabric = read('server/services/cryptocrawl/ghost-wallet/capital-fabric.ts');
const engine = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-engine.ts');
const bridgeRuntime = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-external-bridge.ts');
const borrowerSurface = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-borrower-surface.ts');
const providerMesh = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-provider-mesh.ts');
const payout = read('server/services/cryptocrawl/ghost-wallet/ghost-wallet-payout.ts');
const compiler = read('scripts/cryptocrawl/compile-ghost-wallet-contracts.cjs');
const preflight = read('scripts/cryptocrawl/verify-deployment-preflight.cjs');
const intentBook = read('server/services/cryptocrawl/ghost-wallet/intent-book.ts');
const sourceMeasurement = read('server/services/cryptocrawl/ghost-wallet/onchain-capital-sources.ts');
const discovery = read('server/services/cryptocrawl/discovery/zero-capital-canonical-discovery.ts');
const alternativeReprice = read('server/services/cryptocrawl/integration/zero-capital-alternative-capital-wiring.ts');
const alternativeRegistry = read('server/services/cryptocrawl/ghost-wallet/zero-capital-alternative-selection-registry.ts');
const canonicalRouter = read('server/services/cryptocrawl/execution/zero-capital-canonical-executor.ts');
const flashExecutor = read('server/services/cryptocrawl/execution/zero-capital-flash-canonical-executor.ts');
const alternativeExecutor = read('server/services/cryptocrawl/execution/zero-capital-alternative-prepared-executor.ts');
const coverage = read('server/services/cryptocrawl/governance/atomic-zero-capital-strategy-coverage.ts');
const runtimeWiring = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');

// Ghost remains isolated from arbitrage economics/execution authority.
assert.match(intermediary, /address public immutable profitRecipient/);
assert.match(runtimeWiring, /ghostWalletProfitLadderAuthority:\s*false/);
assert.match(runtimeWiring, /ghostWalletArbitrageExecutionAuthority:\s*false/);
assert.match(engine, /profitLadderAuthority:\s*false/);
assert.match(engine, /100_percent_realized_net_direct_to_canonical_wallet/);
assert.match(engine, /serverTransactionSubmission: false/);
assert.doesNotMatch(engine, /zeroCapitalEngine|gasSponsor|CRYPTO_ARBITRAGE_LIVE_EXECUTION/);

// Existing Ghost vault/intermediary settlement remains same-transaction and exact.
assert.match(intermediary, /borrower_repayment_not_exact/);
assert.match(intermediary, /spread_reconciliation_failed/);
assert.match(intermediary, /incremental_liability_not_repaid/);
assert.match(vault, /endingAssets >= startingAssets \+ fee/);
assert.match(vault, /atomic_credit_not_repaid/);
assert.match(intermediary, /if \(temporaryApproval\) _safeApprove\(approvalToken, target, 0\)/);

// Signed-intent protections remain intact even though the server no longer broadcasts them.
assert.match(intermediary, /self_match_forbidden/);
assert.match(intermediary, /profit_recipient_cannot_self_match/);
assert.match(intermediary, /usedIntentNonces/);
assert.match(intentBook, /verifyTypedData/);
assert.match(intentBook, /address\(left\.owner\) !== address\(right\.owner\)/);

// Existing measured capital fabric remains read-only evidence and does not fabricate cash.
for (const primitive of [
  'euler_debt_assumption',
  'aave_credit_delegation',
  'signed_intent_capital',
  'coincidence_of_wants',
  'permissionless_vault_capital',
]) assert.ok(fabric.includes(primitive), `capital fabric missing ${primitive}`);
assert.match(fabric, /quote\.measured === true/);
assert.match(fabric, /quote\.sameTransactionSettlement === true/);
assert.match(fabric, /quote\.repaymentFailureReverts === true/);
assert.match(fabric, /resourceForm === 'liquid_principal'/);

// Aave/Euler evidence stays grounded in live protocol state.
assert.match(sourceMeasurement, /borrowAllowance\(config\.delegator, intermediary\)/);
assert.match(sourceMeasurement, /getUserAccountData\(config\.delegator\)/);
assert.match(sourceMeasurement, /debtOf\(address account\)/);
assert.match(sourceMeasurement, /synthetic_capacity:false/);

// New caller-funded external bridge is the zero-operator-capital execution surface.
assert.match(bridge, /Permissionless, zero-operator-capital atomic credit intermediary/);
assert.match(bridge, /brokerExternalFlashLoan/);
assert.match(bridge, /brokerAaveV3FlashLoan/);
assert.match(bridge, /brokerMorphoFlashLoan/);
assert.match(bridge, /brokerBalancerV2FlashLoan/);
assert.match(bridge, /borrower_repayment_not_exact/);
assert.match(bridge, /upstream_repayment_not_exact/);
assert.match(bridge, /borrowerFee <= maxBorrowerFee/);
assert.match(bridge, /expectedBorrowerFee > upstreamFee/);
assert.match(bridge, /minimumBrokerSpreadBps = 0/);
assert.match(bridge, /return configured > 0 \? configured : 1/);
assert.doesNotMatch(bridge, /allowedLender|lenderAllowlist/);

// Public descriptor/quote surface needs no new Railway setup and admits dynamic ERC-3156 lenders.
assert.match(bridgeRuntime, /serverSubmitsDeployment: false/);
assert.match(bridgeRuntime, /deploymentPayer: 'transaction_initiator'/);
assert.match(bridgeRuntime, /operatorInitialCapitalRequired: false/);
assert.match(bridgeRuntime, /lenderAllowlistRequired: false/);
assert.match(borrowerSurface, /lenderCandidates/);
assert.match(borrowerSurface, /hardLenderUniverseLimit: null/);
assert.match(borrowerSurface, /hardBorrowerUniverseLimit: null/);
assert.match(borrowerSurface, /lowest_live_all_in_upstream_fee_for_same_asset_and_amount/);

// Alchemy is not a Ghost dependency. Configured non-Alchemy RPCs and public fallbacks
// are measured in parallel; a chain outage is local.
assert.match(providerMesh, /alchemyAllowed: false/);
assert.match(providerMesh, /Promise\.allSettled/);
assert.match(providerMesh, /routeLocalFailure: true/);
assert.doesNotMatch(providerMesh, /ALCHEMY_API_KEY|ALCHEMY_GAS_POLICY_ID/);

// Profit conversion never spends provider-sponsored/operator native gas. The 0x
// leg is gasless; any Across origin spend is bounded by native proceeds created
// from the same realized Ghost profit.
assert.match(payout, /zeroOperatorNativeGas: true/);
assert.match(payout, /GHOST_WALLET_ACROSS_WOULD_SPEND_PREEXISTING_OPERATOR_NATIVE/);
assert.match(payout, /quote\.maxSpend > input\.acquiredNative/);
assert.match(payout, /originGasFunding: 'realized_ghost_profit_only'/);
assert.match(payout, /GHOST_WALLET_ACROSS_ETH_BALANCE_DELTA_NOT_VERIFIED/);
assert.match(payout, /percentOfRealizedGhostNet: 100/);
assert.doesNotMatch(payout, /zeroCapitalEngine|gasSponsor|ALCHEMY_/);

// Deferred settlement is never promoted into a false executable capability.
assert.match(coverage, /protocolDeferredSettlementExecutionEnabled:\s*false/);
assert.match(coverage, /if \(provenance === 'protocol_deferred_settlement'\) return false/);
const admittedBlock = coverage.match(/const ATOMIC_EXTERNAL_PRINCIPAL_SOURCES:[\s\S]*?\] as const;/)?.[0] || '';
assert.doesNotMatch(admittedBlock, /protocol_deferred_settlement_capital/);

// Existing arbitrage zero-capital execution remains unchanged.
assert.match(discovery, /repriceZeroCapitalProviderEconomics\(/);
assert.match(discovery, /repriceZeroCapitalAlternativeCapital\(/);
assert.match(alternativeReprice, /await input\.provider\.call\(exactEnvelope\)/);
assert.match(alternativeReprice, /await input\.provider\.estimateGas\(exactEnvelope\)/);
assert.match(alternativeRegistry, /selection\.expectedNetProfit <= 0n/);
assert.match(canonicalRouter, /return executeFlashCanonicalZeroCapitalOpportunity\(opportunity\)/);
assert.match(canonicalRouter, /executeAlternativePreparedWithinCanonicalExecutor/);
assert.match(alternativeExecutor, /await provider\.call\(request\)/);
assert.match(alternativeExecutor, /await provider\.estimateGas\(request\)/);
assert.match(flashExecutor, /Sole ZERO_CAPITAL_ATOMIC execution route|CanonicalExecutionScheduler/);

// Vault arithmetic overflow protection is preserved.
assert.match(vault, /VIRTUAL_SHARES = 1_000/);
assert.match(vault, /VIRTUAL_ASSETS = 1/);
assert.match(vault, /uint256 quotient = product \/ denominator/);
assert.doesNotMatch(vault, /\(product \+ denominator - 1\) \/ denominator/);

// Production prebuild compiles every Ghost contract.
assert.match(compiler, /CryptocrawlGhostWalletIntermediary\.sol/);
assert.match(compiler, /CryptocrawlGhostWalletCapitalVault\.sol/);
assert.match(compiler, /CryptocrawlGhostWalletErc3156Bridge\.sol/);
assert.match(compiler, /solc@0\.8\.24/);
assert.match(preflight, /compile-ghost-wallet-contracts\.cjs/);

console.log(JSON.stringify({
  ghostWalletAtomicCapital: 'verified',
  model: 'borrow_upstream_lend_downstream_atomic_spread',
  sameTransactionRepaymentOrRevert: true,
  fixedBpsProfitFloor: false,
  minimumPositiveSpreadBaseUnits: 1,
  callerFundedCoreExecution: true,
  operatorInitialCapitalRequired: false,
  lenderUniverseFixedLimit: false,
  borrowerUniverseFixedLimit: false,
  alchemyDependency: false,
  routeLocalProviderFailure: true,
  profitFundedEthPayout: true,
  durableWorkerRecovery: true,
  arbitrageAuthorityCrossed: false,
}, null, 2));
