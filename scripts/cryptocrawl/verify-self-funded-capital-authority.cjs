const fs = require('node:fs');
const assert = require('node:assert/strict');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const hierarchy = read('server/services/cryptocrawl/core/capital-hierarchy.ts');
const hierarchyTest = read('server/services/cryptocrawl/testing/verify-capital-hierarchy.ts');
const inventory = read('server/services/cryptocrawl/execution/cex-inventory-ledger.ts');
const resourceScheduler = read('server/services/cryptocrawl/execution/resource-scheduler.ts');
const cexExecutor = read('server/services/cryptocrawl/execution/centralized-exchange-executor.ts');
const makerExecution = read('server/services/cryptocrawl/runtime/stablecoin-maker-execution-wiring.ts');
const provenance = read('server/services/cryptocrawl/execution/adapters/stage4-capital-provenance.ts');
const allocation = read('server/services/cryptocrawl/execution/system-capital-allocation-ledger.ts');
const placement = read('server/services/cryptocrawl/execution/cex-system-capital-placement.ts');
const exactSettlement = read('server/services/cryptocrawl/execution/cex-system-capital-settlement-evidence.ts');
const lotLedger = read('server/services/cryptocrawl/execution/cex-system-owned-lot-ledger.ts');
const exactDecimal = read('server/services/cryptocrawl/execution/exact-decimal.ts');
const allocationMigration = read('server/migrations/026_cryptocrawler_system_capital_allocations.sql');
const ownershipMigration = read('server/migrations/027_cryptocrawler_cex_system_owned_lots.sql');
const overflowSchema = read('server/services/cryptocrawl/runtime/cryptocrawl-overflow-runtime-schema.ts');
const dockerfile = read('Dockerfile');

assert.match(hierarchy, /CapitalSource\s*=\s*'self-funded'/, 'capital hierarchy must expose self-funded authority');
assert.doesNotMatch(hierarchy, /CapitalSource\s*=\s*[^;]*'wallet'/, 'raw wallet capital must not be an execution authority');
assert.match(hierarchy, /walletSufficient\s*&&\s*alternatives\.selfFundedEligible\s*===\s*true/, 'wallet location requires durable self-funded provenance');
assert.match(hierarchy, /external\/operator capital remains protected/, 'unproven external capital must be explicitly protected');
assert.match(hierarchyTest, /funded-wallet-without-provenance/, 'regression test must cover a funded external wallet');
assert.match(hierarchyTest, /verified-self-funded-capital/, 'regression test must cover verified self-funded capital');

assert.match(inventory, /if\s*\(venue\s*===\s*'coinbase'\)\s*return\s+Math\.max\(configuredMinimumReserve,\s*available\)/, 'Coinbase operator balance must remain non-spendable');
assert.match(inventory, /SYSTEM_CAPITAL_OWNERSHIP_TABLE\s*=\s*'cryptocrawler_cex_system_owned_lots'/, 'CEX reservation must consume the canonical physical ownership-lot table');
assert.doesNotMatch(inventory, /SYSTEM_CAPITAL_ALLOCATION_TABLE|remaining_destination_base_units/, 'placement rows must not remain an alternate CEX spend authority');
assert.match(inventory, /status='ACTIVE' AND remaining_decimal > 0/, 'only active settlement-derived ownership lots may establish CEX spendable ownership');
assert.match(inventory, /const physicalSpendable =/, 'CEX admission must retain authenticated physical-balance capacity');
assert.match(inventory, /const systemOwnedSpendable =/, 'CEX admission must calculate provenance-backed spendable ownership');
assert.match(inventory, /Math\.min\(physicalSpendable, systemOwnedSpendable\)/, 'CEX reservation must be capped by both physical and system-owned capacity');
assert.match(inventory, /!isDatabaseConfigured \|\| !await this\.ensureTables\(\)/, 'live CEX reservation must fail closed without durable Overflow state');
assert.match(inventory, /operatorBalanceAuthorityGranted:\s*false/, 'reservation rejection telemetry must explicitly deny operator-balance authority');

