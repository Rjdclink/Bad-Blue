import type { providers } from 'ethers';
import logger from '../../../logger.js';
import { DEFAULT_GAS_LIMIT, SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import { livePriceMesh } from '../bridge/live-price-mesh.js';
import { gasOracle } from '../bridge/gas-oracle.js';
import type { ChainId } from '../bridge/types.js';
import type { GasFundingDecision, GasFundingMode } from '../capital-free/dynamic-gas-funding-engine.js';
import {
  quoteConfiguredZeroCapitalRoutesForChain,
  type ConfiguredZeroCapitalRoute,
  type QuotedZeroCapitalRoute,
} from '../execution/adapters/onchain-route-quoter.js';
import type { SupportedExecutionChain, UniswapV3FeeTier } from '../execution/adapters/onchain-payload-builder.js';
import { getLatestProvenZeroCapitalGasFundingDecisions } from '../runtime/system-owned-gas-funding-proof-wiring.js';
import { discoverGraphlessDexTokens, type GraphlessDexTokenCandidate } from './graphless-dex-scout.js';
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
    stableTemplates: number;
    graphlessTemplates: number;
    triangularTemplates: number;
    graphlessTokens: number;
    graphlessSources: string[];
    selectedForQuote: number;
    recoverySelected: number;
    recoveryMeasuredQuotes: number;
    measuredQuotes: number;
    positiveQuotes: number;
    gasCostUsd: number | null;
    gasCostAuthority: 'verified_sponsored_user_cost_zero' | 'measured_sponsored_billing_proxy' | 'measured_native_gas' | 'unavailable';
    fundingMode: GasFundingMode | 'unknown';
    quoteBudget: number;
    scoredCandidates: number;
    explorationSelected: number;
    exploitationSelected: number;
    topPreScores: Array<{ routeId: string; preScore: number }>;
    topFormationScores: Array<{ routeId: string; formationPriority: number; survivalProbability: number }>;
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

const cachedGraphlessTemplates = new Map<SupportedExecutionChain, ConfiguredZeroCapitalRoute[]>();
const DYNAMIC_EXECUTABLE_CHAINS = new Set<SupportedExecutionChain>([
  'ethereum', 'polygon', 'arbitrum', 'optimism', 'bsc', 'avalanche',
]);
const UNISWAP_V3_DYNAMIC_CHAINS = new Set<SupportedExecutionChain>([
  'ethereum', 'polygon', 'arbitrum', 'optimism',
]);

type DynamicProtocol = 'uniswapV3' | 'sushiswap' | 'pancakeswapV2' | 'traderJoeV1';
type DynamicStableToken = { address: string; decimals: number };
type DynamicStableConfig = { usdc: DynamicStableToken; usdt: DynamicStableToken };
type DynamicGasFundingContext = GasFundingDecision | GasFundingMode | 'unknown';

const ETHEREUM_STABLE_CONFIG: DynamicStableConfig = {
  usdc: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  usdt: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
};
const OPTIMISM_STABLE_CONFIG: DynamicStableConfig = {
  usdc: { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
  usdt: { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
};
const LEGACY_STABLE_DECIMALS: Record<ChainId, { usdc: number; usdt: number }> = {
  polygon: { usdc: 6, usdt: 6 },
  arbitrum: { usdc: 6, usdt: 6 },
  avalanche: { usdc: 6, usdt: 6 },
  bsc: { usdc: 18, usdt: 18 },
};

const DYNAMIC_PROTOCOL_PAIRS: Partial<Record<SupportedExecutionChain, ReadonlyArray<readonly [DynamicProtocol, DynamicProtocol]>>> = {
  ethereum: [['uniswapV3', 'sushiswap'], ['sushiswap', 'uniswapV3']],
  polygon: [['uniswapV3', 'sushiswap'], ['sushiswap', 'uniswapV3']],
  arbitrum: [['uniswapV3', 'sushiswap'], ['sushiswap', 'uniswapV3']],
  bsc: [['pancakeswapV2', 'sushiswap'], ['sushiswap', 'pancakeswapV2']],
  avalanche: [['traderJoeV1', 'sushiswap'], ['sushiswap', 'traderJoeV1']],
};
const TRIANGLE_PROTOCOL_PATHS: Partial<Record<SupportedExecutionChain, ReadonlyArray<readonly [DynamicProtocol, DynamicProtocol, DynamicProtocol]>>> = {
  ethereum: [
    ['uniswapV3', 'sushiswap', 'uniswapV3'],
    ['sushiswap', 'uniswapV3', 'sushiswap'],
    ['uniswapV3', 'uniswapV3', 'uniswapV3'],
  ],
  polygon: [
    ['uniswapV3', 'sushiswap', 'uniswapV3'],
    ['sushiswap', 'uniswapV3', 'sushiswap'],
    ['uniswapV3', 'uniswapV3', 'uniswapV3'],
  ],
  arbitrum: [
    ['uniswapV3', 'sushiswap', 'uniswapV3'],
    ['sushiswap', 'uniswapV3', 'sushiswap'],
    ['uniswapV3', 'uniswapV3', 'uniswapV3'],
  ],
  optimism: [['uniswapV3', 'uniswapV3', 'uniswapV3']],
  bsc: [
    ['pancakeswapV2', 'sushiswap', 'pancakeswapV2'],
    ['sushiswap', 'pancakeswapV2', 'sushiswap'],
  ],
  avalanche: [
    ['traderJoeV1', 'sushiswap', 'traderJoeV1'],
    ['sushiswap', 'traderJoeV1', 'sushiswap'],
  ],
};

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, normalized));
}

