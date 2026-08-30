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
import { selectMeasuredDualFlashLoanAllocation } from '../execution/adapters/dual-flash-loan-provider-mesh.js';
import {
  buildMissingReceiverPermissionCalls,
  verifyFlashLoanReceiverCapability,
  type VerifiedFlashLoanReceiverCapability,
} from '../execution/adapters/flash-loan-receiver-capability.js';
import { verifyDualFlashLoanReceiverCapability } from '../execution/adapters/dual-flashloan-receiver-capability.js';
import { flashLoanProviderSelectionRegistry } from '../execution/adapters/flash-loan-provider-selection-registry.js';
import { dualFlashLoanProviderSelectionRegistry } from '../execution/adapters/dual-flash-loan-provider-selection-registry.js';
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
  extraProvenance: string[] = [],
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
            ...extraProvenance,
          ]
        : ['flash_loan_provider_unavailable_fail_closed', ...extraProvenance],
    },
  );
}

function setupCallIdentity(call: any): string {
  return [String(call?.to || '').toLowerCase(), String(call?.data || '').toLowerCase(), String(call?.value || '0')].join(':');
}

export function ensureZeroCapitalFlashProviderWiring(): void {
  const target = zeroCapitalEngine as unknown as {
    scanChain: (chain: SupportedChain, provider: providers.JsonRpcProvider) => Promise<ZeroCapitalOpportunity[]>;
    executionWallets: Map<SupportedChain, Wallet>;
    receiverManager: { getReceiver: (chain: string) => string | null };
    executionEnabled: boolean;
    isAllowedByCryptara: (opportunity: ZeroCapitalOpportunity) => Promise<boolean>;
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

  const originalCryptaraAdmission = target.isAllowedByCryptara.bind(target);

  target.isAllowedByCryptara = async (opportunity): Promise<boolean> => {
    if (opportunity.expectedProfit <= 0n) return true;
    return originalCryptaraAdmission(opportunity);
  };

  const originalScanChain = target.scanChain.bind(target);
  target.scanChain = async (chain, provider): Promise<ZeroCapitalOpportunity[]> => {
    let opportunities = await originalScanChain(chain, provider);
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
    const dualCapability = wallet
      ? await verifyDualFlashLoanReceiverCapability({
          chain: chain as any,
          provider,
          expectedOwner: wallet.address,
        }).catch(() => null)
      : null;

    // Warm route permissions for both Aave-only and dual-provider receivers.
    // Any state mutation invalidates the old quote and forces an immediate fresh scan.
    if ((aaveCapability || dualCapability) && wallet && opportunities.length > 0) {
      const missingByIdentity = new Map<string, any>();
      const permissionReceivers = [aaveCapability?.address, dualCapability?.address].filter((value): value is string => Boolean(value));
      for (const receiver of permissionReceivers) {
        for (const opportunity of opportunities) {
          const missing = await buildMissingReceiverPermissionCalls({
            chain: chain as any,
            provider,
            receiver,
            route: opportunity.route,
          }).catch(() => [] as any[]);
          for (const call of missing) missingByIdentity.set(setupCallIdentity(call), call);
        }
      }

      if (missingByIdentity.size > 0) {
        const funding = await target.getGasFundingDecision(chain);
        if (funding.mode !== 'unavailable') {
          const preMutation = opportunities;
          await target.executeSetupCalls(
            chain as any,
            provider,
            wallet,
            funding.mode as ReceiverFundingMode,
            [...missingByIdentity.values()],
          );
          for (const opportunity of preMutation) {
            updateCandidate(
              opportunity,
              null,
              'Provider receiver permissions changed; pre-mutation quote invalidated before immediate fresh re-quote',
              ['fresh_quote_after_provider_receiver_permissions'],
            );
          }
          opportunities = await originalScanChain(chain, provider);
          logger.info('[ZeroCapitalFlashProvider] Receiver permissions warmed and market evidence immediately refreshed', {
            component: 'ZeroCapitalFlashProviderWiring',
            chain,
            setupCalls: missingByIdentity.size,
            invalidatedQuotes: preMutation.length,
            freshQuotes: opportunities.length,
            aaveReceiver: Boolean(aaveCapability),
            dualReceiver: Boolean(dualCapability),
            staleQuoteExecutionAllowed: false,
            extraFullScanCycleRequired: false,
          });
          if (opportunities.length === 0) return [];
        }
      }
    }

    const repriced: ZeroCapitalOpportunity[] = [];
    for (const opportunity of opportunities) {
      flashLoanProviderSelectionRegistry.remove(opportunity.id);
      dualFlashLoanProviderSelectionRegistry.remove(opportunity.id);
      try {
        const capabilities = new Map<FlashLoanProviderKind, VerifiedFlashLoanReceiverCapability>();
        if (balancerCapability) capabilities.set('balancer_v2', balancerCapability);

        if (aaveCapability && wallet) {
          const remainingAavePermissions = await buildMissingReceiverPermissionCalls({
            chain: chain as any,
            provider,
            receiver: aaveCapability.address,
            route: opportunity.route,
          });
          if (remainingAavePermissions.length === 0) capabilities.set('aave_v3', aaveCapability);
        }

        const dualPermissionReady = dualCapability && wallet
          ? (await buildMissingReceiverPermissionCalls({
              chain: chain as any,
              provider,
              receiver: dualCapability.address,
              route: opportunity.route,
            })).length === 0
          : false;

        const evidence = await providerEvidence(chain, provider, opportunity.inputToken);
        const allowedProviders = [...capabilities.keys()];
        const selected = selectMeasuredFlashLoanProvider(evidence, opportunity.flashLoanAmount, allowedProviders);
        const selectedCapability = selected ? capabilities.get(selected.provider) ?? null : null;

        if (!selected || !selectedCapability) {
          const dual = dualPermissionReady
            ? selectMeasuredDualFlashLoanAllocation(evidence, opportunity.flashLoanAmount)
            : null;
          if (!dual || !dualCapability) {
            updateCandidate(
              opportunity,
              null,
              'No execution-ready single or combined Aave+Balancer provider path has complete measured fee, liquidity, permission, and verified receiver evidence for this exact amount',
              ['measured_flash_loan_provider_liquidity_and_fee'],
              ['provider_mesh_checked:true'],
            );
            continue;
          }

          const gas = opportunity.estimatedGasCostInInputToken || 0n;
          const relay = opportunity.relayFeeInInputToken || 0n;
          const allInCost = dual.totalFee + gas + relay;
          const grossProfit = opportunity.grossProfit ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
          const netProfit = grossProfit - allInCost;
          const netProfitBps = opportunity.flashLoanAmount > 0n
            ? Number((netProfit * 10_000n) / opportunity.flashLoanAmount)
            : Number.NEGATIVE_INFINITY;

          opportunity.flashLoanFeeInInputToken = dual.totalFee;
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

          const dualProvenance = [
            'flash_loan_provider:aave_balancer_dual',
            `dual_balancer_amount:${dual.balancerAmount.toString()}`,
            `dual_aave_amount:${dual.aaveAmount.toString()}`,
            `dual_total_fee:${dual.totalFee.toString()}`,
            'combined_liquidity_unlocks_exact_size',
            'same_asset_nested_atomicity_required',
          ];
          if (netProfit <= 0n) {
            updateCandidate(
              opportunity,
              dual.balancer,
              `Measured Aave+Balancer combined liquidity repriced the exact route to ${netProfitBps} BPS; observation only`,
              undefined,
              dualProvenance,
            );
            continue;
          }

          const cryptaraAllowed = !target.executionEnabled || await originalCryptaraAdmission(opportunity);
          if (!cryptaraAllowed) {
            updateCandidate(
              opportunity,
              dual.balancer,
              'Measured Aave+Balancer combined-liquidity rescue produced positive economics but Cryptara rejected the fresh positive candidate',
              ['cryptara_positive_provider_mesh_reprice_rejected'],
              dualProvenance,
            );
            continue;
          }

          dualFlashLoanProviderSelectionRegistry.record({
            opportunityId: opportunity.id,
            provider: 'aave_balancer_dual',
            receiver: dualCapability.address,
            balancerAmount: dual.balancerAmount,
            aaveAmount: dual.aaveAmount,
            balancerEconomics: dual.balancer,
            aaveEconomics: dual.aave,
            receiverCapability: dualCapability,
            totalMeasuredFlashFee: dual.totalFee,
            selectedAt: Date.now(),
            expiresAt: opportunity.expiresAt,
            provenance: [
              'measured_combined_provider_economics',
              'verified_dual_receiver_capability',
              'verified_dual_receiver_route_permissions',
              'balancer_outer_aave_nested',
              'strict_positive_repriced_net',
              'cryptara_rechecked_after_positive_provider_mesh_reprice',
              'synthetic_evidence:false',
            ],
          });
          updateCandidate(
            opportunity,
            dual.balancer,
            'Measured Aave+Balancer combined liquidity unlocks the exact profitable size; exact dual payload simulation, Monte Carlo, governance, and terminal settlement remain required',
            undefined,
            dualProvenance,
          );
          repriced.push(opportunity);
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

        if (netProfit <= 0n) {
          updateCandidate(
            opportunity,
            selected,
            `Measured ${selected.provider} exact fee/liquidity repriced the route to ${netProfitBps} BPS; observation only`,
          );
          continue;
        }

        const cryptaraAllowed = !target.executionEnabled || await originalCryptaraAdmission(opportunity);
        if (!cryptaraAllowed) {
          updateCandidate(
            opportunity,
            selected,
            `Measured ${selected.provider} repricing produced positive economics but Cryptara rejected the fresh positive candidate`,
            ['cryptara_positive_provider_reprice_rejected'],
          );
          continue;
        }

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
            'cryptara_rechecked_after_positive_provider_reprice',
            'synthetic_evidence:false',
          ],
        });

        updateCandidate(
          opportunity,
          selected,
          `Measured ${selected.provider} exact fee/liquidity plus verified receiver/permissions keep the route positive; downstream Cryptara/Monte Carlo/governance remain required`,
        );
        repriced.push(opportunity);
      } catch (error) {
        flashLoanProviderSelectionRegistry.remove(opportunity.id);
        dualFlashLoanProviderSelectionRegistry.remove(opportunity.id);
        updateCandidate(
          opportunity,
          null,
          `Flash-loan provider mesh evidence failed closed: ${error instanceof Error ? error.message : String(error)}`,
        );
        logger.warn('[ZeroCapitalFlashProvider] Provider mesh evidence failed closed', {
          component: 'ZeroCapitalFlashProviderWiring',
          chain,
          opportunityId: opportunity.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return repriced;
  };

  logger.info('[ZeroCapitalFlashProvider] Live provider mesh economics authority installed', {
    component: 'ZeroCapitalFlashProviderWiring',
    feeAuthority: 'measured_provider_state_exact_rate',
    liquidityAuthority: 'measured_provider_state',
    receiverAuthority: 'verified_provider_specific_or_dual_receiver_capability',
    permissionAuthority: 'provider_specific_receiver_allowlist_with_immediate_fresh_requote_after_mutation',
    providerSelectionRegistry: true,
    dualProviderSelectionRegistry: true,
    staticFlashLoanFeeAuthority: false,
    providerSelection: 'single_provider_lowest_fee_when_sufficient_else_measured_combined_liquidity_rescue',
    providerMesh: ['balancer_v2', 'aave_v3', 'aave_balancer_dual'],
    dualProviderRule: 'only_when_neither_single_provider_can_fund_exact_size_and_combined_liquidity_can',
    nearBreakEvenObservationCanReachProviderRepricing: true,
    positiveProviderRescueRechecksCryptara: true,
    nonPositiveProviderRepriceExecutable: false,
    aaveMarketEvidenceMeasured: true,
    aaveLiveExecutionEnabledWhenVerified: true,
    dualProviderExecutionEnabledWhenVerified: true,
    permissionWarmupRemovesFullCycleDelay: true,
    staleQuoteExecutionAllowed: false,
    failClosedOnMissingProviderEvidence: true,
  });
}
