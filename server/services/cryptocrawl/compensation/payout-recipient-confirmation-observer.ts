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

interface PendingBatch {
  batch_id: string;
  payout_amount_eth: string | number;
  withdrawal_id: string | null;
  withdrawal_client_id: string | null;
  transaction_hash: string | null;
  destination_hash: string;
  destination_mode: 'primary' | 'fallback';
}

function destinationFor(batch: PendingBatch): string {
  if (batch.destination_mode === 'fallback') return FALLBACK_DESTINATION;
  return PRIMARY_DESTINATION;
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

async function okxWithdrawalHistory(batch: PendingBatch): Promise<any | null> {
  const apiKey = (process.env.OKX_API_KEY || '').trim();
  const apiSecret = (process.env.OKX_API_SECRET || '').trim();
  const passphrase = (process.env.OKX_API_PASSPHRASE || '').trim();
  if (!apiKey || !apiSecret || !passphrase) throw new Error('OKX read credentials unavailable for payout confirmation');

  const query = batch.withdrawal_id
    ? new URLSearchParams({ wdId: batch.withdrawal_id }).toString()
    : new URLSearchParams({ clientId: batch.withdrawal_client_id || '' }).toString();
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
  return rows.find((row: any) => batch.withdrawal_id
    ? String(row?.wdId || '') === batch.withdrawal_id
    : String(row?.clientId || '') === batch.withdrawal_client_id) || rows[0] || null;
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

async function verifyBatch(batch: PendingBatch): Promise<{
  destinationHash: string;
  amountEth: number;
  transactionHash: string;
  blockNumber: string;
} | null> {
  const destination = destinationFor(batch);
  if (!/^0x[0-9a-fA-F]{40}$/.test(destination)) throw new Error(`payout ${batch.destination_mode} destination unavailable`);

  const record = await okxWithdrawalHistory(batch);
  if (!record) return null;
  const state = String(record.state ?? '');
  if (state !== '2') return null;

  const txId = String(record.txId || batch.transaction_hash || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(txId)) return null;
  if (String(record.ccy || '').toUpperCase() !== 'ETH') throw new Error('recipient mismatch: completed withdrawal is not ETH');
  if (!ethereumMainnetChain(record.chain)) throw new Error('recipient mismatch: completed withdrawal is not Ethereum mainnet');
  if (!sameAddress(record.to, destination)) throw new Error('recipient mismatch: OKX receiving address differs from intended payout address');

  const expectedWei = decimalEthToWei(batch.payout_amount_eth);
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
    amountEth: Number(batch.payout_amount_eth),
    transactionHash: txId,
    blockNumber: String(receipt.blockNumber),
  };
}

async function markManualReview(batchId: string, message: string): Promise<void> {
  await withCryptaraSupabasePriority('critical', () => pool.query(
    `UPDATE public.cryptocrawler_profit_payout_batches
     SET status='MANUAL_REVIEW', last_error=$2, updated_at=now()
     WHERE batch_id=$1 AND status='SUBMITTED'`,
    [batchId, message.slice(0, 1000)],
  ));
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
        const proof = await verifyBatch(row);
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
        if (/recipient mismatch|amount mismatch|transaction recipient mismatch|transaction failed/i.test(message)) {
          await markManualReview(row.batch_id, `Recipient confirmation failed closed: ${message}`);
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
}

export const payoutRecipientConfirmationObserver = new PayoutRecipientConfirmationObserver();
