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
}

export interface Stage4CapitalProvenanceStore {
  getOrCreate(scope: string): Promise<CapitalProvenanceState>;
  markZeroGasExecutionReady(scope: string): Promise<CapitalProvenanceState>;
  markAtomicExecutionPending(scope: string, executionKey: string): Promise<CapitalProvenanceState>;
  recordVerifiedBootstrapProfit(proof: VerifiedBootstrapProfit): Promise<CapitalProvenanceState>;
  markRecoveryRequired(scope: string): Promise<CapitalProvenanceState>;
}

function requirePositiveInteger(label: string, value: string): void {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`${label} must be a positive integer string in base units`);
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

export class InMemoryStage4CapitalProvenanceStore implements Stage4CapitalProvenanceStore {
  private readonly states = new Map<string, CapitalProvenanceState>();

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
    const first = await this.transition(proof.scope, 'FIRST_PROFIT_VERIFIED', {
      asset: proof.asset,
      chain: proof.chain,
      originTransactionHash: proof.transactionHash,
      latestExecutionKey: proof.executionKey,
      internallyGeneratedBalance: proof.residualProfit,
    });
    return this.transition(first.scope, 'SELF_FUNDED', { generation: first.generation + 1 });
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
    const initial = await this.transition(proof.scope, 'FIRST_PROFIT_VERIFIED', {
      asset: proof.asset,
      chain: proof.chain,
      originTransactionHash: proof.transactionHash,
      latestExecutionKey: proof.executionKey,
      internallyGeneratedBalance: proof.residualProfit,
    });
    const funded = await this.transition(proof.scope, 'SELF_FUNDED', { generation: initial.generation + 1 });
    await this.query(
      `INSERT INTO zero_capital_capital_events (event_id, scope, lifecycle, generation, asset, amount, chain, transaction_hash, execution_key)
       VALUES ($1, $2, 'SELF_FUNDED', $3, $4, $5, $6, $7, $8)`,
      [crypto.randomUUID(), funded.scope, funded.generation, proof.asset, proof.residualProfit, proof.chain, proof.transactionHash, proof.executionKey],
    );
    return funded;
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
           origin_transaction_hash = $7, latest_execution_key = $8, updated_at = NOW()
       WHERE scope = $1`,
      [next.scope, next.lifecycle, next.generation, next.asset || null, next.internallyGeneratedBalance, next.chain || null, next.originTransactionHash || null, next.latestExecutionKey || null],
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
  };
}