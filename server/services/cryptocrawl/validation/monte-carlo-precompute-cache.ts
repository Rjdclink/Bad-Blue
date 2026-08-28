import { createHash } from 'node:crypto';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import { quantiComp } from '../../quantiComp/index.js';
import { runProfitabilityMonteCarlo, type MonteCarloProfitabilityInput, type MonteCarloProfitabilityResult } from '../execution/adapters/monte-carlo-profitability.js';

export interface MonteCarloPrecomputeDescriptor {
  marketRegime: string;
  topology: string;
  venuePair: string | null;
  symbol: string | null;
  sizeBucket: string;
  modelVersion: string;
  calibrationVersion: string;
  dataEpoch: string;
  sourceObservedAt: number;
  sourceExpiresAt: number;
}

export interface MonteCarloPrecomputeEntry {
  scenarioKey: string;
  inputHash: string;
  descriptor: MonteCarloPrecomputeDescriptor;
  result: MonteCarloProfitabilityResult;
  computedAt: number;
  expiresAt: number;
  computeAuthority: 'quanti-comp';
  advisoryOnly: true;
  finalValidationRequired: true;
}

const HOT_LIMIT = Math.max(32, Math.min(2048, Number(process.env.CRYPTO_MC_PRECOMPUTE_HOT_LIMIT || 256)));
const MAX_TTL_MS = Math.max(1_000, Math.min(15 * 60_000, Number(process.env.CRYPTO_MC_PRECOMPUTE_MAX_TTL_MS || 60_000)));
const hot = new Map<string, MonteCarloPrecomputeEntry>();

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
function scenarioKey(descriptor: MonteCarloPrecomputeDescriptor): string {
  return [
    descriptor.marketRegime,
    descriptor.topology,
    descriptor.venuePair || 'none',
    descriptor.symbol || 'none',
    descriptor.sizeBucket,
    descriptor.modelVersion,
    descriptor.calibrationVersion,
    descriptor.dataEpoch,
  ].join('|');
}
function boundedExpiry(descriptor: MonteCarloPrecomputeDescriptor, now: number): number {
  return Math.max(now + 1, Math.min(descriptor.sourceExpiresAt, now + MAX_TTL_MS));
}
function validDescriptor(descriptor: MonteCarloPrecomputeDescriptor, now = Date.now()): boolean {
  return Boolean(
    descriptor.marketRegime.trim() && descriptor.topology.trim() && descriptor.sizeBucket.trim()
    && descriptor.modelVersion.trim() && descriptor.calibrationVersion.trim() && descriptor.dataEpoch.trim()
    && Number.isFinite(descriptor.sourceObservedAt) && descriptor.sourceObservedAt > 0
    && Number.isFinite(descriptor.sourceExpiresAt) && descriptor.sourceExpiresAt > now
    && descriptor.sourceObservedAt <= descriptor.sourceExpiresAt
  );
}
function prune(now = Date.now()): void {
  for (const [key, entry] of hot) if (entry.expiresAt <= now) hot.delete(key);
  if (hot.size <= HOT_LIMIT) return;
  const oldest = [...hot.entries()].sort((a,b) => a[1].computedAt - b[1].computedAt);
  for (let index = 0; index < oldest.length - HOT_LIMIT; index++) hot.delete(oldest[index][0]);
}
function clone(entry: MonteCarloPrecomputeEntry): MonteCarloPrecomputeEntry {
  return { ...entry, descriptor: { ...entry.descriptor }, result: { ...entry.result, profitableProbabilityInterval: [...entry.result.profitableProbabilityInterval] as [number, number], distribution: { ...entry.result.distribution }, distributionProvenance: [...entry.result.distributionProvenance] } };
}

