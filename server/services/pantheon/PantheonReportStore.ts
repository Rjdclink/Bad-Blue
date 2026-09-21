import crypto from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { storage } from '../../storage';

export type PantheonReportStatus = 'processing' | 'completed' | 'partial' | 'failed';

export interface PantheonReportRecord {
  id: string;
  userId: string;
  searchQuery: string;
  subjectName: string | null;
  reportData: any;
  status: PantheonReportStatus;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export type PantheonReportLookupResult =
  | { state: 'found'; record: PantheonReportRecord }
  | { state: 'not_found' }
  | { state: 'temporarily_unavailable' };

const fallbackDirectory = process.env.PANTHEON_REPORT_FALLBACK_DIR
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'pantheon-reports')
    : '/tmp/legalwhat-pantheon-reports');
const memoryRecords = new Map<string, PantheonReportRecord>();
const mirrorAttempts = new Map<string, number>();
const mirrorTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const idempotentCreates = new Map<string, Promise<{ record: PantheonReportRecord; created: boolean }>>();
let databaseUnavailableUntil = 0;
const DATABASE_COOLDOWN_MS = 60_000;
const MAX_MIRROR_ATTEMPTS = 30;
const MAX_MEMORY_RECORDS = 24;
const TERMINAL_JOURNAL_RETENTION_MS = 6 * 60 * 60_000;

const SUPABASE_MIRROR_BUCKET = 'pantheon-report-state';
const SUPABASE_MIRROR_TIMEOUT_MS = 1_500;
const DATABASE_OPERATION_TIMEOUT_MS = 8_000;
let supabaseMirrorBucketReady = false;

async function withDatabaseTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Pantheon report database operation timed out')), DATABASE_OPERATION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function supabaseMirrorConfig(): { url: string; key: string } | null {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return url && key ? { url, key } : null;
}

async function supabaseMirrorFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_MIRROR_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function ensureSupabaseMirrorBucket(config: { url: string; key: string }): Promise<boolean> {
  if (supabaseMirrorBucketReady) return true;
  const headers = {
    Authorization: `Bearer ${config.key}`,
    apikey: config.key,
    'Content-Type': 'application/json',
  };
  try {
    const probe = await supabaseMirrorFetch(`${config.url}/storage/v1/bucket/${SUPABASE_MIRROR_BUCKET}`, { headers });
    if (probe.ok) {
      supabaseMirrorBucketReady = true;
      return true;
    }
    if (probe.status !== 404) return false;
    const created = await supabaseMirrorFetch(`${config.url}/storage/v1/bucket`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: SUPABASE_MIRROR_BUCKET, name: SUPABASE_MIRROR_BUCKET, public: false }),
    });
    supabaseMirrorBucketReady = created.ok || created.status === 409;
    return supabaseMirrorBucketReady;
  } catch {
    return false;
  }
}

async function writeSupabaseMirror(record: PantheonReportRecord): Promise<void> {
  const config = supabaseMirrorConfig();
  if (!config || !(await ensureSupabaseMirrorBucket(config))) return;
  try {
    const response = await supabaseMirrorFetch(
      `${config.url}/storage/v1/object/${SUPABASE_MIRROR_BUCKET}/${safeReportId(record.id)}.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.key}`,
          apikey: config.key,
          'Content-Type': 'application/json',
          'x-upsert': 'true',
        },
        body: JSON.stringify(serializable(record)),
      },
    );
    if (!response.ok) {
      console.warn('[PANTHEON REPORT STORE] Supabase state mirror write rejected', { reportId: record.id, status: response.status });
    }
  } catch (error) {
    console.warn('[PANTHEON REPORT STORE] Supabase state mirror write unavailable', { reportId: record.id, error: errorText(error).slice(0, 300) });
  }
}

async function readSupabaseMirror(reportId: string): Promise<PantheonReportLookupResult> {
  const config = supabaseMirrorConfig();
  if (!config || !(await ensureSupabaseMirrorBucket(config))) {
    return { state: 'temporarily_unavailable' };
  }
  try {
    const response = await supabaseMirrorFetch(
      `${config.url}/storage/v1/object/authenticated/${SUPABASE_MIRROR_BUCKET}/${safeReportId(reportId)}.json`,
      { headers: { Authorization: `Bearer ${config.key}`, apikey: config.key } },
    );
    if (response.status === 404) return { state: 'not_found' };
    if (!response.ok) return { state: 'temporarily_unavailable' };
    return { state: 'found', record: normalizeRecord(await response.json()) };
  } catch {
    return { state: 'temporarily_unavailable' };
  }
}

