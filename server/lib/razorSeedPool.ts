/**
 * Razor seed pool (one-cycle orchestration)
 *
 * Implements:
 * - Aggregate seeds from generators into a unified pool
 * - Normalize URLs + deduplicate aggressively
 * - Classify seeds with metadata
 * - Score seeds + select capped batch
 * - Seeded RNG for replayable “randomization” (no hidden randomness)
 * - Monte Carlo-ish posterior update (Beta-Binomial) for generator yield
 *
 * This module intentionally avoids long-lived loops.
 */

import type { Razor, RazorInput, SeedCandidate, RazorOutcome, RazorSourceType } from './THE 10 R.A.Z.O.R.S.ts';

export type SeedRecord = SeedCandidate & {
  normalized: string;
  host: string;
  score: number;
};

export type GeneratorPosterior = {
  sourceType: RazorSourceType;
  alpha: number;
  beta: number;
  avgLatencyMs: number;
};

export type CycleConfig = {
  cycleId: string;
  maxSeedsSelected: number;
  maxSeedsProducedPerRazor: number;
};

export type CycleResult = {
  cycleId: string;
  outcomes: RazorOutcome[];
  selected: SeedRecord[];
  poolSize: number;
  posters: GeneratorPosterior[];
};

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    // drop common tracking params
    const drop = new Set([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'gclid',
      'fbclid',
      'mc_cid',
      'mc_eid',
      'ref',
      'ref_src',
    ]);
    for (const k of Array.from(u.searchParams.keys())) {
      if (drop.has(k)) u.searchParams.delete(k);
    }
    // normalize path
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch {
    return null;
  }
}

function scoreSeed(seed: SeedCandidate, posterior: GeneratorPosterior | undefined, rng: () => number): number {
  const base = 0.25;
  const freshnessBoost = seed.freshnessDays == null ? 0 : Math.max(0, 1 - Math.min(30, seed.freshnessDays) / 30) * 0.25;
  const authorityBoost = seed.domainAuthorityHint == null ? 0 : Math.max(0, Math.min(1, seed.domainAuthorityHint)) * 0.25;
  const depthPenalty = seed.structuralDepthHint == null ? 0 : Math.min(1, (seed.structuralDepthHint / 10) * 0.25);

  const meanYield = posterior ? posterior.alpha / (posterior.alpha + posterior.beta) : 0.5;
  const posteriorBoost = meanYield * 0.25;

  // Non-critical randomization, but replayable (seeded RNG).
  const jitter = (rng() - 0.5) * 0.02;

  return Math.max(0, base + freshnessBoost + authorityBoost + posteriorBoost - depthPenalty + jitter);
}

export async function runRazorCycle(params: {
  razors: readonly Razor[];
  inputsByRazorName: Record<string, RazorInput>;
  priorPosteriors?: GeneratorPosterior[];
  config: CycleConfig;
}): Promise<CycleResult> {
  const rng = mulberry32(hash32(params.config.cycleId));
  const prior = new Map((params.priorPosteriors || []).map(p => [p.sourceType, p]));

  const outcomes: RazorOutcome[] = [];
  const pool: SeedRecord[] = [];

  for (const razor of params.razors) {
    const input = params.inputsByRazorName[razor.name] || { endpoints: [] };
    const start = Date.now();
    let produced = 0;
    let errors = 0;

    try {
      const candidates = await razor.generate(input);
      const capped = candidates.slice(0, params.config.maxSeedsProducedPerRazor);
      for (const c of capped) {
        const normalized = normalizeUrl(c.url);
        if (!normalized) continue;
        const host = new URL(normalized).host;
        pool.push({
          ...c,
          normalized,
          host,
          score: 0,
        });
        produced++;
      }
    } catch {
      errors++;
    }

    outcomes.push({
      razorName: razor.name,
      sourceType: razor.sourceType,
      attempted: input.endpoints.length,
      produced,
      errors,
      durationMs: Date.now() - start,
    });
  }

  // Deduplicate aggressively (by normalized URL)
  const uniq = new Map<string, SeedRecord>();
  for (const s of pool) {
    if (!uniq.has(s.normalized)) uniq.set(s.normalized, s);
  }

  // Score
  const scored: SeedRecord[] = [];
  for (const s of uniq.values()) {
    const post = prior.get(s.sourceType);
    scored.push({
      ...s,
      score: scoreSeed(s, post, rng),
    });
  }

  // Select capped batch (deterministic sort; jitter already applied)
  scored.sort((a, b) => b.score - a.score || a.normalized.localeCompare(b.normalized));
  const selected = scored.slice(0, params.config.maxSeedsSelected);

  // Posterior update (very small): treat “produced > 0” as a success signal
  const postersByType = new Map<RazorSourceType, GeneratorPosterior>();
  for (const razor of params.razors) {
    const prev = prior.get(razor.sourceType) || {
      sourceType: razor.sourceType,
      alpha: 1,
      beta: 1,
      avgLatencyMs: 0,
    };
    postersByType.set(razor.sourceType, { ...prev });
  }

  for (const o of outcomes) {
    const p = postersByType.get(o.sourceType);
    if (!p) continue;
    // Beta-Binomial update: success if produced>0
    if (o.produced > 0) p.alpha += 1;
    else p.beta += 1;
    // latency EWMA
    p.avgLatencyMs = p.avgLatencyMs === 0 ? o.durationMs : Math.round(p.avgLatencyMs * 0.8 + o.durationMs * 0.2);
  }

  return {
    cycleId: params.config.cycleId,
    outcomes,
    selected,
    poolSize: uniq.size,
    posters: Array.from(postersByType.values()),
  };
}
