import { createHash } from 'node:crypto';
import * as ExifReader from 'exifreader';
import type { SpectraRetrievedEvidence } from './SpectraPublicRetrieval';

type SocialPlatform = 'Bluesky' | 'Mastodon' | 'Facebook' | 'Instagram' | 'X' | 'Web';
type ImageLead = { url: string; post: SpectraRetrievedEvidence; platform: SocialPlatform; alt?: string };
const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 3_500;
const MAX_IMAGES_PER_PLATFORM = 4;
const CACHE_MS = 30 * 60_000;
const CACHE_LIMIT = 100;
const cache = new Map<string, { expiresAt: number; record: SpectraRetrievedEvidence }>();

export interface SpectraPublicImageCollection {
  records: SpectraRetrievedEvidence[];
  attempted: number;
  failed: number;
  cached?: number;
}

function validUrl(raw: string): URL | null {
  if (!raw || raw.length > 2_200) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
    return url;
  } catch { return null; }
}

function platformForPage(raw: string): SocialPlatform | null {
  const url = validUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'facebook.com' || host === 'm.facebook.com') {
    return /\/(?:photos?|posts|permalink\.php|photo\.php|story\.php)(?:\/|$|\?)/i.test(url.pathname + url.search)
      ? 'Facebook' : null;
  }
  if (host === 'instagram.com') return /^\/(?:p|reel)\/[a-z0-9_-]+(?:\/|$)/i.test(url.pathname) ? 'Instagram' : null;
  if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com') {
    return /^\/[a-z0-9_]{1,20}\/status\/\d+(?:\/|$)/i.test(url.pathname) ? 'X' : null;
  }
  return null;
}

/** Public platform media/CDN URLs only. No authenticated URLs or redirected downloads. */
export function allowedSpectraPublicImageUrl(
  raw: string,
  platform: SocialPlatform,
  sourcePostUrl: string,
): string | null {
  const url = validUrl(raw);
  const source = validUrl(sourcePostUrl);
  if (!url || !source) return null;
  const host = url.hostname.toLowerCase();
  const sourceHost = source.hostname.toLowerCase();
  let allowed = false;
  if (platform === 'Bluesky') {
    allowed = host === 'cdn.bsky.app' && url.pathname.startsWith('/img/')
      && sourceHost === 'bsky.app';
  } else if (platform === 'Mastodon') {
    allowed = (host === sourceHost || host === 'files.' + sourceHost)
      && /^\/(?:media_attachments|system|uploads)\//.test(url.pathname);
  } else if (platform === 'X') {
    allowed = ['x.com', 'twitter.com', 'mobile.twitter.com', 'www.x.com'].includes(sourceHost)
      && host === 'pbs.twimg.com' && url.pathname.startsWith('/media/');
  } else if (platform === 'Instagram') {
    allowed = ['instagram.com', 'www.instagram.com'].includes(sourceHost)
      && (host.endsWith('.cdninstagram.com') || host === 'cdninstagram.com'
        || host.endsWith('.fbcdn.net') || host === 'fbcdn.net');
  } else if (platform === 'Facebook') {
    allowed = ['facebook.com', 'www.facebook.com', 'm.facebook.com'].includes(sourceHost)
      && (host.endsWith('.fbcdn.net') || host === 'fbcdn.net');
  } else if (platform === 'Web') {
    // Generic web images are read only after the public-URL/redirect guard in
    // SpectraPublicRetrieval, not by a social-media search lead.
    allowed = true;
  }
  return allowed ? url.toString() : null;
}

/** Only a successfully downloaded social POST's image metadata is a media lead. */
export function spectraSocialPageImageLeads(
  pageUrl: string,
  candidates: readonly string[],
): string[] {
  const platform = platformForPage(pageUrl);
  if (!platform) return [];
  return [...new Set(candidates.flatMap(value =>
    allowedSpectraPublicImageUrl(value, platform, pageUrl) || []
  ))].slice(0, 2);
}

function rawExifValue(tag: any): string | undefined {
  const value = tag?.description;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value.slice(0, 160);
  return undefined;
}

