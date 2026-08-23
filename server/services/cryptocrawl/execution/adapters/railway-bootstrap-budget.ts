export const RAILWAY_BOOTSTRAP_SOFT_TARGET_MICRO_USD = 1_000_000;
export const RAILWAY_BOOTSTRAP_ABSOLUTE_MAX_MICRO_USD = 2_000_000;

export interface RailwayBootstrapBudgetSnapshot {
  eventId: string;
  spentMicroUsd: number;
  reservedMicroUsd: number;
  hardLimitMicroUsd: number;
  softTargetMicroUsd: number;
  hardLimitReached: boolean;
}

export interface RailwayBootstrapBudgetLedger {
  get(eventId: string): Promise<RailwayBootstrapBudgetSnapshot>;
  reserve(eventId: string, workId: string, projectedMicroUsd: number): Promise<RailwayBootstrapBudgetSnapshot>;
  settle(eventId: string, workId: string, actualMicroUsd: number): Promise<RailwayBootstrapBudgetSnapshot>;
  cancel(eventId: string, workId: string): Promise<RailwayBootstrapBudgetSnapshot>;
}

function validateAmount(label: string, amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`${label} must be a non-negative safe integer in microdollars`);
  }
  return amount;
}

function initialSnapshot(eventId: string): RailwayBootstrapBudgetSnapshot {
  return {
    eventId,
    spentMicroUsd: 0,
    reservedMicroUsd: 0,
    hardLimitMicroUsd: RAILWAY_BOOTSTRAP_ABSOLUTE_MAX_MICRO_USD,
    softTargetMicroUsd: RAILWAY_BOOTSTRAP_SOFT_TARGET_MICRO_USD,
    hardLimitReached: false,
  };
}

function assertCanReserve(snapshot: RailwayBootstrapBudgetSnapshot, projectedMicroUsd: number): void {
  if (snapshot.hardLimitReached || snapshot.spentMicroUsd + snapshot.reservedMicroUsd + projectedMicroUsd > snapshot.hardLimitMicroUsd) {
    throw new Error('RAILWAY_BOOTSTRAP_HARD_BUDGET_REACHED');
  }
}

export class InMemoryRailwayBootstrapBudgetLedger implements RailwayBootstrapBudgetLedger {
  private readonly snapshots = new Map<string, RailwayBootstrapBudgetSnapshot>();
  private readonly reservations = new Map<string, number>();

  async get(eventId: string): Promise<RailwayBootstrapBudgetSnapshot> {
    return { ...(this.snapshots.get(eventId) || initialSnapshot(eventId)) };
  }

  async reserve(eventId: string, workId: string, projectedMicroUsd: number): Promise<RailwayBootstrapBudgetSnapshot> {
    const projected = validateAmount('projectedMicroUsd', projectedMicroUsd);
    const key = `${eventId}:${workId}`;
    if (this.reservations.has(key)) throw new Error(`Railway bootstrap work ${workId} is already reserved`);
    const snapshot = await this.get(eventId);
    assertCanReserve(snapshot, projected);
    const next = { ...snapshot, reservedMicroUsd: snapshot.reservedMicroUsd + projected };
    this.snapshots.set(eventId, next);
    this.reservations.set(key, projected);
    return { ...next };
  }

  async settle(eventId: string, workId: string, actualMicroUsd: number): Promise<RailwayBootstrapBudgetSnapshot> {
    const actual = validateAmount('actualMicroUsd', actualMicroUsd);
    const key = `${eventId}:${workId}`;
    const reserved = this.reservations.get(key);
    if (reserved === undefined) throw new Error(`Railway bootstrap work ${workId} has no active reservation`);
    const snapshot = await this.get(eventId);
    const spentMicroUsd = snapshot.spentMicroUsd + actual;
    const next = {
      ...snapshot,
      spentMicroUsd,
      reservedMicroUsd: Math.max(0, snapshot.reservedMicroUsd - reserved),
      hardLimitReached: spentMicroUsd >= snapshot.hardLimitMicroUsd || actual > reserved,
    };
    this.snapshots.set(eventId, next);
    this.reservations.delete(key);
    return { ...next };
  }

