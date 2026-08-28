import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db';

const PRIVATE_INTELLIGENCE_MIGRATIONS = [
  '013_cryptocrawler_private_intelligence_memory.sql',
  '014_cryptocrawler_private_outbox.sql',
] as const;

/**
 * The application startup migrator is an explicit TypeScript step list and does
 * not scan numbered SQL files. Reconcile only the two CryptoCrawler private
 * intelligence migrations here; do not replay the rest of the historical SQL
 * directory. Both SQL files are idempotent by construction.
 */
export async function reconcileCryptoPrivateIntelligenceMemory(): Promise<{ message: string }> {
  const migrationDirectory = path.resolve(process.cwd(), 'server', 'migrations');
  for (const file of PRIVATE_INTELLIGENCE_MIGRATIONS) {
    const sql = await readFile(path.join(migrationDirectory, file), 'utf8');
    await pool.query(sql);
  }
  return {
    message: `Reconciled ${PRIVATE_INTELLIGENCE_MIGRATIONS.length} private CryptoCrawler intelligence migrations`,
  };
}
