import { BigNumber, type Wallet, type providers } from 'ethers';
import logger from '../../../logger.js';
import { zeroCapitalEngine, type SupportedChain, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { DynamicChainConfig } from '../core/dynamic-chain-registry.js';
import { discoverDynamicZeroCapitalQuotes } from './dynamic-zero-capital-routes.js';
import { measuredCandidateRegistry } from './measured-candidate-registry.js';
import { getCanonicalZeroCapitalRoutes } from './zero-capital-route-authority.js';
import {
  zeroCapitalDiscoveryFloorBps,
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
import { zeroCapitalRouteEvidenceRegistry } from '../optimization/zero-capital-route-evidence-registry.js';
import { getProvenZeroCapitalGasFundingDecision } from '../runtime/system-owned-gas-funding-proof-wiring.js';
import { executeSystemOwnedNativeTransaction } from '../execution/system-owned-native-transaction.js';

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
    }) => Promise<Array<{ to: string; data: string; value?: string | number | BigNumber }>>;
  };
  scanChain: (chain: SupportedChain, provider: providers.JsonRpcProvider) => Promise<ZeroCapitalOpportunity[]>;
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
}

class DiscoveryWatchdogTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} watchdog expired after ${timeoutMs}ms`);
    this.name = 'DiscoveryWatchdogTimeoutError';
  }
}

let started = false;
let timer: NodeJS.Timeout | null = null;
let cycleInFlight: Promise<void> | null = null;
let receiverFleetTask: Promise<void> | null = null;
let receiverFleetTimedOut = false;
const chainScanTasks = new Map<SupportedChain, Promise<void>>();
let lastCycleAt = 0;
let lastError: string | null = null;
let lastObservationOnlyReason: string | null = null;
let observed = 0;
let repriced = 0;
let readyReceiverChains = 0;
let receiverWatchdogExpirations = 0;
let chainWatchdogExpirations = 0;
let observationOnlyCycles = 0;

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
  return getProvenZeroCapitalGasFundingDecision(target, chain);
}

async function executeSetupCalls(input: {
  target: CanonicalZeroCapitalRuntime;
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  funding: GasFundingDecision;
  calls: Array<{ to: string; data: string; value?: string | number | BigNumber }>;
}): Promise<void> {
  if (input.funding.strictZeroInitialCapitalEligible !== true || input.funding.operatorMonetaryInputRequired !== false) {
    throw new Error(`Strict zero-capital setup funding is unavailable: ${input.funding.reason}`);
  }
  if (input.funding.mode === 'sponsored') {
    if (input.funding.paymentSource !== 'provider_sponsored') throw new Error('Unproven sponsored setup payment source');
    const network = await input.provider.getNetwork();
    await input.target.gasSponsor.execute({
      wallet: input.wallet,
      chainId: network.chainId,
      calls: input.calls.map(call => ({ to: call.to, data: call.data, value: BigNumber.from(call.value || 0) })),
      timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_SETUP_TIMEOUT_MS || 90_000)),
    });
    return;
  }
  if (input.funding.mode !== 'native' || input.funding.paymentSource !== 'system_owned_native') {
    throw new Error(`Strict zero-capital setup has no proven system-owned gas path: ${input.funding.reason}`);
  }
  for (let index = 0; index < input.calls.length; index += 1) {
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
  for (const chain of chains) {
    const provider = target.providers.get(chain);
    const wallet = target.executionWallets.get(chain);
    if (!provider || !wallet) { failures.push(`${chain}:provider_or_wallet_unavailable`); continue; }
    try {
      const funding = await strictFunding(target, chain);
      if (funding.mode === 'unavailable') throw new Error(funding.reason);
      const receiver = await target.receiverManager.ensureReceiver({
        chain: chain as any,
        provider,
        wallet,
        fundingMode: funding.mode as ReceiverFundingMode,
      });
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
      ready++;
    } catch (error) {
      failures.push(`${chain}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  readyReceiverChains = ready;
  if (ready === 0 && chains.length > 0) {
    logger.debug('[ZeroCapitalDiscovery] No strict zero-capital receiver chain is execution-ready; discovery remains active', {
      component: 'CanonicalZeroCapitalDiscovery', failures, executionAuthority: false,
    });
  } else if (failures.length > 0) {
    logger.debug('[ZeroCapitalDiscovery] Receiver fleet is partially ready; failed chains remain discovery-only', {
      component: 'CanonicalZeroCapitalDiscovery', readyReceiverChains: ready, failures,
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
    bpsToBreakEven: quote?.bpsToBreakEven ?? (netProfitBps >= 0 ? 0 : Math.abs(netProfitBps)),
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

  zeroCapitalRouteEvidenceRegistry.record(opportunity);
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
      executable: false,
      provenance: ['direct_contract_quote', 'provider_selection_pending'],
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
      positive ? 'deterministic_positive_net' : 'near_break_even_observation_only',
      'synthetic_evidence:false',
    ],
  });
  observed++;
}

