import { createHash, createHmac } from 'crypto';
import logger from '../../../logger.js';
import { pool, isDatabaseConfigured } from '../runtime/cryptocrawl-runtime-database.js';
import { resolvePayoutFallbackAddress, resolvePrimaryProfitPayoutAddress } from '../core/wallet-identity.js';
import { withCryptaraSupabasePriority } from '../integration/cryptara-supabase-admission-worker.js';

const INTERVAL_MS = 15_000;
const OKX_BASE_URL = 'https://us.okx.com';
const PRIMARY_DESTINATION = resolvePrimaryProfitPayoutAddress() || '';
const FALLBACK_DESTINATION = resolvePayoutFallbackAddress() || '';
const ETHEREUM_RPC_URL = (
  process.env.ETHEREUM_RPC_URL
  || process.env.ETHEREM_RPC_URL
  || (process.env.ALCHEMY_API_KEY ? `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}` : '')
).trim();

type DestinationMode = 'primary' | 'fallback';

interface PendingBatch {
  batch_id: string;
  payout_amount_eth: string | number;
  withdrawal_id: string | null;
  withdrawal_client_id: string | null;
  transaction_hash: string | null;
  destination_hash: string;
  destination_mode: DestinationMode;
}

interface PendingTerminalLeg {
  leg_id: string;
  amount: string | number;
  withdrawal_id: string | null;
  client_id: string | null;
  transaction_hash: string | null;
  destination_hash: string;
  destination_mode: DestinationMode;
}

interface ProofTarget {
  amountEth: string | number;
  withdrawalId: string | null;
  clientId: string | null;
  transactionHash: string | null;
  destinationMode: DestinationMode;
}

interface RecipientProof {
  destinationHash: string;
  amountEth: number;
  transactionHash: string;
  blockNumber: string;
}

function destinationFor(mode: DestinationMode): string {
  if (mode === 'fallback') return FALLBACK_DESTINATION;
  return PRIMARY_DESTINATION;
}

function batchTarget(batch: PendingBatch): ProofTarget {
  return {
    amountEth: batch.payout_amount_eth,
    withdrawalId: batch.withdrawal_id,
    clientId: batch.withdrawal_client_id,
    transactionHash: batch.transaction_hash,
    destinationMode: batch.destination_mode,
  };
}

function terminalLegTarget(leg: PendingTerminalLeg): ProofTarget {
  return {
    amountEth: leg.amount,
    withdrawalId: leg.withdrawal_id,
    clientId: leg.client_id,
    transactionHash: leg.transaction_hash,
    destinationMode: leg.destination_mode,
  };
}

function sameAddress(a: unknown, b: unknown): boolean {
  const left = String(a || '').trim().toLowerCase();
  const right = String(b || '').trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(left) && left === right;
}

function ethereumMainnetChain(chain: unknown): boolean {
  const normalized = String(chain || '').trim().toLowerCase();
  if (!normalized) return false;
  if (['arbitrum', 'optimism', 'base', 'polygon', 'bsc', 'zksync', 'linea', 'scroll'].some(name => normalized.includes(name))) return false;
  return normalized.includes('erc20') || normalized.includes('ethereum');
}

function decimalEthToWei(value: unknown): bigint {
  const raw = String(value ?? '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`invalid ETH amount ${raw || 'empty'}`);
  const [whole, fraction = ''] = raw.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.slice(0, 18).padEnd(18, '0') || '0');
}

function destinationFingerprint(address: string): string {
  return createHash('sha256').update(address.toLowerCase()).digest('hex').slice(0, 16);
}

async function okxWithdrawalHistory(target: ProofTarget): Promise<any | null> {
  const apiKey = (process.env.OKX_API_KEY || '').trim();
  const apiSecret = (process.env.OKX_API_SECRET || '').trim();
  const passphrase = (process.env.OKX_API_PASSPHRASE || '').trim();
  if (!apiKey || !apiSecret || !passphrase) throw new Error('OKX read credentials unavailable for payout confirmation');

  const query = target.withdrawalId
    ? new URLSearchParams({ wdId: target.withdrawalId }).toString()
    : new URLSearchParams({ clientId: target.clientId || '' }).toString();
  if (!query || query.endsWith('=')) return null;

  const path = `/api/v5/asset/withdrawal-history?${query}`;
  const timestamp = new Date().toISOString();
  const signature = createHmac('sha256', apiSecret).update(`${timestamp}GET${path}`).digest('base64');
  const response = await fetch(`${OKX_BASE_URL}${path}`, {
    headers: {
      'OK-ACCESS-KEY': apiKey,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': passphrase,
      'Content-Type': 'application/json',
    },
  });
  const body: any = await response.json().catch(() => null);
  if (!response.ok || String(body?.code ?? '') !== '0') {
    throw new Error(`OKX withdrawal-history read failed (${response.status}/${String(body?.code ?? 'unknown')})`);
  }
  const rows = Array.isArray(body?.data) ? body.data : [];
  return rows.find((row: any) => target.withdrawalId
    ? String(row?.wdId || '') === target.withdrawalId
    : String(row?.clientId || '') === target.clientId) || rows[0] || null;
}

