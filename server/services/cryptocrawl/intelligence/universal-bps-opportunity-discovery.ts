import logger from '../../../logger.js';

export type BpsDiscoveryVenue = 'coinbase' | 'kraken' | 'okx' | 'kalshi' | 'external';
export type BpsDiscoveryEvidenceLevel = 'discovered';
export type BpsDiscoveryMechanism =
  | 'maker_rebate'
  | 'zero_or_negative_fee'
  | 'fee_tier'
  | 'fee_credit'
  | 'liquidity_incentive'
  | 'volume_incentive'
  | 'market_maker_program'
  | 'promotion'
  | 'funding_benefit'
  | 'gas_or_execution_subsidy'
  | 'partner_or_third_party_reward'
  | 'other_execution_value';

export interface BpsOpportunityDiscovery {
  id: string;
  venue: BpsDiscoveryVenue;
  url: string;
  title: string | null;
  observedAt: number;
  mechanisms: BpsDiscoveryMechanism[];
  numericClaims: string[];
  evidenceLevel: BpsDiscoveryEvidenceLevel;
  accountEligibilityAuthenticated: false;
  preTradeEconomicAuthority: false;
  realizedEconomicAuthority: false;
  executionAuthority: false;
  sourceKind: 'official' | 'configured_external';
  provenance: string[];
}

export interface UniversalBpsDiscoverySnapshot {
  installed: boolean;
  observedAt: number | null;
  cycles: number;
  errors: number;
  pagesFetched: number;
  discoveries: BpsOpportunityDiscovery[];
  accountPosture: {
    coinbase: 'standard_plus_advanced_plus_authenticated_coinbase_one_benefits_only';
    kraken: 'free_base';
    okx: 'free_base';
    kalshi: 'standard_free';
    vipInstitutionalBenefitsAssumed: false;
  };
  recursivelyBroadening: true;
  configuredSeedExtensionSupported: true;
  publicPromotionCanCreateProfitability: false;
  executionAuthority: false;
}

const DEFAULT_SEEDS = [
  'https://help.coinbase.com/en/coinbase/trading-and-funding/advanced-trade/advanced-trade-fees',
  'https://help.coinbase.com/en/coinbase/other-topics/coinbase-one/benefit-disclosures',
  'https://www.kraken.com/features/fee-schedule',
  'https://support.kraken.com/articles/pairs-eligible-for-maker-fee-rebates',
  'https://www.okx.com/en-us/help/updates-to-us-fee-framework-2026',
  'https://help.kalshi.com/en/articles/16076644-liquidity-and-volume-incentive-programs-where-to-find-them',
  'https://help.kalshi.com/en/articles/13823851-liquidity-incentive-program',
] as const;

const DEFAULT_ALLOWED_HOSTS = new Set([
  'coinbase.com',
  'help.coinbase.com',
  'www.coinbase.com',
  'kraken.com',
  'www.kraken.com',
  'support.kraken.com',
  'okx.com',
  'www.okx.com',
  'kalshi.com',
  'www.kalshi.com',
  'help.kalshi.com',
]);

const RELEVANT = /(?:fee|rebate|refund|reward|incentive|liquidity|volume|maker|market[- ]?maker|promotion|promo|credit|discount|tier|cashback|funding|subsid|zero[- ]?fee|negative[- ]?fee|coinbase one|advanced)/i;
const MECHANISMS: Array<[BpsDiscoveryMechanism, RegExp]> = [
  ['maker_rebate', /(?:maker.{0,40}rebate|rebate.{0,40}maker)/i],
  ['zero_or_negative_fee', /(?:zero[- ]?fee|0(?:\.0+)?%\s+(?:maker|trading)|negative\s+maker|negative[- ]?fee|maker\s+(?:fee|rate).{0,30}-\s*\d)/i],
  ['fee_tier', /(?:fee\s+tier|tiered\s+fee|volume.{0,50}fee|assets on platform|vip\s+\d)/i],
  ['fee_credit', /(?:fee\s+credit|trading\s+credit|rebate\s+card|voucher|kfee)/i],
  ['liquidity_incentive', /(?:liquidity\s+(?:incentive|reward|program)|resting orders.{0,60}reward)/i],
  ['volume_incentive', /(?:volume\s+(?:incentive|reward|program)|trading volume.{0,60}reward)/i],
  ['market_maker_program', /(?:market[- ]?maker\s+(?:program|incentive|rebate)|enhanced liquidity program)/i],
  ['promotion', /(?:promotion|promo(?:tional)?|limited[- ]?time|signup bonus|bonus)/i],
  ['funding_benefit', /(?:funding\s+(?:income|receipt|rate|benefit)|funding payment)/i],
  ['gas_or_execution_subsidy', /(?:gas\s+(?:sponsor|refund|credit)|paymaster|execution\s+subsid)/i],
  ['partner_or_third_party_reward', /(?:partner\s+(?:offer|deal|reward)|cashback|affiliate\s+rebate)/i],
  ['other_execution_value', /(?:price improvement|execution improvement|spread improvement)/i],
];

