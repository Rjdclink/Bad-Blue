import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { getObjectStorageClient } from '../objectStorage';

const DEFAULT_SUPABASE_BUCKET = 'legalwhat-matters';

let supabaseClient: SupabaseClient | null = null;
let supabaseBucketReady: Promise<string> | null = null;

function safeSegment(value: string, fallback: string): string {
  const cleaned = String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 120) || fallback;
}

function parsePrivateObjectDir(value: string): { bucket: string; prefix: string } | null {
  const parts = String(value || '').split('/').filter(Boolean);
  if (!parts.length) return null;
  return { bucket: parts[0], prefix: parts.slice(1).join('/') };
}

function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  supabaseClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseClient;
}

async function ensureSupabaseBucket(): Promise<string> {
  if (supabaseBucketReady) return supabaseBucketReady;
  supabaseBucketReady = (async () => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase matter storage is not configured');
    const bucket = safeSegment(process.env.LEGALWHAT_MATTER_STORAGE_BUCKET || DEFAULT_SUPABASE_BUCKET, DEFAULT_SUPABASE_BUCKET);
    const { data } = await client.storage.getBucket(bucket);
    if (!data) {
      const created = await client.storage.createBucket(bucket, {
        public: false,
        fileSizeLimit: 100 * 1024 * 1024,
      });
      if (created.error && !/already exists/i.test(created.error.message || '')) {
        throw new Error(`Could not create private matter storage bucket: ${created.error.message}`);
      }
    }
    return bucket;
  })();
  return supabaseBucketReady;
}

export interface MatterStorageWrite {
  userId: string;
  matterId: string;
  category: 'evidence' | 'document' | 'packet' | 'exhibit' | 'research' | 'correspondence';
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}

export async function persistMatterBuffer(input: MatterStorageWrite): Promise<string> {
  const user = safeSegment(input.userId, 'user');
  const matter = safeSegment(input.matterId, 'matter');
  const category = safeSegment(input.category, 'document');
  const fileName = safeSegment(input.fileName, 'file');
  const objectName = `${user}/${matter}/${category}/${randomUUID()}-${fileName}`;

  const privateDir = parsePrivateObjectDir(process.env.PRIVATE_OBJECT_DIR || '');
  const gcs = await getObjectStorageClient().catch(() => null);
  if (gcs && privateDir) {
    const prefix = privateDir.prefix ? `${privateDir.prefix}/` : '';
    const target = `${prefix}${objectName}`;
    await gcs.bucket(privateDir.bucket).file(target).save(input.bytes, {
      resumable: false,
      metadata: {
        contentType: input.mimeType || 'application/octet-stream',
        metadata: {
          legalwhatUserId: input.userId,
          legalwhatMatterId: input.matterId,
          legalwhatCategory: input.category,
        },
      },
    });
    return `gcs://${privateDir.bucket}/${target}`;
  }

  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Persistent legal-matter file storage is not configured');
  }
  const bucket = await ensureSupabaseBucket();
  const uploaded = await client.storage.from(bucket).upload(objectName, input.bytes, {
    contentType: input.mimeType || 'application/octet-stream',
    upsert: false,
    cacheControl: '3600',
  });
  if (uploaded.error) throw new Error(`Matter storage upload failed: ${uploaded.error.message}`);
  return `supabase://${bucket}/${uploaded.data.path}`;
}

export async function readMatterBuffer(storageRef: string): Promise<Buffer> {
  if (storageRef.startsWith('gcs://')) {
    const raw = storageRef.slice('gcs://'.length);
    const slash = raw.indexOf('/');
    if (slash <= 0) throw new Error('Invalid GCS matter storage reference');
    const bucket = raw.slice(0, slash);
    const objectName = raw.slice(slash + 1);
    const gcs = await getObjectStorageClient();
    if (!gcs) throw new Error('Google Cloud matter storage is unavailable');
    const [bytes] = await gcs.bucket(bucket).file(objectName).download();
    return bytes;
  }

  if (storageRef.startsWith('supabase://')) {
    const raw = storageRef.slice('supabase://'.length);
    const slash = raw.indexOf('/');
    if (slash <= 0) throw new Error('Invalid Supabase matter storage reference');
    const bucket = raw.slice(0, slash);
    const objectName = raw.slice(slash + 1);
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase matter storage is unavailable');
    const downloaded = await client.storage.from(bucket).download(objectName);
    if (downloaded.error || !downloaded.data) {
      throw new Error(`Matter storage download failed: ${downloaded.error?.message || 'file unavailable'}`);
    }
    return Buffer.from(await downloaded.data.arrayBuffer());
  }

  return readFile(storageRef);
}

export async function materializeMatterStorageRef(
  storageRef: string,
  fileName = 'matter-file',
): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  if (!storageRef.startsWith('gcs://') && !storageRef.startsWith('supabase://')) {
    return { filePath: storageRef, cleanup: async () => undefined };
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'legalwhat-matter-'));
  const filePath = path.join(dir, safeSegment(fileName, 'matter-file'));
  const bytes = await readMatterBuffer(storageRef);
  await writeFile(filePath, bytes);
  return {
    filePath,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
