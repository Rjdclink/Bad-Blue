import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PantheonInvestigationIntelligence } from './PantheonInvestigationIntelligence';

const root = process.env.PANTHEON_SAVED_SEARCH_DIR
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'pantheon-saved-searches')
    : '/tmp/legalwhat-pantheon-saved-searches');

function keyFor(userId: string, planId: string): string {
  return createHash('sha256').update(`${userId}\u0000${planId}`).digest('hex');
}

export async function loadPantheonSavedSearchSnapshot(
  userId: string,
  planId: string,
): Promise<PantheonInvestigationIntelligence | undefined> {
  const target = path.join(root, `${keyFor(userId, planId)}.json`);
  try {
    const parsed = JSON.parse(await readFile(target, 'utf8'));
    return parsed?.intelligence?.schemaVersion === 'pantheon-investigation-intelligence-v1'
      ? parsed.intelligence as PantheonInvestigationIntelligence
      : undefined;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return undefined;
    console.warn('[PANTHEON SAVED SEARCH] previous snapshot unavailable', { error: String(error?.message || error).slice(0, 200) });
    return undefined;
  }
}

export async function persistPantheonSavedSearchSnapshot(input: {
  userId: string;
  planId: string;
  reportId: string;
  intelligence: PantheonInvestigationIntelligence;
}): Promise<{ stored: boolean; durable: boolean; key: string }> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const key = keyFor(input.userId, input.planId);
  const target = path.join(root, `${key}.json`);
  const temporary = path.join(root, `${key}.${process.pid}.${Date.now()}.tmp`);
  const payload = JSON.stringify({
    schemaVersion: 'pantheon-saved-search-v1',
    userIdHash: createHash('sha256').update(input.userId).digest('hex'),
    planId: input.planId,
    reportId: input.reportId,
    updatedAt: new Date().toISOString(),
    intelligence: input.intelligence,
  });
  await writeFile(temporary, payload, { flag: 'wx', mode: 0o600 });
  await rename(temporary, target);
  await chmod(target, 0o600);
  return {
    stored: true,
    durable: Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.PANTHEON_SAVED_SEARCH_DIR),
    key,
  };
}
