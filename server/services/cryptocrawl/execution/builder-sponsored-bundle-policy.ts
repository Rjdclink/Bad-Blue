import { BigNumber } from 'ethers';

export interface BuilderSponsoredGasPlan {
  targetBlock: number;
  gasLimit: BigNumber;
  nextBaseFeePerGasWei: BigNumber;
  maxFeePerGasWei: BigNumber;
  maxPriorityFeePerGasWei: BigNumber;
  sponsorCapWei: BigNumber;
  builderMarginWei: BigNumber;
  builderPaymentWei: BigNumber;
}

function asPositiveBigNumber(label: string, value: BigNumber | bigint | string | number): BigNumber {
  const parsed = typeof value === 'bigint' ? BigNumber.from(value.toString()) : BigNumber.from(value);
  if (parsed.lte(0)) throw new Error(`${label} must be greater than zero`);
  return parsed;
}

/**
 * Exact EIP-1559 base-fee transition for one block forward.
 * Ethereum's elasticity multiplier is 2 and BASE_FEE_MAX_CHANGE_DENOMINATOR is 8.
 */
export function computeNextBlockBaseFee(input: {
  baseFeePerGasWei: BigNumber | bigint | string | number;
  gasUsed: BigNumber | bigint | string | number;
  gasLimit: BigNumber | bigint | string | number;
}): BigNumber {
  const baseFee = asPositiveBigNumber('baseFeePerGasWei', input.baseFeePerGasWei);
  const gasUsed = typeof input.gasUsed === 'bigint' ? BigNumber.from(input.gasUsed.toString()) : BigNumber.from(input.gasUsed);
  const gasLimit = asPositiveBigNumber('block gasLimit', input.gasLimit);
  if (gasUsed.lt(0) || gasUsed.gt(gasLimit)) throw new Error('gasUsed must be between zero and gasLimit');

  const target = gasLimit.div(2);
  if (target.isZero()) throw new Error('block gas target is zero');
  if (gasUsed.eq(target)) return baseFee;

  if (gasUsed.gt(target)) {
    const gasDelta = gasUsed.sub(target);
    let feeDelta = baseFee.mul(gasDelta).div(target).div(8);
    if (feeDelta.isZero()) feeDelta = BigNumber.from(1);
    return baseFee.add(feeDelta);
  }

  const gasDelta = target.sub(gasUsed);
  const feeDelta = baseFee.mul(gasDelta).div(target).div(8);
  return feeDelta.gte(baseFee) ? BigNumber.from(0) : baseFee.sub(feeDelta);
}

/**
 * Conservative cold-start gas budget for a transaction that targets exactly the
 * next Ethereum block and uses zero priority fee. The builder may have to prepend
 * enough ETH to satisfy the sender's EIP-1559 upfront balance requirement, so the
 * opportunity must pay block.coinbase at least that full cap plus a positive
 * builder margin. Unused sponsored ETH can remain at the EOA after execution and
 * MUST NOT be counted as internally generated capital without separate provenance.
 */
export function buildBuilderSponsoredGasPlan(input: {
  currentBlockNumber: number;
  baseFeePerGasWei: BigNumber | bigint | string | number;
  blockGasUsed: BigNumber | bigint | string | number;
  blockGasLimit: BigNumber | bigint | string | number;
  transactionGasLimit: BigNumber | bigint | string | number;
  builderMarginBps?: number;
  maxFeeSafetyWei?: BigNumber | bigint | string | number;
}): BuilderSponsoredGasPlan {
  if (!Number.isSafeInteger(input.currentBlockNumber) || input.currentBlockNumber <= 0) {
    throw new Error('currentBlockNumber must be a positive safe integer');
  }
  const gasLimit = asPositiveBigNumber('transactionGasLimit', input.transactionGasLimit);
  const nextBaseFeePerGasWei = computeNextBlockBaseFee({
    baseFeePerGasWei: input.baseFeePerGasWei,
    gasUsed: input.blockGasUsed,
    gasLimit: input.blockGasLimit,
  });
  const safety = input.maxFeeSafetyWei === undefined
    ? BigNumber.from(1)
    : (typeof input.maxFeeSafetyWei === 'bigint'
      ? BigNumber.from(input.maxFeeSafetyWei.toString())
      : BigNumber.from(input.maxFeeSafetyWei));
  if (safety.lt(0)) throw new Error('maxFeeSafetyWei must be non-negative');

  const marginBps = input.builderMarginBps ?? 2_000;
  if (!Number.isSafeInteger(marginBps) || marginBps < 1 || marginBps > 10_000) {
    throw new Error('builderMarginBps must be an integer from 1 to 10000');
  }

  const maxFeePerGasWei = nextBaseFeePerGasWei.add(safety);
  const sponsorCapWei = gasLimit.mul(maxFeePerGasWei);
  let builderMarginWei = sponsorCapWei.mul(marginBps).add(9_999).div(10_000);
  if (builderMarginWei.isZero()) builderMarginWei = BigNumber.from(1);

  return {
    targetBlock: input.currentBlockNumber + 1,
    gasLimit,
    nextBaseFeePerGasWei,
    maxFeePerGasWei,
    maxPriorityFeePerGasWei: BigNumber.from(0),
    sponsorCapWei,
    builderMarginWei,
    builderPaymentWei: sponsorCapWei.add(builderMarginWei),
  };
}

export function requireBuilderPaymentCovered(input: {
  builderPaymentWei: BigNumber | bigint | string | number;
  exactOutputWethWei: BigNumber | bigint | string | number;
}): void {
  const required = asPositiveBigNumber('builderPaymentWei', input.builderPaymentWei);
  const available = asPositiveBigNumber('exactOutputWethWei', input.exactOutputWethWei);
  if (available.lt(required)) throw new Error('Exact-output WETH is below the hard builder-payment requirement');
}
