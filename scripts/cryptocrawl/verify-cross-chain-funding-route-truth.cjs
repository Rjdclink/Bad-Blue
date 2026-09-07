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

// Across transport becomes a candidate only when the exact current route has a
// guaranteed minimum output whose closed USD value stays positive after every
// separately-paid origin transaction cost. Provider simulation is telemetry only.
requirePattern(crossChain, /getAcrossBridgeReadiness/, 'cross-chain discovery exposes production configuration truth');
requirePattern(crossChain, /evaluateAcrossClosedUsdProfit/, 'cross-chain discovery delegates closed-USD profitability to one authority');
requirePattern(crossChain, /const deterministicPositive = economics\?\.executablePositive === true/, 'cross-chain eligibility requires positive canonical route economics');
requirePattern(crossChain, /const approvalGasCanonical = hasFreshQuote[\s\S]{0,180}quote\.approvalGasUsd !== null[\s\S]{0,180}quote\.approvalGasUsd >= 0/, 'approval gas must be explicitly measured or measured zero');
requirePattern(crossChain, /const routeExecutable = deterministicPositive[\s\S]{0,360}readiness\.configured[\s\S]{0,360}hasSigner[\s\S]{0,360}approvalGasCanonical[\s\S]{0,360}swapTransactionPresent === true[\s\S]{0,360}minOutputAmount !== null/, 'cross-chain execution requires positive economics, configuration, signer, gas, payload and guaranteed output');
requirePattern(crossChain, /status: routeExecutable \? 'eligible' : deterministicPositive \? 'deterministic_positive'/, 'only fully executable positive routes become eligible');
requirePattern(crossChain, /grossProfitUsd: economics\?\.routeGainUsdBeforeOriginGas \?\? null/, 'cross-chain gross profit comes from guaranteed closed-value route gain');
requirePattern(crossChain, /deterministicNetProfitUsd: economics\?\.deterministicNetProfitUsd \?\? null/, 'cross-chain deterministic net comes from canonical route economics');
requirePattern(crossChain, /cross_chain_profit_output_authority:minimum_guaranteed_output/, 'minimum guaranteed output is the cross-chain output authority');
requirePattern(crossChain, /measured_approval_gas_usd/, 'unpriced approval gas remains explicit missing evidence');
requirePattern(crossChain, /cross_chain_profit_model:closed_usd_value/, 'same-asset and cross-asset routes use one closed USD value model');
requirePattern(crossChain, /cross_chain_profit_model:minimum_output_not_expected_output/, 'expected output cannot become canonical cross-chain profit');
requirePattern(crossChain, /cross_chain_profit_model:swap_origin_gas_subtracted_once/, 'swap origin gas is subtracted exactly once');
requirePattern(crossChain, /cross_chain_profit_model:approval_gas_subtracted_once_when_required/, 'approval gas is subtracted exactly once when required');
requirePattern(crossChain, /cross_chain_simulation_execution_authority:false/, 'Across simulation cannot authorize or veto execution');
requirePattern(crossChain, /advisory:bridge_provider_simulation_unsuccessful_or_unavailable/, 'unsuccessful provider simulation is retained as advisory evidence');
requirePattern(crossChain, /acquireRouteQuotes\(routes, notionalUsd\)/, 'all structural routes are actively reacquired every cycle');
requirePattern(crossChain, /acrossQuoteConcurrency\(\)/, 'route acquisition pressure remains concurrency bounded');
requirePattern(crossChain, /routes\.map\(route => recordRoute/, 'every structural route remains represented');
requirePattern(crossChain, /prepared\.quote\.expiresAt <= Date\.now\(\)/, 'prepared route cache rejects expired routes');
forbidPattern(crossChain, /quote!\.simulationSuccess === true/, 'provider simulation cannot be an execution admission gate');
forbidPattern(crossChain, /Math\.random/, 'route coverage cannot be randomly skipped');

requirePattern(crossChainEconomics, /quote\.minOutputAmount/, 'cross-chain economics require guaranteed minimum output');
requirePattern(crossChainEconomics, /inputValueUsd = inputAmountHuman \* inputPrice/, 'input value uses live input-asset USD price');
requirePattern(crossChainEconomics, /guaranteedOutputValueUsd = guaranteedOutputHuman \* outputPrice/, 'guaranteed output uses separately live output-asset USD price');
requirePattern(crossChainEconomics, /routeGainUsdBeforeOriginGas = guaranteedOutputValueUsd - inputValueUsd/, 'closed route gain is output USD value minus input USD value');
requirePattern(crossChainEconomics, /originGasUsd = swapOriginGasUsd \+ approvalGasUsd/, 'all separately paid origin gas is combined once');
requirePattern(crossChainEconomics, /deterministicNetProfitUsd = routeGainUsdBeforeOriginGas - originGasUsd/, 'origin gas is deducted once from closed route gain');
requirePattern(crossChainEconomics, /executablePositive: deterministicNetProfitUsd > 0/, 'cross-chain execution requires strict positive deterministic net');
requirePattern(crossChainEconomics, /across_min_output_closed_usd_plus_live_input_output_prices/, 'cross-chain economics identify their measured authority');
forbidPattern(crossChainEconomics, /expectedOutputAmount[^\n]*deterministicNetProfitUsd/, 'expected output cannot manufacture deterministic profit');

// Immediately before principal broadcast the executor reacquires the uncached
// approval response and requires real wallet spendability in addition to the
// upstream receipt-backed system-owned-lot reservation.
requirePattern(acrossExecutor, /getAcrossCrossSwapQuote\s*\(/, 'Across executor refreshes the route immediately before signing');
requirePattern(acrossExecutor, /freshExecutionPayload\s*\(/, 'Across executor refreshes executable calldata');
requirePattern(acrossExecutor, /payload\?\.checks\?\.balance/, 'Across executor consumes the fresh depositor balance check');
requirePattern(acrossExecutor, /balanceToken\.toLowerCase\(\) !== quote\.inputToken\.toLowerCase\(\)/, 'Across balance evidence is token-identity bound');
requirePattern(acrossExecutor, /balanceActual < balanceExpected/, 'actual depositor balance must cover the provider-required amount');
requirePattern(acrossExecutor, /balanceExpected < routeInput/, 'provider-required balance may not understate the exact route input');
requirePattern(acrossExecutor, /simulationVetoAuthority:\s*false/, 'Across simulation remains advisory throughout execution');
requirePattern(acrossExecutor, /freshMinimum < oldMinimum/, 'Across executor applies minimum-output drift protection');
requirePattern(acrossExecutor, /liveApprovalGasUsd/, 'approval receipts are converted to actual USD gas cost');
requirePattern(acrossExecutor, /postApprovalEconomicsPositive/, 'Across executor re-proves positive economics after approval gas is spent');
requirePattern(acrossExecutor, /postPayload\.approvals\.length > 0/, 'allowance must be satisfied after approval receipts');
requirePattern(acrossExecutor, /requireAllowed\(\s*'SUBMIT_TX'/, 'Across execution remains governance-gated');
requirePattern(acrossExecutor, /armPreparedAcrossOriginTransaction/, 'signed origin transaction is durably armed before broadcast');
requirePattern(acrossExecutor, /getAcrossDepositSettlementEvidence\s*\(/, 'Across execution polls provider settlement evidence');
requirePattern(acrossExecutor, /destinationReceiptVerified/, 'successful Across fill requires destination receipt verification');
requirePattern(acrossExecutor, /refundReceiptVerified/, 'Across refund requires receipt verification');
requirePattern(acrossExecutor, /ACROSS_TERMINAL_SETTLEMENT_TIMEOUT/, 'unknown terminal settlement fails closed');
forbidPattern(acrossExecutor, /quote\.simulationSuccess !== true/, 'input quote simulation cannot become a hard veto');

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
requirePattern(funding, /const executionCapable = observation\.venue === 'okx'[\s\S]{0,520}projectedNet !== null[\s\S]{0,160}projectedNet > 0[\s\S]{0,200}window\.eligible[\s\S]{0,200}executionEvidence !== null[\s\S]{0,200}executionEvidence\.expiresAt > Date\.now\(\)[\s\S]{0,200}swapCapability\.instrumentVisible[\s\S]{0,200}swapCapability\.accountModeVisible/, 'funding execution promotion requires positive projected carry and complete fresh OKX execution/account evidence');
requirePattern(funding, /status: executionCapable \? 'eligible' : 'enriched'/, 'only fully execution-capable funding observations become eligible');
requirePattern(funding, /depth: executionEvidence[\s\S]{0,220}status: 'measured'/, 'eligible OKX funding carries measured spot and SWAP depth');
requirePattern(funding, /deterministicNetProfitUsd: null/, 'projected funding carry is not relabeled as canonical deterministic profit');
requirePattern(funding, /executableCapability: executionCapable/, 'funding candidate execution capability is tied to measured execution evidence');
requirePattern(funding, /funding_profit_authority:projected_expected_value_until_terminal_bill/, 'pre-settlement funding profit remains explicitly projected');
requirePattern(funding, /execution_promoted_from_bounded_projected_carry_and_complete_execution_evidence/, 'funding promotion provenance requires bounded projected carry plus complete evidence');
requirePattern(funding, /durable_funding_lifecycle:migration_owned_nonblocking/, 'discovery records implemented durable lifecycle truth');
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

// Confirmed terminal profit follows the current operator treasury law: 90% is a
// durable ETH payout obligation and 10% remains available as retained capital.
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

// Daily realized-profit execution caps stay retired; Profit Ladder/Stage/inventory/
// liquidity/risk remain the exposure authorities.
requirePattern(canonicalRuntime, /adaptiveProfitCapScope:\s*'retired_no_daily_realized_profit_execution_cap'/, 'runtime telemetry reports daily profit-cap retirement');
requirePattern(canonicalRuntime, /retainedProfitRole:\s*'available_for_redeployment_subject_to_profit_ladder_stage_inventory_liquidity_and_risk'/, 'runtime telemetry reports retained-profit redeployment correctly');
forbidPattern(canonicalRuntime, /persisted_operating_day_terminal_realized_cap_plus_dynamic_notional_and_cycle_budget|new_exposure_only_settlement_hedge_flattening_exempt/, 'stale daily profit-cap authority telemetry');

console.log('[route-truth] PASS: guaranteed closed-USD Across economics, fresh wallet balance + system-owned capital authority, actual approval gas, advisory provider simulation, terminal Across settlement, measured funding execution, durable lifecycle, authenticated terminal P&L, fixed 90/10 treasury, retained-capital reuse, and retired profit-cap invariants passed');
