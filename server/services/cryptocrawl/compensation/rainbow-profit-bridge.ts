import { createHash } from 'crypto';
import { ethers } from 'ethers';
import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { cexInventoryLedger } from '../execution/cex-inventory-ledger.js';
import { terminalFeedbackIdentity } from '../learning/terminal-feedback-identity.js';
import { okxPrivateRequest } from '../intelligence/cex-private-authority.js';

const { isAddress } = ethers.utils;

const MIN_PAYOUT_USD = finiteEnv('CRYPTO_RAINBOW_MIN_PAYOUT_USD', 5, 0.01, 1_000_000);
const MAX_PAYOUT_USD = finiteEnv('CRYPTO_RAINBOW_MAX_PAYOUT_USD', 5_000, 1, 10_000_000);
const OPERATING_RESERVE_USD = finiteEnv('CRYPTO_RAINBOW_OPERATING_RESERVE_USD', 1_000, 0, 100_000_000);
const INVENTORY_MAX_AGE_MS = finiteEnv('CRYPTO_RAINBOW_INVENTORY_MAX_AGE_MS', 60_000, 5_000, 600_000);
const MAX_FEE_FRACTION = finiteEnv('CRYPTO_RAINBOW_MAX_FEE_FRACTION', 0.01, 0.0001, 0.25);
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