  async cancel(eventId: string, workId: string): Promise<RailwayBootstrapBudgetSnapshot> {
    const key = `${eventId}:${workId}`;
    const reserved = this.reservations.get(key);
    if (reserved === undefined) return this.get(eventId);
    const snapshot = await this.get(eventId);
    const next = { ...snapshot, reservedMicroUsd: Math.max(0, snapshot.reservedMicroUsd - reserved) };
    this.snapshots.set(eventId, next);
    this.reservations.delete(key);
    return { ...next };
  }
}

export class PostgresRailwayBootstrapBudgetLedger implements RailwayBootstrapBudgetLedger {
  private async withTransaction<T>(operation: (client: any) => Promise<T>): Promise<T> {
    const { pool } = await import('../../../../db.js');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(eventId: string): Promise<RailwayBootstrapBudgetSnapshot> {
    const { pool } = await import('../../../../db.js');
    await pool.query(
      `INSERT INTO railway_bootstrap_budget_events (event_id, spent_micro_usd, reserved_micro_usd)
       VALUES ($1, 0, 0) ON CONFLICT (event_id) DO NOTHING`,
      [eventId],
    );
    const result = await pool.query('SELECT * FROM railway_bootstrap_budget_events WHERE event_id = $1', [eventId]);
    return this.fromRow(eventId, result.rows[0]);
  }

  async reserve(eventId: string, workId: string, projectedMicroUsd: number): Promise<RailwayBootstrapBudgetSnapshot> {
    const projected = validateAmount('projectedMicroUsd', projectedMicroUsd);
    return this.withTransaction(async client => {
      await client.query(
        `INSERT INTO railway_bootstrap_budget_events (event_id, spent_micro_usd, reserved_micro_usd)
         VALUES ($1, 0, 0) ON CONFLICT (event_id) DO NOTHING`,
        [eventId],
      );
      const eventResult = await client.query('SELECT * FROM railway_bootstrap_budget_events WHERE event_id = $1 FOR UPDATE', [eventId]);
      const snapshot = this.fromRow(eventId, eventResult.rows[0]);
      const prior = await client.query('SELECT 1 FROM railway_bootstrap_budget_reservations WHERE event_id = $1 AND work_id = $2 FOR UPDATE', [eventId, workId]);
      if (prior.rows[0]) throw new Error(`Railway bootstrap work ${workId} is already reserved`);
      assertCanReserve(snapshot, projected);
      await client.query(
        'UPDATE railway_bootstrap_budget_events SET reserved_micro_usd = reserved_micro_usd + $2, updated_at = NOW() WHERE event_id = $1',
        [eventId, projected],
      );
      await client.query(
        `INSERT INTO railway_bootstrap_budget_reservations (event_id, work_id, projected_micro_usd, state)
         VALUES ($1, $2, $3, 'RESERVED')`,
        [eventId, workId, projected],
      );
      return { ...snapshot, reservedMicroUsd: snapshot.reservedMicroUsd + projected };
    });
  }

  async settle(eventId: string, workId: string, actualMicroUsd: number): Promise<RailwayBootstrapBudgetSnapshot> {
    const actual = validateAmount('actualMicroUsd', actualMicroUsd);
    return this.withTransaction(async client => {
      const eventResult = await client.query('SELECT * FROM railway_bootstrap_budget_events WHERE event_id = $1 FOR UPDATE', [eventId]);
      const snapshot = this.fromRow(eventId, eventResult.rows[0]);
      const reservation = await client.query(
        `SELECT * FROM railway_bootstrap_budget_reservations
         WHERE event_id = $1 AND work_id = $2 AND state = 'RESERVED' FOR UPDATE`,
        [eventId, workId],
      );
      if (!reservation.rows[0]) throw new Error(`Railway bootstrap work ${workId} has no active reservation`);
      const projected = Number(reservation.rows[0].projected_micro_usd);
      const spentMicroUsd = snapshot.spentMicroUsd + actual;
      const hardLimitReached = spentMicroUsd >= snapshot.hardLimitMicroUsd || actual > projected;
      await client.query(
        `UPDATE railway_bootstrap_budget_events
         SET spent_micro_usd = $2, reserved_micro_usd = GREATEST(0, reserved_micro_usd - $3),
             hard_limit_reached = $4, updated_at = NOW()
         WHERE event_id = $1`,
        [eventId, spentMicroUsd, projected, hardLimitReached],
      );
      await client.query(
        `UPDATE railway_bootstrap_budget_reservations
         SET actual_micro_usd = $3, state = 'SETTLED', updated_at = NOW()
         WHERE event_id = $1 AND work_id = $2`,
        [eventId, workId, actual],
      );
      return { ...snapshot, spentMicroUsd, reservedMicroUsd: Math.max(0, snapshot.reservedMicroUsd - projected), hardLimitReached };
    });
  }

  async cancel(eventId: string, workId: string): Promise<RailwayBootstrapBudgetSnapshot> {
    return this.withTransaction(async client => {
      const eventResult = await client.query('SELECT * FROM railway_bootstrap_budget_events WHERE event_id = $1 FOR UPDATE', [eventId]);
      if (!eventResult.rows[0]) return initialSnapshot(eventId);
      const snapshot = this.fromRow(eventId, eventResult.rows[0]);
      const reservation = await client.query(
        `SELECT * FROM railway_bootstrap_budget_reservations
         WHERE event_id = $1 AND work_id = $2 AND state = 'RESERVED' FOR UPDATE`,
        [eventId, workId],
      );
      if (!reservation.rows[0]) return snapshot;
      const projected = Number(reservation.rows[0].projected_micro_usd);
      await client.query(
        'UPDATE railway_bootstrap_budget_events SET reserved_micro_usd = GREATEST(0, reserved_micro_usd - $2), updated_at = NOW() WHERE event_id = $1',
        [eventId, projected],
      );
      await client.query(
        `UPDATE railway_bootstrap_budget_reservations SET state = 'CANCELLED', updated_at = NOW()
         WHERE event_id = $1 AND work_id = $2`,
        [eventId, workId],
      );
      return { ...snapshot, reservedMicroUsd: Math.max(0, snapshot.reservedMicroUsd - projected) };
    });
  }

  private fromRow(eventId: string, row: Record<string, unknown> | undefined): RailwayBootstrapBudgetSnapshot {
    if (!row) return initialSnapshot(eventId);
    return {
      eventId,
      spentMicroUsd: Number(row.spent_micro_usd),
      reservedMicroUsd: Number(row.reserved_micro_usd),
      hardLimitMicroUsd: RAILWAY_BOOTSTRAP_ABSOLUTE_MAX_MICRO_USD,
      softTargetMicroUsd: RAILWAY_BOOTSTRAP_SOFT_TARGET_MICRO_USD,
      hardLimitReached: Boolean(row.hard_limit_reached),
    };
  }
}

export class RailwayBootstrapBudgetGovernor {
  constructor(private readonly ledger: RailwayBootstrapBudgetLedger) {}

