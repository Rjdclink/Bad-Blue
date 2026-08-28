import type { providers } from 'ethers';
import logger from '../../../logger.js';
import { DEFAULT_GAS_LIMIT, SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import { gasOracle } from '../bridge/gas-oracle.js';
import type { ChainId } from '../bridge/types.js';
import {
  quoteConfiguredZeroCapitalRoutesForChain,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import type { SupportedExecutionChain } from '../execution/adapters/onchain-payload-builder.js';
import {
  recordZeroCapitalRouteQuoteCycle,
  selectZeroCapitalRoutesForQuote,
  type ZeroCapitalRoutePreScore,
} from './zero-capital-route-preselection.js';

export interface DynamicZeroCapitalDiscoveryState {
  observedAt: number | null;
  cycles: number;
  structuralCandidates: number;
  measuredQuotes: number;
  positiveQuotes: number;
  quoteBudgetSelections: number;
  chains: Record<string, {
    candidates: number;
    selectedForQuote: number;
    measuredQuotes: number;
    positiveQuotes: number;
    gasCostUsd: number | null;
    quoteBudget: number;
    scoredCandidates: number;
    explorationSelected: number;
    exploitationSelected: number;
    topPreScores: Array<{ routeId: string; preScore: number }>;
    error?: string;
  }>;
}

const state: DynamicZeroCapitalDiscoveryState = {
  observedAt: null,
  cycles: 0,
  structuralCandidates: 0,
  measuredQuotes: 0,
  positiveQuotes: 0,
  quoteBudgetSelections: 0,
  chains: {},
};

const DYNAMIC_EXECUTABLE_CHAINS = new Set<ChainId>(['polygon', 'arbitrum']);
const DYNAMIC_PROTOCOL_PAIRS = [
  ['uniswapV3', 'sushiswap'],
  ['sushiswap', 'uniswapV3'],
] as const;

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, normalized));
}

function notionalsUsd(): number[] {
  const raw = process.env.ZERO_CAPITAL_DYNAMIC_NOTIONAL_USD?.trim();
  const configured = raw
    ? raw.split(',').map(item => Number(item.trim())).filter(value => Number.isFinite(value) && value > 0)
    : [50, 100, 250, 500, 1000];
  return [...new Set(configured)]
    .sort((left, right) => left - right)
    .slice(0, Math.max(1, Math.min(12, Number(process.env.ZERO_CAPITAL_DYNAMIC_NOTIONAL_COUNT || 8))));
}

function feeTiers(): Array<500 | 3000 | 10000> {
  const parsed = (process.env.ZERO_CAPITAL_DYNAMIC_UNISWAP_FEE_TIERS || '500,3000')
    .split(',')
    .map(value => Number(value.trim()))
    .filter((value): value is 500 | 3000 | 10000 => value === 500 || value === 3000 || value === 10000);
  return parsed.length > 0 ? [...new Set(parsed)] : [500, 3000];
}

function stableBaseUnits(usd: number): string {
  return BigInt(Math.max(1, Math.floor(usd * 1_000_000))).toString();
}

function protocolLeg(
  protocol: 'uniswapV3' | 'sushiswap',
  tokenIn: string,
  tokenOut: string,
  feeTier: 500 | 3000 | 10000,
) {
  return protocol === 'uniswapV3'
    ? { protocol, tokenIn, tokenOut, feeTier }
    : { protocol, tokenIn, tokenOut, fee: 0.003 };
}

function topScores(scores: readonly ZeroCapitalRoutePreScore[]): Array<{ routeId: string; preScore: number }> {
  return scores
    .filter((score): score is ZeroCapitalRoutePreScore & { preScore: number } => score.preScore !== null && Number.isFinite(score.preScore))
    .sort((left, right) => right.preScore - left.preScore || left.routeId.localeCompare(right.routeId))
    .slice(0, 8)
    .map(score => ({ routeId: score.routeId, preScore: score.preScore }));
}

/**
 * Structural route enumeration is not profitability evidence. It only defines
 * bounded executable protocol/token paths that must still receive live on-chain
 * quotes and all-in cost measurement before becoming an opportunity.
 */
export function buildDynamicZeroCapitalRouteTemplates(chain: SupportedExecutionChain): ConfiguredZeroCapitalRoute[] {
  if (!DYNAMIC_EXECUTABLE_CHAINS.has(chain as ChainId)) return [];
  const config = SUPPORTED_CHAINS[chain as ChainId];
  if (!config?.usdc || !config?.usdt) return [];

  const routes: ConfiguredZeroCapitalRoute[] = [];
  const amounts = notionalsUsd();
  for (const input of [
    { symbol: 'USDC' as const, token: config.usdc, other: config.usdt },
    { symbol: 'USDT' as const, token: config.usdt, other: config.usdc },
  ]) {
    for (const notional of amounts) {
      for (const [firstProtocol, secondProtocol] of DYNAMIC_PROTOCOL_PAIRS) {
        for (const feeTier of feeTiers()) {
          routes.push({
            id: `dynamic-${chain}-${input.symbol}-${notional}-${firstProtocol}-${secondProtocol}-${feeTier}`,
            chain,
            inputAssetSymbol: input.symbol,
            inputToken: input.token,
            inputTokenDecimals: 6,
            amountIn: stableBaseUnits(notional),
            // Structural templates are never passed to profitability evaluation.
            // Live gas-cost enrichment below replaces these placeholders first.
            estimatedGasCostInInputToken: '0',
            relayFeeInInputToken: '0',
            flashLoanFeeBps: bounded(process.env.ZERO_CAPITAL_DYNAMIC_FLASH_LOAN_FEE_BPS, 12, 0, 1000),
            minNetProfitBps: bounded(process.env.ZERO_CAPITAL_DYNAMIC_MIN_NET_PROFIT_BPS, 1, 1, 5000),
            legs: [
              protocolLeg(firstProtocol, input.token, input.other, feeTier),
              protocolLeg(secondProtocol, input.other, input.token, feeTier),
            ],
          });
        }
      }
    }
  }
  return routes;
}

