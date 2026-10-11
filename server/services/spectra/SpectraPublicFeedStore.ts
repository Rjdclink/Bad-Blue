import { createHash, randomUUID } from 'node:crypto';
import { pool, isDatabaseConfigured } from '../../db';
import {
  collectSpectraPublicFeed,
  SPECTRA_PUBLIC_FEED_SOURCES,
  type SpectraPublicFeedResult,
} from './SpectraPublicFeeds';

type FeedSource = (typeof SPECTRA_PUBLIC_FEED_SOURCES)[number];
type FeedRecord = SpectraPublicFeedResult['records'][number];
export interface StoredSpectraPublicFeedRecord extends FeedRecord {
  id: string;
  rawSha256: string;
  firstSeenAt: string;
  lastSeenAt: string;
}
export interface SpectraPublicFeedStatus {
  id: string;
  label: string;
  endpoint: string;
  documentationUrl: string;
  limitations: readonly string[];
  enabled: boolean;
  status: string;
  refreshIntervalMs: number;
  retentionDays: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextDueAt: string | null;
  lastRecordCount: number;
  consecutiveFailures: number;
  errorCode: string | null;
}

const LEASE_MS = 180_000;
const TICK_MS = 30_000;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;
const COVERAGE_LIMITS = new Set(['source_limit', 'record_limit', 'pagination_limit', 'record_too_large', 'invalid_records']);
let timer: ReturnType<typeof setTimeout> | undefined;
let activeCycle: Promise<void> | undefined;
let controller: AbortController | undefined;
let running = false;

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'string' && !value.trim() ? NaN : Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(n) ? Math.floor(n) : fallback));
}
function collectorEnabled(): boolean {
  return !/^(false|0|off)$/i.test(process.env.SPECTRA_PUBLIC_FEEDS_ENABLED || '')
    && !/^(true|1|yes)$/i.test(process.env.NO_INTERVALS || '');
}
function refreshInterval(source: FeedSource): number {
  return Math.max(source.refreshIntervalMs, boundedInteger(
    process.env.SPECTRA_PUBLIC_FEEDS_INTERVAL_MS, source.refreshIntervalMs, 60_000, 24 * 60 * 60_000,
  ));
}
function retentionDays(): number {
  return boundedInteger(process.env.SPECTRA_PUBLIC_FEEDS_RETENTION_DAYS, 30, 7, 365);
}
function timestamp(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function persistenceErrorCode(error: unknown): string {
  return (error as { code?: string })?.code === '42P01' ? 'schema_missing' : 'persistence_unavailable';
}
function safeProviderError(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9_-]{1,64}$/i.test(value) ? value : 'collection_failed';
}

// Hash the parsed provider record with stable object-key order. Retrieval times,
// normalization and JSON whitespace are not part of the raw-content identity.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(key => (value as any)[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonicalJson((value as any)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
function rawHash(record: FeedRecord): string {
  return createHash('sha256').update(canonicalJson(record.rawRecord)).digest('hex');
}

async function registerSources(): Promise<void> {
  await pool.query(
    `INSERT INTO public.spectra_public_feed_state (provider, endpoint, refresh_interval_ms)
     SELECT provider, endpoint, refresh_interval_ms
     FROM jsonb_to_recordset($1::jsonb) AS x(provider text, endpoint text, refresh_interval_ms integer)
     ON CONFLICT (provider) DO UPDATE SET
       endpoint = EXCLUDED.endpoint, refresh_interval_ms = EXCLUDED.refresh_interval_ms`,
    [JSON.stringify(SPECTRA_PUBLIC_FEED_SOURCES.map(source => ({
      provider: source.id, endpoint: source.endpoint, refresh_interval_ms: refreshInterval(source),
    })))],
  );
}

