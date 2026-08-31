import { withCryptaraSupabasePriority } from '../../integration/cryptara-supabase-admission-worker.js';

export type Stage4ExecutionState = 'PREPARED' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'STALE';

export interface Stage4ExecutionRecord {
  executionKey: string;
  opportunityId: string;
  chain: string;
  state: Stage4ExecutionState;
  stateFingerprint: string;
  receiver: string;
  transactionHash?: string;
  transactionNonce?: number;
  startingNativeBalanceWei?: string;
  endingNativeBalanceWei?: string;
  nativeFeeWei?: string;
  startingInputBalance?: string;
  endingInputBalance?: string;
  realizedProfit?: string;
  receiptBlock?: number;
  error?: string;
}

export interface Stage4ExecutionLedger {
  reserve(record: Stage4ExecutionRecord): Promise<{ created: boolean; record: Stage4ExecutionRecord }>;
  markSubmitted(executionKey: string, transactionHash: string, transactionNonce: number): Promise<void>;
  markConfirmed(executionKey: string, update: Pick<Stage4ExecutionRecord, 'endingNativeBalanceWei' | 'nativeFeeWei' | 'endingInputBalance' | 'realizedProfit' | 'receiptBlock'>): Promise<void>;
  markFailed(executionKey: string, error: string): Promise<void>;
}

function fromRow(row: Record<string, unknown>): Stage4ExecutionRecord {
  return {
    executionKey: String(row.execution_key),
    opportunityId: String(row.opportunity_id),
    chain: String(row.chain),
    state: String(row.state) as Stage4ExecutionState,
    stateFingerprint: String(row.state_fingerprint),
    receiver: String(row.receiver),
    transactionHash: row.transaction_hash ? String(row.transaction_hash) : undefined,
    transactionNonce: row.transaction_nonce === null || row.transaction_nonce === undefined ? undefined : Number(row.transaction_nonce),
    startingNativeBalanceWei: row.starting_native_balance_wei ? String(row.starting_native_balance_wei) : undefined,
    endingNativeBalanceWei: row.ending_native_balance_wei ? String(row.ending_native_balance_wei) : undefined,
    nativeFeeWei: row.native_fee_wei ? String(row.native_fee_wei) : undefined,
    startingInputBalance: row.starting_input_balance ? String(row.starting_input_balance) : undefined,
    endingInputBalance: row.ending_input_balance ? String(row.ending_input_balance) : undefined,
    realizedProfit: row.realized_profit ? String(row.realized_profit) : undefined,
    receiptBlock: row.receipt_block === null || row.receipt_block === undefined ? undefined : Number(row.receipt_block),
    error: row.error ? String(row.error) : undefined,
  };
}

async function getDatabasePool() {
  const { pool } = await import('../../../../db.js');
  return pool;
}

async function highPriorityQuery(text: string, values?: unknown[]) {
  const pool = await getDatabasePool();
  return withCryptaraSupabasePriority('high', () => pool.query(text, values));
}

export class PostgresStage4ExecutionLedger implements Stage4ExecutionLedger {
  async reserve(record: Stage4ExecutionRecord): Promise<{ created: boolean; record: Stage4ExecutionRecord }> {
    const inserted = await highPriorityQuery(
      `INSERT INTO zero_capital_execution_ledger (
        execution_key, opportunity_id, chain, state, state_fingerprint, receiver,
        starting_native_balance_wei, starting_input_balance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (execution_key) DO NOTHING
      RETURNING *`,
      [
        record.executionKey,
        record.opportunityId,
        record.chain,
        record.state,
        record.stateFingerprint,
        record.receiver,
        record.startingNativeBalanceWei || null,
        record.startingInputBalance || null,
      ],
    );
    if (inserted.rows[0]) return { created: true, record: fromRow(inserted.rows[0]) };

    const existing = await highPriorityQuery('SELECT * FROM zero_capital_execution_ledger WHERE execution_key = $1', [record.executionKey]);
    if (!existing.rows[0]) throw new Error(`Execution ledger conflict without a record for ${record.executionKey}`);
    return { created: false, record: fromRow(existing.rows[0]) };
  }

  async markSubmitted(executionKey: string, transactionHash: string, transactionNonce: number): Promise<void> {
    await highPriorityQuery(
      `UPDATE zero_capital_execution_ledger
       SET state = 'SUBMITTED', transaction_hash = $2, transaction_nonce = $3, updated_at = NOW()
       WHERE execution_key = $1 AND state = 'PREPARED'`,
      [executionKey, transactionHash, transactionNonce],
    );
  }

  async markConfirmed(executionKey: string, update: Pick<Stage4ExecutionRecord, 'endingNativeBalanceWei' | 'nativeFeeWei' | 'endingInputBalance' | 'realizedProfit' | 'receiptBlock'>): Promise<void> {
    await highPriorityQuery(
      `UPDATE zero_capital_execution_ledger
       SET state = 'CONFIRMED', ending_native_balance_wei = $2, native_fee_wei = $3,
           ending_input_balance = $4, realized_profit = $5, receipt_block = $6, updated_at = NOW()
       WHERE execution_key = $1 AND state IN ('PREPARED', 'SUBMITTED')`,
      [executionKey, update.endingNativeBalanceWei || null, update.nativeFeeWei || null, update.endingInputBalance || null, update.realizedProfit || null, update.receiptBlock || null],
    );
  }

  async markFailed(executionKey: string, error: string): Promise<void> {
    await highPriorityQuery(
      `UPDATE zero_capital_execution_ledger
       SET state = 'FAILED', error = $2, updated_at = NOW()
       WHERE execution_key = $1 AND state <> 'CONFIRMED'`,
      [executionKey, error.slice(0, 2_000)],
    );
  }
}

export class InMemoryStage4ExecutionLedger implements Stage4ExecutionLedger {
  private readonly records = new Map<string, Stage4ExecutionRecord>();

  async reserve(record: Stage4ExecutionRecord): Promise<{ created: boolean; record: Stage4ExecutionRecord }> {
    const existing = this.records.get(record.executionKey);
    if (existing) return { created: false, record: { ...existing } };
    this.records.set(record.executionKey, { ...record });
    return { created: true, record: { ...record } };
  }

  async markSubmitted(executionKey: string, transactionHash: string, transactionNonce: number): Promise<void> {
    const record = this.requireRecord(executionKey);
    if (record.state === 'PREPARED') this.records.set(executionKey, { ...record, state: 'SUBMITTED', transactionHash, transactionNonce });
  }

  async markConfirmed(executionKey: string, update: Pick<Stage4ExecutionRecord, 'endingNativeBalanceWei' | 'nativeFeeWei' | 'endingInputBalance' | 'realizedProfit' | 'receiptBlock'>): Promise<void> {
    const record = this.requireRecord(executionKey);
    if (record.state === 'PREPARED' || record.state === 'SUBMITTED') this.records.set(executionKey, { ...record, ...update, state: 'CONFIRMED' });
  }

  async markFailed(executionKey: string, error: string): Promise<void> {
    const record = this.requireRecord(executionKey);
    if (record.state !== 'CONFIRMED') this.records.set(executionKey, { ...record, state: 'FAILED', error });
  }

  private requireRecord(executionKey: string): Stage4ExecutionRecord {
    const record = this.records.get(executionKey);
    if (!record) throw new Error(`Execution ledger record ${executionKey} does not exist`);
    return record;
  }
}
