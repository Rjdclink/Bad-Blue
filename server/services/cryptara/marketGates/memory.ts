import type {
  CryptaraMarketGateContext,
  GateEvaluation,
  GateSignal,
} from './types.js';

interface WorkingMemoryEntry {
  key: string;
  observedAt: number;
  expectedProfitUsd: number | null;
  grossSpreadBps: number | null;
  totalFeeBps: number | null;
  expectedSlippageBps: number | null;
  venueLatencyMs: number | null;
  decision: GateEvaluation['decision'];
}

interface TemporalMemoryEntry {
  key: string;
  firstSeenAt: number;
  lastSeenAt: number;
  samples: number;
  allows: number;
  blocks: number;
  consecutiveAllows: number;
  consecutiveBlocks: number;
  ewmaExpectedProfitUsd: number | null;
  ewmaGrossSpreadBps: number | null;
  ewmaTotalFeeBps: number | null;
  ewmaSlippageBps: number | null;
  ewmaLatencyMs: number | null;
  recentBlockReasons: string[];
  validUntil: number;
}

interface EpisodicMemoryEntry {
  key: string;
  observedAt: number;
  decision: GateEvaluation['decision'];
  blockReasons: string[];
  expectedProfitUsd: number | null;
  grossSpreadBps: number | null;
  totalFeeBps: number | null;
  expectedSlippageBps: number | null;
}

interface ReflectionMemoryEntry {
  key: string;
  createdAt: number;
  sampleCount: number;
  lesson: string;
}

export interface CryptaraMarketMemoryRecall {
  key: string;
  working: WorkingMemoryEntry | null;
  temporal: {
    sampleCount: number;
    allowRate: number;
    consecutiveAllows: number;
    consecutiveBlocks: number;
    ewmaExpectedProfitUsd: number | null;
    ewmaGrossSpreadBps: number | null;
    ewmaTotalFeeBps: number | null;
    ewmaSlippageBps: number | null;
    ewmaLatencyMs: number | null;
    recentBlockReasons: string[];
    lastSeenAt: number;
    validUntil: number;
    fresh: boolean;
  } | null;
  reflection: ReflectionMemoryEntry | null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function ewma(previous: number | null, value: number | null, alpha = 0.25): number | null {
  if (value === null) return previous;
  return previous === null ? value : alpha * value + (1 - alpha) * previous;
}

function routeKey(context: CryptaraMarketGateContext): string {
  const chain = context.chain?.trim().toLowerCase() || 'unknown-chain';
  const pair = context.pairOrSymbol?.trim().toUpperCase() || 'unknown-pair';
  const buyVenue = context.crossVenueFees?.buyVenue?.trim().toLowerCase();
  const sellVenue = context.crossVenueFees?.sellVenue?.trim().toLowerCase();
  const venuePath = buyVenue && sellVenue
    ? `${buyVenue}->${sellVenue}`
    : context.venue?.trim().toLowerCase() || 'unknown-venue';
  return `${chain}|${pair}|${venuePath}`;
}

/**
 * Bounded cognitive memory for market-gate decisions.
 *
 * Design is intentionally advisory:
 * - current live evidence always decides the gate;
 * - memory never fills an unknown critical live signal;
 * - memory never converts BLOCK to ALLOW;
 * - no timers/background loops are created.
 *
 * Existing Cryptara execution history / DeepLearningStore remain authoritative for
 * realized long-term learning. This layer supplies working, temporal, episodic,
 * reflective and procedural-pattern recall for decision continuity.
 */
export class CryptaraMarketMemory {
  private readonly working = new Map<string, WorkingMemoryEntry>();
  private readonly temporal = new Map<string, TemporalMemoryEntry>();
  private readonly episodes: EpisodicMemoryEntry[] = [];
  private readonly reflections = new Map<string, ReflectionMemoryEntry>();
  private readonly workingTtlMs = Math.max(
    30_000,
    Number(process.env.CRYPTARA_WORKING_MEMORY_TTL_MS || 15 * 60_000),
  );
  private readonly temporalTtlMs = Math.max(
    this.workingTtlMs,
    Number(process.env.CRYPTARA_TEMPORAL_MEMORY_TTL_MS || 24 * 60 * 60_000),
  );
  private readonly maxWorkingEntries = Math.max(
    16,
    Number(process.env.CRYPTARA_WORKING_MEMORY_MAX || 128),
  );
  private readonly maxTemporalEntries = Math.max(
    32,
    Number(process.env.CRYPTARA_TEMPORAL_MEMORY_MAX || 512),
  );
  private readonly maxEpisodes = Math.max(
    64,
    Number(process.env.CRYPTARA_EPISODIC_MEMORY_MAX || 1024),
  );

