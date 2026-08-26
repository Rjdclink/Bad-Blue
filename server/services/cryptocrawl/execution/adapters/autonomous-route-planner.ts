import type { FlashLoanReceiverExecutionPlan } from './flashloan-receiver-builder.js';
import type { OnchainSwapLeg, SupportedExecutionChain, SupportedSwapProtocol } from './onchain-payload-builder.js';

export interface RoutePlanningSwapStep {
  protocol: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint | string;
  expectedAmountOut: bigint | string;
  fee: number;
}

export interface RoutePlanningOpportunity {
  chain: SupportedExecutionChain;
  inputToken: string;
  flashLoanAmount: bigint | string;
  expectedProfit: bigint | string;
  route: RoutePlanningSwapStep[];
}

function bigintishToString(value: bigint | string): string {
  if (typeof value === 'bigint') return value.toString();
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error('Route planning values must be integer strings denominated in base units');
  }
  return normalized;
}

function applyHaircut(raw: bigint, bps: number): string {
  const bounded = Math.max(1, Math.min(10000, bps));
  return ((raw * BigInt(bounded)) / 10000n).toString();
}

function normalizeProtocol(protocol: string): SupportedSwapProtocol {
  const normalized = protocol.trim().toLowerCase();
  if (normalized === 'uniswapv3' || normalized === 'uniswap_v3' || normalized === 'uniswap-v3') {
    return 'uniswapV3';
  }
  if (normalized === 'sushiswap' || normalized === 'sushi') {
    return 'sushiswap';
  }
  throw new Error(`Unsupported autonomous route protocol: ${protocol}`);
}

function mapFeeToTier(fee: number): 500 | 3000 | 10000 {
  if (fee <= 0.0005) return 500;
  if (fee <= 0.003) return 3000;
  return 10000;
}

function requireAddress(name: string, value: string | undefined): string {
  const normalized = String(value || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    throw new Error(`${name} must be configured as a valid EVM address`);
  }
  return normalized;
}

function boundedRouteHopLimit(value: number): number {
  if (!Number.isFinite(value)) return 4;
  return Math.max(2, Math.min(8, Math.trunc(value)));
}

export function buildFlashLoanExecutionPlanFromOpportunity(
  opportunity: RoutePlanningOpportunity,
  options?: {
    receiver?: string;
    profitRecipient?: string;
    minOutputBps?: number;
    minProfitBps?: number;
    maxRouteHops?: number;
  },
): FlashLoanReceiverExecutionPlan {
  if (!Array.isArray(opportunity.route) || opportunity.route.length < 2) {
    throw new Error('Autonomous zero-capital planning requires at least two route legs');
  }

  const maxRouteHops = boundedRouteHopLimit(
    options?.maxRouteHops ?? Number(process.env.ZERO_CAPITAL_MAX_ROUTE_HOPS || 4),
  );
  if (opportunity.route.length > maxRouteHops) {
    throw new Error(`Autonomous zero-capital route exceeds the configured ${maxRouteHops}-hop execution limit`);
  }

  const receiver = requireAddress(
    'ZERO_CAPITAL_FLASHLOAN_RECEIVER',
    options?.receiver || process.env.ZERO_CAPITAL_FLASHLOAN_RECEIVER,
  );
  const profitRecipient = requireAddress(
    'CRYPTO_PROFIT_WALLET_ADDRESS',
    options?.profitRecipient || process.env.CRYPTO_PROFIT_WALLET_ADDRESS || process.env.BRIDGE_WALLET_ADDRESS,
  );

  const minOutputBps = Math.max(100, Math.min(10000, options?.minOutputBps ?? Number(process.env.ZERO_CAPITAL_ROUTE_MIN_OUTPUT_BPS || 9990)));
  const minProfitBps = Math.max(100, Math.min(10000, options?.minProfitBps ?? Number(process.env.ZERO_CAPITAL_MIN_PROFIT_BPS || 9000)));

  let previousExpectedOut = bigintishToString(opportunity.flashLoanAmount);
  const steps: OnchainSwapLeg[] = opportunity.route.map((step, index) => {
    const expectedAmountOut = BigInt(bigintishToString(step.expectedAmountOut));
    const requestedAmountIn = BigInt(bigintishToString(step.amountIn));
    const amountIn = index === 0
      ? bigintishToString(opportunity.flashLoanAmount)
      : requestedAmountIn > 0n
        ? requestedAmountIn.toString()
        : previousExpectedOut;

    previousExpectedOut = expectedAmountOut.toString();

    return {
      protocol: normalizeProtocol(step.protocol),
      chain: opportunity.chain,
      tokenIn: step.tokenIn,
      tokenOut: step.tokenOut,
      amountIn,
      minAmountOut: applyHaircut(expectedAmountOut, minOutputBps),
      feeTier: mapFeeToTier(step.fee),
      recipient: receiver,
      deadlineBufferSeconds: 90,
    };
  });

  const expectedProfit = BigInt(bigintishToString(opportunity.expectedProfit));

  return {
    chain: opportunity.chain,
    receiver,
    loanToken: opportunity.inputToken,
    loanAmount: bigintishToString(opportunity.flashLoanAmount),
    minProfit: applyHaircut(expectedProfit, minProfitBps),
    profitRecipient,
    steps,
    gasLimit: 1400000,
  };
}