import { createHash } from 'crypto';
import { ethers } from 'ethers';
import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { terminalFeedbackIdentity } from '../learning/terminal-feedback-identity.js';
import { okxPrivateRequest } from '../intelligence/cex-private-authority.js';

const { isAddress } = ethers.utils;

const MIN_PAYOUT_USD = finiteEnv('CRYPTO_RAINBOW_MIN_PAYOUT_USD', 5, 0.01, 1_000_000);
const MAX_PAYOUT_USD = finiteEnv('CRYPTO_RAINBOW_MAX_PAYOUT_USD', 5_000, 1, 10_000_000);
const OPERATING_RESERVE_USD = finiteEnv('CRYPTO_RAINBOW_OPERATING_RESERVE_USD', 1_000, 0, 100_000_000);
const RECONCILE_INTERVAL_MS = finiteEnv('CRYPTO_RAINBOW_RECONCILE_INTERVAL_MS', 60_000, 10_000, 3_600_000);
const DESTINATION = (process.env.CRYPTO_PROFIT_WALLET_ADDRESS || '').trim();
const PREFERRED_STABLES = [...new Set((process.env.CRYPTO_RAINBOW_PAYOUT_ASSETS || 'USDT,USDC')
  .split(',').map(value => value.trim().toUpperCase()).filter(value => value === 'USDT' || value === 'USDC'))];
const NETWORK_PREFERENCE = (process.env.CRYPTO_RAINBOW_EVM_NETWORKS || 'Arbitrum,Base,Optimism,Polygon,BSC,ERC20,Ethereum')
  .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);

function finiteEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
}

function addressFingerprint(address: string): string {
  return createHash('sha256').update(address.toLowerCase()).digest('hex').slice(0, 16);
}

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function matchesPreferredNetwork(chain: string): number {
  const normalized = chain.toLowerCase();
  for (let index = 0; index < NETWORK_PREFERENCE.length; index += 1) {
    if (normalized.includes(NETWORK_PREFERENCE[index])) return index;
  }
  return Number.POSITIVE_INFINITY;
}

interface OkxWithdrawalRoute {
  asset: 'USDT' | 'USDC';
  chain: string;
  fee: number;
  minWithdrawal: number;
  maxWithdrawal: number;
}

interface PendingEvent {
  eventId: string;
  realizedProfitUsd: number;
}

