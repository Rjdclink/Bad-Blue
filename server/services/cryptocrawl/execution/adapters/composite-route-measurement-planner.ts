import type { ZeroCapitalOpportunity } from '../../core/zero-capital-engine.js';
import type {
  OnchainSwapLeg,
  SupportedSwapProtocol,
  UniswapV3FeeTier,
} from './onchain-payload-builder.js';

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function requireAddress(label: string, value: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`${label} must be a valid EVM address`);
  return value;
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
  throw new Error(`Unsupported composite measurement route protocol: ${protocol}`);
}

function feeTier(fee: number): UniswapV3FeeTier {
  if (!Number.isFinite(fee) || fee < 0 || fee > 0.1) throw new Error('Composite route fee must be between 0 and 0.1');
  if (fee <= 0.0001) return 100;
  if (fee <= 0.0005) return 500;
  if (fee <= 0.003) return 3000;
  return 10000;
}

function outputFloor(expectedAmountOut: bigint, protocol: SupportedSwapProtocol): string {
  if (expectedAmountOut <= 0n) throw new Error('Composite route expected output must be positive');
  const exactAnchor = protocol === 'aaveGhoGsm'
    || protocol === 'fluidDexT1'
    || protocol === 'skyLitePsm'
    || protocol === 'skyDaiUsds';
  if (exactAnchor) return expectedAmountOut.toString();
  const configured = Number(process.env.ZERO_CAPITAL_ROUTE_MIN_OUTPUT_BPS || 9990);
  const bps = Number.isFinite(configured) ? Math.max(100, Math.min(10_000, Math.trunc(configured))) : 9990;
  return (expectedAmountOut * BigInt(bps) / 10_000n).toString();
}

/**
 * Builds swap steps for measurement of a composite atomic transaction without
 * weakening the ordinary single-route planner's positive-profit admission rule.
 * This function grants no execution eligibility. The resulting composite must
 * still pass exact simulation, gas measurement, aggregate repayment and the
 * configured all-in net BPS target before it can be promoted.
 */
export function buildCompositeMeasurementSteps(
  opportunity: ZeroCapitalOpportunity,
  receiver: string,
): OnchainSwapLeg[] {
  if (opportunity.chain === 'europa') throw new Error('Europa composite execution is retired');
  requireAddress('composite receiver', receiver);
  requireAddress('composite input token', opportunity.inputToken);
  if (!Array.isArray(opportunity.route) || opportunity.route.length < 2) {
    throw new Error('Composite measurement requires at least two route legs per closed cycle');
  }
  if (opportunity.route.length > 8) throw new Error('Composite measurement route exceeds eight hops');
  if (Date.now() >= opportunity.expiresAt) throw new Error('Composite measurement opportunity expired');

  let priorOut = opportunity.flashLoanAmount;
  return opportunity.route.map((step, index) => {
    requireAddress(`route[${index}].tokenIn`, step.tokenIn);
    requireAddress(`route[${index}].tokenOut`, step.tokenOut);
    if (index === 0 && !sameAddress(step.tokenIn, opportunity.inputToken)) {
      throw new Error('Composite cycle must begin with the borrowed token');
    }
    if (index > 0 && !sameAddress(opportunity.route[index - 1].tokenOut, step.tokenIn)) {
      throw new Error(`Composite route is not token-contiguous at step ${index}`);
    }
    if (step.amountIn !== priorOut) throw new Error(`Composite route amount mismatch at step ${index}`);
    if (step.expectedAmountOut <= 0n) throw new Error(`Composite route output must be positive at step ${index}`);
    priorOut = step.expectedAmountOut;
    const protocol = normalizeProtocol(step.protocol);
    return {
      protocol,
      chain: opportunity.chain,
      tokenIn: step.tokenIn,
      tokenOut: step.tokenOut,
      amountIn: step.amountIn.toString(),
      minAmountOut: outputFloor(step.expectedAmountOut, protocol),
      feeTier: feeTier(step.fee),
      recipient: receiver,
      deadlineBufferSeconds: Math.max(30, Math.min(300, Number(process.env.ZERO_CAPITAL_SWAP_DEADLINE_SECONDS || 90))),
    };
  }).map((step, index, steps) => {
    if (index === steps.length - 1 && !sameAddress(step.tokenOut, opportunity.inputToken)) {
      throw new Error('Composite cycle must close back into the borrowed token');
    }
    return step;
  });
}
