import logger from '../../../logger.js';
import { providerMeshPendingStream } from '../capital-free/provider-mesh-pending-stream.js';

let timer: NodeJS.Timeout | null = null;

export function emitFilteredMempoolHeartbeat(): void {
  const stats = providerMeshPendingStream.getStatistics();
  const totalPendingInputs = stats.fullTransactionPushes + stats.fallbackHashes;
  logger.info('[CryptoRuntime] Provider-mesh mempool evidence heartbeat', {
    component: 'FilteredMempoolObservability',
    ...stats,
    retainedRelevantShare: totalPendingInputs > 0
      ? stats.cachedTransactions / totalPendingInputs
      : null,
    fallbackDetailEfficiency: stats.fallbackHashes > 0
      ? stats.fallbackDetailFetches / stats.fallbackHashes
      : null,
    detailFetchBudgetPressure: stats.fallbackDetailFetchesBlockedByBudget > 0,
    alchemyDependency: false,
    operatorBillingLiability: false,
    executionBlocked: false,
  });
}

export function ensureFilteredMempoolObservability(): void {
  if (timer || process.env.NO_INTERVALS === 'true') return;
  const intervalMs = Math.max(15_000, Number(process.env.CRYPTOCRAWL_PENDING_HEARTBEAT_MS || 60_000));
  emitFilteredMempoolHeartbeat();
  timer = setInterval(emitFilteredMempoolHeartbeat, intervalMs);
  timer.unref?.();
}
export function stopFilteredMempoolObservability(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
