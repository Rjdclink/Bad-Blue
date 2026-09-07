import logger from '../../../logger.js';
import type {
  BpsDiscoveryMechanism,
  BpsDiscoveryVenue,
  BpsOpportunityDiscovery,
} from './universal-bps-opportunity-discovery.js';

const RELEVANT = /(?:fee|rebate|refund|reward|incentive|liquidity|volume|maker|market[- ]?maker|promotion|promo|credit|discount|tier|cashback|funding|subsid|zero[- ]?fee|negative[- ]?fee|coinbase one|advanced)/i;
const MECHANISMS: Array<[BpsDiscoveryMechanism, RegExp]> = [
  ['maker_rebate', /(?:maker.{0,40}rebate|rebate.{0,40}maker)/i],
  ['zero_or_negative_fee', /(?:zero[- ]?fee|negative\s+maker|negative[- ]?fee|maker\s+(?:fee|rate).{0,30}-\s*\d)/i],
  ['fee_tier', /(?:fee\s+tier|tiered\s+fee|volume.{0,50}fee|vip\s+\d)/i],
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

const BASE_QUERIES: Array<{ venue: BpsDiscoveryVenue; query: string }> = [
  {
    venue: 'coinbase',
    query: 'Coinbase Advanced Coinbase One fee rebate reward promotion maker liquidity incentive trading credit',
  },
  {
    venue: 'kraken',
    query: 'Kraken fee rebate maker reward promotion liquidity incentive fee credit cashback',
  },
  {
    venue: 'okx',
    query: 'OKX US fee rebate maker reward promotion liquidity incentive fee credit cashback',
  },
  {
    venue: 'kalshi',
    query: 'Kalshi fee rebate fee waiver liquidity volume incentive reward promotion credit market maker',
  },
];

let installed = false;
let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;
let observedAt: number | null = null;
let cycles = 0;
let errors = 0;
let searches = 0;
const discoveries = new Map<string, BpsOpportunityDiscovery>();

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function intervalMs(): number {
  return boundedInteger('CRYPTOCRAWL_BPS_WEB_SEARCH_INTERVAL_MS', 30 * 60_000, 10 * 60_000, 12 * 60 * 60_000);
}

function searchKey(): string | null {
  const value = String(process.env.SERPAPI_API_KEY || '').trim();
  return value || null;
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

function safePublicUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || isPrivateHost(url.hostname)) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function classify(text: string): BpsDiscoveryMechanism[] {
  return MECHANISMS.filter(([, pattern]) => pattern.test(text)).map(([mechanism]) => mechanism);
}

function numericClaims(text: string): string[] {
  const matches = text.match(/(?:-?\d+(?:\.\d+)?\s*%|-?\d+(?:\.\d+)?\s*(?:bps|basis points)|up to\s+\d+(?:\.\d+)?\s*%)/gi) || [];
  return [...new Set(matches.map(value => value.trim()))].slice(0, 12);
}

function officialHost(host: string): boolean {
  return ['coinbase.com', 'kraken.com', 'okx.com', 'kalshi.com'].some(domain => host === domain || host.endsWith(`.${domain}`));
}

function venueFromResult(defaultVenue: BpsDiscoveryVenue, text: string, url: URL): BpsDiscoveryVenue {
  const haystack = `${url.hostname} ${text}`.toLowerCase();
  if (haystack.includes('coinbase')) return 'coinbase';
  if (haystack.includes('kraken')) return 'kraken';
  if (haystack.includes('okx')) return 'okx';
  if (haystack.includes('kalshi')) return 'kalshi';
  return defaultVenue === 'external' ? 'external' : defaultVenue;
}

async function serpSearch(apiKey: string, query: string): Promise<any[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundedInteger('CRYPTOCRAWL_BPS_WEB_SEARCH_TIMEOUT_MS', 10_000, 3_000, 20_000));
  timeout.unref?.();
  try {
    const params = new URLSearchParams({
      engine: 'google',
      q: query,
      api_key: apiKey,
      output: 'json',
      num: String(boundedInteger('CRYPTOCRAWL_BPS_WEB_SEARCH_RESULTS', 8, 3, 20)),
      hl: 'en',
      gl: 'us',
    });
    const response = await fetch(`https://serpapi.com/search?${params.toString()}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`SerpAPI HTTP ${response.status}`);
    const body = await response.json() as any;
    return Array.isArray(body?.organic_results) ? body.organic_results : [];
  } finally {
    clearTimeout(timeout);
  }
}

function followupQueries(rows: readonly BpsOpportunityDiscovery[]): Array<{ venue: BpsDiscoveryVenue; query: string }> {
  const result: Array<{ venue: BpsDiscoveryVenue; query: string }> = [];
  const byVenue = new Map<BpsDiscoveryVenue, Set<BpsDiscoveryMechanism>>();
  for (const row of rows) {
    const set = byVenue.get(row.venue) || new Set<BpsDiscoveryMechanism>();
    for (const mechanism of row.mechanisms) set.add(mechanism);
    byVenue.set(row.venue, set);
  }
  for (const [venue, mechanisms] of byVenue) {
    if (venue === 'external') continue;
    for (const mechanism of [...mechanisms].slice(0, 2)) {
      result.push({
        venue,
        query: `${venue} ${mechanism.replace(/_/g, ' ')} new promotion partner reward fee reduction 2026`,
      });
    }
  }
  return result;
}

async function scanOnce(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const apiKey = searchKey();
    if (!apiKey) {
      observedAt = Date.now();
      logger.info('[UniversalBPSWebSearch] Broad web search lane disabled without existing SerpAPI key', {
        component: 'UniversalBpsSearchExpansion',
        newCredentialRequiredByRuntime: false,
        fallbackOfficialRecursiveCrawlerContinues: true,
        executionAuthority: false,
      });
      return;
    }

    const maxQueries = boundedInteger('CRYPTOCRAWL_BPS_WEB_SEARCH_MAX_QUERIES', 8, 4, 24);
    const queue = [...BASE_QUERIES];
    const seenQueries = new Set<string>();
    const cycleRows: BpsOpportunityDiscovery[] = [];

    while (queue.length > 0 && seenQueries.size < maxQueries) {
      const item = queue.shift()!;
      if (seenQueries.has(item.query)) continue;
      seenQueries.add(item.query);
      try {
        const rows = await serpSearch(apiKey, item.query);
        searches += 1;
        for (const result of rows) {
          const title = String(result?.title || '').trim();
          const snippet = String(result?.snippet || '').trim();
          const link = safePublicUrl(String(result?.link || '').trim());
          const text = `${title} ${snippet}`;
          if (!link || !RELEVANT.test(text)) continue;
          const mechanisms = classify(text);
          if (mechanisms.length === 0) continue;
          const venue = venueFromResult(item.venue, text, link);
          const id = `web-search:${venue}:${link.toString()}:${mechanisms.sort().join(',')}`;
          const row: BpsOpportunityDiscovery = {
            id,
            venue,
            url: link.toString(),
            title: title || null,
            observedAt: Date.now(),
            mechanisms,
            numericClaims: numericClaims(text),
            evidenceLevel: 'discovered',
            accountEligibilityAuthenticated: false,
            preTradeEconomicAuthority: false,
            realizedEconomicAuthority: false,
            executionAuthority: false,
            sourceKind: officialHost(link.hostname.toLowerCase()) ? 'official' : 'configured_external',
            provenance: [
              'recursively_broadening_web_search_discovery',
              'serpapi_existing_optional_search_intelligence_lane',
              'search_snippet_not_economic_authority',
              'account_product_geography_eligibility_must_be_authenticated',
              officialHost(link.hostname.toLowerCase()) ? 'official_domain_result' : 'external_or_partner_result_advisory_only',
            ],
          };
          discoveries.set(id, row);
          cycleRows.push(row);
        }
      } catch (error) {
        errors += 1;
        logger.debug('[UniversalBPSWebSearch] Search query degraded without affecting economics', {
          component: 'UniversalBpsSearchExpansion',
          venue: item.venue,
          query: item.query,
          error: error instanceof Error ? error.message : String(error),
          executionAuthority: false,
        });
      }
      if (seenQueries.size === BASE_QUERIES.length) {
        for (const next of followupQueries(cycleRows)) if (!seenQueries.has(next.query)) queue.push(next);
      }
    }

    const cutoff = Date.now() - boundedInteger('CRYPTOCRAWL_BPS_WEB_SEARCH_RETENTION_MS', 7 * 24 * 60 * 60_000, 60 * 60_000, 30 * 24 * 60 * 60_000);
    for (const [id, row] of discoveries) if (row.observedAt < cutoff) discoveries.delete(id);
    observedAt = Date.now();
    cycles += 1;

    logger.info('[UniversalBPSWebSearch] Broad search expansion refreshed', {
      component: 'UniversalBpsSearchExpansion',
      queriesThisCycle: seenQueries.size,
      discoveries: discoveries.size,
      externalDiscoveries: [...discoveries.values()].filter(row => row.sourceKind === 'configured_external').length,
      recursivelyBroadenedFromObservedMechanisms: true,
      publicOrThirdPartyClaimEconomicCreditBps: 0,
      executionAuthority: false,
    });
  })().catch(error => {
    errors += 1;
    observedAt = Date.now();
    logger.warn('[UniversalBPSWebSearch] Broad search cycle failed soft', {
      component: 'UniversalBpsSearchExpansion',
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

export function getBroadWebBpsOpportunityDiscoveries(venues?: readonly string[]): BpsOpportunityDiscovery[] {
  const wanted = venues?.length ? new Set(venues.map(value => value.trim().toLowerCase())) : null;
  return [...discoveries.values()]
    .filter(row => !wanted || wanted.has(row.venue) || row.venue === 'external' || row.sourceKind === 'configured_external')
    .sort((left, right) => right.observedAt - left.observedAt || left.url.localeCompare(right.url))
    .map(row => structuredClone(row));
}

export function getUniversalBpsSearchExpansionSnapshot() {
  return {
    installed,
    enabled: Boolean(searchKey()),
    observedAt,
    cycles,
    errors,
    searches,
    discoveries: getBroadWebBpsOpportunityDiscoveries(),
    provider: 'serpapi_existing_optional_search_intelligence_lane' as const,
    recursivelyBroadening: true as const,
    accountEligibilityAuthenticationRequired: true as const,
    publicPromotionCanCreateProfitability: false as const,
    executionAuthority: false as const,
  };
}

export function ensureUniversalBpsSearchExpansion(): void {
  if (installed) return;
  installed = true;
  void scanOnce().finally(scheduleNext);
}
