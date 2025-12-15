/**
 * SEED-FIRST CRAWLER SET (crawl-only)
 *
 * Up to 4 crawlers are used for optimization, in a single seed pass:
 * - Exactly ONE network fetch (SeedFirstFetcherCrawler)
 * - Then 3 extraction crawlers run on the fetched payload (no additional requests)
 *
 * This preserves:
 * - Seed-first mode (single canonical seed)
 * - One-pass crawl (one fetch per seed)
 * - No cross-site hopping (link crawler filters to same-host only)
 * - 10s hard timeout enforced by fetcher
 */
import { sanitizeUrlStrict } from '../../lib/seedFirstOsint';

export interface CrawlFetchResult {
  seedUrl: string;
  contentType: string;
  status: number;
  bodyText: string;
}

export interface CrawlExtraction {
  title?: string;
  textSnippet?: string;
  emails: string[];
  phones: string[];
  links: string[];
  coordinates: { lat: number; lng: number }[];
}

export interface SeedFirstCrawler {
  name: string;
  extract: (input: CrawlFetchResult) => CrawlExtraction;
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function stripHtmlToText(html: string): string {
  const noScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  const text = noScripts.replace(/<\/?[^>]+>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function parseTitle(rawHtml: string): string | undefined {
  const m = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return undefined;
  const t = stripHtmlToText(m[1]).trim();
  return t ? t.slice(0, 120) : undefined;
}

export class SeedFirstFetcherCrawler {
  static name = 'SeedFirstFetcherCrawler' as const;

  static async fetch(seedUrl: string, timeoutMs: number): Promise<CrawlFetchResult> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(seedUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'LegalWhat-SeedFirst/1.0 (+crawl-only)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1',
        },
      });

      // No redirect chains
      if (res.status >= 300 && res.status < 400) {
        return { seedUrl, contentType: res.headers.get('content-type') || '', status: res.status, bodyText: '' };
      }
      if (!res.ok) {
        return { seedUrl, contentType: res.headers.get('content-type') || '', status: res.status, bodyText: '' };
      }

      const bodyText = await res.text();
      return { seedUrl, contentType: res.headers.get('content-type') || '', status: res.status, bodyText };
    } catch {
      return { seedUrl, contentType: '', status: 0, bodyText: '' };
    } finally {
      clearTimeout(t);
    }
  }
}

/**
 * Extracts baseline signals from the fetched seed payload.
 * (title + text snippet)
 */
export const BaselineContentCrawler: SeedFirstCrawler = {
  name: 'BaselineContentCrawler',
  extract: (input) => {
    const raw = input.bodyText || '';
    if (!raw) return { emails: [], phones: [], links: [], coordinates: [] };

    const title = parseTitle(raw);
    const text = input.contentType.includes('html') ? stripHtmlToText(raw) : raw.trim();
    const textSnippet = text ? text.slice(0, 800) : undefined;

    return {
      title,
      textSnippet,
      emails: [],
      phones: [],
      links: [],
      coordinates: [],
    };
  },
};

/**
 * Extracts contact signals (emails + phones) from the fetched seed payload.
 */
export const ContactSignalCrawler: SeedFirstCrawler = {
  name: 'ContactSignalCrawler',
  extract: (input) => {
    const raw = input.bodyText || '';
    if (!raw) return { emails: [], phones: [], links: [], coordinates: [] };
    const text = input.contentType.includes('html') ? stripHtmlToText(raw) : raw.trim();

    const emails = uniq((text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).slice(0, 20));
    const phones = uniq((text.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || []).slice(0, 20));
    return { emails, phones, links: [], coordinates: [] };
  },
};

/**
 * Extracts explicit coordinate signals only (no geocoding/fabrication).
 */
export const GeoSignalCrawler: SeedFirstCrawler = {
  name: 'GeoSignalCrawler',
  extract: (input) => {
    const raw = input.bodyText || '';
    if (!raw) return { emails: [], phones: [], links: [], coordinates: [] };
    const text = input.contentType.includes('html') ? stripHtmlToText(raw) : raw.trim();

    const coordinates = uniq((text.match(/-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+/g) || []).slice(0, 20))
      .map((s) => {
        const m = s.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
        if (!m) return null;
        const lat = Number(m[1]);
        const lng = Number(m[2]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        if (lat < -90 || lat > 90) return null;
        if (lng < -180 || lng > 180) return null;
        return { lat, lng };
      })
      .filter((x): x is { lat: number; lng: number } => !!x);

    return { emails: [], phones: [], links: [], coordinates: coordinates.slice(0, 10) };
  },
};

/**
 * Extracts same-host links only (no cross-site hopping).
 * Links are sanitized strictly.
 */
export const LinkSignalCrawler: SeedFirstCrawler = {
  name: 'LinkSignalCrawler',
  extract: (input) => {
    const raw = input.bodyText || '';
    if (!raw) return { emails: [], phones: [], links: [], coordinates: [] };

    const linksRaw = (raw.match(/href\s*=\s*["']([^"']+)["']/gi) || []).slice(0, 200);
    const seedHost = new URL(input.seedUrl).host;
    const links: string[] = [];

    for (const entry of linksRaw) {
      const m = entry.match(/href\s*=\s*["']([^"']+)["']/i);
      if (!m) continue;
      const href = m[1];
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
      try {
        const u = new URL(href, input.seedUrl);
        if (u.host !== seedHost) continue;
        const sanitized = sanitizeUrlStrict(u.toString());
        if (sanitized.ok) links.push(sanitized.normalized);
      } catch {
        continue;
      }
    }

    return { emails: [], phones: [], links: uniq(links).slice(0, 25), coordinates: [] };
  },
};

/**
 * The 4 crawlers used in crawl-only optimization.
 * NOTE: order is fixed; there is no parallelization.
 */
export const SEED_FIRST_CRAWLERS: readonly SeedFirstCrawler[] = [
  BaselineContentCrawler,
  ContactSignalCrawler,
  GeoSignalCrawler,
  LinkSignalCrawler,
] as const;