function safeReportId(reportId: string): string {
  const normalized = String(reportId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error('Invalid Pantheon report ID');
  }
  return normalized;
}

function errorText(error: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let current: any = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) parts.push(current.message);
    else if (typeof current === 'string') parts.push(current);
    if (current && typeof current === 'object' && current.code) parts.push(String(current.code));
    current = current?.cause;
  }
  return parts.join(' | ');
}

function isTransientDatabaseFailure(error: unknown): boolean {
  const message = errorText(error);
  return /EAUTHQUERY|ECIRCUITBREAKER|connection to database not available|connection terminated|connection timeout|operation timed out|ETIMEDOUT|ECONNRESET|08006|57P01|too many clients|remaining connection slots|CRYPTOCRAWLER_MASTER_POWER_OFF/i.test(message);
}

function openDatabaseCircuit(error: unknown): void {
  if (!isTransientDatabaseFailure(error)) return;
  databaseUnavailableUntil = Math.max(databaseUnavailableUntil, Date.now() + DATABASE_COOLDOWN_MS);
  console.warn('[PANTHEON REPORT STORE] PostgreSQL temporarily unavailable; using local report journal', {
    cooldownMs: DATABASE_COOLDOWN_MS,
    error: errorText(error).slice(0, 500),
  });
}

function canTryDatabase(): boolean {
  return Date.now() >= databaseUnavailableUntil;
}

function canMirrorIdentity(userId: string): boolean {
  // Master-bypass sessions are intentionally ephemeral and are not rows in the
  // authenticated-user table, so persisting them through the FK-backed report
  // table can only fail. Their durable local journal remains authoritative.
  return userId !== 'admin-master-root';
}

function normalizeRecord(record: any): PantheonReportRecord {
  return {
    id: String(record.id),
    userId: String(record.userId),
    searchQuery: String(record.searchQuery || ''),
    subjectName: record.subjectName == null ? null : String(record.subjectName),
    reportData: record.reportData,
    status: record.status as PantheonReportStatus,
    errorMessage: record.errorMessage == null ? null : String(record.errorMessage),
    createdAt: record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt),
    completedAt: record.completedAt ? new Date(record.completedAt) : null,
  };
}

function serializable(record: PantheonReportRecord) {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    completedAt: record.completedAt?.toISOString() || null,
  };
}

function persistenceRevision(record: PantheonReportRecord | null | undefined): number {
  const value = record?.reportData && typeof record.reportData === 'object'
    ? Number(record.reportData.persistenceRevision || 0)
    : 0;
  return Number.isFinite(value) ? value : 0;
}

async function journalPath(reportId: string): Promise<string> {
  await mkdir(fallbackDirectory, { recursive: true });
  return path.join(fallbackDirectory, `${safeReportId(reportId)}.json`);
}

function rememberRecord(record: PantheonReportRecord): void {
  memoryRecords.delete(record.id);
  memoryRecords.set(record.id, record);
  while (memoryRecords.size > MAX_MEMORY_RECORDS) {
    const terminalKey = [...memoryRecords.entries()].find(([, candidate]) => candidate.status !== 'processing')?.[0];
    const key = terminalKey || memoryRecords.keys().next().value;
    if (!key) break;
    memoryRecords.delete(key);
  }
}

function scheduleTerminalCleanup(record: PantheonReportRecord): void {
  if (record.status === 'processing' || cleanupTimers.has(record.id)) return;
  const timer = setTimeout(async () => {
    cleanupTimers.delete(record.id);
    memoryRecords.delete(record.id);
    try {
      await unlink(await journalPath(record.id));
    } catch {
      // Already removed or never materialized.
    }
  }, TERMINAL_JOURNAL_RETENTION_MS);
  timer.unref?.();
  cleanupTimers.set(record.id, timer);
}

