import type { QueryResult } from 'pg';
import {
  isDatabaseConfigured as isPrimaryDatabaseConfigured,
  pool as primaryPool,
} from '../../../db.js';
import { runThroughCryptaraOverflowPrimaryGateway } from './cryptara-overflow-primary-gateway.js';

let archiveQueries = 0;
let archiveFailures = 0;
let lastOperation: string | null = null;
let lastOperationAt = 0;

/**
 * Sole CryptoCrawler path to Primary cold storage.
 *
 * Primary is not a hot runtime, execution, settlement, governance, lease, nonce,
 * inventory, or payout authority. Workers may use this module only for explicit
 * archival writes and historical lookups, and every operation remains observable
 * through the Overflow/Bridge Primary gateway.
 */
export const isCryptaraPrimaryArchiveConfigured = isPrimaryDatabaseConfigured;

export async function queryCryptaraPrimaryArchive(
  text: string,
  values: unknown[] = [],
  operation = 'archive_query',
): Promise<QueryResult> {
  if (!isPrimaryDatabaseConfigured) {
    throw new Error('Primary cold archive database is not configured');
  }

  const normalizedOperation = operation.trim() || 'archive_query';
  archiveQueries += 1;
  lastOperation = normalizedOperation;
  lastOperationAt = Date.now();

  try {
    return await runThroughCryptaraOverflowPrimaryGateway(
      `primary_archive:${normalizedOperation}`,
      () => primaryPool.query(text, values as any[]),
    );
  } catch (error) {
    archiveFailures += 1;
    throw error;
  }
}

export function getCryptaraPrimaryArchiveWorkerSnapshot() {
  return {
    role: 'primary_cold_archive_worker' as const,
    communicationPath: 'worker_to_bridge_gateway_to_primary' as const,
    hotRuntimeAuthority: false as const,
    executionAuthority: false as const,
    financialAuthority: false as const,
    governanceAuthority: false as const,
    createsDatabasePool: false as const,
    directApplicationPrimaryCalls: 0 as const,
    configured: isPrimaryDatabaseConfigured,
    archiveQueries,
    archiveFailures,
    lastOperation,
    lastOperationAt,
  };
}
