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

export interface BuilderSponsoredBundleGasPlan extends BuilderSponsoredGasPlan {
  transactionCount: number;
  totalGasLimit: BigNumber;
  totalValueWei: BigNumber;
}

function asPositiveBigNumber(label: string, value: BigNumber | bigint | string | number): BigNumber {
  const parsed = typeof value === 'bigint' ? BigNumber.from(value.toString()) : BigNumber.from(value);
  if (parsed.lte(0)) throw new Error(`${label} must be greater than zero`);
  return parsed;
}

function asNonNegativeBigNumber(label: string, value: BigNumber | bigint | string | number): BigNumber {
  const parsed = typeof value === 'bigint' ? BigNumber.from(value.toString()) : BigNumber.from(value);
  if (parsed.lt(0)) throw new Error(`${label} must be non-negative`);
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
  const gasUsed = asNonNegativeBigNumber('gasUsed', input.gasUsed);
  const gasLimit = asPositiveBigNumber('block gasLimit', input.gasLimit);
  if (gasUsed.gt(gasLimit)) throw new Error('gasUsed must be between zero and gasLimit');

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

function computeFeeTerms(input: {
  currentBlockNumber: number;
  baseFeePerGasWei: BigNumber | bigint | string | number;
  blockGasUsed: BigNumber | bigint | string | number;
  blockGasLimit: BigNumber | bigint | string | number;
  maxFeeSafetyWei?: BigNumber | bigint | string | number;
}): { targetBlock: number; nextBaseFeePerGasWei: BigNumber; maxFeePerGasWei: BigNumber; maxPriorityFeePerGasWei: BigNumber } {
  if (!Number.isSafeInteger(input.currentBlockNumber) || input.currentBlockNumber <= 0) {
    throw new Error('currentBlockNumber must be a positive safe integer');
  }
  const nextBaseFeePerGasWei = computeNextBlockBaseFee({
    baseFeePerGasWei: input.baseFeePerGasWei,
    gasUsed: input.blockGasUsed,
    gasLimit: input.blockGasLimit,
  });
  const safety = input.maxFeeSafetyWei === undefined
    ? BigNumber.from(1)
    : asNonNegativeBigNumber('maxFeeSafetyWei', input.maxFeeSafetyWei);
  return {
    targetBlock: input.currentBlockNumber + 1,
    nextBaseFeePerGasWei,
    maxFeePerGasWei: nextBaseFeePerGasWei.add(safety),
    maxPriorityFeePerGasWei: BigNumber.from(0),
  };
}

function computeMargin(sponsorCapWei: BigNumber, builderMarginBps?: number): BigNumber {
  const marginBps = builderMarginBps ?? 2_000;
  if (!Number.isSafeInteger(marginBps) || marginBps < 1 || marginBps > 10_000) {
    throw new Error('builderMarginBps must be an integer from 1 to 10000');
  }
  let builderMarginWei = sponsorCapWei.mul(marginBps).add(9_999).div(10_000);
  if (builderMarginWei.isZero()) builderMarginWei = BigNumber.from(1);
  return builderMarginWei;
}

/**
 * Conservative cold-start gas budget for one transaction that targets exactly the
 * next Ethereum block and uses zero priority fee. The builder may have to prepend
 * enough ETH to satisfy the sender's EIP-1559 upfront balance requirement, so the
 * opportunity pays block.coinbase at least that full cap plus a positive margin.
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
  const gasLimit = asPositiveBigNumber('transactionGasLimit', input.transactionGasLimit);
  const fee = computeFeeTerms(input);
  const sponsorCapWei = gasLimit.mul(fee.maxFeePerGasWei);
  const builderMarginWei = computeMargin(sponsorCapWei, input.builderMarginBps);
  return {
    ...fee,
    gasLimit,
    sponsorCapWei,
    builderMarginWei,
    builderPaymentWei: sponsorCapWei.add(builderMarginWei),
  };
}

/**
 * Greenfield cold start: deployment, configuration and execution may all be signed
 * by the same zero-ETH EOA with consecutive nonces and included atomically. Titan
 * and Quasar document sponsorship for transaction arrays; therefore the builder
 * repayment floor must cover the sum of every transaction's maximum EIP-1559 gas
 * liability plus any native value transferred by those transactions.
 *
 * Any unused builder-funded ETH that remains on the EOA after inclusion is external
 * sponsor residue. It is quarantined from SELF_FUNDED capital until a separate
 * provenance proof explicitly accepts it.
 */
export function buildBuilderSponsoredBundleGasPlan(input: {
  currentBlockNumber: number;
  baseFeePerGasWei: BigNumber | bigint | string | number;
  blockGasUsed: BigNumber | bigint | string | number;
  blockGasLimit: BigNumber | bigint | string | number;
  transactions: Array<{
    gasLimit: BigNumber | bigint | string | number;
    valueWei?: BigNumber | bigint | string | number;
  }>;
  builderMarginBps?: number;
  maxFeeSafetyWei?: BigNumber | bigint | string | number;
}): BuilderSponsoredBundleGasPlan {
  if (!Array.isArray(input.transactions) || input.transactions.length === 0) {
    throw new Error('Sponsored bundle gas plan requires at least one transaction');
  }
  if (input.transactions.length > 16) throw new Error('Sponsored bundle gas plan exceeds 16 transactions');
  const fee = computeFeeTerms(input);
  let totalGasLimit = BigNumber.from(0);
  let totalValueWei = BigNumber.from(0);
  for (let index = 0; index < input.transactions.length; index++) {
    totalGasLimit = totalGasLimit.add(asPositiveBigNumber(`transactions[${index}].gasLimit`, input.transactions[index].gasLimit));
    totalValueWei = totalValueWei.add(asNonNegativeBigNumber(`transactions[${index}].valueWei`, input.transactions[index].valueWei ?? 0));
  }
  const sponsorCapWei = totalGasLimit.mul(fee.maxFeePerGasWei).add(totalValueWei);
  const builderMarginWei = computeMargin(sponsorCapWei, input.builderMarginBps);
  return {
    ...fee,
    gasLimit: totalGasLimit,
    transactionCount: input.transactions.length,
    totalGasLimit,
    totalValueWei,
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