function fundingModeFromContext(funding: DynamicGasFundingContext): GasFundingMode | 'unknown' {
  return typeof funding === 'string' ? funding : funding.mode;
}

function resolveFundingContext(
  chain: SupportedExecutionChain,
  funding: DynamicGasFundingContext,
): DynamicGasFundingContext {
  if (typeof funding === 'object') return funding;
  if (funding === 'unknown') return funding;
  const proven = getLatestProvenZeroCapitalGasFundingDecisions()
    .find(decision => decision.chain === chain && decision.mode === funding);
  return proven ?? funding;
}

function sponsorCostProvenZero(funding: DynamicGasFundingContext): boolean {
  return typeof funding === 'object'
    && funding.mode === 'sponsored'
    && funding.sponsorOperatorMonetaryCostProvenZero === true
    && funding.providerBillingLiability === false;
}

function sponsoredBillingLiability(funding: DynamicGasFundingContext): boolean {
  return typeof funding === 'object'
    && funding.mode === 'sponsored'
    && funding.providerBillingLiability === true;
}

function dynamicStableConfig(chain: SupportedExecutionChain): DynamicStableConfig | null {
  if (!DYNAMIC_EXECUTABLE_CHAINS.has(chain)) return null;
  if (chain === 'ethereum') return ETHEREUM_STABLE_CONFIG;
  if (chain === 'optimism') return OPTIMISM_STABLE_CONFIG;
  const legacyChain = chain as ChainId;
  const config = SUPPORTED_CHAINS[legacyChain];
  const decimals = LEGACY_STABLE_DECIMALS[legacyChain];
  return config?.usdc && config?.usdt && decimals
    ? {
        usdc: { address: config.usdc, decimals: decimals.usdc },
        usdt: { address: config.usdt, decimals: decimals.usdt },
      }
    : null;
}

function dynamicProtocolPairs(chain: SupportedExecutionChain): ReadonlyArray<readonly [DynamicProtocol, DynamicProtocol]> {
  return DYNAMIC_PROTOCOL_PAIRS[chain] || [];
}

