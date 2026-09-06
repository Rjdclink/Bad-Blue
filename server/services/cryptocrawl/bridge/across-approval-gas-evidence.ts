import { BigNumber, ethers } from 'ethers';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import { coinGeckoPriceClient } from './coingecko-client.js';
import { SUPPORTED_CHAINS } from './chain-config.js';
import type { ChainId } from './types.js';

export interface AcrossApprovalGasEvidence {
  approvalTransactions: number;
  estimatedGasUnits: string;
  bufferedGasUnits: string;
  feeCeilingWeiPerGas: string;
  maximumGasWei: string;
  nativeUsdPrice: number;
  maximumGasUsd: number;
  observedAt: number;
  authority: 'rpc_estimate_gas_plus_live_native_usd_price';
  syntheticEvidence: false;
}

type ApprovalTx = {
  chainId?: number;
  to: string;
  data: string;
  value: string;
};

function validAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function validData(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value);
}

function parseApproval(value: any): ApprovalTx | null {
  if (!value || !validAddress(value.to) || !validData(value.data)) return null;
  const chainId = value.chainId === undefined ? undefined : Number(value.chainId);
  if (chainId !== undefined && !Number.isInteger(chainId)) return null;
  const rawValue = value.value === undefined || value.value === null ? '0' : String(value.value);
  try { BigNumber.from(rawValue); } catch { return null; }
  return { chainId, to: value.to, data: value.data, value: rawValue };
}

function gasBufferPermille(): number {
  const raw = Number(process.env.ACROSS_APPROVAL_GAS_BUFFER_MULTIPLIER || 1.25);
  const bounded = Number.isFinite(raw) ? Math.max(1, Math.min(2, raw)) : 1.25;
  return Math.ceil(bounded * 1000);
}

function feeCeiling(feeData: ethers.providers.FeeData): BigNumber | null {
  if (feeData.maxFeePerGas && feeData.maxFeePerGas.gt(0)) return feeData.maxFeePerGas;
  if (feeData.gasPrice && feeData.gasPrice.gt(0)) return feeData.gasPrice;
  return null;
}

/**
 * Measure the complete pre-principal approval-gas ceiling for the exact Across
 * approval transactions returned by the current uncached quote. This turns
 * approval-required routes into measurable candidates instead of a permanent
 * missing-evidence dead end. No transaction is submitted here.
 */
export async function measureAcrossApprovalGasEvidence(input: {
  chain: ChainId;
  depositor: string;
  approvalTxns: unknown;
}): Promise<AcrossApprovalGasEvidence | null> {
  const raw = Array.isArray(input.approvalTxns) ? input.approvalTxns : [];
  if (raw.length === 0) {
    return {
      approvalTransactions: 0,
      estimatedGasUnits: '0',
      bufferedGasUnits: '0',
      feeCeilingWeiPerGas: '0',
      maximumGasWei: '0',
      nativeUsdPrice: 0,
      maximumGasUsd: 0,
      observedAt: Date.now(),
      authority: 'rpc_estimate_gas_plus_live_native_usd_price',
      syntheticEvidence: false,
    };
  }
  if (!validAddress(input.depositor)) return null;
  const approvals = raw.map(parseApproval);
  if (approvals.some(tx => tx === null)) return null;
  const parsed = approvals as ApprovalTx[];
  const expectedChainId = SUPPORTED_CHAINS[input.chain].chainId;
  if (parsed.some(tx => tx.chainId !== undefined && tx.chainId !== expectedChainId)) return null;

  await multiProviderRpcManager.initialize([input.chain]);
  const { result } = await multiProviderRpcManager.execute(input.chain, 'gas', async provider => {
    const [feeData, estimates] = await Promise.all([
      provider.getFeeData(),
      Promise.all(parsed.map(tx => provider.estimateGas({
        from: input.depositor,
        to: tx.to,
        data: tx.data,
        value: BigNumber.from(tx.value),
      }))),
    ]);
    const ceiling = feeCeiling(feeData);
    if (!ceiling) throw new Error('Across approval gas has no positive live fee ceiling');
    const estimated = estimates.reduce((sum, value) => sum.add(value), BigNumber.from(0));
    if (estimated.lte(0)) throw new Error('Across approval gas estimate is non-positive');
    const permille = gasBufferPermille();
    const buffered = estimated.mul(permille).add(999).div(1000);
    return { estimated, buffered, ceiling, maximumWei: buffered.mul(ceiling) };
  });

  const nativeSymbol = SUPPORTED_CHAINS[input.chain].currency;
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices([nativeSymbol]);
  const nativeUsdPrice = prices.get(nativeSymbol);
  if (!Number.isFinite(nativeUsdPrice) || Number(nativeUsdPrice) <= 0) return null;
  const maximumNative = Number(ethers.utils.formatEther(result.maximumWei));
  if (!Number.isFinite(maximumNative) || maximumNative < 0) return null;
  const maximumGasUsd = maximumNative * Number(nativeUsdPrice);
  if (!Number.isFinite(maximumGasUsd) || maximumGasUsd < 0) return null;

  return {
    approvalTransactions: parsed.length,
    estimatedGasUnits: result.estimated.toString(),
    bufferedGasUnits: result.buffered.toString(),
    feeCeilingWeiPerGas: result.ceiling.toString(),
    maximumGasWei: result.maximumWei.toString(),
    nativeUsdPrice: Number(nativeUsdPrice),
    maximumGasUsd,
    observedAt: Date.now(),
    authority: 'rpc_estimate_gas_plus_live_native_usd_price',
    syntheticEvidence: false,
  };
}
