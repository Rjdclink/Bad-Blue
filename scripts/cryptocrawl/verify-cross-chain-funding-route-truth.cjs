'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`[route-truth] missing required source: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

function requirePattern(source, pattern, description) {
  if (!pattern.test(source)) throw new Error(`[route-truth] missing invariant: ${description}`);
}

function forbidPattern(source, pattern, description) {
  if (pattern.test(source)) throw new Error(`[route-truth] forbidden regression: ${description}`);
}

const crossChain = read('server/services/cryptocrawl/discovery/cross-chain-opportunity-generator.ts');
const crossChainEconomics = read('server/services/cryptocrawl/discovery/cross-chain-route-economics.ts');
const acrossExecutor = read('server/services/cryptocrawl/execution/across-bridge-executor.ts');
const funding = read('server/services/cryptocrawl/discovery/funding-rate-monitor.ts');
const fundingPolicy = read('server/services/cryptocrawl/discovery/funding-arbitrage-policy.ts');
const fundingEvidence = read('server/services/cryptocrawl/execution/okx-funding-evidence.ts');
const fundingAdapter = read('server/services/cryptocrawl/execution/okx-funding-lifecycle-adapter.ts');
const fundingLifecycle = read('server/services/cryptocrawl/execution/funding-position-lifecycle.ts');
const fundingMigration = read('server/migrations/024_cryptocrawler_funding_lifecycle.sql');
const router = read('server/services/cryptocrawl/execution/unified-execution-router.ts');
const canonicalRuntime = read('server/services/cryptocrawl/integration/canonical-runtime-wiring.ts');
const retainedProfit = read('server/services/cryptocrawl/compensation/retained-profit-ledger.ts');
const inventoryReadiness = read('server/services/cryptocrawl/integration/cex-inventory-readiness-wiring.ts');

// Across cross-swaps may legitimately require approval transactions. Those
// approvals may not become a discovery dead end: their gas must be measured,
// included exactly once, and revalidated from terminal receipts before principal
// broadcast. Guaranteed min output and separately live input/output USD prices
// remain the canonical closed-value profit authority.
requirePattern(crossChain, /getAcrossBridgeReadiness/, 'cross-chain discovery exposes production configuration truth');
requirePattern(crossChain, /evaluateAcrossClosedUsdProfit/, 'cross-chain discovery delegates canonical closed-USD profit calculation');
requirePattern(crossChain, /const deterministicPositive = economics\?\.executablePositive === true/, 'cross-chain eligibility requires positive canonical route economics');
requirePattern(crossChain, /const approvalGasCanonical = hasFreshQuote[\s\S]{0,180}quote\.approvalGasUsd !== null[\s\S]{0,120}Number\.isFinite\(quote\.approvalGasUsd\)[\s\S]{0,120}quote\.approvalGasUsd >= 0/, 'approval-required Across routes require measured nonnegative approval gas');
requirePattern(crossChain, /const routeExecutable = deterministicPositive[\s\S]{0,300}approvalGasCanonical[\s\S]{0,300}quote!\.minOutputAmount !== null/, 'cross-chain execution requires positive economics, measured approval gas, and guaranteed output');
requirePattern(crossChain, /status: routeExecutable \? 'eligible' : deterministicPositive \? 'deterministic_positive'/, 'only fully executable positive routes become eligible');
requirePattern(crossChain, /grossProfitUsd: economics\?\.routeGainUsdBeforeOriginGas \?\? null/, 'cross-chain gross profit comes from measured closed-value route gain');
requirePattern(crossChain, /deterministicNetProfitUsd: economics\?\.deterministicNetProfitUsd \?\? null/, 'cross-chain deterministic net comes from canonical route economics');
requirePattern(crossChain, /cross_chain_profit_output_authority:minimum_guaranteed_output/, 'minimum guaranteed output is the cross-chain profit output authority');
requirePattern(crossChain, /measured_approval_gas_usd/, 'missing approval-gas evidence remains explicit and reacquirable');
requirePattern(crossChain, /cross_chain_profit_model:closed_usd_value/, 'cross-chain profit model is closed USD value');
requirePattern(crossChain, /cross_chain_profit_model:minimum_output_not_expected_output/, 'expected output cannot become canonical cross-chain profit');
requirePattern(crossChain, /cross_chain_profit_model:swap_origin_gas_subtracted_once/, 'swap origin gas is subtracted exactly once');
requirePattern(crossChain, /cross_chain_profit_model:approval_gas_subtracted_once_when_required/, 'required approval gas is subtracted exactly once');
requirePattern(crossChain, /across_terminal_executor:post_approval_profit_revalidation_required/, 'approval receipts require fresh post-approval profit revalidation');
requirePattern(crossChain, /prepared\.quote\.expiresAt <= Date\.now\(\)/, 'prepared route cache cannot retain stale quotes');
forbidPattern(crossChain, /cross_chain_transport_only:not_profit_opportunity|cross_chain_source_destination_profit_leg/, 'retired transport-only/missing-revenue-leg state cannot replace implemented measured profit truth');

