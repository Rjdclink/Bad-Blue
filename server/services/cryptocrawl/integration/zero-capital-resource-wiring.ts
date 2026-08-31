import type { Wallet, providers } from 'ethers';
import logger from '../../../logger.js';
import {
  zeroCapitalEngine,
  type SupportedChain,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import {
  buildDynamicZeroCapitalRouteTemplates,
  discoverDynamicZeroCapitalQuotes,
  getCachedGraphlessDynamicRouteTemplates,
} from '../discovery/dynamic-zero-capital-routes.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from '../execution/adapters/autonomous-route-planner.js';
import { buildFlashLoanReceiverPayloadFromPlan } from '../execution/adapters/flashloan-receiver-builder.js';
import {
  zeroCapitalDiscoveryFloorBps,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import {
  supportsSponsoredReceiverChain,
  type ReceiverFundingMode,
  type SponsoredReceiverRecord,
} from '../execution/adapters/sponsored-receiver-manager.js';
import { zeroCapitalResourceScheduler } from '../execution/zero-capital-resource-scheduler.js';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';

const installed = new WeakSet<object>();

type ZeroCapitalRuntime = {
  configuredRoutes: ConfiguredZeroCapitalRoute[];
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
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
    }) => Promise<any[]>;
  };
  state: {
    activeExecutions: number;
    activeExecutionChains: SupportedChain[];
    receiverRegistry: SponsoredReceiverRecord[];
    gasFundingDecisions: GasFundingDecision[];
    currentOpportunities: number;
    maxConcurrentExecutions: number;
  };
  executionEligible: boolean;
  executionEnabled: boolean;
  opportunityQueue: ZeroCapitalOpportunity[];
  activeExecutionIds: Set<string>;
  activeExecutionKeys: Set<string>;
  activeExecutionsByChain: Map<SupportedChain, number>;
  maxConcurrentExecutions: number;
  scanChain: (chain: SupportedChain, provider: providers.JsonRpcProvider) => Promise<ZeroCapitalOpportunity[]>;
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
  isAllowedByCryptara: (opportunity: ZeroCapitalOpportunity) => Promise<boolean>;
  getGasFundingDecision: (chain: SupportedChain) => Promise<GasFundingDecision>;
  refreshGasFundingDecisions: () => Promise<GasFundingDecision[]>;
  ensureExecutionReceiverFleet: () => Promise<void>;
  executeSetupCalls: (
    chain: any,
    provider: providers.JsonRpcProvider,
    wallet: Wallet,
    fundingMode: ReceiverFundingMode,
    calls: any[],
  ) => Promise<void>;
  executionKey: (opportunity: ZeroCapitalOpportunity) => string;
  chainExecutionCount: (chain: SupportedChain) => number;
  dispatchExecutableOpportunities: () => Promise<void>;
  executeAndRecord: (opportunity: ZeroCapitalOpportunity) => Promise<void>;
  syncExecutionTelemetry: () => void;
};

function dynamicRoutesForRuntime(target: ZeroCapitalRuntime): ConfiguredZeroCapitalRoute[] {
  return [...target.providers.keys()].flatMap(chain => buildDynamicZeroCapitalRouteTemplates(chain));
}

function executionRoutes(target: ZeroCapitalRuntime): ConfiguredZeroCapitalRoute[] {
  const byId = new Map<string, ConfiguredZeroCapitalRoute>();
  for (const route of [
    ...target.configuredRoutes,
    ...dynamicRoutesForRuntime(target),
    ...getCachedGraphlessDynamicRouteTemplates(),
  ]) byId.set(route.id, route);
  return [...byId.values()];
}

function activeChainCount(target: ZeroCapitalRuntime, chain: SupportedChain): number {
  return target.activeExecutionsByChain.get(chain) || 0;
}

function baseUnitsToUsd(value: bigint, decimals: number): number {
  const divisor = 10 ** Math.max(0, Math.min(18, decimals));
  const result = Number(value) / divisor;
  return Number.isFinite(result) ? result : 0;
}

