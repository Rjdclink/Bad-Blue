import type { SeedFirstCrawler } from '../seedFirstCrawlerSet';

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

export const SeedFetchSixDegrees: SeedFirstCrawler = {
  name: 'SeedFetchSixDegrees',
  async crawlSeed(seedUrl: string, timeoutMs: number) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(seedUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'SeedFetchSixDegrees/1.0',
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
        .filter((x): x is { lat: number; lng: number } => !!x)
        .slice(0, 10);

      const itemsFound = coordinates.length;
      return {
        emails: [],
        phones: [],
        links: [],
        coordinates,
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