let installed = false;
let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;
let observedAt: number | null = null;
let cycles = 0;
let errors = 0;
let pagesFetched = 0;
const discoveries = new Map<string, BpsOpportunityDiscovery>();

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function intervalMs(): number {
  return boundedInteger('CRYPTOCRAWL_BPS_DISCOVERY_INTERVAL_MS', 15 * 60_000, 5 * 60_000, 6 * 60 * 60_000);
}

function configuredCsv(name: string): string[] {
  return String(process.env[name] || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function configuredSeeds(): string[] {
  return [...new Set([...DEFAULT_SEEDS, ...configuredCsv('CRYPTOCRAWL_BPS_DISCOVERY_SEEDS')])];
}

function configuredAllowedHosts(): Set<string> {
  return new Set([...DEFAULT_ALLOWED_HOSTS, ...configuredCsv('CRYPTOCRAWL_BPS_DISCOVERY_ALLOWED_HOSTS').map(host => host.toLowerCase())]);
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === '::1'
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^169\.254\./.test(host)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
}

function allowedUrl(raw: string, allowedHosts: Set<string>): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || isPrivateHost(url.hostname)) return null;
    const host = url.hostname.toLowerCase();
    if (![...allowedHosts].some(allowed => host === allowed || host.endsWith(`.${allowed}`))) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function venueFor(url: URL): BpsDiscoveryVenue {
  const host = url.hostname.toLowerCase();
  if (host.includes('coinbase.com')) return 'coinbase';
  if (host.includes('kraken.com')) return 'kraken';
  if (host.includes('okx.com')) return 'okx';
  if (host.includes('kalshi.com')) return 'kalshi';
  return 'external';
}

function sourceKindFor(url: URL): BpsOpportunityDiscovery['sourceKind'] {
  return venueFor(url) === 'external' ? 'configured_external' : 'official';
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function textFromHtml(html: string): string {
  return decodeHtml(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleFromHtml(html: string): string | null {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? textFromHtml(match[1]).slice(0, 240) || null : null;
}

function classifyMechanisms(text: string): BpsDiscoveryMechanism[] {
  return MECHANISMS.filter(([, pattern]) => pattern.test(text)).map(([mechanism]) => mechanism);
}

function numericClaims(text: string): string[] {
  const matches = text.match(/(?:-?\d+(?:\.\d+)?\s*%|-?\d+(?:\.\d+)?\s*(?:bps|basis points)|up to\s+\d+(?:\.\d+)?\s*%)/gi) || [];
  return [...new Set(matches.map(value => value.trim()))].slice(0, 24);
}

function stableId(url: URL, mechanisms: readonly string[]): string {
  return `${venueFor(url)}:${url.toString()}:${[...mechanisms].sort().join(',')}`;
}

function extractRelevantLinks(html: string, base: URL, allowedHosts: Set<string>): URL[] {
  const links: URL[] = [];
  const anchor = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (let match = anchor.exec(html); match; match = anchor.exec(html)) {
    const href = match[1];
    const label = `${textFromHtml(match[2])} ${href}`;
    if (!RELEVANT.test(label)) continue;
    try {
      const resolved = allowedUrl(new URL(href, base).toString(), allowedHosts);
      if (resolved) links.push(resolved);
    } catch {
      // Ignore malformed links; discovery is advisory and fail-soft.
    }
  }
  return [...new Map(links.map(link => [link.toString(), link])).values()];
}

async function fetchPage(url: URL): Promise<{ html: string; title: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundedInteger('CRYPTOCRAWL_BPS_DISCOVERY_TIMEOUT_MS', 8_000, 2_000, 20_000));
  timeout.unref?.();
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,text/plain;q=0.9,*/*;q=0.1',
        'user-agent': 'CryptoCrawler-BPS-Discovery/1.0',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) throw new Error(`unsupported content type ${contentType}`);
    const html = (await response.text()).slice(0, boundedInteger('CRYPTOCRAWL_BPS_DISCOVERY_MAX_BYTES', 750_000, 50_000, 2_000_000));
    return { html, title: titleFromHtml(html) };
  } finally {
    clearTimeout(timeout);
  }
}

async function scanOnce(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const allowedHosts = configuredAllowedHosts();
    const maxPages = boundedInteger('CRYPTOCRAWL_BPS_DISCOVERY_MAX_PAGES', 24, 4, 96);
    const maxDepth = boundedInteger('CRYPTOCRAWL_BPS_DISCOVERY_MAX_DEPTH', 2, 0, 4);
    const queue = configuredSeeds()
      .map(raw => allowedUrl(raw, allowedHosts))
      .filter((url): url is URL => url !== null)
      .map(url => ({ url, depth: 0 }));
    const visited = new Set<string>();
    let fetchedThisCycle = 0;

    while (queue.length > 0 && fetchedThisCycle < maxPages) {
      const current = queue.shift()!;
      const key = current.url.toString();
      if (visited.has(key)) continue;
      visited.add(key);
      try {
        const page = await fetchPage(current.url);
        fetchedThisCycle += 1;
        pagesFetched += 1;
        const text = textFromHtml(page.html);
        if (RELEVANT.test(text)) {
          const mechanisms = classifyMechanisms(text);
          if (mechanisms.length > 0) {
            const id = stableId(current.url, mechanisms);
            discoveries.set(id, {
              id,
              venue: venueFor(current.url),
              url: current.url.toString(),
              title: page.title,
              observedAt: Date.now(),
              mechanisms,
              numericClaims: numericClaims(text),
              evidenceLevel: 'discovered',
              accountEligibilityAuthenticated: false,
              preTradeEconomicAuthority: false,
              realizedEconomicAuthority: false,
              executionAuthority: false,
              sourceKind: sourceKindFor(current.url),
              provenance: [
                'public_or_configured_web_discovery_only',
                'account_eligibility_requires_authenticated_evidence',
                'numeric_claims_are_advisory_not_economic_credit',
                'no_credentials_sent_to_discovery_pages',
                current.depth > 0 ? 'recursively_discovered_link' : 'configured_or_official_seed',
              ],
            });
          }
        }
        if (current.depth < maxDepth) {
          for (const link of extractRelevantLinks(page.html, current.url, allowedHosts)) {
            if (!visited.has(link.toString())) queue.push({ url: link, depth: current.depth + 1 });
          }
        }
      } catch (error) {
        logger.debug('[UniversalBPSDiscovery] Source scan degraded without affecting canonical economics', {
          component: 'UniversalBpsOpportunityDiscovery',
          url: current.url.toString(),
          depth: current.depth,
          error: error instanceof Error ? error.message : String(error),
          executionAuthority: false,
        });
      }
    }

    const retentionMs = boundedInteger('CRYPTOCRAWL_BPS_DISCOVERY_RETENTION_MS', 7 * 24 * 60 * 60_000, 60 * 60_000, 30 * 24 * 60 * 60_000);
    const cutoff = Date.now() - retentionMs;
    for (const [id, row] of discoveries) if (row.observedAt < cutoff) discoveries.delete(id);
    observedAt = Date.now();
    cycles += 1;

    logger.info('[UniversalBPSDiscovery] Recursively broadening BPS opportunity scan completed', {
      component: 'UniversalBpsOpportunityDiscovery',
      fetchedThisCycle,
      discoveries: discoveries.size,
      venues: [...new Set([...discoveries.values()].map(row => row.venue))],
      accountPosture: {
        coinbase: 'standard_plus_advanced_plus_authenticated_coinbase_one_benefits_only',
        kraken: 'free_base',
        okx: 'free_base',
        kalshi: 'standard_free',
      },
      publicPromotionCanCreateProfitability: false,
      recursiveLinkBroadening: true,
      configuredSeedExtensionSupported: true,
      executionAuthority: false,
    });
  })().catch(error => {
    errors += 1;
    observedAt = Date.now();
    logger.warn('[UniversalBPSDiscovery] Discovery cycle failed soft', {
      component: 'UniversalBpsOpportunityDiscovery',
      error: error instanceof Error ? error.message : String(error),
      canonicalEconomicsAffected: false,
      executionAuthority: false,
    });
  }).finally(() => { inFlight = null; });
  return inFlight;
}

function scheduleNext(): void {
  if (process.env.NO_INTERVALS === 'true') return;
  timer = setTimeout(async () => {
    timer = null;
    await scanOnce();
    scheduleNext();
  }, intervalMs());
  timer.unref?.();
}

export function getUniversalBpsOpportunityDiscoveries(venues?: readonly string[]): BpsOpportunityDiscovery[] {
  const wanted = venues?.length ? new Set(venues.map(value => value.trim().toLowerCase())) : null;
  return [...discoveries.values()]
    .filter(row => !wanted || wanted.has(row.venue) || row.venue === 'external')
    .sort((left, right) => right.observedAt - left.observedAt || left.url.localeCompare(right.url))
    .map(row => ({ ...row, mechanisms: [...row.mechanisms], numericClaims: [...row.numericClaims], provenance: [...row.provenance] }));
}

export function getUniversalBpsDiscoverySnapshot(): UniversalBpsDiscoverySnapshot {
  return {
    installed,
    observedAt,
    cycles,
    errors,
    pagesFetched,
    discoveries: getUniversalBpsOpportunityDiscoveries(),
    accountPosture: {
      coinbase: 'standard_plus_advanced_plus_authenticated_coinbase_one_benefits_only',
      kraken: 'free_base',
      okx: 'free_base',
      kalshi: 'standard_free',
      vipInstitutionalBenefitsAssumed: false,
    },
    recursivelyBroadening: true,
    configuredSeedExtensionSupported: true,
    publicPromotionCanCreateProfitability: false,
    executionAuthority: false,
  };
}

export function ensureUniversalBpsOpportunityDiscovery(): void {
  if (installed) return;
  installed = true;
  void scanOnce().finally(scheduleNext);
}
