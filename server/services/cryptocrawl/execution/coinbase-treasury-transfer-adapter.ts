import { ethers } from 'ethers';
import { getCryptaraVenueSpecializationLearning } from '../../cryptara/venue-specialization-learning.js';
import {
  deterministicCoinbaseTransferIdempotencyKey,
  getCoinbaseCryptoTransaction,
  sendCoinbaseCrypto,
} from '../intelligence/coinbase-app-transfer-authority.js';
import { okxPrivateRequest } from '../intelligence/cex-private-authority.js';

const SETTLEMENT_TIMEOUT_MS = Math.max(60_000, Math.min(6 * 60 * 60_000, Number(process.env.CRYPTOCRAWL_TREASURY_TRANSFER_SETTLEMENT_TIMEOUT_MS || 60 * 60_000)));
const SETTLEMENT_POLL_MS = Math.max(5_000, Math.min(60_000, Number(process.env.CRYPTOCRAWL_TREASURY_TRANSFER_POLL_MS || 15_000)));
const FEE_BUFFER_BPS = Math.max(0, Math.min(1_000, Number(process.env.CRYPTOCRAWL_COINBASE_TRANSFER_FEE_BUFFER_BPS || 50)));
const FEE_BUFFER_ABS_STABLE = Math.max(0, Math.min(50, Number(process.env.CRYPTOCRAWL_COINBASE_TRANSFER_FEE_BUFFER_STABLE || 2)));

export interface CoinbaseToOkxPreparedTransfer {
  asset: string;
  desiredNet: number;
  sourceReservationCeiling: number;
  okxAddress: string;
  okxChain: string;
  okxDepositAccount: string | null;
  network: 'ethereum';
}