assert.match(resourceScheduler, /getProfitLadderNotionalAuthority/, 'resource admission must bind the canonical Profit Ladder notional authority');
assert.match(resourceScheduler, /plan\.notionalUsd > notionalAuthority\.maxNotionalUsd/, 'resource admission must reject exposure above the unlocked Profit Ladder rung');
assert.match(resourceScheduler, /resourceLeaseCreated:\s*false/, 'rejected Profit Ladder exposure must not consume scarce resource leases');
assert.match(cexExecutor, /REJECT_PROFIT_LADDER_NOTIONAL/, 'the live CEX executor must independently prevent direct callers from bypassing the same Profit Ladder authority');
assert.match(cexExecutor, /applyTerminalSystemOwnedSettlements/, 'terminal production CEX orders must flow into exact system-owned lot settlement');
assert.match(cexExecutor, /getExactSystemCapitalOrderAssetDeltas/, 'terminal ownership must be reconstructed from authenticated exact exchange evidence');
assert.match(cexExecutor, /cex_system_capital_settlement_persistence_failed/, 'ownership persistence failure must pause further execution rather than fall back to operator funds');
assert.match(cexExecutor, /operatorBalanceFallbackUsed:\s*false/, 'terminal accounting failure telemetry must explicitly deny operator-balance fallback');

assert.match(makerExecution, /persistMakerSystemOwnedSettlement/, 'production maker fills must not bypass system-owned settlement accounting');
assert.match(makerExecution, /const admissionNotionalAuthority = getProfitLadderNotionalAuthority\(\)/, 'maker ownership must retain the Profit Ladder proof observed before submission');
assert.match(makerExecution, /persistMakerSystemOwnedSettlement\(plan, result, traceId, admissionNotionalAuthority\)/, 'maker settlement must use admission-time notional authority rather than a post-trade rung');
assert.match(makerExecution, /getExactSystemCapitalOrderAssetDeltas/, 'maker ownership must be reconstructed from the same exact authenticated exchange evidence');
assert.match(makerExecution, /applyExactCexSystemOwnedSettlement/, 'maker fills must land in the canonical ownership-lot ledger');
assert.match(makerExecution, /cex_system_capital_settlement_persistence_failed/, 'maker ownership persistence failure must pause further trading');
assert.match(makerExecution, /operatorBalanceFallbackUsed:\s*false/, 'maker accounting must never fall back to operator balances');

assert.match(provenance, /recordVerifiedRetainedProfit/, 'verified retained profit must accumulate in canonical SELF_FUNDED provenance');
assert.match(provenance, /SELECT \* FROM zero_capital_capital_state WHERE scope = \$1 FOR UPDATE/, 'capital provenance mutation must lock its canonical source row');
assert.match(allocation, /strategySelectionAuthority:\s*'cryptara'/, 'allocation must preserve Cryptara strategy authority');
assert.match(allocation, /notionalAuthority:\s*'profit_ladder'/, 'allocation must preserve Profit Ladder notional authority');
assert.match(allocation, /executionAuthority:\s*'stage_manager'/, 'allocation must preserve StageManager execution authority');
assert.match(allocation, /governanceAdmitted:\s*true/, 'allocation must require governance admission');
assert.match(allocation, /internally_generated_balance::numeric - \$2::numeric/, 'reservation must atomically debit canonical SELF_FUNDED available balance');
assert.match(allocation, /Only unsubmitted RESERVED capital can be released/, 'submitted or placed capital must never be silently restored at the source');
assert.match(allocation, /delivered_amount_base_units=\$2/, 'placement must record exact destination-delivered base units');
assert.doesNotMatch(allocation, /CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+INDEX/i, 'runtime allocation code must not own schema DDL');

