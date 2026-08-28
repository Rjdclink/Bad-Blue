import { createHash } from 'node:crypto';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';

export type ModelLifecycleStatus = 'shadow' | 'candidate' | 'promoted' | 'retired' | 'rejected';

export interface ModelCheckpoint<TState = unknown> {
  modelId: string;
  modelKind: string;
  modelVersion: string;
  status: ModelLifecycleStatus;
  state: TState;
  observedAt: number;
  provenance: string[];
  parentModelId?: string | null;
}

export interface ModelMetric {
  modelId: string;
  metricName: string;
  metricValue: number;
  evaluationScope: string;
  observedAt: number;
  provenance: string[];
  sourceEventIds?: string[];
}

const checkpoints = new Map<string, ModelCheckpoint>();
const MAX_HOT_CHECKPOINTS = Math.max(16, Math.min(1024, Number(process.env.CRYPTO_MODEL_REGISTRY_HOT_LIMIT || 128)));

function configVersion(): string {
  return process.env.CRYPTOCRAWL_CONFIG_VERSION?.trim()
    || process.env.RAILWAY_GIT_COMMIT_SHA?.trim()
    || process.env.GIT_COMMIT?.trim()
    || 'runtime-config-v1';
}
function eventId(prefix: string, value: unknown): string {
  return `${prefix}:${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)}`;
}
function prune(): void {
  if (checkpoints.size <= MAX_HOT_CHECKPOINTS) return;
  const oldest = [...checkpoints.values()].sort((a,b) => a.observedAt - b.observedAt);
  for (let index = 0; index < oldest.length - MAX_HOT_CHECKPOINTS; index++) checkpoints.delete(oldest[index].modelId);
}
function clone<T>(checkpoint: ModelCheckpoint<T>): ModelCheckpoint<T> {
  return { ...checkpoint, provenance: [...checkpoint.provenance] };
}

async function persistCheckpoint<T>(checkpoint: ModelCheckpoint<T>): Promise<void> {
  await pool.query(
    `insert into private.cryptara_model_registry (
       model_id, model_kind, model_version, status, promoted_at, retired_at,
       provenance, source_event_ids, payload, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now())
     on conflict (model_id) do update set
       model_kind=excluded.model_kind,
       model_version=excluded.model_version,
       status=excluded.status,
       promoted_at=excluded.promoted_at,
       retired_at=excluded.retired_at,
       provenance=excluded.provenance,
       source_event_ids=excluded.source_event_ids,
       payload=excluded.payload,
       updated_at=now()`,
    [
      checkpoint.modelId,
      checkpoint.modelKind,
      checkpoint.modelVersion,
      checkpoint.status,
      checkpoint.status === 'promoted' ? new Date(checkpoint.observedAt) : null,
      checkpoint.status === 'retired' ? new Date(checkpoint.observedAt) : null,
      checkpoint.provenance,
      checkpoint.parentModelId ? [checkpoint.parentModelId] : [],
      JSON.stringify({ state: checkpoint.state, parentModelId: checkpoint.parentModelId || null, executionAuthority: false }),
    ],
  );
}

export async function registerModelCheckpoint<T>(checkpoint: ModelCheckpoint<T>): Promise<void> {
  if (!checkpoint.modelId.trim() || !checkpoint.modelKind.trim() || !checkpoint.modelVersion.trim()) throw new Error('Model checkpoint identity is required');
  if (!Number.isFinite(checkpoint.observedAt) || checkpoint.observedAt <= 0) throw new Error('Model checkpoint observedAt is invalid');
  checkpoints.set(checkpoint.modelId, clone(checkpoint));
  prune();
  try {
    await persistCheckpoint(checkpoint);
  } catch (error) {
    logger.warn('[ModelRegistry] checkpoint persistence degraded', {
      component: 'ModelRegistry', modelId: checkpoint.modelId,
      error: error instanceof Error ? error.message : String(error), executionBlocked: false,
    });
  }
}