async function writeJournal(record: PantheonReportRecord): Promise<void> {
  rememberRecord(record);
  try {
    const target = await journalPath(record.id);
    const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
    await writeFile(temporary, JSON.stringify(serializable(record)), 'utf8');
    await rename(temporary, target);
  } catch (error) {
    console.warn('[PANTHEON REPORT STORE] Local journal write failed; memory copy remains active', {
      reportId: record.id,
      error: errorText(error).slice(0, 300),
    });
  }
}

async function readJournal(reportId: string): Promise<PantheonReportRecord | null> {
  const cached = memoryRecords.get(reportId);
  if (cached) return cached;

  try {
    const target = await journalPath(reportId);
    const parsed = JSON.parse(await readFile(target, 'utf8'));
    const record = normalizeRecord(parsed);
    rememberRecord(record);
    if (record.status !== 'processing') scheduleTerminalCleanup(record);
    return record;
  } catch {
    return null;
  }
}

async function mirrorRecord(record: PantheonReportRecord): Promise<void> {
  if (!canMirrorIdentity(record.userId)) return;
  if (!canTryDatabase()) {
    scheduleMirror(record.id);
    return;
  }

  try {
    const existing = await withDatabaseTimeout(storage.getPeopleSearchReport(record.id));
    if (!existing) {
      await withDatabaseTimeout(storage.createPeopleSearchReport({
        id: record.id,
        userId: record.userId,
        searchQuery: record.searchQuery,
        subjectName: record.subjectName || undefined,
        reportData: record.reportData,
        status: record.status as any,
        errorMessage: record.errorMessage || undefined,
        createdAt: record.createdAt,
        completedAt: record.completedAt,
      }));
      mirrorAttempts.delete(record.id);
      if (record.status !== 'processing') scheduleTerminalCleanup(record);
      return;
    }

    await withDatabaseTimeout(storage.updatePeopleSearchReportStatus(
      record.id,
      record.status as any,
      record.reportData,
      record.errorMessage || undefined,
      record.completedAt,
    ));
    mirrorAttempts.delete(record.id);
    if (record.status !== 'processing') scheduleTerminalCleanup(record);
  } catch (error) {
    if (isTransientDatabaseFailure(error)) {
      openDatabaseCircuit(error);
      scheduleMirror(record.id);
    } else {
      console.error('[PANTHEON REPORT STORE] Database mirror rejected report; automatic retry suppressed until the record changes', {
        reportId: record.id,
        error: errorText(error).slice(0, 500),
      });
    }
  }
}

function scheduleMirror(reportId: string): void {
  if (mirrorTimers.has(reportId)) return;
  const attempts = mirrorAttempts.get(reportId) || 0;
  if (attempts >= MAX_MIRROR_ATTEMPTS) {
    console.warn('[PANTHEON REPORT STORE] Persistence retry budget exhausted; journal retained for recovery', {
      reportId,
      attempts,
    });
    return;
  }

  const cooldownDelay = Math.max(1_000, databaseUnavailableUntil - Date.now() + 1_000);
  const backoffDelay = Math.min(60_000, 1_000 * (2 ** Math.min(attempts, 6)));
  const delay = Math.max(cooldownDelay, backoffDelay);
  mirrorAttempts.set(reportId, attempts + 1);

  const timer = setTimeout(async () => {
    mirrorTimers.delete(reportId);
    const record = await readJournal(reportId);
    if (record) await mirrorRecord(record);
  }, delay);
  timer.unref?.();
  mirrorTimers.set(reportId, timer);
}