function decimalGps(tag: any, ref: string | undefined): number | null {
  const raw = tag?.description;
  let number: number | null = null;
  if (typeof raw === 'number' && Number.isFinite(raw)) number = raw;
  else if (typeof raw === 'string' && /^-?\d{1,3}(?:\.\d+)?$/.test(raw.trim())) number = Number(raw);
  else if (Array.isArray(tag?.value)) {
    const parts = tag.value.map((part: any): number => {
      if (typeof part === 'number') return part;
      if (part && typeof part === 'object' && typeof part.numerator === 'number'
        && typeof part.denominator === 'number' && part.denominator !== 0) {
        return part.numerator / part.denominator;
      }
      return Number.NaN;
    });
    if (parts.length >= 3 && parts.slice(0, 3).every((value: number) => Number.isFinite(value))) {
      number = parts[0] + parts[1] / 60 + parts[2] / 3600;
    }
  }
  if (number === null || !Number.isFinite(number)) return null;
  const direction = String(ref || '').toUpperCase();
  return direction === 'S' || direction === 'W' ? -Math.abs(number) : number;
}

function captureTime(exif: Record<string, string>): {
  capturedAt?: string; captureTimeStatus: 'utc_offset_present' | 'timezone_unknown' | 'invalid' | 'missing';
  captureAgeBand?: 'within_24_hours' | 'within_7_days' | 'within_30_days' | 'older';
} {
  const original = exif.DateTimeOriginal;
  if (!original) return { captureTimeStatus: 'missing' };
  const match = /^(\d{4}):(\d\d):(\d\d)\s+(\d\d):(\d\d):(\d\d)$/.exec(original);
  if (!match) return { captureTimeStatus: 'invalid' };
  const offset = exif.OffsetTimeOriginal;
  if (!offset || !/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset)) {
    return { captureTimeStatus: 'timezone_unknown' };
  }
  const iso = match[1] + '-' + match[2] + '-' + match[3]
    + 'T' + match[4] + ':' + match[5] + ':' + match[6] + offset;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms < Date.UTC(1900, 0, 1)
    || ms > Date.now() + 5 * 60_000) return { captureTimeStatus: 'invalid' };
  const age = Math.max(0, Date.now() - ms);
  const day = 86_400_000;
  return {
    capturedAt: new Date(ms).toISOString(),
    captureTimeStatus: 'utc_offset_present',
    captureAgeBand: age < day ? 'within_24_hours'
      : age < 7 * day ? 'within_7_days' : age < 30 * day ? 'within_30_days' : 'older',
  };
}

function matchesSignature(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/jpeg') return bytes.length >= 4
    && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/png') return bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/webp') return bytes.length >= 12
    && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

/** Inspect already-fetched image bytes; never archive bytes or make a person observation. */
export async function inspectSpectraPublicImageResponse(
  response: Response,
  input: { url: string; sourcePostUrl: string; platform: SocialPlatform; alt?: string;
    publishedAt?: string; maxBytes?: number },
): Promise<SpectraRetrievedEvidence | null> {
  if (!response.ok || response.status >= 300 || !response.body) return null;
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) return null;
  const maxBytes = Math.min(MAX_BYTES, input.maxBytes ?? MAX_BYTES);
  const advertised = Number(response.headers.get('content-length') || 0);
  if (advertised > maxBytes) return null;
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) return null;
      chunks.push(Buffer.from(value));
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, size);
  if (!matchesSignature(bytes, contentType)) return null;
  const exif: Record<string, string> = {};
  let gps: { latitude: number; longitude: number } | undefined;
  try {
    const tags = await ExifReader.load(bytes, { expanded: false } as any) as any;
    for (const key of ['DateTimeOriginal', 'OffsetTimeOriginal', 'DateTimeDigitized',
      'DateTime', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef',
      'GPSDateStamp', 'GPSTimeStamp', 'Make', 'Model']) {
      const value = rawExifValue(tags?.[key]);
      if (value !== undefined) exif[key] = value;
    }
    const lat = decimalGps(tags?.GPSLatitude, exif.GPSLatitudeRef);
    const lon = decimalGps(tags?.GPSLongitude, exif.GPSLongitudeRef);
    if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      gps = { latitude: lat, longitude: lon };
    }
  } catch { /* Many CDN images have no parseable EXIF. */ }
  const time = captureTime(exif);
  return {
    url: input.url, requestedUrl: input.url, retrievedAt: new Date().toISOString(),
    publishedAt: input.publishedAt, contentType,
    title: 'Public ' + input.platform + ' image bytes inspected', textExcerpt: input.alt,
    structuredRecord: {
      sourcePostUrl: input.sourcePostUrl,
      contentSha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: size, exif, ...time,
      captureGps: gps, evidenceRole: 'media_capture_scene',
      sourcePlatform: input.platform, imageBytesArchived: false,
      captureLocationIsSubjectPosition: false, currentPositionVerified: false,
    },
    observations: [],
  };
}

