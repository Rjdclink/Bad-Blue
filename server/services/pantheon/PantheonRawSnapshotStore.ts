import { createHash } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
function snapshotRoot(): string {
  return process.env.PANTHEON_RAW_SNAPSHOT_DIR
    || (process.env.RAILWAY_VOLUME_MOUNT_PATH
      ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'pantheon-source-snapshots')
      : '/tmp/legalwhat-pantheon-source-snapshots');
}

export interface PantheonRawSnapshotDescriptor {
  schemaVersion: 'pantheon-raw-snapshot-v1';
  rawSha256: string;
  rawBytes: number;
  compressedBytes: number;
  storageKey: string;
  immutable: true;
  durable: boolean;
  capturedAt: string;
}

export async function persistPantheonRawSnapshot(input: {
  investigationId: string;
  bytes: Buffer;
  capturedAt: string;
}): Promise<PantheonRawSnapshotDescriptor> {
  const rawSha256 = createHash('sha256').update(input.bytes).digest('hex');
  const compressed = await gzipAsync(input.bytes, { level: 6 });
  const investigation = input.investigationId.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80) || 'unknown';
  const directory = path.join(snapshotRoot(), investigation, rawSha256.slice(0, 2));
  const storageKey = `${investigation}/${rawSha256.slice(0, 2)}/${rawSha256}.gz`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, `${rawSha256}.gz`);
  try {
    await writeFile(target, compressed, { flag: 'wx', mode: 0o600 });
    await chmod(target, 0o600);
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
  }
  return {
    schemaVersion: 'pantheon-raw-snapshot-v1',
    rawSha256,
    rawBytes: input.bytes.length,
    compressedBytes: compressed.length,
    storageKey,
    immutable: true,
    durable: Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.PANTHEON_RAW_SNAPSHOT_DIR),
    capturedAt: input.capturedAt,
  };
}
