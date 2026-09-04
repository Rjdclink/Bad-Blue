import logger from '../../../logger.js';
import { getCryptaraZeroInitialCapitalFundingLearning } from '../../cryptara/zero-capital-funding-learning.js';

export type ZeroInitialCapitalPreparationStatus = 'available' | 'unavailable' | 'rejected' | 'stale';
export type ZeroInitialCapitalExecutionStatus = 'confirmed' | 'definitive_failure' | 'ambiguous';

export interface ZeroInitialCapitalPreparedCandidate<TPrepared> {
  laneId: string;
  provider: string;
  prepared: TPrepared;
  expiresAt: number;
  estimatedAllInCostUsd: number;
  guaranteedResidualProfitUsd: number;
  scoreBias?: number;
}

export interface ZeroInitialCapitalPrepareResult<TPrepared> {
  status: ZeroInitialCapitalPreparationStatus;
  candidate?: ZeroInitialCapitalPreparedCandidate<TPrepared>;
  reason?: string;
}

export interface ZeroInitialCapitalExecutionResult<TResult> {
  status: ZeroInitialCapitalExecutionStatus;
  result?: TResult;
  reason?: string;
  realizedCostUsd?: number;
  residualProfitUsd?: number;
}

export interface ZeroInitialCapitalLane<TContext, TPrepared, TResult> {
  id: string;
  provider: string;
  priority: number;
  redundancyDepth?: number;
  supports(context: TContext): boolean | Promise<boolean>;
  prepare(context: TContext, signal: AbortSignal): Promise<ZeroInitialCapitalPrepareResult<TPrepared>>;
  execute(candidate: ZeroInitialCapitalPreparedCandidate<TPrepared>, signal: AbortSignal): Promise<ZeroInitialCapitalExecutionResult<TResult>>;
}

export interface ZeroInitialCapitalRunInput<TContext> {
  opportunityId: string;
  chain: string;
  strategy: string;
  expiresAt: number;
  context: TContext;
  lanes: Array<ZeroInitialCapitalLane<TContext, any, any>>;
  maxRetriesPerLane?: number;
  retryBaseDelayMs?: number;
  freshnessCheck?: () => Promise<{ fresh: boolean; reason?: string }>;
  canonicalEconomicsCheck?: (candidate: ZeroInitialCapitalPreparedCandidate<any>) => Promise<{ approved: boolean; reason?: string }>;
}

export interface ZeroInitialCapitalRunResult<TResult = unknown> {
  status: 'confirmed' | 'exhausted' | 'ambiguous' | 'stale' | 'busy';
  laneId?: string;
  provider?: string;
  result?: TResult;
  reason?: string;
  attempts: number;
  quarantined: boolean;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('retry cancelled'));
    }, { once: true });
  });
}

export class ZeroInitialCapitalDynamicOrchestrator {
  private readonly active = new Set<string>();
  private readonly learning = getCryptaraZeroInitialCapitalFundingLearning();

