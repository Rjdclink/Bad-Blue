import { captureCryptoCrawlerWorkGuard } from '../runtime/manual-power-state.js';
import { assertDiscoveryWorkActive, awaitDiscoveryWork, discoveryProvider, runDiscoveryWork } from '../runtime/discovery-work-context.js';
import { BigNumber, type Wallet, type providers } from 'ethers';
import logger from '../../../logger.js';
import { zeroCapitalEngine, type SupportedChain, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { DynamicChainConfig } from '../core/dynamic-chain-registry.js';
import { discoverDynamicZeroCapitalQuotes } from './dynamic-zero-capital-routes.js';
import { measuredCandidateRegistry } from './measured-candidate-registry.js';
import {
  clearsStageOneCandidateOutputFloor,
  STAGE_ONE_ZERO_CAPITAL_OUTPUT_FLOOR_BPS,
} from './stage-one-candidate-policy.js';
import { getCanonicalZeroCapitalRoutes } from './zero-capital-route-authority.js';
import {
  zeroCapitalDiscoveryFloorBps,
  stopZeroCapitalQuoteTracking,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import {
  supportsSponsoredReceiverChain,
  type SponsoredReceiverRecord,
  type ReceiverFundingMode,
} from '../execution/adapters/sponsored-receiver-manager.js';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import { repriceZeroCapitalProviderEconomics } from '../integration/zero-capital-flash-provider-wiring.js';
import { repriceZeroCapitalAlternativeCapital } from '../integration/zero-capital-alternative-capital-wiring.js';
import { runFairZeroCapitalProfitabilityRescue } from '../integration/zero-capital-profitability-rescue-fair.js';
import { runStageTwoZeroCapitalBpsReduction } from '../integration/stage-two-zero-capital-bps-reduction.js';
import { selectApeStageOneHotSet } from '../integration/ape-directional-market.js';
import { zeroCapitalRouteEvidenceRegistry } from '../optimization/zero-capital-route-evidence-registry.js';
import { getProvenZeroCapitalGasFundingDecision } from '../runtime/system-owned-gas-funding-proof-wiring.js';
import { executeSystemOwnedNativeTransaction } from '../execution/system-owned-native-transaction.js';

type ReceiverPermissionCall = { to: string; data: string; value?: string | number | BigNumber };

interface CanonicalZeroCapitalRuntime {
  configuredRoutes: ConfiguredZeroCapitalRoute[];
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
  dynamicChainConfigs: Map<Exclude<SupportedChain, 'europa'>, DynamicChainConfig>;
  gasSponsor: {
    getReadiness: () => { ready: boolean };
    execute: (input: {
      wallet: Wallet;
      chainId: number;
      calls: Array<{ to: string; data: string; value?: BigNumber }>;
      timeoutMs: number;
    }) => Promise<{ transactionHash: string }>;
  };
  receiverManager: {
    getReceiver: (chain: string) => string | null;
    getCompositeReceiver: (chain: string) => string | null;
    getRecords: () => SponsoredReceiverRecord[];
    ensureReceiver: (input: {
      chain: any;
      provider: providers.JsonRpcProvider;
      wallet: Wallet;
      fundingMode: ReceiverFundingMode;
    }) => Promise<SponsoredReceiverRecord>;
    buildMissingPermissionCalls: (input: {
      chain: any;
      receiver: string;
      provider: providers.JsonRpcProvider;
      routes: ConfiguredZeroCapitalRoute[];
    }) => Promise<ReceiverPermissionCall[]>;
    buildMissingCompositePermissionCalls: (input: {
      chain: any;
      provider: providers.JsonRpcProvider;
      routes: ConfiguredZeroCapitalRoute[];
    }) => Promise<ReceiverPermissionCall[]>;
  };
  scanChain: (chain: SupportedChain, provider: providers.JsonRpcProvider, funding?: GasFundingDecision) => Promise<ZeroCapitalOpportunity[]>;
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
}

class DiscoveryWatchdogTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} watchdog expired after ${timeoutMs}ms`);
    this.name = 'DiscoveryWatchdogTimeoutError';
  }
}

let started = false;
let lifecycleController: AbortController | null = null;
let startingTask: Promise<void> | null = null;
let timer: NodeJS.Timeout | null = null;
let cycleInFlight: Promise<void> | null = null;
let receiverFleetTask: Promise<void> | null = null;
let receiverFleetTimedOut = false;
let receiverFleetObservedTask: Promise<void> | null = null;
const chainScanTasks = new Map<SupportedChain, Promise<void>>();
const chainScanGenerations = new Map<SupportedChain, number>();
let lastCycleAt = 0;
let lastError: string | null = null;
let lastObservationOnlyReason: string | null = null;
let observed = 0;
let repriced = 0;
let readyReceiverChains = 0;
let receiverWatchdogExpirations = 0;
let chainWatchdogExpirations = 0;
let observationOnlyCycles = 0;
let filteredBelowStageOneFloor = 0;
let stageOneMeasuredDeferredFromHotLane = 0;

// STAGE_ONE_LOCKED_INVARIANT — explicitly reinstated by operator 2026-09-16.
// Preserve every raw observation, but Stage One outputs only fresh finite exact
// ZERO_CAPITAL_ATOMIC candidates whose all-in net spread is strictly above -10 BPS.
// This is classification only, never execution-profitability authority. The measured
// direction-aware hot lane remains intact inside that admitted set, adding no quote I/O.

function runtime(): CanonicalZeroCapitalRuntime {
  return zeroCapitalEngine as unknown as CanonicalZeroCapitalRuntime;
}

function scanDelayMs(): number {
  const raw = Number(process.env.ZERO_CAPITAL_SCAN_MIN_MS || 2500);
  return Number.isFinite(raw) ? Math.max(500, Math.min(15_000, Math.trunc(raw))) : 2500;
}

function boundedWatchdogMs(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function receiverFleetWatchdogMs(): number {
  return boundedWatchdogMs(process.env.ZERO_CAPITAL_RECEIVER_FLEET_WATCHDOG_MS, 30_000, 5_000, 120_000);
}

function receiverSetupTimeoutMs(): number {
  return boundedWatchdogMs(process.env.ZERO_CAPITAL_SPONSORED_SETUP_TIMEOUT_MS, 90_000, 10_000, 120_000);
}

function chainScanWatchdogMs(): number {
  return boundedWatchdogMs(process.env.ZERO_CAPITAL_CHAIN_SCAN_WATCHDOG_MS, 45_000, 5_000, 120_000);
}

function withWatchdog<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const boundedMs = Math.max(1, Math.trunc(timeoutMs));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DiscoveryWatchdogTimeoutError(label, boundedMs)), boundedMs);
    timer.unref?.();
    task.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function nextChainScanGeneration(chain: SupportedChain): number {
  const generation = (chainScanGenerations.get(chain) || 0) + 1;
  chainScanGenerations.set(chain, generation);
  return generation;
}

function isCurrentChainScanGeneration(chain: SupportedChain, generation: number): boolean {
  return started && chainScanGenerations.get(chain) === generation;
}

function invalidateChainScanGeneration(chain: SupportedChain, generation: number): void {
  if (!isCurrentChainScanGeneration(chain, generation)) return;
  chainScanGenerations.set(chain, generation + 1);
}

function baseUnitsToUsd(value: bigint | undefined, decimals: number): number {
  if (value === undefined) return 0;
  const divisor = 10 ** Math.max(0, Math.min(18, decimals));
  const converted = Number(value) / divisor;
  return Number.isFinite(converted) ? converted : 0;
}

const BPS_PRECISION_SCALE = 1_000_000n;

function bpsFromBaseUnits(value: bigint | undefined, notional: bigint): number | null {
  if (value === undefined || notional <= 0n) return null;
  return Number((value * 10_000n * BPS_PRECISION_SCALE) / notional) / Number(BPS_PRECISION_SCALE);
}

function executionRoutes(target: CanonicalZeroCapitalRuntime): ConfiguredZeroCapitalRoute[] {
  return getCanonicalZeroCapitalRoutes({
    providerChains: target.providers.keys(),
    configuredRoutes: target.configuredRoutes,
  });
}

async function strictFunding(target: CanonicalZeroCapitalRuntime, chain: SupportedChain): Promise<GasFundingDecision> {
  return awaitDiscoveryWork(() => getProvenZeroCapitalGasFundingDecision(target, chain));
}

async function executeSetupCalls(input: {
  target: CanonicalZeroCapitalRuntime;
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  funding: GasFundingDecision;
  calls: ReceiverPermissionCall[];
}): Promise<void> {
  assertDiscoveryWorkActive();
  if (input.funding.strictZeroInitialCapitalEligible !== true || input.funding.operatorMonetaryInputRequired !== false) {
    throw new Error(`Strict zero-capital setup funding is unavailable: ${input.funding.reason}`);
  }
  if (input.funding.mode === 'sponsored') {
    if (input.funding.paymentSource !== 'provider_sponsored') throw new Error('Unproven sponsored setup payment source');
    const network = await input.provider.getNetwork();
    assertDiscoveryWorkActive();
    await input.target.gasSponsor.execute({
      wallet: input.wallet,
      chainId: network.chainId,
      calls: input.calls.map(call => ({ to: call.to, data: call.data, value: BigNumber.from(call.value || 0) })),
      timeoutMs: receiverSetupTimeoutMs(),
    });
    return;
  }
  if (input.funding.mode !== 'native' || input.funding.paymentSource !== 'system_owned_native') {
    throw new Error(`Strict zero-capital setup has no proven system-owned gas path: ${input.funding.reason}`);
  }
  for (let index = 0; index < input.calls.length; index += 1) {
    assertDiscoveryWorkActive();
    const call = input.calls[index];
    const result = await executeSystemOwnedNativeTransaction({
      chain: input.chain,
      wallet: input.wallet,
      provider: input.provider,
      idempotencyKey: `zero-capital-setup:${input.chain}:${call.to}:${index}:${call.data.slice(0, 18)}`,
      purpose: 'zero_capital_receiver_permission_setup',
      transaction: { to: call.to, data: call.data, value: BigNumber.from(call.value || 0) },
      confirmations: 1,
    });
    if (result.receipt.status !== 1) throw new Error(`System-owned receiver permission transaction reverted on ${input.chain}`);
  }
}

async function ensureReceiverFleet(target: CanonicalZeroCapitalRuntime): Promise<void> {
  const routes = executionRoutes(target);
  const chains = [...new Set(routes.map(route => route.chain as SupportedChain))]
    .filter(chain => chain !== 'europa' && supportsSponsoredReceiverChain(chain as any));
  let ready = 0;
  const failures: string[] = [];
  const compositeFailures: string[] = [];
  // The 30s fleet warning must not cut short the configured receipt wait after a
  // setup submission. Each chain still has a finite deadline and stops on OFF.
  const setupDeadlineMs = Math.max(receiverFleetWatchdogMs(), receiverSetupTimeoutMs() + 30_000);
  await Promise.allSettled(chains.map(chain => runDiscoveryWork(`zero-capital ${chain} receiver setup`, setupDeadlineMs, async () => {
    const rawProvider = target.providers.get(chain);
    const provider = rawProvider ? discoveryProvider(rawProvider) : undefined;
    const wallet = target.executionWallets.get(chain);
    if (!provider || !wallet) { failures.push(`${chain}:provider_or_wallet_unavailable`); return; }
    try {
      const funding = await strictFunding(target, chain);
      if (funding.mode === 'unavailable') throw new Error(funding.reason);
      assertDiscoveryWorkActive();
      const receiver = await awaitDiscoveryWork(() => target.receiverManager.ensureReceiver({
        chain: chain as any,
        provider,
        wallet,
        fundingMode: funding.mode as ReceiverFundingMode,
      }));
      assertDiscoveryWorkActive();
      const chainRoutes = routes.filter(route => route.chain === chain);
      const calls = await target.receiverManager.buildMissingPermissionCalls({
        chain: chain as any,
        receiver: receiver.address,
        provider,
        routes: chainRoutes,
      });
      if (calls.length > 0) {
        await executeSetupCalls({ target, chain, provider, wallet, funding, calls });
      }

      // Composite setup is optional/additive. Its deployment and permission lane is
      // intentionally separate so a split-route capability problem cannot demote a
      // fully working standalone receiver on the same chain.
      try {
        assertDiscoveryWorkActive();
        const compositeCalls = await target.receiverManager.buildMissingCompositePermissionCalls({
          chain: chain as any,
          provider,
          routes: chainRoutes,
        });
        if (compositeCalls.length > 0) {
          await executeSetupCalls({ target, chain, provider, wallet, funding, calls: compositeCalls });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        compositeFailures.push(`${chain}:${message}`);
        logger.debug('[ZeroCapitalDiscovery] Composite receiver permission setup degraded locally', {
          component: 'CanonicalZeroCapitalDiscovery',
          chain,
          error: message,
          standaloneReceiverReady: true,
          compositeOnlyFailure: true,
          discoveryContinues: true,
          executionAuthority: false,
        });
      }
      assertDiscoveryWorkActive();
      ready++;
    } catch (error) {
      failures.push(`${chain}:${error instanceof Error ? error.message : String(error)}`);
    }
  }, lifecycleController?.signal)));
  if (!started) return;
  readyReceiverChains = ready;
  if (ready === 0 && chains.length > 0) {
    logger.debug('[ZeroCapitalDiscovery] No strict zero-capital receiver chain is execution-ready; discovery remains active', {
      component: 'CanonicalZeroCapitalDiscovery', failures, compositeFailures, executionAuthority: false,
    });
  } else if (failures.length > 0 || compositeFailures.length > 0) {
    logger.debug('[ZeroCapitalDiscovery] Receiver fleet is partially ready; failures remain route-local', {
      component: 'CanonicalZeroCapitalDiscovery',
      readyReceiverChains: ready,
      failures,
      compositeFailures,
      compositeFailureDemotesStandalone: false,
    });
  }
}

function currentReceiverFleetTask(target: CanonicalZeroCapitalRuntime): Promise<void> {
  if (receiverFleetTask) return receiverFleetTask;
  receiverFleetTask = ensureReceiverFleet(target).finally(() => {
    receiverFleetTask = null;
    receiverFleetTimedOut = false;
  });
  return receiverFleetTask;
}

/**
 * Receiver preparation is useful setup work, but it is not a global admission
 * authority. One slow or unready chain must never suppress exact provider
 * repricing on another chain. The canonical provider stage already verifies that
 * exact chain's funding, receiver capability, permissions and builder cold-start
 * path before it can mark a candidate eligible.
 */
function refreshReceiverFleetForCycle(target: CanonicalZeroCapitalRuntime): void {
  if (receiverFleetTimedOut && receiverFleetTask) {
    lastObservationOnlyReason = 'receiver_fleet_watchdog_still_pending_chain_local_scans_continue';
    observationOnlyCycles++;
    return;
  }

  const task = currentReceiverFleetTask(target);
  if (receiverFleetObservedTask === task) return;
  receiverFleetObservedTask = task;
  void withWatchdog(task, receiverFleetWatchdogMs(), 'zero-capital receiver fleet').then(
    () => {
      lastObservationOnlyReason = null;
    },
    error => {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof DiscoveryWatchdogTimeoutError) {
        receiverFleetTimedOut = true;
        receiverWatchdogExpirations++;
      }
      lastObservationOnlyReason = message;
      observationOnlyCycles++;
      logger.warn('[ZeroCapitalDiscovery] Receiver fleet preparation exceeded its watchdog; chain-local discovery and provider repricing continue independently', {
        component: 'CanonicalZeroCapitalDiscovery',
        error: message,
        receiverWatchdogExpirations,
        globalProviderAdmissionBlocked: false,
        chainLocalResourceProofRequired: true,
        executionAuthority: false,
      });
    },
  );
}

function canonicalEconomics(opportunity: ZeroCapitalOpportunity, quote?: QuotedZeroCapitalRoute) {
  const notional = opportunity.flashLoanAmount;
  const grossProfitBps = quote?.grossProfitBps ?? bpsFromBaseUnits(opportunity.grossProfit, notional);
  const flashLoanFeeBps = bpsFromBaseUnits(opportunity.flashLoanFeeInInputToken, notional);
  const gasCostBps = bpsFromBaseUnits(opportunity.estimatedGasCostInInputToken, notional);
  const relayCostBps = bpsFromBaseUnits(opportunity.relayFeeInInputToken, notional);
  const allInCostBps = quote?.allInCostBps ?? bpsFromBaseUnits(opportunity.estimatedExecutionCostInInputToken, notional);
  const netProfitBps = quote?.netProfitBps ?? opportunity.netProfitBps;
  return {
    grossProfitUsd: baseUnitsToUsd(opportunity.grossProfit, opportunity.inputTokenDecimals),
    deterministicNetProfitUsd: baseUnitsToUsd(opportunity.expectedProfit, opportunity.inputTokenDecimals),
    feeUsd: 0,
    gasUsd: baseUnitsToUsd(opportunity.estimatedGasCostInInputToken, opportunity.inputTokenDecimals),
    bridgeUsd: 0,
    expectedSlippageBps: 0,
    expectedPriceImpactBps: null,
    grossProfitBps,
    flashLoanFeeBps,
    gasCostBps,
    relayCostBps,
    allInCostBps,
    breakEvenBps: quote?.breakEvenBps ?? allInCostBps,
    netProfitBps,
    discoveryFloorBps: quote?.discoveryFloorBps ?? zeroCapitalDiscoveryFloorBps(),
    bpsToBreakEven: netProfitBps >= 0 ? 0 : Math.abs(netProfitBps),
    realizedNetProfitBps: null,
  };
}

function recordPreselectionCandidate(input: {
  opportunity: ZeroCapitalOpportunity;
  quote?: QuotedZeroCapitalRoute;
  source: 'configured' | 'dynamic';
  resourceReady: boolean;
  resourceReason: string;
}): void {
  const { opportunity, quote } = input;
  const positive = opportunity.expectedProfit > 0n && (quote?.executablePositive ?? true);
  const existing = measuredCandidateRegistry.get(opportunity.id);
  if (existing?.status === 'eligible') {
    measuredCandidateRegistry.updateStatus(opportunity.id, positive ? 'deterministic_positive' : 'enriched', {
      executableCapability: false,
      executionCapabilityReason: 'Fresh quote requires fresh canonical provider/resource repricing before eligibility',
      provenance: ['fresh_quote_revokes_prior_provider_admission'],
    });
  }

  // Preserve every raw route observation, including <= -10 BPS evidence. Stage One
  // publishes only candidates that satisfy its strict output boundary.
  zeroCapitalRouteEvidenceRegistry.record(opportunity);
  if (!Number.isFinite(opportunity.netProfitBps)) return;
  if (!clearsStageOneCandidateOutputFloor(opportunity)) {
    filteredBelowStageOneFloor++;
    return;
  }

  measuredCandidateRegistry.record({
    opportunityId: opportunity.id,
    topology: 'ZERO_CAPITAL_ATOMIC',
    observedAt: opportunity.timestamp,
    expiresAt: opportunity.expiresAt,
    status: positive ? 'deterministic_positive' : 'enriched',
    assets: [opportunity.inputAssetSymbol],
    venues: [...new Set(opportunity.route.map(step => step.protocol))],
    chains: [opportunity.chain],
    rawQuotes: opportunity.route.map(step => ({
      source: step.protocol,
      venue: step.protocol,
      chain: opportunity.chain,
      observedAt: opportunity.timestamp,
      amountIn: step.amountIn.toString(),
      amountOut: step.expectedAmountOut.toString(),
      executable: true,
      provenance: ['direct_contract_quote', 'exact_route_measurement', 'capital_source_selection_pending'],
    })),
    depth: { status: 'measured', detail: 'Exact route legs returned live contract/router quote output' },
    economics: canonicalEconomics(opportunity, quote),
    quoteAgeMs: opportunity.quoteLatencyMs,
    executableCapability: false,
    executionCapabilityReason: positive
      ? input.resourceReady
        ? 'Deterministic-positive exact quote awaits canonical measured capital-source repricing'
        : `Deterministic-positive exact quote is resource-blocked before capital-source selection: ${input.resourceReason}`
      : `Measured route is ${opportunity.netProfitBps} BPS net and remains observation-only for measured capital-cost optimization`,
    missingInformation: positive && !input.resourceReady ? ['required:zero_personal_cost_execution_resource'] : [],
    provenance: [
      input.source === 'dynamic' ? 'dynamic_zero_capital_route' : 'configured_zero_capital_route',
      'direct_contract_quotes',
      'measured_all_in_economics',
      'exact_route_evidence:zero_capital_route_evidence_registry',
      'capital_source_repricing_pending',
      'quoted_amount_out_embeds_current_route_economics',
      'min_output_tolerance_not_expected_slippage_cost',
      'eligibility_authority:canonical_measured_capital_repricing_only',
      positive ? 'deterministic_positive_net' : 'measured_negative_or_break_even',
      'stage_one_output_floor:strictly_above_negative_10_bps',
      'synthetic_evidence:false',
    ],
  });
  observed++;
}

async function scanOneChain(
  chain: SupportedChain,
  provider: providers.JsonRpcProvider,
  generation: number,
): Promise<void> {
  if (chain === 'europa') return;
  const target = runtime();
  const funding = await runDiscoveryWork(`zero-capital ${chain} funding proof`, 3_000,
    () => strictFunding(target, chain)).catch(error => ({
      chain, mode: 'unavailable' as const, nativeBalance: 0n, reserveFloor: 0n,
      paymentSource: 'unavailable' as const, strictZeroInitialCapitalEligible: false,
      operatorMonetaryInputRequired: true,
      reason: `Funding proof unavailable: ${error instanceof Error ? error.message : String(error)}`,
    }));
  if (!isCurrentChainScanGeneration(chain, generation)) return;
  const receiverReady = Boolean(target.receiverManager.getReceiver(chain));
  const resourceReady = funding.mode !== 'unavailable'
    && funding.strictZeroInitialCapitalEligible === true
    && funding.operatorMonetaryInputRequired === false && receiverReady;
  const resourceReason = funding.mode === 'unavailable' ? funding.reason
    : receiverReady ? funding.reason : 'verified_execution_receiver_unavailable';

  const accept = async (opportunities: ZeroCapitalOpportunity[], source: 'configured' | 'dynamic', quotes?: QuotedZeroCapitalRoute[]) => {
    assertDiscoveryWorkActive();
    if (!isCurrentChainScanGeneration(chain, generation)) return;
    const publish = async (measured: ZeroCapitalOpportunity[]) => {
      assertDiscoveryWorkActive();
      if (!isCurrentChainScanGeneration(chain, generation)) return;
      for (const opportunity of measured) {
        const originalIndex = opportunities.indexOf(opportunity);
        const quote = originalIndex >= 0 ? quotes?.[originalIndex] : undefined;
        recordPreselectionCandidate({ opportunity, quote, source, resourceReady, resourceReason });
      }
      await processMeasuredBatch(chain, provider, generation, measured);
    };
    const admitted = opportunities.filter(clearsStageOneCandidateOutputFloor);
    const belowFloor = opportunities.filter(o => Number.isFinite(o.netProfitBps) && !clearsStageOneCandidateOutputFloor(o));
    // Existing admitted evidence must never wait behind below-floor exploration.
    const ready = publish(admitted);
    const reducing = (async () => {
      if (belowFloor.length === 0) return;
      let measured = belowFloor;
      try {
        measured = await runStageTwoZeroCapitalBpsReduction({
          chain, provider, opportunities: belowFloor, configuredRoutes: executionRoutes(target),
          fromQuotedRoute: target.fromQuotedRoute.bind(target),
        });
      } catch (error) {
        assertDiscoveryWorkActive();
        logger.warn('[ZeroCapitalDiscovery] Below-floor BPS reduction unavailable; original measurements retained', {
          chain, error: error instanceof Error ? error.message : String(error),
        });
      }
      await publish(measured);
    })();
    await Promise.all([ready, reducing]);
  };
  // Each acquisition lane hands fresh results directly to BPS rescue. A slow
  // sibling must not hold completed evidence behind Promise.all's final barrier.
  const configuredTask = target.scanChain(chain, provider, funding)
    .then(opportunities => accept(opportunities, 'configured'));
  const dynamicTask = discoverDynamicZeroCapitalQuotes(chain, provider, funding, async quotes => {
    const opportunities = quotes.map(quote => {
      const opportunity = target.fromQuotedRoute(
        quote, Math.floor((quote.observedAt ?? (Date.now() - quote.quoteLatencyMs)) / 1000),
      );
      if (quote.id.startsWith('graphless-')) {
        const ttl = boundedWatchdogMs(process.env.ZERO_CAPITAL_GRAPHLESS_ROUTE_TTL_MS, 1500, 500, 3000);
        opportunity.expiresAt = Math.min(opportunity.expiresAt, opportunity.timestamp + ttl);
      }
      return opportunity;
    });
    await accept(opportunities, 'dynamic', quotes);
  });
  const results = await Promise.allSettled([configuredTask, dynamicTask]);
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result.status === 'rejected') logger.warn('[ZeroCapitalDiscovery] Measurement lane failed independently', {
      component: 'CanonicalZeroCapitalDiscovery', chain,
      lane: index === 0 ? 'configured' : 'dynamic',
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  }
}

async function processMeasuredBatch(
  chain: SupportedChain,
  provider: providers.JsonRpcProvider,
  generation: number,
  opportunities: ZeroCapitalOpportunity[],
): Promise<void> {
  assertDiscoveryWorkActive();
  const target = runtime();
  const exact = opportunities.filter(opportunity =>
    opportunity.expiresAt > Date.now()
    && opportunity.flashLoanAmount > 0n
    && clearsStageOneCandidateOutputFloor(opportunity)
  );
  if (exact.length === 0 || !isCurrentChainScanGeneration(chain, generation)) return;

  // Stage One ranks a market, not thousands of equivalent variants. Protect the best
  // measured direction, the strongest measured opposite direction, and one hedge per
  // direction-neutral market. Every candidate in this set is already strictly > -10 BPS.
  const apeHot = selectApeStageOneHotSet(exact, 3);
  stageOneMeasuredDeferredFromHotLane += Math.max(0, exact.length - apeHot.length);

  let rescueReady = [...exact];
  try {
    const rescuedHot = await runFairZeroCapitalProfitabilityRescue({
      chain,
      provider,
      opportunities: apeHot,
      configuredRoutes: executionRoutes(target),
      fromQuotedRoute: target.fromQuotedRoute.bind(target),
    });
    const rescuedById = new Map(rescuedHot.map(opportunity => [opportunity.id, opportunity]));
    rescueReady = exact.map(opportunity => rescuedById.get(opportunity.id) ?? opportunity);
  } catch (error) {
    logger.warn('[ZeroCapitalDiscovery] Fused profitability rescue degraded; original fresh candidates continue through canonical provider repricing', {
      component: 'CanonicalZeroCapitalDiscovery',
      chain,
      error: error instanceof Error ? error.message : String(error),
      executionAuthority: false,
      staleQuotePreserved: false,
      stageOneClassificationChanged: false,
      nonHotMeasuredCandidatesPreserved: true,
    });
  }

  // APE transformations may change economics. Re-assert the strict Stage-One boundary
  // at handoff so 100% of Stage-One outputs remain strictly above -10 BPS.
  assertDiscoveryWorkActive();
  const rescueReadyBeforeFloor = rescueReady.length;
  rescueReady = rescueReady.filter(clearsStageOneCandidateOutputFloor);
  filteredBelowStageOneFloor += Math.max(0, rescueReadyBeforeFloor - rescueReady.length);
  rescueReady = rescueReady.filter(opportunity => opportunity.expiresAt > Date.now());
  if (rescueReady.length === 0 || !isCurrentChainScanGeneration(chain, generation)) return;

  // Preserve the flash mesh as the first measured capital-source path. A fresh
  // flash result completes this profitability search only when exact all-in base
  // units are strictly positive. Non-profitable results remain eligible for the
  // compatible alternative-capital fallback; no arbitrary positive BPS target exists.
  const selected = await repriceZeroCapitalProviderEconomics({
    chain,
    provider,
    opportunities: rescueReady,
    context: {
      executionWallets: target.executionWallets,
      receiverManager: target.receiverManager,
      getGasFundingDecision: selectedChain => strictFunding(target, selectedChain),
      executeSetupCalls: async (selectedChain, selectedProvider, selectedWallet, _fundingMode, calls) => {
        const selectedFunding = await strictFunding(target, selectedChain as SupportedChain);
        await executeSetupCalls({
          target,
          chain: selectedChain as SupportedChain,
          provider: selectedProvider,
          wallet: selectedWallet,
          funding: selectedFunding,
          calls,
        });
      },
    },
  });
  if (!isCurrentChainScanGeneration(chain, generation)) return;
  const flashStrictPositiveIds = new Set(selected
    .filter(opportunity => opportunity.expectedProfit > 0n && Number.isFinite(opportunity.netProfitBps))
    .map(opportunity => opportunity.id));
  const flashSelectedIds = flashStrictPositiveIds;
  const remaining = rescueReady.filter(opportunity => !flashSelectedIds.has(opportunity.id));
  const alternatives = await repriceZeroCapitalAlternativeCapital({
    chain,
    provider,
    opportunities: remaining,
    executionWallets: target.executionWallets,
    getGasFundingDecision: selectedChain => strictFunding(target, selectedChain),
  }).catch(error => {
    logger.debug('[ZeroCapitalDiscovery] Alternative atomic-capital fallback failed closed without disturbing strictly-profitable flash-provider selection', {
      component: 'CanonicalZeroCapitalDiscovery',
      chain,
      error: error instanceof Error ? error.message : String(error),
      flashProviderSelectionsObserved: selected.length,
      flashProviderStrictPositiveSelections: flashStrictPositiveIds.size,
      nonProfitableFlashCandidatesRemainFallbackEligible: true,
      executionAuthority: false,
    });
    return [] as ZeroCapitalOpportunity[];
  });
  if (!isCurrentChainScanGeneration(chain, generation)) return;
  repriced += selected.length + alternatives.length;
}

async function runChainScanWithWatchdog(
  chain: SupportedChain,
  provider: providers.JsonRpcProvider,
): Promise<void> {
  const existing = chainScanTasks.get(chain);
  if (existing) {
    logger.debug('[ZeroCapitalDiscovery] Prior chain scan is still isolated behind its watchdog; duplicate scan suppressed', {
      component: 'CanonicalZeroCapitalDiscovery', chain, executionAuthority: false,
    });
    return;
  }

  const generation = nextChainScanGeneration(chain);
  let tracked: Promise<void>;
  tracked = runDiscoveryWork(`zero-capital ${chain} chain scan`, chainScanWatchdogMs(),
    () => scanOneChain(chain, discoveryProvider(provider), generation), lifecycleController?.signal).finally(() => {
    if (chainScanTasks.get(chain) === tracked) chainScanTasks.delete(chain);
  });
  chainScanTasks.set(chain, tracked);

  try {
    await tracked;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && error.message.includes('deadline exceeded')) {
      chainWatchdogExpirations++;
      invalidateChainScanGeneration(chain, generation);
      if (chainScanTasks.get(chain) === tracked) chainScanTasks.delete(chain);
    }
    logger.warn('[ZeroCapitalDiscovery] Chain scan isolated after bounded failure; other chains and future cycles continue', {
      component: 'CanonicalZeroCapitalDiscovery',
      chain,
      error: message,
      chainWatchdogExpirations,
      duplicateScanSuppressedWhilePending: true,
      timedOutScanOwnershipReleased: error instanceof Error && error.message.includes('deadline exceeded'),
      lateTimedOutScanGenerationInvalidated: error instanceof Error && error.message.includes('deadline exceeded'),
      executionAuthority: false,
    });
  }
}

async function cycle(): Promise<void> {
  const target = runtime();
  try {
    refreshReceiverFleetForCycle(target);
    // Per-chain ownership suppresses overlap. A stalled chain must not stretch
    // every healthy chain's next scan from milliseconds to its 45-second watchdog.
    for (const [chain, provider] of target.providers.entries()) {
      void runChainScanWithWatchdog(chain, provider).catch(error => {
        logger.warn('[ZeroCapitalDiscovery] Chain dispatch failed', {
          component: 'CanonicalZeroCapitalDiscovery', chain,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    lastCycleAt = Date.now();
    lastError = null;
  } catch (error) {
    lastCycleAt = Date.now();
    lastError = error instanceof Error ? error.message : String(error);
    logger.error('[ZeroCapitalDiscovery] Canonical discovery cycle failed without granting execution authority', {
      component: 'CanonicalZeroCapitalDiscovery', error: lastError,
    });
  }
}

function schedule(): void {
  if (!started || process.env.NO_INTERVALS === 'true') return;
  timer = setTimeout(() => {
    timer = null;
    cycleInFlight = cycle().finally(() => { cycleInFlight = null; schedule(); });
  }, scanDelayMs());
  timer.unref?.();
}

export async function startCanonicalZeroCapitalDiscovery(): Promise<void> {
  const guard = captureCryptoCrawlerWorkGuard();
  guard();
  if (startingTask) await startingTask;
  guard();
  if (started) return;
  // A stopped generation may still be unwinding a cancelled scan. Wait for it,
  // then start this generation instead of treating that stale promise as ON.
  if (cycleInFlight) await cycleInFlight.catch(() => undefined);
  guard();
  if (started) return;
  const controller = new AbortController();
  lifecycleController = controller;
  const initializing = zeroCapitalEngine.initialize(controller.signal);
  startingTask = initializing;
  try { await initializing; }
  finally { if (startingTask === initializing) startingTask = null; }
  guard();
  if (controller.signal.aborted || lifecycleController !== controller) throw new Error('Zero-capital startup cancelled');
  started = true;
  cycleInFlight = cycle().finally(() => { cycleInFlight = null; schedule(); });
  await cycleInFlight;
  logger.info('[ZeroCapitalDiscovery] Canonical zero-capital discovery started', {
    component: 'CanonicalZeroCapitalDiscovery',
    routeAuthority: 'zero_capital_route_authority',
    executionAuthority: false,
    schedulerAuthority: false,
    eligibilityAuthority: 'fair_measured_rescue_then_canonical_flash_first_then_measured_alternative_capital_repricing',
    gasFundingAuthority: 'getProvenZeroCapitalGasFundingDecision',
    receiverSetupAuthority: 'canonical_discovery_resource_stage_with_system_owned_native_reservations',
    compositeReceiverSetupAuthority: 'route_local_additive_zero_operator_capital_lane',
    compositeReceiverFailureDemotesStandalone: false,
    alternativeCapitalAuthority: 'configured_onchain_intermediary_exact_simulation_only',
    alternativeCapitalDoesNotDisplaceStrictPositiveFlashSelection: true,
    nonProfitableFlashSelectionCompletesProfitabilitySearch: false,
    stageOneCandidateFloorBps: STAGE_ONE_ZERO_CAPITAL_OUTPUT_FLOOR_BPS,
    stageOneCandidateComparator: 'netProfitBps > -10',
    stageOneBelowFloorPromoted: false,
    stageOneAtFloorPromoted: false,
    rawBelowFloorRouteEvidencePreserved: true,
    stageOneAdmission: 'fresh_finite_exact_measurement_strictly_above_negative_10_bps',
    stageOneHotLane: 'direction_neutral_market_best_reverse_and_hedge_within_strict_floor',
    stageOneExplorationAtOrBelowFloor: 'raw_evidence_only',
    stageOneProvidesApeDiscoveryEvidence: true,
    stageOneLock: 'explicit_operator_authorization_required',
    profitabilityFinishLine: 'strict_positive_all_in_base_units',
    bpsAuthority: 'measured_candidate_registry',
    receiverFleetWatchdogMs: receiverFleetWatchdogMs(),
    chainScanWatchdogMs: chainScanWatchdogMs(),
    degradedReceiverCycleMode: 'chain_local_admission_provider_repricing_continues',
    globalReceiverFailureBlocksProviderAdmission: false,
    duplicateHungTaskSuppression: true,
    timedOutChainScanOwnershipReleased: true,
    lateTimedOutScanGenerationInvalidated: true,
    configuredAndDynamicMeasurementParallel: true,
    dynamicGraphlessDiscovery: true,
    runtimeMethodMutation: false,
    startupRetryableAfterInitializationFailure: true,
  });
}

export function stopCanonicalZeroCapitalDiscovery(): void {
  started = false;
  lifecycleController?.abort(new Error('CryptoCrawler stopped'));
  lifecycleController = null;
  startingTask = null;
  stopZeroCapitalQuoteTracking();
  if (timer) clearTimeout(timer);
  timer = null;
  for (const [chain, generation] of chainScanGenerations.entries()) {
    chainScanGenerations.set(chain, generation + 1);
  }
  chainScanTasks.clear();
}

export function getCanonicalZeroCapitalDiscoverySnapshot() {
  return {
    started,
    cycleInFlight: Boolean(cycleInFlight),
    lastCycleAt,
    lastError,
    lastObservationOnlyReason,
    observed,
    repriced,
    filteredBelowStageOneFloor,
    stageOneMeasuredDeferredFromHotLane,
    stageOneCandidateFloorBps: STAGE_ONE_ZERO_CAPITAL_OUTPUT_FLOOR_BPS,
    stageOneCandidateComparator: 'netProfitBps > -10',
    stageOneBelowFloorPromoted: false,
    stageOneAtFloorPromoted: false,
    rawBelowFloorRouteEvidencePreserved: true,
    stageOneAdmission: 'fresh_finite_exact_measurement_strictly_above_negative_10_bps',
    stageOneHotLane: 'direction_neutral_market_best_reverse_and_hedge_within_strict_floor',
    stageOneProvidesApeDiscoveryEvidence: true,
    stageOneLock: 'explicit_operator_authorization_required',
    profitabilityFinishLine: 'strict_positive_all_in_base_units',
    readyReceiverChains,
    receiverWatchdogExpirations,
    chainWatchdogExpirations,
    observationOnlyCycles,
    receiverFleetTaskPending: Boolean(receiverFleetTask),
    isolatedChainScansPending: chainScanTasks.size,
    chainScanGenerationByChain: Object.fromEntries(chainScanGenerations.entries()),
    timedOutChainScanOwnershipReleased: true,
    lateTimedOutScanGenerationInvalidated: true,
    globalReceiverFailureBlocksProviderAdmission: false,
    compositeReceiverFailureDemotesStandalone: false,
  };
}
