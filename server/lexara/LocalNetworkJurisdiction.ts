import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { Reader } from 'mmdb-lib';

export interface LocalNetworkJurisdictionEstimate {
  locality?: string;
  state?: string;
  area?: string;
  provider: 'dbip-local';
  confidence: number;
}
type DbIpCityRecord = {
  country?: { iso_code?: string };
  city?: { names?: { en?: string } };
  subdivisions?: Array<{ names?: { en?: string } }>;
};

let readerPromise: Promise<Reader<DbIpCityRecord> | null> | null = null;
function dataPath(): string {
  return process.env.DBIP_LOCAL_MMDB?.trim() || path.join(os.tmpdir(), 'legalwhat-dbip-city-lite.mmdb');
}
function isPrivateOrLoopback(ip: string): boolean {
  return /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80:)/i.test(ip);
}
async function downloadDatabase(target: string): Promise<boolean> {
  const response = await fetch('https://cdn.jsdelivr.net/npm/dbip-city-lite/dbip-city-lite.mmdb.gz', {
    headers: { 'User-Agent': 'LegalWhat/1.0 DB-IP local database updater' },
  }).catch(() => null);
  if (!response?.ok || !response.body) return false;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temp = target + '.download';
  try {
    await pipeline(Readable.fromWeb(response.body as any), createGunzip(), fs.createWriteStream(temp, { mode: 0o600 }));
    await fsp.rename(temp, target);
    return true;
  } catch {
    await fsp.rm(temp, { force: true }).catch(() => undefined);
    return false;
  }
}
async function openReader(): Promise<Reader<DbIpCityRecord> | null> {
  const target = dataPath();
  if (!fs.existsSync(target) && !(await downloadDatabase(target))) return null;
  try {
    return new Reader<DbIpCityRecord>(await fsp.readFile(target));
  } catch {
    await fsp.rm(target, { force: true }).catch(() => undefined);
    if (!(await downloadDatabase(target))) return null;
    try { return new Reader<DbIpCityRecord>(await fsp.readFile(target)); } catch { return null; }
  }
}
async function reader(): Promise<Reader<DbIpCityRecord> | null> {
  if (!readerPromise) {
    readerPromise = openReader().then(result => {
      if (!result) setTimeout(() => { readerPromise = null; }, 5 * 60_000);
      return result;
    });
  }
  return readerPromise;
}
export function warmLocalNetworkJurisdiction(): void {
  void reader();
}
export async function resolveLocalNetworkJurisdiction(ip?: string): Promise<LocalNetworkJurisdictionEstimate | null> {
  const address = String(ip || '').split(',')[0].trim();
  if (!address || isPrivateOrLoopback(address)) return null;
  const db = await reader(); if (!db) return null;
  try {
    const row = db.get(address);
    if (!row || row.country?.iso_code !== 'US') return null;
    const state = row.subdivisions?.[0]?.names?.en?.trim();
    const locality = row.city?.names?.en?.trim();
    if (!state) return null;
    return {
      locality: locality || undefined,
      state,
      area: locality ? `${locality} area` : state,
      provider: 'dbip-local',
      confidence: locality ? 0.55 : 0.7,
    };
  } catch { return null; }
}
