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

type EuropaCycleLeg = {
  tokenIn: string;
  tokenOut: string;
  pool: string;
};

const CYCLES: ReadonlyArray<{ id: string; legs: readonly EuropaCycleLeg[] }> = [
  {
    id: 'usdc-skl-eth-usdc',
    legs: [
      { tokenIn: EUROPA_SUSHI.tokens.usdc, tokenOut: EUROPA_SUSHI.tokens.skl, pool: EUROPA_SUSHI.pools.usdcSkl },
      { tokenIn: EUROPA_SUSHI.tokens.skl, tokenOut: EUROPA_SUSHI.tokens.eth, pool: EUROPA_SUSHI.pools.sklEth },
      { tokenIn: EUROPA_SUSHI.tokens.eth, tokenOut: EUROPA_SUSHI.tokens.usdc, pool: EUROPA_SUSHI.pools.ethUsdc },
    ],
  },
  {
    id: 'usdc-eth-skl-usdc',
    legs: [
      { tokenIn: EUROPA_SUSHI.tokens.usdc, tokenOut: EUROPA_SUSHI.tokens.eth, pool: EUROPA_SUSHI.pools.ethUsdc },
      { tokenIn: EUROPA_SUSHI.tokens.eth, tokenOut: EUROPA_SUSHI.tokens.skl, pool: EUROPA_SUSHI.pools.sklEth },
      { tokenIn: EUROPA_SUSHI.tokens.skl, tokenOut: EUROPA_SUSHI.tokens.usdc, pool: EUROPA_SUSHI.pools.usdcSkl },
    ],
  },
];

function positiveInteger(name: string, value: string): string {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error(`${name} must be a positive integer`);
  return value;
}

function address(value: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error('Europa route discovery address is invalid');
  return value;
}

