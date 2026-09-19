import crypto from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { storage } from '../../storage';

export type PantheonReportStatus = 'processing' | 'completed' | 'failed';

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

const fallbackDirectory = process.env.PANTHEON_REPORT_FALLBACK_DIR || '/tmp/legalwhat-pantheon-reports';
const memoryRecords = new Map<string, PantheonReportRecord>();
let databaseUnavailableUntil = 0;
const DATABASE_COOLDOWN_MS = 60_000;
const mirrorTimers = new Map<string, ReturnType<typeof setTimeout>>();

function errorText(error: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let current: any = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) parts.push(current.message);
    else if (typeof current === 'string') parts.push(current);
    current = current?.cause;
  }
  return parts.join(' | ');
}

function isTransientDatabaseFailure(error: unknown): boolean {
  const message = errorText(error);
  return /EAUTHQUERY|ECIRCUITBREAKER|connection to database not available|connection terminated|connection timeout|ETIMEDOUT|ECONNRESET|08006|57P01|too many clients|remaining connection slots/i.test(message);
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

async function journalPath(reportId: string): Promise<string> {
  await mkdir(fallbackDirectory, { recursive: true });
  return path.join(fallbackDirectory, `${reportId}.json`);
}

async function writeJournal(record: PantheonReportRecord): Promise<void> {
  memoryRecords.set(record.id, record);
  try {
    const target = await journalPath(record.id);
    const temporary = `${target}.tmp-${process.pid}`;
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
    memoryRecords.set(reportId, record);
    return record;
  } catch {
    return null;
  }
}

async function mirrorRecord(record: PantheonReportRecord): Promise<void> {
  if (!canTryDatabase()) return;

  try {
    const existing = await storage.getPeopleSearchReport(record.id);
    if (!existing) {
      await storage.createPeopleSearchReport({
        id: record.id,
        userId: record.userId,
        searchQuery: record.searchQuery,
        subjectName: record.subjectName || undefined,
        reportData: record.reportData,
        status: record.status,
        errorMessage: record.errorMessage || undefined,
      });
      return;
    }

    await storage.updatePeopleSearchReportStatus(
      record.id,
      record.status,
      record.reportData,
      record.errorMessage || undefined,
    );
  } catch (error) {
    openDatabaseCircuit(error);
    scheduleMirror(record.id);
  }
}

function scheduleMirror(reportId: string): void {
  if (mirrorTimers.has(reportId)) return;
  const delay = Math.max(1_000, databaseUnavailableUntil - Date.now() + 1_000);
  const timer = setTimeout(async () => {
    mirrorTimers.delete(reportId);
    const record = await readJournal(reportId);
    if (record) await mirrorRecord(record);
  }, delay);
  timer.unref?.();
  mirrorTimers.set(reportId, timer);
}

export async function createPantheonReportRecord(input: {
  userId: string;
  searchQuery: string;
  subjectName?: string;
  reportData: any;
}): Promise<PantheonReportRecord> {
  const now = new Date();
  const record: PantheonReportRecord = {
    id: crypto.randomUUID(),
    userId: input.userId,
    searchQuery: input.searchQuery,
    subjectName: input.subjectName || null,
    reportData: input.reportData,
    status: 'processing',
    errorMessage: null,
    createdAt: now,
    completedAt: null,
  };

  // Journal before touching the remote database. A transient provider outage
  // can therefore never prevent the real report job from starting.
  await writeJournal(record);

  if (canTryDatabase()) {
    try {
      const persisted = await storage.createPeopleSearchReport({
        id: record.id,
        userId: record.userId,
        searchQuery: record.searchQuery,
        subjectName: record.subjectName || undefined,
        reportData: record.reportData,
        status: 'processing',
      });
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
  } else {
    scheduleMirror(record.id);
  }

  return record;
}

export async function updatePantheonReportRecord(
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
    reportData: reportData === undefined ? current.reportData : reportData,
    errorMessage: errorMessage || null,
    completedAt: status === 'processing' ? null : new Date(),
  };
  await writeJournal(next);

  if (canTryDatabase()) {
    try {
      const existing = await storage.getPeopleSearchReport(reportId);
      if (existing) {
        const persisted = await storage.updatePeopleSearchReportStatus(reportId, status, next.reportData, errorMessage);
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
  } else {
    scheduleMirror(reportId);
  }

  return next;
}

export async function getPantheonReportRecord(reportId: string): Promise<PantheonReportRecord | null> {
  if (canTryDatabase()) {
    try {
      const persisted = await storage.getPeopleSearchReport(reportId);
      if (persisted) {
        const normalized = normalizeRecord(persisted);
        await writeJournal(normalized);
        return normalized;
      }
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
  if (local) scheduleMirror(reportId);
  return local;
}
