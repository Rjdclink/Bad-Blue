/**
 * Seed-first OSINT crawl helpers
 *
 * Requirements:
 * - Require a canonical seed before crawl (profile URL > domain homepage > single handle mapping)
 * - Strict URL sanitization (scheme+host required, strip fragments/tracking params)
 * - One-pass crawl per seed, hard timeout 10s, no redirect chains, no cross-site hopping
 * - Controlled responses (no throwing to UI)
 * - Minimal logging (seed used, crawl started/finished, items found; rejected URLs logged once)
 */
export type SeedType = 'profile_url' | 'domain_homepage' | 'platform_handle';

export interface SeedDecision {
  seedUrl: string | null;
  seedType: SeedType | null;
  rejected: { input: string; reason: string }[];
}

const SEED_METRICS = { total: 0, success: 0 };

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'msclkid', 'igshid', 'mc_cid', 'mc_eid',
  'ref', 'ref_src', 'source', 'mkt_tok',
]);

function isSafeHttpProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:';
}

function isInvalidPath(pathname: string): boolean {
  if (!pathname.startsWith('/')) return true;
  if (pathname.includes('\0')) return true;
  // Disallow path traversal segments
  if (pathname.split('/').some(seg => seg === '..')) return true;
  // Disallow whitespace/control chars (encoded whitespace is still suspicious)
  if (/[^\S\r\n]/.test(pathname)) return true;
  return false;
}

export function sanitizeUrlStrict(inputRaw: string): { ok: true; url: URL; normalized: string } | { ok: false; reason: string } {
  const input = String(inputRaw || '').trim();
  if (!input) return { ok: false, reason: 'Empty URL' };

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: 'Invalid URL (must include scheme and host)' };
  }

  if (!isSafeHttpProtocol(url.protocol)) return { ok: false, reason: 'Invalid scheme (must be http/https)' };
  if (!url.hostname) return { ok: false, reason: 'Missing host' };

  // Remove credentials
  url.username = '';
  url.password = '';

  // Strip fragments
  url.hash = '';

  // Strip tracking + all query params (strict normalization).
  if (url.searchParams && [...url.searchParams.keys()].length > 0) {
    // Remove known tracking params first (for auditing clarity), then drop the rest.
    for (const k of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(k)) url.searchParams.delete(k);
    }
  }
  url.search = '';

  // Normalize pathname (keep as provided but validate)
  if (!url.pathname) url.pathname = '/';
  // collapse multiple slashes
  url.pathname = url.pathname.replace(/\/{2,}/g, '/');

  if (isInvalidPath(url.pathname)) return { ok: false, reason: 'Invalid path' };

  // Normalize to lowercase host
  url.hostname = url.hostname.toLowerCase();

  const normalized = url.toString();
  return { ok: true, url, normalized };
}

export function sanitizeDomainHomepage(domainOrUrlRaw: string): { ok: true; normalized: string } | { ok: false; reason: string } {
  const input = String(domainOrUrlRaw || '').trim();
  if (!input) return { ok: false, reason: 'Empty domain' };

  // Require scheme+host for strict mode: accept https://example.com, not bare example.com
  // (UI copy encourages https://, and this satisfies "valid scheme + host" requirement).
  const parsed = sanitizeUrlStrict(input);
  if (!parsed.ok) return parsed;

  const u = parsed.url;
  // Domain homepage must be root path
  u.pathname = '/';
  u.search = '';
  u.hash = '';
  return { ok: true, normalized: u.toString() };
}

export function deriveSeedFromRequest(input: {
  profileUrl?: string;
  domain?: string;
  name?: string;
  location?: string;
  department?: string;
}): SeedDecision {
  const rejected: { input: string; reason: string }[] = [];

  // a) Explicit profile URL
  if (input.profileUrl && String(input.profileUrl).trim()) {
    const res = sanitizeUrlStrict(String(input.profileUrl));
    if (!res.ok) {
      rejected.push({ input: String(input.profileUrl), reason: res.reason });
      return { seedUrl: null, seedType: null, rejected };
    }
    return { seedUrl: res.normalized, seedType: 'profile_url', rejected };
  }

  // b) Verified domain homepage (strictly require scheme+host)
  if (input.domain && String(input.domain).trim()) {
    const res = sanitizeDomainHomepage(String(input.domain));
    if (!res.ok) {
      rejected.push({ input: String(input.domain), reason: res.reason });
      return { seedUrl: null, seedType: null, rejected };
    }
    return { seedUrl: res.normalized, seedType: 'domain_homepage', rejected };
  }

  // c) Known platform handle mapping (one only)
  // Accept handle tokens like:
  // - "twitter:@handle", "x:@handle", "instagram:@handle", "linkedin:@handle"
  // - "@handle" (ambiguous -> reject)
  const haystack = [input.name, input.location, input.department].filter(Boolean).join(' ');
  const tokens = haystack.split(/\s+/).slice(0, 200);
  const matches: { platform: string; handle: string }[] = [];

  for (const t of tokens) {
    const m = String(t).match(/^(twitter|x|instagram|linkedin):@?([a-zA-Z0-9._-]{2,64})$/i);
    if (m) matches.push({ platform: m[1].toLowerCase(), handle: m[2] });
  }

  if (matches.length > 1) {
    rejected.push({ input: haystack, reason: 'Multiple platform handles provided; expected exactly one' });
    return { seedUrl: null, seedType: null, rejected };
  }

  if (matches.length === 1) {
    const { platform, handle } = matches[0];
    const mapped =
      platform === 'twitter' || platform === 'x'
        ? `https://x.com/${handle}`
        : platform === 'instagram'
          ? `https://www.instagram.com/${handle}/`
          : platform === 'linkedin'
            ? `https://www.linkedin.com/in/${handle}/`
            : null;
    if (!mapped) {
      rejected.push({ input: `${platform}:${handle}`, reason: 'Unsupported platform' });
      return { seedUrl: null, seedType: null, rejected };
    }
    const res = sanitizeUrlStrict(mapped);
    if (!res.ok) {
      rejected.push({ input: mapped, reason: res.reason });
      return { seedUrl: null, seedType: null, rejected };
    }
    return { seedUrl: res.normalized, seedType: 'platform_handle', rejected };
  }

  return { seedUrl: null, seedType: null, rejected };
}

