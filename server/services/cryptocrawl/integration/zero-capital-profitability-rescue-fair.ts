import logger from '../../../logger.js';
import type { providers } from 'ethers';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { ConfiguredZeroCapitalRoute, QuotedZeroCapitalRoute } from '../execution/adapters/onchain-route-quoter.js';
import { primeApeResidentRouting } from './atomic-profitability-resident-routing.js';
import { runZeroCapitalAtomicBpsEngine } from './zero-capital-atomic-bps-engine.js';
import { runZeroCapitalAtomicStackTactic } from './zero-capital-atomic-stack-wiring.js';
import { runZeroCapitalProfitabilityRescueV3 } from './zero-capital-profitability-rescue-v3.js';

export interface FairZeroCapitalProfitabilityRescueInput {
  chain: SupportedChain;
  provider: providers.JsonRpcProvider;
  opportunities: readonly ZeroCapitalOpportunity[];
  configuredRoutes: readonly ConfiguredZeroCapitalRoute[];
  fromQuotedRoute: (quote: QuotedZeroCapitalRoute, blockTimestamp: number) => ZeroCapitalOpportunity;
}

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function recursivePassLimit(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_RECURSIVE_PASSES, 4, 1, 8));
}
function recursiveWallClockBudgetMs(): number {
  return Math.trunc(bounded(process.env.ZERO_CAPITAL_APE_RECURSIVE_MAX_MS, 3_000, 250, 10_000));
}
function stillNeedsMeasuredRescue(opportunity: ZeroCapitalOpportunity): boolean {
  return opportunity.expiresAt > Date.now()
    && opportunity.flashLoanAmount > 0n
    && Number.isFinite(opportunity.netProfitBps)
    && opportunity.expectedProfit <= 0n;
}
function strictDerivedImprovement(before: ZeroCapitalOpportunity, after: ZeroCapitalOpportunity): boolean {
  if (after === before) return false;
  if (!Number.isFinite(before.netProfitBps) || !Number.isFinite(after.netProfitBps)) return false;
  if (before.expectedProfit <= 0n) return after.netProfitBps > before.netProfitBps;
  if (after.expectedProfit <= 0n) return false;
  if (after.expectedProfit !== before.expectedProfit) return after.expectedProfit > before.expectedProfit;
  return after.netProfitBps > before.netProfitBps;
}

