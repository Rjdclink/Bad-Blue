import type { SeedFirstCrawler } from '../seedFirstCrawlerSet';
import { getSeedSignal } from './seedAbortBus.ts';
import puppeteer from 'puppeteer';
import { existsSync } from 'fs';
import { MIN_CONTENT_LENGTH } from '../../../lib/seedFirstConfig';

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

export const SeedFetchBirdOfPrey: SeedFirstCrawler = {
  name: 'SeedFetchBirdOfPrey',
  async crawlSeed(seedUrl: string, timeoutMs: number) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const seedSignal = getSeedSignal(seedUrl);
      const signal = seedSignal ? AbortSignal.any([controller.signal, seedSignal]) : controller.signal;
      if (signal.aborted) return { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0, timedOut: true };

      // Puppeteer HEAVY FALLBACK ONLY
      // Headless: true; single page per seed; no reuse across seeds.
      const isDocker = existsSync('/.dockerenv');
      const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
      const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
      const needsNoSandbox = isDocker || isRailway || isRoot;

      const launchArgs: string[] = [
        '--disable-extensions',
        '--disable-gpu',
      ];
      if (needsNoSandbox) {
        launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
      }

      const browser = await puppeteer.launch({
        headless: true,
        args: launchArgs,
      });

      try {
        const page = await browser.newPage();
        await page.setUserAgent('SeedFetchBirdOfPrey/1.0');

        // Network control: block images/media/fonts/trackers/ads/analytics
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const type = req.resourceType();
          const url = req.url();

          const blockedTypes = new Set(['image', 'media', 'font']);
          if (blockedTypes.has(type)) return req.abort();

          const blockedSubstrings = [
            'doubleclick.net', 'googlesyndication', 'google-analytics', 'gtag/js',
            'facebook.net', 'connect.facebook', 'pixel', 'analytics', 'adservice',
            'cdn-cgi/rum', 'hotjar', 'mixpanel', 'segment.com', 'optimizely',
          ];
          if (blockedSubstrings.some(s => url.includes(s))) return req.abort();

          // Allow: document, script, stylesheet, xhr/fetch
          if (type === 'document' || type === 'script' || type === 'stylesheet' || type === 'xhr' || type === 'fetch') {
            return req.continue();
          }

          // Default: abort everything else to reduce noise.
          return req.abort();
        });

        // Timing rules: hard timeout; wait for DOMContentLoaded only.
        const nav = page.goto(seedUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        const abortPromise = new Promise<never>((_, reject) => {
          if (signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          signal.addEventListener('abort', onAbort, { once: true });
        });

        await Promise.race([nav, abortPromise]);

        const html = await page.content().catch(() => '');
        const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');

        // Success criteria:
        // - page loads (we got here)
        // - extracted content meets minimum threshold
        const plain = (text || stripHtmlToText(html)).replace(/\s+/g, ' ').trim();
        if (!plain || plain.length < MIN_CONTENT_LENGTH) {
          return { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0, timedOut: false };
        }

        const emails = uniq((plain.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).slice(0, 20));
        const phones = uniq((plain.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || []).slice(0, 20));

        const itemsFound = (emails.length + phones.length) || 1; // at least 1 if content threshold met
        return {
          emails,
          phones,
          links: [],
          coordinates: [],
          itemsFound,
          timedOut: false,
        };
      } finally {
        await browser.close().catch(() => {});
      }
    } catch (e: any) {
      const timedOut = e?.name === 'AbortError';
      return { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0, timedOut };
    } finally {
      clearTimeout(t);
    }
  },
};

