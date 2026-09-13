import type { FlashLoanReceiverExecutionPlan } from './flashloan-receiver-builder.js';
import type { FlashLoanProviderKind } from './flash-loan-provider-economics.js';
import type {
  OnchainSwapLeg,
  SupportedExecutionChain,
  SupportedSwapProtocol,
  UniswapV3FeeTier,
} from './onchain-payload-builder.js';
import { resolveOperationalProfitRecipient } from '../../core/wallet-identity.js';
import {
  isStrictlyPositiveProfitBaseUnits,
  minimumPositiveProfitBaseUnits,
} from '../../governance/profit-admission-authority.js';

export interface RoutePlanningSwapStep {
  protocol: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint | string;
  expectedAmountOut: bigint | string;
  fee: number;
  pool?: string;
}

export interface RoutePlanningOpportunity {
  chain: SupportedExecutionChain;
  type?: string;
  inputToken: string;
  flashLoanAmount: bigint | string;
  expectedProfit: bigint | string;
  estimatedGasCostInInputToken?: bigint | string;
  relayFeeInInputToken?: bigint | string;
  netProfitBps?: number;
  route: RoutePlanningSwapStep[];
  timestamp?: number;
  expiresAt?: number;
}

const ATOMIC_MINIMUM_TARGET_BPS = 10;
const BPS_SCALE = 1_000_000n;
const BPS_DENOMINATOR_SCALED = 10_000n * BPS_SCALE;

function bigintishToString(value: bigint | string): string {
  if (typeof value === 'bigint') return value.toString();
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error('Route planning values must be integer strings denominated in base units');
  }
  return normalized;
}

function optionalBaseUnits(value: bigint | string | undefined): bigint {
  if (value === undefined) return 0n;
  return BigInt(bigintishToString(value));
}

function atomicTargetBps(): number {
  const configured = Number(
    process.env.ZERO_CAPITAL_ATOMIC_SURPLUS_TARGET_BPS
    ?? process.env.ZERO_CAPITAL_RESCUE_TARGET_NET_BPS
    ?? ATOMIC_MINIMUM_TARGET_BPS,
  );
  const finite = Number.isFinite(configured) ? configured : ATOMIC_MINIMUM_TARGET_BPS;
  return Math.max(ATOMIC_MINIMUM_TARGET_BPS, Math.min(1_000, finite));
}

function minimumAtomicNetProfitBaseUnits(loanAmount: bigint): bigint {
  const targetBps = atomicTargetBps();
  const scaledBps = BigInt(Math.ceil(targetBps * Number(BPS_SCALE)));
  return (loanAmount * scaledBps + BPS_DENOMINATOR_SCALED - 1n) / BPS_DENOMINATOR_SCALED;
}

function minimumAtomicReceiverProfitBaseUnits(
  opportunity: RoutePlanningOpportunity,
  loanAmount: bigint,
): bigint | null {
  if (opportunity.type !== 'ZERO_CAPITAL_ATOMIC') return null;
  const targetBps = atomicTargetBps();
  const measuredNetBps = Number(opportunity.netProfitBps);
  if (!Number.isFinite(measuredNetBps) || measuredNetBps < targetBps) return null;
  // Receiver profit is measured after principal/provider-fee repayment, but before
  // operator-side gas/relay settlement. Add only those external costs so the
  // encoded atomic threshold preserves the all-in target without double-counting
  // the flash-loan fee already repaid inside the receiver.
  const externalExecutionCost = optionalBaseUnits(opportunity.estimatedGasCostInInputToken)
    + optionalBaseUnits(opportunity.relayFeeInInputToken);
  return minimumAtomicNetProfitBaseUnits(loanAmount) + externalExecutionCost;
}

function applyHaircut(raw: bigint, bps: number): string {
  const bounded = Math.max(1, Math.min(10000, bps));
  return ((raw * BigInt(bounded)) / 10000n).toString();
}

