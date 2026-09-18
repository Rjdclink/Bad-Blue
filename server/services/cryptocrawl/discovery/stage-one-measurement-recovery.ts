import { BigNumber, Contract, ethers } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager, type SupportedChain as RpcSupportedChain } from '../api/blockchain-providers.js';
import { getAcrossCrossSwapQuote } from '../bridge/across-bridge-provider.js';
import { SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import { gasOracle } from '../bridge/gas-oracle.js';
import type { ChainId } from '../bridge/types.js';
import { resolveAaveV3Pool } from '../execution/adapters/flash-loan-provider-economics.js';
import type { SupportedExecutionChain } from '../execution/adapters/onchain-payload-builder.js';
import { getMeasuredErc20Decimals } from '../intelligence/erc20-decimals-authority.js';
import { zeroCapitalRouteEvidenceRegistry } from '../optimization/zero-capital-route-evidence-registry.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import { discoverFundingRates } from './funding-rate-discovery.js';
import { measuredCandidateRegistry, type MeasuredCandidate, type MeasuredOpportunityTopology } from './measured-candidate-registry.js';

const TTL_MS = 60_000;
const AAVE_POOL_ABI = [
  'event Borrow(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint8 interestRateMode,uint256 borrowRate,uint16 indexed referralCode)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase,uint256 totalDebtBase,uint256 availableBorrowsBase,uint256 currentLiquidationThreshold,uint256 ltv,uint256 healthFactor)',
];
const FUNDING_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT'];
const DEX_CHAINS: readonly ChainId[] = ['bsc', 'polygon', 'arbitrum', 'avalanche'];
const LIQUIDATION_CHAINS: readonly RpcSupportedChain[] = ['ethereum', 'polygon', 'arbitrum'];

type RecoveryStats = {
  cycles: number;
  lastCycleAt: number | null;
  lastError: string | null;
  recovered: Partial<Record<MeasuredOpportunityTopology, number>>;
};

const stats: RecoveryStats = { cycles: 0, lastCycleAt: null, lastError: null, recovered: {} };
let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;

function finite(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function remember(topology: MeasuredOpportunityTopology, spreadBps: number): void {
  if (!Number.isFinite(spreadBps)) return;
  stats.recovered[topology] = spreadBps;
}

function intervalMs(): number {
  const value = Number(process.env.CRYPTOCRAWL_STAGE_ONE_RECOVERY_INTERVAL_MS || 15_000);
  return Number.isFinite(value) ? Math.max(5_000, Math.min(120_000, Math.trunc(value))) : 15_000;
}

function recordMeasurement(input: {
  topology: MeasuredOpportunityTopology;
  opportunityId: string;
  spreadBps: number;
  observedAt: number;
  assets: string[];
  venues: string[];
  chains: string[];
  rawQuotes?: MeasuredCandidate['rawQuotes'];
  notionalUsd?: number | null;
  grossProfitUsd?: number | null;
  detail: string;
  provenance: string[];
}): void {
  if (!Number.isFinite(input.spreadBps)) return;
  measuredCandidateRegistry.record({
    opportunityId: input.opportunityId,
    topology: input.topology,
    observedAt: input.observedAt,
    expiresAt: input.observedAt + TTL_MS,
    status: 'enriched',
    assets: input.assets,
    venues: input.venues,
    chains: input.chains,
    rawQuotes: input.rawQuotes ?? [],
    depth: { status: 'measured', detail: input.detail },
    economics: {
      grossProfitUsd: input.grossProfitUsd ?? null,
      deterministicNetProfitUsd: null,
      feeUsd: null,
      gasUsd: null,
      bridgeUsd: null,
      expectedSlippageBps: null,
      expectedPriceImpactBps: null,
      notionalUsd: input.notionalUsd ?? null,
      grossProfitBps: input.spreadBps,
      netProfitBps: null,
    },
    quoteAgeMs: Math.max(0, Date.now() - input.observedAt),
    executableCapability: false,
    executionCapabilityReason: 'Stage-1 measurement recovery is observation-only; canonical execution still requires the strategy-specific current hard evidence and strictly positive all-in economics',
    missingInformation: ['required:strategy_specific_all_in_execution_evidence'],
    provenance: [
      ...input.provenance,
      'stage_one_measurement_recovery:true',
      'measurement_before_execution_readiness:true',
      'execution_authority:false',
      'economic_mutation_authority:false',
      'synthetic_evidence:false',
    ],
  });
  remember(input.topology, input.spreadBps);
}

function openOceanChainCode(chain: ChainId): string {
  return chain === 'avalanche' ? 'avax' : chain;
}

async function openOceanQuote(input: {
  chain: ChainId;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
}): Promise<{ outAmount: string; observedAt: number } | null> {
  const gas = await gasOracle.getGasPrice(input.chain).catch(() => null);
  if (!gas || !Number.isFinite(gas.gweiPrice) || gas.gweiPrice <= 0) return null;
  const gasPriceDecimals = BigInt(Math.max(1, Math.ceil(gas.gweiPrice * 1_000_000_000))).toString();
  const query = new URLSearchParams({
    inTokenAddress: input.sellToken,
    outTokenAddress: input.buyToken,
    amountDecimals: input.sellAmount,
    gasPriceDecimals,
  });
  const payload = await fetchJsonWithRetry<any>(
    `https://open-api.openocean.finance/v4/${openOceanChainCode(input.chain)}/quote?${query.toString()}`,
    { maxRetries: 1, baseDelayMs: 150, maxDelayMs: 500, timeoutMs: 3_000 },
  ).catch(() => null);
  const outAmount = payload?.code === 200 && typeof payload?.data?.outAmount === 'string' && /^\d+$/.test(payload.data.outAmount)
    ? payload.data.outAmount
    : null;
  return outAmount && BigInt(outAmount) > 0n ? { outAmount, observedAt: Date.now() } : null;
}

async function recoverDex(): Promise<void> {
  for (const chain of DEX_CHAINS) {
    const config = SUPPORTED_CHAINS[chain];
    if (!config?.usdc || !config?.usdt) continue;
    try {
      const [usdcDecimals, usdtDecimals] = await Promise.all([
        getMeasuredErc20Decimals(chain, config.usdc),
        getMeasuredErc20Decimals(chain, config.usdt),
      ]);
      const notionalUsd = 25;
      const amountIn = (25n * (10n ** BigInt(usdcDecimals))).toString();
      const first = await openOceanQuote({ chain, sellToken: config.usdc, buyToken: config.usdt, sellAmount: amountIn });
      if (!first) continue;
      const second = await openOceanQuote({ chain, sellToken: config.usdt, buyToken: config.usdc, sellAmount: first.outAmount });
      if (!second) continue;
      const finalUnits = Number(second.outAmount) / (10 ** usdcDecimals);
      if (!Number.isFinite(finalUnits) || finalUnits <= 0) continue;
      const grossProfitUsd = finalUnits - notionalUsd;
      const spreadBps = grossProfitUsd / notionalUsd * 10_000;
      recordMeasurement({
        topology: 'DEX_ATOMIC',
        opportunityId: `stage1-recovery:dex:${chain}:${second.observedAt}`,
        spreadBps,
        observedAt: second.observedAt,
        assets: ['USDC', 'USDT'],
        venues: ['openocean'],
        chains: [chain],
        rawQuotes: [
          { source: 'openocean', venue: 'openocean', chain, symbol: 'USDC/USDT', observedAt: first.observedAt, amountIn, amountOut: first.outAmount, executable: false },
          { source: 'openocean', venue: 'openocean', chain, symbol: 'USDT/USDC', observedAt: second.observedAt, amountIn: first.outAmount, amountOut: second.outAmount, executable: false },
        ],
        notionalUsd,
        grossProfitUsd,
        detail: 'Two live OpenOcean V4 quote-only legs measured a complete USDC→USDT→USDC round trip; no execution readiness is inferred',
        provenance: [
          'openocean_v4:live_quote_only_round_trip',
          `measured_usdc_decimals:${usdcDecimals}`,
          `measured_usdt_decimals:${usdtDecimals}`,
          'stage_one_spread:gross_round_trip_before_execution_cost_hydration',
        ],
      });
      return;
    } catch {
      // Chain-local measurement failure; preserve alternatives.
    }
  }
}

async function recoverCrossChain(): Promise<void> {
  const routes: Array<[ChainId, ChainId]> = [
    ['arbitrum', 'polygon'], ['polygon', 'arbitrum'], ['arbitrum', 'avalanche'], ['avalanche', 'arbitrum'],
  ];
  for (const [originChain, destinationChain] of routes) {
    try {
      const quote = await getAcrossCrossSwapQuote({
        originChain,
        destinationChain,
        inputSymbol: 'USDC',
        outputSymbol: 'USDC',
        amountHuman: 100,
      });
      if (!quote) continue;
      const outputRaw = quote.minOutputAmount ?? quote.expectedOutputAmount;
      if (!/^\d+$/.test(outputRaw) || !/^\d+$/.test(quote.inputAmount)) continue;
      const inputHuman = Number(quote.inputAmount) / (10 ** quote.inputTokenDecimals);
      const outputHuman = Number(outputRaw) / (10 ** quote.outputTokenDecimals);
      if (!(inputHuman > 0) || !Number.isFinite(outputHuman)) continue;
      const spreadBps = (outputHuman - inputHuman) / inputHuman * 10_000;
      recordMeasurement({
        topology: 'CROSS_CHAIN',
        opportunityId: `stage1-recovery:across:${originChain}:${destinationChain}:${quote.observedAt}`,
        spreadBps,
        observedAt: quote.observedAt,
        assets: ['USDC'],
        venues: ['across'],
        chains: [originChain, destinationChain],
        rawQuotes: [{
          source: 'across', venue: 'across', chain: `${originChain}->${destinationChain}`, symbol: 'USDC/USDC',
          observedAt: quote.observedAt, amountIn: quote.inputAmount, amountOut: outputRaw, executable: false,
        }],
        detail: 'Fresh Across same-asset exact-input quote measured guaranteed/quoted USDC output against USDC input; price conversion is unnecessary for the same asset',
        provenance: [
          ...quote.provenance,
          quote.minOutputAmount ? 'stage_one_spread:guaranteed_minimum_same_asset_output' : 'stage_one_spread:expected_same_asset_output',
          `input_decimals:${quote.inputTokenDecimals}`,
          `output_decimals:${quote.outputTokenDecimals}`,
        ],
      });
      return;
    } catch {
      // Route-local provider failure; try the next compatible route.
    }
  }
}

async function recoverFunding(): Promise<void> {
  const batch = await discoverFundingRates(FUNDING_SYMBOLS).catch(() => null);
  if (!batch?.observations?.length) return;
  const bySymbol = new Map<string, typeof batch.observations>();
  for (const observation of batch.observations) {
    const rows = bySymbol.get(observation.symbol) || [];
    rows.push(observation);
    bySymbol.set(observation.symbol, rows);
  }
  const spreads = [...bySymbol.entries()].flatMap(([symbol, rows]) => {
    const unique = rows.filter((row, index) => rows.findIndex(other => other.venue === row.venue) === index);
    if (unique.length < 2) return [];
    const ordered = [...unique].sort((a, b) => a.fundingRate - b.fundingRate);
    const low = ordered[0];
    const high = ordered[ordered.length - 1];
    return [{ symbol, low, high, spreadBps: (high.fundingRate - low.fundingRate) * 10_000 }];
  }).filter(item => Number.isFinite(item.spreadBps))
    .sort((a, b) => b.spreadBps - a.spreadBps);
  const best = spreads[0];
  if (!best) return;
  const observedAt = Math.max(best.low.observedAt, best.high.observedAt);
  recordMeasurement({
    topology: 'FUNDING_ARBITRAGE',
    opportunityId: `stage1-recovery:funding:${best.symbol}:${best.low.venue}:${best.high.venue}:${observedAt}`,
    spreadBps: best.spreadBps,
    observedAt,
    assets: [best.symbol],
    venues: [best.low.venue, best.high.venue],
    chains: ['cex'],
    rawQuotes: [
      { source: `${best.low.venue}:funding_rate`, venue: best.low.venue, symbol: best.symbol, observedAt: best.low.observedAt, price: best.low.fundingRate, executable: false },
      { source: `${best.high.venue}:funding_rate`, venue: best.high.venue, symbol: best.symbol, observedAt: best.high.observedAt, price: best.high.fundingRate, executable: false },
    ],
    detail: 'Contemporaneous public funding rates on two venues measured a real cross-venue funding-rate differential; entry/exit basis and fees remain later-stage evidence',
    provenance: [
      ...best.low.provenance,
      ...best.high.provenance,
      'stage_one_spread:cross_venue_funding_rate_differential',
      'single_funding_rate_is_not_arbitrage_profit',
    ],
  });
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}

async function recoverPrediction(): Promise<void> {
  const marketsResponse = await fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=30', {
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(4_000),
  }).catch(() => null);
  if (!marketsResponse?.ok) return;
  const markets: any[] = await marketsResponse.json().catch(() => []);
  const binary = markets.flatMap(market => {
    const outcomes = parseStringArray(market?.outcomes).map(value => value.toLowerCase());
    const tokenIds = Array.isArray(market?.clob_token_ids) ? market.clob_token_ids.map(String) : parseStringArray(market?.clobTokenIds);
    const yes = outcomes.indexOf('yes');
    const no = outcomes.indexOf('no');
    return yes >= 0 && no >= 0 && tokenIds[yes] && tokenIds[no]
      ? [{ market, yesTokenId: tokenIds[yes], noTokenId: tokenIds[no] }]
      : [];
  });
  if (!binary.length) return;
  const tokenIds = [...new Set(binary.flatMap(item => [item.yesTokenId, item.noTokenId]))];
  const booksResponse = await fetch('https://clob.polymarket.com/books', {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(tokenIds.map(token_id => ({ token_id }))), signal: AbortSignal.timeout(4_000),
  }).catch(() => null);
  if (!booksResponse?.ok) return;
  const books: any[] = await booksResponse.json().catch(() => []);
  const byToken = new Map(books.map(book => [String(book?.asset_id || ''), book]));
  const bestAsk = (book: any): { price: number; size: number } | null => {
    const rows = (Array.isArray(book?.asks) ? book.asks : [])
      .map((row: any) => ({ price: Number(row?.price), size: Number(row?.size) }))
      .filter((row: any) => Number.isFinite(row.price) && row.price > 0 && row.price <= 1 && Number.isFinite(row.size) && row.size > 0)
      .sort((a: any, b: any) => a.price - b.price);
    return rows[0] || null;
  };
  const observations = binary.flatMap(item => {
    const yes = bestAsk(byToken.get(item.yesTokenId));
    const no = bestAsk(byToken.get(item.noTokenId));
    if (!yes || !no) return [];
    const combinedAsk = yes.price + no.price;
    if (!(combinedAsk > 0)) return [];
    const matchedShares = Math.min(yes.size, no.size);
    const spreadBps = (1 - combinedAsk) / combinedAsk * 10_000;
    return [{ item, yes, no, combinedAsk, matchedShares, spreadBps }];
  }).filter(item => Number.isFinite(item.spreadBps))
    .sort((a, b) => Math.abs(a.spreadBps) - Math.abs(b.spreadBps));
  const best = observations[0];
  if (!best) return;
  const observedAt = Date.now();
  const grossProfitUsd = (1 - best.combinedAsk) * best.matchedShares;
  const notionalUsd = best.combinedAsk * best.matchedShares;
  recordMeasurement({
    topology: 'PREDICTION_EVENT',
    opportunityId: `stage1-recovery:prediction:${best.item.market?.id || best.item.yesTokenId}:${observedAt}`,
    spreadBps: best.spreadBps,
    observedAt,
    assets: ['PREDICTION_EVENT'],
    venues: ['polymarket'],
    chains: [],
    rawQuotes: [
      { source: 'polymarket_clob_yes_ask', venue: 'polymarket', symbol: String(best.item.market?.id || ''), observedAt, price: best.yes.price, executable: false },
      { source: 'polymarket_clob_no_ask', venue: 'polymarket', symbol: String(best.item.market?.id || ''), observedAt, price: best.no.price, executable: false },
    ],
    notionalUsd: notionalUsd > 0 ? notionalUsd : null,
    grossProfitUsd,
    detail: 'Live YES and NO asks plus matched public depth measured signed binary-parity BPS even when parity is a negative near miss',
    provenance: [
      'polymarket_gamma_public:no_auth',
      'polymarket_clob_books_public:no_auth',
      'stage_one_spread:signed_yes_no_parity',
      'positive_only_discovery_filter_not_applied_to_stage_one_measurement',
    ],
  });
}