requirePattern(crossChainEconomics, /quote\.minOutputAmount/, 'cross-chain economics require guaranteed minimum output');
requirePattern(crossChainEconomics, /const guaranteedOutputValueUsd = guaranteedOutputHuman \* outputPrice/, 'guaranteed output is marked at a separately live output-asset price');
requirePattern(crossChainEconomics, /const inputValueUsd = inputAmountHuman \* inputPrice/, 'exact input is marked at a separately live input-asset price');
requirePattern(crossChainEconomics, /const routeGainUsdBeforeOriginGas = guaranteedOutputValueUsd - inputValueUsd/, 'closed-value route gain is guaranteed output value minus input value');
requirePattern(crossChainEconomics, /const originGasUsd = swapOriginGasUsd \+ approvalGasUsd/, 'swap and approval origin gas are combined exactly once');
requirePattern(crossChainEconomics, /deterministicNetProfitUsd = routeGainUsdBeforeOriginGas - originGasUsd/, 'all origin gas is deducted once from route gain');
requirePattern(crossChainEconomics, /executablePositive: deterministicNetProfitUsd > 0/, 'cross-chain execution requires strict positive deterministic net');
requirePattern(crossChainEconomics, /across_min_output_closed_usd_plus_live_input_output_prices/, 'cross-chain economics identify their measured closed-value authority');