// A committed row lease works with transaction poolers and multiple replicas.
// No database connection or transaction is held while a provider is fetched.
// Force a complete download daily: 304 responses cannot keep old raw snapshots
// alive forever without updating their actual receipt time before cache expiry.
async function claimFeed(source: FeedSource): Promise<any | null> {
  const claim = await pool.query(
    `UPDATE public.spectra_public_feed_state
     SET lease_token = $2::uuid, lease_until = now() + ($3::integer * interval '1 millisecond'),
         last_attempt_at = now(), status = 'running', updated_at = now()
     WHERE provider = $1 AND next_due_at <= now()
       AND (lease_until IS NULL OR lease_until <= now())
     RETURNING provider, lease_token,
       CASE WHEN last_full_fetch_at > now() - interval '1 day' THEN etag END AS etag,
       CASE WHEN last_full_fetch_at > now() - interval '1 day' THEN last_modified END AS last_modified,
       consecutive_failures, last_record_count`,
    [source.id, randomUUID(), LEASE_MS],
  );
  return claim.rows[0] || null;
}

async function persistFeedResult(source: FeedSource, lease: any, result: SpectraPublicFeedResult): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '20s'");
    const ownership = await client.query(
      `SELECT provider FROM public.spectra_public_feed_state
       WHERE provider = $1 AND lease_token = $2::uuid AND lease_until > now() FOR UPDATE`,
      [source.id, lease.lease_token],
    );
    if (!ownership.rows.length) {
      await client.query('ROLLBACK');
      return false;
    }
    const receivedRecords = result.status === 'ok' || result.status === 'partial' ? result.records : [];
    // Provider records may be repeated between pages. Dedupe before the upsert
    // so one statement cannot attempt to update the same conflict key twice.
    const uniqueRecords = new Map<string, Record<string, unknown>>();
    for (const record of receivedRecords) {
      if (record.provider !== source.id || record.classification !== 'public_geographic_context') {
        throw new Error('Invalid provider record classification');
      }
      const sha256 = rawHash(record);
      uniqueRecords.set(`${record.recordId}\u0000${sha256}`, {
        provider: source.id, record_id: record.recordId, raw_sha256: sha256,
        source_url: record.sourceUrl, title: record.title, observed_at: record.observedAt,
        source_updated_at: record.sourceUpdatedAt, retrieved_at: record.retrievedAt,
        geometry: record.geometry, raw_record: record.rawRecord, limitations: record.limitations,
      });
    }
    const rows = [...uniqueRecords.values()];
    for (let offset = 0; offset < rows.length; offset += 200) {
      await client.query(
        `INSERT INTO public.spectra_public_evidence_records (
           provider, record_id, raw_sha256, source_url, title, observed_at, source_updated_at,
           retrieved_at, geometry, raw_record, limitations, first_seen_at, last_seen_at)
         SELECT provider, record_id, raw_sha256, source_url, title, observed_at, source_updated_at,
           retrieved_at, geometry, raw_record, limitations, retrieved_at, retrieved_at
         FROM jsonb_to_recordset($1::jsonb) AS x(
           provider text, record_id text, raw_sha256 text, source_url text, title text,
           observed_at timestamptz, source_updated_at timestamptz, retrieved_at timestamptz,
           geometry jsonb, raw_record jsonb, limitations jsonb)
         ON CONFLICT (provider, record_id, raw_sha256) DO UPDATE SET
           last_seen_at = GREATEST(public.spectra_public_evidence_records.last_seen_at, EXCLUDED.last_seen_at)`,
        [JSON.stringify(rows.slice(offset, offset + 200))],
      );
    }
    const success = result.status === 'ok' || result.status === 'not_modified';
    const coverageLimited = result.status === 'partial' && COVERAGE_LIMITS.has(result.errorCode || '');
    const failures = success || coverageLimited ? 0 : Math.min(20, Number(lease.consecutive_failures || 0) + 1);
    const delay = success || coverageLimited ? refreshInterval(source)
      : Math.max(refreshInterval(source), Math.min(MAX_BACKOFF_MS, refreshInterval(source) * 2 ** Math.min(10, failures - 1)));
    // Partial pages must not install a validator which could turn the next
    // attempt into a 304 and hide pages that have not yet been collected.
    const etag = result.status === 'not_modified' ? result.etag || lease.etag : success ? result.etag : null;
    const modified = result.status === 'not_modified' ? result.lastModified || lease.last_modified : success ? result.lastModified : null;
    const recordCount = result.status === 'not_modified' ? Number(lease.last_record_count) : rows.length;
    await client.query(
      `UPDATE public.spectra_public_feed_state SET
         status = $3, last_success_at = CASE WHEN $4::boolean THEN now() ELSE last_success_at END,
         last_full_fetch_at = CASE WHEN $3 = 'ok' THEN now() ELSE last_full_fetch_at END,
         next_due_at = now() + ($5::integer * interval '1 millisecond'),
         consecutive_failures = $6, last_record_count = $7, etag = $8, last_modified = $9,
         error_code = $10, lease_token = NULL, lease_until = NULL, updated_at = now()
       WHERE provider = $1 AND lease_token = $2::uuid`,
      [source.id, lease.lease_token, result.status, success, delay, failures, recordCount,
        etag || null, modified || null, success ? null : safeProviderError(result.errorCode)],
    );
    await client.query('COMMIT');
    console.info('[SPECTRA public feeds] collection', { provider: source.id, status: result.status, storedRecordCount: rows.length });
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function releaseAbortedLease(source: FeedSource, lease: any): Promise<void> {
  await pool.query(
    `UPDATE public.spectra_public_feed_state SET lease_token = NULL, lease_until = NULL,
       status = 'failed', error_code = 'cancelled',
       next_due_at = now() + interval '1 minute', updated_at = now()
     WHERE provider = $1 AND lease_token = $2::uuid`,
    [source.id, lease.lease_token],
  );
}