/** Stage-1 stays immutable; only derived measured overlays recurse. */
export async function runFairZeroCapitalProfitabilityRescue(
  input: FairZeroCapitalProfitabilityRescueInput,
): Promise<ZeroCapitalOpportunity[]> {
  primeApeResidentRouting(input.opportunities);
  const residentFastPath = runZeroCapitalAtomicBpsEngine({ ...input, opportunities: input.opportunities });
  const activeRescueCandidates = residentFastPath.filter(stillNeedsMeasuredRescue);

  let transformed = residentFastPath;
  let activeMeasuredRescueInvoked = false;
  let activeMeasuredRescueOverlays = 0;
  let alternateRouteIdentityRebindings = 0;
  let activeMeasuredRescueError: string | null = null;
  let recursiveMeasuredPasses = 0;
  let recursiveStrictPositiveStops = 0;
  let recursiveNoImprovementStops = 0;
  let recursiveWallClockStops = 0;
  const rescueStartedAt = Date.now();
  const maxPasses = recursivePassLimit();
  const wallClockBudgetMs = recursiveWallClockBudgetMs();

  if (activeRescueCandidates.length > 0) {
    activeMeasuredRescueInvoked = true;
    try {
      for (let pass = 0; pass < maxPasses; pass += 1) {
        if (Date.now() - rescueStartedAt >= wallClockBudgetMs) {
          recursiveWallClockStops += 1;
          break;
        }
        const passInput = transformed.filter(stillNeedsMeasuredRescue);
        if (passInput.length === 0) break;
        const measured = await runZeroCapitalProfitabilityRescueV3({ ...input, opportunities: passInput });
        recursiveMeasuredPasses += 1;
        const replacements = new Map<string, ZeroCapitalOpportunity>();
        let passImprovements = 0;
        let passStrictPositive = 0;
        measured.forEach((candidate, index) => {
          const prior = passInput[index];
          if (!prior) return;
          let normalized = candidate;
          if (candidate !== prior && candidate.id !== prior.id) {
            alternateRouteIdentityRebindings += 1;
            normalized = { ...candidate, id: prior.id };
          }
          if (!strictDerivedImprovement(prior, normalized)) return;
          replacements.set(prior.id, normalized);
          passImprovements += 1;
          activeMeasuredRescueOverlays += 1;
          if (normalized.expectedProfit > 0n) passStrictPositive += 1;
        });
        if (passImprovements === 0) {
          recursiveNoImprovementStops += 1;
          break;
        }
        transformed = transformed.map(candidate => replacements.get(candidate.id) ?? candidate);
        recursiveStrictPositiveStops += passStrictPositive;
      }
    } catch (error) {
      activeMeasuredRescueError = error instanceof Error ? error.message : String(error);
      logger.warn('[ZeroCapitalProfitabilityRescueFair] Active measured APE recursion degraded locally; latest strict improvements continue', {
        component: 'ZeroCapitalProfitabilityRescueFair', chain: input.chain, error: activeMeasuredRescueError,
        recursiveMeasuredPasses, stageOneMutation: false, priorDerivedImprovementsPreserved: true,
        syntheticEconomics: false, executionAuthority: false,
      });
    }
  }

  const strictPositiveAfterRescue = transformed.filter(opportunity => opportunity.expiresAt > Date.now() && opportunity.expectedProfit > 0n).length;
  const postDecision = setImmediate(() => {
    void runZeroCapitalAtomicStackTactic({ chain: input.chain, provider: input.provider, opportunities: transformed }).catch(error => {
      logger.debug('[ZeroCapitalProfitabilityRescueFair] Post-APE composite tactic degraded locally', {
        component: 'ZeroCapitalProfitabilityRescueFair', chain: input.chain,
        error: error instanceof Error ? error.message : String(error), singleRouteResultAffected: false, executionAuthority: false,
      });
    });
    logger.info('[ZeroCapitalProfitabilityRescueFair] Stage-1 -> APE active rescue continuation completed', {
      component: 'ZeroCapitalProfitabilityRescueFair', chain: input.chain,
      profitabilityFinishLine: 'strict_positive_all_in_base_units', residentFastPathFirst: true,
      activeMeasuredRescueOwner: 'ZeroCapitalProfitabilityRescueV3', activeMeasuredRescueInvoked,
      activeMeasuredRescueCandidates: activeRescueCandidates.length, activeMeasuredRescueOverlays,
      alternateRouteIdentityRebindings, strictPositiveAfterRescue, activeMeasuredRescueError,
      recursiveMeasuredPasses, recursiveMeasuredPassLimit: maxPasses, recursiveWallClockBudgetMs: wallClockBudgetMs,
      recursiveStrictPositiveStops, recursiveNoImprovementStops, recursiveWallClockStops,
      recursivePartialImprovementFeedback: true, recursiveStrictImprovementRequired: true,
      recursiveStopsAtStrictPositivePerCandidate: true, recursiveProviderFailureLocal: true,
      stageOneSameReferenceIntoResidentFastPath: true, activeRescueCreatesDerivedEvidenceOnly: true,
      derivedOverlayPreservesCandidateIdentity: true, alternateRouteEvidencePreservedInDerivedOverlay: true,
      stageOneSameReferenceContinuation: true, stageOneStructuralCopies: 0,
      stageTwoHandoffSupervisorOnHotPath: false, stageTwoAcknowledgementWaitOnHotPath: false,
      stageOneMutation: false, syntheticEconomics: false, externalQueueOnHotPath: false,
      persistenceOnHotPath: false, supabaseOnHotPath: false, compositeTacticInsideSamePipeline: true,
      compositeTacticBlocksSingleRouteReturn: false, compositeTacticScheduledAfterApeDecision: true,
      independentCompositePromotionLoop: false, executionAuthority: false,
    });
  });
  postDecision.unref?.();
  return transformed;
}
