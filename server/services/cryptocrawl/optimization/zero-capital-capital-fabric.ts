import {
  listExternalCapitalCapabilities,
  type ExternalCapitalCapability,
  type ExternalCapitalRole,
} from './external-capital-capability-registry.js';

const FABRIC_ROLES: readonly ExternalCapitalRole[] = [
  'debt_assumption',
  'delegated_credit',
  'intent_principal',
  'netting_capacity',
  'vault_credit',
  'transient_credit',
  'atomic_principal',
  'atomic_intermediation',
];

const OFFSET_ROLES = new Set<ExternalCapitalRole>(['debt_assumption', 'netting_capacity']);

export interface ZeroCapitalFabricRequest {
  asset: string;
  requiredBaseUnits: bigint;
  network?: string;
  permittedRoles?: readonly ExternalCapitalRole[];
  maximumWeightedCostBps?: number;
  requireSameTransactionNeutrality?: boolean;
  now?: number;
}

export interface ZeroCapitalFabricAllocation {
  capabilityId: string;
  protocol: string;
  role: ExternalCapitalRole;
  mechanism: string;
  effect: 'principal_supply' | 'principal_offset';
  amountBaseUnits: bigint;
  measuredCostBps: number;
  observedAt: number;
  expiresAt: number;
  delegatedCanonicalAuthority: string;
  provenance: string[];
}

export interface ZeroCapitalFabricPlan {
  asset: string;
  requiredBaseUnits: bigint;
  offsetBaseUnits: bigint;
  suppliedBaseUnits: bigint;
  uncoveredBaseUnits: bigint;
  weightedCostBps: number | null;
  executable: boolean;
  allocations: ZeroCapitalFabricAllocation[];
  rejectedCapabilityIds: string[];
  noApiKeyDependency: boolean;
  noSignupDependency: boolean;
  systemOwnedPrincipalRequired: boolean;
  operatorCollateralRequired: boolean;
  executionAuthority: false;
  capitalMovementAuthority: false;
  reason: string;
}

function normalizedAsset(value: string): string {
  return value.trim().toLowerCase();
}

function positiveCapacity(capability: ExternalCapitalCapability): bigint | null {
  const raw = capability.availableLiquidityBaseUnits?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = BigInt(raw);
  return value > 0n ? value : null;
}

