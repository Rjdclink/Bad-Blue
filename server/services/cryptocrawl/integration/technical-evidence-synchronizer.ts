import logger from '../../../logger.js';
import { TradingViewEngine, type TechnicalAnalysis } from '../babel/tradingview-integration.js';

export interface BoundTechnicalEvidence {
  opportunityId: string;
  symbol: string;
  observedAt: number;
  evaluatedAt: number;
  maxAgeMs: number;
  livePrefetchAttempted: boolean;
  analysis: TechnicalAnalysis | null;
  missingInformation: string[];
  provenance: string[];
}

const exactEvidence = new Map<string, BoundTechnicalEvidence>();
const inFlight = new Map<string, Promise<BoundTechnicalEvidence>>();

function key(opportunityId: string, symbol: string, observedAt: number): string {
  return `${opportunityId}:${symbol.trim().toUpperCase()}:${observedAt}`;
}

function usable(analysis: TechnicalAnalysis | null, maxAgeMs: number): boolean {
  if (!analysis) return false;
  if (analysis.dataProvenance !== 'live' && analysis.dataProvenance !== 'cached') return false;
  return Number.isFinite(analysis.sourceTimestamp) &&
    analysis.sourceTimestamp > 0 &&
    Date.now() - analysis.sourceTimestamp <= maxAgeMs;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('technical prefetch timed out')), timeoutMs)),
  ]);
}

/**
 * Exact candidate binding prevents a symbol-level cache entry from being mistaken
 * for evidence collected for another opportunity observation. A fresh cached value
 * is still truthfully labelled cached; a deterministic fallback never satisfies
 * authoritative technical completeness.
 */
export async function getBoundTechnicalEvidence(input: {
  opportunityId: string;
  symbol: string;
  observedAt: number;
  timeframe?: string;
  maxAgeMs?: number;
  waitMs?: number;
}): Promise<BoundTechnicalEvidence> {
  const normalizedSymbol = input.symbol.trim().toUpperCase();
  const evidenceKey = key(input.opportunityId, normalizedSymbol, input.observedAt);
  const existing = exactEvidence.get(evidenceKey);
  if (existing && existing.analysis && usable(existing.analysis, existing.maxAgeMs)) {
    return { ...existing, analysis: { ...existing.analysis }, missingInformation: [...existing.missingInformation], provenance: [...existing.provenance] };
  }
  const pending = inFlight.get(evidenceKey);
  if (pending) return pending;

  const task = (async (): Promise<BoundTechnicalEvidence> => {
    const maxAgeMs = Math.max(5_000, input.maxAgeMs ?? Number(process.env.TRADINGVIEW_DATA_TTL_MS || 300_000));
    const waitMs = Math.max(500, Math.min(15_000, input.waitMs ?? Number(process.env.CRYPTARA_TECHNICAL_PREFETCH_WAIT_MS || 4_000)));
    const timeframe = input.timeframe || '1h';
    let livePrefetchAttempted = false;
    let analysis: TechnicalAnalysis | null = null;

    try {
      analysis = await withTimeout(TradingViewEngine.getAnalysis(normalizedSymbol, timeframe), waitMs);
      if (analysis.dataProvenance === 'cached' && usable(analysis, maxAgeMs)) {
        // A strong deterministic candidate justifies one bounded attempt to bypass
        // the normal cache and obtain a fresh source observation. This uses the
        // existing live transport/rate limiter; failure preserves the cached label.
        const internals = TradingViewEngine as unknown as {
          fetchLiveAnalysis?: (symbol: string, timeframe: string) => Promise<TechnicalAnalysis>;
        };
        if (typeof internals.fetchLiveAnalysis === 'function') {
          livePrefetchAttempted = true;
          try {
            const live = await withTimeout(internals.fetchLiveAnalysis(normalizedSymbol, timeframe), waitMs);
            if (usable(live, maxAgeMs) && live.dataProvenance === 'live') analysis = live;
          } catch (error) {
            logger.debug('[TechnicalSync] Live prefetch unavailable; retaining truthfully labelled cache', {
              component: 'TechnicalEvidenceSynchronizer',
              opportunityId: input.opportunityId,
              symbol: normalizedSymbol,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    } catch (error) {
      logger.debug('[TechnicalSync] Technical evidence unavailable', {
        component: 'TechnicalEvidenceSynchronizer',
        opportunityId: input.opportunityId,
        symbol: normalizedSymbol,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!usable(analysis, maxAgeMs)) analysis = null;
    const result: BoundTechnicalEvidence = {
      opportunityId: input.opportunityId,
      symbol: normalizedSymbol,
      observedAt: input.observedAt,
      evaluatedAt: Date.now(),
      maxAgeMs,
      livePrefetchAttempted,
      analysis,
      missingInformation: analysis ? [] : ['fresh_measured_technical_analysis'],
      provenance: analysis
        ? [`TradingView:${analysis.dataProvenance}`, `technical_source_timestamp:${analysis.sourceTimestamp}`, 'exact_opportunity_binding']
        : ['technical_fallback:non_authoritative', 'exact_opportunity_binding'],
    };
    exactEvidence.set(evidenceKey, result);
    if (exactEvidence.size > 512) {
      const oldest = [...exactEvidence.entries()].sort((a, b) => a[1].evaluatedAt - b[1].evaluatedAt).slice(0, exactEvidence.size - 512);
      for (const [oldKey] of oldest) exactEvidence.delete(oldKey);
    }
    return { ...result, analysis: result.analysis ? { ...result.analysis } : null, missingInformation: [...result.missingInformation], provenance: [...result.provenance] };
  })().finally(() => inFlight.delete(evidenceKey));

  inFlight.set(evidenceKey, task);
  return task;
}
