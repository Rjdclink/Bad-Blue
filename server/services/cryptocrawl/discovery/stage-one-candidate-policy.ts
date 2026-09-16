import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';

/**
 * Locked Stage-One candidate-output boundary.
 *
 * Discovery may observe and preserve evidence at any BPS. Stage One may output only
 * ZERO_CAPITAL_ATOMIC candidates whose fresh measured all-in net spread is strictly
 * greater than -10 BPS. This is a discovery/output classification rule only; it is
 * never execution-profitability authority, which remains strict all-in net > 0.
 */
export const STAGE_ONE_ZERO_CAPITAL_OUTPUT_FLOOR_BPS = -10;

export function clearsStageOneOutputFloorBps(netProfitBps: number): boolean {
  return Number.isFinite(netProfitBps)
    && netProfitBps > STAGE_ONE_ZERO_CAPITAL_OUTPUT_FLOOR_BPS;
}

export function clearsStageOneCandidateOutputFloor(opportunity: ZeroCapitalOpportunity): boolean {
  return clearsStageOneOutputFloorBps(opportunity.netProfitBps);
}
