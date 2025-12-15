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

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export const SeedFetchBirdOfPrey: SeedFirstCrawler = {
  name: 'SeedFetchBirdOfPrey',
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
          'User-Agent': 'SeedFetchBirdOfPrey/1.0',
          'Accept': 'text/html,text/plain;q=0.9,*/*;q=0.1',
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
      const text = contentType.includes('html') ? stripHtmlToText(raw) : raw.trim();

      const emails = uniq((text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).slice(0, 20));
      const phones = uniq((text.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || []).slice(0, 20));

      const itemsFound = emails.length + phones.length;
      return {
        emails,
        phones,
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

