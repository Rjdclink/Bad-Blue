import logger from '../../../logger.js';
import { filteredAlchemyPendingStream } from '../capital-free/alchemy-filtered-pending-stream.js';

let timer: NodeJS.Timeout | null = null;

export function emitFilteredMempoolHeartbeat(): void {
  const stats = filteredAlchemyPendingStream.getStatistics();
  logger.info('[CryptoRuntime] Filtered mempool evidence heartbeat', {
    component: 'FilteredMempoolObservability',
    ...stats,
    detailFetchEfficiency: stats.providerFilteredHashes > 0
      ? stats.detailFetches / stats.providerFilteredHashes
      : null,
    detailFetchBudgetPressure: stats.detailFetchesBlockedByBudget > 0,
    executionBlocked: false,
  });
}

export function ensureFilteredMempoolObservability(): void {
  if (timer || process.env.NO_INTERVALS === 'true') return;
  const intervalMs = Math.max(15_000, Number(process.env.ALCHEMY_FILTERED_PENDING_HEARTBEAT_MS || 60_000));
  emitFilteredMempoolHeartbeat();
  timer = setInterval(emitFilteredMempoolHeartbeat, intervalMs);
  timer.unref?.();
}