export async function createPantheonReportRecord(input: {
  id?: string;
  userId: string;
  searchQuery: string;
  subjectName?: string;
  reportData: any;
}): Promise<PantheonReportRecord> {
  const now = new Date();
  const record: PantheonReportRecord = {
    id: input.id || crypto.randomUUID(),
    userId: input.userId,
    searchQuery: input.searchQuery,
    subjectName: input.subjectName || null,
    reportData: {
      ...(input.reportData && typeof input.reportData === 'object' ? input.reportData : { value: input.reportData }),
      persistenceRevision: 1,
      persistedAt: now.toISOString(),
    },
    status: 'processing',
    errorMessage: null,
    createdAt: now,
    completedAt: null,
  };

  // Journal before touching the remote database. A transient provider outage
  // can therefore never prevent the real report job from starting.
  await writeJournal(record);
  await writeSupabaseMirror(record);

  if (canMirrorIdentity(record.userId) && canTryDatabase()) {
    try {
      const persisted = await withDatabaseTimeout(storage.createPeopleSearchReport({
        id: record.id,
        userId: record.userId,
        searchQuery: record.searchQuery,
        subjectName: record.subjectName || undefined,
        reportData: record.reportData,
        status: 'processing',
        createdAt: record.createdAt,
        completedAt: null,
      }));
      mirrorAttempts.delete(record.id);
      return normalizeRecord(persisted);
    } catch (error) {
      if (isTransientDatabaseFailure(error)) {
        openDatabaseCircuit(error);
        scheduleMirror(record.id);
      } else {
        console.error('[PANTHEON REPORT STORE] Database mirror rejected report creation; local journal remains authoritative for this job', {
          reportId: record.id,
          error: errorText(error).slice(0, 500),
        });
      }
    }
  } else if (canMirrorIdentity(record.userId)) {
    scheduleMirror(record.id);
  }

  return record;
}


interface PantheonIdempotentCreateInput {
  userId: string;
  searchQuery: string;
  subjectName?: string;
  reportData: any;
  idempotencyKey: string;
}

function idempotencyDigest(userId: string, key: string): string {
  return crypto.createHash('sha256').update(userId + '\u0000' + key).digest('hex');
}