function triangleProtocolPaths(chain: SupportedExecutionChain): ReadonlyArray<readonly [DynamicProtocol, DynamicProtocol, DynamicProtocol]> {
  return TRIANGLE_PROTOCOL_PATHS[chain] || [];
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

function triangleSeedNotionalsUsd(): number[] {
  const limit = Math.floor(bounded(process.env.ZERO_CAPITAL_TRIANGLE_SEED_NOTIONAL_COUNT, 3, 1, 6));
  return notionalsUsd().slice(0, limit);
}

function feeTiers(): UniswapV3FeeTier[] {
  const parsed = (process.env.ZERO_CAPITAL_DYNAMIC_UNISWAP_FEE_TIERS || '100,500,3000')
    .split(',')
    .map(value => Number(value.trim()))
    .filter((value): value is UniswapV3FeeTier => value === 100 || value === 500 || value === 3000 || value === 10000);
  return parsed.length > 0 ? [...new Set(parsed)] : [100, 500, 3000];
}

function stableBaseUnits(usd: number, decimals: number): string {
  const normalizedDecimals = Math.max(0, Math.min(36, Math.trunc(decimals)));
  const microUsd = BigInt(Math.max(1, Math.floor(usd * 1_000_000)));
  if (normalizedDecimals === 6) return microUsd.toString();
  if (normalizedDecimals > 6) return (microUsd * (10n ** BigInt(normalizedDecimals - 6))).toString();
  const divisor = 10n ** BigInt(6 - normalizedDecimals);
  return ((microUsd + divisor - 1n) / divisor).toString();
}

function gasUsdToBaseUnits(usd: number, decimals: number): string {
  const normalizedDecimals = Math.max(0, Math.min(36, Math.trunc(decimals)));
  const microUsd = BigInt(Math.max(0, Math.ceil(usd * 1_000_000)));
  if (normalizedDecimals === 6) return microUsd.toString();
  if (normalizedDecimals > 6) return (microUsd * (10n ** BigInt(normalizedDecimals - 6))).toString();
  const divisor = 10n ** BigInt(6 - normalizedDecimals);
  return ((microUsd + divisor - 1n) / divisor).toString();
}

function protocolLeg(
  protocol: DynamicProtocol,
  tokenIn: string,
  tokenOut: string,
  feeTier: UniswapV3FeeTier,
) {
  return protocol === 'uniswapV3'
    ? { protocol, tokenIn, tokenOut, feeTier }
    : { protocol, tokenIn, tokenOut, fee: 0.003 };
}

function routeBase(input: {
  id: string;
  chain: SupportedExecutionChain;
  symbol: 'USDC' | 'USDT';
  token: string;
  tokenDecimals: number;
  amountUsd: number;
  legs: ConfiguredZeroCapitalRoute['legs'];
}): ConfiguredZeroCapitalRoute {
  return {
    id: input.id,
    chain: input.chain,
    inputAssetSymbol: input.symbol,
    inputToken: input.token,
    inputTokenDecimals: input.tokenDecimals,
    amountIn: stableBaseUnits(input.amountUsd, input.tokenDecimals),
    estimatedGasCostInInputToken: '0',
    relayFeeInInputToken: '0',
    // Preliminary discovery intentionally leaves flash-loan cost unpriced. Exact,
    // route/notional/provider-specific fee measurement is applied only by the
    // canonical provider repricing stage before any execution eligibility.
    minNetProfitBps: 0,
    legs: input.legs,
  };
}

function topScores(scores: readonly ZeroCapitalRoutePreScore[]): Array<{ routeId: string; preScore: number }> {
  return scores
    .filter((score): score is ZeroCapitalRoutePreScore & { preScore: number } => score.preScore !== null && Number.isFinite(score.preScore))
    .sort((left, right) => right.preScore - left.preScore || left.routeId.localeCompare(right.routeId))
    .slice(0, 8)
    .map(score => ({ routeId: score.routeId, preScore: score.preScore }));
}

function topFormationScores(scores: readonly ZeroCapitalRoutePreScore[]): Array<{ routeId: string; formationPriority: number; survivalProbability: number }> {
  return [...scores]
    .filter(score => Number.isFinite(score.formationPriority) && score.formationPriority > 0)
    .sort((left, right) => right.formationPriority - left.formationPriority || left.routeId.localeCompare(right.routeId))
    .slice(0, 8)
    .map(score => ({
      routeId: score.routeId,
      formationPriority: score.formationPriority,
      survivalProbability: score.survivalProbability,
    }));
}

function triangleCandidatePairs(candidates: readonly GraphlessDexTokenCandidate[]): Array<[GraphlessDexTokenCandidate, GraphlessDexTokenCandidate]> {
  const tokenLimit = Math.floor(bounded(process.env.ZERO_CAPITAL_TRIANGLE_TOKEN_LIMIT, 8, 2, 16));
  const pairLimit = Math.floor(bounded(process.env.ZERO_CAPITAL_TRIANGLE_PAIR_LIMIT, 12, 1, 128));
  const selected = candidates.slice(0, tokenLimit);
  const pairs: Array<[GraphlessDexTokenCandidate, GraphlessDexTokenCandidate]> = [];
  for (let left = 0; left < selected.length; left += 1) {
    for (let right = left + 1; right < selected.length; right += 1) pairs.push([selected[left], selected[right]]);
  }
  return pairs
    .sort((left, right) => {
      const leftFloor = Math.min(left[0].liquidityUsd ?? 0, left[1].liquidityUsd ?? 0);
      const rightFloor = Math.min(right[0].liquidityUsd ?? 0, right[1].liquidityUsd ?? 0);
      if (rightFloor !== leftFloor) return rightFloor - leftFloor;
      const leftSum = (left[0].liquidityUsd ?? 0) + (left[1].liquidityUsd ?? 0);
      const rightSum = (right[0].liquidityUsd ?? 0) + (right[1].liquidityUsd ?? 0);
      return rightSum - leftSum;
    })
    .slice(0, pairLimit);
}

export function buildDynamicZeroCapitalRouteTemplates(chain: SupportedExecutionChain): ConfiguredZeroCapitalRoute[] {
  const config = dynamicStableConfig(chain);
  if (!config) return [];

  const routes: ConfiguredZeroCapitalRoute[] = [];
  const tiers = feeTiers();
  for (const input of [
    { symbol: 'USDC' as const, token: config.usdc.address, decimals: config.usdc.decimals, other: config.usdt.address },
    { symbol: 'USDT' as const, token: config.usdt.address, decimals: config.usdt.decimals, other: config.usdc.address },
  ]) {
    for (const notional of notionalsUsd()) {
      for (const [firstProtocol, secondProtocol] of dynamicProtocolPairs(chain)) {
        for (const feeTier of tiers) {
          routes.push(routeBase({
            id: `dynamic-${chain}-${input.symbol}-${notional}-${firstProtocol}-${secondProtocol}-${feeTier}`,
            chain,
            symbol: input.symbol,
            token: input.token,
            tokenDecimals: input.decimals,
            amountUsd: notional,
            legs: [
              protocolLeg(firstProtocol, input.token, input.other, feeTier),
              protocolLeg(secondProtocol, input.other, input.token, feeTier),
            ],
          }));
        }
      }

      if (UNISWAP_V3_DYNAMIC_CHAINS.has(chain)) {
        for (const firstTier of tiers) {
          for (const secondTier of tiers) {
            if (firstTier === secondTier) continue;
            routes.push(routeBase({
              id: `dynamic-${chain}-${input.symbol}-${notional}-univ3-${firstTier}-${secondTier}`,
              chain,
              symbol: input.symbol,
              token: input.token,
              tokenDecimals: input.decimals,
              amountUsd: notional,
              legs: [
                protocolLeg('uniswapV3', input.token, input.other, firstTier),
                protocolLeg('uniswapV3', input.other, input.token, secondTier),
              ],
            }));
          }
        }
      }
    }
  }
  return routes;
}

async function buildGraphlessProfitSurfaceTemplates(
  chain: SupportedExecutionChain,
  provider: providers.Provider,
): Promise<{ routes: ConfiguredZeroCapitalRoute[]; tokens: number; sources: string[]; triangularTemplates: number }> {
  const config = dynamicStableConfig(chain);
  if (!config) return { routes: [], tokens: 0, sources: [], triangularTemplates: 0 };

  const scout = await discoverGraphlessDexTokens(chain, provider, [config.usdc.address, config.usdt.address]);
  const routes: ConfiguredZeroCapitalRoute[] = [];
  const tiers = feeTiers();
  const inputs = [
    { symbol: 'USDC' as const, token: config.usdc.address, decimals: config.usdc.decimals },
    { symbol: 'USDT' as const, token: config.usdt.address, decimals: config.usdt.decimals },
  ];

  for (const candidate of scout.candidates) {
    const middle = candidate.token;
    for (const input of inputs) {
      if (middle.toLowerCase() === input.token.toLowerCase()) continue;
      for (const notional of notionalsUsd()) {
        for (const [firstProtocol, secondProtocol] of dynamicProtocolPairs(chain)) {
          for (const feeTier of tiers) {
            routes.push(routeBase({
              id: `graphless-${chain}-${input.symbol}-${middle.toLowerCase()}-${notional}-${firstProtocol}-${secondProtocol}-${feeTier}`,
              chain,
              symbol: input.symbol,
              token: input.token,
              tokenDecimals: input.decimals,
              amountUsd: notional,
              legs: [
                protocolLeg(firstProtocol, input.token, middle, feeTier),
                protocolLeg(secondProtocol, middle, input.token, feeTier),
              ],
            }));
          }
        }

        if (UNISWAP_V3_DYNAMIC_CHAINS.has(chain)) {
          for (const firstTier of tiers) {
            for (const secondTier of tiers) {
              if (firstTier === secondTier) continue;
              routes.push(routeBase({
                id: `graphless-${chain}-${input.symbol}-${middle.toLowerCase()}-${notional}-univ3-${firstTier}-${secondTier}`,
                chain,
                symbol: input.symbol,
                token: input.token,
                tokenDecimals: input.decimals,
                amountUsd: notional,
                legs: [
                  protocolLeg('uniswapV3', input.token, middle, firstTier),
                  protocolLeg('uniswapV3', middle, input.token, secondTier),
                ],
              }));
            }
          }
        }
      }
    }
  }

  const beforeTriangles = routes.length;
  const trianglePairs = triangleCandidatePairs(scout.candidates);
  for (const [leftCandidate, rightCandidate] of trianglePairs) {
    for (const [firstMiddle, secondMiddle] of [
      [leftCandidate.token, rightCandidate.token],
      [rightCandidate.token, leftCandidate.token],
    ] as const) {
      for (const input of inputs) {
        if (firstMiddle.toLowerCase() === input.token.toLowerCase() || secondMiddle.toLowerCase() === input.token.toLowerCase()) continue;
        for (const notional of triangleSeedNotionalsUsd()) {
          for (const path of triangleProtocolPaths(chain)) {
            for (const feeTier of tiers) {
              routes.push(routeBase({
                id: `graphless-tri-${chain}-${input.symbol}-${firstMiddle.toLowerCase()}-${secondMiddle.toLowerCase()}-${notional}-${path.join('-')}-${feeTier}`,
                chain,
                symbol: input.symbol,
                token: input.token,
                tokenDecimals: input.decimals,
                amountUsd: notional,
                legs: [
                  protocolLeg(path[0], input.token, firstMiddle, feeTier),
                  protocolLeg(path[1], firstMiddle, secondMiddle, feeTier),
                  protocolLeg(path[2], secondMiddle, input.token, feeTier),
                ],
              }));
            }
          }
        }
      }
    }
  }

  const deduped = new Map(routes.map(route => [route.id, route]));
  const values = [...deduped.values()];
  cachedGraphlessTemplates.set(chain, values);
  return {
    routes: values,
    tokens: scout.candidates.length,
    sources: scout.sources,
    triangularTemplates: Math.max(0, values.filter(route => route.id.startsWith('graphless-tri-')).length || (routes.length - beforeTriangles)),
  };
}

export function getCachedGraphlessDynamicRouteTemplates(chain?: SupportedExecutionChain): ConfiguredZeroCapitalRoute[] {
  if (chain) return [...(cachedGraphlessTemplates.get(chain) || [])];
  return [...cachedGraphlessTemplates.values()].flatMap(routes => routes);
}

type GasEnrichment = {
  routes: ConfiguredZeroCapitalRoute[];
  gasCostUsd: number;
  gasCostAuthority: 'verified_sponsored_user_cost_zero' | 'measured_sponsored_billing_proxy' | 'measured_native_gas';
};

async function enrichMeasuredGasCost(
  chain: SupportedExecutionChain,
  provider: providers.Provider,
  routes: ConfiguredZeroCapitalRoute[],
  funding: DynamicGasFundingContext,
): Promise<GasEnrichment> {
  const fundingMode = fundingModeFromContext(funding);
  if (fundingMode === 'sponsored' && sponsorCostProvenZero(funding)) {
    return {
      gasCostUsd: 0,
      gasCostAuthority: 'verified_sponsored_user_cost_zero',
      routes: routes.map(route => ({ ...route, estimatedGasCostInInputToken: '0' })),
    };
  }

  const estimatedGasUnits = Math.max(
    DEFAULT_GAS_LIMIT,
    Math.floor(bounded(process.env.ZERO_CAPITAL_DYNAMIC_EXECUTION_GAS_UNITS, 1_400_000, 100_000, 5_000_000)),
  );
  const configuredSafetyMultiplier = bounded(process.env.ZERO_CAPITAL_DYNAMIC_GAS_SAFETY_MULTIPLIER, 1.25, 1, 3);
  // Hosted mainnet sponsorship removes the upfront native-token prerequisite but
  // creates a provider billing liability. Keep a conservative pre-trade buffer so
  // PAYG Gas Manager fees cannot be silently treated as free execution economics.
  const safetyMultiplier = sponsoredBillingLiability(funding)
    ? Math.max(1.25, configuredSafetyMultiplier)
    : configuredSafetyMultiplier;
  let gasCostUsd: number;

  if (chain === 'ethereum' || chain === 'optimism') {
    const [feeData, prices] = await Promise.all([
      provider.getFeeData(),
      livePriceMesh.getLiveSymbolPrices(['ETH']),
    ]);
    const gasPriceWei = feeData.maxFeePerGas ?? feeData.gasPrice;
    const ethUsd = prices.get('ETH');
    const gasPrice = gasPriceWei ? Number(gasPriceWei.toString()) : Number.NaN;
    if (!Number.isFinite(gasPrice) || gasPrice <= 0 || !Number.isFinite(ethUsd) || !ethUsd || ethUsd <= 0) {
      throw new Error(`Measured ${chain} gas or reusable ETH/USD evidence unavailable`);
    }
    // OP Mainnet has an L1 data-fee component in addition to L2 execution gas.
    // Dynamic discovery is only a pre-trade economic screen, so use a conservative
    // route-local reserve here; exact signed-call/receipt economics remain canonical.
    const chainSafetyMultiplier = chain === 'optimism' ? Math.max(1.75, safetyMultiplier) : safetyMultiplier;
    gasCostUsd = (gasPrice * estimatedGasUnits / 1e18) * ethUsd * chainSafetyMultiplier;
  } else {
    const gas = await gasOracle.getGasPrice(chain as ChainId);
    if (!Number.isFinite(gas.usdCost) || gas.usdCost < 0) throw new Error(`Measured gas cost unavailable for ${chain}`);
    gasCostUsd = gas.usdCost * (estimatedGasUnits / DEFAULT_GAS_LIMIT) * safetyMultiplier;
  }

  return {
    gasCostUsd,
    gasCostAuthority: sponsoredBillingLiability(funding) ? 'measured_sponsored_billing_proxy' : 'measured_native_gas',
    routes: routes.map(route => ({
      ...route,
      estimatedGasCostInInputToken: gasUsdToBaseUnits(gasCostUsd, route.inputTokenDecimals),
    })),
  };
}

function recoveryQuoteRoutes(
  routes: readonly ConfiguredZeroCapitalRoute[],
  attempted: readonly ConfiguredZeroCapitalRoute[],
): ConfiguredZeroCapitalRoute[] {
  const attemptedIds = new Set(attempted.map(route => route.id));
  const configuredRecoveryBudget = process.env.ZERO_CAPITAL_RECOVERY_QUOTE_BUDGET
    ?? process.env.ZERO_CAPITAL_QUOTE_RECOVERY_BUDGET;
  const limit = Math.floor(bounded(configuredRecoveryBudget, 8, 2, 48));
  return routes
    .filter(route => !attemptedIds.has(route.id))
    .sort((left, right) => {
      const leftStable = left.id.startsWith('dynamic-') ? 0 : 1;
      const rightStable = right.id.startsWith('dynamic-') ? 0 : 1;
      return leftStable - rightStable || Number(left.amountIn) - Number(right.amountIn) || left.id.localeCompare(right.id);
    })
    .slice(0, limit);
}

export async function discoverDynamicZeroCapitalQuotes(
  chain: SupportedExecutionChain,
  provider: providers.Provider,
  funding: DynamicGasFundingContext = 'unknown',
): Promise<QuotedZeroCapitalRoute[]> {
  const fundingContext = resolveFundingContext(chain, funding);
  const fundingMode = fundingModeFromContext(fundingContext);
  const stableTemplates = buildDynamicZeroCapitalRouteTemplates(chain);
  let graphless = { routes: [] as ConfiguredZeroCapitalRoute[], tokens: 0, sources: [] as string[], triangularTemplates: 0 };
  try {
    graphless = await buildGraphlessProfitSurfaceTemplates(chain, provider);
  } catch (error) {
    logger.warn('[DynamicZeroCapital] Graphless DEX scout degraded; stable seed scanner retained', {
      component: 'DynamicZeroCapitalRouteDiscovery',
      chain,
      error: error instanceof Error ? error.message : String(error),
      noNewApiKeys: true,
    });
  }
  const templates = [...new Map([...stableTemplates, ...graphless.routes].map(route => [route.id, route])).values()];
  state.cycles++;
  state.observedAt = Date.now();
  state.structuralCandidates += templates.length;
  if (templates.length === 0) {
    state.chains[chain] = {
      candidates: 0,
      stableTemplates: stableTemplates.length,
      graphlessTemplates: graphless.routes.length,
      triangularTemplates: graphless.triangularTemplates,
      graphlessTokens: graphless.tokens,
      graphlessSources: graphless.sources,
      selectedForQuote: 0,
      recoverySelected: 0,
      recoveryMeasuredQuotes: 0,
      measuredQuotes: 0,
      positiveQuotes: 0,
      gasCostUsd: null,
      gasCostAuthority: 'unavailable',
      fundingMode,
      quoteBudget: 0,
      scoredCandidates: 0,
      explorationSelected: 0,
      exploitationSelected: 0,
      topPreScores: [],
      topFormationScores: [],
    };
    return [];
  }

  try {
    const enriched = await enrichMeasuredGasCost(chain, provider, templates, fundingContext);
    const preselection = selectZeroCapitalRoutesForQuote(enriched.routes, enriched.gasCostUsd);
    const selected = preselection.selectedRoutes;
    const primaryQuotes = await quoteConfiguredZeroCapitalRoutesForChain(chain, provider, selected);
    let quotes = [...primaryQuotes];
    let recoverySelected: ConfiguredZeroCapitalRoute[] = [];
    let recoveryQuotes: QuotedZeroCapitalRoute[] = [];

    const primaryHasPositive = primaryQuotes.some(quote => quote.executablePositive === true && quote.netProfit > 0n);
    if (!primaryHasPositive && selected.length > 0) {
      recoverySelected = recoveryQuoteRoutes(enriched.routes, selected);
      if (recoverySelected.length > 0) {
        recoveryQuotes = await quoteConfiguredZeroCapitalRoutesForChain(chain, provider, recoverySelected);
        quotes = [...primaryQuotes, ...recoveryQuotes];
      }
    }

    const attempted = [...selected, ...recoverySelected];
    const truePositiveQuotes = quotes.filter(quote => quote.executablePositive === true && quote.netProfit > 0n);
    recordZeroCapitalRouteQuoteCycle(attempted, quotes);

    state.measuredQuotes += quotes.length;
    state.positiveQuotes += truePositiveQuotes.length;
    state.quoteBudgetSelections += attempted.length;
    state.chains[chain] = {
      candidates: templates.length,
      stableTemplates: stableTemplates.length,
      graphlessTemplates: graphless.routes.length,
      triangularTemplates: graphless.triangularTemplates,
      graphlessTokens: graphless.tokens,
      graphlessSources: graphless.sources,
      selectedForQuote: attempted.length,
      recoverySelected: recoverySelected.length,
      recoveryMeasuredQuotes: recoveryQuotes.length,
      measuredQuotes: quotes.length,
      positiveQuotes: truePositiveQuotes.length,
      gasCostUsd: enriched.gasCostUsd,
      gasCostAuthority: enriched.gasCostAuthority,
      fundingMode,
      quoteBudget: preselection.quoteBudget,
      scoredCandidates: preselection.scoredCandidates,
      explorationSelected: preselection.explorationSelected,
      exploitationSelected: preselection.exploitationSelected,
      topPreScores: topScores(preselection.scores),
      topFormationScores: topFormationScores(preselection.scores),
    };
    logger.info('[DynamicZeroCapital] Aries edge-formation DEX route cycle completed', {
      component: 'DynamicZeroCapitalRouteDiscovery',
      chain,
      structuralCandidates: templates.length,
      stableTemplates: stableTemplates.length,
      graphlessTemplates: graphless.routes.length,
      triangularTemplates: graphless.triangularTemplates,
      graphlessTokens: graphless.tokens,
      graphlessSources: graphless.sources,
      selectedForQuote: attempted.length,
      primarySelected: selected.length,
      recoverySelected: recoverySelected.length,
      recoveryMeasuredQuotes: recoveryQuotes.length,
      measuredQuotes: quotes.length,
      quoteBudget: preselection.quoteBudget,
      scoredCandidates: preselection.scoredCandidates,
      explorationSelected: preselection.explorationSelected,
      exploitationSelected: preselection.exploitationSelected,
      topFormationScores: topFormationScores(preselection.scores),
      positiveQuotes: truePositiveQuotes.length,
      positiveQuoteAuthority: 'strict_all_in_net_profit_gt_zero_only',
      fundingMode,
      gasCostUsd: enriched.gasCostUsd,
      gasCostAuthority: enriched.gasCostAuthority,
      sponsoredGasDiscountAppliedOnlyFromVerifiedFundingDecision: true,
      sponsorOperatorMonetaryCostProvenZero: sponsorCostProvenZero(fundingContext),
      providerBillingLiability: sponsoredBillingLiability(fundingContext),
      preScoreAuthority: preselection.authority,
      formationAuthority: 'scan_priority_advisory_only',
      deterministicProfitAuthority: preselection.deterministicProfitAuthority,
      executionAuthority: preselection.executionAuthority,
      apiKeysRequired: false,
      syntheticEvidenceAllowed: false,
    });
    return quotes;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.chains[chain] = {
      candidates: templates.length,
      stableTemplates: stableTemplates.length,
      graphlessTemplates: graphless.routes.length,
      triangularTemplates: graphless.triangularTemplates,
      graphlessTokens: graphless.tokens,
      graphlessSources: graphless.sources,
      selectedForQuote: 0,
      recoverySelected: 0,
      recoveryMeasuredQuotes: 0,
      measuredQuotes: 0,
      positiveQuotes: 0,
      gasCostUsd: null,
      gasCostAuthority: 'unavailable',
      fundingMode,
      quoteBudget: 0,
      scoredCandidates: 0,
      explorationSelected: 0,
      exploitationSelected: 0,
      topPreScores: [],
      topFormationScores: [],
      error: message,
    };
    logger.warn('[DynamicZeroCapital] Measured route cycle failed closed', {
      component: 'DynamicZeroCapitalRouteDiscovery',
      chain,
      fundingMode,
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
      graphlessSources: [...value.graphlessSources],
      topPreScores: value.topPreScores.map(score => ({ ...score })),
      topFormationScores: value.topFormationScores.map(score => ({ ...score })),
    }])),
  };
}