function bootstrapAmounts(environment: NodeJS.ProcessEnv): string[] {
  const explicit = environment.ZERO_CAPITAL_EUROPA_BOOTSTRAP_AMOUNTS?.trim();
  if (explicit) {
    const amounts = explicit.split(',').map(value => positiveInteger('ZERO_CAPITAL_EUROPA_BOOTSTRAP_AMOUNTS entry', value.trim()));
    return [...new Set(amounts)];
  }

  const base = BigInt(positiveInteger(
    'ZERO_CAPITAL_EUROPA_BOOTSTRAP_AMOUNT',
    environment.ZERO_CAPITAL_EUROPA_BOOTSTRAP_AMOUNT?.trim() || '1000000',
  ));
  const candidates = [base / 4n, base / 2n, base, base * 2n, base * 5n]
    .filter(amount => amount > 0n)
    .map(amount => amount.toString());
  return [...new Set(candidates)];
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

async function evaluateCycle(input: {
  cycle: { id: string; legs: readonly EuropaCycleLeg[] };
  initialAmount: string;
  sender: string;
  flashLoanFeeBps: number;
  minimumProfitBps: number;
}): Promise<DynamicEuropaRouteEvidence | null> {
  const startedAt = Date.now();
  let currentAmount = input.initialAmount;
  const priceImpacts: number[] = [];
  let routeProcessor = '';

  for (const leg of input.cycle.legs) {
    const result = await quote({ ...leg, amount: currentAmount, sender: input.sender });
    if (result.status !== 'Success' || !result.assumedAmountOut || !result.tx?.data || result.tx.to?.toLowerCase() !== EUROPA_SUSHI.routeProcessor) {
      return null;
    }
    currentAmount = positiveInteger('Sushi quoted amount', result.assumedAmountOut);
    routeProcessor = result.tx.to;
    if (typeof result.priceImpact === 'number') priceImpacts.push(result.priceImpact);
  }

  const initial = BigInt(input.initialAmount);
  const final = BigInt(currentAmount);
  const grossProfit = final - initial;
  const netProfit = grossProfit - (initial * BigInt(input.flashLoanFeeBps)) / 10000n;
  if (netProfit <= 0n || (netProfit * 10000n) / initial < BigInt(input.minimumProfitBps)) return null;

  return {
    initialAmount: input.initialAmount,
    finalAmount: currentAmount,
    grossProfit: grossProfit.toString(),
    netProfit: netProfit.toString(),
    quoteLatencyMs: Date.now() - startedAt,
    priceImpacts,
    routeProcessor,
    route: {
      id: `europa-sushi-dynamic-${input.cycle.id}-${input.initialAmount}-${Date.now()}`,
      chain: 'europa',
      inputAssetSymbol: 'USDC',
      inputToken: EUROPA_SUSHI.tokens.usdc,
      inputTokenDecimals: 6,
      amountIn: input.initialAmount,
      estimatedGasCostInInputToken: '0',
      relayFeeInInputToken: '0',
      flashLoanFeeBps: input.flashLoanFeeBps,
      minNetProfitBps: input.minimumProfitBps,
      legs: input.cycle.legs.map(leg => ({
        protocol: 'sushiswapV3' as const,
        tokenIn: leg.tokenIn,
        tokenOut: leg.tokenOut,
        pool: leg.pool,
        feeTier: 3000 as const,
      })),
    },
  };
}

/**
 * Searches both validated Europa triangular directions across a bounded set of
 * USDC flash-loan sizes. Each leg is quoted live through Sushi's Europa route
 * processor. Only positive post-flash-fee candidates that satisfy the configured
 * minimum profit rate are returned, and the highest absolute net-profit route
 * is selected for the engine to independently re-quote before execution.
 */
export async function discoverProfitableEuropaRoute(environment: NodeJS.ProcessEnv = process.env): Promise<DynamicEuropaRouteEvidence | null> {
  const sender = address(environment.ZERO_CAPITAL_EUROPA_QUOTE_SENDER?.trim() || '0x0e9878153c1500ec48b51cdd5325c7e374c9cdae');
  const flashLoanFeeBps = Number(environment.ZERO_CAPITAL_EUROPA_FLASH_LOAN_FEE_BPS || '0');
  if (!Number.isInteger(flashLoanFeeBps) || flashLoanFeeBps < 0 || flashLoanFeeBps > 1000) {
    throw new Error('ZERO_CAPITAL_EUROPA_FLASH_LOAN_FEE_BPS must be an integer from 0 to 1000');
  }
  const minimumProfitBps = Number(environment.ZERO_CAPITAL_EUROPA_MIN_PROFIT_BPS || '50');
  if (!Number.isInteger(minimumProfitBps) || minimumProfitBps < 1 || minimumProfitBps > 5000) {
    throw new Error('ZERO_CAPITAL_EUROPA_MIN_PROFIT_BPS must be an integer from 1 to 5000');
  }

  const attempts = await Promise.allSettled(
    bootstrapAmounts(environment).flatMap(initialAmount =>
      CYCLES.map(cycle => evaluateCycle({
        cycle,
        initialAmount,
        sender,
        flashLoanFeeBps,
        minimumProfitBps,
      })),
    ),
  );

  const profitable = attempts
    .filter((result): result is PromiseFulfilledResult<DynamicEuropaRouteEvidence | null> => result.status === 'fulfilled')
    .map(result => result.value)
    .filter((result): result is DynamicEuropaRouteEvidence => result !== null)
    .sort((left, right) => {
      const leftProfit = BigInt(left.netProfit);
      const rightProfit = BigInt(right.netProfit);
      return leftProfit > rightProfit ? -1 : leftProfit < rightProfit ? 1 : 0;
    });
  if (profitable[0]) return profitable[0];

  const failures = attempts.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length === attempts.length && failures[0]) {
    throw failures[0].reason instanceof Error ? failures[0].reason : new Error(String(failures[0].reason));
  }
  return null;
}
