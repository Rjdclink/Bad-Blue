import crypto from 'node:crypto';
import os from 'node:os';
import type { PantheonTransport } from './PantheonCrawlerCapabilityMatrix';

export type PantheonFrontierMode = 'database' | 'local';

export interface PantheonFrontierSeed {
  reportId: string;
  categoryIndex: number;
  categoryLabel: string;
  canonicalUrl: string;
  priority: number;
  transport: PantheonTransport;
  capability: string;
  requiredCapabilities: readonly string[];
  state: string;
}

export interface PantheonFrontierClaim extends PantheonFrontierSeed {
  mode: PantheonFrontierMode;
  acquired: boolean;
  workKey: string;
  leaseToken?: string;
  startedAt: number;
}

export interface PantheonJobLease {
  mode: PantheonFrontierMode;
  acquired: boolean;
  reportId: string;
  leaseToken?: string;
}

export interface PantheonDomainLease {
  mode: PantheonFrontierMode;
  acquired: boolean;
  domain: string;
  leaseToken?: string;
  slot?: number;
}

const PROCESS_OWNER = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
const FRONTIER_LEASE_MS = 45_000;
const JOB_LEASE_MS = 120_000;
const SCHEMA_RECHECK_MS = 60_000;
const DOMAIN_SLOT_COUNT = 2;
let schemaState: 'unknown' | 'ready' | 'unavailable' = 'unknown';
let schemaCheckedAt = 0;
let unavailableWarningAt = 0;
const preparedDomains = new Set<string>();
const preparedWorkKeys = new Set<string>();
const MAX_PREPARED_KEYS = 100_000;

function hasDatabaseEnvironment(): boolean {
  // Build-time behavioral verifiers intentionally exercise the bounded local
  // frontier without importing the runtime database/config graph.
  if (process.env.PANTHEON_FRONTIER_LOCAL_ONLY === '1') return false;
  return Boolean(
    String(process.env.SUPABASE_DATABASE_URL || '').trim()
    || String(process.env.SUPABASE_DB_URL || '').trim()
    || String(process.env.DATABASE_URL || '').trim(),
  );
}

function workKey(seed: Pick<PantheonFrontierSeed, 'reportId' | 'categoryIndex' | 'canonicalUrl'>): string {
  return crypto.createHash('sha256')
    .update(`${seed.reportId}\n${seed.categoryIndex}\n${seed.canonicalUrl}`)
    .digest('hex');
}

function sourceDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return 'invalid.invalid';
  }
}

function databaseErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rememberPreparedWorkKey(key: string): void {
  preparedWorkKeys.add(key);
  if (preparedWorkKeys.size <= MAX_PREPARED_KEYS) return;
  const oldest = preparedWorkKeys.values().next().value as string | undefined;
  if (oldest) preparedWorkKeys.delete(oldest);
}

function warnLocalFallback(error: unknown): void {
  const now = Date.now();
  if (now - unavailableWarningAt < SCHEMA_RECHECK_MS) return;
  unavailableWarningAt = now;
  console.warn('[PANTHEON FRONTIER] Durable coordination unavailable; preserving bounded local execution', {
    error: databaseErrorText(error).slice(0, 300),
  });
}

async function hasFrontierSchema(): Promise<boolean> {
  if (!hasDatabaseEnvironment()) return false;
  const database = await import('../../db');
  if (!database.isDatabaseConfigured) return false;
  const now = Date.now();
  if (schemaState !== 'unknown' && now - schemaCheckedAt < SCHEMA_RECHECK_MS) {
    return schemaState === 'ready';
  }
  schemaCheckedAt = now;
  try {
    const result = await database.pool.query({
      text: `SELECT
        to_regclass('public.pantheon_frontier_items') IS NOT NULL AS frontier,
        to_regclass('public.pantheon_job_leases') IS NOT NULL AS jobs,
        to_regclass('public.pantheon_frontier_outcomes') IS NOT NULL AS outcomes,
        to_regclass('public.pantheon_domain_policy') IS NOT NULL AS policy,
        to_regclass('public.pantheon_domain_leases') IS NOT NULL AS domains`,
      query_timeout: 3_000,
    } as any);
    const row = result.rows?.[0];
    schemaState = row?.frontier && row?.jobs && row?.outcomes && row?.policy && row?.domains ? 'ready' : 'unavailable';
  } catch (error) {
    schemaState = 'unavailable';
    warnLocalFallback(error);
  }
  return schemaState === 'ready';
}