  async reserve(eventId: string, workId: string, projectedMicroUsd: number): Promise<RailwayBootstrapBudgetSnapshot> {
    return this.ledger.reserve(eventId, workId, projectedMicroUsd);
  }

  async settle(eventId: string, workId: string, actualMicroUsd: number): Promise<RailwayBootstrapBudgetSnapshot> {
    return this.ledger.settle(eventId, workId, actualMicroUsd);
  }

  async cancel(eventId: string, workId: string): Promise<RailwayBootstrapBudgetSnapshot> {
    return this.ledger.cancel(eventId, workId);
  }
}

export function parseUsdToMicroUsd(label: string, value: string): number {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value.trim())) throw new Error(`${label} must be a USD decimal with at most six fractional digits`);
  const [whole, fractional = ''] = value.trim().split('.');
  return Number(whole) * 1_000_000 + Number(`${fractional}000000`.slice(0, 6));
}

export function estimateRailwayIncrementalMicroUsd(input: {
  cpuMilliseconds: number;
  memoryMegabyteMilliseconds: number;
  cpuUsdPerHour: string;
  memoryGbUsdPerHour: string;
}): number {
  const cpuRate = parseUsdToMicroUsd('cpuUsdPerHour', input.cpuUsdPerHour);
  const memoryRate = parseUsdToMicroUsd('memoryGbUsdPerHour', input.memoryGbUsdPerHour);
  if (!Number.isFinite(input.cpuMilliseconds) || input.cpuMilliseconds < 0 || !Number.isFinite(input.memoryMegabyteMilliseconds) || input.memoryMegabyteMilliseconds < 0) {
    throw new Error('Railway resource estimates must be non-negative finite values');
  }
  return Math.ceil((input.cpuMilliseconds * cpuRate) / 3_600_000) +
    Math.ceil((input.memoryMegabyteMilliseconds * memoryRate) / (1024 * 3_600_000));
}