async function pruneFeedRecords(): Promise<void> {
  // These global public feeds are a rolling cache; case acquisition snapshots
  // live in their own table and are never removed by this maintenance task.
  await pool.query(
    `DELETE FROM public.spectra_public_evidence_records WHERE id IN (
       SELECT id FROM public.spectra_public_evidence_records
       WHERE last_seen_at < now() - ($1::integer * interval '1 day')
       ORDER BY last_seen_at LIMIT 1000 FOR UPDATE SKIP LOCKED
     )`,
    [retentionDays()],
  );
}

async function runCollectionCycle(signal: AbortSignal): Promise<void> {
  if (signal.aborted || !isDatabaseConfigured) return;
  await registerSources();
  for (const source of SPECTRA_PUBLIC_FEED_SOURCES) {
    if (signal.aborted) break;
    let lease: any;
    try {
      lease = await claimFeed(source);
      if (!lease) continue;
      let result: SpectraPublicFeedResult;
      try {
        result = await collectSpectraPublicFeed(source.id, {
          signal, etag: lease.etag || undefined, lastModified: lease.last_modified || undefined,
        });
      } catch {
        result = { provider: source.id, endpoint: source.endpoint, status: 'failed', records: [], errorCode: 'collection_failed' };
      }
      if (signal.aborted) await releaseAbortedLease(source, lease);
      else await persistFeedResult(source, lease, result);
    } catch (error) {
      console.warn('[SPECTRA public feeds] persistence', { provider: source.id, errorCode: persistenceErrorCode(error) });
      // An uncommitted attempt retains its bounded lease until expiry. A
      // second replica cannot race an uncertain first replica's transaction.
    }
  }
  if (!signal.aborted) await pruneFeedRecords();
}

export function startSpectraPublicFeedCollector(): void {
  if (running || activeCycle || !collectorEnabled() || !isDatabaseConfigured) return;
  running = true;
  controller = new AbortController();
  const signal = controller.signal;
  const tick = () => {
    if (!running || signal.aborted) return;
    activeCycle = runCollectionCycle(signal).catch(error => {
      console.warn('[SPECTRA public feeds] unavailable', { errorCode: persistenceErrorCode(error) });
    }).finally(() => {
      activeCycle = undefined;
      if (running && !signal.aborted) {
        timer = setTimeout(tick, TICK_MS);
        timer.unref?.();
      }
    });
  };
  tick();
}

