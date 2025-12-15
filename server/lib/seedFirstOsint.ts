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
import crypto from 'node:crypto';

export type SeedType = 'profile_url' | 'domain_homepage' | 'platform_handle';

export interface SeedDecision {
  seedUrl: string | null;
  seedType: SeedType | null;
  rejected: { input: string; reason: string }[];
}

const LOGGED_REJECTIONS = new Set<string>();
const SEED_METRICS = { total: 0, success: 0 };

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'msclkid', 'igshid', 'mc_cid', 'mc_eid',
  'ref', 'ref_src', 'source', 'mkt_tok',
]);

function logRejectedOnce(input: string, reason: string) {
  const key = crypto.createHash('sha256').update(`${input}::${reason}`).digest('hex').slice(0, 16);
  if (LOGGED_REJECTIONS.has(key)) return;
  LOGGED_REJECTIONS.add(key);
  console.warn('[OSINT] URL rejected', { input, reason });
}

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
      logRejectedOnce(String(input.profileUrl), res.reason);
      return { seedUrl: null, seedType: null, rejected };
    }
    return { seedUrl: res.normalized, seedType: 'profile_url', rejected };
  }

  // b) Verified domain homepage (strictly require scheme+host)
  if (input.domain && String(input.domain).trim()) {
    const res = sanitizeDomainHomepage(String(input.domain));
    if (!res.ok) {
      rejected.push({ input: String(input.domain), reason: res.reason });
      logRejectedOnce(String(input.domain), res.reason);
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
    logRejectedOnce(haystack, 'Multiple platform handles provided; expected exactly one');
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
      logRejectedOnce(`${platform}:${handle}`, 'Unsupported platform');
      return { seedUrl: null, seedType: null, rejected };
    }
    const res = sanitizeUrlStrict(mapped);
    if (!res.ok) {
      rejected.push({ input: mapped, reason: res.reason });
      logRejectedOnce(mapped, res.reason);
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

function stripHtmlToText(html: string): string {
  // Remove script/style/noscript blocks
  const noScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  // Remove tags
  const text = noScripts.replace(/<\/?[^>]+>/g, ' ');
  // Collapse whitespace
  return text.replace(/\s+/g, ' ').trim();
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export async function crawlSeedOnce(seedUrl: string, timeoutMs = 10_000): Promise<CrawlExtract> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // No redirect chains (manual redirect handling)
    const res = await fetch(seedUrl, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'LegalWhat-SeedFirst/1.0 (+seed-first)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      // No fallback chains: do not follow redirects.
      return { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0 };
    }
    if (!res.ok) {
      return { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0 };
    }

    const contentType = res.headers.get('content-type') || '';
    const raw = await res.text();
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripHtmlToText(titleMatch[1]).slice(0, 120) : undefined;

    const text = contentType.includes('html') ? stripHtmlToText(raw) : raw.trim();
    const snippet = text.slice(0, 800);

    // Basic extraction (no external services, no geocoding)
    const emails = uniq((text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).slice(0, 20));
    const phones = uniq((text.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || []).slice(0, 20));
    const coords = uniq((text.match(/-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+/g) || []).slice(0, 20))
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

    // Extract same-host links only from HTML (no cross-site hopping).
    const linksRaw = (raw.match(/href\s*=\s*["']([^"']+)["']/gi) || []).slice(0, 200);
    const links: string[] = [];
    const seedHost = new URL(seedUrl).host;
    for (const entry of linksRaw) {
      const m = entry.match(/href\s*=\s*["']([^"']+)["']/i);
      if (!m) continue;
      const href = m[1];
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
      try {
        const u = new URL(href, seedUrl);
        if (u.host !== seedHost) continue; // no cross-site
        // sanitize link strictly, but do not crawl them (just report)
        const s = sanitizeUrlStrict(u.toString());
        if (s.ok) links.push(s.normalized);
      } catch {
        // ignore
      }
    }

    const itemsFound = emails.length + phones.length + coords.length + (title ? 1 : 0) + (snippet ? 1 : 0);
    return {
      title,
      textSnippet: snippet || undefined,
      emails,
      phones,
      links: uniq(links).slice(0, 25),
      coordinates: coords.slice(0, 10),
      itemsFound,
    };
  } catch {
    return { emails: [], phones: [], links: [], coordinates: [], itemsFound: 0 };
  } finally {
    clearTimeout(t);
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