async function frontierQuery<T = any>(query: { text: string; values?: unknown[] }): Promise<T[] | null> {
  if (!(await hasFrontierSchema())) return null;
  try {
    const database = await import('../../db');
    const result = await database.pool.query({ ...query, query_timeout: 5_000 } as any);
    return result.rows as T[];
  } catch (error) {
    schemaState = 'unavailable';
    schemaCheckedAt = Date.now();
    warnLocalFallback(error);
    return null;
  }
}

export function pantheonFrontierWorkKey(
  seed: Pick<PantheonFrontierSeed, 'reportId' | 'categoryIndex' | 'canonicalUrl'>,
): string {
  return workKey(seed);
}

export async function preparePantheonFrontier(seeds: readonly PantheonFrontierSeed[]): Promise<PantheonFrontierMode> {
  if (!seeds.length) return 'local';
  const rows = await frontierQuery({
    text: `
      INSERT INTO public.pantheon_frontier_items (
        work_key, report_id, category_index, category_label, canonical_url,
        source_domain, priority, transport, capability, required_capabilities, state
      )
      SELECT
        item.work_key,
        item.report_id::uuid,
        item.category_index,
        item.category_label,
        item.canonical_url,
        item.source_domain,
        item.priority,
        item.transport,
        item.capability,
        item.required_capabilities,
        CASE WHEN item.state IN ('pending', 'retryable') THEN item.state ELSE 'pending' END
      FROM jsonb_to_recordset($1::jsonb) AS item(
        work_key text,
        report_id text,
        category_index smallint,
        category_label text,
        canonical_url text,
        source_domain text,
        priority integer,
        transport text,
        capability text,
        required_capabilities text[],
        state text
      )
      ON CONFLICT (work_key) DO UPDATE SET
        priority = EXCLUDED.priority,
        transport = EXCLUDED.transport,
        capability = EXCLUDED.capability,
        required_capabilities = EXCLUDED.required_capabilities,
        state = CASE
          WHEN public.pantheon_frontier_items.state IN ('accepted', 'no_evidence', 'rejected', 'blocked', 'dead', 'not_applicable')
            THEN public.pantheon_frontier_items.state
          WHEN public.pantheon_frontier_items.lease_expires_at > now()
            THEN public.pantheon_frontier_items.state
          ELSE EXCLUDED.state
        END,
        updated_at = now()
      RETURNING work_key`,
    values: [JSON.stringify(seeds.map(seed => ({
      work_key: workKey(seed),
      report_id: seed.reportId,
      category_index: seed.categoryIndex,
      category_label: seed.categoryLabel,
      canonical_url: seed.canonicalUrl,
      source_domain: sourceDomain(seed.canonicalUrl),
      priority: seed.priority,
      transport: seed.transport,
      capability: seed.capability,
      required_capabilities: [...seed.requiredCapabilities],
      state: seed.state,
    })))],
  });
  if (rows) {
    for (const seed of seeds) rememberPreparedWorkKey(workKey(seed));
    return 'database';
  }
  return 'local';
}

