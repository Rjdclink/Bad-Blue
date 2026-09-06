import type { Wallet, providers } from 'ethers';
import logger from '../../../logger.js';
import { zeroCapitalEngine, type SupportedChain, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import {
  discoverDynamicZeroCapitalQuotes,
} from './dynamic-zero-capital-routes.js';
import { measuredCandidateRegistry } from './measured-candidate-registry.js';
import { zeroCapitalDiscoveryFloorBps, type QuotedZeroCapitalRoute } from '../execution/adapters/onchain-route-quoter.js';
import type { SponsoredReceiverRecord, ReceiverFundingMode } from '../execution/adapters/sponsored-receiver-manager.js';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import { repriceZeroCapitalProviderEconomics } from '../integration/zero-capital-flash-provider-wiring.js';
import { zeroCapitalRouteEvidenceRegistry } from '../optimization/zero-capital-route-evidence-registry.js';

interface CanonicalZeroCapitalRuntime {
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
  receiverManager: {
    getReceiver: (chain: string) => string | null;
    getRecords: () => SponsoredReceiverRecord[];
  };
  scanChain: (chain: SupportedChain, provider: providers.JsonRpcProvider) => Promise<ZeroCapitalOpportunity[]>;
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
  getGasFundingDecision: (chain: SupportedChain) => Promise<GasFundingDecision>;
  ensureExecutionReceiverFleet: () => Promise<void>;
  refreshSponsorshipReadiness: () => Promise<unknown>;
  executeSetupCalls: (
    chain: any,
    provider: providers.JsonRpcProvider,
    wallet: Wallet,
    fundingMode: ReceiverFundingMode,
    calls: any[],
  ) => Promise<void>;
}

let started = false;
let timer: NodeJS.Timeout | null = null;
let cycleInFlight: Promise<void> | null = null;
let lastCycleAt = 0;
let lastError: string | null = null;
let observed = 0;
let repriced = 0;

function runtime(): CanonicalZeroCapitalRuntime {
  return zeroCapitalEngine as unknown as CanonicalZeroCapitalRuntime;
}

function scanDelayMs(): number {
  const raw = Number(process.env.ZERO_CAPITAL_SCAN_MIN_MS || 2500);
  return Number.isFinite(raw) ? Math.max(500, Math.min(15_000, Math.trunc(raw))) : 2500;
}

function baseUnitsToUsd(value: bigint | undefined, decimals: number): number {
  if (value === undefined) return 0;
  const divisor = 10 ** Math.max(0, Math.min(18, decimals));
  const converted = Number(value) / divisor;
  return Number.isFinite(converted) ? converted : 0;
}

function bpsFromBaseUnits(value: bigint | undefined, notional: bigint): number | null {
  if (value === undefined || notional <= 0n) return null;
  return Number((value * 10_000n) / notional);
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
  // Explicitly revoke an earlier provider selection before the exact current quote
  // is re-evaluated. Provider repricing below is the sole eligibility promotion.
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
        ? 'Deterministic-positive exact quote awaits the sole canonical flash-provider/receiver repricing stage'
        : `Deterministic-positive exact quote is resource-blocked before provider selection: ${input.resourceReason}`
      : `Measured route is ${opportunity.netProfitBps} BPS net and remains observation-only for measured provider-cost optimization`,
    missingInformation: positive && !input.resourceReady ? ['zero_personal_cost_execution_resource'] : [],
    provenance: [
      input.source === 'dynamic' ? 'dynamic_zero_capital_route' : 'configured_zero_capital_route',
      'direct_contract_quotes',
      'measured_all_in_economics',
      'exact_route_evidence:zero_capital_route_evidence_registry',
      'flash_premium_attribution:flashLoanFeeBps_only',
      'quoted_amount_out_embeds_current_route_economics',
      'min_output_tolerance_not_expected_slippage_cost',
      'eligibility_authority:canonical_provider_repricing_stage_only',
      positive ? 'deterministic_positive_net' : 'near_break_even_observation_only',
      'synthetic_evidence:false',
    ],
  });
  observed++;
}

async function scanOneChain(chain: SupportedChain, provider: providers.JsonRpcProvider): Promise<void> {
  if (chain === 'europa') return;
  const target = runtime();
  const funding = await target.getGasFundingDecision(chain);
  const receiverReady = Boolean(target.receiverManager.getReceiver(chain));
  const resourceReady = funding.mode !== 'unavailable' && receiverReady;
  const resourceReason = funding.mode === 'unavailable'
    ? funding.reason
    : receiverReady ? 'resource_ready' : 'verified_execution_receiver_unavailable';

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
  const selected = await repriceZeroCapitalProviderEconomics({
    chain,
    provider,
    opportunities: exact,
    context: {
      executionWallets: target.executionWallets,
      receiverManager: target.receiverManager,
      getGasFundingDecision: target.getGasFundingDecision.bind(target),
      executeSetupCalls: target.executeSetupCalls.bind(target),
    },
  });
  repriced += selected.length;
}

async function cycle(): Promise<void> {
  const target = runtime();
  try {
    await target.ensureExecutionReceiverFleet().catch(error => {
      logger.debug('[ZeroCapitalDiscovery] Receiver/resource fleet remains locally degraded', {
        component: 'CanonicalZeroCapitalDiscovery',
        error: error instanceof Error ? error.message : String(error),
        discoveryContinues: true,
      });
    });
    await target.refreshSponsorshipReadiness().catch(() => undefined);
    await Promise.allSettled([...target.providers.entries()].map(([chain, provider]) => scanOneChain(chain, provider)));
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
  if (started) return;
  started = true;
  await zeroCapitalEngine.initialize();
  cycleInFlight = cycle().finally(() => { cycleInFlight = null; schedule(); });
  await cycleInFlight;
  logger.info('[ZeroCapitalDiscovery] Canonical zero-capital discovery started', {
    component: 'CanonicalZeroCapitalDiscovery',
    executionAuthority: false,
    schedulerAuthority: false,
    eligibilityAuthority: 'canonical_provider_repricing_stage_only',
    bpsAuthority: 'measured_candidate_registry',
    dynamicGraphlessDiscovery: true,
    runtimeMethodMutation: false,
  });
}

export function stopCanonicalZeroCapitalDiscovery(): void {
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

export function getCanonicalZeroCapitalDiscoverySnapshot() {
  return { started, cycleInFlight: Boolean(cycleInFlight), lastCycleAt, lastError, observed, repriced };
}