class RainbowProfitBridge {
  private ready: Promise<void> | null = null;
  private flushInFlight: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), RECONCILE_INTERVAL_MS);
    this.timer.unref?.();
    void this.flush();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async recordTerminalSettlement(feedback: CryptaraExecutionFeedback): Promise<void> {
    if (!feedback.settlement || feedback.settlement.terminal !== true || feedback.settlement.settlementConfirmed !== true) return;
    const realized = finitePositive(feedback.realizedProfitUsd ?? feedback.settlement.realized.netProfitUsd);
    if (feedback.success !== true || realized === null) return;
    if (!this.destinationReady()) return;
    await this.ensureStore();
    const eventId = terminalFeedbackIdentity(feedback);
    await pool.query(
      `INSERT INTO private.cryptocrawler_rainbow_profit_events
        (event_id, opportunity_id, realized_profit_usd, status, destination_hash, created_at, updated_at)
       VALUES ($1, $2, $3, 'queued', $4, now(), now())
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, feedback.opportunityId || null, realized, addressFingerprint(DESTINATION)],
    );
    this.start();
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushInFlight) return this.flushInFlight;
    this.flushInFlight = this.flushOnce().finally(() => { this.flushInFlight = null; });
    return this.flushInFlight;
  }

  private destinationReady(): boolean {
    if (!DESTINATION || !isAddress(DESTINATION)) {
      logger.warn('[RainbowBridge] Profit payout destination is unavailable or invalid', {
        component: 'RainbowProfitBridge',
        configured: Boolean(DESTINATION),
      });
      return false;
    }
    return true;
  }

  private async ensureStore(): Promise<void> {
    if (!isDatabaseConfigured) throw new Error('Rainbow Bridge requires persistent DATABASE_URL for idempotent payouts');
    if (this.ready) return this.ready;
    this.ready = (async () => {
      await pool.query('CREATE SCHEMA IF NOT EXISTS private');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS private.cryptocrawler_rainbow_profit_events (
          event_id text PRIMARY KEY,
          opportunity_id text,
          realized_profit_usd numeric NOT NULL CHECK (realized_profit_usd > 0),
          status text NOT NULL CHECK (status IN ('queued','submitted','confirmed','failed')),
          batch_id text,
          asset text,
          chain text,
          payout_amount numeric,
          payout_fee numeric,
          withdrawal_id text,
          transaction_hash text,
          destination_hash text NOT NULL,
          last_error text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          confirmed_at timestamptz
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_rainbow_profit_status ON private.cryptocrawler_rainbow_profit_events(status, created_at)');
    })().catch(error => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private async flushOnce(): Promise<void> {
    if (!this.destinationReady() || !isDatabaseConfigured) return;
    await this.ensureStore();
    await this.reconcileSubmitted();

    const pending = await pool.query(
      `SELECT event_id, realized_profit_usd
       FROM private.cryptocrawler_rainbow_profit_events
       WHERE status = 'queued'
       ORDER BY created_at ASC
       LIMIT 250`,
    );
    const events: PendingEvent[] = pending.rows.map(row => ({
      eventId: String(row.event_id),
      realizedProfitUsd: Number(row.realized_profit_usd),
    })).filter(row => Number.isFinite(row.realizedProfitUsd) && row.realizedProfitUsd > 0);
    if (events.length === 0) return;

    const routes = await this.discoverOkxRoutes();
    if (routes.length === 0) return;
    const route = routes[0];
    const payoutCapacity = Math.max(0, Math.min(MAX_PAYOUT_USD, route.maxWithdrawal - OPERATING_RESERVE_USD));
    if (payoutCapacity < Math.max(MIN_PAYOUT_USD, route.minWithdrawal + route.fee)) return;

    const selected: PendingEvent[] = [];
    let amount = 0;
    for (const event of events) {
      if (amount + event.realizedProfitUsd > payoutCapacity) break;
      selected.push(event);
      amount += event.realizedProfitUsd;
    }
    amount = Number(amount.toFixed(6));
    if (selected.length === 0 || amount < Math.max(MIN_PAYOUT_USD, route.minWithdrawal)) return;

    const batchId = `rainbow_${Date.now()}_${createHash('sha256').update(selected.map(item => item.eventId).join('|')).digest('hex').slice(0, 12)}`;
    const clientId = createHash('sha256').update(batchId).digest('hex').slice(0, 32);
    const ids = selected.map(item => item.eventId);

    const claim = await pool.query(
      `UPDATE private.cryptocrawler_rainbow_profit_events
       SET status='submitted', batch_id=$1, asset=$2, chain=$3, payout_amount=$4, payout_fee=$5, updated_at=now()
       WHERE event_id = ANY($6::text[]) AND status='queued'
       RETURNING event_id`,
      [batchId, route.asset, route.chain, amount, route.fee, ids],
    );
    if (claim.rowCount !== ids.length) {
      await pool.query(
        `UPDATE private.cryptocrawler_rainbow_profit_events SET status='queued', batch_id=NULL, asset=NULL, chain=NULL, payout_amount=NULL, payout_fee=NULL, updated_at=now()
         WHERE batch_id=$1 AND withdrawal_id IS NULL`,
        [batchId],
      );
      return;
    }

    try {
      const response = await okxPrivateRequest('/api/v5/asset/withdrawal', 'POST', {
        amt: amount.toFixed(6),
        fee: String(route.fee),
        dest: '4',
        ccy: route.asset,
        chain: route.chain,
        toAddr: DESTINATION,
        clientId,
      }, { lane: 'account_read', timeoutMs: 20_000 });
      const withdrawalId = String(response.data[0]?.wdId || '');
      if (!withdrawalId) throw new Error('OKX withdrawal accepted without wdId');
      await pool.query(
        `UPDATE private.cryptocrawler_rainbow_profit_events
         SET withdrawal_id=$1, updated_at=now(), last_error=NULL
         WHERE batch_id=$2`,
        [withdrawalId, batchId],
      );
      logger.info('[RainbowBridge] Realized-profit payout submitted', {
        component: 'RainbowProfitBridge',
        batchId,
        asset: route.asset,
        chain: route.chain,
        amount,
        fee: route.fee,
        eventCount: ids.length,
        destination: addressFingerprint(DESTINATION),
        withdrawalId,
      });
    } catch (error) {
      await pool.query(
        `UPDATE private.cryptocrawler_rainbow_profit_events
         SET status='queued', batch_id=NULL, asset=NULL, chain=NULL, payout_amount=NULL, payout_fee=NULL, withdrawal_id=NULL,
             last_error=$1, updated_at=now()
         WHERE batch_id=$2`,
        [error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500), batchId],
      );
      logger.warn('[RainbowBridge] Payout route unavailable; realized profit remains queued', {
        component: 'RainbowProfitBridge',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async discoverOkxRoutes(): Promise<OkxWithdrawalRoute[]> {
    const routes: OkxWithdrawalRoute[] = [];
    for (const asset of PREFERRED_STABLES) {
      try {
        const [currencyResponse, maxResponse] = await Promise.all([
          okxPrivateRequest('/api/v5/asset/currencies', 'GET', { ccy: asset }, { lane: 'account_read' }),
          okxPrivateRequest('/api/v5/account/max-withdrawal', 'GET', { ccy: asset }, { lane: 'account_read' }),
        ]);
        const maxWithdrawal = finitePositive(maxResponse.data.find(item => String(item?.ccy || '').toUpperCase() === asset)?.maxWd) || 0;
        for (const item of currencyResponse.data) {
          const chain = String(item?.chain || '');
          const networkRank = matchesPreferredNetwork(chain);
          const fee = finitePositive(item?.fee);
          const minWithdrawal = finitePositive(item?.minWd) || 0;
          if (!chain || !Number.isFinite(networkRank) || item?.canWd === false || String(item?.canWd).toLowerCase() === 'false' || fee === null || maxWithdrawal <= 0) continue;
          routes.push({ asset: asset as 'USDT' | 'USDC', chain, fee, minWithdrawal, maxWithdrawal });
        }
      } catch (error) {
        logger.debug('[RainbowBridge] OKX payout asset unavailable', {
          component: 'RainbowProfitBridge',
          asset,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return routes.sort((left, right) => {
      const leftRank = matchesPreferredNetwork(left.chain);
      const rightRank = matchesPreferredNetwork(right.chain);
      const leftCost = left.fee + leftRank * 0.000001;
      const rightCost = right.fee + rightRank * 0.000001;
      return leftCost - rightCost;
    });
  }

  private async reconcileSubmitted(): Promise<void> {
    const submitted = await pool.query(
      `SELECT DISTINCT withdrawal_id FROM private.cryptocrawler_rainbow_profit_events
       WHERE status='submitted' AND withdrawal_id IS NOT NULL LIMIT 50`,
    );
    for (const row of submitted.rows) {
      const withdrawalId = String(row.withdrawal_id || '');
      if (!withdrawalId) continue;
      try {
        const response = await okxPrivateRequest('/api/v5/asset/withdrawal-history', 'GET', { wdId: withdrawalId }, { lane: 'account_read' });
        const record = response.data.find(item => String(item?.wdId || '') === withdrawalId);
        if (!record) continue;
        const state = String(record.state ?? '');
        if (state === '2') {
          await pool.query(
            `UPDATE private.cryptocrawler_rainbow_profit_events
             SET status='confirmed', transaction_hash=$1, confirmed_at=now(), updated_at=now(), last_error=NULL
             WHERE withdrawal_id=$2`,
            [String(record.txId || ''), withdrawalId],
          );
          logger.info('[RainbowBridge] Realized-profit payout confirmed', {
            component: 'RainbowProfitBridge',
            withdrawalId,
            chain: String(record.chain || ''),
            asset: String(record.ccy || ''),
            transactionHashPresent: Boolean(record.txId),
            destination: addressFingerprint(DESTINATION),
          });
        } else if (state === '-1' || state === '-2') {
          await pool.query(
            `UPDATE private.cryptocrawler_rainbow_profit_events
             SET status='queued', batch_id=NULL, asset=NULL, chain=NULL, payout_amount=NULL, payout_fee=NULL, withdrawal_id=NULL,
                 last_error=$1, updated_at=now()
             WHERE withdrawal_id=$2`,
            [`OKX withdrawal terminal state ${state}`, withdrawalId],
          );
        }
      } catch (error) {
        logger.debug('[RainbowBridge] Withdrawal reconciliation deferred', {
          component: 'RainbowProfitBridge',
          withdrawalId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

export const rainbowProfitBridge = new RainbowProfitBridge();