async function persist(entry: MonteCarloPrecomputeEntry): Promise<void> {
  const configVersion = process.env.CRYPTOCRAWL_CONFIG_VERSION?.trim() || process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || process.env.GIT_COMMIT?.trim() || 'runtime-config-v1';
  await pool.query(
    `insert into private.cryptara_simulation_results (
      event_id, observed_at, scenario_key, topology, venue_pair, symbol, size_bucket,
      data_epoch, model_version, calibration_version, config_version, expires_at,
      provenance, source_event_ids, payload
    ) values ($1,to_timestamp($2/1000.0),$3,$4,$5,$6,$7,$8,$9,$10,$11,to_timestamp($12/1000.0),$13,$14,$15::jsonb)
    on conflict (event_id) do nothing`,
    [
      `mc-precompute:${entry.inputHash}`,
      entry.computedAt,
      entry.scenarioKey,
      entry.descriptor.topology,
      entry.descriptor.venuePair,
      entry.descriptor.symbol,
      entry.descriptor.sizeBucket,
      entry.descriptor.dataEpoch,
      entry.descriptor.modelVersion,
      entry.descriptor.calibrationVersion,
      configVersion,
      entry.expiresAt,
      ['quanti_comp_precompute','advisory_only','final_validation_required'],
      [],
      JSON.stringify({ inputHash: entry.inputHash, marketRegime: entry.descriptor.marketRegime, result: entry.result }),
    ],
  );
}

export function getMonteCarloPrecompute(
  descriptor: MonteCarloPrecomputeDescriptor,
  input: MonteCarloProfitabilityInput,
  now = Date.now(),
): MonteCarloPrecomputeEntry | null {
  if (!validDescriptor(descriptor, now)) return null;
  prune(now);
  const key = scenarioKey(descriptor);
  const inputHash = sha256({ descriptor, input });
  const entry = hot.get(key);
  if (!entry || entry.inputHash !== inputHash || entry.expiresAt <= now) return null;
  return clone(entry);
}

export async function precomputeMonteCarlo(
  descriptor: MonteCarloPrecomputeDescriptor,
  input: MonteCarloProfitabilityInput,
): Promise<MonteCarloPrecomputeEntry | null> {
  const now = Date.now();
  if (!validDescriptor(descriptor, now)) return null;
  if (!Number.isFinite(input.expectedNetProfitUsd) || input.expectedNetProfitUsd <= 0) return null;
  const key = scenarioKey(descriptor);
  const inputHash = sha256({ descriptor, input });
  const existing = getMonteCarloPrecompute(descriptor, input, now);
  if (existing) return existing;

  const execution = await quantiComp.submit({
    id: `mc-precompute:${inputHash}`,
    kind: 'monte_carlo_precompute',
    lane: 'background',
    priority: 10,
    createdAt: now,
    input,
    features: { monteCarlo: 1, precompute: 1, expectedSamples: Number(input.samples || 0) },
    resourceHints: { cpuWeight: 1, memoryMB: 64, ioWeight: 0, preferredBackend: 'worker_thread', parallelismHint: 1 },
    policy: {
      timeoutMs: Math.max(250, Number(process.env.CRYPTO_MC_PRECOMPUTE_TIMEOUT_MS || 5_000)),
      deadlineAt: descriptor.sourceExpiresAt,
      deterministic: true,
      sideEffectFree: true,
      backendEligible: true,
      allowDeduplication: true,
      dedupeKey: inputHash,
      usefulWorkUnits: Math.max(1, Number(input.samples || 1)),
      strictValidation: true,
    },
    execute: value => runProfitabilityMonteCarlo(value),
    validate: result => Boolean(
      result && Number.isFinite(result.profitableProbability)
      && result.profitableProbability >= 0 && result.profitableProbability <= 1
      && Number.isFinite(result.p10NetProfitUsd)
      && Number.isFinite(result.expectedShortfall95Usd)
    ),
  });

  const computedAt = Date.now();
  const entry: MonteCarloPrecomputeEntry = {
    scenarioKey: key,
    inputHash,
    descriptor: { ...descriptor },
    result: execution.result,
    computedAt,
    expiresAt: boundedExpiry(descriptor, computedAt),
    computeAuthority: 'quanti-comp',
    advisoryOnly: true,
    finalValidationRequired: true,
  };
  hot.set(key, entry);
  prune(computedAt);
  void persist(entry).catch(error => logger.warn('[MonteCarloPrecompute] durable cache persistence degraded', {
    component: 'MonteCarloPrecomputeCache',
    scenarioKey: key,
    error: error instanceof Error ? error.message : String(error),
    executionBlocked: false,
  }));
  return clone(entry);
}

export function getMonteCarloPrecomputeCacheHealth() {
  prune();
  return {
    entries: hot.size,
    limit: HOT_LIMIT,
    maxTtlMs: MAX_TTL_MS,
    computeAuthority: 'quanti-comp' as const,
    advisoryOnly: true as const,
    finalDeterministicValidationRequired: true as const,
    finalMonteCarloValidationRequired: true as const,
    executionAuthority: false as const,
  };
}
