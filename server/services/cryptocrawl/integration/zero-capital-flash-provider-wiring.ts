import logger from '../../../logger.js';
import type {
  SupportedChain,
  ZeroCapitalOpportunity,
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
import { prepareBuilderSponsoredZeroCapitalColdStart } from '../execution/builder-sponsored-zero-capital-coldstart.js';
import { prepareBuilderSponsoredReceiverBootstrap } from '../execution/builder-sponsored-receiver-bootstrap.js';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import { recordProfitEstimate } from '../intelligence/profit-estimator.js';
import { zeroCapitalRouteEvidenceRegistry } from '../optimization/zero-capital-route-evidence-registry.js';
import type { Wallet, providers } from 'ethers';

const evidenceCache = new Map<string, { observedAt: number; evidence: FlashLoanProviderEconomics[] }>();
let compatibilityNoticeLogged = false;

export interface ZeroCapitalProviderRepriceContext {
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
}

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

const BPS_PRECISION_SCALE = 1_000_000n;

function bpsFromBaseUnits(value: bigint, notional: bigint): number | null {
  if (notional <= 0n) return null;
  return Number((value * 10_000n * BPS_PRECISION_SCALE) / notional) / Number(BPS_PRECISION_SCALE);
}

function updateCandidate(input: {
  opportunity: ZeroCapitalOpportunity;
  selected: FlashLoanProviderEconomics | null;
  eligible: boolean;
  reason: string;
  missingInformation?: string[];
  extraProvenance?: string[];
  receiverBindingProvenance?: string;
}): void {
  const candidate = measuredCandidateRegistry.get(input.opportunity.id);
  if (!candidate) return;
  const positive = input.opportunity.expectedProfit > 0n;
  measuredCandidateRegistry.updateStatus(
    input.opportunity.id,
    input.eligible ? 'eligible' : positive ? 'deterministic_positive' : 'enriched',
    {
      economics: {
        ...candidate.economics,
        deterministicNetProfitUsd: Number(input.opportunity.expectedProfit) / (10 ** input.opportunity.inputTokenDecimals),
        feeUsd: 0,
        expectedSlippageBps: 0,
        flashLoanFeeBps: bpsFromBaseUnits(input.opportunity.flashLoanFeeInInputToken || 0n, input.opportunity.flashLoanAmount),
        allInCostBps: bpsFromBaseUnits(input.opportunity.estimatedExecutionCostInInputToken, input.opportunity.flashLoanAmount),
        breakEvenBps: bpsFromBaseUnits(input.opportunity.estimatedExecutionCostInInputToken, input.opportunity.flashLoanAmount),
        netProfitBps: input.opportunity.netProfitBps,
        bpsToBreakEven: input.opportunity.netProfitBps >= 0 ? 0 : Math.abs(input.opportunity.netProfitBps),
      },
      executableCapability: input.eligible,
      executionCapabilityReason: input.reason,
      replaceMissingInformation: true,
      missingInformation: input.missingInformation ?? [],
      provenance: input.selected
        ? [
            `flash_loan_provider:${input.selected.provider}`,
            'measured_flash_loan_fee_exact_rate',
            'measured_flash_loan_liquidity',
            input.receiverBindingProvenance || 'provider_selection_bound_to_verified_receiver',
            'flash_premium_attribution:flashLoanFeeBps_only',
            'min_output_tolerance_not_expected_slippage_cost',
            ...(input.eligible ? ['canonical_positive_all_in_net', 'zero_capital_hard_facts_eligible'] : []),
            ...(input.extraProvenance || []),
          ]
        : ['flash_loan_provider_unavailable_fail_closed', ...(input.extraProvenance || [])],
    },
  );
}

function setupCallIdentity(call: any): string {
  return [String(call?.to || '').toLowerCase(), String(call?.data || '').toLowerCase(), String(call?.value || '0')].join(':');
}

function repriceOpportunity(
  opportunity: ZeroCapitalOpportunity,
  flashFee: bigint,
): { grossProfit: bigint; allInCost: bigint; netProfit: bigint; netProfitBps: number } {
  const gas = opportunity.estimatedGasCostInInputToken || 0n;
  const relay = opportunity.relayFeeInInputToken || 0n;
  const allInCost = flashFee + gas + relay;
  const grossProfit = opportunity.grossProfit ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
  const netProfit = grossProfit - allInCost;
  const netProfitBps = bpsFromBaseUnits(netProfit, opportunity.flashLoanAmount) ?? Number.NEGATIVE_INFINITY;
  opportunity.flashLoanFeeInInputToken = flashFee;
  opportunity.estimatedExecutionCostInInputToken = allInCost;
  opportunity.expectedProfit = netProfit;
  opportunity.netProfitBps = netProfitBps;
  return { grossProfit, allInCost, netProfit, netProfitBps };
}

function currentReprice(opportunity: ZeroCapitalOpportunity) {
  const grossProfit = opportunity.grossProfit ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
  return {
    grossProfit,
    allInCost: opportunity.estimatedExecutionCostInInputToken,
    netProfit: opportunity.expectedProfit,
    netProfitBps: opportunity.netProfitBps,
  };
}

function recordReprice(
  opportunity: ZeroCapitalOpportunity,
  chain: SupportedChain,
  values: { grossProfit: bigint; allInCost: bigint; netProfit: bigint; netProfitBps: number },
): void {
  recordProfitEstimate({
    opportunityId: opportunity.id,
    chain,
    grossProfitUsd: Number(values.grossProfit) / (10 ** opportunity.inputTokenDecimals),
    estimatedCostsUsd: Number(values.allInCost) / (10 ** opportunity.inputTokenDecimals),
    estimatedNetProfitUsd: Number(values.netProfit) / (10 ** opportunity.inputTokenDecimals),
    netProfitBps: values.netProfitBps,
    confidence: opportunity.confidence,
    observedAt: Date.now(),
  });
}

async function verifiedCapabilities(input: {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  wallet: Wallet | undefined;
  balancerReceiver: string | null;
}): Promise<{
  single: Map<FlashLoanProviderKind, VerifiedFlashLoanReceiverCapability>;
  dual: Awaited<ReturnType<typeof verifyDualFlashLoanReceiverCapability>> | null;
}> {
  const { chain, provider, wallet, balancerReceiver } = input;
  const single = new Map<FlashLoanProviderKind, VerifiedFlashLoanReceiverCapability>();
  if (!wallet) return { single, dual: null };

  const [balancer, aave, morpho, dual] = await Promise.all([
    balancerReceiver
      ? verifyFlashLoanReceiverCapability({
          kind: 'balancer_v1',
          chain: chain as any,
          provider,
          expectedOwner: wallet.address,
          address: balancerReceiver,
        }).catch(() => null)
      : Promise.resolve(null),
    verifyFlashLoanReceiverCapability({
      kind: 'aave_v3',
      chain: chain as any,
      provider,
      expectedOwner: wallet.address,
    }).catch(() => null),
    verifyFlashLoanReceiverCapability({
      kind: 'morpho_blue',
      chain: chain as any,
      provider,
      expectedOwner: wallet.address,
    }).catch(() => null),
    verifyDualFlashLoanReceiverCapability({
      chain: chain as any,
      provider,
      expectedOwner: wallet.address,
    }).catch(() => null),
  ]);

  if (balancer) single.set('balancer_v2', balancer);
  if (aave) single.set('aave_v3', aave);
  if (morpho) single.set('morpho_blue', morpho);
  return { single, dual };
}

function strictFundingReady(funding: GasFundingDecision): boolean {
  return funding.mode !== 'unavailable'
    && funding.strictZeroInitialCapitalEligible === true
    && funding.operatorMonetaryInputRequired === false
    && (funding.paymentSource === 'system_owned_native' || funding.paymentSource === 'provider_sponsored');
}

export async function repriceZeroCapitalProviderEconomics(input: {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: ZeroCapitalOpportunity[];
  context: ZeroCapitalProviderRepriceContext;
}): Promise<ZeroCapitalOpportunity[]> {
  const { chain, provider, context } = input;
  if (chain === 'europa' || input.opportunities.length === 0) return input.opportunities;

  const wallet = context.executionWallets.get(chain);
  const balancerReceiver = context.receiverManager.getReceiver(chain);
  const capabilities = await verifiedCapabilities({ chain, provider, wallet, balancerReceiver });
  const funding = await context.getGasFundingDecision(chain);
  const resourceReady = strictFundingReady(funding);
  const repriced: ZeroCapitalOpportunity[] = [];
  const permissionCalls = new Map<string, any>();
  const permissionDeferred = new Set<string>();

  for (const sourceOpportunity of input.opportunities) {
    // Provider repricing is a speculative comparison stage. Work on an isolated
    // copy so a rejected provider, bootstrap attempt, or more expensive fee can
    // never contaminate the pristine opportunity that downstream alternatives
    // still need to evaluate against the same measured gross edge.
    const opportunity: ZeroCapitalOpportunity = {
      ...sourceOpportunity,
      route: sourceOpportunity.route.map(leg => ({ ...leg })),
    };
    flashLoanProviderSelectionRegistry.remove(opportunity.id);
    dualFlashLoanProviderSelectionRegistry.remove(opportunity.id);

    try {
      const evidence = await providerEvidence(chain, provider, opportunity.inputToken);
      const allowedProviders = [...capabilities.single.keys()];
      const selectedSingle = selectMeasuredFlashLoanProvider(evidence, opportunity.flashLoanAmount, allowedProviders);
      const selectedCapability = selectedSingle ? capabilities.single.get(selectedSingle.provider) ?? null : null;
      const selectedDual = capabilities.dual
        ? selectMeasuredDualFlashLoanAllocation(evidence, opportunity.flashLoanAmount, allowedProviders)
        : null;

      if (selectedDual && capabilities.dual) {
        const values = repriceOpportunity(opportunity, selectedDual.totalFee);
        const feeSavings = selectedDual.measuredFeeSavingsVsBestSingle;
        const dualProvenance = [
          'flash_loan_provider:aave_balancer_dual',
          `dual_selection_reason:${selectedDual.reason}`,
          `dual_balancer_amount:${selectedDual.balancerAmount.toString()}`,
          `dual_aave_amount:${selectedDual.aaveAmount.toString()}`,
          `dual_total_fee:${selectedDual.totalFee.toString()}`,
          ...(feeSavings !== null ? [`dual_fee_savings_vs_best_single:${feeSavings.toString()}`] : []),
          'same_asset_nested_atomicity_required',
          'provider_reprice_input_immutable:true',
        ];

        const missing = await buildMissingReceiverPermissionCalls({
          chain: chain as any,
          provider,
          receiver: capabilities.dual.address,
          route: opportunity.route,
        }).catch(() => [] as any[]);
        if (missing.length > 0) {
          for (const call of missing) permissionCalls.set(setupCallIdentity(call), call);
          permissionDeferred.add(opportunity.id);
          zeroCapitalRouteEvidenceRegistry.remove(opportunity.id);
          recordReprice(opportunity, chain, values);
          updateCandidate({
            opportunity,
            selected: selectedDual.balancer,
            eligible: false,
            reason: 'Measured dual-provider route requires receiver permissions before a fresh quote can become executable',
            missingInformation: ['fresh_quote_after_provider_receiver_permissions'],
            extraProvenance: dualProvenance,
          });
          continue;
        }

        if (!resourceReady && wallet && chain === 'ethereum') {
          const selection = {
            kind: 'dual' as const,
            opportunityId: opportunity.id,
            provider: 'aave_balancer_dual' as const,
            receiver: capabilities.dual.address,
            balancerAmount: selectedDual.balancerAmount,
            aaveAmount: selectedDual.aaveAmount,
            balancerEconomics: selectedDual.balancer,
            aaveEconomics: selectedDual.aave,
            receiverCapability: capabilities.dual,
            totalMeasuredFlashFee: selectedDual.totalFee,
            selectedAt: Date.now(),
            expiresAt: opportunity.expiresAt,
            provenance: [...dualProvenance, 'builder_cold_start_preparation_pending'],
          };
          const builderEvidence = await prepareBuilderSponsoredZeroCapitalColdStart({ opportunity, selection, provider, wallet }).catch(() => null);
          if (builderEvidence && builderEvidence.guaranteedNetProfitInInputToken > 0n) {
            const builderOpportunity: ZeroCapitalOpportunity = {
              ...opportunity,
              estimatedGasCostInInputToken: builderEvidence.builderGasCostInInputToken,
              estimatedExecutionCostInInputToken: selectedDual.totalFee + (opportunity.relayFeeInInputToken || 0n) + builderEvidence.builderGasCostInInputToken,
              expectedProfit: builderEvidence.guaranteedNetProfitInInputToken,
              netProfitBps: builderEvidence.admittedNetProfitBps,
            };
            const builderValues = currentReprice(builderOpportunity);
            recordReprice(builderOpportunity, chain, builderValues);
            zeroCapitalRouteEvidenceRegistry.record(builderOpportunity);
            dualFlashLoanProviderSelectionRegistry.record({
              ...selection,
              provenance: [
                'measured_combined_provider_economics',
                'verified_dual_receiver_capability',
                'verified_dual_receiver_route_permissions',
                'builder_sponsored_exact_repayment_plan',
                'operator_native_gas_input:false',
                'balancer_outer_aave_nested',
                selectedDual.reason,
                'strict_positive_repriced_net',
                'synthetic_evidence:false',
              ],
            });
            updateCandidate({
              opportunity: builderOpportunity,
              selected: selectedDual.balancer,
              eligible: true,
              reason: 'Measured Aave+Balancer route has an exact builder-sponsored Ethereum repayment bundle with positive residual; canonical scheduler owns submission',
              extraProvenance: [...dualProvenance, ...builderEvidence.provenance],
            });
            repriced.push(builderOpportunity);
            continue;
          }
        }

        zeroCapitalRouteEvidenceRegistry.record(opportunity);
        recordReprice(opportunity, chain, values);
        if (values.netProfit <= 0n) {
          updateCandidate({
            opportunity,
            selected: selectedDual.balancer,
            eligible: false,
            reason: `Measured Aave+Balancer provider mesh repriced the exact route to ${values.netProfitBps} BPS; observation only`,
            extraProvenance: dualProvenance,
          });
          continue;
        }

        if (!resourceReady) {
          updateCandidate({
            opportunity,
            selected: selectedDual.balancer,
            eligible: false,
            reason: `Measured Aave+Balancer route is positive, but strict zero-personal-cost execution funding is not currently proven: ${funding.reason}`,
            missingInformation: ['required:zero_personal_cost_execution_resource'],
            extraProvenance: [...dualProvenance, 'provider_reprice_does_not_override_funding_authority'],
          });
          continue;
        }

        dualFlashLoanProviderSelectionRegistry.record({
          opportunityId: opportunity.id,
          provider: 'aave_balancer_dual',
          receiver: capabilities.dual.address,
          balancerAmount: selectedDual.balancerAmount,
          aaveAmount: selectedDual.aaveAmount,
          balancerEconomics: selectedDual.balancer,
          aaveEconomics: selectedDual.aave,
          receiverCapability: capabilities.dual,
          totalMeasuredFlashFee: selectedDual.totalFee,
          selectedAt: Date.now(),
          expiresAt: opportunity.expiresAt,
          provenance: [
            'measured_combined_provider_economics',
            'verified_dual_receiver_capability',
            'verified_dual_receiver_route_permissions',
            'strict_zero_personal_cost_funding_proven',
            'balancer_outer_aave_nested',
            selectedDual.reason,
            ...(feeSavings !== null ? ['dual_fee_split_strictly_beats_best_single'] : []),
            'strict_positive_repriced_net',
            'synthetic_evidence:false',
          ],
        });
        updateCandidate({
          opportunity,
          selected: selectedDual.balancer,
          eligible: true,
          reason: selectedDual.reason === 'fee_split_beats_single_provider'
            ? 'Measured Aave+Balancer fee split beats the best executable single-provider flash fee with strict zero-personal-cost funding proven; canonical scheduler owns submission'
            : 'Measured Aave+Balancer combined liquidity unlocks the exact profitable size with strict zero-personal-cost funding proven; canonical scheduler owns submission',
          extraProvenance: [...dualProvenance, 'strict_zero_personal_cost_funding_proven'],
        });
        repriced.push(opportunity);
        continue;
      }

      if (!selectedSingle || !selectedCapability) {
        const balancerEvidence = evidence.find(item =>
          item.provider === 'balancer_v2'
          && item.executableEvidenceComplete
          && item.availableLiquidity !== null
          && item.availableLiquidity >= opportunity.flashLoanAmount,
        ) || null;
        const bootstrapFlashFee = balancerEvidence
          ? calculateMeasuredFlashLoanFee(balancerEvidence, opportunity.flashLoanAmount)
          : null;
        if (chain === 'ethereum' && wallet && !balancerReceiver && balancerEvidence && bootstrapFlashFee !== null) {
          const bootstrapEvidence = await prepareBuilderSponsoredReceiverBootstrap({
            opportunity,
            balancerEvidence,
            provider,
            wallet,
          }).catch(error => {
            logger.debug('[ZeroCapitalFlashProvider] Atomic first-receiver bootstrap not admissible for this exact opportunity', {
              component: 'ZeroCapitalFlashProviderWiring',
              opportunityId: opportunity.id,
              error: error instanceof Error ? error.message : String(error),
              executionAuthority: false,
            });
            return null;
          });
          if (bootstrapEvidence && bootstrapEvidence.guaranteedNetProfitInInputToken > 0n) {
            const bootstrapOpportunity: ZeroCapitalOpportunity = {
              ...opportunity,
              flashLoanFeeInInputToken: bootstrapFlashFee,
              estimatedGasCostInInputToken: bootstrapEvidence.builderGasCostInInputToken,
              estimatedExecutionCostInInputToken: bootstrapFlashFee + (opportunity.relayFeeInInputToken || 0n) + bootstrapEvidence.builderGasCostInInputToken,
              expectedProfit: bootstrapEvidence.guaranteedNetProfitInInputToken,
              netProfitBps: bootstrapEvidence.admittedNetProfitBps,
            };
            const bootstrapValues = currentReprice(bootstrapOpportunity);
            recordReprice(bootstrapOpportunity, chain, bootstrapValues);
            zeroCapitalRouteEvidenceRegistry.record(bootstrapOpportunity);
            updateCandidate({
              opportunity: bootstrapOpportunity,
              selected: balancerEvidence,
              eligible: true,
              reason: 'Measured Balancer route has an exact Titan/Quasar atomic bundle that deploys and permissions the first receiver, executes the profitable flash route, and repays sponsorship from execution-created value; canonical scheduler remains sole submitter',
              receiverBindingProvenance: 'provider_receiver_binding:atomic_same_bundle_create2_bootstrap',
              extraProvenance: [...bootstrapEvidence.provenance, 'provider_reprice_input_immutable:true'],
            });
            repriced.push(bootstrapOpportunity);
            continue;
          }
        }

        zeroCapitalRouteEvidenceRegistry.remove(opportunity.id);
        updateCandidate({
          opportunity,
          selected: null,
          eligible: false,
          reason: 'No execution-ready Morpho, Aave, Balancer, combined Aave+Balancer, or exact atomic first-receiver builder path has complete measured fee, liquidity, and receiver evidence for this amount',
          missingInformation: ['measured_flash_loan_provider_liquidity_and_fee'],
          extraProvenance: ['provider_mesh_checked:true', 'atomic_first_receiver_bootstrap_checked:true', 'provider_reprice_input_immutable:true'],
        });
        continue;
      }

      const measuredFlashFee = calculateMeasuredFlashLoanFee(selectedSingle, opportunity.flashLoanAmount);
      if (measuredFlashFee === null) {
        zeroCapitalRouteEvidenceRegistry.remove(opportunity.id);
        updateCandidate({
          opportunity,
          selected: null,
          eligible: false,
          reason: 'Selected flash-loan provider is missing an exact measured fee rate',
          missingInformation: ['measured_flash_loan_provider_fee'],
          extraProvenance: ['provider_reprice_input_immutable:true'],
        });
        continue;
      }

      const values = repriceOpportunity(opportunity, measuredFlashFee);
      const providerProvenance = [
        ...(selectedSingle.provider === 'morpho_blue' ? ['morpho_zero_flash_fee_applied:true'] : []),
        'provider_reprice_input_immutable:true',
      ];
      const missing = await buildMissingReceiverPermissionCalls({
        chain: chain as any,
        provider,
        receiver: selectedCapability.address,
        route: opportunity.route,
      }).catch(() => [] as any[]);
      if (missing.length > 0) {
        for (const call of missing) permissionCalls.set(setupCallIdentity(call), call);
        permissionDeferred.add(opportunity.id);
        zeroCapitalRouteEvidenceRegistry.remove(opportunity.id);
        recordReprice(opportunity, chain, values);
        updateCandidate({
          opportunity,
          selected: selectedSingle,
          eligible: false,
          reason: `Measured ${selectedSingle.provider} route requires receiver permissions before a fresh quote can become executable`,
          missingInformation: ['fresh_quote_after_provider_receiver_permissions'],
          extraProvenance: providerProvenance,
        });
        continue;
      }

      if (!resourceReady && wallet && chain === 'ethereum') {
        const selection = {
          kind: 'single' as const,
          opportunityId: opportunity.id,
          provider: selectedSingle.provider,
          receiver: selectedCapability.address,
          economics: selectedSingle,
          receiverCapability: selectedCapability,
          selectedAt: Date.now(),
          expiresAt: opportunity.expiresAt,
          provenance: [...providerProvenance, 'builder_cold_start_preparation_pending'],
        };
        const builderEvidence = await prepareBuilderSponsoredZeroCapitalColdStart({ opportunity, selection, provider, wallet }).catch(() => null);
        if (builderEvidence && builderEvidence.guaranteedNetProfitInInputToken > 0n) {
          const builderOpportunity: ZeroCapitalOpportunity = {
            ...opportunity,
            estimatedGasCostInInputToken: builderEvidence.builderGasCostInInputToken,
            estimatedExecutionCostInInputToken: measuredFlashFee + (opportunity.relayFeeInInputToken || 0n) + builderEvidence.builderGasCostInInputToken,
            expectedProfit: builderEvidence.guaranteedNetProfitInInputToken,
            netProfitBps: builderEvidence.admittedNetProfitBps,
          };
          const builderValues = currentReprice(builderOpportunity);
          recordReprice(builderOpportunity, chain, builderValues);
          zeroCapitalRouteEvidenceRegistry.record(builderOpportunity);
          flashLoanProviderSelectionRegistry.record({
            ...selection,
            provenance: [
              'measured_provider_economics',
              'verified_receiver_capability',
              'verified_receiver_route_permissions',
              'builder_sponsored_exact_repayment_plan',
              'operator_native_gas_input:false',
              'provider_receiver_binding',
              ...(selectedSingle.provider === 'morpho_blue' ? ['morpho_blue_zero_flash_fee'] : []),
              'strict_positive_repriced_net',
              'synthetic_evidence:false',
            ],
          });
          updateCandidate({
            opportunity: builderOpportunity,
            selected: selectedSingle,
            eligible: true,
            reason: `Measured ${selectedSingle.provider} route has an exact builder-sponsored Ethereum repayment bundle with positive residual; canonical scheduler owns submission`,
            extraProvenance: [...providerProvenance, ...builderEvidence.provenance],
          });
          repriced.push(builderOpportunity);
          continue;
        }
      }

      zeroCapitalRouteEvidenceRegistry.record(opportunity);
      recordReprice(opportunity, chain, values);
      if (values.netProfit <= 0n) {
        updateCandidate({
          opportunity,
          selected: selectedSingle,
          eligible: false,
          reason: `Measured ${selectedSingle.provider} exact fee/liquidity repriced the route to ${values.netProfitBps} BPS; observation only`,
          extraProvenance: providerProvenance,
        });
        continue;
      }

      if (!resourceReady) {
        updateCandidate({
          opportunity,
          selected: selectedSingle,
          eligible: false,
          reason: `Measured ${selectedSingle.provider} route is positive, but strict zero-personal-cost execution funding is not currently proven: ${funding.reason}`,
          missingInformation: ['required:zero_personal_cost_execution_resource'],
          extraProvenance: [...providerProvenance, 'provider_reprice_does_not_override_funding_authority'],
        });
        continue;
      }

      flashLoanProviderSelectionRegistry.record({
        opportunityId: opportunity.id,
        provider: selectedSingle.provider,
        receiver: selectedCapability.address,
        economics: selectedSingle,
        receiverCapability: selectedCapability,
        selectedAt: Date.now(),
        expiresAt: opportunity.expiresAt,
        provenance: [
          'measured_provider_economics',
          'verified_receiver_capability',
          'verified_receiver_route_permissions',
          'strict_zero_personal_cost_funding_proven',
          'provider_receiver_binding',
          ...(selectedSingle.provider === 'morpho_blue' ? ['morpho_blue_zero_flash_fee'] : []),
          'strict_positive_repriced_net',
          'synthetic_evidence:false',
          'provider_reprice_input_immutable:true',
        ],
      });
      updateCandidate({
        opportunity,
        selected: selectedSingle,
        eligible: true,
        reason: `Measured ${selectedSingle.provider} exact fee/liquidity plus verified receiver/permissions and strict zero-personal-cost funding keep the route positive; canonical scheduler owns submission`,
        extraProvenance: [...providerProvenance, 'strict_zero_personal_cost_funding_proven'],
      });
      repriced.push(opportunity);
    } catch (error) {
      flashLoanProviderSelectionRegistry.remove(opportunity.id);
      dualFlashLoanProviderSelectionRegistry.remove(opportunity.id);
      zeroCapitalRouteEvidenceRegistry.remove(opportunity.id);
      updateCandidate({
        opportunity,
        selected: null,
        eligible: false,
        reason: `Flash-loan provider mesh evidence failed closed: ${error instanceof Error ? error.message : String(error)}`,
        missingInformation: ['measured_flash_loan_provider_liquidity_and_fee'],
        extraProvenance: ['provider_reprice_input_immutable:true'],
      });
      logger.warn('[ZeroCapitalFlashProvider] Provider mesh evidence failed closed', {
        component: 'ZeroCapitalFlashProviderWiring',
        chain,
        opportunityId: opportunity.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (permissionCalls.size > 0 && wallet && resourceReady) {
    try {
      await context.executeSetupCalls(
        chain as any,
        provider,
        wallet,
        funding.mode as ReceiverFundingMode,
        [...permissionCalls.values()],
      );
      logger.info('[ZeroCapitalFlashProvider] Selected positive-route receiver permissions prepared; stale quotes remain invalid until the next canonical discovery cycle', {
        component: 'ZeroCapitalFlashProviderWiring',
        chain,
        setupCalls: permissionCalls.size,
        deferredOpportunityIds: [...permissionDeferred],
        staleQuoteExecutionAllowed: false,
        nextAuthority: 'canonical_fresh_discovery_cycle',
        executionAuthority: false,
      });
    } catch (error) {
      logger.warn('[ZeroCapitalFlashProvider] Selected positive-route receiver permission preparation failed closed', {
        component: 'ZeroCapitalFlashProviderWiring',
        chain,
        deferredOpportunityIds: [...permissionDeferred],
        error: error instanceof Error ? error.message : String(error),
        personalFundingRequested: false,
        executionAuthority: false,
      });
    }
  }

  return repriced;
}

export function ensureZeroCapitalFlashProviderWiring(): void {
  if (compatibilityNoticeLogged) return;
  compatibilityNoticeLogged = true;
  logger.info('[ZeroCapitalFlashProvider] Compatibility installer retained without runtime method mutation', {
    component: 'ZeroCapitalFlashProviderWiring',
    providerRepricingAuthority: 'explicit_zero_capital_discovery_pipeline_stage',
    nonPositiveProviderRepriceExecutable: false,
    providerRepriceInputImmutable: true,
    scanChainMutation: false,
    cryptaraAdmissionMutation: false,
    executionAuthority: false,
  });
}