  recall(context: CryptaraMarketGateContext, now = Date.now()): CryptaraMarketMemoryRecall {
    this.prune(now);
    const key = routeKey(context);
    const working = this.working.get(key) || null;
    const temporal = this.temporal.get(key) || null;
    const reflection = this.reflections.get(key) || null;

    return {
      key,
      working: working ? { ...working } : null,
      temporal: temporal
        ? {
            sampleCount: temporal.samples,
            allowRate: temporal.samples > 0 ? temporal.allows / temporal.samples : 0,
            consecutiveAllows: temporal.consecutiveAllows,
            consecutiveBlocks: temporal.consecutiveBlocks,
            ewmaExpectedProfitUsd: temporal.ewmaExpectedProfitUsd,
            ewmaGrossSpreadBps: temporal.ewmaGrossSpreadBps,
            ewmaTotalFeeBps: temporal.ewmaTotalFeeBps,
            ewmaSlippageBps: temporal.ewmaSlippageBps,
            ewmaLatencyMs: temporal.ewmaLatencyMs,
            recentBlockReasons: [...temporal.recentBlockReasons],
            lastSeenAt: temporal.lastSeenAt,
            validUntil: temporal.validUntil,
            fresh: now <= temporal.validUntil,
          }
        : null,
      reflection: reflection ? { ...reflection } : null,
    };
  }

  observe(
    context: CryptaraMarketGateContext,
    evaluation: GateEvaluation,
    now = Date.now(),
  ): CryptaraMarketMemoryRecall {
    const key = routeKey(context);
    const grossSpreadBps = finite(context.crossVenueFees?.grossSpreadBps);
    const totalFeeBps = context.crossVenueFees
      ? finite(context.crossVenueFees.buyTakerFeeBps + context.crossVenueFees.sellTakerFeeBps)
      : finite(context.feesRebates?.takerFeeBps);
    const expectedProfitUsd = finite(context.expectedProfitUsd);
    const expectedSlippageBps = finite(context.slippage?.expectedSlippageBps);
    const venueLatencyValues = Object.values(context.venueLatency?.p50Ms || {}).filter(
      (value): value is number => Number.isFinite(value),
    );
    const venueLatencyMs = venueLatencyValues.length > 0
      ? Math.min(...venueLatencyValues)
      : null;

    const working: WorkingMemoryEntry = {
      key,
      observedAt: now,
      expectedProfitUsd,
      grossSpreadBps,
      totalFeeBps,
      expectedSlippageBps,
      venueLatencyMs,
      decision: evaluation.decision,
    };
    this.working.set(key, working);

    const prior = this.temporal.get(key);
    const allowed = evaluation.decision === 'ALLOW';
    const next: TemporalMemoryEntry = {
      key,
      firstSeenAt: prior?.firstSeenAt ?? now,
      lastSeenAt: now,
      samples: (prior?.samples ?? 0) + 1,
      allows: (prior?.allows ?? 0) + (allowed ? 1 : 0),
      blocks: (prior?.blocks ?? 0) + (allowed ? 0 : 1),
      consecutiveAllows: allowed ? (prior?.consecutiveAllows ?? 0) + 1 : 0,
      consecutiveBlocks: allowed ? 0 : (prior?.consecutiveBlocks ?? 0) + 1,
      ewmaExpectedProfitUsd: ewma(prior?.ewmaExpectedProfitUsd ?? null, expectedProfitUsd),
      ewmaGrossSpreadBps: ewma(prior?.ewmaGrossSpreadBps ?? null, grossSpreadBps),
      ewmaTotalFeeBps: ewma(prior?.ewmaTotalFeeBps ?? null, totalFeeBps),
      ewmaSlippageBps: ewma(prior?.ewmaSlippageBps ?? null, expectedSlippageBps),
      ewmaLatencyMs: ewma(prior?.ewmaLatencyMs ?? null, venueLatencyMs),
      recentBlockReasons: allowed
        ? (prior?.recentBlockReasons ?? []).slice(-4)
        : [...(prior?.recentBlockReasons ?? []), ...evaluation.blockReasons].slice(-8),
      validUntil: now + this.temporalTtlMs,
    };
    this.temporal.set(key, next);

    this.episodes.push({
      key,
      observedAt: now,
      decision: evaluation.decision,
      blockReasons: [...evaluation.blockReasons],
      expectedProfitUsd,
      grossSpreadBps,
      totalFeeBps,
      expectedSlippageBps,
    });
    if (this.episodes.length > this.maxEpisodes) {
      this.episodes.splice(0, this.episodes.length - this.maxEpisodes);
    }

    this.maybeReflect(next, now);
    this.prune(now);
    return this.recall(context, now);
  }

