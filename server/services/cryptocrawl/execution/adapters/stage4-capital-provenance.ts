import crypto from 'node:crypto';

export type CapitalLifecycle =
  | 'ZERO'
  | 'ZERO_GAS_EXECUTION_READY'
  | 'ATOMIC_EXECUTION_PENDING'
  | 'FIRST_PROFIT_VERIFIED'
  | 'SELF_FUNDED'
  | 'ZERO_RECOVERY_REQUIRED';

export interface CapitalProvenanceState {
  scope: string;
  lifecycle: CapitalLifecycle;
  generation: number;
  asset?: string;
  internallyGeneratedBalance: string;
  chain?: string;
  originTransactionHash?: string;
  latestExecutionKey?: string;
  sourceRecipient?: string;
  sourceRecipientBalanceBeforeBaseUnits?: string;
  sourceRecipientBalanceAfterBaseUnits?: string;
}

export interface VerifiedBootstrapProfit {
  scope: string;
  executionKey: string;
  transactionHash: string;
  chain: string;
  asset: string;
  residualProfit: string;
  zeroMonetaryGasVerified: boolean;
  zeroExternalNativeCapitalVerified: boolean;
  zeroExternalInputCapitalVerified: boolean;
  sourceRecipient?: string;
  sourceRecipientBalanceBeforeBaseUnits?: string;
  sourceRecipientBalanceAfterBaseUnits?: string;
}

export interface VerifiedRetainedProfit {
  scope: string;
  executionKey: string;
  transactionHash: string;
  chain: string;
  asset: string;
  retainedProfit: string;
  grossProfit?: string;
  payoutReserved?: string;
  settlementReceiptVerified: boolean;
  profitRecipientDeltaVerified: boolean;
  sourceRecipient: string;
  sourceRecipientBalanceBeforeBaseUnits: string;
  sourceRecipientBalanceAfterBaseUnits: string;
}

export interface VerifiedNativeGasFundingSettlement {
  scope: string;
  sourceAsset: string;
  sourceProceedsAllocatedBaseUnits: string;
  destinationChain: string;
  destinationTransactionHash: string;
  destinationReceiptVerified: boolean;
  deliveredNativeWei: string;
  destinationNativeBalanceBeforeWei: string;
  destinationNativeBalanceAfterWei: string;
  reimbursementRequired: boolean;
  reimbursementVerified: boolean;
}

export interface Stage4CapitalProvenanceStore {
  getOrCreate(scope: string): Promise<CapitalProvenanceState>;
  markZeroGasExecutionReady(scope: string): Promise<CapitalProvenanceState>;
  markAtomicExecutionPending(scope: string, executionKey: string): Promise<CapitalProvenanceState>;
  recordVerifiedBootstrapProfit(proof: VerifiedBootstrapProfit): Promise<CapitalProvenanceState>;
  recordVerifiedRetainedProfit(proof: VerifiedRetainedProfit): Promise<CapitalProvenanceState>;
  recordNativeGasFundingSettlement(proof: VerifiedNativeGasFundingSettlement): Promise<CapitalProvenanceState>;
  markRecoveryRequired(scope: string): Promise<CapitalProvenanceState>;
}

function requirePositiveInteger(label: string, value: string): void {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`${label} must be a positive integer string in base units`);
  }
}

function requireNonNegativeInteger(label: string, value: string): void {
  if (!/^\d+$/.test(value) || BigInt(value) < 0n) {
    throw new Error(`${label} must be a non-negative integer string in base units`);
  }
}

function assertValidTransition(current: CapitalLifecycle, next: CapitalLifecycle): void {
  const allowed: Record<CapitalLifecycle, CapitalLifecycle[]> = {
    ZERO: ['ZERO_GAS_EXECUTION_READY', 'ZERO_RECOVERY_REQUIRED'],
    ZERO_GAS_EXECUTION_READY: ['ATOMIC_EXECUTION_PENDING', 'ZERO_RECOVERY_REQUIRED'],
    ATOMIC_EXECUTION_PENDING: ['ZERO_GAS_EXECUTION_READY', 'FIRST_PROFIT_VERIFIED', 'ZERO_RECOVERY_REQUIRED'],
    FIRST_PROFIT_VERIFIED: ['SELF_FUNDED'],
    SELF_FUNDED: ['ZERO_RECOVERY_REQUIRED'],
    ZERO_RECOVERY_REQUIRED: ['ZERO_GAS_EXECUTION_READY'],
  };
  if (!allowed[current].includes(next)) {
    throw new Error(`Invalid capital lifecycle transition ${current} -> ${next}`);
  }
}

