/**
 * Credit-aware supplemental discovery. These providers are never evidence:
 * they only teach Pantheon candidate URLs which its own retrieval stack must
 * fetch and verify. Internal/direct discovery always runs first.
 */
import { rankPantheonDiscoveryUrls, rememberPantheonDiscoveryOutcome } from './PantheonDiscoveryLearning';

export interface PantheonSupplementalDiscoveryResult {
  urls: string[];
  provider?: 'serpapi' | 'scrapingbee';
  attempted: boolean;
}

export function rememberPantheonDiscoverySuccess(url: string): void {
  void rememberPantheonDiscoveryOutcome(url, true);
}

export async function supplementalPantheonDiscovery(
  query: string,
  existingUrls: readonly string[],
  options: { limit?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<PantheonSupplementalDiscoveryResult> {
  const limit = Math.max(1, Math.min(options.limit || 6, 12));
  const timeoutMs = Math.max(300, Math.min(options.timeoutMs || 1200, 5000));
  const seen = new Set(existingUrls);
  const serpKey = process.env.SERPAPI_KEY?.trim();
  const beeKey = process.env.SCRAPINGBEE_API_KEY?.trim();

  // Credits are conserved: SerpApi is first and ScrapingBee is used only if
  // SerpApi is unavailable or yields no new candidate URLs.
  if (serpKey) {
    const controller = new AbortController();
    const relay = () => controller.abort();
    if (options.signal?.aborted) controller.abort(); else options.signal?.addEventListener('abort', relay, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = new URL('https://serpapi.com/search.json');
      url.searchParams.set('engine', 'google');
      url.searchParams.set('q', query);
      url.searchParams.set('api_key', serpKey);
      url.searchParams.set('num', String(limit));
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) {
        const payload = await response.json() as { organic_results?: Array<{ link?: string }> };
        const urls = rankPantheonDiscoveryUrls((payload.organic_results || []).flatMap(item =>
          item.link && /^https?:\/\//i.test(item.link) && !seen.has(item.link) ? [item.link] : []
        )).slice(0, limit);
        if (urls.length) return { urls, provider: 'serpapi', attempted: true };
      }
    } catch {} finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', relay);
    }
  }

  if (beeKey) {
    const controller = new AbortController();
    const relay = () => controller.abort();
    if (options.signal?.aborted) controller.abort(); else options.signal?.addEventListener('abort', relay, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const google = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${limit}`;
      const endpoint = new URL('https://app.scrapingbee.com/api/v1/');
      endpoint.searchParams.set('api_key', beeKey);
      endpoint.searchParams.set('url', google);
      endpoint.searchParams.set('render_js', 'false');
      const response = await fetch(endpoint, { signal: controller.signal });
      if (response.ok) {
        const html = await response.text();
        const matches = [...html.matchAll(/href=["'](?:\/url\?q=)?(https?:\/\/[^"'& ]+)/gi)]
          .map(match => match[1])
          .filter(url => !/google\.com/i.test(url) && !seen.has(url));
        const urls = rankPantheonDiscoveryUrls(matches).slice(0, limit);
        if (urls.length) return { urls, provider: 'scrapingbee', attempted: true };
      }
    } catch {} finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', relay);
    }
  }
  return { urls: [], attempted: Boolean(serpKey || beeKey) };
}
