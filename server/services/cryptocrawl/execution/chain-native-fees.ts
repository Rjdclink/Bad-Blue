import { BigNumber, ethers, type providers } from 'ethers';

// Only OP Stack networks use this predeploy. Arbitrum's estimate/receipt already
// includes the L1 component; adding an OP-style surcharge there double counts it.
const OP_STACK_CHAIN_IDS = new Set([10, 8453, 11155420, 84532]);
const GAS_PRICE_ORACLE = '0x420000000000000000000000000000000000000F';
const oracleInterface = new ethers.utils.Interface([
  'function getL1Fee(bytes) view returns (uint256)',
  'function getOperatorFee(uint256) view returns (uint256)',
]);

async function oracleFee(provider: providers.Provider, method: string, args: unknown[], blockTag: providers.BlockTag = 'latest'): Promise<BigNumber> {
  const result = await provider.call({ to: GAS_PRICE_ORACLE, data: oracleInterface.encodeFunctionData(method, args) }, blockTag);
  return BigNumber.from(oracleInterface.decodeFunctionResult(method, result)[0]);
}

export function unsignedFeePayload(parsed: ReturnType<typeof ethers.utils.parseTransaction>): string {
  return ethers.utils.serializeTransaction({
    chainId: parsed.chainId, nonce: parsed.nonce, to: parsed.to,
    data: parsed.data, value: parsed.value, gasLimit: parsed.gasLimit,
    type: parsed.type ?? undefined,
    ...(parsed.type === 2
      ? { maxFeePerGas: parsed.maxFeePerGas, maxPriorityFeePerGas: parsed.maxPriorityFeePerGas, accessList: parsed.accessList }
      : { gasPrice: parsed.gasPrice, ...(parsed.type === 1 ? { accessList: parsed.accessList } : {}) }),
  });
}

/** Current-state estimate, never a claim that the inclusion-time L1 fee is capped. */
export async function estimateAdditionalNativeFees(input: {
  provider: providers.Provider; chainId: number; unsignedTransaction: string; gasLimit: BigNumber;
}): Promise<BigNumber> {
  if (!OP_STACK_CHAIN_IDS.has(input.chainId)) return BigNumber.from(0);
  // Pin both oracle reads to the same block and let the chain's deployed oracle
  // select the active fork formula. Missing oracle evidence must fail explicitly.
  const block = await input.provider.getBlockNumber();
  const [l1, operator] = await Promise.all([
    oracleFee(input.provider, 'getL1Fee', [input.unsignedTransaction], block),
    oracleFee(input.provider, 'getOperatorFee', [input.gasLimit], block),
  ]);
  return l1.add(operator);
}

/** Complete receipt-backed network cost; never substitute a signed fee ceiling. */
export async function measureReceiptNativeFees(input: {
  provider: providers.JsonRpcProvider; chainId: number; receipt: providers.TransactionReceipt;
}): Promise<BigNumber> {
  const { receipt, provider } = input;
  if (!receipt.effectiveGasPrice) throw new Error('Receipt has no measured effective gas price');
  const execution = receipt.gasUsed.mul(receipt.effectiveGasPrice);
  if (!OP_STACK_CHAIN_IDS.has(input.chainId)) return execution;
  // ethers v5 drops rollup-specific fields when formatting a receipt.
  const raw = await provider.send('eth_getTransactionReceipt', [receipt.transactionHash]);
  if (!raw || String(raw.transactionHash).toLowerCase() !== receipt.transactionHash.toLowerCase()
    || String(raw.blockHash).toLowerCase() !== receipt.blockHash.toLowerCase()
    || raw.l1Fee === undefined || raw.l1Fee === null) {
    throw new Error('OP receipt has no matching L1 fee evidence');
  }
  const l1 = BigNumber.from(raw.l1Fee);
  if (l1.lt(0)) throw new Error('OP receipt has invalid L1 fee evidence');
  // Historical block state supplies the operator parameters actually in force,
  // including Isthmus/Jovian behavior. Do not use today's parameters for old txs.
  const operator = await oracleFee(provider, 'getOperatorFee', [receipt.gasUsed], receipt.blockNumber);
  return execution.add(l1).add(operator);
}