async function collect(leads: ImageLead[], options: {
  fetchImpl?: typeof fetch; signal?: AbortSignal;
}): Promise<SpectraPublicImageCollection> {
  const records: SpectraRetrievedEvidence[] = [];
  let attempted = 0, failed = 0, cached = 0;
  const unique = [...new Map(leads.map(lead => [lead.url, lead])).values()].slice(0, MAX_IMAGES_PER_PLATFORM);
  const run = async (lead: ImageLead) => {
    const prior = cache.get(lead.url);
    if (prior && prior.expiresAt > Date.now()) {
      cached++;
      return prior.record;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    timer.unref?.();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (options.signal?.aborted) return null;
      attempted++;
      const response = await (options.fetchImpl || fetch)(lead.url, {
        method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { Accept: 'image/jpeg,image/png,image/webp', 'User-Agent': 'LegalWhat-SPECTRA/1.0' },
      });
      const record = await inspectSpectraPublicImageResponse(response, {
        url: lead.url, sourcePostUrl: lead.post.url, platform: lead.platform,
        publishedAt: lead.post.publishedAt, alt: lead.alt,
      });
      if (!record) { failed++; return null; }
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      cache.set(lead.url, { expiresAt: Date.now() + CACHE_MS, record });
      return record;
    } catch {
      failed++;
      return null;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  };
  // Maximum two concurrent binary downloads; a slow provider does not create a burst.
  for (let i = 0; i < unique.length; i += 2) {
    const outcomes = await Promise.all(unique.slice(i, i + 2).map(run));
    records.push(...outcomes.filter((item): item is SpectraRetrievedEvidence => item !== null));
  }
  return { records, attempted, failed, cached };
}

export async function collectSpectraPublicBlueskyImages(
  posts: readonly SpectraRetrievedEvidence[],
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<SpectraPublicImageCollection> {
  const leads: ImageLead[] = [];
  for (const post of posts.slice(0, 40)) {
    if (post.title !== 'Public Bluesky post') continue;
    const record = post.structuredRecord as any;
    if (!Array.isArray(record?.embed?.images)) continue;
    for (const raw of record.embed.images.slice(0, 4)) {
      const url = allowedSpectraPublicImageUrl(String(raw?.fullsize || ''), 'Bluesky', post.url);
      if (url) leads.push({ url, post, platform: 'Bluesky',
        alt: typeof raw.alt === 'string' ? raw.alt.slice(0, 1_000) : undefined });
      if (leads.length >= MAX_IMAGES_PER_PLATFORM) break;
    }
    if (leads.length >= MAX_IMAGES_PER_PLATFORM) break;
  }
  return collect(leads, options);
}

export async function collectSpectraPublicMastodonImages(
  posts: readonly SpectraRetrievedEvidence[],
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<SpectraPublicImageCollection> {
  const leads: ImageLead[] = [];
  for (const post of posts.slice(0, 40)) {
    if (post.title !== 'Public Mastodon status') continue;
    const status = post.structuredRecord as any;
    if (!Array.isArray(status?.media_attachments)) continue;
    for (const media of status.media_attachments.slice(0, 4)) {
      if (media?.type !== 'image') continue;
      const url = allowedSpectraPublicImageUrl(String(media.url || ''), 'Mastodon', post.url);
      if (url) leads.push({ url, post, platform: 'Mastodon',
        alt: typeof media.description === 'string' ? media.description.slice(0, 1_000) : undefined });
      if (leads.length >= MAX_IMAGES_PER_PLATFORM) break;
    }
    if (leads.length >= MAX_IMAGES_PER_PLATFORM) break;
  }
  return collect(leads, options);
}

export async function collectSpectraPublicSocialPageImages(
  pages: readonly SpectraRetrievedEvidence[],
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<SpectraPublicImageCollection> {
  const leads: ImageLead[] = [];
  for (const post of pages.slice(0, 80)) {
    const platform = platformForPage(post.url);
    if (!platform || !Array.isArray(post.publicImageUrls)) continue;
    for (const url of spectraSocialPageImageLeads(post.url, post.publicImageUrls)) {
      leads.push({ url, post, platform });
    }
    if (leads.length >= MAX_IMAGES_PER_PLATFORM) break;
  }
  return collect(leads, options);
}
