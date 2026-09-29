import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { parse } from 'csv-parse';

export interface LocalNetworkJurisdictionEstimate {
  locality?: string;
  state?: string;
  area?: string;
  provider: 'dbip-local';
  confidence: number;
}

type DbHandle = {
  prepare(sql: string): { get(...args: any[]): any; run(...args: any[]): any };
  exec(sql: string): void;
  pragma(sql: string): any;
  close(): void;
};

let databasePromise: Promise<DbHandle | null> | null = null;

function monthStamp(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
function previousMonthStamp(): string {
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return monthStamp(d);
}
function dataDir(): string {
  return process.env.DBIP_LOCAL_DIR?.trim() || path.join(os.tmpdir(), 'legalwhat-dbip');
}
function sqlitePath(): string {
  return path.join(dataDir(), `dbip-city-lite-${monthStamp()}.sqlite`);
}
function isPrivateOrLoopback(ip: string): boolean {
  return /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80:)/i.test(ip);
}
function ipv4Hex(ip: string): string | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map(part => Number(part));
  if (bytes.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return '0'.repeat(24) + bytes.map(n => n.toString(16).padStart(2, '0')).join('');
}
function ipv6Hex(ip: string): string | null {
  const zoneFree = ip.split('%')[0].toLowerCase();
  const halves = zoneFree.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map(g => g.padStart(4, '0')).join('');
}
function ipHex(ip: string): string | null {
  return ip.includes(':') ? ipv6Hex(ip) : ipv4Hex(ip);
}
async function importBetterSqlite3(): Promise<any | null> {
  try {
    const mod = await import('better-sqlite3');
    return (mod as any).default || mod;
  } catch {
    return null;
  }
}
async function downloadDataset(target: string): Promise<boolean> {
  const candidates = [monthStamp(), previousMonthStamp()];
  for (const stamp of candidates) {
    const response = await fetch(`https://download.db-ip.com/free/dbip-city-lite-${stamp}.csv.gz`, {
      headers: { 'User-Agent': 'LegalWhat/1.0 DB-IP local database updater' },
    }).catch(() => null);
    if (!response?.ok || !response.body) continue;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = target + '.download';
    const nodeStream = (await import('node:stream')).Readable.fromWeb(response.body as any);
    const out = fs.createWriteStream(tmp, { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      nodeStream.pipe(out);
      out.on('finish', resolve); out.on('error', reject); nodeStream.on('error', reject);
    });
    await fsp.rename(tmp, target);
    return true;
  }
  return false;
}
async function buildDatabase(Database: any, dbPath: string): Promise<DbHandle | null> {
  const gzipPath = path.join(dataDir(), `dbip-city-lite-${monthStamp()}.csv.gz`);
  if (!fs.existsSync(gzipPath) && !(await downloadDataset(gzipPath))) return null;
  const tempDb = dbPath + '.building';
  await fsp.rm(tempDb, { force: true });
  const db = new Database(tempDb) as DbHandle;
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.exec('CREATE TABLE ranges (start_hex TEXT NOT NULL, end_hex TEXT NOT NULL, state TEXT NOT NULL, city TEXT);');
  const insert = db.prepare('INSERT INTO ranges(start_hex,end_hex,state,city) VALUES(?,?,?,?)');
  const parser = fs.createReadStream(gzipPath).pipe(createGunzip()).pipe(parse({ relax_quotes: true, skip_empty_lines: true }));
  db.exec('BEGIN');
  try {
    for await (const row of parser as any) {
      const [startIp, endIp, , country, state, city] = row as string[];
      if (country !== 'US' || !state) continue;
      const start = ipHex(startIp), end = ipHex(endIp);
      if (!start || !end) continue;
      insert.run(start, end, state, city || null);
    }
    db.exec('COMMIT');
    db.exec('CREATE INDEX idx_ranges_start ON ranges(start_hex);');
    db.close();
    await fsp.rename(tempDb, dbPath);
    return new Database(dbPath) as DbHandle;
  } catch {
    try { db.exec('ROLLBACK'); } catch {}
    db.close(); await fsp.rm(tempDb, { force: true }); return null;
  }
}
async function openDatabase(): Promise<DbHandle | null> {
  const Database = await importBetterSqlite3();
  if (!Database) return null;
  await fsp.mkdir(dataDir(), { recursive: true });
  const dbPath = sqlitePath();
  if (fs.existsSync(dbPath)) {
    try { return new Database(dbPath, { readonly: true }) as DbHandle; } catch {}
  }
  return buildDatabase(Database, dbPath);
}
async function database(): Promise<DbHandle | null> {
  if (!databasePromise) {
    databasePromise = openDatabase().then(result => {
      if (!result) setTimeout(() => { databasePromise = null; }, 5 * 60_000);
      return result;
    });
  }
  return databasePromise;
}
export function warmLocalNetworkJurisdiction(): void {
  void database();
}
export async function resolveLocalNetworkJurisdiction(ip?: string): Promise<LocalNetworkJurisdictionEstimate | null> {
  const address = String(ip || '').split(',')[0].trim();
  if (!address || isPrivateOrLoopback(address)) return null;
  const key = ipHex(address); if (!key) return null;
  const db = await database(); if (!db) return null;
  try {
    const row = db.prepare(
      'SELECT state, city FROM ranges WHERE start_hex <= ? AND end_hex >= ? ORDER BY start_hex DESC LIMIT 1'
    ).get(key, key) as { state?: string; city?: string } | undefined;
    if (!row?.state) return null;
    return {
      locality: row.city || undefined,
      state: row.state,
      area: row.city ? `${row.city} area` : row.state,
      provider: 'dbip-local',
      confidence: row.city ? 0.55 : 0.7,
    };
  } catch { return null; }
}