export async function recordModelMetric(metric: ModelMetric, modelVersion: string): Promise<void> {
  if (!Number.isFinite(metric.metricValue)) return;
  const id = eventId('model-metric', metric);
  try {
    await pool.query(
      `insert into private.cryptara_model_metrics (
         event_id, model_id, observed_at, metric_name, metric_value, evaluation_scope,
         model_version, config_version, provenance, source_event_ids, payload
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       on conflict (event_id) do nothing`,
      [id, metric.modelId, new Date(metric.observedAt), metric.metricName, metric.metricValue,
       metric.evaluationScope, modelVersion, configVersion(), metric.provenance,
       metric.sourceEventIds || [], JSON.stringify({ advisoryOnly: true, executionAuthority: false })],
    );
  } catch (error) {
    logger.warn('[ModelRegistry] metric persistence degraded', {
      component: 'ModelRegistry', modelId: metric.modelId, metricName: metric.metricName,
      error: error instanceof Error ? error.message : String(error), executionBlocked: false,
    });
  }
}

export async function transitionModel(input: {
  modelId: string;
  to: ModelLifecycleStatus;
  allowedFrom: ModelLifecycleStatus[];
  provenance: string[];
}): Promise<boolean> {
  const checkpoint = checkpoints.get(input.modelId);
  if (!checkpoint || !input.allowedFrom.includes(checkpoint.status)) return false;
  const next = { ...checkpoint, status: input.to, observedAt: Date.now(), provenance: [...new Set([...checkpoint.provenance, ...input.provenance])] };
  checkpoints.set(input.modelId, next);
  await persistCheckpoint(next).catch(error => logger.warn('[ModelRegistry] lifecycle transition persistence degraded', {
    component: 'ModelRegistry', modelId: input.modelId, error: error instanceof Error ? error.message : String(error), executionBlocked: false,
  }));
  return true;
}

export async function promoteModel(modelId: string): Promise<boolean> {
  const target = checkpoints.get(modelId);
  if (!target || !['shadow','candidate'].includes(target.status)) return false;
  for (const checkpoint of checkpoints.values()) {
    if (checkpoint.modelKind === target.modelKind && checkpoint.status === 'promoted' && checkpoint.modelId !== modelId) {
      await transitionModel({ modelId: checkpoint.modelId, to: 'retired', allowedFrom: ['promoted'], provenance: [`replaced_by:${modelId}`] });
    }
  }
  return transitionModel({ modelId, to: 'promoted', allowedFrom: ['shadow','candidate'], provenance: ['explicit_model_promotion'] });
}

export async function rollbackModel(modelKind: string, previousModelId: string): Promise<boolean> {
  const previous = checkpoints.get(previousModelId);
  if (!previous || previous.modelKind !== modelKind || !['retired','candidate','shadow'].includes(previous.status)) return false;
  for (const checkpoint of checkpoints.values()) {
    if (checkpoint.modelKind === modelKind && checkpoint.status === 'promoted') {
      await transitionModel({ modelId: checkpoint.modelId, to: 'retired', allowedFrom: ['promoted'], provenance: [`rollback_to:${previousModelId}`] });
    }
  }
  return transitionModel({ modelId: previousModelId, to: 'promoted', allowedFrom: ['retired','candidate','shadow'], provenance: ['explicit_model_rollback'] });
}

export function getModelCheckpoint<T = unknown>(modelId: string): ModelCheckpoint<T> | null {
  const checkpoint = checkpoints.get(modelId) as ModelCheckpoint<T> | undefined;
  return checkpoint ? clone(checkpoint) : null;
}

export function getPromotedModel<T = unknown>(modelKind: string): ModelCheckpoint<T> | null {
  const checkpoint = [...checkpoints.values()].filter(item => item.modelKind === modelKind && item.status === 'promoted')
    .sort((a,b) => b.observedAt - a.observedAt)[0] as ModelCheckpoint<T> | undefined;
  return checkpoint ? clone(checkpoint) : null;
}

export function getModelRegistryHealth() {
  return {
    hotCheckpoints: checkpoints.size,
    hotLimit: MAX_HOT_CHECKPOINTS,
    lifecycle: ['train','evaluate','shadow','candidate','promote','rollback','retire'] as const,
    advisoryPredictionAuthority: true as const,
    executionAuthority: false as const,
    rlAuthority: 'shadow_research_only' as const,
    pythonControlPlaneRequired: false as const,
  };
}