function healthFactorNumber(raw: BigNumber): number {
  const value = Number(ethers.utils.formatUnits(raw, 18));
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

async function recoverLiquidation(): Promise<void> {
  for (const chain of LIQUIDATION_CHAINS) {
    const pool = resolveAaveV3Pool(chain as SupportedExecutionChain);
    if (!pool) continue;
    try {
      await multiProviderRpcManager.initialize([chain]);
      const { result: latestBlock } = await multiProviderRpcManager.execute(chain, 'blocks', provider => provider.getBlockNumber());
      const fromBlock = Math.max(0, latestBlock - 2_000);
      const { result: events } = await multiProviderRpcManager.execute(chain, 'logs', async provider => {
        const contract = new Contract(pool, AAVE_POOL_ABI, provider);
        return contract.queryFilter(contract.filters.Borrow(), fromBlock, latestBlock);
      });
      const borrowers = [...new Set(events.slice(-64).map(event => String(event.args?.onBehalfOf || event.args?.user || '')).filter(ethers.utils.isAddress))].slice(-24);
      if (!borrowers.length) continue;
      const observations = await Promise.allSettled(borrowers.map(async borrower => {
        const { result: account } = await multiProviderRpcManager.execute(chain, 'contract_calls', async provider => {
          const contract = new Contract(pool, AAVE_POOL_ABI, provider);
          return contract.getUserAccountData(borrower) as Promise<[BigNumber, BigNumber, BigNumber, BigNumber, BigNumber, BigNumber]>;
        });
        const debt = BigNumber.from(account[1]);
        const collateral = BigNumber.from(account[0]);
        if (debt.lte(0) || collateral.lte(0)) return null;
        const healthFactor = healthFactorNumber(BigNumber.from(account[5]));
        if (!Number.isFinite(healthFactor) || healthFactor <= 0) return null;
        return { borrower, healthFactor, spreadBps: (1 - healthFactor) * 10_000 };
      }));
      const measured = observations.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
        .sort((a, b) => Math.abs(a.spreadBps) - Math.abs(b.spreadBps));
      const closest = measured[0];
      if (!closest) continue;
      const observedAt = Date.now();
      recordMeasurement({
        topology: 'LIQUIDATION',
        opportunityId: `stage1-recovery:liquidation:${chain}:${closest.borrower}:${observedAt}`,
        spreadBps: closest.spreadBps,
        observedAt,
        assets: ['AAVE_V3_POSITION'],
        venues: ['aave_v3'],
        chains: [chain],
        rawQuotes: [{
          source: 'aave_v3_pool', venue: 'aave_v3', chain, observedAt, executable: false,
          provenance: [`borrower:${closest.borrower}`, `health_factor:${closest.healthFactor}`],
        }],
        detail: 'Live Aave V3 health factor measured signed BPS distance to the liquidation trigger; this is Stage-1 trigger spread, not a profitability or execution claim',
        provenance: [
          'aave_v3_borrow_event:live',
          'aave_v3_getUserAccountData:live',
          'stage_one_spread:signed_liquidation_trigger_distance_bps',
          'liquidation_profitability:not_assumed',
        ],
      });
      return;
    } catch {
      // Chain-local evidence failure; continue to another configured Aave chain.
    }
  }
}

function recoverMempool(): void {
  const now = Date.now();
  const mempool = measuredCandidateRegistry.getRecentIncludingExpired(1024)
    .filter(candidate => candidate.topology === 'MEMPOOL_BACKRUN' && candidate.observedAt >= now - 60_000)
    .sort((a, b) => b.observedAt - a.observedAt);
  for (const candidate of mempool) {
    const chain = candidate.chains[0] as 'ethereum' | 'polygon' | undefined;
    if (!chain) continue;
    for (const token of candidate.assets) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(token)) continue;
      const compatible = zeroCapitalRouteEvidenceRegistry.getCompatibleForAtomicSurplus({
        chain,
        inputToken: token,
        minNetBps: -10_000,
        now,
      });
      const route = compatible
        .filter(opportunity => opportunity.route.some(step => candidate.assets.some(asset =>
          asset.toLowerCase() === step.tokenIn.toLowerCase() || asset.toLowerCase() === step.tokenOut.toLowerCase())))
        .sort((a, b) => b.netProfitBps - a.netProfitBps)[0];
      if (!route || !Number.isFinite(route.netProfitBps)) continue;
      const observedAt = Math.max(candidate.observedAt, route.timestamp);
      recordMeasurement({
        topology: 'MEMPOOL_BACKRUN',
        opportunityId: `stage1-recovery:mempool:${candidate.opportunityId}:${route.id}:${observedAt}`,
        spreadBps: route.netProfitBps,
        observedAt,
        assets: candidate.assets,
        venues: [...new Set([...candidate.venues, ...route.route.map(step => step.protocol)])],
        chains: [chain],
        rawQuotes: candidate.rawQuotes,
        detail: 'A fresh decoded pending swap was matched to a fresh measured zero-capital route touching the same token path; this exposes pre-bundle measured route BPS only and does not claim post-victim execution profit',
        provenance: [
          ...candidate.provenance,
          `compatible_measured_route:${route.id}`,
          `compatible_measured_route_net_bps:${route.netProfitBps}`,
          'stage_one_spread:mempool_route_compatible_measured_bps',
          'post_victim_bundle_profitability:not_assumed',
        ],
      });
      return;
    }
  }
}