export async function claimPantheonFrontierItem(
  seed: PantheonFrontierSeed,
  deadlineAt: number,
): Promise<PantheonFrontierClaim> {
  const startedAt = Date.now();
  const key = workKey(seed);
  const leaseToken = crypto.randomUUID();
  if (!preparedWorkKeys.has(key)) {
    const prepared = await preparePantheonFrontier([seed]);
    if (prepared === 'local') return { ...seed, mode: 'local', acquired: true, workKey: key, startedAt };
  }

  const rows = await frontierQuery<{ lease_token: string }>({
    text: `
      UPDATE public.pantheon_frontier_items
      SET state = 'leased',
          attempts = attempts + 1,
          lease_owner = $2,
          lease_token = $3::uuid,
          lease_expires_at = LEAST(to_timestamp($4 / 1000.0), now() + ($5::integer * interval '1 millisecond')),
          deadline_at = to_timestamp($4 / 1000.0),
          started_at = now(),
          completed_at = NULL,
          failure_reason = NULL,
          updated_at = now()
      WHERE work_key = $1
        AND (
          state IN ('pending', 'retryable', 'rate_limited', 'timed_out')
          OR (state IN ('leased', 'retrieving') AND lease_expires_at <= now())
        )
      RETURNING lease_token::text`,
    values: [key, PROCESS_OWNER, leaseToken, deadlineAt, FRONTIER_LEASE_MS],
  });
  if (rows === null) return { ...seed, mode: 'local', acquired: true, workKey: key, startedAt };
  return {
    ...seed,
    mode: 'database',
    acquired: rows.length === 1,
    workKey: key,
    leaseToken: rows.length === 1 ? leaseToken : undefined,
    startedAt,
  };
}

export async function completePantheonFrontierItem(input: {
  claim: PantheonFrontierClaim;
  state: string;
  status?: number;
  evidenceCount?: number;
  crawler?: string;
  failureReason?: string;
  provenance?: Record<string, unknown>;
}): Promise<void> {
  if (input.claim.mode !== 'database' || !input.claim.leaseToken) return;
  const outcomeId = crypto.createHash('sha256')
    .update(`${input.claim.workKey}\n${input.claim.leaseToken}\n${input.state}`)
    .digest('hex');
  await frontierQuery({
    text: `
      WITH completed AS (
        UPDATE public.pantheon_frontier_items
        SET state = $3,
            http_status = $4,
            evidence_count = $5,
            crawler = $6,
            failure_reason = $7,
            completed_at = now(),
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = now()
        WHERE work_key = $1 AND lease_token = $2::uuid
        RETURNING work_key, report_id, category_index, canonical_url, capability
      )
      INSERT INTO public.pantheon_frontier_outcomes (
        outcome_id, work_key, report_id, category_index, canonical_url,
        capability, outcome_state, http_status, evidence_count, duration_ms,
        crawler, failure_reason, provenance
      )
      SELECT $8, work_key, report_id, category_index, canonical_url,
        capability, $3, $4, $5, $9, $6, $7, $10::jsonb
      FROM completed
      ON CONFLICT (outcome_id) DO NOTHING`,
    values: [
      input.claim.workKey,
      input.claim.leaseToken,
      input.state,
      input.status ?? null,
      Math.max(0, Number(input.evidenceCount || 0)),
      input.crawler || null,
      input.failureReason?.slice(0, 1_000) || null,
      outcomeId,
      Math.max(0, Date.now() - input.claim.startedAt),
      JSON.stringify(input.provenance || {}),
    ],
  });
}

export async function syncPantheonFrontierStates(input: {
  reportId: string;
  categoryIndex: number;
  entries: ReadonlyArray<{
    canonicalUrl: string;
    state: string;
    status?: number;
    evidenceCount?: number;
    crawler?: string;
    failureReason?: string;
    provenance?: Record<string, unknown>;
  }>;
}): Promise<void> {
  if (!input.entries.length) return;
  await frontierQuery({
    text: `
      WITH input AS (
        SELECT *
        FROM jsonb_to_recordset($3::jsonb) AS item(
          canonical_url text,
          state text,
          http_status integer,
          evidence_count integer,
          crawler text,
          failure_reason text,
          outcome_id text,
          provenance jsonb
        )
      ), updated AS (
        UPDATE public.pantheon_frontier_items AS frontier
        SET state = item.state,
            http_status = item.http_status,
            evidence_count = item.evidence_count,
            crawler = item.crawler,
            failure_reason = item.failure_reason,
            completed_at = CASE WHEN item.state IN ('pending', 'retryable') THEN frontier.completed_at ELSE now() END,
            updated_at = now()
        FROM input AS item
        WHERE frontier.report_id = $1::uuid
          AND frontier.category_index = $2
          AND frontier.canonical_url = item.canonical_url
        RETURNING frontier.work_key, frontier.report_id, frontier.category_index,
          frontier.canonical_url, frontier.capability, item.state, item.http_status,
          item.evidence_count, item.crawler, item.failure_reason, item.outcome_id,
          item.provenance
      )
      INSERT INTO public.pantheon_frontier_outcomes (
        outcome_id, work_key, report_id, category_index, canonical_url,
        capability, outcome_state, http_status, evidence_count, duration_ms,
        crawler, failure_reason, provenance
      )
      SELECT outcome_id, work_key, report_id, category_index, canonical_url,
        capability, state, http_status, evidence_count, 0,
        crawler, failure_reason, provenance
      FROM updated
      ON CONFLICT (outcome_id) DO NOTHING`,
    values: [input.reportId, input.categoryIndex, JSON.stringify(input.entries.map(entry => ({
      canonical_url: entry.canonicalUrl,
      state: entry.state,
      http_status: entry.status ?? null,
      evidence_count: Math.max(0, Number(entry.evidenceCount || 0)),
      crawler: entry.crawler || null,
      failure_reason: entry.failureReason?.slice(0, 1_000) || null,
      outcome_id: crypto.createHash('sha256')
        .update(`${workKey({ reportId: input.reportId, categoryIndex: input.categoryIndex, canonicalUrl: entry.canonicalUrl })}\nfinal\n${entry.state}`)
        .digest('hex'),
      provenance: entry.provenance || {},
    })))],
  });
}

