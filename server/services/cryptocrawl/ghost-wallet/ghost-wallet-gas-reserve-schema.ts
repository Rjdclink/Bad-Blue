import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { coordinationPool } from '../runtime/cryptocrawl-runtime-database.js';

const LOCK_NAME = 'cryptocrawl:ghost-wallet-gas-reserve-schema:v1';
const MIGRATION_FILE = '058_cryptocrawler_ghost_wallet_gas_reserve.sql';
let ready = false;
let inFlight: Promise<void> | null = null;

async function migrationPath(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), 'dist', 'migrations', MIGRATION_FILE),
    path.resolve(process.cwd(), 'server', 'migrations', MIGRATION_FILE),
  ];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* try next runtime layout */ }
  }
  throw new Error('GHOST_WALLET_GAS_RESERVE_MIGRATION_ASSET_UNAVAILABLE');
}

async function install(): Promise<void> {
  const client = await coordinationPool.connect();
  let locked = false;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired', [LOCK_NAME]);
    locked = lock.rows?.[0]?.acquired === true;
    if (!locked) throw new Error('GHOST_WALLET_GAS_RESERVE_SCHEMA_LOCK_BUSY');
    const existing = await client.query(`SELECT to_regclass('private.cryptocrawler_ghost_wallet_gas_reserve') IS NOT NULL AS ready`);
    if (existing.rows?.[0]?.ready !== true) {
      const sql = await readFile(await migrationPath(), 'utf8');
      if (!sql.trim()) throw new Error('GHOST_WALLET_GAS_RESERVE_MIGRATION_EMPTY');
      await client.query(sql);
    }
    const verified = await client.query(`SELECT to_regclass('private.cryptocrawler_ghost_wallet_gas_reserve') IS NOT NULL AS ready`);
    if (verified.rows?.[0]?.ready !== true) throw new Error('GHOST_WALLET_GAS_RESERVE_SCHEMA_NOT_VERIFIED');
    ready = true;
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [LOCK_NAME]).catch(() => undefined);
    client.release();
  }
}

export async function ensureGhostWalletGasReserveSchema(): Promise<void> {
  if (ready) return;
  if (inFlight) return inFlight;
  inFlight = install().finally(() => { inFlight = null; });
  return inFlight;
}

export const GHOST_WALLET_GAS_RESERVE_SCHEMA_POLICY = {
  canonicalDefinition: MIGRATION_FILE,
  overflowOnly: true,
  advisoryLockSerialized: true,
  idempotent: true,
  primaryFallback: false,
} as const;