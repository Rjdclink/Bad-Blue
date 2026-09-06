import logger from '../../../logger.js';
import {
  flashLoanProviderSelectionRegistry,
  type FlashLoanProviderSelection,
} from '../execution/adapters/flash-loan-provider-selection-registry.js';
import { recordMeasuredExternalCapitalCapability } from '../optimization/external-capital-capability-registry.js';

let installed = false;
let unsubscribe: (() => void) | null = null;

function bigintBps(cost: bigint, notional: bigint): number | null {
  if (cost < 0n || notional <= 0n) return null;
  const ppm = (cost * 1_000_000n) / notional;
  const bps = Number(ppm) / 100;
  return Number.isFinite(bps) && bps >= 0 ? bps : null;
}

function observe(selection: FlashLoanProviderSelection): void {
  if (selection.expiresAt <= selection.selectedAt) return;

  if (selection.kind === 'single') {
    const economics = selection.economics;
    const feeBps = economics.feeBps;
    const liquidity = economics.availableLiquidity;
    const executionReady = economics.executableEvidenceComplete === true
      && feeBps !== null
      && Number.isFinite(feeBps)
      && feeBps >= 0
      && liquidity !== null
      && liquidity > 0n;

    recordMeasuredExternalCapitalCapability({
      id: `${economics.provider}:${economics.chain}:${economics.asset.toLowerCase()}`,
      protocol: economics.provider,
      network: economics.chain,
      role: 'atomic_principal',
      asset: economics.asset,
      bootstrapEligible: true,
      requiresSystemOwnedCapital: false,
      collateralRequired: false,
      executionReady,
      delegatedCanonicalAuthority: 'flashLoanProviderSelectionRegistry',
      measuredCostBps: feeBps ?? undefined,
      availableLiquidityBaseUnits: liquidity?.toString(),
      observedAt: economics.observedAt,
      expiresAt: selection.expiresAt,
      provenance: [
        ...economics.provenance,
        ...selection.provenance,
        `opportunity_selection:${selection.opportunityId}`,
        'provider_selection_observer_read_only',
        'canonical_flash_provider_authority_unchanged',
      ],
      executionAuthority: false,
      capitalMovementAuthority: false,
    });
    return;
  }

  const totalAmount = selection.balancerAmount + selection.aaveAmount;
  const measuredCostBps = bigintBps(selection.totalMeasuredFlashFee, totalAmount);
  const evidenceComplete = selection.balancerEconomics.executableEvidenceComplete === true
    && selection.aaveEconomics.executableEvidenceComplete === true
    && measuredCostBps !== null
    && totalAmount > 0n;
  const observedAt = Math.min(selection.balancerEconomics.observedAt, selection.aaveEconomics.observedAt);

  recordMeasuredExternalCapitalCapability({
    id: `aave_balancer_dual:${selection.balancerEconomics.chain}:${selection.balancerEconomics.asset.toLowerCase()}`,
    protocol: 'aave_balancer_dual',
    network: selection.balancerEconomics.chain,
    role: 'atomic_principal',
    asset: selection.balancerEconomics.asset,
    bootstrapEligible: true,
    requiresSystemOwnedCapital: false,
    collateralRequired: false,
    executionReady: evidenceComplete,
    delegatedCanonicalAuthority: 'flashLoanProviderSelectionRegistry',
    measuredCostBps: measuredCostBps ?? undefined,
    // The exact selected amount is the only combined liquidity capacity proven by
    // this selection. Do not manufacture a larger aggregate liquidity number.
    availableLiquidityBaseUnits: totalAmount.toString(),
    observedAt,
    expiresAt: selection.expiresAt,
    provenance: [
      ...selection.balancerEconomics.provenance,
      ...selection.aaveEconomics.provenance,
      ...selection.provenance,
      `opportunity_selection:${selection.opportunityId}`,
      'dual_available_liquidity_exact_selected_amount_only',
      'provider_selection_observer_read_only',
      'canonical_flash_provider_authority_unchanged',
    ],
    executionAuthority: false,
    capitalMovementAuthority: false,
  });
}

export function ensureExternalCapitalSelectionObserver(): void {
  if (installed) return;
  installed = true;
  unsubscribe = flashLoanProviderSelectionRegistry.onSelection(selection => {
    try {
      observe(selection);
    } catch (error) {
      logger.debug('[ExternalCapitalSelectionObserver] Advisory observation rejected without affecting provider selection', {
        component: 'ExternalCapitalSelectionObserver',
        opportunityId: selection.opportunityId,
        error: error instanceof Error ? error.message : String(error),
        executionAuthority: false,
        canonicalProviderAuthorityChanged: false,
      });
    }
  });
  logger.info('[ExternalCapitalSelectionObserver] Canonical flash selections now feed advisory capital specialization', {
    component: 'ExternalCapitalSelectionObserver',
    sourceAuthority: 'flashLoanProviderSelectionRegistry',
    executionAuthority: false,
    capitalMovementAuthority: false,
    providerSelectionMutationAuthority: false,
  });
}

export function stopExternalCapitalSelectionObserver(): void {
  unsubscribe?.();
  unsubscribe = null;
  installed = false;
}