export async function claimPantheonJobLease(reportId: string): Promise<PantheonJobLease> {
  const leaseToken = crypto.randomUUID();
  const rows = await frontierQuery<{ lease_token: string }>({
    text: `
      INSERT INTO public.pantheon_job_leases (
        report_id, lease_owner, lease_token, lease_expires_at, acquired_at, heartbeat_at
      ) VALUES ($1::uuid, $2, $3::uuid, now() + ($4::integer * interval '1 millisecond'), now(), now())
      ON CONFLICT (report_id) DO UPDATE SET
        lease_owner = EXCLUDED.lease_owner,
        lease_token = EXCLUDED.lease_token,
        lease_expires_at = EXCLUDED.lease_expires_at,
        acquired_at = now(),
        heartbeat_at = now()
      WHERE public.pantheon_job_leases.lease_expires_at <= now()
      RETURNING lease_token::text`,
    values: [reportId, PROCESS_OWNER, leaseToken, JOB_LEASE_MS],
  });
  if (rows === null) return { mode: 'local', acquired: true, reportId };
  return { mode: 'database', acquired: rows.length === 1, reportId, leaseToken: rows.length === 1 ? leaseToken : undefined };
}

export async function renewPantheonJobLease(lease: PantheonJobLease): Promise<boolean> {
  if (lease.mode !== 'database' || !lease.leaseToken) return true;
  const rows = await frontierQuery({
    text: `
      UPDATE public.pantheon_job_leases
      SET lease_expires_at = now() + ($3::integer * interval '1 millisecond'), heartbeat_at = now()
      WHERE report_id = $1::uuid AND lease_token = $2::uuid
      RETURNING report_id`,
    values: [lease.reportId, lease.leaseToken, JOB_LEASE_MS],
  });
  return rows === null || rows.length === 1;
}

export async function releasePantheonJobLease(lease: PantheonJobLease): Promise<void> {
  if (lease.mode !== 'database' || !lease.leaseToken) return;
  await frontierQuery({
    text: `DELETE FROM public.pantheon_job_leases WHERE report_id = $1::uuid AND lease_token = $2::uuid`,
    values: [lease.reportId, lease.leaseToken],
  });
}

