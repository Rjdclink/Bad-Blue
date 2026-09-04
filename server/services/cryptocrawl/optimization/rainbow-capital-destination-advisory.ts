import { getNixGenLiveCexVenueDemand } from './nix-gen/live-priority-registry.js';
import {
  rankExternalCapitalCapabilities,
  type ExternalCapitalRole,
  type RankedExternalCapitalCapability,
} from './external-capital-capability-registry.js';

export interface RainbowCapitalDestinationAdvisory {
  generatedAt: number;
  authority: 'rainbow_capital_destination_advisory';
  executionAuthority: false;
  capitalMovementAuthority: false;
  canonicalEconomicsAuthority: false;
  cexDemand: ReturnType<typeof getNixGenLiveCexVenueDemand>;
  retainedCapitalCandidates: RankedExternalCapitalCapability[];
  capitalSourceCandidates: RankedExternalCapitalCapability[];
  atomicPrincipalCandidates: RankedExternalCapitalCapability[];
  actionableExternalRetainedCapitalCandidates: RankedExternalCapitalCapability[];
  advisoryOnlyExternalCandidates: RankedExternalCapitalCapability[];
}

const RETAINED_ROLES: ExternalCapitalRole[] = ['fixed_lend', 'yield_destination', 'collateral_efficiency'];
const SOURCE_ROLES: ExternalCapitalRole[] = ['fixed_credit', 'collateral_borrow'];

function rankRoles(roles: ExternalCapitalRole[], now: number): RankedExternalCapitalCapability[] {
  return roles
    .flatMap(role => rankExternalCapitalCapabilities(role, now))
    .sort((left, right) =>
      right.economicScore - left.economicScore ||
      right.cryptaraConfidence - left.cryptaraConfidence ||
      right.cryptaraScore - left.cryptaraScore ||
      left.id.localeCompare(right.id),
    );
}

/**
 * One read-only Rainbow view over CEX opportunity demand and external capital
 * capabilities. It never moves money and never marks a protocol executable.
 * External destinations become actionable here only after their provider-specific
 * adapter has already supplied fresh measured economics/capacity/exit evidence and
 * set executionReady=true in the advisory registry.
 */
export function getRainbowCapitalDestinationAdvisory(nowInput = Date.now()): RainbowCapitalDestinationAdvisory {
  const now = Number.isFinite(nowInput) ? Number(nowInput) : Date.now();
  const retainedCapitalCandidates = rankRoles(RETAINED_ROLES, now);
  const capitalSourceCandidates = rankRoles(SOURCE_ROLES, now);
  const atomicPrincipalCandidates = rankExternalCapitalCapabilities('atomic_principal', now);
  const allExternal = [
    ...retainedCapitalCandidates,
    ...capitalSourceCandidates,
    ...atomicPrincipalCandidates,
  ];
  const actionableExternalRetainedCapitalCandidates = retainedCapitalCandidates.filter(candidate =>
    candidate.executionReady === true &&
    candidate.requiresSystemOwnedCapital === true &&
    candidate.economicScore > 0,
  );
  const advisoryOnlyExternalCandidates = allExternal.filter(candidate =>
    !actionableExternalRetainedCapitalCandidates.some(actionable => actionable.id === candidate.id),
  );

  return {
    generatedAt: now,
    authority: 'rainbow_capital_destination_advisory',
    executionAuthority: false,
    capitalMovementAuthority: false,
    canonicalEconomicsAuthority: false,
    cexDemand: getNixGenLiveCexVenueDemand(now),
    retainedCapitalCandidates,
    capitalSourceCandidates,
    atomicPrincipalCandidates,
    actionableExternalRetainedCapitalCandidates,
    advisoryOnlyExternalCandidates,
  };
}
