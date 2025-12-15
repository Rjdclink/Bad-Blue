import type { SeedFirstCrawler } from '../seedFirstCrawlerSet';
import { getSeedSignal } from './seedAbortBus.ts';
import FirecrawlApp from '@mendable/firecrawl-js';
import { MIN_CONTENT_LENGTH } from '../../../lib/seedFirstConfig';

export const SeedFetchStarTrek: SeedFirstCrawler = {
  name: 'SeedFetchStarTrek',
  async crawlSeed(seedUrl: string, timeoutMs: number) {
    try {
      // Firecrawl FAST-PATH ONLY
      const apiKey = process.env.FIRECRAWL_API_KEY || '';
      if (!apiKey) {
        return { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0, timedOut: false };
      }

      const seedSignal = getSeedSignal(seedUrl);
      if (seedSignal?.aborted) return { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0, timedOut: true };

      const client = new FirecrawlApp({ apiKey });
      const resp = await client.scrapeUrl(seedUrl, {
        // Single request only; no recursion/link expansion.
        formats: ['html'],
        onlyMainContent: true,
        timeout: timeoutMs,
        // Deterministic single-page config
        removeBase64Images: true,
        blockAds: true,
        headers: {
          'User-Agent': 'SeedFetchStarTrek/1.0',
          'Accept': 'text/html,text/plain;q=0.9,*/*;q=0.1',
        },
      } as any);

      const statusCode = (resp as any)?.metadata?.statusCode;
      const html = (resp as any)?.html || '';
      const contentType = ((resp as any)?.metadata?.contentType || '').toString().toLowerCase();

      // Success criteria:
      // - HTTP 200
      // - Non-empty body
      // - Body length >= threshold
      // - Content type is html/text (best-effort via metadata if present)
      const looksTextual = !contentType || contentType.includes('text') || contentType.includes('html');
      const ok = resp?.success === true && statusCode === 200 && looksTextual && html && html.length >= MIN_CONTENT_LENGTH;

      if (!ok) {
        return { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0, timedOut: false };
      }

      const title = (resp as any)?.metadata?.title ? String((resp as any).metadata.title).slice(0, 120) : undefined;
      // No raw HTML returned in any snapshot pipeline; but the API report can include a snippet.
      // Keep deterministic snippet limited.
      const textSnippet = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800);
      const itemsFound = 2;
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
    }
  },
};