function normalizeProtocol(protocol: string): SupportedSwapProtocol {
  const normalized = protocol.trim().toLowerCase();
  if (normalized === 'uniswapv3' || normalized === 'uniswap_v3' || normalized === 'uniswap-v3') return 'uniswapV3';
  if (normalized === 'sushiswap' || normalized === 'sushi') return 'sushiswap';
  if (normalized === 'pancakeswapv2' || normalized === 'pancakeswap_v2' || normalized === 'pancakeswap-v2' || normalized === 'pancakev2' || normalized === 'pancake-v2') return 'pancakeswapV2';
  if (normalized === 'traderjoev1' || normalized === 'traderjoe_v1' || normalized === 'traderjoe-v1' || normalized === 'joev1' || normalized === 'joe-v1') return 'traderJoeV1';
  if (normalized === 'sushiswapv3' || normalized === 'sushiswap_v3' || normalized === 'sushi-v3') return 'sushiswapV3';
  if (normalized === 'aaveghogsm' || normalized === 'aave_gho_gsm' || normalized === 'aave-gho-gsm') return 'aaveGhoGsm';
  if (normalized === 'fluiddext1' || normalized === 'fluid_dex_t1' || normalized === 'fluid-dex-t1') return 'fluidDexT1';
  if (normalized === 'skylitepsm' || normalized === 'sky_lite_psm' || normalized === 'sky-lite-psm') return 'skyLitePsm';
  if (normalized === 'skydaiusds' || normalized === 'sky_dai_usds' || normalized === 'sky-dai-usds') return 'skyDaiUsds';
  throw new Error(`Unsupported autonomous route protocol: ${protocol}`);
}