function deterministicReportId(userId: string, key: string): string {
  const bytes = Buffer.from(idempotencyDigest(userId, key).slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function idempotencyIndexPath(userId: string, key: string): Promise<string> {
  await mkdir(fallbackDirectory, { recursive: true });
  return path.join(fallbackDirectory, 'idempotency-' + idempotencyDigest(userId, key) + '.json');
}

async function claimIdempotentReportId(userId: string, key: string): Promise<{ reportId: string; created: boolean }> {
  const target = await idempotencyIndexPath(userId, key);
  try {
    const parsed = JSON.parse(await readFile(target, 'utf8'));
    return { reportId: safeReportId(String(parsed.reportId || '')), created: false };
  } catch {
    const reportId = deterministicReportId(userId, key);
    try {
      await writeFile(
        target,
        JSON.stringify({ reportId, createdAt: new Date().toISOString() }),
        { encoding: 'utf8', flag: 'wx' },
      );
      return { reportId, created: true };
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      const parsed = JSON.parse(await readFile(target, 'utf8'));
      return { reportId: safeReportId(String(parsed.reportId || '')), created: false };
    }
  }
}

export async function createIdempotentPantheonReportRecord(
  input: PantheonIdempotentCreateInput,
): Promise<{ record: PantheonReportRecord; created: boolean }> {
  const operationKey = idempotencyDigest(input.userId, input.idempotencyKey);
  const active = idempotentCreates.get(operationKey);
  if (active) return active;

  const operation = (async () => {
    const claim = await claimIdempotentReportId(input.userId, input.idempotencyKey);
    const existing = await getPantheonReportRecord(claim.reportId);
    if (existing) return { record: existing, created: false };

    const record = await createPantheonReportRecord({
      id: claim.reportId,
      userId: input.userId,
      searchQuery: input.searchQuery,
      subjectName: input.subjectName,
      reportData: input.reportData,
    });
    return { record, created: claim.created };
  })().finally(() => idempotentCreates.delete(operationKey));

  idempotentCreates.set(operationKey, operation);
  return operation;
}

export async function updatePantheonReportRecord(
  reportId: string,
  status: PantheonReportStatus,
  reportData?: any,
  errorMessage?: string,
): Promise<PantheonReportRecord> {
  return enqueueReportMutation(reportId, async () => updatePantheonReportRecordUnlocked(
    reportId,
    status,
    reportData,
    errorMessage,
  ));
}

const reportMutationTails = new Map<string, Promise<unknown>>();

function enqueueReportMutation<T>(reportId: string, operation: () => Promise<T>): Promise<T> {
  const previous = reportMutationTails.get(reportId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  reportMutationTails.set(reportId, current);
  void current.finally(() => {
    if (reportMutationTails.get(reportId) === current) reportMutationTails.delete(reportId);
  }).catch(() => undefined);
  return current;
}

async function updatePantheonReportRecordUnlocked(
  reportId: string,
  status: PantheonReportStatus,
  reportData?: any,
  errorMessage?: string,
): Promise<PantheonReportRecord> {
  const current = await getPantheonReportRecord(reportId);
  if (!current) throw new Error(`Pantheon report ${reportId} was not found`);

  const next: PantheonReportRecord = {
    ...current,
    status,
    reportData: {
      ...((reportData === undefined ? current.reportData : reportData) || {}),
      persistenceRevision: persistenceRevision(current) + 1,
      persistedAt: new Date().toISOString(),
    },
    errorMessage: errorMessage || null,
    completedAt: status === 'processing' ? null : new Date(),
  };
  await writeJournal(next);
  await writeSupabaseMirror(next);

  if (canMirrorIdentity(next.userId) && canTryDatabase()) {
    try {
      const existing = await withDatabaseTimeout(storage.getPeopleSearchReport(reportId));
      if (existing) {
        const persisted = await withDatabaseTimeout(storage.updatePeopleSearchReportStatus(
          reportId,
          status as any,
          next.reportData,
          errorMessage,
          next.completedAt,
        ));
        mirrorAttempts.delete(reportId);
        if (status !== 'processing') scheduleTerminalCleanup(next);
        return normalizeRecord(persisted);
      }
      await mirrorRecord(next);
    } catch (error) {
      if (isTransientDatabaseFailure(error)) {
        openDatabaseCircuit(error);
        scheduleMirror(reportId);
      } else {
        console.error('[PANTHEON REPORT STORE] Database mirror rejected report update; local journal remains authoritative for this job', {
          reportId,
          error: errorText(error).slice(0, 500),
        });
      }
    }
  } else if (canMirrorIdentity(next.userId)) {
    scheduleMirror(reportId);
  }

  return next;
}

export interface PantheonPdfArtifact {
  bytes: number;
  sha256: string;
  storedAt: string;
}

async function pdfArtifactPath(reportId: string): Promise<string> {
  await mkdir(fallbackDirectory, { recursive: true });
  return path.join(fallbackDirectory, `${safeReportId(reportId)}.pdf`);
}

export async function persistPantheonPdfArtifact(reportId: string, buffer: Buffer): Promise<PantheonPdfArtifact> {
  const target = await pdfArtifactPath(reportId);
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await writeFile(temporary, buffer);
  await rename(temporary, target);
  const artifact = {
    bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    storedAt: new Date().toISOString(),
  };

  const localDurable = Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH);
  const config = supabaseMirrorConfig();
  if (config && await ensureSupabaseMirrorBucket(config)) {
    try {
      const response = await supabaseMirrorFetch(
        `${config.url}/storage/v1/object/${SUPABASE_MIRROR_BUCKET}/${safeReportId(reportId)}.pdf`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.key}`,
            apikey: config.key,
            'Content-Type': 'application/pdf',
            'x-upsert': 'true',
          },
          body: new Uint8Array(buffer),
        },
      );
      if (!response.ok) throw new Error(`Pantheon PDF durable mirror rejected artifact (${response.status})`);
    } catch (error) {
      if (!localDurable) throw error;
      console.warn('[PANTHEON REPORT STORE] Remote PDF mirror unavailable; Railway volume copy remains authoritative', {
        reportId,
        error: errorText(error).slice(0, 300),
      });
    }
  } else if (process.env.NODE_ENV === 'production' && !localDurable) {
    throw new Error('Pantheon PDF has no durable production storage target');
  }
  return artifact;
}

export async function readPantheonPdfArtifact(reportId: string, expectedSha256?: string): Promise<Buffer | null> {
  let buffer: Buffer | null = null;
  try {
    buffer = await readFile(await pdfArtifactPath(reportId));
  } catch {
    const config = supabaseMirrorConfig();
    if (config && await ensureSupabaseMirrorBucket(config)) {
      const response = await supabaseMirrorFetch(
        `${config.url}/storage/v1/object/authenticated/${SUPABASE_MIRROR_BUCKET}/${safeReportId(reportId)}.pdf`,
        { headers: { Authorization: `Bearer ${config.key}`, apikey: config.key } },
      );
      if (response.ok) buffer = Buffer.from(await response.arrayBuffer());
    }
  }
  if (!buffer) return null;
  if (expectedSha256 && crypto.createHash('sha256').update(buffer).digest('hex') !== expectedSha256) {
    throw new Error('Pantheon PDF artifact failed integrity verification');
  }
  return buffer;
}

export async function lookupPantheonReportRecord(reportId: string): Promise<PantheonReportLookupResult> {
  try {
    reportId = safeReportId(reportId);
  } catch {
    return { state: 'not_found' };
  }

  const localFirst = await readJournal(reportId);
  if (localFirst && !canMirrorIdentity(localFirst.userId)) {
    return { state: 'found', record: localFirst };
  }

  let confirmedMissing = false;
  if (!localFirst) {
    const mirrored = await readSupabaseMirror(reportId);
    if (mirrored.state === 'found') {
      await writeJournal(mirrored.record);
      if (mirrored.record.status !== 'processing') scheduleTerminalCleanup(mirrored.record);
      return mirrored;
    }
    confirmedMissing = mirrored.state === 'not_found';
  }

  if (canTryDatabase()) {
    try {
      const persisted = await withDatabaseTimeout(storage.getPeopleSearchReport(reportId));
      if (persisted) {
        const normalized = normalizeRecord(persisted);
        if (localFirst && persistenceRevision(localFirst) >= persistenceRevision(normalized)) {
          if (canMirrorIdentity(localFirst.userId)) scheduleMirror(reportId);
          return { state: 'found', record: localFirst };
        }
        await writeJournal(normalized);
        if (normalized.status !== 'processing') scheduleTerminalCleanup(normalized);
        return { state: 'found', record: normalized };
      }
      confirmedMissing = true;
    } catch (error) {
      if (isTransientDatabaseFailure(error)) {
        openDatabaseCircuit(error);
      } else {
        console.error('[PANTHEON REPORT STORE] Database read failed; checking the local report journal', {
          reportId,
          error: errorText(error).slice(0, 500),
        });
      }
    }
  }

  const local = await readJournal(reportId);
  if (local) {
    if (canMirrorIdentity(local.userId)) scheduleMirror(reportId);
    return { state: 'found', record: local };
  }
  return confirmedMissing
    ? { state: 'not_found' }
    : { state: 'temporarily_unavailable' };
}

export async function getPantheonReportRecord(reportId: string): Promise<PantheonReportRecord | null> {
  const lookup = await lookupPantheonReportRecord(reportId);
  return lookup.state === 'found' ? lookup.record : null;
}

export async function listRecoverablePantheonReportRecords(): Promise<PantheonReportRecord[]> {
  const ids = new Set<string>();
  try {
    await mkdir(fallbackDirectory, { recursive: true });
    for (const name of await readdir(fallbackDirectory)) {
      const match = /^([0-9a-f-]{36})\.json$/i.exec(name);
      if (match) ids.add(match[1]);
    }
  } catch {
    // Remote mirror discovery remains available.
  }

  const config = supabaseMirrorConfig();
  if (config && await ensureSupabaseMirrorBucket(config)) {
    try {
      const response = await supabaseMirrorFetch(
        `${config.url}/storage/v1/object/list/${SUPABASE_MIRROR_BUCKET}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.key}`,
            apikey: config.key,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prefix: '', limit: 1000, offset: 0, sortBy: { column: 'updated_at', order: 'desc' } }),
        },
      );
      if (response.ok) {
        for (const item of await response.json() as Array<{ name?: string }>) {
          const match = /^([0-9a-f-]{36})\.json$/i.exec(String(item.name || ''));
          if (match) ids.add(match[1]);
        }
      }
    } catch {
      // Local recovery records are still usable.
    }
  }

  const records = await Promise.all([...ids].map(id => getPantheonReportRecord(id)));
  return records.filter((record): record is PantheonReportRecord => Boolean(record && record.status === 'processing'));
}