assert.match(placement, /\['zero-capital', 'system-capital'\]\.includes\(parts\[0\]\)/, 'physical placement must accept legacy zero-capital bootstrap and generic system-generated capital provenance');
assert.match(placement, /scope\.tokenAddress/, 'physical placement must bind the token contract encoded by SELF_FUNDED provenance');
assert.match(placement, /venue === 'coinbase'/, 'physical CEX placement must reject Coinbase');
assert.match(placement, /const contractAddress = String\(entry\?\.ctAddr/, 'OKX currency admission must inspect authenticated full contract identity');
assert.match(placement, /return contractAddress === tokenAddress && canDeposit/, 'OKX Get currencies full contract address must exactly match the SELF_FUNDED token contract');
assert.match(placement, /const contractSuffix = String\(entry\?\.ctAddr/, 'OKX deposit-address admission must inspect the documented contract suffix');
assert.match(placement, /contractSuffix\.length === 6 && tokenAddress\.endsWith\(contractSuffix\)/, 'OKX deposit-address identity must use only the documented last-six contract suffix');
assert.match(placement, /authenticatedDepositAccount/, 'OKX placement must preserve whether the authenticated deposit beneficiary is Funding or Trading');
assert.match(placement, /depositAccount !== '6' && depositAccount !== '18'/, 'OKX placement must reject unknown beneficiary account identifiers');
assert.match(placement, /wallet\.address\.toLowerCase\(\) !== input\.sourceRecipient/, 'physical placement signer must match the SELF_FUNDED recipient');
assert.match(placement, /withEvmSignerLane/, 'nonce observation, signing and broadcast must use the canonical distributed signer lane');
assert.match(placement, /const signedTransaction = await wallet\.signTransaction\(transaction\)/, 'placement must sign exact base-unit transfer before broadcast');
assert.match(placement, /ethers\.utils\.keccak256\(signedTransaction\)/, 'placement must derive the deterministic transaction hash locally before broadcast');
assert.match(placement, /await persistPreparedPlacement\(/, 'prepared transaction identity must be durable before physical broadcast');
assert.match(placement, /signerLaneHeldThroughBroadcast:\s*true/, 'the persisted evidence must state that the signer lane spans broadcast');
assert.match(placement, /await provider\.sendTransaction\(signedTransaction\)/, 'physical placement must broadcast the exact locally signed transaction');
assert.match(placement, /sourceCapitalReleased:\s*false/, 'uncertain broadcast/settlement may not release source capital');
assert.match(placement, /deposit-history/, 'CEX placement must use exchange-side deposit history rather than on-chain receipt alone');
assert.match(placement, /confirmed:\s*state === '2'/, 'OKX deposit must reach terminal deposit state 2');
assert.match(placement, /\/api\/v5\/asset\/transfer'/, 'OKX Funding-account deposits must be transferable into Trading');
assert.match(placement, /from:\s*'6'/, 'OKX internal transfer source must be Funding account 6');
assert.match(placement, /to:\s*'18'/, 'OKX internal transfer destination must be Trading account 18');
assert.match(placement, /\/api\/v5\/asset\/transfer-state/, 'OKX internal transfer must be independently reconciled to terminal state');
assert.match(placement, /state === 'success'/, 'OKX CEX ownership may become spendable only after transfer-state success');
assert.match(placement, /tradingAccountSpendableAuthority:\s*true/, 'PLACED OKX capital must explicitly prove Trading-account spendability');

assert.match(exactDecimal, /bigint/, 'exact CEX settlement arithmetic must use integer-backed decimal math');
assert.doesNotMatch(exactDecimal, /parseFloat\(|Number\(/, 'exact CEX settlement arithmetic must not pass through floating point');
assert.match(exactSettlement, /\/api\/v5\/trade\/fills/, 'exact OKX ownership evidence must come from authenticated fill records');
assert.match(exactSettlement, /\/0\/private\/QueryTrades/, 'exact Kraken ownership evidence must come from authenticated trade/fill records');
assert.match(exactSettlement, /quote_currency_fee_semantics_from_current_kraken_spot_execution_schema/, 'Kraken exact settlement must bind current quote-currency fee semantics');
assert.match(exactSettlement, /seen\.has\(tradeId\)/, 'exact fill evidence must deduplicate trade IDs');
assert.match(exactSettlement, /compareExactDecimals\(summedFill, accumulatedFillDecimal\)/, 'enumerated fills must exactly equal authenticated accumulated fill quantity');
assert.match(exactSettlement, /if \(feeAsset\) addDelta\(assetDeltas, feeAsset, feeDecimal\)/, 'authenticated OKX fee/rebate currency must be applied as an exact asset delta');
assert.match(exactSettlement, /addDelta\(assetDeltas, quoteAsset, negateExactDecimal\(feeDecimal\)\)/, 'Kraken quote-currency fees must debit exact system-owned quote inventory');
assert.doesNotMatch(exactSettlement, /Kraken exact system-capital fill transformation remains fail-closed/, 'Kraken exact ownership transformation must no longer be left unwired');

assert.match(lotLedger, /SYSTEM_CAPITAL_PROVENANCE_DEFICIT/, 'unowned trade or fee debit must be a hard provenance deficit');
assert.match(lotLedger, /venue: 'okx' \| 'kraken'/, 'the exact ownership ledger must support both system-owned execution venues');
assert.match(lotLedger, /WHERE venue=\$1 AND asset=\$2 AND status='ACTIVE'/, 'lot consumption must lock only active system-owned inventory');
assert.match(lotLedger, /FOR UPDATE/, 'CEX ownership mutation must lock consumed lots transactionally');
const debitIndex = lotLedger.indexOf('// Debit first.');
const creditIndex = lotLedger.indexOf('for (const [asset, delta] of entries) {', debitIndex + 1);
assert.ok(debitIndex >= 0 && creditIndex > debitIndex, 'CEX ownership transformation must debit before creating outputs');
assert.match(lotLedger, /cryptocrawler_cex_system_owned_settlements/, 'terminal CEX ownership application must have a durable idempotency boundary');
assert.match(lotLedger, /status='APPLIED'/, 'terminal CEX ownership transformation must become durable only after all debits and credits succeed');

assert.match(allocationMigration, /source_amount_base_units numeric\(78,0\)/, 'allocation migration must preserve exact source base units');
assert.match(allocationMigration, /source_token_address text/, 'allocation migration must persist the exact source token contract');
assert.match(ownershipMigration, /cryptocrawler_cex_system_owned_lots/, 'ownership migration must define the sole physical CEX ownership lots');
assert.match(ownershipMigration, /cryptocrawler_cex_system_owned_settlements/, 'ownership migration must define one-time terminal settlement applications');
assert.match(ownershipMigration, /cryptocrawler_seed_cex_system_owned_lot/, 'PLACED CEX deposits must atomically seed physical ownership');
assert.match(ownershipMigration, /tradingAccountSpendableAuthority/, 'OKX deposit lots require Trading-account spendability evidence');
assert.match(ownershipMigration, /Authenticated account balances never create rows/, 'ownership migration must explicitly deny account-wide balance provenance');
assert.match(overflowSchema, /027_cryptocrawler_cex_system_owned_lots\.sql/, 'Overflow runtime schema must provision the physical ownership migration');
assert.match(overflowSchema, /public\.cryptocrawler_cex_system_owned_lots/, 'Overflow runtime admission must require the ownership-lot table');
assert.match(overflowSchema, /public\.cryptocrawler_cex_system_owned_settlements/, 'Overflow runtime admission must require settlement idempotency state');
assert.match(dockerfile, /027_cryptocrawler_cex_system_owned_lots\.sql/, 'production image must bundle the physical CEX ownership migration');

console.log('[self-funded-capital-authority] PASS: personal balances remain excluded; Profit Ladder binds taker and maker CEX size, and exact Kraken/OKX terminal fills transform only system-owned inventory');