  async run<TResult = unknown>(input: ZeroInitialCapitalRunInput<any>): Promise<ZeroInitialCapitalRunResult<TResult>> {
    if (this.active.has(input.opportunityId)) {
      return { status: 'busy', attempts: 0, quarantined: false, reason: 'Opportunity already has a zero-initial-capital orchestration in flight' };
    }

    this.active.add(input.opportunityId);
    const maxRetries = Math.max(0, Math.min(8, input.maxRetriesPerLane ?? Number(process.env.ZERO_INITIAL_CAPITAL_RETRIES_PER_LANE || 2)));
    const retryBaseDelayMs = Math.max(0, Number(input.retryBaseDelayMs ?? process.env.ZERO_INITIAL_CAPITAL_RETRY_BASE_MS ?? 75));
    let attempts = 0;
    const controller = new AbortController();

    try {
      const freshness = await this.checkFreshness(input);
      if (!freshness.fresh) return { status: 'stale', attempts, quarantined: false, reason: freshness.reason || 'Opportunity is stale' };

      const supportedSettled = await Promise.allSettled(input.lanes.map(async lane => ({ lane, supported: await lane.supports(input.context) })));
      const supported = supportedSettled
        .filter((item): item is PromiseFulfilledResult<{ lane: ZeroInitialCapitalLane<any, any, any>; supported: boolean }> => item.status === 'fulfilled')
        .map(item => item.value)
        .filter(item => item.supported)
        .map(item => item.lane);

      if (supported.length === 0) {
        return { status: 'exhausted', attempts, quarantined: false, reason: 'No zero-initial-capital funding lane supports this opportunity' };
      }

      // Preparation is deliberately parallel. Submission is deliberately serialized below.
      const preparations = await Promise.allSettled(supported.map(async lane => {
        const startedAt = Date.now();
        try {
          const prepared = await lane.prepare(input.context, controller.signal);
          this.learning.record({
            opportunityId: input.opportunityId,
            chain: input.chain,
            strategy: input.strategy,
            laneId: lane.id,
            provider: lane.provider,
            stage: 'prepare',
            outcome: prepared.status === 'available' ? 'success' : prepared.status,
            latencyMs: Date.now() - startedAt,
            retryOrdinal: 0,
            redundancyDepth: lane.redundancyDepth || 0,
            estimatedCostUsd: prepared.candidate?.estimatedAllInCostUsd,
            guaranteedResidualProfitUsd: prepared.candidate?.guaranteedResidualProfitUsd,
            observedAt: Date.now(),
            reason: prepared.reason,
          });
          return { lane, prepared };
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.learning.record({
            opportunityId: input.opportunityId,
            chain: input.chain,
            strategy: input.strategy,
            laneId: lane.id,
            provider: lane.provider,
            stage: 'prepare',
            outcome: 'definitive_failure',
            latencyMs: Date.now() - startedAt,
            retryOrdinal: 0,
            redundancyDepth: lane.redundancyDepth || 0,
            observedAt: Date.now(),
            reason,
          });
          return { lane, prepared: { status: 'unavailable' as const, reason } };
        }
      }));

      const candidates = preparations
        .filter((item): item is PromiseFulfilledResult<{ lane: ZeroInitialCapitalLane<any, any, any>; prepared: ZeroInitialCapitalPrepareResult<any> }> => item.status === 'fulfilled')
        .map(item => item.value)
        .filter(item => item.prepared.status === 'available' && !!item.prepared.candidate)
        .map(item => ({ lane: item.lane, candidate: item.prepared.candidate! }))
        .filter(item => item.candidate.expiresAt > Date.now() && item.candidate.guaranteedResidualProfitUsd > 0);

      candidates.sort((left, right) => {
        const leftScore = this.learning.score(left.lane.id) * 100 + left.lane.priority + (left.candidate.scoreBias || 0) + Math.log1p(left.candidate.guaranteedResidualProfitUsd);
        const rightScore = this.learning.score(right.lane.id) * 100 + right.lane.priority + (right.candidate.scoreBias || 0) + Math.log1p(right.candidate.guaranteedResidualProfitUsd);
        return rightScore - leftScore;
      });

      for (const entry of candidates) {
        for (let retryOrdinal = 0; retryOrdinal <= maxRetries; retryOrdinal++) {
          const fresh = await this.checkFreshness(input);
          if (!fresh.fresh || Date.now() >= entry.candidate.expiresAt) {
            this.learning.record({
              opportunityId: input.opportunityId,
              chain: input.chain,
              strategy: input.strategy,
              laneId: entry.lane.id,
              provider: entry.lane.provider,
              stage: 'submit',
              outcome: 'stale',
              latencyMs: 0,
              retryOrdinal,
              redundancyDepth: entry.lane.redundancyDepth || 0,
              observedAt: Date.now(),
              reason: fresh.reason || 'Prepared candidate expired before submission',
            });
            break;
          }

          if (input.canonicalEconomicsCheck) {
            const economics = await input.canonicalEconomicsCheck(entry.candidate);
            if (!economics.approved) {
              this.learning.record({
                opportunityId: input.opportunityId,
                chain: input.chain,
                strategy: input.strategy,
                laneId: entry.lane.id,
                provider: entry.lane.provider,
                stage: 'submit',
                outcome: 'rejected',
                latencyMs: 0,
                retryOrdinal,
                redundancyDepth: entry.lane.redundancyDepth || 0,
                estimatedCostUsd: entry.candidate.estimatedAllInCostUsd,
                guaranteedResidualProfitUsd: entry.candidate.guaranteedResidualProfitUsd,
                observedAt: Date.now(),
                reason: economics.reason || 'Canonical all-in economics rejected candidate',
              });
              break;
            }
          }

          if (retryOrdinal > 0) {
            await wait(retryBaseDelayMs * 2 ** Math.min(5, retryOrdinal - 1), controller.signal);
            const refreshed = await entry.lane.prepare(input.context, controller.signal);
            if (refreshed.status !== 'available' || !refreshed.candidate) break;
            entry.candidate = refreshed.candidate;
          }

          attempts++;
          const startedAt = Date.now();
          const execution = await entry.lane.execute(entry.candidate, controller.signal);
          const outcome = execution.status === 'confirmed'
            ? 'success'
            : execution.status === 'ambiguous'
              ? 'ambiguous'
              : 'definitive_failure';
          this.learning.record({
            opportunityId: input.opportunityId,
            chain: input.chain,
            strategy: input.strategy,
            laneId: entry.lane.id,
            provider: entry.lane.provider,
            stage: execution.status === 'confirmed' ? 'settlement' : 'submit',
            outcome,
            latencyMs: Date.now() - startedAt,
            retryOrdinal,
            redundancyDepth: entry.lane.redundancyDepth || 0,
            estimatedCostUsd: entry.candidate.estimatedAllInCostUsd,
            realizedCostUsd: execution.realizedCostUsd,
            guaranteedResidualProfitUsd: entry.candidate.guaranteedResidualProfitUsd,
            observedAt: Date.now(),
            reason: execution.reason,
          });

          if (execution.status === 'confirmed') {
            controller.abort();
            return {
              status: 'confirmed',
              laneId: entry.lane.id,
              provider: entry.lane.provider,
              result: execution.result as TResult,
              attempts,
              quarantined: false,
            };
          }
          if (execution.status === 'ambiguous') {
            controller.abort();
            return {
              status: 'ambiguous',
              laneId: entry.lane.id,
              provider: entry.lane.provider,
              attempts,
              quarantined: true,
              reason: execution.reason || 'Submission status is ambiguous; opportunity is quarantined for reconciliation',
            };
          }
          // Definitive failure is safe to retry, then safe to move to the next redundancy.
        }
      }

      return { status: 'exhausted', attempts, quarantined: false, reason: 'All safe zero-initial-capital retries and redundancies were exhausted' };
    } catch (error) {
      logger.warn('[ZeroInitialCapital] Dynamic orchestration degraded locally; global strategy operation remains unaffected', {
        component: 'ZeroInitialCapitalDynamicOrchestrator',
        opportunityId: input.opportunityId,
        error: error instanceof Error ? error.message : String(error),
        globalHaltAuthority: false,
      });
      return {
        status: 'exhausted',
        attempts,
        quarantined: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    } finally {
      controller.abort();
      this.active.delete(input.opportunityId);
    }
  }

  private async checkFreshness(input: ZeroInitialCapitalRunInput<any>): Promise<{ fresh: boolean; reason?: string }> {
    if (Date.now() >= input.expiresAt) return { fresh: false, reason: 'Opportunity TTL expired' };
    return input.freshnessCheck ? input.freshnessCheck() : { fresh: true };
  }
}

let singleton: ZeroInitialCapitalDynamicOrchestrator | null = null;

export function getZeroInitialCapitalDynamicOrchestrator(): ZeroInitialCapitalDynamicOrchestrator {
  if (!singleton) singleton = new ZeroInitialCapitalDynamicOrchestrator();
  return singleton;
}