export interface CoinbaseToOkxSettlement {
  sourceDebitDecimal: number;
  deliveredDecimal: number;
  sourceFeeDecimal: number;
  withdrawalReference: string;
  transactionHash: string;
  destinationReference: string;
  sourceEvidence: Record<string, unknown>;
  destinationEvidence: Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function canonicalAddress(raw: unknown): string | null {
  const value = String(raw || '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : null;
}

function finitePositive(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function numericString(value: number, decimals = 12): string {
  if (!(value > 0) || !Number.isFinite(value)) throw new Error('Coinbase treasury transfer requires a finite positive amount');
  return value.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
}

export async function prepareCoinbaseToOkxTransfer(assetInput: string, desiredNet: number): Promise<CoinbaseToOkxPreparedTransfer> {
  const asset = assetInput.trim().toUpperCase();
  if (!['USDC', 'USDT', 'ETH'].includes(asset)) throw new Error(`Coinbase→OKX treasury routing does not support ${asset}`);
  if (!(desiredNet > 0) || !Number.isFinite(desiredNet)) throw new Error('Coinbase→OKX desired amount must be positive');

  const currencies = await okxPrivateRequest('/api/v5/asset/currencies', 'GET', { ccy: asset }, { lane: 'account_read' });
  const routes = currencies.data.filter((row: any) => {
    const chain = String(row?.chain || '').trim().toLowerCase();
    const canDeposit = row?.canDep === true || String(row?.canDep || '').toLowerCase() === 'true';
    return canDeposit && (chain.includes('erc20') || chain.includes('ethereum'))
      && !['arbitrum', 'optimism', 'base', 'polygon', 'bsc', 'zksync', 'linea', 'scroll', 'avalanche'].some(name => chain.includes(name));
  });
  if (routes.length !== 1) throw new Error(`OKX ${asset} does not expose exactly one authenticated Ethereum-mainnet deposit route`);
  const okxChain = String(routes[0].chain || '').trim();
  const minDep = finitePositive(routes[0]?.minDep) || 0;
  if (minDep > 0 && desiredNet + 1e-12 < minDep) throw new Error(`Coinbase→OKX ${asset} amount is below authenticated OKX minimum deposit`);

  const addresses = await okxPrivateRequest('/api/v5/asset/deposit-address', 'GET', { ccy: asset }, { lane: 'account_read' });
  const matching = addresses.data.filter((row: any) => String(row?.chain || '').trim() === okxChain && canonicalAddress(row?.addr));
  if (matching.length < 1) throw new Error(`OKX returned no authenticated Ethereum deposit address for ${asset}`);
  const preferred = matching.find((row: any) => row?.selected === true || String(row?.selected).toLowerCase() === 'true') || matching[0];
  const okxAddress = canonicalAddress(preferred.addr)!;
  const tag = String(preferred?.tag || preferred?.memo || preferred?.pmtId || '').trim();
  if (tag) throw new Error('Coinbase→OKX treasury routing does not support tagged Ethereum deposits');
  const okxDepositAccount = String(preferred?.to || '').trim() || null;

  const buffer = asset === 'ETH'
    ? Math.max(desiredNet * FEE_BUFFER_BPS / 10_000, 0.002)
    : Math.max(desiredNet * FEE_BUFFER_BPS / 10_000, FEE_BUFFER_ABS_STABLE);
  return {
    asset,
    desiredNet,
    sourceReservationCeiling: desiredNet + buffer,
    okxAddress,
    okxChain,
    okxDepositAccount,
    network: 'ethereum',
  };
}

async function waitCoinbaseSend(accountId: string, transactionId: string): Promise<Awaited<ReturnType<typeof getCoinbaseCryptoTransaction>>> {
  const deadline = Date.now() + SETTLEMENT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const tx = await getCoinbaseCryptoTransaction(accountId, transactionId);
    if (tx.status === 'completed') return tx;
    if (['failed', 'canceled', 'cancelled', 'expired'].includes(tx.status)) {
      throw new Error(`Coinbase send ${transactionId} reached terminal ${tx.status}`);
    }
    await sleep(SETTLEMENT_POLL_MS);
  }
  throw new Error(`Coinbase send ${transactionId} settlement timeout`);
}

async function waitOkxDeposit(prepared: CoinbaseToOkxPreparedTransfer, transactionHash: string): Promise<any> {
  const deadline = Date.now() + SETTLEMENT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const history = await okxPrivateRequest('/api/v5/asset/deposit-history', 'GET', {
      ccy: prepared.asset,
      txId: transactionHash,
    }, { lane: 'account_read' });
    const row = history.data.find((item: any) =>
      String(item?.txId || '').trim().toLowerCase() === transactionHash.toLowerCase()
      && String(item?.chain || '').trim() === prepared.okxChain
      && (!item?.to || String(item.to).trim().toLowerCase() === prepared.okxAddress),
    );
    if (row) {
      const state = String(row.state ?? '').trim();
      if (state === '2') return row;
      if (state.startsWith('-')) throw new Error(`OKX deposit ${transactionHash} reached terminal ${state}`);
    }
    await sleep(SETTLEMENT_POLL_MS);
  }
  throw new Error(`OKX deposit ${transactionHash} settlement timeout`);
}

export async function executeCoinbaseToOkxTransfer(input: {
  transferIdentity: string;
  prepared: CoinbaseToOkxPreparedTransfer;
}): Promise<CoinbaseToOkxSettlement> {
  const startedAt = Date.now();
  const idem = deterministicCoinbaseTransferIdempotencyKey(`cryptocrawl:coinbase-to-okx:${input.transferIdentity}:${input.prepared.asset}:${input.prepared.desiredNet}`);
  const sent = await sendCoinbaseCrypto({
    asset: input.prepared.asset,
    amount: numericString(input.prepared.desiredNet),
    to: input.prepared.okxAddress,
    network: input.prepared.network,
    idempotencyKey: idem,
  });
  const terminal = await waitCoinbaseSend(sent.accountId, sent.transactionId);
  if (!terminal.transactionHash || !/^0x[0-9a-fA-F]{64}$/.test(terminal.transactionHash)) {
    throw new Error('Coinbase completed send did not expose an Ethereum transaction hash');
  }
  if (terminal.destinationAddress && terminal.destinationAddress.toLowerCase() !== input.prepared.okxAddress) {
    throw new Error('Coinbase completed send destination differs from authenticated OKX deposit address');
  }
  if (terminal.network && terminal.network !== 'ethereum') {
    throw new Error(`Coinbase completed send used unexpected network ${terminal.network}`);
  }
  if (terminal.debitAsset !== input.prepared.asset) {
    throw new Error(`Coinbase completed send debited ${terminal.debitAsset || 'unknown'} instead of ${input.prepared.asset}`);
  }
  const sourceDebit = finitePositive(terminal.debitAmount);
  if (sourceDebit === null || sourceDebit > input.prepared.sourceReservationCeiling + 1e-12) {
    throw new Error('Coinbase authenticated source debit exceeds the provenance-backed reservation ceiling');
  }
  const fee = finitePositive(terminal.networkFeeAmount) || 0;
  if (fee > 0 && terminal.networkFeeAsset && terminal.networkFeeAsset !== input.prepared.asset) {
    throw new Error(`Coinbase network fee used ${terminal.networkFeeAsset}; multi-asset treasury fee provenance is not yet authorized`);
  }
  if (fee > sourceDebit + 1e-12) throw new Error('Coinbase authenticated network fee exceeds source debit');

  const deposit = await waitOkxDeposit(input.prepared, terminal.transactionHash);
  const delivered = finitePositive(deposit?.amt);
  if (delivered === null || delivered + 1e-12 < input.prepared.desiredNet) {
    throw new Error('OKX credited less than the persisted Coinbase payout/treasury target');
  }

  const latencyMs = Date.now() - startedAt;
  const stableFeeUsd = ['USDC', 'USDT'].includes(input.prepared.asset) ? fee : undefined;
  const learning = getCryptaraVenueSpecializationLearning();
  for (const role of ['treasury_transfer', 'payout_funding'] as const) {
    learning.record({
      venue: 'coinbase',
      role,
      terminal: true,
      success: true,
      observedAt: Date.now(),
      latencyMs,
      realizedCostUsd: stableFeeUsd,
      evidenceReference: terminal.transactionId,
      provenance: [
        'coinbase_authenticated_completed_send',
        'coinbase_idempotent_transfer_identity',
        'okx_authenticated_terminal_deposit',
      ],
    });
  }
  learning.record({
    venue: 'okx',
    role: 'payout_funding',
    terminal: true,
    success: true,
    observedAt: Date.now(),
    latencyMs,
    evidenceReference: String(deposit?.depId || deposit?.txId || terminal.transactionHash),
    provenance: [
      'okx_authenticated_terminal_deposit',
      'coinbase_authenticated_completed_send',
      'ethereum_transaction_hash_reconciled',
    ],
  });

  return {
    sourceDebitDecimal: sourceDebit,
    deliveredDecimal: delivered,
    sourceFeeDecimal: fee,
    withdrawalReference: terminal.transactionId,
    transactionHash: terminal.transactionHash.toLowerCase(),
    destinationReference: String(deposit?.depId || deposit?.txId || terminal.transactionHash),
    sourceEvidence: {
      venue: 'coinbase', accountId: terminal.accountId, transactionId: terminal.transactionId,
      idempotencyKey: idem, status: terminal.status, networkStatus: terminal.networkStatus,
      network: terminal.network, authenticatedDebitAmount: sourceDebit,
      authenticatedNetworkFeeAmount: fee, authenticatedNetworkFeeAsset: terminal.networkFeeAsset,
      sourceReservationCeiling: input.prepared.sourceReservationCeiling,
      operatorBalanceAuthorityGranted: false,
    },
    destinationEvidence: {
      venue: 'okx', chain: input.prepared.okxChain, depositAddress: input.prepared.okxAddress,
      depositAccount: input.prepared.okxDepositAccount, exchangeState: String(deposit?.state ?? ''),
      creditedAmount: delivered, transactionHash: terminal.transactionHash.toLowerCase(),
    },
  };
}