  toSignal(recall: CryptaraMarketMemoryRecall): GateSignal {
    if (!recall.temporal) {
      return {
        id: 'memory.temporal',
        status: 'unknown',
        message: 'No prior route memory',
        details: { key: recall.key },
      };
    }

    const temporal = recall.temporal;
    const reflection = recall.reflection;
    return {
      id: 'memory.temporal',
      status: 'pass',
      score: Math.max(0, Math.min(1, temporal.allowRate)),
      message: `history=${temporal.sampleCount} allowRate=${(temporal.allowRate * 100).toFixed(1)}% streak=${temporal.consecutiveAllows}/${temporal.consecutiveBlocks}`,
      details: {
        key: recall.key,
        sampleCount: temporal.sampleCount,
        allowRate: temporal.allowRate,
        consecutiveAllows: temporal.consecutiveAllows,
        consecutiveBlocks: temporal.consecutiveBlocks,
        ewmaExpectedProfitUsd: temporal.ewmaExpectedProfitUsd,
        ewmaGrossSpreadBps: temporal.ewmaGrossSpreadBps,
        ewmaTotalFeeBps: temporal.ewmaTotalFeeBps,
        ewmaSlippageBps: temporal.ewmaSlippageBps,
        ewmaLatencyMs: temporal.ewmaLatencyMs,
        recentBlockReasons: temporal.recentBlockReasons,
        lastSeenAt: temporal.lastSeenAt,
        validUntil: temporal.validUntil,
        fresh: temporal.fresh,
        reflection: reflection?.lesson ?? null,
      },
    };
  }

  snapshot(): {
    workingEntries: number;
    temporalEntries: number;
    episodes: number;
    reflections: number;
  } {
    return {
      workingEntries: this.working.size,
      temporalEntries: this.temporal.size,
      episodes: this.episodes.length,
      reflections: this.reflections.size,
    };
  }

  private maybeReflect(entry: TemporalMemoryEntry, now: number): void {
    if (entry.samples < 3) return;

    let lesson: string | null = null;
    if (entry.consecutiveBlocks >= 3) {
      const dominant = entry.recentBlockReasons[entry.recentBlockReasons.length - 1] || 'repeated gate rejection';
      lesson = `Recent route context repeatedly blocked (${entry.consecutiveBlocks}x): ${dominant}. Require fresh live evidence of improvement before increasing confidence.`;
    } else if (entry.consecutiveAllows >= 3) {
      lesson = `Recent route context passed ${entry.consecutiveAllows} consecutive live gates. Treat as a known-good pattern only while current evidence remains fresh.`;
    } else if (entry.samples >= 8 && entry.allows / entry.samples < 0.25) {
      lesson = `Historical allow rate is ${(entry.allows / entry.samples * 100).toFixed(1)}% across ${entry.samples} observations. Prioritize alternative routes when live economics are otherwise comparable.`;
    }

    if (lesson) {
      this.reflections.set(entry.key, {
        key: entry.key,
        createdAt: now,
        sampleCount: entry.samples,
        lesson,
      });
    }
  }

  private prune(now: number): void {
    for (const [key, value] of this.working.entries()) {
      if (now - value.observedAt > this.workingTtlMs) this.working.delete(key);
    }
    for (const [key, value] of this.temporal.entries()) {
      if (now > value.validUntil) {
        this.temporal.delete(key);
        this.reflections.delete(key);
      }
    }

    while (this.working.size > this.maxWorkingEntries) {
      const oldest = [...this.working.values()].sort((a, b) => a.observedAt - b.observedAt)[0];
      if (!oldest) break;
      this.working.delete(oldest.key);
    }
    while (this.temporal.size > this.maxTemporalEntries) {
      const oldest = [...this.temporal.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0];
      if (!oldest) break;
      this.temporal.delete(oldest.key);
      this.reflections.delete(oldest.key);
    }
  }
}

export const cryptaraMarketMemory = new CryptaraMarketMemory();
