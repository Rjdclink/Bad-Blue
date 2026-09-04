import { populationPriorityQueue } from './populationPriorityQueue';
import { searchSessionManager } from './searchSessionManager';

export class OfficerSearchRuntimeReadinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfficerSearchRuntimeReadinessError';
  }
}

/**
 * Runtime readiness only. Schema mutation remains owned by the canonical Primary
 * migrations. This gate proves the two dependencies that both officer harvesters
 * require before either harvester module is loaded by server/index.ts.
 */
export async function requireOfficerSearchRuntimeReadiness(): Promise<void> {
  try {
    // SearchSessionManager now propagates initialization failures.
    await searchSessionManager.initialize();

    // PopulationPriorityQueue historically logs initialization errors internally,
    // so follow initialization with an authoritative read against its queue schema.
    await populationPriorityQueue.initialize();
    const [sessionState, queueStats] = await Promise.all([
      searchSessionManager.getSessionState(),
      populationPriorityQueue.getQueueStats(),
    ]);

    if (!sessionState || !queueStats || !Number.isFinite(Number(queueStats.total))) {
      throw new Error('officer-search dependency state is incomplete');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OfficerSearchRuntimeReadinessError(
      `Officer-search runtime readiness failed: ${message}`,
    );
  }
}