function sameBootstrapProof(state: CapitalProvenanceState, proof: VerifiedBootstrapProfit): boolean {
  return state.originTransactionHash?.toLowerCase() === proof.transactionHash.toLowerCase()
    && state.latestExecutionKey === proof.executionKey
    && state.asset === proof.asset
    && state.chain === proof.chain
    && state.internallyGeneratedBalance === proof.residualProfit;
}

function requireCompatibleRetainedProfitState(state: CapitalProvenanceState, proof: VerifiedRetainedProfit): void {
  if (state.lifecycle !== 'SELF_FUNDED') {
    throw new Error(`Retained profit requires SELF_FUNDED capital provenance, received ${state.lifecycle}`);
  }
  if (state.asset !== proof.asset || state.chain !== proof.chain) {
    throw new Error('Retained profit asset/chain does not match the SELF_FUNDED capital scope');
  }
  if (state.sourceRecipient && state.sourceRecipient.toLowerCase() !== proof.sourceRecipient.toLowerCase()) {
    throw new Error('Retained profit recipient does not match the SELF_FUNDED capital scope');
  }
}

export class InMemoryStage4CapitalProvenanceStore implements Stage4CapitalProvenanceStore {
  private readonly states = new Map<string, CapitalProvenanceState>();
  private readonly retainedProfits = new Set<string>();
  private readonly fundingSettlements = new Set<string>();

  async getOrCreate(scope: string): Promise<CapitalProvenanceState> {
    const existing = this.states.get(scope);
    if (existing) return { ...existing };
    const state: CapitalProvenanceState = { scope, lifecycle: 'ZERO', generation: 0, internallyGeneratedBalance: '0' };
    this.states.set(scope, state);
    return { ...state };
  }

  async markZeroGasExecutionReady(scope: string): Promise<CapitalProvenanceState> {
    const current = await this.getOrCreate(scope);
    if (current.lifecycle === 'ZERO_GAS_EXECUTION_READY') return current;
    return this.transition(scope, 'ZERO_GAS_EXECUTION_READY');
  }

  async markAtomicExecutionPending(scope: string, executionKey: string): Promise<CapitalProvenanceState> {
    const current = await this.getOrCreate(scope);
    if (current.lifecycle === 'ATOMIC_EXECUTION_PENDING') {
      return this.transition(scope, 'ATOMIC_EXECUTION_PENDING', { latestExecutionKey: executionKey }, true);
    }
    return this.transition(scope, 'ATOMIC_EXECUTION_PENDING', { latestExecutionKey: executionKey });
  }

  async recordVerifiedBootstrapProfit(proof: VerifiedBootstrapProfit): Promise<CapitalProvenanceState> {
    requireVerifiedProof(proof);
    const current = await this.getOrCreate(proof.scope);
    if (current.lifecycle === 'SELF_FUNDED') {
      if (sameBootstrapProof(current, proof)) return current;
      throw new Error('Bootstrap capital provenance is already SELF_FUNDED from a different proof');
    }
    if (current.lifecycle === 'FIRST_PROFIT_VERIFIED') {
      const candidate = {
        ...current,
        asset: proof.asset,
        chain: proof.chain,
        originTransactionHash: proof.transactionHash,
        latestExecutionKey: proof.executionKey,
        internallyGeneratedBalance: proof.residualProfit,
      };
      if (!sameBootstrapProof(candidate, proof)) {
        throw new Error('FIRST_PROFIT_VERIFIED state does not match the retried bootstrap proof');
      }
      return this.transition(proof.scope, 'SELF_FUNDED', { generation: current.generation + 1 });
    }
    if (current.lifecycle !== 'ATOMIC_EXECUTION_PENDING') {
      throw new Error(`Bootstrap profit requires ATOMIC_EXECUTION_PENDING provenance, received ${current.lifecycle}`);
    }
    if (current.latestExecutionKey && current.latestExecutionKey !== proof.executionKey) {
      throw new Error('Bootstrap proof execution key does not match the pending capital provenance');
    }
    const first = await this.transition(proof.scope, 'FIRST_PROFIT_VERIFIED', {
      asset: proof.asset,
      chain: proof.chain,
      originTransactionHash: proof.transactionHash,
      latestExecutionKey: proof.executionKey,
      internallyGeneratedBalance: proof.residualProfit,
      sourceRecipient: proof.sourceRecipient,
      sourceRecipientBalanceBeforeBaseUnits: proof.sourceRecipientBalanceBeforeBaseUnits,
      sourceRecipientBalanceAfterBaseUnits: proof.sourceRecipientBalanceAfterBaseUnits,
    });
    return this.transition(first.scope, 'SELF_FUNDED', { generation: first.generation + 1 });
  }

