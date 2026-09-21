import type { SeedFirstCrawler } from '../seedFirstCrawlerSet';
import { sanitizeUrlStrict } from '../../../lib/seedFirstOsint.ts';
import { getSeedSignal } from './seedAbortBus.ts';
import { acquirePublicResource } from '../PublicAcquisitionInfrastructure';

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export const SeedFetchTrinity: SeedFirstCrawler = {
  name: 'SeedFetchTrinity',
  async crawlSeed(seedUrl: string, timeoutMs: number) {
    try {
      const seedSignal = getSeedSignal(seedUrl);
      if (seedSignal?.aborted) return { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0, timedOut: true };
      const resource = await acquirePublicResource(seedUrl, timeoutMs);
      if (!resource.ok) {
        return { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0, timedOut: false };
      }
      const raw = resource.content;
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
    }
  },
};

