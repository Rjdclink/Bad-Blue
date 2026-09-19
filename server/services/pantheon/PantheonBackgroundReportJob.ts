import { storage } from '../../storage';
import { conductFullOSINT } from '../../peopleSearch';
import {
  getPantheonReportDurationMs,
  normalizePantheonSearchDepth,
  type PantheonSearchDepth,
} from '@shared/pantheonReportConfig';

export interface PantheonReportJobInput {
  reportId: string;
  userId: string;
  name: string;
  location?: string;
  searchDepth: PantheonSearchDepth;
}

interface PersistedPantheonJob {
  state?: string;
  name?: string;
  location?: string;
  searchDepth?: number;
}

const activeJobs = new Map<string, Promise<void>>();

function jobEnvelope(input: PantheonReportJobInput, state: 'queued' | 'running' | 'completed' | 'failed', extra: Record<string, unknown> = {}) {
  const budgetMs = getPantheonReportDurationMs(input.searchDepth);
  return {
    state,
    name: input.name,
    location: input.location || null,
    searchDepth: input.searchDepth,
    budgetMs,
    ...extra,
  };
}

async function runPantheonReportJob(input: PantheonReportJobInput): Promise<void> {
  const startedAt = new Date();
  const budgetMs = getPantheonReportDurationMs(input.searchDepth);

  await storage.updatePeopleSearchReportStatus(input.reportId, 'processing', {
    job: jobEnvelope(input, 'running', { startedAt: startedAt.toISOString() }),
    report: null,
  });

  try {
    const reportPromise = conductFullOSINT(input.name, {
      location: input.location,
      searchDepth: input.searchDepth,
      forceAllCrawlers: true,
      reportBudgetMs: budgetMs,
    });

    let timer: NodeJS.Timeout | undefined;
    const budgetGuard = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`PANTHEON report exceeded its ${Math.round(budgetMs / 60000)} minute investigation budget`)),
        budgetMs + 30_000,
      );
    });

    const report = await Promise.race([reportPromise, budgetGuard]);
    if (timer) clearTimeout(timer);

    await storage.updatePeopleSearchReportStatus(input.reportId, 'completed', {
      job: jobEnvelope(input, 'completed', {
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      }),
      report,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await storage.updatePeopleSearchReportStatus(input.reportId, 'failed', {
      job: jobEnvelope(input, 'failed', {
        startedAt: startedAt.toISOString(),
        failedAt: new Date().toISOString(),
      }),
      report: null,
    }, message.slice(0, 500));
  }
}

export function startPantheonReportJob(input: PantheonReportJobInput): Promise<void> {
  const existing = activeJobs.get(input.reportId);
  if (existing) return existing;

  const job = runPantheonReportJob(input)
    .finally(() => activeJobs.delete(input.reportId));

  activeJobs.set(input.reportId, job);
  return job;
}

export function isPantheonReportJobActive(reportId: string): boolean {
  return activeJobs.has(reportId);
}

export function resumePantheonReportJobFromRecord(report: {
  id: string;
  userId: string;
  status: string;
  searchQuery: string;
  reportData: unknown;
}): Promise<void> | null {
  if (report.status !== 'processing' || isPantheonReportJobActive(report.id)) return null;

  const envelope = (report.reportData && typeof report.reportData === 'object')
    ? report.reportData as { job?: PersistedPantheonJob }
    : {};
  const job = envelope.job;
  const name = String(job?.name || report.searchQuery || '').trim();
  if (!name) return null;

  return startPantheonReportJob({
    reportId: report.id,
    userId: report.userId,
    name,
    location: job?.location || undefined,
    searchDepth: normalizePantheonSearchDepth(job?.searchDepth),
  });
}