async function ethereumRpc(method: string, params: unknown[]): Promise<any> {
  if (!/^https:\/\//i.test(ETHEREUM_RPC_URL)) throw new Error('Ethereum payout confirmation RPC unavailable');
  const response = await fetch(ETHEREUM_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body: any = await response.json().catch(() => null);
  if (!response.ok || !body || body.error) throw new Error(`Ethereum payout confirmation RPC ${method} failed`);
  return body.result;
}

async function verifyTarget(target: ProofTarget, label: string): Promise<RecipientProof | null> {
  const destination = destinationFor(target.destinationMode);
  if (!/^0x[0-9a-fA-F]{40}$/.test(destination)) {
    throw new Error(`${label} ${target.destinationMode} destination unavailable`);
  }

  const record = await okxWithdrawalHistory(target);
  if (!record) return null;
  const state = String(record.state ?? '');
  if (state !== '2') return null;

  const txId = String(record.txId || target.transactionHash || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(txId)) return null;
  if (String(record.ccy || '').toUpperCase() !== 'ETH') throw new Error('recipient mismatch: completed withdrawal is not ETH');
  if (!ethereumMainnetChain(record.chain)) throw new Error('recipient mismatch: completed withdrawal is not Ethereum mainnet');
  if (!sameAddress(record.to, destination)) throw new Error('recipient mismatch: OKX receiving address differs from intended payout address');

  const expectedWei = decimalEthToWei(target.amountEth);
  if (decimalEthToWei(record.amt) !== expectedWei) throw new Error('amount mismatch: OKX withdrawal differs from payout obligation');

  const [transaction, receipt, finalized] = await Promise.all([
    ethereumRpc('eth_getTransactionByHash', [txId]),
    ethereumRpc('eth_getTransactionReceipt', [txId]),
    ethereumRpc('eth_getBlockByNumber', ['finalized', false]),
  ]);
  if (!transaction || !receipt || !finalized) return null;
  if (String(receipt.status || '').toLowerCase() !== '0x1') throw new Error('payout Ethereum transaction failed');
  if (!sameAddress(transaction.to, destination)) throw new Error('transaction recipient mismatch: Ethereum transaction does not pay intended wallet');
  if (BigInt(String(transaction.value || '0x0')) < expectedWei) throw new Error('amount mismatch: Ethereum transaction value below payout obligation');

  const receiptBlock = BigInt(String(receipt.blockNumber || '0x0'));
  const finalizedBlock = BigInt(String(finalized.number || '0x0'));
  if (receiptBlock <= 0n || finalizedBlock < receiptBlock) return null;

  return {
    destinationHash: destinationFingerprint(destination),
    amountEth: Number(target.amountEth),
    transactionHash: txId,
    blockNumber: String(receipt.blockNumber),
  };
}

async function markBatchManualReview(batchId: string, message: string): Promise<void> {
  await withCryptaraSupabasePriority('critical', () => pool.query(
    `UPDATE public.cryptocrawler_profit_payout_batches
     SET status='MANUAL_REVIEW', last_error=$2, updated_at=now()
     WHERE batch_id=$1 AND status='SUBMITTED'`,
    [batchId, message.slice(0, 1000)],
  ));
}

async function markTerminalLegManualReview(legId: string, message: string): Promise<void> {
  await withCryptaraSupabasePriority('critical', () => pool.query(
    `UPDATE public.cryptocrawler_terminal_sweep_legs
     SET status='MANUAL_REVIEW', last_error=$2, updated_at=now()
     WHERE leg_id=$1::uuid AND status='SUBMITTED'`,
    [legId, message.slice(0, 1000)],
  ));
}

function proofFailureIsTerminal(message: string): boolean {
  return /recipient mismatch|amount mismatch|transaction recipient mismatch|transaction failed/i.test(message);
}

class PayoutRecipientConfirmationObserver {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    if (!this.inFlight) {
      this.inFlight = this.reconcile().finally(() => { this.inFlight = null; });
    }
    try {
      await this.inFlight;
    } catch (error) {
      logger.warn('[Treasury] Recipient confirmation observer deferred', {
        component: 'PayoutRecipientConfirmationObserver',
        error: error instanceof Error ? error.message : String(error),
        moneyMovingAuthority: false,
      });
    } finally {
      if (!this.running) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.tick();
      }, INTERVAL_MS);
      this.timer.unref?.();
    }
  }

  private async reconcile(): Promise<void> {
    if (!isDatabaseConfigured || !PRIMARY_DESTINATION || !ETHEREUM_RPC_URL) return;
    await this.reconcilePayoutBatches();
    await this.reconcileTerminalSweepLegs();
  }

  private async reconcilePayoutBatches(): Promise<void> {
    const result = await withCryptaraSupabasePriority('high', () => pool.query(
      `SELECT batch_id, payout_amount_eth, withdrawal_id, withdrawal_client_id,
              transaction_hash, destination_hash, destination_mode
       FROM public.cryptocrawler_profit_payout_batches
       WHERE status='SUBMITTED'
         AND recipient_confirmed_at IS NULL
       ORDER BY submitted_at ASC NULLS LAST, created_at ASC
       LIMIT 8`,
    ));

    for (const row of result.rows as PendingBatch[]) {
      try {
        const proof = await verifyTarget(batchTarget(row), 'payout');
        if (!proof) continue;
        await withCryptaraSupabasePriority('critical', () => pool.query(
          `UPDATE public.cryptocrawler_profit_payout_batches
           SET destination_hash=$2,
               recipient_confirmed_destination_hash=$2,
               recipient_confirmed_amount_eth=$3,
               recipient_confirmed_transaction_hash=$4,
               recipient_confirmed_block_number=$5,
               recipient_confirmation_source='okx_withdrawal_history+ethereum_finalized_rpc',
               recipient_confirmed_at=now(),
               last_error=NULL,
               updated_at=now()
           WHERE batch_id=$1 AND status='SUBMITTED' AND recipient_confirmed_at IS NULL`,
          [row.batch_id, proof.destinationHash, proof.amountEth, proof.transactionHash, proof.blockNumber],
        ));
        logger.info('[Treasury] Payout recipient independently confirmed', {
          component: 'PayoutRecipientConfirmationObserver',
          batchId: row.batch_id,
          destinationMode: row.destination_mode,
          amountEth: proof.amountEth,
          transactionHash: `${proof.transactionHash.slice(0, 10)}...`,
          ethereumFinalized: true,
          moneyMovingAuthority: false,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (proofFailureIsTerminal(message)) {
          await markBatchManualReview(row.batch_id, `Recipient confirmation failed closed: ${message}`);
        } else {
          logger.debug('[Treasury] Payout recipient proof not ready', {
            component: 'PayoutRecipientConfirmationObserver',
            batchId: row.batch_id,
            error: message,
          });
        }
      }
    }
  }

  private async reconcileTerminalSweepLegs(): Promise<void> {
    const result = await withCryptaraSupabasePriority('high', () => pool.query(
      `SELECT leg_id::text, amount, withdrawal_id, client_id,
              transaction_hash, destination_hash, destination_mode
       FROM public.cryptocrawler_terminal_sweep_legs
       WHERE status='SUBMITTED'
         AND asset='ETH'
         AND recipient_confirmed_at IS NULL
       ORDER BY submitted_at ASC NULLS LAST, created_at ASC
       LIMIT 8`,
    ));

    for (const row of result.rows as PendingTerminalLeg[]) {
      try {
        const proof = await verifyTarget(terminalLegTarget(row), 'terminal sweep');
        if (!proof) continue;
        await withCryptaraSupabasePriority('critical', () => pool.query(
          `UPDATE public.cryptocrawler_terminal_sweep_legs
           SET destination_hash=$2,
               recipient_confirmed_destination_hash=$2,
               recipient_confirmed_amount_eth=$3,
               recipient_confirmed_transaction_hash=$4,
               recipient_confirmed_block_number=$5,
               recipient_confirmation_source='okx_withdrawal_history+ethereum_finalized_rpc',
               recipient_confirmed_at=now(),
               last_error=NULL,
               updated_at=now()
           WHERE leg_id=$1::uuid AND status='SUBMITTED' AND recipient_confirmed_at IS NULL`,
          [row.leg_id, proof.destinationHash, proof.amountEth, proof.transactionHash, proof.blockNumber],
        ));
        logger.info('[Treasury] Terminal sweep recipient independently confirmed', {
          component: 'PayoutRecipientConfirmationObserver',
          legId: row.leg_id,
          destinationMode: row.destination_mode,
          amountEth: proof.amountEth,
          transactionHash: `${proof.transactionHash.slice(0, 10)}...`,
          ethereumFinalized: true,
          moneyMovingAuthority: false,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (proofFailureIsTerminal(message)) {
          await markTerminalLegManualReview(row.leg_id, `Recipient confirmation failed closed: ${message}`);
        } else {
          logger.debug('[Treasury] Terminal sweep recipient proof not ready', {
            component: 'PayoutRecipientConfirmationObserver',
            legId: row.leg_id,
            error: message,
          });
        }
      }
    }
  }
}

export const payoutRecipientConfirmationObserver = new PayoutRecipientConfirmationObserver();