function finiteNonNegative(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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
  private lastDeferralSignature = '';

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
          client_id text,
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
      await pool.query('ALTER TABLE private.cryptocrawler_rainbow_profit_events ADD COLUMN IF NOT EXISTS client_id text');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_rainbow_profit_status ON private.cryptocrawler_rainbow_profit_events(status, created_at)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_rainbow_profit_client ON private.cryptocrawler_rainbow_profit_events(client_id) WHERE client_id IS NOT NULL');
    })().catch(error => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private inventoryAwarePayoutCapacity(route: OkxWithdrawalRoute): { capacity: number; authority: 'live_inventory' | 'configured_fallback' } {
    const fallback = Math.max(0, Math.min(MAX_PAYOUT_USD, route.maxWithdrawal - OPERATING_RESERVE_USD));
    const snapshot = cexInventoryLedger.getSnapshots().find(item => item.venue === 'okx' && item.asset === route.asset);
    if (!snapshot || Date.now() - snapshot.lastReconciliationAt > INVENTORY_MAX_AGE_MS) {
      return { capacity: fallback, authority: 'configured_fallback' };
    }

    const protectedTarget = Math.max(
      OPERATING_RESERVE_USD,
      snapshot.minimumReserve,
      snapshot.target ?? 0,
    );
    const spendable = snapshot.available
      - snapshot.reserved
      - snapshot.pendingOrder
      - snapshot.pendingTransfer
      - protectedTarget;
    return {
      capacity: Math.max(0, Math.min(MAX_PAYOUT_USD, route.maxWithdrawal, spendable)),
      authority: 'live_inventory',
    };
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
    const payoutCapacityState = this.inventoryAwarePayoutCapacity(route);
    const payoutCapacity = payoutCapacityState.capacity;
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

    const feeFraction = amount > 0 ? route.fee / amount : Number.POSITIVE_INFINITY;
    if (route.fee > 0 && feeFraction > MAX_FEE_FRACTION) {
      const signature = `${route.asset}:${route.chain}:${route.fee}:${amount.toFixed(2)}`;
      if (signature !== this.lastDeferralSignature) {
        this.lastDeferralSignature = signature;
        logger.info('[RainbowBridge] Payout deferred to preserve realized profit', {
          component: 'RainbowProfitBridge',
          queuedProfitUsd: amount,
          asset: route.asset,
          chain: route.chain,
          withdrawalFee: route.fee,
          feeFraction,
          maxFeeFraction: MAX_FEE_FRACTION,
          inventoryAuthority: payoutCapacityState.authority,
          action: 'accumulate_more_profit',
        });
      }
      return;
    }
    this.lastDeferralSignature = '';

    const batchId = `rainbow_${Date.now()}_${createHash('sha256').update(selected.map(item => item.eventId).join('|')).digest('hex').slice(0, 12)}`;
    const clientId = createHash('sha256').update(batchId).digest('hex').slice(0, 32);
    const ids = selected.map(item => item.eventId);

    const claim = await pool.query(
      `UPDATE private.cryptocrawler_rainbow_profit_events
       SET status='submitted', batch_id=$1, client_id=$2, asset=$3, chain=$4, payout_amount=$5, payout_fee=$6, updated_at=now()
       WHERE event_id = ANY($7::text[]) AND status='queued'
       RETURNING event_id`,
      [batchId, clientId, route.asset, route.chain, amount, route.fee, ids],
    );
    if (claim.rowCount !== ids.length) {
      await releaseUnsentBatch(batchId, 'Concurrent payout claim changed before submission');
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
      await this.bindWithdrawal(batchId, withdrawalId);
      this.logSubmitted(batchId, withdrawalId, route, amount, ids.length, payoutCapacityState.authority);
    } catch (error) {
      const recovered = await this.recoverAmbiguousSubmission(clientId, batchId, route, amount, ids.length, payoutCapacityState.authority);
      if (recovered) return;
      await releaseUnsentBatch(batchId, error instanceof Error ? error.message : String(error));
      logger.warn('[RainbowBridge] Payout route unavailable; realized profit remains queued', {
        component: 'RainbowProfitBridge',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async bindWithdrawal(batchId: string, withdrawalId: string): Promise<void> {
    await pool.query(
      `UPDATE private.cryptocrawler_rainbow_profit_events
       SET withdrawal_id=$1, updated_at=now(), last_error=NULL
       WHERE batch_id=$2`,
      [withdrawalId, batchId],
    );
  }

  private logSubmitted(
    batchId: string,
    withdrawalId: string,
    route: OkxWithdrawalRoute,
    amount: number,
    eventCount: number,
    inventoryAuthority: 'live_inventory' | 'configured_fallback',
  ): void {
    logger.info('[RainbowBridge] Realized-profit payout submitted', {
      component: 'RainbowProfitBridge',
      batchId,
      asset: route.asset,
      chain: route.chain,
      amount,
      fee: route.fee,
      feeFraction: amount > 0 ? route.fee / amount : null,
      eventCount,
      inventoryAuthority,
      destination: addressFingerprint(DESTINATION),
      withdrawalId,
    });
  }

  private async recoverAmbiguousSubmission(
    clientId: string,
    batchId: string,
    route: OkxWithdrawalRoute,
    amount: number,
    eventCount: number,
    inventoryAuthority: 'live_inventory' | 'configured_fallback',
  ): Promise<boolean> {
    try {
      const history = await okxPrivateRequest('/api/v5/asset/withdrawal-history', 'GET', { clientId }, { lane: 'account_read' });
      const record = history.data.find(item => String(item?.clientId || '') === clientId);
      const withdrawalId = String(record?.wdId || '');
      if (!withdrawalId) return false;
      await this.bindWithdrawal(batchId, withdrawalId);
      this.logSubmitted(batchId, withdrawalId, route, amount, eventCount, inventoryAuthority);
      return true;
    } catch {
      await pool.query(
        `UPDATE private.cryptocrawler_rainbow_profit_events
         SET last_error='Ambiguous OKX withdrawal response; awaiting clientId reconciliation', updated_at=now()
         WHERE batch_id=$1`,
        [batchId],
      );
      return true;
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
          const fee = finiteNonNegative(item?.fee);
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
      `SELECT DISTINCT withdrawal_id, client_id FROM private.cryptocrawler_rainbow_profit_events
       WHERE status='submitted' AND (withdrawal_id IS NOT NULL OR client_id IS NOT NULL) LIMIT 50`,
    );
    for (const row of submitted.rows) {
      let withdrawalId = String(row.withdrawal_id || '');
      const clientId = String(row.client_id || '');
      try {
        const query = withdrawalId ? { wdId: withdrawalId } : { clientId };
        const response = await okxPrivateRequest('/api/v5/asset/withdrawal-history', 'GET', query, { lane: 'account_read' });
        const record = response.data.find(item => withdrawalId
          ? String(item?.wdId || '') === withdrawalId
          : String(item?.clientId || '') === clientId);
        if (!record) continue;
        if (!withdrawalId) {
          withdrawalId = String(record.wdId || '');
          if (withdrawalId) await this.bindWithdrawal(String((await pool.query(
            `SELECT batch_id FROM private.cryptocrawler_rainbow_profit_events WHERE client_id=$1 LIMIT 1`, [clientId],
          )).rows[0]?.batch_id || ''), withdrawalId);
        }
        const state = String(record.state ?? '');
        if (state === '2') {
          await pool.query(
            `UPDATE private.cryptocrawler_rainbow_profit_events
             SET status='confirmed', transaction_hash=$1, confirmed_at=now(), updated_at=now(), last_error=NULL
             WHERE withdrawal_id=$2 OR (withdrawal_id IS NULL AND client_id=$3)`,
            [String(record.txId || ''), withdrawalId, clientId],
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
             SET status='queued', batch_id=NULL, client_id=NULL, asset=NULL, chain=NULL, payout_amount=NULL, payout_fee=NULL, withdrawal_id=NULL,
                 last_error=$1, updated_at=now()
             WHERE withdrawal_id=$2 OR client_id=$3`,
            [`OKX withdrawal terminal state ${state}`, withdrawalId, clientId],
          );
        }
      } catch (error) {
        logger.debug('[RainbowBridge] Withdrawal reconciliation deferred', {
          component: 'RainbowProfitBridge',
          withdrawalId: withdrawalId || null,
          clientId: clientId || null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

async function releaseUnsentBatch(batchId: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE private.cryptocrawler_rainbow_profit_events
     SET status='queued', batch_id=NULL, client_id=NULL, asset=NULL, chain=NULL, payout_amount=NULL, payout_fee=NULL, withdrawal_id=NULL,
         last_error=$1, updated_at=now()
     WHERE batch_id=$2 AND withdrawal_id IS NULL`,
    [error.slice(0, 500), batchId],
  );
}

export const rainbowProfitBridge = new RainbowProfitBridge();