async function enrichMeasuredGasCost(
  chain: ChainId,
  routes: ConfiguredZeroCapitalRoute[],
): Promise<{ routes: ConfiguredZeroCapitalRoute[]; gasCostUsd: number }> {
  const gas = await gasOracle.getGasPrice(chain);
  if (!Number.isFinite(gas.usdCost) || gas.usdCost < 0) throw new Error(`Measured gas cost unavailable for ${chain}`);

  // GasOracle's usdCost is a live fee-price measurement normalized to its
  // DEFAULT_GAS_LIMIT. Scale the same measured gas price to a conservative
  // receiver-call budget; this is an explicit estimate, not a fabricated fill.
  const estimatedGasUnits = Math.max(
    DEFAULT_GAS_LIMIT,
    Math.floor(bounded(process.env.ZERO_CAPITAL_DYNAMIC_EXECUTION_GAS_UNITS, 1_400_000, 100_000, 5_000_000)),
  );
  const safetyMultiplier = bounded(process.env.ZERO_CAPITAL_DYNAMIC_GAS_SAFETY_MULTIPLIER, 1.25, 1, 3);
  const gasCostUsd = gas.usdCost * (estimatedGasUnits / DEFAULT_GAS_LIMIT) * safetyMultiplier;
  const gasCostBaseUnits = BigInt(Math.max(0, Math.ceil(gasCostUsd * 1_000_000))).toString();
  return {
    gasCostUsd,
    routes: routes.map(route => ({ ...route, estimatedGasCostInInputToken: gasCostBaseUnits })),
  };
}

export async function discoverDynamicZeroCapitalQuotes(
  chain: SupportedExecutionChain,
  provider: providers.Provider,
): Promise<QuotedZeroCapitalRoute[]> {
  const templates = buildDynamicZeroCapitalRouteTemplates(chain);
  state.cycles++;
  state.observedAt = Date.now();
  state.structuralCandidates += templates.length;
  if (templates.length === 0) {
    state.chains[chain] = {
      candidates: 0,
      selectedForQuote: 0,
      measuredQuotes: 0,
      positiveQuotes: 0,
      gasCostUsd: null,
      quoteBudget: 0,
      scoredCandidates: 0,
      explorationSelected: 0,
      exploitationSelected: 0,
      topPreScores: [],
    };
    return [];
  }

  try {
    const enriched = await enrichMeasuredGasCost(chain as ChainId, templates);
    const preselection = selectZeroCapitalRoutesForQuote(enriched.routes, enriched.gasCostUsd);
    const selected = preselection.selectedRoutes;
    const quotes = await quoteConfiguredZeroCapitalRoutesForChain(chain, provider, selected);
    recordZeroCapitalRouteQuoteCycle(selected, quotes);

    // `measuredQuotes` is retained as compatibility telemetry for admitted fresh
    // quote work. Structural coverage is tracked independently and is never shrunk.
    state.measuredQuotes += selected.length;
    state.positiveQuotes += quotes.length;
    state.quoteBudgetSelections += selected.length;
    state.chains[chain] = {
      candidates: templates.length,
      selectedForQuote: selected.length,
      measuredQuotes: selected.length,
      positiveQuotes: quotes.length,
      gasCostUsd: enriched.gasCostUsd,
      quoteBudget: preselection.quoteBudget,
      scoredCandidates: preselection.scoredCandidates,
      explorationSelected: preselection.explorationSelected,
      exploitationSelected: preselection.exploitationSelected,
      topPreScores: topScores(preselection.scores),
    };
    logger.info('[DynamicZeroCapital] Economically allocated measured route cycle completed', {
      component: 'DynamicZeroCapitalRouteDiscovery',
      chain,
      structuralCandidates: templates.length,
      selectedForQuote: selected.length,
      quoteBudget: preselection.quoteBudget,
      scoredCandidates: preselection.scoredCandidates,
      explorationSelected: preselection.explorationSelected,
      exploitationSelected: preselection.exploitationSelected,
      positiveQuotes: quotes.length,
      gasCostUsd: enriched.gasCostUsd,
      preScoreAuthority: preselection.authority,
      deterministicProfitAuthority: preselection.deterministicProfitAuthority,
      executionAuthority: preselection.executionAuthority,
      syntheticEvidenceAllowed: false,
    });
    return quotes;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.chains[chain] = {
      candidates: templates.length,
      selectedForQuote: 0,
      measuredQuotes: 0,
      positiveQuotes: 0,
      gasCostUsd: null,
      quoteBudget: 0,
      scoredCandidates: 0,
      explorationSelected: 0,
      exploitationSelected: 0,
      topPreScores: [],
      error: message,
    };
    logger.warn('[DynamicZeroCapital] Measured route cycle failed closed', {
      component: 'DynamicZeroCapitalRouteDiscovery',
      chain,
      error: message,
    });
    return [];
  }
}

export function getDynamicZeroCapitalDiscoveryState(): DynamicZeroCapitalDiscoveryState {
  return {
    ...state,
    chains: Object.fromEntries(Object.entries(state.chains).map(([chain, value]) => [chain, {
      ...value,
      topPreScores: value.topPreScores.map(score => ({ ...score })),
    }])),
  };
}
