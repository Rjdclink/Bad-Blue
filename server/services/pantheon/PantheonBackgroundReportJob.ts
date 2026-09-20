import { updatePantheonReportRecord } from './PantheonReportStore';
import { conductFullOSINT } from '../../peopleSearch';
import { canActivatePantheon } from '../pantheonCrawlerOrchestrator';
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

function jobEnvelope(input: PantheonReportJobInput, state: 'queued' | 'running' | 'finalizing' | 'completed' | 'failed', extra: Record<string, unknown> = {}) {
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
  const deadlineAt = new Date(startedAt.getTime() + budgetMs);

  await updatePantheonReportRecord(input.reportId, 'processing', {
    job: jobEnvelope(input, 'running', { startedAt: startedAt.toISOString(), deadlineAt: deadlineAt.toISOString(), phase: 'collecting' }),
    report: null,
  });

  try {
    const availabilityDeadline = deadlineAt.getTime();
    while (!canActivatePantheon().available) {
      if (Date.now() >= availabilityDeadline) {
        throw new Error('PANTHEON remained unavailable for the entire investigation budget');
      }
      await new Promise(resolve => setTimeout(resolve, 5_000));
    }

    const reportPromise = conductFullOSINT(input.name, {
      location: input.location,
      searchDepth: input.searchDepth,
      forceAllCrawlers: true,
      reportBudgetMs: Math.max(0, deadlineAt.getTime() - Date.now()),
      reportDeadlineAt: deadlineAt.getTime(),
    });

    // The selected duration is an evidence-collection budget, not a report
    // death timer. conductFullOSINT receives that budget and is responsible for
    // stopping low-value acquisition. Once collection is underway, allow it to
    // aggregate the evidence it already obtained into the canonical report.
    // This prevents a valid investigation from being discarded at 5/10/20/30m.
    const report = await reportPromise;

    await updatePantheonReportRecord(input.reportId, 'processing', {
      job: jobEnvelope(input, 'finalizing', {
        startedAt: startedAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
        collectionEndedAt: new Date().toISOString(),
        phase: 'finalizing',
      }),
      report: null,
    });

    await updatePantheonReportRecord(input.reportId, 'completed', {
      job: jobEnvelope(input, 'completed', {
        startedAt: startedAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
        phase: 'completed',
        completedAt: new Date().toISOString(),
      }),
      report,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updatePantheonReportRecord(input.reportId, 'failed', {
      job: jobEnvelope(input, 'failed', {
        startedAt: startedAt.toISOString(),
        deadlineAt: deadlineAt.toISOString(),
        phase: 'failed',
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