requirePattern(acrossExecutor, /getAcrossCrossSwapQuote\s*\(/, 'Across executor refreshes the route immediately before signing');
requirePattern(acrossExecutor, /freshExecutionPayload\s*\(/, 'Across executor refreshes executable calldata');
requirePattern(acrossExecutor, /freshMinimum\s*<\s*oldMinimum/, 'Across executor applies minimum-output drift protection');
requirePattern(acrossExecutor, /executeSystemOwnedNativeTransaction\(/, 'approval transactions consume only system-owned native gas');
requirePattern(acrossExecutor, /postApprovalEconomicsPositive\(/, 'executor re-prices exact route economics after approval receipts');
requirePattern(acrossExecutor, /ACROSS_POST_APPROVAL_NONPOSITIVE_NET/, 'principal broadcast is blocked when post-approval economics no longer clear zero');
requirePattern(acrossExecutor, /ACROSS_POST_APPROVAL_ALLOWANCE_NOT_SATISFIED/, 'post-approval payload must prove allowance is satisfied');
requirePattern(acrossExecutor, /requireAllowed\(\s*'SUBMIT_TX'/, 'Across execution remains governance-gated');
requirePattern(acrossExecutor, /getAcrossDepositSettlementEvidence\s*\(/, 'Across execution polls provider settlement evidence');
requirePattern(acrossExecutor, /destinationReceiptVerified/, 'successful Across fill requires destination receipt verification');
requirePattern(acrossExecutor, /refundReceiptVerified/, 'Across refund requires receipt verification');
requirePattern(acrossExecutor, /ACROSS_TERMINAL_SETTLEMENT_TIMEOUT/, 'unknown terminal settlement fails closed');

// Funding is projected carry before settlement, but OKX execution may be promoted
// only after authenticated fees, exact contract sizing, measured entry/exit depth,
// exit reserve/slippage, account mode/capacity and a bounded entry window are all
// proven. Terminal fills + funding bills remain realized-profit authority.
requirePattern(funding, /getOkxSwapCapability\s*\(/, 'funding monitor hydrates authenticated OKX SWAP capability');
requirePattern(funding, /resolveCexFeeEvidence\(\s*'okx'/, 'funding monitor consumes canonical authenticated spot fees');
requirePattern(funding, /measureOkxFundingExecutionEvidence\s*\(/, 'funding monitor measures exact OKX entry/exit execution evidence');
requirePattern(funding, /ensureOkxFundingLifecycleAdapterRegistered\(\)/, 'funding monitor registers the production OKX lifecycle adapter');
requirePattern(funding, /exitBasisReserveBps: executionEvidence\?\.exitBasisReserveBps \?\? null/, 'measured exit-basis reserve feeds projected all-in carry economics');
requirePattern(funding, /expectedSlippageBps: executionEvidence\?\.expectedSlippageBps \?\? null/, 'measured entry/exit slippage feeds projected all-in carry economics');
requirePattern(funding, /const executionCapable = observation\.venue === 'okx'[\s\S]{0,420}projectedNet !== null[\s\S]{0,120}projectedNet > 0[\s\S]{0,160}window\.eligible[\s\S]{0,160}executionEvidence !== null[\s\S]{0,160}executionEvidence\.expiresAt > Date\.now\(\)[\s\S]{0,160}swapCapability\.instrumentVisible[\s\S]{0,160}swapCapability\.accountModeVisible/, 'funding execution promotion requires positive projected carry and complete fresh OKX execution/account evidence');
requirePattern(funding, /status: executionCapable \? 'eligible' : 'enriched'/, 'only fully execution-capable funding observations become eligible');
requirePattern(funding, /depth: executionEvidence[\s\S]{0,180}status: 'measured'/, 'eligible OKX funding carries measured spot and SWAP depth');
requirePattern(funding, /deterministicNetProfitUsd: null/, 'projected funding carry is not relabeled as canonical deterministic profit');
requirePattern(funding, /executableCapability: executionCapable/, 'funding candidate execution capability is tied to measured execution evidence');
requirePattern(funding, /funding_profit_authority:projected_expected_value_until_terminal_bill/, 'pre-settlement funding profit remains explicitly projected');
requirePattern(funding, /execution_promoted_from_bounded_projected_carry_and_complete_execution_evidence/, 'funding promotion provenance requires bounded projected carry plus complete evidence');
requirePattern(funding, /durable_funding_lifecycle:migration_owned_nonblocking/, 'discovery records implemented durable lifecycle truth');
forbidPattern(funding, /persistent_delta_neutral_position_lifecycle|funding_venue_lifecycle_adapter|liquidation_margin_and_collateral_monitoring|terminal_funding_payment_and_close_settlement/, 'retired missing-lifecycle evidence cannot replace implemented OKX lifecycle truth');
requirePattern(fundingPolicy, /input\.fundingRateLocked\s*&&\s*supportedDirection/, 'deterministic funding P&L still requires locked rate and supported direction');
requirePattern(fundingPolicy, /projected funding payment into deterministic execution evidence/, 'policy preserves projected-versus-deterministic separation');

requirePattern(fundingEvidence, /const spotEntry = vwap\(spotBook\.asks, baseQuantity\)/, 'funding execution evidence measures exact spot entry depth');
requirePattern(fundingEvidence, /const spotExit = vwap\(spotBook\.bids, baseQuantity\)/, 'funding execution evidence measures exact spot exit depth');
requirePattern(fundingEvidence, /const perpEntry = vwap\(swapBook\.bids, contracts\)/, 'funding execution evidence measures exact perp entry depth');
requirePattern(fundingEvidence, /const perpExit = vwap\(swapBook\.asks, contracts\)/, 'funding execution evidence measures exact perp exit depth');
requirePattern(fundingEvidence, /const exitBasisReserveBps = bps\(perpExit, spotExit\)/, 'funding exit-basis reserve is measured from executable exit VWAPs');
requirePattern(fundingEvidence, /const expectedSlippageBps = \[/, 'funding slippage is measured across all entry/exit legs');
requirePattern(fundingEvidence, /posMode && posMode !== 'net_mode'/, 'unsupported OKX position mode fails closed');
requirePattern(fundingEvidence, /maxSellContracts < contracts/, 'insufficient authenticated max-size capacity fails closed');
requirePattern(fundingEvidence, /expiresAt: measuredAt \+ maxAgeMs/, 'funding execution evidence is freshness-bounded');

requirePattern(fundingMigration, /private\.cryptocrawler_funding_lifecycles/, 'funding lifecycle table is migration-owned');
requirePattern(fundingLifecycle, /advanceOpenLifecycles/, 'funding lifecycle advances durably on later bounded scheduler ticks');
requirePattern(fundingLifecycle, /openDeltaNeutral/, 'funding lifecycle requires measured delta-neutral opening');
requirePattern(fundingLifecycle, /marginHealthy/, 'funding lifecycle requires margin-health observation');
requirePattern(fundingLifecycle, /closeAndSettle/, 'funding lifecycle requires terminal close settlement');
forbidPattern(fundingLifecycle, /CREATE\s+(TABLE|SCHEMA)/i, 'funding runtime cannot own DDL');
forbidPattern(fundingLifecycle, /while\s*\(\s*Date\.now\(\)\s*</, 'funding lifecycle cannot block through the funding window');

requirePattern(fundingAdapter, /verifyCurrentPlan\(plan\)/, 'OKX lifecycle revalidates projected carry before opening');
requirePattern(fundingAdapter, /openDeltaNeutral\(plan, lifecycleId\)/, 'OKX lifecycle owns delta-neutral opening');
requirePattern(fundingAdapter, /ordType: 'fok'/, 'OKX funding entry/close uses fill-or-kill orders');
requirePattern(fundingAdapter, /async marginHealthy\(receipt\)/, 'OKX lifecycle monitors authenticated margin health while open');
requirePattern(fundingAdapter, /mgnRatio < minimumRatio/, 'OKX lifecycle fails closed below minimum margin ratio');
requirePattern(fundingAdapter, /async closeAndSettle\(plan, receipt\)/, 'OKX lifecycle owns measured terminal close');
requirePattern(fundingAdapter, /measureOkxFundingExecutionEvidence\(/, 'OKX close reacquires fresh exit depth before orders');
requirePattern(fundingAdapter, /terminalFundingAccountingComplete\(settlement\)/, 'funding capital release requires complete terminal accounting');
requirePattern(fundingAdapter, /terminalEvidence: 'authenticated_fills_plus_funding_bills'/, 'authenticated fills plus funding bills are terminal profit evidence');
requirePattern(fundingAdapter, /capitalReleaseAuthority: 'complete_terminal_accounting_only'/, 'funding capital cannot release before complete terminal accounting');
requirePattern(router, /funding_lifecycle_adapter_unavailable/, 'unregistered funding venue adapters remain blocked at the execution router');

requirePattern(retainedProfit, /const PAYOUT_FRACTION = 0\.90/, 'new terminal profits must allocate 90 percent to payout');
requirePattern(retainedProfit, /const RETAINED_FRACTION = 0\.10/, 'new terminal profits must retain 10 percent for system capital');
requirePattern(retainedProfit, /payoutFraction:\s*PAYOUT_FRACTION/, 'durable allocation must use the fixed payout fraction');
requirePattern(retainedProfit, /retainedFraction:\s*RETAINED_FRACTION/, 'durable allocation must use the fixed retained fraction');
requirePattern(retainedProfit, /'ETH','ethereum','QUEUED'/, 'new payout jobs must be ETH on Ethereum');
requirePattern(inventoryReadiness, /automaticProfitPayoutDefault:\s*true/, 'inventory telemetry must reflect automatic fixed payout truth');
requirePattern(inventoryReadiness, /automaticProfitPayoutFraction:\s*0\.90/, 'inventory telemetry must expose the 90 percent payout fraction');
requirePattern(inventoryReadiness, /retainedProfitFraction:\s*0\.10/, 'inventory telemetry must expose the 10 percent retained fraction');
requirePattern(inventoryReadiness, /unreservedRetainedProfitAvailableToStrategies:\s*true/, 'inventory telemetry reflects retained-capital spendability');
forbidPattern(inventoryReadiness, /automaticProfitPayoutRequiresExplicitOptIn:\s*true/, 'stale explicit-opt-in payout telemetry');
forbidPattern(inventoryReadiness, /retainedFortyPercentAvailableToStrategies/, 'stale forty-percent retention telemetry');

requirePattern(canonicalRuntime, /adaptiveProfitCapScope:\s*'retired_no_daily_realized_profit_execution_cap'/, 'runtime telemetry reports daily profit-cap retirement');
requirePattern(canonicalRuntime, /retainedProfitRole:\s*'available_for_redeployment_subject_to_profit_ladder_stage_inventory_liquidity_and_risk'/, 'runtime telemetry reports retained-profit redeployment correctly');
forbidPattern(canonicalRuntime, /persisted_operating_day_terminal_realized_cap_plus_dynamic_notional_and_cycle_budget|new_exposure_only_settlement_hedge_flattening_exempt/, 'stale daily profit-cap authority telemetry');

console.log('[route-truth] guaranteed-minimum closed-USD Across economics, measured approval-gas inclusion and post-approval revalidation, terminal Across settlement, measured OKX funding entry/exit economics, bounded projected-carry promotion, durable delta-neutral lifecycle, authenticated terminal funding accounting, fixed 90/10 treasury, retained-capital reuse, and retired profit-cap invariants passed');