  async recordVerifiedRetainedProfit(proof: VerifiedRetainedProfit): Promise<CapitalProvenanceState> {
    requireVerifiedRetainedProfit(proof);
    const current = await this.getOrCreate(proof.scope);
    const eventKey = `${proof.scope}:${proof.executionKey}`;
    if (this.retainedProfits.has(eventKey)) return current;
    requireCompatibleRetainedProfitState(current, proof);
    const next: CapitalProvenanceState = {
      ...current,
      internallyGeneratedBalance: (BigInt(current.internallyGeneratedBalance) + BigInt(proof.retainedProfit)).toString(),
      latestExecutionKey: proof.executionKey,
      sourceRecipient: proof.sourceRecipient,
      sourceRecipientBalanceBeforeBaseUnits: proof.sourceRecipientBalanceBeforeBaseUnits,
      sourceRecipientBalanceAfterBaseUnits: proof.sourceRecipientBalanceAfterBaseUnits,
    };
    this.states.set(proof.scope, next);
    this.retainedProfits.add(eventKey);
    return { ...next };
  }

  async recordNativeGasFundingSettlement(proof: VerifiedNativeGasFundingSettlement): Promise<CapitalProvenanceState> {
    requireVerifiedFundingSettlement(proof);
    const current = await this.getOrCreate(proof.scope);
    const settlementKey = `${proof.scope}:${proof.destinationTransactionHash}`;
    if (this.fundingSettlements.has(settlementKey)) return current;
    if (current.lifecycle !== 'SELF_FUNDED') {
      throw new Error(`Native-gas funding settlement requires SELF_FUNDED capital provenance, received ${current.lifecycle}`);
    }
    const remaining = BigInt(current.internallyGeneratedBalance) - BigInt(proof.sourceProceedsAllocatedBaseUnits);
    if (remaining < 0n) throw new Error('Native-gas funding settlement exceeds recorded internally generated balance');
    const next = { ...current, internallyGeneratedBalance: remaining.toString(), latestExecutionKey: `native-gas:${proof.destinationTransactionHash}` };
    this.states.set(proof.scope, next);
    this.fundingSettlements.add(settlementKey);
    return { ...next };
  }

  async markRecoveryRequired(scope: string): Promise<CapitalProvenanceState> {
    const current = await this.getOrCreate(scope);
    if (current.lifecycle === 'ZERO_RECOVERY_REQUIRED') return current;
    return this.transition(scope, 'ZERO_RECOVERY_REQUIRED', { internallyGeneratedBalance: '0' });
  }

  private async transition(scope: string, lifecycle: CapitalLifecycle, update: Partial<CapitalProvenanceState> = {}, allowSameState = false): Promise<CapitalProvenanceState> {
    const current = await this.getOrCreate(scope);
    if (!allowSameState || current.lifecycle !== lifecycle) assertValidTransition(current.lifecycle, lifecycle);
    const next = { ...current, ...update, lifecycle };
    this.states.set(scope, next);
    return { ...next };
  }
}

