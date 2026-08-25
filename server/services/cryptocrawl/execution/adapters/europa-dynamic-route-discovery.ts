import { EUROPA_SUSHI } from './europa-sushi-registry.js';
import type { ConfiguredZeroCapitalRoute } from './onchain-route-quoter.js';

const EUROPA_CHAIN_ID = '2046399126';
const SUSHI_API = 'https://api.sushi.com';

type QuoteResponse = {
  status?: string;
  assumedAmountOut?: string;
  priceImpact?: number;
  gasSpent?: number;
  tx?: { to?: string; data?: string; value?: string; gasPrice?: number };
};

const CYCLE = [
  { tokenIn: EUROPA_SUSHI.tokens.usdc, tokenOut: EUROPA_SUSHI.tokens.skl, pool: EUROPA_SUSHI.pools.usdcSkl },
  { tokenIn: EUROPA_SUSHI.tokens.skl, tokenOut: EUROPA_SUSHI.tokens.eth, pool: EUROPA_SUSHI.pools.sklEth },
  { tokenIn: EUROPA_SUSHI.tokens.eth, tokenOut: EUROPA_SUSHI.tokens.usdc, pool: EUROPA_SUSHI.pools.ethUsdc },
] as const;

function positiveInteger(name: string, value: string): string {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error(`${name} must be a positive integer`);
  return value;
}

function address(value: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error('Europa route discovery address is invalid');
  return value;
}

async function quote(input: { tokenIn: string; tokenOut: string; amount: string; pool: string; sender: string }): Promise<QuoteResponse> {
  const url = new URL(`/swap/v7/${EUROPA_CHAIN_ID}`, SUSHI_API);
  url.searchParams.set('referrer', 'sushi');
  url.searchParams.set('tokenIn', input.tokenIn);
  url.searchParams.set('tokenOut', input.tokenOut);
  url.searchParams.set('amount', input.amount);
  url.searchParams.set('maxSlippage', '0.005');
  url.searchParams.set('sender', input.sender);
  url.searchParams.set('recipient', input.sender);
  url.searchParams.set('simulate', 'false');
  url.searchParams.append('onlyPools', input.pool);
  const response = await fetch(url, { headers: { Origin: 'https://sushi.com' } });
  if (!response.ok) throw new Error(`Sushi Europa route discovery returned HTTP ${response.status}`);
  return response.json() as Promise<QuoteResponse>;
}

export interface DynamicEuropaRouteEvidence {
  route: ConfiguredZeroCapitalRoute;
  initialAmount: string;
  finalAmount: string;
  grossProfit: string;
  netProfit: string;
  quoteLatencyMs: number;
  priceImpacts: number[];
  routeProcessor: string;
}

/**
 * Discovers and validates the current Sushi Europa cycle on every invocation.
 * A route is returned only when every leg has executable calldata and the final
 * amount exceeds the input after configured flash-loan costs.
 */
export async function discoverProfitableEuropaRoute(environment: NodeJS.ProcessEnv = process.env): Promise<DynamicEuropaRouteEvidence | null> {
  const startedAt = Date.now();
  const sender = address(environment.ZERO_CAPITAL_EUROPA_QUOTE_SENDER?.trim() || '0x0e9878153c1500ec48b51cdd5325c7e374c9cdae');
  const initialAmount = positiveInteger('ZERO_CAPITAL_EUROPA_BOOTSTRAP_AMOUNT', environment.ZERO_CAPITAL_EUROPA_BOOTSTRAP_AMOUNT?.trim() || '1000000');
  let currentAmount = initialAmount;
  const priceImpacts: number[] = [];
  let routeProcessor = '';

  for (const leg of CYCLE) {
    const result = await quote({ ...leg, amount: currentAmount, sender });
    if (result.status !== 'Success' || !result.assumedAmountOut || !result.tx?.data || result.tx.to?.toLowerCase() !== EUROPA_SUSHI.routeProcessor) {
      return null;
    }
    currentAmount = positiveInteger('Sushi quoted amount', result.assumedAmountOut);
    routeProcessor = result.tx.to;
    if (typeof result.priceImpact === 'number') priceImpacts.push(result.priceImpact);
  }

  const initial = BigInt(initialAmount);
  const final = BigInt(currentAmount);
  const grossProfit = final - initial;
  const flashLoanFeeBps = Number(environment.ZERO_CAPITAL_EUROPA_FLASH_LOAN_FEE_BPS || '0');
  if (!Number.isInteger(flashLoanFeeBps) || flashLoanFeeBps < 0 || flashLoanFeeBps > 1000) {
    throw new Error('ZERO_CAPITAL_EUROPA_FLASH_LOAN_FEE_BPS must be an integer from 0 to 1000');
  }
  const netProfit = grossProfit - (initial * BigInt(flashLoanFeeBps)) / 10000n;
  const minimumProfitBps = Number(environment.ZERO_CAPITAL_EUROPA_MIN_PROFIT_BPS || '50');
  if (!Number.isInteger(minimumProfitBps) || minimumProfitBps < 1 || minimumProfitBps > 5000) {
    throw new Error('ZERO_CAPITAL_EUROPA_MIN_PROFIT_BPS must be an integer from 1 to 5000');
  }
  if (netProfit <= 0n || (netProfit * 10000n) / initial < BigInt(minimumProfitBps)) return null;

  return {
    initialAmount,
    finalAmount: currentAmount,
    grossProfit: grossProfit.toString(),
    netProfit: netProfit.toString(),
    quoteLatencyMs: Date.now() - startedAt,
    priceImpacts,
    routeProcessor,
    route: {
      id: `europa-sushi-dynamic-${Date.now()}`,
      chain: 'europa',
      inputAssetSymbol: 'USDC',
      inputToken: EUROPA_SUSHI.tokens.usdc,
      inputTokenDecimals: 6,
      amountIn: initialAmount,
      estimatedGasCostInInputToken: '0',
      relayFeeInInputToken: '0',
      flashLoanFeeBps,
      minNetProfitBps: minimumProfitBps,
      legs: CYCLE.map(leg => ({ protocol: 'sushiswapV3' as const, tokenIn: leg.tokenIn, tokenOut: leg.tokenOut, pool: leg.pool, feeTier: 3000 as const })),
    },
  };
}