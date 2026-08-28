import { createHash } from 'node:crypto';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import type { MarketUniverseAsset } from './market-data-providers.js';

export interface SlowEnrichmentRecord {
  symbol: string;
  source: 'coingecko_metadata' | 'bright_data_optional';
  observedAt: number;
  expiresAt: number;
  categories: string[];
  chains: Array<{ chain: string; contract: string }>;
  homepage: string | null;
  description: string | null;
  provenance: string[];
  executableEvidence: false;
}

let monthKey = '';
let monthlyRequests = 0;
let monthlyEstimatedCostUsd = 0;
let budgetHydrated = false;
const cache = new Map<string, SlowEnrichmentRecord>();
const MAX_CACHE = Math.max(64, Math.min(5000, Number(process.env.SLOW_ENRICHMENT_CACHE_LIMIT || 512)));

function currentMonthKey(now = new Date()): string { return `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`; }
function monthStart(now = new Date()): Date { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); }
function maxRequests(): number { return Math.max(0, Number(process.env.SLOW_ENRICHMENT_MONTHLY_REQUEST_BUDGET || 500)); }
function maxCostUsd(): number { return Math.max(0, Number(process.env.SLOW_ENRICHMENT_MONTHLY_COST_BUDGET_USD || 0)); }
async function hydrateBudget(): Promise<void> {
  const key = currentMonthKey();
  if (budgetHydrated && monthKey === key) return;
  const result = await pool.query(
    `select coalesce(count(*),0)::int as requests, coalesce(sum(metric_value),0)::float8 as cost
       from private.cryptara_metric_samples
      where metric_name='slow_enrichment_request_cost_usd' and observed_at >= $1`, [monthStart()],
  );
  monthKey = key;
  monthlyRequests = Number(result.rows[0]?.requests || 0);
  monthlyEstimatedCostUsd = Number(result.rows[0]?.cost || 0);
  budgetHydrated = true;
}
async function reserveRequest(source: string, estimatedCostUsd: number): Promise<boolean> {
  try { await hydrateBudget(); } catch (error) {
    logger.warn('[SlowEnrichment] budget ledger unavailable; optional enrichment fails closed', { component: 'SlowPathUniverseEnrichment', error: error instanceof Error ? error.message : String(error) });
    return false;
  }
  const requestBudget = maxRequests();
  const costBudget = maxCostUsd();
  if (monthlyRequests >= requestBudget) return false;
  if (costBudget > 0 && monthlyEstimatedCostUsd + estimatedCostUsd > costBudget) return false;
  monthlyRequests++;
  monthlyEstimatedCostUsd += estimatedCostUsd;
  const now = Date.now();
  const id = createHash('sha256').update(`${monthKey}:${source}:${now}:${monthlyRequests}`).digest('hex');
  void pool.query(
    `insert into private.cryptara_metric_samples (
      event_id, observed_at, metric_name, metric_value, provider, strategy, pair, chain,
      timing_bucket, cost_bucket, competition_bucket, model_version, config_version,
      provenance, source_event_ids, payload
    ) values ($1,$2,'slow_enrichment_request_cost_usd',$3,$4,'slow_path_enrichment',null,null,$5,$6,null,'enrichment-v1',$7,$8,$9,$10::jsonb)
    on conflict (event_id) do nothing`,
    [`slow-enrichment:${id}`, new Date(now), estimatedCostUsd, source, monthKey, costBudget > 0 ? 'budgeted_paid' : 'configured_zero_cost',
     process.env.CRYPTOCRAWL_CONFIG_VERSION?.trim() || 'runtime-config-v1', ['budget_ledger','non_executable_evidence'], [], JSON.stringify({ monthlyRequests, monthlyEstimatedCostUsd })],
  ).catch(() => undefined);
  return true;
}
function remember(record: SlowEnrichmentRecord): SlowEnrichmentRecord {
  cache.set(`${record.source}:${record.symbol}`, record);
  if (cache.size > MAX_CACHE) {
    const oldest = [...cache.entries()].sort((a,b) => a[1].observedAt - b[1].observedAt);
    for (let i=0;i<oldest.length-MAX_CACHE;i++) cache.delete(oldest[i][0]);
  }
  return { ...record, categories:[...record.categories], chains:record.chains.map(item=>({...item})), provenance:[...record.provenance] };
}