function requireVerifiedProof(proof: VerifiedBootstrapProfit): void {
  requirePositiveInteger('residualProfit', proof.residualProfit);
  if (!proof.zeroMonetaryGasVerified || !proof.zeroExternalNativeCapitalVerified || !proof.zeroExternalInputCapitalVerified) {
    throw new Error('Bootstrap profit cannot be recorded without zero-fee and zero-external-capital proof');
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(proof.transactionHash)) {
    throw new Error('Bootstrap profit requires a transaction hash');
  }
}

function requireVerifiedRetainedProfit(proof: VerifiedRetainedProfit): void {
  requirePositiveInteger('retainedProfit', proof.retainedProfit);
  const grossProfit = proof.grossProfit ?? proof.retainedProfit;
  const payoutReserved = proof.payoutReserved ?? '0';
  requirePositiveInteger('grossProfit', grossProfit);
  requireNonNegativeInteger('payoutReserved', payoutReserved);
  if (BigInt(proof.retainedProfit) + BigInt(payoutReserved) !== BigInt(grossProfit)) {
    throw new Error('Retained profit plus payout-reserved units must equal gross settled profit');
  }
  if (!proof.settlementReceiptVerified || !proof.profitRecipientDeltaVerified) {
    throw new Error('Retained profit requires a confirmed receipt and verified profit-recipient balance delta');
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(proof.transactionHash)) {
    throw new Error('Retained profit requires a transaction hash');
  }
  let before: bigint;
  let after: bigint;
  try {
    before = BigInt(proof.sourceRecipientBalanceBeforeBaseUnits);
    after = BigInt(proof.sourceRecipientBalanceAfterBaseUnits);
  } catch {
    throw new Error('Retained profit recipient balance evidence must be integer strings');
  }
  if (before < 0n || after < before || after - before !== BigInt(grossProfit)) {
    throw new Error('Retained profit recipient balance delta does not match gross settled profit base units');
  }
}

function requireVerifiedFundingSettlement(proof: VerifiedNativeGasFundingSettlement): void {
  if (!/^\d+$/.test(proof.sourceProceedsAllocatedBaseUnits) || BigInt(proof.sourceProceedsAllocatedBaseUnits) < 0n) {
    throw new Error('Native-gas funding settlement source allocation must be a non-negative integer');
  }
  requirePositiveInteger('deliveredNativeWei', proof.deliveredNativeWei);
  if (!/^0x[a-fA-F0-9]{64}$/.test(proof.destinationTransactionHash)) {
    throw new Error('Native-gas funding settlement requires a destination transaction hash');
  }
  if (!proof.destinationReceiptVerified) {
    throw new Error('Native-gas funding settlement requires a verified destination receipt');
  }
  if (!proof.reimbursementRequired && !proof.reimbursementVerified) {
    throw new Error('Native-gas funding settlement must explicitly verify non-reimbursement or sponsor reimbursement');
  }
  let before: bigint;
  let after: bigint;
  try {
    before = BigInt(proof.destinationNativeBalanceBeforeWei);
    after = BigInt(proof.destinationNativeBalanceAfterWei);
  } catch {
    throw new Error('Native-gas funding settlement balance evidence must be integer strings');
  }
  if (before < 0n || after < before || after - before !== BigInt(proof.deliveredNativeWei)) {
    throw new Error('Native-gas funding settlement balance evidence does not match delivered native currency');
  }
}

export class PostgresStage4CapitalProvenanceStore implements Stage4CapitalProvenanceStore {
  private async query(text: string, values: unknown[]) {
    const { pool } = await import('../../../../db.js');
    return pool.query(text, values);
  }

  async getOrCreate(scope: string): Promise<CapitalProvenanceState> {
    await this.query(
      `INSERT INTO zero_capital_capital_state (scope, lifecycle, generation, internally_generated_balance)
       VALUES ($1, 'ZERO', 0, '0') ON CONFLICT (scope) DO NOTHING`,
      [scope],
    );
    const result = await this.query('SELECT * FROM zero_capital_capital_state WHERE scope = $1', [scope]);
    if (!result.rows[0]) throw new Error(`Capital provenance state ${scope} could not be loaded`);
    return fromRow(result.rows[0]);
  }

  async markZeroGasExecutionReady(scope: string): Promise<CapitalProvenanceState> {
    const current = await this.getOrCreate(scope);
    if (current.lifecycle === 'ZERO_GAS_EXECUTION_READY') return current;
    return this.transition(scope, 'ZERO_GAS_EXECUTION_READY');
  }

