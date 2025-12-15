import type { SeedFirstCrawler } from '../seedFirstCrawlerSet';
import { sanitizeUrlStrict } from '../../../lib/seedFirstOsint.ts';

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export const SeedFetchTrinity: SeedFirstCrawler = {
  name: 'SeedFetchTrinity',
  async crawlSeed(seedUrl: string, timeoutMs: number) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(seedUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'SeedFetchTrinity/1.0',
          'Accept': 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.1',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        return { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0, timedOut: false };
      }
      if (!res.ok) {
        return { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0, timedOut: false };
      }

      const raw = await res.text();
      const linksRaw = (raw.match(/href\s*=\s*["']([^"']+)["']/gi) || []).slice(0, 200);
      const seedHost = new URL(seedUrl).host;

      const links: string[] = [];
      for (const entry of linksRaw) {
        const m = entry.match(/href\s*=\s*["']([^"']+)["']/i);
        if (!m) continue;
        const href = m[1];
        if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
        try {
          const u = new URL(href, seedUrl);
          if (u.host !== seedHost) continue; // no cross-site
          const sanitized = sanitizeUrlStrict(u.toString());
          if (sanitized.ok) links.push(sanitized.normalized);
        } catch {
          continue;
        }
      }

      const uniqLinks = uniq(links).slice(0, 25);
      const itemsFound = uniqLinks.length;
      return {
        emails: [],
        phones: [],
        links: uniqLinks,
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