async function cycle(): Promise<void> {
  if (inFlight) return inFlight;
  const work = (async () => {
    const settled = await Promise.allSettled([
      recoverDex(),
      recoverCrossChain(),
      recoverFunding(),
      recoverPrediction(),
      recoverLiquidation(),
    ]);
    recoverMempool();
    const rejected = settled.filter(result => result.status === 'rejected') as PromiseRejectedResult[];
    stats.cycles += 1;
    stats.lastCycleAt = Date.now();
    stats.lastError = rejected.length ? rejected.map(result => result.reason instanceof Error ? result.reason.message : String(result.reason)).join('; ').slice(0, 2_000) : null;
    logger.info('[StageOneMeasurementRecovery] Pre-execution measurement cycle completed', {
      component: 'StageOneMeasurementRecovery',
      recovered: stats.recovered,
      rejectedTasks: rejected.length,
      executionAuthority: false,
      economicMutationAuthority: false,
      syntheticEconomicsAllowed: false,
    });
  })().finally(() => { inFlight = null; });
  inFlight = work;
  return work;
}

export function getStageOneMeasurementRecoverySnapshot(): RecoveryStats {
  return { ...stats, recovered: { ...stats.recovered } };
}

export function ensureStageOneMeasurementRecovery(): void {
  if (timer) return;
  void cycle();
  if (process.env.NO_INTERVALS !== 'true') {
    timer = setInterval(() => void cycle(), intervalMs());
    timer.unref?.();
  }
  logger.info('[StageOneMeasurementRecovery] Measurement-first recovery installed', {
    component: 'StageOneMeasurementRecovery',
    intervalMs: intervalMs(),
    recoveredTopologies: ['DEX_ATOMIC', 'CROSS_CHAIN', 'MEMPOOL_BACKRUN', 'LIQUIDATION', 'FUNDING_ARBITRAGE', 'PREDICTION_EVENT'],
    executionAuthority: false,
    economicMutationAuthority: false,
    syntheticEconomicsAllowed: false,
  });
}
export function stopStageOneMeasurementRecovery(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