  async markAtomicExecutionPending(scope: string, executionKey: string): Promise<CapitalProvenanceState> {
    const current = await this.getOrCreate(scope);
    if (current.lifecycle === 'ATOMIC_EXECUTION_PENDING') {
      return this.transition(scope, 'ATOMIC_EXECUTION_PENDING', { latestExecutionKey: executionKey }, true);
    }
    return this.transition(scope, 'ATOMIC_EXECUTION_PENDING', { latestExecutionKey: executionKey });
  }

  async recordVerifiedBootstrapProfit(proof: VerifiedBootstrapProfit): Promise<CapitalProvenanceState> {
    requireVerifiedProof(proof);
    const { pool } = await import('../../../../db.js');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO zero_capital_capital_state (scope, lifecycle, generation, internally_generated_balance)
         VALUES ($1, 'ZERO', 0, '0') ON CONFLICT (scope) DO NOTHING`,
        [proof.scope],
      );
      const currentResult = await client.query(
        'SELECT * FROM zero_capital_capital_state WHERE scope = $1 FOR UPDATE',
        [proof.scope],
      );
      if (!currentResult.rows[0]) throw new Error(`Capital provenance state ${proof.scope} could not be loaded`);
      let current = fromRow(currentResult.rows[0]);

      const existingEvent = await client.query(
        'SELECT execution_key, transaction_hash FROM zero_capital_capital_events WHERE scope = $1 AND execution_key = $2',
        [proof.scope, proof.executionKey],
      );
      if (existingEvent.rows[0]) {
        if (String(existingEvent.rows[0].transaction_hash || '').toLowerCase() !== proof.transactionHash.toLowerCase()) {
          throw new Error('Bootstrap execution key is already bound to a different transaction hash');
        }
        await client.query('COMMIT');
        return current;
      }

      if (current.lifecycle === 'SELF_FUNDED') {
        if (!sameBootstrapProof(current, proof)) {
          throw new Error('Bootstrap capital provenance is already SELF_FUNDED from a different proof');
        }
      } else {
        if (current.lifecycle === 'FIRST_PROFIT_VERIFIED') {
          const candidate = {
            ...current,
            asset: proof.asset,
            chain: proof.chain,
            originTransactionHash: proof.transactionHash,
            latestExecutionKey: proof.executionKey,
            internallyGeneratedBalance: proof.residualProfit,
          };
          if (!sameBootstrapProof(candidate, proof)) {
            throw new Error('FIRST_PROFIT_VERIFIED state does not match the retried bootstrap proof');
          }
        } else {
          if (current.lifecycle !== 'ATOMIC_EXECUTION_PENDING') {
            throw new Error(`Bootstrap profit requires ATOMIC_EXECUTION_PENDING provenance, received ${current.lifecycle}`);
          }
          if (current.latestExecutionKey && current.latestExecutionKey !== proof.executionKey) {
            throw new Error('Bootstrap proof execution key does not match the pending capital provenance');
          }
          assertValidTransition(current.lifecycle, 'FIRST_PROFIT_VERIFIED');
          const first = await client.query(
            `UPDATE zero_capital_capital_state
             SET lifecycle='FIRST_PROFIT_VERIFIED', asset=$2, internally_generated_balance=$3, chain=$4,
                 origin_transaction_hash=$5, latest_execution_key=$6, source_recipient=$7,
                 source_recipient_balance_before_base_units=$8, source_recipient_balance_after_base_units=$9,
                 updated_at=NOW()
             WHERE scope=$1
             RETURNING *`,
            [proof.scope, proof.asset, proof.residualProfit, proof.chain, proof.transactionHash, proof.executionKey,
              proof.sourceRecipient || null, proof.sourceRecipientBalanceBeforeBaseUnits || null,
              proof.sourceRecipientBalanceAfterBaseUnits || null],
          );
          current = fromRow(first.rows[0]);
        }

        assertValidTransition(current.lifecycle, 'SELF_FUNDED');
        const funded = await client.query(
          `UPDATE zero_capital_capital_state
           SET lifecycle='SELF_FUNDED', generation=generation + 1, updated_at=NOW()
           WHERE scope=$1
           RETURNING *`,
          [proof.scope],
        );
        current = fromRow(funded.rows[0]);
      }

      await client.query(
        `INSERT INTO zero_capital_capital_events (event_id, scope, lifecycle, generation, asset, amount, chain, transaction_hash, execution_key)
         VALUES ($1, $2, 'SELF_FUNDED', $3, $4, $5, $6, $7, $8)
         ON CONFLICT (scope, execution_key) WHERE execution_key IS NOT NULL DO NOTHING`,
        [crypto.randomUUID(), current.scope, current.generation, proof.asset, proof.residualProfit, proof.chain, proof.transactionHash, proof.executionKey],
      );
      await client.query('COMMIT');
      return current;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordVerifiedRetainedProfit(proof: VerifiedRetainedProfit): Promise<CapitalProvenanceState> {
    requireVerifiedRetainedProfit(proof);
    const { pool } = await import('../../../../db.js');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const currentResult = await client.query(
        'SELECT * FROM zero_capital_capital_state WHERE scope = $1 FOR UPDATE',
        [proof.scope],
      );
      if (!currentResult.rows[0]) throw new Error(`Capital provenance state ${proof.scope} could not be loaded`);
      const current = fromRow(currentResult.rows[0]);
      const existingEvent = await client.query(
        'SELECT transaction_hash FROM zero_capital_capital_events WHERE scope = $1 AND execution_key = $2',
        [proof.scope, proof.executionKey],
      );
      if (existingEvent.rows[0]) {
        if (String(existingEvent.rows[0].transaction_hash || '').toLowerCase() !== proof.transactionHash.toLowerCase()) {
          throw new Error('Retained-profit execution key is already bound to a different transaction hash');
        }
        await client.query('COMMIT');
        return current;
      }
      requireCompatibleRetainedProfitState(current, proof);
      const updated = await client.query(
        `UPDATE zero_capital_capital_state
         SET internally_generated_balance = (internally_generated_balance::numeric + $2::numeric)::text,
             latest_execution_key=$3,
             source_recipient=$4,
             source_recipient_balance_before_base_units=$5,
             source_recipient_balance_after_base_units=$6,
             updated_at=NOW()
         WHERE scope=$1 AND lifecycle='SELF_FUNDED'
         RETURNING *`,
        [proof.scope, proof.retainedProfit, proof.executionKey, proof.sourceRecipient,
          proof.sourceRecipientBalanceBeforeBaseUnits, proof.sourceRecipientBalanceAfterBaseUnits],
      );
      if (!updated.rows[0]) throw new Error('Retained-profit credit lost SELF_FUNDED authority while locked');
      const next = fromRow(updated.rows[0]);
      await client.query(
        `INSERT INTO zero_capital_capital_events (event_id, scope, lifecycle, generation, asset, amount, chain, transaction_hash, execution_key)
         VALUES ($1, $2, 'SELF_FUNDED', $3, $4, $5, $6, $7, $8)
         ON CONFLICT (scope, execution_key) WHERE execution_key IS NOT NULL DO NOTHING`,
        [crypto.randomUUID(), proof.scope, next.generation, proof.asset, proof.retainedProfit,
          proof.chain, proof.transactionHash, proof.executionKey],
      );
      await client.query('COMMIT');
      return next;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordNativeGasFundingSettlement(proof: VerifiedNativeGasFundingSettlement): Promise<CapitalProvenanceState> {
    requireVerifiedFundingSettlement(proof);
    const { pool } = await import('../../../../db.js');
    const client = await pool.connect();
    const executionKey = `native-gas:${proof.destinationTransactionHash}`;
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO zero_capital_capital_state (scope, lifecycle, generation, internally_generated_balance)
         VALUES ($1, 'ZERO', 0, '0') ON CONFLICT (scope) DO NOTHING`,
        [proof.scope],
      );
      const currentResult = await client.query('SELECT * FROM zero_capital_capital_state WHERE scope = $1 FOR UPDATE', [proof.scope]);
      if (!currentResult.rows[0]) throw new Error(`Capital provenance state ${proof.scope} could not be loaded`);
      const current = fromRow(currentResult.rows[0]);
      const existing = await client.query(
        'SELECT * FROM zero_capital_capital_events WHERE scope = $1 AND execution_key = $2',
        [proof.scope, executionKey],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return current;
      }
      if (current.lifecycle !== 'SELF_FUNDED') {
        throw new Error(`Native-gas funding settlement requires SELF_FUNDED capital provenance, received ${current.lifecycle}`);
      }
      const updated = await client.query(
        `UPDATE zero_capital_capital_state
         SET internally_generated_balance = (internally_generated_balance::numeric - $2::numeric)::text,
             latest_execution_key = $3, updated_at = NOW()
         WHERE scope = $1 AND lifecycle = 'SELF_FUNDED'
           AND internally_generated_balance::numeric >= $2::numeric
         RETURNING *`,
        [proof.scope, proof.sourceProceedsAllocatedBaseUnits, executionKey],
      );
      if (!updated.rows[0]) throw new Error('Native-gas funding settlement exceeds recorded internally generated balance');
      await client.query(
        `INSERT INTO zero_capital_capital_events (event_id, scope, lifecycle, generation, asset, amount, chain, transaction_hash, execution_key)
         VALUES ($1, $2, 'SELF_FUNDED', $3, $4, $5, $6, $7, $8)`,
        [crypto.randomUUID(), proof.scope, current.generation, proof.sourceAsset,
          proof.sourceProceedsAllocatedBaseUnits, proof.destinationChain,
          proof.destinationTransactionHash, executionKey],
      );
      await client.query('COMMIT');
      return fromRow(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markRecoveryRequired(scope: string): Promise<CapitalProvenanceState> {
    const current = await this.getOrCreate(scope);
    if (current.lifecycle === 'ZERO_RECOVERY_REQUIRED') return current;
    return this.transition(scope, 'ZERO_RECOVERY_REQUIRED', { internallyGeneratedBalance: '0' });
  }

  private async transition(scope: string, lifecycle: CapitalLifecycle, update: Partial<CapitalProvenanceState> = {}, allowSameState = false): Promise<CapitalProvenanceState> {
    const current = await this.getOrCreate(scope);
    if (!allowSameState || current.lifecycle !== lifecycle) assertValidTransition(current.lifecycle, lifecycle);
    const next = { ...current, ...update, lifecycle };
    await this.query(
      `UPDATE zero_capital_capital_state
       SET lifecycle = $2, generation = $3, asset = $4, internally_generated_balance = $5, chain = $6,
           origin_transaction_hash = $7, latest_execution_key = $8, source_recipient = $9,
           source_recipient_balance_before_base_units = $10, source_recipient_balance_after_base_units = $11, updated_at = NOW()
       WHERE scope = $1`,
      [next.scope, next.lifecycle, next.generation, next.asset || null, next.internallyGeneratedBalance, next.chain || null, next.originTransactionHash || null, next.latestExecutionKey || null,
        next.sourceRecipient || null, next.sourceRecipientBalanceBeforeBaseUnits || null, next.sourceRecipientBalanceAfterBaseUnits || null],
    );
    return next;
  }
}

function fromRow(row: Record<string, unknown>): CapitalProvenanceState {
  return {
    scope: String(row.scope),
    lifecycle: String(row.lifecycle) as CapitalLifecycle,
    generation: Number(row.generation),
    asset: row.asset ? String(row.asset) : undefined,
    internallyGeneratedBalance: String(row.internally_generated_balance),
    chain: row.chain ? String(row.chain) : undefined,
    originTransactionHash: row.origin_transaction_hash ? String(row.origin_transaction_hash) : undefined,
    latestExecutionKey: row.latest_execution_key ? String(row.latest_execution_key) : undefined,
    sourceRecipient: row.source_recipient ? String(row.source_recipient) : undefined,
    sourceRecipientBalanceBeforeBaseUnits: row.source_recipient_balance_before_base_units ? String(row.source_recipient_balance_before_base_units) : undefined,
    sourceRecipientBalanceAfterBaseUnits: row.source_recipient_balance_after_base_units ? String(row.source_recipient_balance_after_base_units) : undefined,
  };
}
