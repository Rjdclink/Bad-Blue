import { createHash } from 'node:crypto';
import * as ExifReader from 'exifreader';
import type { SpectraRetrievedEvidence } from './SpectraPublicRetrieval';

const IMAGE_HOST = 'cdn.bsky.app';
const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 3_500;

export interface SpectraPublicImageCollection {
  records: SpectraRetrievedEvidence[];
  attempted: number;
  failed: number;
}

function imageLeads(posts: readonly SpectraRetrievedEvidence[]): Array<{
  url: string; post: SpectraRetrievedEvidence; alt?: string;
}> {
  const seen = new Set<string>();
  const leads: Array<{ url: string; post: SpectraRetrievedEvidence; alt?: string }> = [];
  for (const post of posts.slice(0, 40)) {
    if (post.title !== 'Public Bluesky post') continue;
    const source = post.structuredRecord;
    if (!source || typeof source !== 'object') continue;
    const embed = (source as any).embed;
    if (!Array.isArray(embed?.images)) continue;
    for (const raw of embed.images.slice(0, 4)) {
      try {
        const url = new URL(String(raw?.fullsize || ''));
        if (url.protocol !== 'https:' || url.hostname !== IMAGE_HOST || url.port
          || url.username || url.password || !url.pathname.startsWith('/img/')
          || seen.has(url.toString())) continue;
        seen.add(url.toString());
        leads.push({ url: url.toString(), post,
          alt: typeof raw.alt === 'string' ? raw.alt.slice(0, 1_000) : undefined });
        if (leads.length >= 2) return leads;
      } catch { /* Ignore an invalid image lead. */ }
    }
  }
  return leads;
}

/** Read bounded public image bytes for metadata; no image scene is a person's position. */
export async function collectSpectraPublicBlueskyImages(
  posts: readonly SpectraRetrievedEvidence[],
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<SpectraPublicImageCollection> {
  const leads = imageLeads(posts);
  const outcomes = await Promise.all(leads.map(async lead => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    timer.unref?.();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (options.signal?.aborted) return null;
      const response = await (options.fetchImpl || fetch)(lead.url, {
        method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { Accept: 'image/jpeg,image/png,image/webp', 'User-Agent': 'LegalWhat-SPECTRA/1.0' },
      });
      if (!response.ok || response.status >= 300 || !response.body) return null;
      const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)
        || Number(response.headers.get('content-length') || 0) > MAX_BYTES) return null;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) return null;
          chunks.push(value);
        }
      } finally {
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size);
      let metadata: Record<string, string> = {};
      try {
        const tags = await ExifReader.load(bytes, { expanded: false } as any) as any;
        for (const key of ['DateTimeOriginal', 'OffsetTimeOriginal', 'GPSLatitude', 'GPSLongitude',
          'GPSLatitudeRef', 'GPSLongitudeRef', 'GPSDateStamp', 'GPSTimeStamp']) {
          const description = tags?.[key]?.description;
          if (typeof description === 'string') metadata[key] = description.slice(0, 160);
        }
      } catch { /* Many public CDNs strip embedded metadata. */ }
      return {
        url: lead.url, requestedUrl: lead.url, retrievedAt: new Date().toISOString(),
        publishedAt: lead.post.publishedAt, contentType,
        title: 'Public Bluesky image bytes inspected', textExcerpt: lead.alt,
        structuredRecord: {
          sourcePostUrl: lead.post.url, contentSha256: createHash('sha256').update(bytes).digest('hex'),
          byteLength: size, exif: metadata, imageBytesArchived: false,
          captureLocationIsSubjectPosition: false,
        },
        observations: [],
      } satisfies SpectraRetrievedEvidence;
    } catch { return null; }
    finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }));
  return {
    records: outcomes.filter((record): record is NonNullable<typeof record> => record !== null),
    attempted: leads.length,
    failed: outcomes.filter(record => !record).length,
  };
}