export interface CrawlExtract {
  title?: string;
  textSnippet?: string;
  emails: string[];
  phones: string[];
  links: string[];
  coordinates: { lat: number; lng: number }[];
  itemsFound: number;
}

export async function crawlSeedOnceWithCrawlers(seedUrl: string, timeoutMs = 10_000): Promise<{
  ok: boolean;
  extract: CrawlExtract;
  attempts: Array<{ crawlerName: string; status: 'success' | 'fail' | 'timeout' | 'aborted'; durationMs: number }>;
}> {
  const startedAt = Date.now();
  const attempts: Array<{ crawlerName: string; status: 'success' | 'fail' | 'timeout' | 'aborted'; durationMs: number }> = [];

  const { SEED_FIRST_CRAWLERS } = await import('../services/crawlers/seedFirstCrawlerSet.ts');
  const { registerSeed, abortSeed, unregisterSeed } = await import('../services/crawlers/seedFirst/seedAbortBus.ts');

  // Global cap (hard): ensure we never exceed the overall budget.
  const globalController = new AbortController();
  const globalTimer = setTimeout(() => globalController.abort(), timeoutMs);

  // Register this seed so crawlers can observe abort when a winner is chosen.
  registerSeed(seedUrl);

  const runOne = async (crawler: (typeof SEED_FIRST_CRAWLERS)[number]) => {
    const cStart = Date.now();
    try {
      const elapsed = Date.now() - startedAt;
      const remaining = timeoutMs - elapsed;
      const perCrawlerTimeout = Math.max(1, Math.floor(remaining));
      const result = await crawler.crawlSeed(seedUrl, perCrawlerTimeout);

      // If global timeout fired, treat as timeout.
      const status: 'success' | 'fail' | 'timeout' =
        globalController.signal.aborted || result.timedOut
          ? 'timeout'
          : result.itemsFound > 0
            ? 'success'
            : 'fail';

      return { crawlerName: crawler.name, status, durationMs: Date.now() - cStart, result };
    } catch {
      return { crawlerName: crawler.name, status: 'fail' as const, durationMs: Date.now() - cStart, result: null as any };
    }
  };

  try {
    // Bounded fan-out: run all 4 crawlers concurrently within the remaining time budget.
    const promises = SEED_FIRST_CRAWLERS.map((c) => runOne(c));

    // First successful result wins
    const winner = await Promise.any(
      promises.map(async (p) => {
        const r = await p;
        if (r.status === 'success' && r.result && r.result.itemsFound > 0) return r;
        throw new Error('no-success');
      })
    ).catch(() => null);

    if (winner) {
      // Abort the rest immediately for this seed
      abortSeed(seedUrl);
    }

    const settled = await Promise.allSettled(promises);
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      const { crawlerName, status, durationMs, result } = s.value;
      const finalStatus =
        winner && crawlerName !== winner.crawlerName && status !== 'success'
          ? 'aborted'
          : status;
      attempts.push({ crawlerName, status: finalStatus, durationMs });
      console.log('[OSINT]', { seed: seedUrl, crawlerName, status: finalStatus, durationMs });
    }

    if (winner) {
      const extract: CrawlExtract = {
        title: winner.result.title,
        textSnippet: winner.result.textSnippet,
        emails: winner.result.emails,
        phones: winner.result.phones,
        links: winner.result.links,
        coordinates: winner.result.coordinates,
        itemsFound: winner.result.itemsFound,
      };
      recordSeedOutcome(extract.itemsFound);
      return { ok: true, extract, attempts };
    }

    const extract: CrawlExtract = { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0 };
    recordSeedOutcome(0);
    return { ok: false, extract, attempts };
  } finally {
    clearTimeout(globalTimer);
    unregisterSeed(seedUrl);
  }
}

export function recordSeedOutcome(itemsFound: number) {
  SEED_METRICS.total += 1;
  if (itemsFound > 0) SEED_METRICS.success += 1;
}

export function getSeedSuccessRate(): { total: number; success: number; rate: number } {
  const total = SEED_METRICS.total;
  const success = SEED_METRICS.success;
  const rate = total > 0 ? success / total : 0;
  return { total, success, rate };
}