export async function acquirePantheonDomainLease(
  domain: string,
  deadlineAt: number,
): Promise<PantheonDomainLease> {
  const normalized = domain.toLowerCase();
  const leaseToken = crypto.randomUUID();
  if (!preparedDomains.has(normalized)) {
    const prepared = await frontierQuery({
      text: `
        WITH policy AS (
          INSERT INTO public.pantheon_domain_policy (source_domain) VALUES ($1)
          ON CONFLICT (source_domain) DO NOTHING
          RETURNING source_domain
        ), slots AS (
          INSERT INTO public.pantheon_domain_leases (source_domain, slot)
          SELECT $1, generate_series(1, $2)::smallint
          ON CONFLICT (source_domain, slot) DO NOTHING
          RETURNING slot
        )
        SELECT count(*)::integer AS prepared FROM slots`,
      values: [normalized, DOMAIN_SLOT_COUNT],
    });
    if (prepared === null) return { mode: 'local', acquired: true, domain: normalized };
    preparedDomains.add(normalized);
  }

  const rows = await frontierQuery<{ slot: number }>({
    text: `
      WITH candidate AS (
        SELECT lease.source_domain, lease.slot
        FROM public.pantheon_domain_leases AS lease
        JOIN public.pantheon_domain_policy AS policy USING (source_domain)
        WHERE lease.source_domain = $1
          AND (lease.lease_expires_at IS NULL OR lease.lease_expires_at <= now())
          AND policy.next_allowed_at <= now()
          AND policy.circuit_open_until <= now()
        ORDER BY lease.slot
        FOR UPDATE OF lease SKIP LOCKED
        LIMIT 1
      )
      UPDATE public.pantheon_domain_leases AS lease
      SET lease_owner = $2,
          lease_token = $3::uuid,
          lease_expires_at = LEAST(to_timestamp($4 / 1000.0), now() + ($5::integer * interval '1 millisecond')),
          updated_at = now()
      FROM candidate
      WHERE lease.source_domain = candidate.source_domain AND lease.slot = candidate.slot
      RETURNING lease.slot`,
    values: [normalized, PROCESS_OWNER, leaseToken, deadlineAt, FRONTIER_LEASE_MS],
  });
  if (rows === null) return { mode: 'local', acquired: true, domain: normalized };
  return {
    mode: 'database',
    acquired: rows.length === 1,
    domain: normalized,
    leaseToken: rows.length === 1 ? leaseToken : undefined,
    slot: rows[0]?.slot,
  };
}

export async function releasePantheonDomainLease(input: {
  lease: PantheonDomainLease;
  status: number;
  latencyMs: number;
  retryAfterMs?: number;
}): Promise<void> {
  if (input.lease.mode !== 'database' || !input.lease.leaseToken || !input.lease.slot) return;
  const retryMs = Math.max(0, Number(input.retryAfterMs || 0));
  await frontierQuery({
    text: `
      WITH released AS (
        UPDATE public.pantheon_domain_leases
        SET lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE source_domain = $1 AND slot = $2 AND lease_token = $3::uuid
        RETURNING source_domain
      )
      UPDATE public.pantheon_domain_policy AS policy
      SET latency_ewma_ms = CASE
            WHEN policy.latency_ewma_ms = 0 THEN $5
            ELSE policy.latency_ewma_ms * 0.7 + $5 * 0.3
          END,
          consecutive_failures = CASE WHEN $4 BETWEEN 200 AND 399 THEN 0 ELSE policy.consecutive_failures + 1 END,
          next_allowed_at = CASE
            WHEN $4 IN (429, 503) THEN GREATEST(policy.next_allowed_at, now() + ($6::integer * interval '1 millisecond'))
            WHEN $4 BETWEEN 200 AND 399 THEN GREATEST(policy.next_allowed_at, now() + (LEAST(750, GREATEST(0, $5 / 2))::integer * interval '1 millisecond'))
            ELSE policy.next_allowed_at
          END,
          circuit_open_until = CASE
            WHEN $4 = 403 OR ($4 NOT BETWEEN 200 AND 399 AND policy.consecutive_failures + 1 >= 4)
              THEN GREATEST(policy.circuit_open_until, now() + interval '30 seconds')
            WHEN $4 BETWEEN 200 AND 399 THEN now()
            ELSE policy.circuit_open_until
          END,
          last_status = $4,
          updated_at = now()
      FROM released
      WHERE policy.source_domain = released.source_domain`,
    values: [
      input.lease.domain,
      input.lease.slot,
      input.lease.leaseToken,
      Math.max(0, Math.trunc(input.status)),
      Math.max(0, Math.trunc(input.latencyMs)),
      retryMs || Math.min(12_000, 1_000 * 2 ** 2),
    ],
  });
}
