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
} from '../discovery/dynamic-zero-capital-routes.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import type { ConfiguredZeroCapitalRoute } from '../execution/adapters/onchain-route-quoter.js';
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
  fromQuotedRoute: (quote: any, blockTimestamp: number) => ZeroCapitalOpportunity;
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
  for (const route of [...target.configuredRoutes, ...dynamicRoutesForRuntime(target)]) byId.set(route.id, route);
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

export function ensureZeroCapitalResourceWiring(): void {
  const target = zeroCapitalEngine as unknown as ZeroCapitalRuntime;
  if (installed.has(target)) return;
  installed.add(target);

  const originalScanChain = target.scanChain.bind(target);
  target.scanChain = async (chain, provider): Promise<ZeroCapitalOpportunity[]> => {
    // Preserve configured-route behavior and independently add measured dynamic
    // route discovery. Dynamic discovery runs even when a receiver is not ready;
    // receiver readiness controls execution admission, not market observation.
    const configured = await originalScanChain(chain, provider).catch(error => {
      logger.warn('[ZeroCapitalWiring] Configured route scan degraded', {
        component: 'ZeroCapitalResourceWiring',
        chain,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    });
    if (chain === 'europa') return configured;

    const dynamicQuotes = await discoverDynamicZeroCapitalQuotes(chain, provider);
    if (dynamicQuotes.length === 0) return configured;
    const block = await provider.getBlock('latest');
    const receiverReady = !!target.receiverManager.getReceiver(chain);
    const dynamic: ZeroCapitalOpportunity[] = [];
    for (const quote of dynamicQuotes) {
      const opportunity = target.fromQuotedRoute(quote, block.timestamp);
      const observedAt = opportunity.timestamp;
      measuredCandidateRegistry.record({
        opportunityId: opportunity.id,
        topology: 'ZERO_CAPITAL_ATOMIC',
        observedAt,
        expiresAt: opportunity.expiresAt,
        status: 'deterministic_positive',
        assets: [opportunity.inputAssetSymbol],
        venues: [...new Set(opportunity.route.map(step => step.protocol))],
        chains: [chain],
        rawQuotes: opportunity.route.map(step => ({
          source: step.protocol,
          venue: step.protocol,
          chain,
          observedAt,
          amountIn: step.amountIn.toString(),
          amountOut: step.expectedAmountOut.toString(),
          executable: receiverReady,
          provenance: ['direct_contract_quote'],
        })),
        depth: {
          status: 'measured',
          detail: 'Each route leg was accepted only after a live contract/router quote returned a positive output amount',
        },
        economics: {
          grossProfitUsd: baseUnitsToUsd(opportunity.grossProfit || 0n, opportunity.inputTokenDecimals),
          deterministicNetProfitUsd: baseUnitsToUsd(opportunity.expectedProfit, opportunity.inputTokenDecimals),
          feeUsd: baseUnitsToUsd(opportunity.flashLoanFeeInInputToken || 0n, opportunity.inputTokenDecimals),
          gasUsd: baseUnitsToUsd(opportunity.estimatedGasCostInInputToken || 0n, opportunity.inputTokenDecimals),
          bridgeUsd: 0,
          expectedSlippageBps: opportunity.expectedSlippageBps,
          expectedPriceImpactBps: null,
        },
        quoteAgeMs: opportunity.quoteLatencyMs,
        executableCapability: receiverReady,
        executionCapabilityReason: receiverReady
          ? 'Measured direct-protocol route has a verified funded receiver; Cryptara/Monte Carlo/governance remain required before execution'
          : 'Measured deterministic route is positive, but no verified funded receiver is currently registered on the chain',
        missingInformation: receiverReady ? [] : ['verified_funded_receiver'],
        provenance: ['dynamic_zero_capital_route', 'direct_contract_quotes', 'measured_gas_cost', 'deterministic_positive_net', 'synthetic_evidence:false'],
      });
      if (target.executionEligible && !receiverReady) continue;
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

    // Admission continues until no remaining candidate can acquire its independent
    // resource set. There is no business-level global trade cap here; the scheduler
    // retains only an emergency global ceiling plus concrete resource capacities.
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

  // Keep the legacy numeric field as an emergency-ceiling compatibility value,
  // not as the admission authority. Real capacity comes from resource leases.
  const emergencyCeiling = Math.max(1, Math.min(128, Number(process.env.ZERO_CAPITAL_EXECUTION_EMERGENCY_CEILING || 64)));
  target.maxConcurrentExecutions = emergencyCeiling;
  target.state.maxConcurrentExecutions = emergencyCeiling;

  logger.info('[ZeroCapitalWiring] Dynamic discovery/resource scheduler installed', {
    component: 'ZeroCapitalResourceWiring',
    dynamicDiscovery: true,
    configuredRoutesRemainSupported: true,
    executionAdmission: 'resource_leases',
    globalValueSemantics: 'emergency_ceiling_only',
    scheduler: zeroCapitalResourceScheduler.getTelemetry(),
    safety: ['governance', 'positive_net', 'receiver', 'wallet_nonce', 'chain', 'provider', 'protocol', 'gas_sponsor'],
  });
}
