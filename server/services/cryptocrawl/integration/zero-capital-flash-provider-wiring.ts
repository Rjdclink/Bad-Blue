import logger from '../../../logger.js';
import {
  zeroCapitalEngine,
  type SupportedChain,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import {
  calculateMeasuredFlashLoanFee,
  measureFlashLoanProviders,
  selectMeasuredFlashLoanProvider,
  type FlashLoanProviderEconomics,
  type FlashLoanProviderKind,
} from '../execution/adapters/flash-loan-provider-economics.js';
import {
  buildMissingReceiverPermissionCalls,
  verifyFlashLoanReceiverCapability,
  type VerifiedFlashLoanReceiverCapability,
} from '../execution/adapters/flash-loan-receiver-capability.js';
import { flashLoanProviderSelectionRegistry } from '../execution/adapters/flash-loan-provider-selection-registry.js';
import type { ReceiverFundingMode } from '../execution/adapters/sponsored-receiver-manager.js';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import { recordProfitEstimate } from '../intelligence/profit-estimator.js';
import type { Wallet, providers } from 'ethers';

const installed = new WeakSet<object>();
const evidenceCache = new Map<string, { observedAt: number; evidence: FlashLoanProviderEconomics[] }>();

function cacheTtlMs(): number {
  const value = Number(process.env.ZERO_CAPITAL_FLASH_PROVIDER_EVIDENCE_TTL_MS || 2_500);
  return Number.isFinite(value) ? Math.max(250, Math.min(15_000, Math.trunc(value))) : 2_500;
}

async function providerEvidence(
  chain: SupportedChain,
  provider: providers.Provider,
  asset: string,
): Promise<FlashLoanProviderEconomics[]> {
  if (chain === 'europa') return [];
  const key = `${chain}:${asset.toLowerCase()}`;
  const cached = evidenceCache.get(key);
  if (cached && Date.now() - cached.observedAt <= cacheTtlMs()) return cached.evidence.map(item => ({ ...item }));
  const evidence = await measureFlashLoanProviders({ chain: chain as any, provider, asset });
  evidenceCache.set(key, { observedAt: Date.now(), evidence });
  return evidence.map(item => ({ ...item }));
}

function bpsFromBaseUnits(value: bigint, notional: bigint): number | null {
  if (notional <= 0n) return null;
  return Number((value * 10_000n) / notional);
}

function updateCandidate(
  opportunity: ZeroCapitalOpportunity,
  selected: FlashLoanProviderEconomics | null,
  reason: string,
  missingInformation?: string[],
): void {
  const candidate = measuredCandidateRegistry.get(opportunity.id);
  if (!candidate) return;
  const positive = opportunity.expectedProfit > 0n;
  measuredCandidateRegistry.updateStatus(
    opportunity.id,
    positive && selected ? 'deterministic_positive' : 'enriched',
    {
      economics: {
        ...candidate.economics,
        deterministicNetProfitUsd: Number(opportunity.expectedProfit) / (10 ** opportunity.inputTokenDecimals),
        feeUsd: Number(opportunity.flashLoanFeeInInputToken || 0n) / (10 ** opportunity.inputTokenDecimals),
        flashLoanFeeBps: bpsFromBaseUnits(opportunity.flashLoanFeeInInputToken || 0n, opportunity.flashLoanAmount),
        allInCostBps: bpsFromBaseUnits(opportunity.estimatedExecutionCostInInputToken, opportunity.flashLoanAmount),
        breakEvenBps: bpsFromBaseUnits(opportunity.estimatedExecutionCostInInputToken, opportunity.flashLoanAmount),
        netProfitBps: opportunity.netProfitBps,
        bpsToBreakEven: opportunity.netProfitBps >= 0 ? 0 : Math.abs(opportunity.netProfitBps),
      },
      executableCapability: positive && !!selected && candidate.executableCapability,
      executionCapabilityReason: reason,
      missingInformation: missingInformation ?? (selected ? [] : ['measured_flash_loan_provider_liquidity_and_fee']),
      provenance: selected
        ? [
            `flash_loan_provider:${selected.provider}`,
            'measured_flash_loan_fee_exact_rate',
            'measured_flash_loan_liquidity',
            'provider_selection_bound_to_verified_receiver',
          ]
        : ['flash_loan_provider_unavailable_fail_closed'],
    },
  );
}

export function ensureZeroCapitalFlashProviderWiring(): void {
  const target = zeroCapitalEngine as unknown as {
    scanChain: (chain: SupportedChain, provider: providers.JsonRpcProvider) => Promise<ZeroCapitalOpportunity[]>;
    executionWallets: Map<SupportedChain, Wallet>;
    receiverManager: { getReceiver: (chain: string) => string | null };
    getGasFundingDecision: (chain: SupportedChain) => Promise<GasFundingDecision>;
    executeSetupCalls: (
      chain: any,
      provider: providers.JsonRpcProvider,
      wallet: Wallet,
      fundingMode: ReceiverFundingMode,
      calls: any[],
    ) => Promise<void>;
  };
  if (installed.has(target)) return;
  installed.add(target);

  const originalScanChain = target.scanChain.bind(target);
  target.scanChain = async (chain, provider): Promise<ZeroCapitalOpportunity[]> => {
    const opportunities = await originalScanChain(chain, provider);
    if (chain === 'europa' || opportunities.length === 0) return opportunities;

    const wallet = target.executionWallets.get(chain);
    const balancerReceiver = target.receiverManager.getReceiver(chain);
    const balancerCapability = wallet && balancerReceiver
      ? await verifyFlashLoanReceiverCapability({
          kind: 'balancer_v1',
          chain: chain as any,
          provider,
          expectedOwner: wallet.address,
          address: balancerReceiver,
        }).catch(() => null)
      : null;
    const aaveCapability = wallet
      ? await verifyFlashLoanReceiverCapability({
          kind: 'aave_v3',
          chain: chain as any,
          provider,
          expectedOwner: wallet.address,
        }).catch(() => null)
      : null;

    const repriced: ZeroCapitalOpportunity[] = [];
    for (const opportunity of opportunities) {
      flashLoanProviderSelectionRegistry.remove(opportunity.id);
      try {
        const capabilities = new Map<FlashLoanProviderKind, VerifiedFlashLoanReceiverCapability>();
        if (balancerCapability) capabilities.set('balancer_v2', balancerCapability);

        if (aaveCapability && wallet) {
          const missingAavePermissions = await buildMissingReceiverPermissionCalls({
            chain: chain as any,
            provider,
            receiver: aaveCapability.address,
            route: opportunity.route,
          });
          if (missingAavePermissions.length > 0) {
            const funding = await target.getGasFundingDecision(chain);
            if (funding.mode !== 'unavailable') {
              await target.executeSetupCalls(
                chain as any,
                provider,
                wallet,
                funding.mode as ReceiverFundingMode,
                missingAavePermissions,
              );
              updateCandidate(
                opportunity,
                null,
                'Aave V3 receiver permissions changed; the pre-mutation quote is invalidated and a fresh quote is required',
                ['fresh_quote_after_aave_receiver_permissions'],
              );
              continue;
            }
          } else {
            capabilities.set('aave_v3', aaveCapability);
          }
        }

        const evidence = await providerEvidence(chain, provider, opportunity.inputToken);
        const allowedProviders = [...capabilities.keys()];
        const selected = selectMeasuredFlashLoanProvider(evidence, opportunity.flashLoanAmount, allowedProviders);
        const selectedCapability = selected ? capabilities.get(selected.provider) ?? null : null;
        if (!selected || !selectedCapability) {
          updateCandidate(opportunity, null, 'No execution-ready flash-loan provider has complete measured fee, liquidity, permission, and verified receiver evidence for this amount');
          continue;
        }

        const measuredFlashFee = calculateMeasuredFlashLoanFee(selected, opportunity.flashLoanAmount);
        if (measuredFlashFee === null) {
          updateCandidate(opportunity, null, 'Selected flash-loan provider is missing an exact measured fee rate');
          continue;
        }
        const gas = opportunity.estimatedGasCostInInputToken || 0n;
        const relay = opportunity.relayFeeInInputToken || 0n;
        const allInCost = measuredFlashFee + gas + relay;
        const grossProfit = opportunity.grossProfit ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
        const netProfit = grossProfit - allInCost;
        const netProfitBps = opportunity.flashLoanAmount > 0n
          ? Number((netProfit * 10_000n) / opportunity.flashLoanAmount)
          : Number.NEGATIVE_INFINITY;

        opportunity.flashLoanFeeInInputToken = measuredFlashFee;
        opportunity.estimatedExecutionCostInInputToken = allInCost;
        opportunity.expectedProfit = netProfit;
        opportunity.netProfitBps = netProfitBps;

        recordProfitEstimate({
          opportunityId: opportunity.id,
          chain,
          grossProfitUsd: Number(grossProfit) / (10 ** opportunity.inputTokenDecimals),
          estimatedCostsUsd: Number(allInCost) / (10 ** opportunity.inputTokenDecimals),
          estimatedNetProfitUsd: Number(netProfit) / (10 ** opportunity.inputTokenDecimals),
          netProfitBps,
          confidence: opportunity.confidence,
          observedAt: Date.now(),
        });

        if (netProfit > 0n) {
          flashLoanProviderSelectionRegistry.record({
            opportunityId: opportunity.id,
            provider: selected.provider,
            receiver: selectedCapability.address,
            economics: selected,
            receiverCapability: selectedCapability,
            selectedAt: Date.now(),
            expiresAt: opportunity.expiresAt,
            provenance: [
              'measured_provider_economics',
              'verified_receiver_capability',
              'verified_receiver_route_permissions',
              'provider_receiver_binding',
              'strict_positive_repriced_net',
              'synthetic_evidence:false',
            ],
          });
        }

        updateCandidate(
          opportunity,
          selected,
          netProfit > 0n
            ? `Measured ${selected.provider} exact fee/liquidity plus verified receiver/permissions keep the route positive; downstream Cryptara/Monte Carlo/governance remain required`
            : `Measured ${selected.provider} exact fee/liquidity repriced the route to ${netProfitBps} BPS; observation only`,
        );
        if (netProfit > 0n) repriced.push(opportunity);
      } catch (error) {
        flashLoanProviderSelectionRegistry.remove(opportunity.id);
        updateCandidate(
          opportunity,
          null,
          `Flash-loan provider evidence failed closed: ${error instanceof Error ? error.message : String(error)}`,
        );
        logger.warn('[ZeroCapitalFlashProvider] Provider evidence failed closed', {
          component: 'ZeroCapitalFlashProviderWiring',
          chain,
          opportunityId: opportunity.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return repriced;
  };

  logger.info('[ZeroCapitalFlashProvider] Live provider economics authority installed', {
    component: 'ZeroCapitalFlashProviderWiring',
    feeAuthority: 'measured_provider_state_exact_rate',
    liquidityAuthority: 'measured_provider_state',
    receiverAuthority: 'verified_provider_specific_receiver_capability',
    permissionAuthority: 'provider_specific_receiver_allowlist_with_fresh_requote_after_mutation',
    providerSelectionRegistry: true,
    staticFlashLoanFeeAuthority: false,
    providerSelection: 'lowest_measured_fee_with_sufficient_liquidity_and_execution_ready_receiver',
    aaveMarketEvidenceMeasured: true,
    aaveLiveExecutionEnabledWhenVerified: true,
    failClosedOnMissingProviderEvidence: true,
  });
}