function mapFeeToTier(fee: number): UniswapV3FeeTier {
  if (!Number.isFinite(fee) || fee < 0 || fee > 0.1) {
    throw new Error('Autonomous route fee must be a decimal fraction between 0 and 0.1');
  }
  if (fee <= 0.0001) return 100;
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

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function boundedRouteHopLimit(value: number): number {
  if (!Number.isFinite(value)) return 4;
  return Math.max(2, Math.min(8, Math.trunc(value)));
}

function boundedBps(label: string, value: number, fallback: number): number {
  const candidate = Number.isFinite(value) ? value : fallback;
  if (!Number.isFinite(candidate)) {
    throw new Error(`${label} must be a finite number`);
  }
  return Math.max(100, Math.min(10000, Math.trunc(candidate)));
}

function boundedDeadlineSeconds(value: number): number {
  if (!Number.isFinite(value)) return 90;
  return Math.max(30, Math.min(300, Math.trunc(value)));
}

export function buildFlashLoanExecutionPlanFromOpportunity(
  opportunity: RoutePlanningOpportunity,
  options?: {
    receiver?: string;
    provider?: FlashLoanProviderKind;
    /** Offline/test override only when WALLET_PRIVATE_KEY is absent. */
    profitRecipient?: string;
    /**
     * Exact all-in minimum profit required by an execution transport. A caller
     * may raise the canonical positive floor (for example, to repay a builder),
     * but may never claim more than the measured opportunity itself can produce.
     */
    minProfitBaseUnits?: bigint | string;
    minOutputBps?: number;
    maxRouteHops?: number;
    deadlineBufferSeconds?: number;
    nowMs?: number;
  },
): FlashLoanReceiverExecutionPlan {
  if (!Array.isArray(opportunity.route) || opportunity.route.length < 2) {
    throw new Error('Autonomous zero-capital planning requires at least two route legs');
  }

  const nowMs = options?.nowMs ?? Date.now();
  if (opportunity.expiresAt !== undefined && nowMs > opportunity.expiresAt) {
    throw new Error('Autonomous zero-capital opportunity expired before execution planning');
  }
  if (opportunity.timestamp !== undefined && opportunity.expiresAt !== undefined && opportunity.expiresAt < opportunity.timestamp) {
    throw new Error('Autonomous zero-capital opportunity has an invalid execution window');
  }

  const maxRouteHops = boundedRouteHopLimit(
    options?.maxRouteHops ?? Number(process.env.ZERO_CAPITAL_MAX_ROUTE_HOPS || 4),
  );
  if (opportunity.route.length > maxRouteHops) {
    throw new Error(`Autonomous zero-capital route exceeds the configured ${maxRouteHops}-hop execution limit`);
  }

  const inputToken = requireAddress('opportunity.inputToken', opportunity.inputToken);
  const receiver = requireAddress(
    'ZERO_CAPITAL_FLASHLOAN_RECEIVER',
    options?.receiver || process.env.ZERO_CAPITAL_FLASHLOAN_RECEIVER,
  );
  const profitRecipient = requireAddress(
    'operational CryptoCrawler profit recipient',
    resolveOperationalProfitRecipient(options?.profitRecipient),
  );

  const flashLoanAmount = BigInt(bigintishToString(opportunity.flashLoanAmount));
  const expectedProfit = BigInt(bigintishToString(opportunity.expectedProfit));
  if (flashLoanAmount <= 0n) throw new Error('Autonomous zero-capital flash-loan amount must be greater than zero');
  if (!isStrictlyPositiveProfitBaseUnits(expectedProfit)) throw new Error('Autonomous zero-capital expected all-in profit must be strictly greater than zero');

  const canonicalMinimumProfit = minimumPositiveProfitBaseUnits();
  const requestedMinimumProfit = options?.minProfitBaseUnits === undefined
    ? canonicalMinimumProfit
    : BigInt(bigintishToString(options.minProfitBaseUnits));
  if (!isStrictlyPositiveProfitBaseUnits(requestedMinimumProfit)) throw new Error('Autonomous zero-capital minimum execution profit must be strictly greater than zero');
  if (requestedMinimumProfit < canonicalMinimumProfit) throw new Error('Autonomous zero-capital minimum execution profit cannot weaken the canonical positive-profit floor');
  const atomicReceiverMinimum = minimumAtomicReceiverProfitBaseUnits(opportunity, flashLoanAmount);
  const enforcedMinimumProfit = atomicReceiverMinimum !== null && atomicReceiverMinimum > requestedMinimumProfit
    ? atomicReceiverMinimum
    : requestedMinimumProfit;
  // Only Atomic target accounting compares an all-in quote with the receiver's
  // pre-external-cost threshold. Ordinary callers retain the original exact check.
  const expectedReceiverProfit = opportunity.type === 'ZERO_CAPITAL_ATOMIC'
    ? expectedProfit
      + optionalBaseUnits(opportunity.estimatedGasCostInInputToken)
      + optionalBaseUnits(opportunity.relayFeeInInputToken)
    : expectedProfit;
  if (enforcedMinimumProfit > expectedReceiverProfit) throw new Error('Autonomous zero-capital minimum execution profit exceeds the measured executable profit');

  const minOutputBps = boundedBps(
    'ZERO_CAPITAL_ROUTE_MIN_OUTPUT_BPS',
    options?.minOutputBps ?? Number(process.env.ZERO_CAPITAL_ROUTE_MIN_OUTPUT_BPS || 9990),
    9990,
  );
  const deadlineBufferSeconds = boundedDeadlineSeconds(
    options?.deadlineBufferSeconds ?? Number(process.env.ZERO_CAPITAL_SWAP_DEADLINE_SECONDS || 90),
  );

  let previousExpectedOut = flashLoanAmount;
  const steps: OnchainSwapLeg[] = opportunity.route.map((step, index) => {
    const tokenIn = requireAddress(`route[${index}].tokenIn`, step.tokenIn);
    const tokenOut = requireAddress(`route[${index}].tokenOut`, step.tokenOut);
    if (sameAddress(tokenIn, tokenOut)) throw new Error(`Autonomous zero-capital route step ${index} cannot swap a token into itself`);
    if (index === 0 && !sameAddress(tokenIn, inputToken)) throw new Error('Autonomous zero-capital route must begin with the borrowed token');
    if (index > 0 && !sameAddress(opportunity.route[index - 1].tokenOut, tokenIn)) throw new Error(`Autonomous zero-capital route is not token-contiguous at step ${index}`);

    const expectedAmountOut = BigInt(bigintishToString(step.expectedAmountOut));
    const requestedAmountIn = BigInt(bigintishToString(step.amountIn));
    if (expectedAmountOut <= 0n) throw new Error(`Autonomous zero-capital route step ${index} expected output must be greater than zero`);
    const requiredAmountIn = index === 0 ? flashLoanAmount : previousExpectedOut;
    if (requestedAmountIn !== requiredAmountIn) throw new Error(`Autonomous zero-capital route step ${index} amountIn does not match the preceding quoted output`);
    previousExpectedOut = expectedAmountOut;

    const protocol = normalizeProtocol(step.protocol);
    const protocolAnchor = protocol === 'aaveGhoGsm'
      || protocol === 'fluidDexT1'
      || protocol === 'skyLitePsm'
      || protocol === 'skyDaiUsds';
    const pool = step.pool ? requireAddress(`route[${index}].pool`, step.pool) : undefined;
    return {
      protocol,
      chain: opportunity.chain,
      tokenIn,
      tokenOut,
      amountIn: requiredAmountIn.toString(),
      // Protocol-anchor legs use the exact measured output. A changed protocol or
      // pool state must fail closed instead of silently changing the next atomic leg size.
      minAmountOut: protocolAnchor
        ? expectedAmountOut.toString()
        : applyHaircut(expectedAmountOut, minOutputBps),
      ...(pool ? { pool } : {}),
      feeTier: mapFeeToTier(step.fee),
      recipient: receiver,
      deadlineBufferSeconds,
    };
  });

  if (!sameAddress(steps[steps.length - 1].tokenOut, inputToken)) throw new Error('Autonomous zero-capital route must return to the borrowed token for atomic repayment');

  return {
    chain: opportunity.chain,
    receiver,
    provider: options?.provider || 'balancer_v2',
    loanToken: inputToken,
    loanAmount: flashLoanAmount.toString(),
    minProfit: enforcedMinimumProfit.toString(),
    profitRecipient,
    steps,
    gasLimit: 1400000,
  };
}