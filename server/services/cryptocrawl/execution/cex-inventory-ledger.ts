import { randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';

export type InventoryVenue = 'kraken' | 'okx';

export interface InventoryRequirement {
  venue: InventoryVenue;
  asset: string;
  amount: number;
}

export interface InventorySnapshot {
  venue: InventoryVenue;
  asset: string;
  available: number;
  reserved: number;
  pendingOrder: number;
  pendingTransfer: number;
  target: number | null;
  minimumReserve: number;
  maximumVenueExposure: number | null;
  lastReconciliationAt: number;
}

export interface InventoryReservation {
  reservationId: string;
  opportunityId: string;
  requirements: InventoryRequirement[];
  acquiredAt: number;
  expiresAt: number;
  release: () => Promise<void>;
}

export interface InventoryRebalanceRecommendation {
  venue: InventoryVenue;
  asset: string;
  currentSpendable: number;
  target: number;
  delta: number;
  action: 'fund' | 'reduce';
  executable: false;
  reason: string;
}

const STATE_TABLE = 'cryptocrawler_cex_inventory_state_v1';
const RESERVATION_TABLE = 'cryptocrawler_cex_inventory_reservations_v1';

function finiteNonNegative(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function canonicalAsset(raw: string): string {
  let asset = raw.trim().toUpperCase().split('.')[0];
  if (asset === 'XBT' || asset === 'XXBT') return 'BTC';
  if (asset === 'XETH') return 'ETH';
  if (asset === 'ZUSD') return 'USD';
  if (/^[XZ][A-Z0-9]{3,}$/.test(asset)) asset = asset.slice(1);
  if (asset === 'XBT') return 'BTC';
  return asset;
}

function environmentNumber(prefix: string, venue: InventoryVenue, asset: string): number | null {
  const value = Number(process.env[`${prefix}_${venue.toUpperCase()}_${asset.toUpperCase()}`]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function cloneSnapshot(snapshot: InventorySnapshot): InventorySnapshot {
  return { ...snapshot };
}

class CexInventoryLedger {
  private readonly local = new Map<string, InventorySnapshot>();
  private readonly localReservations = new Map<string, InventoryRequirement[]>();
  private tableReady: Promise<boolean> | null = null;

  private key(venue: InventoryVenue, asset: string): string {
    return `${venue}:${canonicalAsset(asset)}`;
  }

  private policy(venue: InventoryVenue, asset: string) {
    const normalized = canonicalAsset(asset);
    return {
      target: environmentNumber('CRYPTOCRAWL_INVENTORY_TARGET', venue, normalized),
      minimumReserve: environmentNumber('CRYPTOCRAWL_INVENTORY_MIN_RESERVE', venue, normalized) ?? 0,
      maximumVenueExposure: environmentNumber('CRYPTOCRAWL_INVENTORY_MAX_EXPOSURE', venue, normalized),
    };
  }

  private async ensureTables(): Promise<boolean> {
    if (!isDatabaseConfigured) return false;
    if (this.tableReady) return this.tableReady;
    this.tableReady = (async () => {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
            venue text NOT NULL,
            asset text NOT NULL,
            available numeric NOT NULL,
            pending_order numeric NOT NULL DEFAULT 0,
            pending_transfer numeric NOT NULL DEFAULT 0,
            target numeric NULL,
            minimum_reserve numeric NOT NULL DEFAULT 0,
            maximum_venue_exposure numeric NULL,
            reconciled_at timestamptz NOT NULL,
            PRIMARY KEY (venue, asset)
          )
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS ${RESERVATION_TABLE} (
            reservation_id text NOT NULL,
            opportunity_id text NOT NULL,
            venue text NOT NULL,
            asset text NOT NULL,
            amount numeric NOT NULL,
            acquired_at timestamptz NOT NULL,
            expires_at timestamptz NOT NULL,
            PRIMARY KEY (reservation_id, venue, asset)
          )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS ${RESERVATION_TABLE}_active_idx ON ${RESERVATION_TABLE} (venue, asset, expires_at)`);
        return true;
      } catch (error) {
        logger.error('[InventoryLedger] Durable inventory tables unavailable; live reservation fails closed', {
          component: 'CexInventoryLedger',
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    })();
    return this.tableReady;
  }

  async reconcile(venue: InventoryVenue, rawBalances: Record<string, string | number>): Promise<InventorySnapshot[]> {
    const now = Date.now();
    const merged = new Map<string, number>();
    for (const [rawAsset, rawValue] of Object.entries(rawBalances)) {
      const asset = canonicalAsset(rawAsset);
      if (!asset) continue;
      const amount = Number(rawValue);
      if (!Number.isFinite(amount) || amount < 0) continue;
      merged.set(asset, (merged.get(asset) || 0) + amount);
    }

    for (const [asset, available] of merged) {
      const policy = this.policy(venue, asset);
      const key = this.key(venue, asset);
      const previous = this.local.get(key);
      this.local.set(key, {
        venue,
        asset,
        available,
        reserved: previous?.reserved || 0,
        pendingOrder: previous?.pendingOrder || 0,
        pendingTransfer: previous?.pendingTransfer || 0,
        target: policy.target,
        minimumReserve: policy.minimumReserve,
        maximumVenueExposure: policy.maximumVenueExposure,
        lastReconciliationAt: now,
      });
    }

    if (await this.ensureTables()) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM ${RESERVATION_TABLE} WHERE expires_at <= now()`);
        for (const [asset, available] of merged) {
          const policy = this.policy(venue, asset);
          await client.query(
            `INSERT INTO ${STATE_TABLE}
              (venue, asset, available, target, minimum_reserve, maximum_venue_exposure, reconciled_at)
             VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0))
             ON CONFLICT (venue, asset) DO UPDATE SET
               available=EXCLUDED.available,
               target=EXCLUDED.target,
               minimum_reserve=EXCLUDED.minimum_reserve,
               maximum_venue_exposure=EXCLUDED.maximum_venue_exposure,
               reconciled_at=EXCLUDED.reconciled_at`,
            [venue, asset, available, policy.target, policy.minimumReserve, policy.maximumVenueExposure, now],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        logger.error('[InventoryLedger] Balance reconciliation persistence failed', {
          component: 'CexInventoryLedger', venue,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        client.release();
      }
    }
    return this.getSnapshots().filter(snapshot => snapshot.venue === venue);
  }

  private reserveLocal(requirements: readonly InventoryRequirement[]): boolean {
    for (const requirement of requirements) {
      const key = this.key(requirement.venue, requirement.asset);
      const snapshot = this.local.get(key);
      if (!snapshot) return false;
      const spendable = snapshot.available - snapshot.reserved - snapshot.pendingOrder - snapshot.pendingTransfer - snapshot.minimumReserve;
      if (spendable + 1e-12 < requirement.amount) return false;
      if (snapshot.maximumVenueExposure !== null && snapshot.available > snapshot.maximumVenueExposure + 1e-12) return false;
    }
    for (const requirement of requirements) {
      const key = this.key(requirement.venue, requirement.asset);
      const snapshot = this.local.get(key)!;
      snapshot.reserved += requirement.amount;
    }
    return true;
  }

  private releaseLocal(requirements: readonly InventoryRequirement[]): void {
    for (const requirement of requirements) {
      const snapshot = this.local.get(this.key(requirement.venue, requirement.asset));
      if (snapshot) snapshot.reserved = Math.max(0, snapshot.reserved - requirement.amount);
    }
  }

  async reserve(opportunityId: string, rawRequirements: readonly InventoryRequirement[]): Promise<InventoryReservation | null> {
    const byKey = new Map<string, InventoryRequirement>();
    for (const raw of rawRequirements) {
      const asset = canonicalAsset(raw.asset);
      const amount = finiteNonNegative(raw.amount, NaN);
      if (!asset || !Number.isFinite(amount) || amount <= 0) return null;
      const key = this.key(raw.venue, asset);
      const existing = byKey.get(key);
      byKey.set(key, { venue: raw.venue, asset, amount: (existing?.amount || 0) + amount });
    }
    const requirements = [...byKey.values()];
    if (requirements.length === 0 || !this.reserveLocal(requirements)) return null;

    const reservationId = randomUUID();
    const acquiredAt = Date.now();
    const ttlMs = Math.max(10_000, Math.min(300_000, Number(process.env.CRYPTOCRAWL_INVENTORY_RESERVATION_TTL_MS || 90_000)));
    const expiresAt = acquiredAt + ttlMs;
    let durable = false;

    if (isDatabaseConfigured) {
      if (!await this.ensureTables()) {
        this.releaseLocal(requirements);
        return null;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM ${RESERVATION_TABLE} WHERE expires_at <= now()`);
        for (const requirement of requirements) {
          const state = await client.query(
            `SELECT available, pending_order, pending_transfer, minimum_reserve, maximum_venue_exposure
             FROM ${STATE_TABLE} WHERE venue=$1 AND asset=$2 FOR UPDATE`,
            [requirement.venue, requirement.asset],
          );
          if (state.rowCount !== 1) throw new Error(`inventory_not_reconciled:${requirement.venue}:${requirement.asset}`);
          const row = state.rows[0];
          const reserved = await client.query(
            `SELECT COALESCE(SUM(amount),0) AS reserved FROM ${RESERVATION_TABLE}
             WHERE venue=$1 AND asset=$2 AND expires_at > now()`,
            [requirement.venue, requirement.asset],
          );
          const available = Number(row.available);
          const alreadyReserved = Number(reserved.rows[0]?.reserved || 0);
          const pending = Number(row.pending_order || 0) + Number(row.pending_transfer || 0);
          const minimumReserve = Number(row.minimum_reserve || 0);
          const maximumExposure = row.maximum_venue_exposure === null ? null : Number(row.maximum_venue_exposure);
          const spendable = available - alreadyReserved - pending - minimumReserve;
          if (!Number.isFinite(spendable) || spendable + 1e-12 < requirement.amount) {
            throw new Error(`inventory_insufficient:${requirement.venue}:${requirement.asset}`);
          }
          if (maximumExposure !== null && Number.isFinite(maximumExposure) && available > maximumExposure + 1e-12) {
            throw new Error(`inventory_exposure_limit:${requirement.venue}:${requirement.asset}`);
          }
          await client.query(
            `INSERT INTO ${RESERVATION_TABLE}
             (reservation_id, opportunity_id, venue, asset, amount, acquired_at, expires_at)
             VALUES ($1,$2,$3,$4,$5,to_timestamp($6/1000.0),to_timestamp($7/1000.0))`,
            [reservationId, opportunityId, requirement.venue, requirement.asset, requirement.amount, acquiredAt, expiresAt],
          );
        }
        await client.query('COMMIT');
        durable = true;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        this.releaseLocal(requirements);
        logger.warn('[InventoryLedger] Atomic inventory reservation rejected', {
          component: 'CexInventoryLedger', opportunityId,
          reason: error instanceof Error ? error.message : String(error),
        });
        return null;
      } finally {
        client.release();
      }
    }

    this.localReservations.set(reservationId, requirements);
    let released = false;
    return {
      reservationId,
      opportunityId,
      requirements: requirements.map(requirement => ({ ...requirement })),
      acquiredAt,
      expiresAt,
      release: async () => {
        if (released) return;
        released = true;
        if (durable) {
          await pool.query(`DELETE FROM ${RESERVATION_TABLE} WHERE reservation_id=$1`, [reservationId]).catch(error => {
            logger.error('[InventoryLedger] Reservation release failed; TTL remains the durable fail-safe', {
              component: 'CexInventoryLedger', reservationId, opportunityId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
        this.releaseLocal(requirements);
        this.localReservations.delete(reservationId);
      },
    };
  }

  getSnapshots(): InventorySnapshot[] {
    return [...this.local.values()].map(cloneSnapshot);
  }

  getRebalanceRecommendations(): InventoryRebalanceRecommendation[] {
    const recommendations: InventoryRebalanceRecommendation[] = [];
    for (const snapshot of this.local.values()) {
      if (snapshot.target === null) continue;
      const currentSpendable = Math.max(0,
        snapshot.available - snapshot.reserved - snapshot.pendingOrder - snapshot.pendingTransfer - snapshot.minimumReserve,
      );
      const delta = snapshot.target - currentSpendable;
      const tolerance = Math.max(1e-12, snapshot.target * 0.02);
      if (Math.abs(delta) <= tolerance) continue;
      recommendations.push({
        venue: snapshot.venue,
        asset: snapshot.asset,
        currentSpendable,
        target: snapshot.target,
        delta: Math.abs(delta),
        action: delta > 0 ? 'fund' : 'reduce',
        executable: false,
        reason: 'Target-balance recommendation only; transfer execution requires measured withdrawal/deposit fee, network, address, latency, and settlement evidence',
      });
    }
    return recommendations.sort((a, b) => b.delta - a.delta);
  }
}

export const cexInventoryLedger = new CexInventoryLedger();