export async function stopSpectraPublicFeedCollector(): Promise<void> {
  running = false;
  if (timer) clearTimeout(timer);
  timer = undefined;
  controller?.abort();
  await activeCycle;
  controller = undefined;
}

function feedStatuses(rows: any[], errorCode?: string): SpectraPublicFeedStatus[] {
  return SPECTRA_PUBLIC_FEED_SOURCES.map(source => {
    const row = rows.find(state => state.provider === source.id);
    const leaseExpired = row?.status === 'running' && new Date(row.lease_until || 0).getTime() <= Date.now();
    return {
      id: source.id, label: source.label, endpoint: source.endpoint, documentationUrl: source.documentationUrl,
      limitations: source.limitations, enabled: collectorEnabled(), status: errorCode ? 'unavailable' : leaseExpired ? 'interrupted' : row?.status || 'pending',
      refreshIntervalMs: refreshInterval(source), retentionDays: retentionDays(),
      lastAttemptAt: timestamp(row?.last_attempt_at), lastSuccessAt: timestamp(row?.last_success_at),
      nextDueAt: timestamp(row?.next_due_at), lastRecordCount: Number(row?.last_record_count || 0),
      consecutiveFailures: Number(row?.consecutive_failures || 0), errorCode: errorCode || (leaseExpired ? 'lease_expired' : row?.error_code) || null,
    };
  });
}

export async function readSpectraPublicFeedRecords(input: { provider?: string; limit?: number; after?: string } = {}): Promise<{
  records: StoredSpectraPublicFeedRecord[];
  feeds: SpectraPublicFeedStatus[];
  persistenceAvailable: boolean;
  errorCode?: string;
}> {
  if (input.provider && !SPECTRA_PUBLIC_FEED_SOURCES.some(source => source.id === input.provider)) {
    throw new RangeError('Unknown public feed provider');
  }
  const after = input.after ? timestamp(input.after) : null;
  if (input.after && !after) throw new RangeError('Invalid public record timestamp');
  const limit = boundedInteger(input.limit, 100, 1, 500);
  if (!isDatabaseConfigured) {
    return { records: [], feeds: feedStatuses([], 'persistence_unavailable'), persistenceAvailable: false, errorCode: 'persistence_unavailable' };
  }
  try {
    const states = await pool.query('SELECT * FROM public.spectra_public_feed_state');
    const result = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (provider, record_id) * FROM public.spectra_public_evidence_records
         WHERE ($1::text IS NULL OR provider = $1)
           AND ($2::timestamptz IS NULL OR last_seen_at > $2)
         ORDER BY provider, record_id, last_seen_at DESC, retrieved_at DESC, id
       ) latest ORDER BY last_seen_at DESC, provider, record_id LIMIT $3`,
      [input.provider || null, after, limit],
    );
    return {
      records: result.rows.map(row => ({
        id: row.id, provider: row.provider, recordId: row.record_id, rawSha256: row.raw_sha256,
        sourceUrl: row.source_url, title: row.title, observedAt: timestamp(row.observed_at),
        sourceUpdatedAt: timestamp(row.source_updated_at), retrievedAt: timestamp(row.retrieved_at)!,
        geometry: row.geometry, rawRecord: row.raw_record, limitations: row.limitations,
        classification: 'public_geographic_context', firstSeenAt: timestamp(row.first_seen_at)!,
        lastSeenAt: timestamp(row.last_seen_at)!,
      })),
      feeds: feedStatuses(states.rows), persistenceAvailable: true,
    };
  } catch (error) {
    const code = persistenceErrorCode(error);
    return { records: [], feeds: feedStatuses([], code), persistenceAvailable: false, errorCode: code };
  }
}
