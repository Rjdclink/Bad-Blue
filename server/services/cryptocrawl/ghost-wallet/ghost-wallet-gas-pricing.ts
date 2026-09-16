import { BigNumber, providers } from 'ethers';

export interface GhostWalletGasPricing {
  expectedFeePerGas: BigNumber;
  signingFeeCeilingPerGas: BigNumber;
  priorityFeePerGas: BigNumber | null;
  baseFeePerGas: BigNumber | null;
  mode: 'eip1559_expected_effective' | 'legacy_gas_price' | 'eip1559_ceiling_fallback';
}

function positive(value: BigNumber | null | undefined): value is BigNumber {
  return Boolean(value && value.gt(0));
}

function min(left: BigNumber, right: BigNumber): BigNumber {
  return left.lte(right) ? left : right;
}

/**
 * Profitability uses the expected effective EIP-1559 price (base + priority,
 * capped by maxFee). The wallet balance/signing guard retains maxFee as its
 * worst-case ceiling. This prevents maxFee headroom from being counted as if it
 * were a certain realized gas cost.
 */
export function resolveGhostWalletGasPricing(feeData: providers.FeeData): GhostWalletGasPricing {
  const baseFee = positive(feeData.lastBaseFeePerGas) ? feeData.lastBaseFeePerGas : null;
  const priority = positive(feeData.maxPriorityFeePerGas) ? feeData.maxPriorityFeePerGas : null;
  const maxFee = positive(feeData.maxFeePerGas) ? feeData.maxFeePerGas : null;
  const gasPrice = positive(feeData.gasPrice) ? feeData.gasPrice : null;

  if (baseFee && priority && maxFee) {
    const expected = min(baseFee.add(priority), maxFee);
    if (expected.gt(0)) {
      return {
        expectedFeePerGas: expected,
        signingFeeCeilingPerGas: maxFee,
        priorityFeePerGas: priority,
        baseFeePerGas: baseFee,
        mode: 'eip1559_expected_effective',
      };
    }
  }
  if (gasPrice) {
    return {
      expectedFeePerGas: gasPrice,
      signingFeeCeilingPerGas: maxFee || gasPrice,
      priorityFeePerGas: priority,
      baseFeePerGas: baseFee,
      mode: 'legacy_gas_price',
    };
  }
  if (maxFee) {
    return {
      expectedFeePerGas: maxFee,
      signingFeeCeilingPerGas: maxFee,
      priorityFeePerGas: priority,
      baseFeePerGas: baseFee,
      mode: 'eip1559_ceiling_fallback',
    };
  }
  throw new Error('GHOST_WALLET_CONTROLLER_GAS_PRICE_UNAVAILABLE');
}

export const GHOST_WALLET_GAS_PRICING_POLICY = {
  profitabilityUsesExpectedEffectiveFee: true,
  balanceGuardUsesSigningCeiling: true,
  maxFeeHeadroomNotCountedAsCertainCost: true,
  hardGasPriceConstant: false,
} as const;
