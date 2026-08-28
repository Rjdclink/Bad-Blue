import { pool } from '../../../db.js';
import logger from '../../../logger.js';

export type LegacyKnowledgeKind =
  | 'strategy_template'
  | 'pattern'
  | 'lesson'
  | 'risk'
  | 'opportunity'
  | 'failure'
  | 'state_snapshot'
  | 'cain_state'
  | 'evolution'
  | 'cataclysm';

export interface LegacyKnowledgeArtifact {
  artifactId: string;
  kind: LegacyKnowledgeKind;
  observedAt: number;
  chain?: string;
  payload: unknown;
  provenance?: string[];
  sourceEventIds?: string[];
}

const QUEUE_LIMIT = Math.max(32, Math.min(2048, Number(process.env.CRYPTARA_LEGACY_COMPAT_QUEUE_LIMIT || 256)));
const queue: LegacyKnowledgeArtifact[] = [];
let draining = false;
let dropped = 0;

function modelVersion(): string {
  return process.env.CRYPTARA_MODEL_VERSION?.trim() || 'cryptara-runtime-v1';
}

function configVersion(): string {
  return process.env.CRYPTOCRAWL_CONFIG_VERSION?.trim()
    || process.env.RAILWAY_GIT_COMMIT_SHA?.trim()
    || process.env.GIT_COMMIT?.trim()
    || 'runtime-config-v1';
}

function observedAt(value: number): Date {
  return new Date(Number.isFinite(value) && value > 0 ? value : Date.now());
}

function normalizedProvenance(input: LegacyKnowledgeArtifact): string[] {
  return [...new Set([
    ...(input.provenance || []),
    'legacy_compatibility_facade',
    'advisory_only',
    'not_execution_evidence',
  ])];
}

async function persistArtifact(input: LegacyKnowledgeArtifact): Promise<void> {
  const provenance = normalizedProvenance(input);
  const sourceEventIds = [...new Set(input.sourceEventIds || [])];
  const model = modelVersion();
  const config = configVersion();
  const at = observedAt(input.observedAt);
  const payload = JSON.stringify({
    compatibilityKind: input.kind,
    chain: input.chain || null,
    value: input.payload,
    authoritativeExecutionEvidence: false,
    authoritativeProfitEvidence: false,
  });

  if (input.kind === 'strategy_template' || input.kind === 'pattern' || input.kind === 'lesson') {
    await pool.query(
      `insert into private.cryptara_patterns (
         pattern_id, pattern_kind, observed_at, model_version, config_version,
         provenance, source_event_ids, payload
       ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       on conflict (pattern_id) do nothing`,
      [input.artifactId, `legacy_${input.kind}`, at, model, config, provenance, sourceEventIds, payload],
    );
    return;
  }

  if (input.kind === 'state_snapshot' || input.kind === 'cain_state' || input.kind === 'evolution') {
    await pool.query(
      `insert into private.cryptara_state_snapshots (
         snapshot_id, snapshot_kind, observed_at, schema_version, model_version,
         config_version, provenance, source_event_ids, payload
       ) values ($1,$2,$3,'legacy-compat-v1',$4,$5,$6,$7,$8::jsonb)
       on conflict (snapshot_id) do nothing`,
      [input.artifactId, `legacy_${input.kind}`, at, model, config, provenance, sourceEventIds, payload],
    );
    return;
  }

  if (input.kind === 'opportunity') {
    await pool.query(
      `insert into private.cryptara_decision_events (
         event_id, opportunity_id, observed_at, decision_kind, decision, model_version,
         config_version, provenance, source_event_ids, payload
       ) values ($1,$1,$2,'legacy_opportunity_observation','advisory_only',$3,$4,$5,$6,$7::jsonb)
       on conflict (event_id) do nothing`,
      [input.artifactId, at, model, config, provenance, sourceEventIds, payload],
    );
    return;
  }

  if (input.kind === 'risk') {
    await pool.query(
      `insert into private.cryptara_risk_snapshots (
         snapshot_id, observed_at, topology, opportunity_id, model_version,
         config_version, provenance, source_event_ids, payload
       ) values ($1,$2,null,null,$3,$4,$5,$6,$7::jsonb)
       on conflict (snapshot_id) do nothing`,
      [input.artifactId, at, model, config, provenance, sourceEventIds, payload],
    );
    return;
  }

  await pool.query(
    `insert into private.cryptara_anomaly_events (
       event_id, observed_at, anomaly_kind, severity, opportunity_id, model_version,
       config_version, provenance, source_event_ids, payload
     ) values ($1,$2,$3,'info',null,$4,$5,$6,$7,$8::jsonb)
     on conflict (event_id) do nothing`,
    [input.artifactId, at, `legacy_${input.kind}`, model, config, provenance, sourceEventIds, payload],
  );
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const artifact = queue.shift()!;
      try {
        await persistArtifact(artifact);
      } catch (error) {
        logger.warn('[IntelligenceMemory] Legacy compatibility artifact persistence degraded', {
          component: 'CanonicalLegacyKnowledgeAdapter',
          artifactId: artifact.artifactId,
          kind: artifact.kind,
          error: error instanceof Error ? error.message : String(error),
          executionBlocked: false,
        });
      }
    }
  } finally {
    draining = false;
  }
}

/**
 * Compatibility-only ingestion into the canonical private schema. It is
 * intentionally write-only and advisory: no legacy record can authorize a trade,
 * become settlement truth, or block canonical execution when persistence fails.
 */
export function observeLegacyCompatibilityArtifact(input: LegacyKnowledgeArtifact): void {
  if (!input.artifactId.trim()) throw new Error('Legacy compatibility artifact requires a stable artifactId');
  if (queue.some(queued => queued.artifactId === input.artifactId)) return;
  if (queue.length >= QUEUE_LIMIT) {
    queue.shift();
    dropped++;
  }
  queue.push({
    ...input,
    provenance: [...(input.provenance || [])],
    sourceEventIds: [...(input.sourceEventIds || [])],
  });
  void drain();
}

export function getLegacyCompatibilityAdapterHealth() {
  return {
    authority: 'canonical_private_schema_compatibility_adapter' as const,
    executionAuthority: false as const,
    settlementAuthority: false as const,
    profitabilityAuthority: false as const,
    executionDependency: false as const,
    queueDepth: queue.length,
    queueLimit: QUEUE_LIMIT,
    dropped,
  };
}