export async function enrichAssetSlowPath(asset: MarketUniverseAsset): Promise<SlowEnrichmentRecord | null> {
  const cached = cache.get(`coingecko_metadata:${asset.symbol}`);
  if (cached && cached.expiresAt > Date.now()) return remember(cached);
  if (!asset.coinGeckoId) return null;
  if (!await reserveRequest('coingecko_metadata', Math.max(0, Number(process.env.COINGECKO_ENRICHMENT_COST_PER_REQUEST_USD || 0)))) return null;
  try {
    const response = await fetch(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(asset.coinGeckoId)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`, { headers: { accept:'application/json' } });
    if (!response.ok) return null;
    const payload = await response.json() as any;
    const platforms = payload?.platforms && typeof payload.platforms === 'object' ? payload.platforms : {};
    return remember({
      symbol: asset.symbol,
      source: 'coingecko_metadata',
      observedAt: Date.now(),
      expiresAt: Date.now() + Math.max(60_000, Number(process.env.SLOW_ENRICHMENT_TTL_MS || 6*60*60_000)),
      categories: Array.isArray(payload?.categories) ? payload.categories.filter((value:unknown):value is string=>typeof value==='string') : [],
      chains: Object.entries(platforms).filter(([,contract])=>typeof contract==='string' && contract).map(([chain,contract])=>({chain,contract:String(contract)})),
      homepage: Array.isArray(payload?.links?.homepage) ? payload.links.homepage.find((value:unknown)=>typeof value==='string' && value) || null : null,
      description: typeof payload?.description?.en === 'string' ? payload.description.en.slice(0,4000) : null,
      provenance: ['coingecko_coin_metadata','slow_path_only','not_price_evidence'],
      executableEvidence: false,
    });
  } catch (error) {
    logger.debug('[SlowEnrichment] CoinGecko metadata request failed', { symbol: asset.symbol, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export async function optionalBrightDataEnrichment(symbol: string): Promise<SlowEnrichmentRecord | null> {
  if (process.env.BRIGHT_DATA_ENRICHMENT_ENABLED !== 'true') return null;
  const endpoint = process.env.BRIGHT_DATA_ENRICHMENT_ENDPOINT?.trim();
  const token = process.env.BRIGHT_DATA_API_TOKEN?.trim();
  if (!endpoint || !token) return null;
  const cost = Math.max(0, Number(process.env.BRIGHT_DATA_ESTIMATED_COST_PER_REQUEST_USD || 0));
  if (!await reserveRequest('bright_data_optional', cost)) return null;
  const url = new URL(endpoint); url.searchParams.set('symbol', symbol);
  try {
    const response = await fetch(url, { headers:{ authorization:`Bearer ${token}`, accept:'application/json' } });
    if (!response.ok) return null;
    const payload = await response.json() as any;
    return remember({ symbol, source:'bright_data_optional', observedAt:Date.now(), expiresAt:Date.now()+Math.max(60_000,Number(process.env.SLOW_ENRICHMENT_TTL_MS||6*60*60_000)),
      categories:Array.isArray(payload?.categories)?payload.categories.filter((v:unknown):v is string=>typeof v==='string'):[], chains:[], homepage:null, description:typeof payload?.summary==='string'?payload.summary.slice(0,4000):null,
      provenance:['bright_data_optional','web_enrichment_only','not_orderbook_fee_inventory_or_settlement_evidence'], executableEvidence:false };
  } catch { return null; }
}

export function getSlowEnrichmentHealth() {
  return { cacheEntries:cache.size, monthKey, monthlyRequests, monthlyEstimatedCostUsd, monthlyRequestBudget:maxRequests(), monthlyCostBudgetUsd:maxCostUsd(), executableEvidence:false as const };
}
