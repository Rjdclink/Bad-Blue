import type { SeedFirstCrawler } from '../seedFirstCrawlerSet';
import { getSeedSignal } from './seedAbortBus.ts';

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

export const SeedFetchStarTrek: SeedFirstCrawler = {
  name: 'SeedFetchStarTrek',
  async crawlSeed(seedUrl: string, timeoutMs: number) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const seedSignal = getSeedSignal(seedUrl);
      const signal = seedSignal
        ? AbortSignal.any([controller.signal, seedSignal])
        : controller.signal;
      const res = await fetch(seedUrl, {
        redirect: 'manual',
        signal,
        headers: {
          'User-Agent': 'SeedFetchStarTrek/1.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        return { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0, timedOut: false };
      }
      if (!res.ok) {
        return { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0, timedOut: false };
      }

      const contentType = res.headers.get('content-type') || '';
      const raw = await res.text();
      const title = parseTitle(raw);
      const text = contentType.includes('html') ? stripHtmlToText(raw) : raw.trim();
      const textSnippet = text ? text.slice(0, 800) : undefined;

      const itemsFound = (title ? 1 : 0) + (textSnippet ? 1 : 0);
      return {
        title,
        textSnippet,
        emails: [],
        phones: [],
        links: [],
        coordinates: [],
        itemsFound,
        timedOut: false,
      };
    } catch (e: any) {
      const timedOut = e?.name === 'AbortError';
      return { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0, timedOut };
    } finally {
      clearTimeout(t);
    }
  },
};

