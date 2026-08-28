import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db';

const PRIVATE_INTELLIGENCE_MIGRATIONS = [
  '013_cryptocrawler_private_intelligence_memory.sql',
  '014_cryptocrawler_private_outbox.sql',
] as const;

export interface CryptoPrivateMigrationStatus {
  migration: string;
  checksum: string;
  status: 'applied' | 'already_applied';
  appliedAt: string | null;
}

let latestStatus: CryptoPrivateMigrationStatus[] = [];

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

async function ensureLedger(): Promise<void> {
  await pool.query('create schema if not exists private');
  await pool.query(`
    create table if not exists private.cryptocrawler_schema_migrations (
      migration text primary key,
      checksum text not null,
      applied_at timestamptz not null default now(),
      execution_ms integer not null,
      status text not null default 'applied',
      constraint cryptocrawler_schema_migrations_status check (status in ('applied'))
    )
  `);
}

/**
 * Forward-only, ordered CryptoCrawler private migrations.
 *
 * The migration ledger is deliberately private and checksum-pinned. A migration
 * file that was already applied may never be silently edited and replayed. New
 * schema work must be a new numbered migration. Existing 013/014 SQL remains
 * idempotent so first adoption of this ledger is safe on databases where those
 * objects already exist.
 */
export async function reconcileCryptoPrivateIntelligenceMemory(): Promise<{ message: string; migrations: CryptoPrivateMigrationStatus[] }> {
  const migrationDirectory = path.resolve(process.cwd(), 'server', 'migrations');
  await ensureLedger();
  const results: CryptoPrivateMigrationStatus[] = [];

  for (const file of PRIVATE_INTELLIGENCE_MIGRATIONS) {
    const sql = await readFile(path.join(migrationDirectory, file), 'utf8');
    const digest = checksum(sql);
    const existing = await pool.query(
      `select migration, checksum, applied_at from private.cryptocrawler_schema_migrations where migration=$1`,
      [file],
    );
    if (existing.rowCount === 1) {
      const row = existing.rows[0];
      if (String(row.checksum) !== digest) {
        throw new Error(`CryptoCrawler migration checksum drift: ${file} was already applied with a different checksum; create a new forward migration instead of editing history`);
      }
      results.push({ migration: file, checksum: digest, status: 'already_applied', appliedAt: row.applied_at ? new Date(row.applied_at).toISOString() : null });
      continue;
    }

    const client = await pool.connect();
    const startedAt = Date.now();
    try {
      await client.query('BEGIN');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', ['cryptocrawler_private_schema_migrations']);
      const raced = await client.query(
        `select checksum, applied_at from private.cryptocrawler_schema_migrations where migration=$1 for update`,
        [file],
      );
      if (raced.rowCount === 1) {
        if (String(raced.rows[0].checksum) !== digest) throw new Error(`CryptoCrawler migration checksum drift after lock: ${file}`);
        await client.query('COMMIT');
        results.push({ migration: file, checksum: digest, status: 'already_applied', appliedAt: raced.rows[0].applied_at ? new Date(raced.rows[0].applied_at).toISOString() : null });
        continue;
      }
      await client.query(sql);
      const executionMs = Math.max(0, Date.now() - startedAt);
      const inserted = await client.query(
        `insert into private.cryptocrawler_schema_migrations (migration, checksum, execution_ms, status)
         values ($1,$2,$3,'applied') returning applied_at`,
        [file, digest, executionMs],
      );
      await client.query('COMMIT');
      results.push({ migration: file, checksum: digest, status: 'applied', appliedAt: inserted.rows[0]?.applied_at ? new Date(inserted.rows[0].applied_at).toISOString() : null });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* best effort */ }
      throw error;
    } finally {
      client.release();
    }
  }

  latestStatus = results.map(result => ({ ...result }));
  return {
    message: `Reconciled ${results.length} ordered forward-only private CryptoCrawler migrations`,
    migrations: results,
  };
}

export function getCryptoPrivateMigrationStatus(): ReadonlyArray<CryptoPrivateMigrationStatus> {
  return latestStatus.map(status => ({ ...status }));
}