function measuredCost(capability: ExternalCapitalCapability): number | null {
  const value = Number(capability.measuredCostBps);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function capabilityUsable(
  capability: ExternalCapitalCapability,
  request: ZeroCapitalFabricRequest,
  permittedRoles: ReadonlySet<ExternalCapitalRole>,
  now: number,
): boolean {
  if (!permittedRoles.has(capability.role)) return false;
  if (!capability.bootstrapEligible) return false;
  if (!capability.executionReady) return false;
  if (!capability.delegatedCanonicalAuthority) return false;
  if (capability.requiresSystemOwnedCapital || capability.collateralRequired) return false;
  if (capability.requiresApiKey === true || capability.requiresSignup === true) return false;
  if (capability.expiresAt <= now || capability.observedAt > now) return false;
  if (request.network && capability.network !== request.network && capability.network !== 'evm') return false;
  if (capability.asset && normalizedAsset(capability.asset) !== normalizedAsset(request.asset)) return false;
  if (request.requireSameTransactionNeutrality !== false && capability.sameTransactionDebtNeutralityRequired === false) {
    return false;
  }
  return positiveCapacity(capability) !== null && measuredCost(capability) !== null;
}

function compareCapabilities(left: ExternalCapitalCapability, right: ExternalCapitalCapability): number {
  const leftOffset = OFFSET_ROLES.has(left.role) ? 0 : 1;
  const rightOffset = OFFSET_ROLES.has(right.role) ? 0 : 1;
  if (leftOffset !== rightOffset) return leftOffset - rightOffset;
  const leftCost = measuredCost(left) ?? Number.POSITIVE_INFINITY;
  const rightCost = measuredCost(right) ?? Number.POSITIVE_INFINITY;
  return leftCost - rightCost || left.id.localeCompare(right.id);
}

/**
 * Compose fresh, measured external-capital evidence for one exact settlement asset.
 *
 * This is a planning surface only. It cannot move capital, submit a transaction,
 * create synthetic liquidity, or bypass the canonical topology executor. Offsets
 * (debt assumption / multilateral netting) reduce the amount of transferable
 * principal required; supplies cover the remaining amount. Every selected source
 * must expose a topology-specific canonical authority that performs the real draw,
 * settlement, repayment and terminal verification.
 */
export function composeZeroCapitalFabricPlan(request: ZeroCapitalFabricRequest): ZeroCapitalFabricPlan {
  if (request.requiredBaseUnits <= 0n) throw new Error('Capital fabric requires positive base-unit demand');
  const now = request.now ?? Date.now();
  const permittedRoles = new Set<ExternalCapitalRole>(request.permittedRoles ?? FABRIC_ROLES);
  const candidates = listExternalCapitalCapabilities(now)
    .filter(capability => FABRIC_ROLES.includes(capability.role))
    .sort(compareCapabilities);

  const rejectedCapabilityIds: string[] = [];
  const usable: ExternalCapitalCapability[] = [];
  for (const capability of candidates) {
    if (capabilityUsable(capability, request, permittedRoles, now)) usable.push(capability);
    else rejectedCapabilityIds.push(capability.id);
  }

  let remaining = request.requiredBaseUnits;
  let offsetBaseUnits = 0n;
  let suppliedBaseUnits = 0n;
  let weightedCostNumerator = 0;
  let weightedCostDenominator = 0;
  const allocations: ZeroCapitalFabricAllocation[] = [];

  for (const capability of usable) {
    if (remaining <= 0n) break;
    const capacity = positiveCapacity(capability)!;
    const amount = capacity < remaining ? capacity : remaining;
    if (amount <= 0n) continue;
    const cost = measuredCost(capability)!;
    const effect = OFFSET_ROLES.has(capability.role) ? 'principal_offset' : 'principal_supply';
    allocations.push({
      capabilityId: capability.id,
      protocol: capability.protocol,
      role: capability.role,
      mechanism: capability.mechanism || 'other',
      effect,
      amountBaseUnits: amount,
      measuredCostBps: cost,
      observedAt: capability.observedAt,
      expiresAt: capability.expiresAt,
      delegatedCanonicalAuthority: capability.delegatedCanonicalAuthority!,
      provenance: [...capability.provenance],
    });
    if (effect === 'principal_offset') offsetBaseUnits += amount;
    else suppliedBaseUnits += amount;
    remaining -= amount;

    const numericAmount = Number(amount > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : amount);
    weightedCostNumerator += cost * numericAmount;
    weightedCostDenominator += numericAmount;
  }

  const weightedCostBps = weightedCostDenominator > 0
    ? weightedCostNumerator / weightedCostDenominator
    : null;
  const withinCost = request.maximumWeightedCostBps === undefined
    || (weightedCostBps !== null && weightedCostBps <= request.maximumWeightedCostBps);
  const executable = remaining === 0n && allocations.length > 0 && withinCost;

  return {
    asset: request.asset,
    requiredBaseUnits: request.requiredBaseUnits,
    offsetBaseUnits,
    suppliedBaseUnits,
    uncoveredBaseUnits: remaining,
    weightedCostBps,
    executable,
    allocations,
    rejectedCapabilityIds,
    noApiKeyDependency: allocations.every(allocation => {
      const source = usable.find(capability => capability.id === allocation.capabilityId);
      return source?.requiresApiKey !== true;
    }),
    noSignupDependency: allocations.every(allocation => {
      const source = usable.find(capability => capability.id === allocation.capabilityId);
      return source?.requiresSignup !== true;
    }),
    systemOwnedPrincipalRequired: allocations.some(allocation => {
      const source = usable.find(capability => capability.id === allocation.capabilityId);
      return source?.requiresSystemOwnedCapital === true;
    }),
    operatorCollateralRequired: allocations.some(allocation => {
      const source = usable.find(capability => capability.id === allocation.capabilityId);
      return source?.collateralRequired === true;
    }),
    executionAuthority: false,
    capitalMovementAuthority: false,
    reason: executable
      ? 'Fresh measured no-key/no-signup capital fabric covers the exact base-unit requirement; canonical source adapters still own capital movement and settlement'
      : remaining > 0n
        ? `Measured capital fabric leaves ${remaining.toString()} base units uncovered`
        : 'Measured capital fabric exceeds the configured weighted cost boundary',
  };
}

export function capitalFabricRoles(): readonly ExternalCapitalRole[] {
  return FABRIC_ROLES;
}