async function scanOneChain(
  chain: SupportedChain,
  provider: providers.JsonRpcProvider,
): Promise<void> {
  if (chain === 'europa') return;
  const target = runtime();
  const funding = await strictFunding(target, chain);
  const receiverReady = Boolean(target.receiverManager.getReceiver(chain));
  const resourceReady = funding.mode !== 'unavailable'
    && funding.strictZeroInitialCapitalEligible === true
    && funding.operatorMonetaryInputRequired === false
    && receiverReady;
  const resourceReason = funding.mode === 'unavailable'
    ? funding.reason
    : receiverReady ? funding.reason : 'verified_execution_receiver_unavailable';

  const configured = await target.scanChain(chain, provider).catch(error => {
    logger.warn('[ZeroCapitalDiscovery] Configured-route measurement degraded', {
      component: 'CanonicalZeroCapitalDiscovery', chain,
      error: error instanceof Error ? error.message : String(error),
    });
    return [] as ZeroCapitalOpportunity[];
  });
  for (const opportunity of configured) {
    recordPreselectionCandidate({ opportunity, source: 'configured', resourceReady, resourceReason });
  }

  const dynamicQuotes = await discoverDynamicZeroCapitalQuotes(chain, provider, funding.mode).catch(error => {
    logger.warn('[ZeroCapitalDiscovery] Dynamic graphless measurement degraded', {
      component: 'CanonicalZeroCapitalDiscovery', chain,
      error: error instanceof Error ? error.message : String(error),
    });
    return [] as QuotedZeroCapitalRoute[];
  });
  const block = dynamicQuotes.length > 0 ? await provider.getBlock('latest') : null;
  const dynamic: ZeroCapitalOpportunity[] = [];
  for (const quote of dynamicQuotes) {
    const opportunity = target.fromQuotedRoute(quote, block?.timestamp || Math.floor(Date.now() / 1000));
    if (quote.id.startsWith('graphless-')) {
      const ttl = Math.max(500, Math.min(3000, Number(process.env.ZERO_CAPITAL_GRAPHLESS_ROUTE_TTL_MS || 1500)));
      opportunity.expiresAt = Math.min(opportunity.expiresAt, Date.now() + ttl);
    }
    recordPreselectionCandidate({ opportunity, quote, source: 'dynamic', resourceReady, resourceReason });
    dynamic.push(opportunity);
  }

  const exact = [...configured, ...dynamic].filter(opportunity => opportunity.expiresAt > Date.now());
  if (exact.length === 0) return;

  const rescueReady = await runFairZeroCapitalProfitabilityRescue({
    chain,
    provider,
    opportunities: exact,
    configuredRoutes: executionRoutes(target),
    fromQuotedRoute: target.fromQuotedRoute,
  }).catch(error => {
    logger.warn('[ZeroCapitalDiscovery] Fair profitability rescue degraded; original fresh candidates continue through canonical provider repricing', {
      component: 'CanonicalZeroCapitalDiscovery',
      chain,
      error: error instanceof Error ? error.message : String(error),
      executionAuthority: false,
      staleQuotePreserved: false,
    });
    return exact;
  });
  if (rescueReady.length === 0) return;

  // Preserve the existing flash mesh as first authority. Alternative capital sees
  // only opportunities the existing mesh did not make executable, so a working
  // provider path can never be displaced by this extension.
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
  const flashSelectedIds = new Set(selected.map(opportunity => opportunity.id));
  const remaining = rescueReady.filter(opportunity => !flashSelectedIds.has(opportunity.id));
  const alternatives = await repriceZeroCapitalAlternativeCapital({
    chain,
    provider,
    opportunities: remaining,
    executionWallets: target.executionWallets,
    getGasFundingDecision: selectedChain => strictFunding(target, selectedChain),
  }).catch(error => {
    logger.debug('[ZeroCapitalDiscovery] Alternative atomic-capital fallback failed closed without disturbing flash-provider selection', {
      component: 'CanonicalZeroCapitalDiscovery',
      chain,
      error: error instanceof Error ? error.message : String(error),
      flashProviderSelectionsPreserved: selected.length,
      executionAuthority: false,
    });
    return [] as ZeroCapitalOpportunity[];
  });
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

  let tracked: Promise<void>;
  tracked = scanOneChain(chain, provider).finally(() => {
    if (chainScanTasks.get(chain) === tracked) chainScanTasks.delete(chain);
  });
  chainScanTasks.set(chain, tracked);

  try {
    await withWatchdog(tracked, chainScanWatchdogMs(), `zero-capital ${chain} chain scan`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof DiscoveryWatchdogTimeoutError) chainWatchdogExpirations++;
    logger.warn('[ZeroCapitalDiscovery] Chain scan isolated after bounded failure; other chains and future cycles continue', {
      component: 'CanonicalZeroCapitalDiscovery',
      chain,
      error: message,
      chainWatchdogExpirations,
      duplicateScanSuppressedWhilePending: true,
      executionAuthority: false,
    });
  }
}

async function cycle(): Promise<void> {
  const target = runtime();
  try {
    refreshReceiverFleetForCycle(target);
    await Promise.allSettled([...target.providers.entries()].map(([chain, provider]) =>
      runChainScanWithWatchdog(chain, provider),
    ));
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
  if (started || cycleInFlight) return;
  await zeroCapitalEngine.initialize();
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
    alternativeCapitalAuthority: 'configured_onchain_intermediary_exact_simulation_only',
    alternativeCapitalDoesNotDisplaceWorkingFlashSelection: true,
    bpsAuthority: 'measured_candidate_registry',
    receiverFleetWatchdogMs: receiverFleetWatchdogMs(),
    chainScanWatchdogMs: chainScanWatchdogMs(),
    degradedReceiverCycleMode: 'chain_local_admission_provider_repricing_continues',
    globalReceiverFailureBlocksProviderAdmission: false,
    duplicateHungTaskSuppression: true,
    dynamicGraphlessDiscovery: true,
    runtimeMethodMutation: false,
    startupRetryableAfterInitializationFailure: true,
  });
}

export function stopCanonicalZeroCapitalDiscovery(): void {
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
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
    readyReceiverChains,
    receiverWatchdogExpirations,
    chainWatchdogExpirations,
    observationOnlyCycles,
    receiverFleetTaskPending: Boolean(receiverFleetTask),
    isolatedChainScansPending: chainScanTasks.size,
    globalReceiverFailureBlocksProviderAdmission: false,
  };
}