function bpsFromBaseUnits(value: bigint | undefined, notional: bigint): number | null {
  if (value === undefined || notional <= 0n) return null;
  return Number((value * 10_000n) / notional);
}

function zeroCapitalEconomics(
  opportunity: ZeroCapitalOpportunity,
  quote?: QuotedZeroCapitalRoute,
) {
  const notional = opportunity.flashLoanAmount;
  const grossProfitBps = quote?.grossProfitBps ?? bpsFromBaseUnits(opportunity.grossProfit, notional);
  const flashLoanFeeBps = bpsFromBaseUnits(opportunity.flashLoanFeeInInputToken, notional);
  const gasCostBps = bpsFromBaseUnits(opportunity.estimatedGasCostInInputToken, notional);
  const relayCostBps = bpsFromBaseUnits(opportunity.relayFeeInInputToken, notional);
  const allInCostBps = quote?.allInCostBps ?? bpsFromBaseUnits(opportunity.estimatedExecutionCostInInputToken, notional);
  const netProfitBps = quote?.netProfitBps ?? opportunity.netProfitBps;
  return {
    grossProfitUsd: baseUnitsToUsd(opportunity.grossProfit || 0n, opportunity.inputTokenDecimals),
    deterministicNetProfitUsd: baseUnitsToUsd(opportunity.expectedProfit, opportunity.inputTokenDecimals),
    feeUsd: baseUnitsToUsd(opportunity.flashLoanFeeInInputToken || 0n, opportunity.inputTokenDecimals),
    gasUsd: baseUnitsToUsd(opportunity.estimatedGasCostInInputToken || 0n, opportunity.inputTokenDecimals),
    bridgeUsd: 0,
    expectedSlippageBps: opportunity.expectedSlippageBps,
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

function recordZeroCapitalCandidate(input: {
  opportunity: ZeroCapitalOpportunity;
  chain: SupportedChain;
  source: 'configured' | 'dynamic';
  quote?: QuotedZeroCapitalRoute;
  executableCapability: boolean;
  executionCapabilityReason: string;
  missingInformation?: string[];
  simulationReady?: boolean;
}): void {
  const { opportunity, chain, source, quote } = input;
  const positive = opportunity.expectedProfit > 0n && (quote?.executablePositive ?? true);
  measuredCandidateRegistry.record({
    opportunityId: opportunity.id,
    topology: 'ZERO_CAPITAL_ATOMIC',
    observedAt: opportunity.timestamp,
    expiresAt: opportunity.expiresAt,
    status: positive ? 'deterministic_positive' : 'enriched',
    assets: [opportunity.inputAssetSymbol],
    venues: [...new Set(opportunity.route.map(step => step.protocol))],
    chains: [chain],
    rawQuotes: opportunity.route.map(step => ({
      source: step.protocol,
      venue: step.protocol,
      chain,
      observedAt: opportunity.timestamp,
      amountIn: step.amountIn.toString(),
      amountOut: step.expectedAmountOut.toString(),
      executable: positive && input.executableCapability,
      provenance: ['direct_contract_quote'],
    })),
    depth: {
      status: 'measured',
      detail: 'Each route leg was retained only after a live contract/router quote returned a usable output amount',
    },
    economics: zeroCapitalEconomics(opportunity, quote),
    quoteAgeMs: opportunity.quoteLatencyMs,
    executableCapability: positive && input.executableCapability,
    executionCapabilityReason: input.executionCapabilityReason,
    missingInformation: input.missingInformation || [],
    provenance: [
      source === 'dynamic' ? 'dynamic_zero_capital_route' : 'configured_zero_capital_route',
      opportunity.id.startsWith('graphless-') ? 'graphless_no_key_discovery' : 'stable_seed_discovery',
      'direct_contract_quotes',
      'measured_all_in_economics',
      ...(input.simulationReady && opportunity.id.startsWith('graphless-') ? ['exact_receiver_call_simulation'] : []),
      positive ? 'deterministic_positive_net' : 'near_break_even_observation_only',
      'synthetic_evidence:false',
    ],
  });
}

async function prepareGraphlessPermissions(
  target: ZeroCapitalRuntime,
  chain: SupportedChain,
  provider: providers.JsonRpcProvider,
  positiveRouteIds: Set<string>,
): Promise<Set<string>> {
  const eligible = new Set(positiveRouteIds);
  if (!target.executionEnabled || positiveRouteIds.size === 0) return eligible;
  const graphless = getCachedGraphlessDynamicRouteTemplates(chain as any)
    .filter(route => positiveRouteIds.has(route.id));
  if (graphless.length === 0) return eligible;

  const receiver = target.receiverManager.getReceiver(chain);
  const wallet = target.executionWallets.get(chain);
  if (!receiver || !wallet) {
    for (const route of graphless) eligible.delete(route.id);
    return eligible;
  }

  try {
    const funding = await target.getGasFundingDecision(chain);
    if (funding.mode === 'unavailable') throw new Error(funding.reason);
    const calls = await target.receiverManager.buildMissingPermissionCalls({
      chain: chain as any,
      receiver,
      provider,
      routes: graphless,
    });
    if (calls.length > 0) {
      await target.executeSetupCalls(chain as any, provider, wallet, funding.mode as ReceiverFundingMode, calls);
      for (const route of graphless) eligible.delete(route.id);
    }
    logger.info('[ZeroCapitalWiring] Graphless positive-route permissions checked', {
      component: 'ZeroCapitalResourceWiring',
      chain,
      routes: graphless.length,
      permissionCalls: calls.length,
      fundingMode: funding.mode,
      onlyPositiveRoutesPrepared: true,
      requiresFreshRequote: calls.length > 0,
    });
  } catch (error) {
    for (const route of graphless) eligible.delete(route.id);
    logger.warn('[ZeroCapitalWiring] Graphless route permissions failed closed', {
      component: 'ZeroCapitalResourceWiring',
      chain,
      routes: graphless.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return eligible;
}

async function simulateGraphlessAtomicOpportunity(
  target: ZeroCapitalRuntime,
  chain: SupportedChain,
  provider: providers.JsonRpcProvider,
  opportunity: ZeroCapitalOpportunity,
): Promise<{ ready: boolean; reason: string }> {
  if (!opportunity.id.startsWith('graphless-')) return { ready: true, reason: 'existing_route' };
  if (!target.executionEnabled) return { ready: false, reason: 'execution_not_enabled_for_exact_simulation' };
  const receiver = target.receiverManager.getReceiver(chain);
  const wallet = target.executionWallets.get(chain);
  if (!receiver || !wallet) return { ready: false, reason: 'receiver_or_wallet_unavailable' };
  if (Date.now() > opportunity.expiresAt) return { ready: false, reason: 'opportunity_expired_before_simulation' };

  try {
    const plan = buildFlashLoanExecutionPlanFromOpportunity(opportunity, {
      receiver,
      profitRecipient: process.env.CRYPTO_PROFIT_WALLET_ADDRESS || process.env.BRIDGE_WALLET_ADDRESS || wallet.address,
      nowMs: Date.now(),
    });
    const payload = buildFlashLoanReceiverPayloadFromPlan(plan);
    await provider.call({
      from: wallet.address,
      to: payload.to,
      data: payload.data,
      value: payload.value,
    });
    if (Date.now() > opportunity.expiresAt) return { ready: false, reason: 'opportunity_expired_during_simulation' };
    return { ready: true, reason: 'exact_receiver_call_succeeded' };
  } catch (error) {
    return { ready: false, reason: `exact_receiver_call_failed:${error instanceof Error ? error.message : String(error)}` };
  }
}

export function ensureZeroCapitalResourceWiring(): void {
  const target = zeroCapitalEngine as unknown as ZeroCapitalRuntime;
  if (installed.has(target)) return;
  installed.add(target);

  const originalScanChain = target.scanChain.bind(target);
  target.scanChain = async (chain, provider): Promise<ZeroCapitalOpportunity[]> => {
    const configured = await originalScanChain(chain, provider).catch(error => {
      logger.warn('[ZeroCapitalWiring] Configured route scan degraded', {
        component: 'ZeroCapitalResourceWiring',
        chain,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    });
    if (chain === 'europa') return configured;

    const receiverReady = !!target.receiverManager.getReceiver(chain);
    const funding = await target.getGasFundingDecision(chain);
    const fundingReady = funding.mode !== 'unavailable';
    for (const opportunity of configured) {
      const positive = opportunity.expectedProfit > 0n;
      const executableCapability = positive && receiverReady && fundingReady;
      recordZeroCapitalCandidate({
        opportunity,
        chain,
        source: 'configured',
        executableCapability,
        executionCapabilityReason: !positive
          ? `Measured configured route is ${opportunity.netProfitBps} BPS net and retained inside the observation envelope for optimization only`
          : !fundingReady
            ? `Measured configured atomic route is deterministic-positive, but live gas funding is unavailable: ${funding.reason}`
            : receiverReady
              ? 'Measured configured atomic route is deterministic-positive with live gas funding; Cryptara/Monte Carlo/governance remain required before execution'
              : 'Measured configured atomic route is deterministic-positive, but no verified funded receiver is registered on the chain',
        missingInformation: !positive || executableCapability ? [] : [
          ...(!fundingReady ? ['live_gas_funding'] : []),
          ...(!receiverReady ? ['verified_funded_receiver'] : []),
        ],
      });
    }

    // Bind discovery economics to the same live funding authority used at
    // execution. Only an actual sponsored funding decision may zero user gas;
    // native/unavailable modes retain measured native-gas economics.
    const dynamicQuotes = await discoverDynamicZeroCapitalQuotes(chain, provider, funding.mode);
    if (dynamicQuotes.length === 0) return configured;
    const positiveRouteIds = new Set(dynamicQuotes
      .filter(quote => quote.executablePositive && quote.netProfit > 0n)
      .map(quote => quote.id));
    const permissionEligibleIds = await prepareGraphlessPermissions(target, chain, provider, positiveRouteIds);
    const block = await provider.getBlock('latest');
    const dynamic: ZeroCapitalOpportunity[] = [];
    for (const quote of dynamicQuotes) {
      const opportunity = target.fromQuotedRoute(quote, block.timestamp);
      if (quote.id.startsWith('graphless-')) {
        const graphlessTtlMs = Math.max(500, Math.min(3_000, Number(process.env.ZERO_CAPITAL_GRAPHLESS_ROUTE_TTL_MS || 1_500)));
        opportunity.expiresAt = Math.min(opportunity.expiresAt, Date.now() + graphlessTtlMs);
      }
      const positive = quote.executablePositive && opportunity.expectedProfit > 0n;
      const permissionReady = positive && permissionEligibleIds.has(quote.id);
      const simulation = positive && permissionReady
        ? await simulateGraphlessAtomicOpportunity(target, chain, provider, opportunity)
        : { ready: false, reason: positive ? 'dynamic_route_permissions_require_fresh_requote' : 'near_break_even_observation_only' };
      const exactSimulationRequired = positive && quote.id.startsWith('graphless-') && target.executionEligible;
      const simulationReady = !exactSimulationRequired || simulation.ready;
      const executableCapability = positive && fundingReady && receiverReady && permissionReady && simulationReady;
      recordZeroCapitalCandidate({
        opportunity,
        chain,
        source: 'dynamic',
        quote,
        executableCapability,
        executionCapabilityReason: !positive
          ? `Measured near-break-even route retained for optimization only; ${quote.bpsToBreakEven} BPS remains to strict positive break-even`
          : !fundingReady
            ? `Measured deterministic-positive route has no currently usable gas funding: ${funding.reason}`
            : executableCapability
              ? 'Measured atomic route has live gas funding, receiver, route permissions and required exact simulation; Cryptara/Monte Carlo/governance remain required before execution'
              : !receiverReady
                ? 'Measured deterministic-positive route has no verified funded receiver on the chain'
                : !permissionReady
                  ? 'Measured deterministic-positive route requires fresh quoting after dynamic receiver permissions'
                  : `Measured deterministic-positive route exact atomic simulation is not ready: ${simulation.reason}`,
        missingInformation: !positive || executableCapability ? [] : [
          ...(!fundingReady ? ['live_gas_funding'] : []),
          ...(!receiverReady ? ['verified_funded_receiver'] : []),
          ...(!permissionReady ? ['fresh_quote_after_dynamic_route_permissions'] : []),
          ...(permissionReady && !simulationReady ? ['exact_atomic_simulation'] : []),
        ],
        simulationReady: simulation.ready,
      });

      if (!positive) continue;
      if (target.executionEligible && !executableCapability) continue;
      if (target.executionEnabled && !await target.isAllowedByCryptara(opportunity)) continue;
      dynamic.push(opportunity);
    }

    const deduped = new Map<string, ZeroCapitalOpportunity>();
    for (const opportunity of [...configured, ...dynamic]) {
      const key = target.executionKey(opportunity);
      const previous = deduped.get(key);
      if (!previous || opportunity.expectedProfit > previous.expectedProfit) deduped.set(key, opportunity);
    }
    return [...deduped.values()];
  };

  target.refreshGasFundingDecisions = async (): Promise<GasFundingDecision[]> => {
    const chains = [...new Set(executionRoutes(target).map(route => route.chain as SupportedChain))];
    const decisions = await Promise.all(chains.map(chain => target.getGasFundingDecision(chain)));
    target.state.gasFundingDecisions = decisions;
    return decisions;
  };

  target.ensureExecutionReceiverFleet = async (): Promise<void> => {
    const routes = executionRoutes(target);
    const routeChains = [...new Set(routes.map(route => route.chain as SupportedChain))]
      .filter(chain => chain !== 'europa' && supportsSponsoredReceiverChain(chain as any));
    if (routeChains.length === 0) {
      target.state.receiverRegistry = target.receiverManager.getRecords();
      throw new Error('No measured/configured executable zero-capital route topology is available');
    }

    const results = await Promise.allSettled(routeChains.map(async chain => {
      const provider = target.providers.get(chain);
      const wallet = target.executionWallets.get(chain);
      if (!provider || !wallet) throw new Error(`No live provider/wallet for ${chain}`);
      const funding = await target.getGasFundingDecision(chain);
      if (funding.mode === 'unavailable') throw new Error(funding.reason);
      const record = await target.receiverManager.ensureReceiver({
        chain: chain as any,
        provider,
        wallet,
        fundingMode: funding.mode as ReceiverFundingMode,
      });
      const chainRoutes = routes.filter(route => route.chain === chain);
      const permissionCalls = await target.receiverManager.buildMissingPermissionCalls({
        chain: chain as any,
        receiver: record.address,
        provider,
        routes: chainRoutes,
      });
      if (permissionCalls.length > 0) {
        await target.executeSetupCalls(chain as any, provider, wallet, funding.mode as ReceiverFundingMode, permissionCalls);
      }
      return record;
    }));

    const readyChains = new Set<SupportedChain>();
    const failures: string[] = [];
    results.forEach((result, index) => {
      const chain = routeChains[index];
      if (result.status === 'fulfilled') readyChains.add(chain);
      else failures.push(`${chain}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    });
    target.state.receiverRegistry = target.receiverManager.getRecords();
    target.configuredRoutes = target.configuredRoutes.filter(route => readyChains.has(route.chain as SupportedChain));
    if (readyChains.size === 0) throw new Error(`No zero-capital route chain has a verified funded receiver: ${failures.join('; ')}`);
    if (failures.length > 0) {
      logger.warn('[ZeroCapitalWiring] Some dynamic/configured route chains are execution-ineligible', {
        component: 'ZeroCapitalResourceWiring', failures, readyChains: [...readyChains],
      });
    }
  };

  target.dispatchExecutableOpportunities = async (): Promise<void> => {
    if (!target.executionEnabled) return;
    const now = Date.now();
    target.opportunityQueue = target.opportunityQueue.filter(opportunity => now <= opportunity.expiresAt);

    while (target.opportunityQueue.length > 0) {
      let selectedIndex = -1;
      let selectedFunding: GasFundingDecision | null = null;
      let selectedLease: Awaited<ReturnType<typeof zeroCapitalResourceScheduler.acquire>> = null;

      for (let index = 0; index < target.opportunityQueue.length; index++) {
        const candidate = target.opportunityQueue[index];
        const key = target.executionKey(candidate);
        if (target.activeExecutionIds.has(candidate.id) || target.activeExecutionKeys.has(key)) continue;
        const funding = await target.getGasFundingDecision(candidate.chain);
        if (funding.mode === 'unavailable') continue;
        const lease = await zeroCapitalResourceScheduler.acquire(candidate, funding.mode);
        if (!lease) continue;
        selectedIndex = index;
        selectedFunding = funding;
        selectedLease = lease;
        break;
      }

      if (selectedIndex < 0 || !selectedFunding || !selectedLease) break;
      const [opportunity] = target.opportunityQueue.splice(selectedIndex, 1);
      const key = target.executionKey(opportunity);
      target.activeExecutionIds.add(opportunity.id);
      target.activeExecutionKeys.add(key);
      target.activeExecutionsByChain.set(opportunity.chain, activeChainCount(target, opportunity.chain) + 1);
      target.state.activeExecutions = target.activeExecutionIds.size;
      target.state.activeExecutionChains = [...target.activeExecutionsByChain.keys()];
      target.state.currentOpportunities = target.opportunityQueue.length;

      void target.executeAndRecord(opportunity).finally(async () => {
        await selectedLease!.release();
        target.activeExecutionIds.delete(opportunity.id);
        target.activeExecutionKeys.delete(key);
        const remaining = Math.max(0, activeChainCount(target, opportunity.chain) - 1);
        if (remaining === 0) target.activeExecutionsByChain.delete(opportunity.chain);
        else target.activeExecutionsByChain.set(opportunity.chain, remaining);
        target.state.activeExecutions = target.activeExecutionIds.size;
        target.state.activeExecutionChains = [...target.activeExecutionsByChain.keys()];
        if (target.executionEnabled) void target.dispatchExecutableOpportunities();
      });
    }
  };

  const emergencyCeiling = Math.max(1, Math.min(128, Number(process.env.ZERO_CAPITAL_EXECUTION_EMERGENCY_CEILING || 64)));
  target.maxConcurrentExecutions = emergencyCeiling;
  target.state.maxConcurrentExecutions = emergencyCeiling;

  logger.info('[ZeroCapitalWiring] Dynamic graphless discovery/resource scheduler installed', {
    component: 'ZeroCapitalResourceWiring',
    dynamicDiscovery: true,
    graphlessDexDiscovery: true,
    newApiKeysRequired: false,
    configuredRoutesRemainSupported: true,
    executionAdmission: 'resource_leases',
    globalValueSemantics: 'emergency_ceiling_only',
    nearBreakEvenObservation: true,
    bpsEvidencePropagated: true,
    sponsoredEconomicsAuthority: 'live_gas_funding_decision_only',
    scheduler: zeroCapitalResourceScheduler.getTelemetry(),
    safety: ['governance', 'positive_net', 'receiver', 'dynamic_route_permissions', 'fresh_requote_after_permission_change', 'exact_atomic_simulation', 'wallet_nonce', 'chain', 'provider', 'protocol', 'gas_sponsor'],
  });
}
