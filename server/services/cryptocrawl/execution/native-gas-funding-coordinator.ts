import { BigNumber, Wallet, utils } from 'ethers';
import { getCryptocrawlGovernance } from '../governance/index.js';

export type NativeGasFundingStrategyName = 'internal_native_reserve' | 'bridge_refuel';
export type NativeGasFundingAttemptState = 'PLANNED' | 'SUBMITTED' | 'SETTLED' | 'FAILED';

export interface VerifiedProfitEvidence {
  scope: string;
  sourceChain: string;
  sourceTransactionHash: string;
  profitToken: string;
  realizedProfitBaseUnits: string;
  recipient: string;
  sourceReceiptVerified: boolean;
  sourceBalanceEvidenceVerified: boolean;
  zeroMonetaryGasVerified: boolean;
  zeroExternalCapitalVerified: boolean;
  sourceRecipientBalanceBeforeBaseUnits?: string;
  sourceRecipientBalanceAfterBaseUnits?: string;
}

export interface NativeGasFundingRequest {
  idempotencyKey: string;
  evidence: VerifiedProfitEvidence;
  destinationChain: string;
  destinationWallet: string;
  requiredNativeWei: string;
  minimumDeliveredNativeWei?: string;
}

export interface NativeGasFundingQuote {
  strategy: NativeGasFundingStrategyName;
  available: boolean;
  economicallyViable: boolean;
  sourceProceedsRequiredBaseUnits: string;
  estimatedNetProceedsBaseUnits: string;
  estimatedCostNativeWei: string;
  estimatedDeliveredNativeWei: string;
  reimbursementRequired: boolean;
  reason: string;
}

export interface NativeGasFundingSettlement {
  strategy: NativeGasFundingStrategyName;
  state: NativeGasFundingAttemptState;
  sourceTransactionHash: string;
  destinationTransactionHash?: string;
  destinationReceiptVerified: boolean;
  destinationNativeBalanceBeforeWei?: string;
  destinationNativeBalanceAfterWei?: string;
  deliveredNativeWei?: string;
  reimbursementRequired: boolean;
  reimbursementVerified: boolean;
  sourceProceedsAllocatedBaseUnits: string;
  provenance: string[];
  error?: string;
}

export interface NativeGasFundingAttempt {
  idempotencyKey: string;
  scope: string;
  state: NativeGasFundingAttemptState;
  strategy?: NativeGasFundingStrategyName;
  sourceTransactionHash: string;
  destinationChain: string;
  destinationWallet: string;
  requiredNativeWei: string;
  destinationTransactionHash?: string;
  deliveredNativeWei?: string;
  destinationNativeBalanceBeforeWei?: string;
  destinationNativeBalanceAfterWei?: string;
  sourceProceedsAllocatedBaseUnits: string;
  reimbursementRequired: boolean;
  reimbursementVerified: boolean;
  error?: string;
}

export interface NativeGasFundingAttemptStore {
  reserve(attempt: NativeGasFundingAttempt): Promise<{ created: boolean; attempt: NativeGasFundingAttempt }>;
  update(idempotencyKey: string, update: Partial<NativeGasFundingAttempt>): Promise<void>;
}

export interface NativeGasFundingStrategy {
  readonly name: NativeGasFundingStrategyName;
  quote(request: NativeGasFundingRequest): Promise<NativeGasFundingQuote>;
  settle(request: NativeGasFundingRequest, quote: NativeGasFundingQuote): Promise<NativeGasFundingSettlement>;
}

export class NativeGasFundingSubmissionUnknownError extends Error {
  constructor(message: string, readonly transactionHash?: string) {
    super(message);
    this.name = 'NativeGasFundingSubmissionUnknownError';
  }
}

function positiveInteger(label: string, value: string): bigint {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error(`${label} must be a positive integer string`);
  return BigInt(value);
}

function address(label: string, value: string): string {
  try {
    return utils.getAddress(value);
  } catch {
    throw new Error(`${label} must be a valid EVM address`);
  }
}

function transactionHash(label: string, value: string): void {
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) throw new Error(`${label} must be a transaction hash`);
}

function requireTransactionHash(label: string, value: string | undefined): string {
  if (!value) throw new Error(`${label} is required`);
  transactionHash(label, value);
  return value;
}

function requireVerifiedProfit(evidence: VerifiedProfitEvidence): void {
  const realizedProfit = positiveInteger('realizedProfitBaseUnits', evidence.realizedProfitBaseUnits);
  transactionHash('sourceTransactionHash', evidence.sourceTransactionHash);
  address('profit recipient', evidence.recipient);
  if (!evidence.sourceReceiptVerified || !evidence.sourceBalanceEvidenceVerified ||
      !evidence.zeroMonetaryGasVerified || !evidence.zeroExternalCapitalVerified) {
    throw new Error('Native-gas funding requires receipt-backed zero-capital realized-profit evidence');
  }
  if (evidence.sourceChain === 'europa') {
    if (evidence.sourceRecipientBalanceBeforeBaseUnits === undefined || evidence.sourceRecipientBalanceAfterBaseUnits === undefined) {
      throw new Error('Europa native-gas funding requires source-recipient balance evidence');
    }
    let before: bigint;
    let after: bigint;
    try {
      before = BigInt(evidence.sourceRecipientBalanceBeforeBaseUnits);
      after = BigInt(evidence.sourceRecipientBalanceAfterBaseUnits);
    } catch {
      throw new Error('Europa source-recipient balance evidence must be integer strings');
    }
    if (before !== 0n || after < before || after - before < realizedProfit) {
      throw new Error('Europa native-gas funding requires proof that verified profit was created from a zero input-token starting balance');
    }
  }
}

function expectedChainId(chain: string): number | null {
  return ({ ethereum: 1, polygon: 137, arbitrum: 42161, optimism: 10, bsc: 56, avalanche: 43114 } as Record<string, number>)[chain] || null;
}

export class InMemoryNativeGasFundingAttemptStore implements NativeGasFundingAttemptStore {
  private readonly attempts = new Map<string, NativeGasFundingAttempt>();

  async reserve(attempt: NativeGasFundingAttempt): Promise<{ created: boolean; attempt: NativeGasFundingAttempt }> {
    const existing = this.attempts.get(attempt.idempotencyKey);
    if (existing) return { created: false, attempt: { ...existing } };
    this.attempts.set(attempt.idempotencyKey, { ...attempt });
    return { created: true, attempt: { ...attempt } };
  }

  async update(idempotencyKey: string, update: Partial<NativeGasFundingAttempt>): Promise<void> {
    const current = this.attempts.get(idempotencyKey);
    if (!current) throw new Error(`Native-gas funding attempt ${idempotencyKey} does not exist`);
    this.attempts.set(idempotencyKey, { ...current, ...update });
  }
}

export class PostgresNativeGasFundingAttemptStore implements NativeGasFundingAttemptStore {
  private async query(text: string, values: unknown[]) {
    const { pool } = await import('../../../db.js');
    return pool.query(text, values);
  }

  async reserve(attempt: NativeGasFundingAttempt): Promise<{ created: boolean; attempt: NativeGasFundingAttempt }> {
    const inserted = await this.query(
      `INSERT INTO zero_capital_native_gas_funding_attempts (
        idempotency_key, scope, state, strategy, source_transaction_hash,
        destination_chain, destination_wallet, required_native_wei,
        destination_transaction_hash, delivered_native_wei, reimbursement_verified, error,
        destination_native_balance_before_wei, destination_native_balance_after_wei,
        source_proceeds_allocated_base_units, reimbursement_required
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
      [attempt.idempotencyKey, attempt.scope, attempt.state, attempt.strategy || null, attempt.sourceTransactionHash,
        attempt.destinationChain, attempt.destinationWallet, attempt.requiredNativeWei,
        attempt.destinationTransactionHash || null, attempt.deliveredNativeWei || null,
        attempt.reimbursementVerified, attempt.error || null,
        attempt.destinationNativeBalanceBeforeWei || null, attempt.destinationNativeBalanceAfterWei || null,
        attempt.sourceProceedsAllocatedBaseUnits, attempt.reimbursementRequired],
    );
    if (inserted.rows[0]) return { created: true, attempt: this.fromRow(inserted.rows[0]) };
    const existing = await this.query('SELECT * FROM zero_capital_native_gas_funding_attempts WHERE idempotency_key = $1', [attempt.idempotencyKey]);
    if (!existing.rows[0]) throw new Error(`Native-gas funding attempt ${attempt.idempotencyKey} could not be loaded after conflict`);
    return { created: false, attempt: this.fromRow(existing.rows[0]) };
  }

  async update(idempotencyKey: string, update: Partial<NativeGasFundingAttempt>): Promise<void> {
    await this.query(
      `UPDATE zero_capital_native_gas_funding_attempts
       SET state = COALESCE($2, state), strategy = COALESCE($3, strategy),
           destination_transaction_hash = COALESCE($4, destination_transaction_hash),
           delivered_native_wei = COALESCE($5, delivered_native_wei),
           reimbursement_verified = COALESCE($6, reimbursement_verified),
            error = COALESCE($7, error),
            destination_native_balance_before_wei = COALESCE($8, destination_native_balance_before_wei),
            destination_native_balance_after_wei = COALESCE($9, destination_native_balance_after_wei),
            source_proceeds_allocated_base_units = COALESCE($10, source_proceeds_allocated_base_units),
            reimbursement_required = COALESCE($11, reimbursement_required), updated_at = NOW()
       WHERE idempotency_key = $1`,
      [idempotencyKey, update.state || null, update.strategy || null, update.destinationTransactionHash || null,
          update.deliveredNativeWei || null, update.reimbursementVerified ?? null, update.error || null,
          update.destinationNativeBalanceBeforeWei || null, update.destinationNativeBalanceAfterWei || null,
          update.sourceProceedsAllocatedBaseUnits || null, update.reimbursementRequired ?? null],
    );
  }

  private fromRow(row: Record<string, unknown>): NativeGasFundingAttempt {
    return {
      idempotencyKey: String(row.idempotency_key),
      scope: String(row.scope),
      state: String(row.state) as NativeGasFundingAttemptState,
      strategy: row.strategy ? String(row.strategy) as NativeGasFundingStrategyName : undefined,
      sourceTransactionHash: String(row.source_transaction_hash),
      destinationChain: String(row.destination_chain),
      destinationWallet: String(row.destination_wallet),
      requiredNativeWei: String(row.required_native_wei),
      destinationTransactionHash: row.destination_transaction_hash ? String(row.destination_transaction_hash) : undefined,
      deliveredNativeWei: row.delivered_native_wei ? String(row.delivered_native_wei) : undefined,
      destinationNativeBalanceBeforeWei: row.destination_native_balance_before_wei ? String(row.destination_native_balance_before_wei) : undefined,
      destinationNativeBalanceAfterWei: row.destination_native_balance_after_wei ? String(row.destination_native_balance_after_wei) : undefined,
      sourceProceedsAllocatedBaseUnits: String(row.source_proceeds_allocated_base_units || '0'),
      reimbursementRequired: Boolean(row.reimbursement_required),
      reimbursementVerified: Boolean(row.reimbursement_verified),
      error: row.error ? String(row.error) : undefined,
    };
  }
}

/**
 * Real same-chain reserve transfer. This is deliberately separate from the
 * Europa profit source: it is only available when a configured reserve wallet
 * already has native currency and therefore cannot fake initial funding.
 */
export class InternalNativeReserveStrategy implements NativeGasFundingStrategy {
  readonly name = 'internal_native_reserve' as const;

  constructor(private readonly reserveWallet: Wallet) {}

  async quote(request: NativeGasFundingRequest): Promise<NativeGasFundingQuote> {
    const required = positiveInteger('requiredNativeWei', request.requiredNativeWei);
    const provider = this.reserveWallet.provider;
    if (!provider) return this.unavailable('Native reserve wallet has no connected provider');
    const chainId = expectedChainId(request.destinationChain);
    if (!chainId) return this.unavailable(`Unsupported paid-chain destination ${request.destinationChain}`);
    const network = await provider.getNetwork();
    if (network.chainId !== chainId) return this.unavailable(`Reserve provider chain mismatch: expected ${chainId}, received ${network.chainId}`);

    const destination = address('destinationWallet', request.destinationWallet);
    const reserveAddress = await this.reserveWallet.getAddress();
    if (reserveAddress.toLowerCase() === destination.toLowerCase()) return this.unavailable('Reserve wallet and execution wallet must be different');
    const gasPrice = (await provider.getFeeData()).gasPrice;
    if (!gasPrice) return this.unavailable('Live reserve gas price is unavailable');
    const gasLimit = await provider.estimateGas({ from: reserveAddress, to: destination, value: BigNumber.from(required.toString()) });
    const gasCost = gasLimit.mul(gasPrice);
    const balance = await provider.getBalance(reserveAddress);
    if (balance.lt(BigNumber.from(required.toString()).add(gasCost))) {
      return this.unavailable('Internal native reserve cannot cover delivery and transaction gas');
    }
    return {
      strategy: this.name,
      available: true,
      economicallyViable: true,
      sourceProceedsRequiredBaseUnits: '0',
      estimatedNetProceedsBaseUnits: '0',
      estimatedCostNativeWei: gasCost.toString(),
      estimatedDeliveredNativeWei: required.toString(),
      reimbursementRequired: false,
      reason: 'Live reserve balance and gas estimate support a same-chain native transfer',
    };
  }

  async settle(request: NativeGasFundingRequest, quote: NativeGasFundingQuote): Promise<NativeGasFundingSettlement> {
    if (!quote.available) throw new Error(quote.reason);
    const provider = this.reserveWallet.provider;
    if (!provider) throw new Error('Native reserve wallet provider disappeared');
    const destination = address('destinationWallet', request.destinationWallet);
    const required = BigNumber.from(positiveInteger('requiredNativeWei', request.requiredNativeWei).toString());
    getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: request.destinationChain, pair: 'NATIVE_GAS_SETTLEMENT', venue: 'internal_native_reserve' });
    const before = await provider.getBalance(destination);
    let transaction;
    try {
      transaction = await this.reserveWallet.sendTransaction({ to: destination, value: required });
    } catch (error) {
      throw new NativeGasFundingSubmissionUnknownError(
        `Native reserve submission outcome is unknown: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    let receipt;
    try {
      receipt = await transaction.wait();
    } catch (error) {
      throw new NativeGasFundingSubmissionUnknownError(
        `Native reserve receipt outcome is unknown: ${error instanceof Error ? error.message : String(error)}`,
        transaction.hash,
      );
    }
    if (!receipt || receipt.status !== 1) throw new Error('Native reserve transfer receipt was missing or reverted');
    const after = await provider.getBalance(destination);
    const delivered = after.sub(before);
    const minimum = BigNumber.from(positiveInteger('minimumDeliveredNativeWei', request.minimumDeliveredNativeWei || request.requiredNativeWei).toString());
    if (delivered.lt(minimum)) throw new Error(`Native reserve transfer delivered ${delivered.toString()} wei, below minimum ${minimum.toString()}`);
    return {
      strategy: this.name,
      state: 'SETTLED',
      sourceTransactionHash: request.evidence.sourceTransactionHash,
      destinationTransactionHash: receipt.transactionHash || transaction.hash,
      destinationReceiptVerified: true,
      destinationNativeBalanceBeforeWei: before.toString(),
      destinationNativeBalanceAfterWei: after.toString(),
      deliveredNativeWei: delivered.toString(),
      reimbursementRequired: false,
      reimbursementVerified: true,
      sourceProceedsAllocatedBaseUnits: '0',
      provenance: [
        `source_receipt:${request.evidence.sourceTransactionHash}`,
        `destination_receipt:${receipt.transactionHash || transaction.hash}`,
        'native_balance_delta_verified',
        'internal_native_reserve',
      ],
    };
  }

  private unavailable(reason: string): NativeGasFundingQuote {
    return {
      strategy: this.name,
      available: false,
      economicallyViable: false,
      sourceProceedsRequiredBaseUnits: '0',
      estimatedNetProceedsBaseUnits: '0',
      estimatedCostNativeWei: '0',
      estimatedDeliveredNativeWei: '0',
      reimbursementRequired: false,
      reason,
    };
  }
}

export class NativeGasFundingCoordinator {
  constructor(
    private readonly strategies: readonly NativeGasFundingStrategy[],
    private readonly store: NativeGasFundingAttemptStore,
  ) {}

  async settleVerifiedProfit(request: NativeGasFundingRequest): Promise<NativeGasFundingSettlement> {
    requireVerifiedProfit(request.evidence);
    const destination = address('destinationWallet', request.destinationWallet);
    if (request.evidence.sourceChain === 'europa') {
      request = {
        ...request,
        destinationWallet: destination,
        idempotencyKey: `europa-profit-native-gas:${request.evidence.sourceTransactionHash.toLowerCase()}:${request.destinationChain.toLowerCase()}:${destination.toLowerCase()}`,
      };
    }
    const required = positiveInteger('requiredNativeWei', request.requiredNativeWei);
    const reserved = await this.store.reserve({
      idempotencyKey: request.idempotencyKey,
      scope: request.evidence.scope,
      state: 'PLANNED',
      sourceTransactionHash: request.evidence.sourceTransactionHash,
      destinationChain: request.destinationChain,
      destinationWallet: destination,
      requiredNativeWei: required.toString(),
      sourceProceedsAllocatedBaseUnits: '0',
      reimbursementRequired: false,
      reimbursementVerified: false,
    });
    if (!reserved.created) {
      if (reserved.attempt.state === 'SETTLED' && reserved.attempt.destinationTransactionHash && reserved.attempt.deliveredNativeWei) {
        return {
          strategy: reserved.attempt.strategy || 'internal_native_reserve',
          state: 'SETTLED',
          sourceTransactionHash: reserved.attempt.sourceTransactionHash,
          destinationTransactionHash: reserved.attempt.destinationTransactionHash,
          destinationReceiptVerified: true,
          destinationNativeBalanceBeforeWei: reserved.attempt.destinationNativeBalanceBeforeWei,
          destinationNativeBalanceAfterWei: reserved.attempt.destinationNativeBalanceAfterWei,
          deliveredNativeWei: reserved.attempt.deliveredNativeWei,
          reimbursementRequired: reserved.attempt.reimbursementRequired,
          reimbursementVerified: reserved.attempt.reimbursementVerified,
          sourceProceedsAllocatedBaseUnits: reserved.attempt.sourceProceedsAllocatedBaseUnits,
          provenance: ['persisted_funding_settlement_reconciled'],
        };
      }
      if (reserved.attempt.state !== 'FAILED' || reserved.attempt.destinationTransactionHash) {
        return {
          strategy: reserved.attempt.strategy || 'internal_native_reserve',
          state: reserved.attempt.state,
          sourceTransactionHash: reserved.attempt.sourceTransactionHash,
          destinationTransactionHash: reserved.attempt.destinationTransactionHash,
          destinationReceiptVerified: false,
          destinationNativeBalanceBeforeWei: reserved.attempt.destinationNativeBalanceBeforeWei,
          destinationNativeBalanceAfterWei: reserved.attempt.destinationNativeBalanceAfterWei,
          deliveredNativeWei: reserved.attempt.deliveredNativeWei,
          reimbursementRequired: reserved.attempt.reimbursementRequired,
          reimbursementVerified: reserved.attempt.reimbursementVerified,
          sourceProceedsAllocatedBaseUnits: reserved.attempt.sourceProceedsAllocatedBaseUnits,
          provenance: ['persisted_funding_attempt_requires_reconciliation'],
          error: reserved.attempt.error || 'Funding attempt already exists and is not settled',
        };
      }
      await this.store.update(request.idempotencyKey, { state: 'PLANNED', error: undefined });
    }

    const quotes = await Promise.all(this.strategies.map(async strategy => {
      try {
        return { strategy, quote: await strategy.quote(request) };
      } catch (error) {
        return {
          strategy,
          quote: {
            strategy: strategy.name,
            available: false,
            economicallyViable: false,
            sourceProceedsRequiredBaseUnits: '0',
            estimatedNetProceedsBaseUnits: '0',
            estimatedCostNativeWei: '0',
            estimatedDeliveredNativeWei: '0',
            reimbursementRequired: false,
            reason: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }));
    const candidates = quotes.filter(candidate =>
      candidate.quote.available &&
      !(request.evidence.sourceChain === 'europa' && candidate.quote.strategy === 'internal_native_reserve') &&
      this.isEconomicallyViable(request, candidate.quote)
    ).sort((left, right) => {
      const leftCost = BigInt(left.quote.estimatedCostNativeWei);
      const rightCost = BigInt(right.quote.estimatedCostNativeWei);
      return leftCost < rightCost ? -1 : leftCost > rightCost ? 1 : 0;
    });
    if (candidates.length === 0) {
      const reason = quotes.map(candidate => `${candidate.quote.strategy}: ${candidate.quote.reason}`).join('; ') || 'No native-gas funding strategy is configured';
      await this.store.update(request.idempotencyKey, { state: 'FAILED', error: reason });
      return {
        strategy: 'internal_native_reserve',
        state: 'FAILED',
        sourceTransactionHash: request.evidence.sourceTransactionHash,
        destinationReceiptVerified: false,
        reimbursementRequired: false,
        reimbursementVerified: false,
        sourceProceedsAllocatedBaseUnits: '0',
        provenance: ['verified_profit_present', 'native_gas_strategy_unavailable'],
        error: reason,
      };
    }

    let lastError = 'All native-gas funding strategies failed';
    for (const candidate of candidates) {
      await this.store.update(request.idempotencyKey, { state: 'SUBMITTED', strategy: candidate.quote.strategy });
      try {
        const settlement = await candidate.strategy.settle(request, candidate.quote);
        if (settlement.strategy !== candidate.quote.strategy) {
          throw new Error(`Funding strategy returned mismatched settlement strategy ${settlement.strategy}`);
        }
        this.validateSettlement(request, settlement, candidate.quote);
        if (settlement.reimbursementRequired && !settlement.reimbursementVerified) {
          throw new Error('Funding settlement completed without verified sponsor reimbursement');
        }
        await this.store.update(request.idempotencyKey, {
          state: settlement.state,
          strategy: settlement.strategy,
          destinationTransactionHash: settlement.destinationTransactionHash,
          deliveredNativeWei: settlement.deliveredNativeWei,
          destinationNativeBalanceBeforeWei: settlement.destinationNativeBalanceBeforeWei,
          destinationNativeBalanceAfterWei: settlement.destinationNativeBalanceAfterWei,
          sourceProceedsAllocatedBaseUnits: settlement.sourceProceedsAllocatedBaseUnits,
          reimbursementRequired: settlement.reimbursementRequired,
          reimbursementVerified: settlement.reimbursementVerified,
          error: settlement.error,
        });
        return settlement;
      } catch (error) {
        lastError = `${candidate.quote.strategy}: ${error instanceof Error ? error.message : String(error)}`;
        if (error instanceof NativeGasFundingSubmissionUnknownError) {
          await this.store.update(request.idempotencyKey, {
            state: 'SUBMITTED',
            strategy: candidate.quote.strategy,
            destinationTransactionHash: error.transactionHash,
            error: lastError,
          });
          return {
            strategy: candidate.quote.strategy,
            state: 'SUBMITTED',
            sourceTransactionHash: request.evidence.sourceTransactionHash,
            destinationTransactionHash: error.transactionHash,
            destinationReceiptVerified: false,
            reimbursementRequired: candidate.quote.reimbursementRequired,
            reimbursementVerified: false,
            sourceProceedsAllocatedBaseUnits: '0',
            provenance: ['funding_submission_outcome_unknown', 'reconciliation_required'],
            error: lastError,
          };
        }
        await this.store.update(request.idempotencyKey, { state: 'FAILED', strategy: candidate.quote.strategy, error: lastError });
      }
    }
    return {
      strategy: candidates[0].quote.strategy,
      state: 'FAILED',
      sourceTransactionHash: request.evidence.sourceTransactionHash,
      destinationReceiptVerified: false,
      reimbursementRequired: false,
      reimbursementVerified: false,
      sourceProceedsAllocatedBaseUnits: '0',
      provenance: ['verified_profit_present', 'all_funding_strategies_failed'],
      error: lastError,
    };
  }

  private validateSettlement(request: NativeGasFundingRequest, settlement: NativeGasFundingSettlement, quote: NativeGasFundingQuote): void {
    if (settlement.state !== 'SETTLED' || !settlement.destinationReceiptVerified) {
      throw new Error('Funding strategy did not prove a successful destination receipt');
    }
    if (settlement.sourceTransactionHash !== request.evidence.sourceTransactionHash) {
      throw new Error('Funding settlement source transaction does not match verified profit evidence');
    }
    requireTransactionHash('destinationTransactionHash', settlement.destinationTransactionHash);
    const delivered = positiveInteger('deliveredNativeWei', settlement.deliveredNativeWei || '0');
    const minimum = positiveInteger('minimumDeliveredNativeWei', request.minimumDeliveredNativeWei || request.requiredNativeWei);
    if (delivered < minimum) {
      throw new Error(`Funding strategy delivered ${delivered.toString()} wei, below minimum ${minimum.toString()}`);
    }
    const allocated = BigInt(settlement.sourceProceedsAllocatedBaseUnits || '0');
    const availableProfit = positiveInteger('realizedProfitBaseUnits', request.evidence.realizedProfitBaseUnits);
    if (allocated < 0n || allocated > availableProfit) {
      throw new Error('Funding strategy allocated more source proceeds than verified realized profit');
    }
    const quotedAllocation = BigInt(quote.sourceProceedsRequiredBaseUnits);
    if (settlement.reimbursementRequired !== quote.reimbursementRequired || allocated < quotedAllocation) {
      throw new Error('Funding settlement does not satisfy the quoted reimbursement economics');
    }
    if (settlement.destinationNativeBalanceBeforeWei !== undefined || settlement.destinationNativeBalanceAfterWei !== undefined) {
      if (settlement.destinationNativeBalanceBeforeWei === undefined || settlement.destinationNativeBalanceAfterWei === undefined) {
        throw new Error('Funding settlement must provide both destination native balance measurements');
      }
      const before = BigInt(settlement.destinationNativeBalanceBeforeWei);
      const after = BigInt(settlement.destinationNativeBalanceAfterWei);
      if (before < 0n || after < before || after - before !== delivered) {
        throw new Error('Funding settlement native balance delta does not match delivered native currency');
      }
    }
    if (settlement.reimbursementRequired && !settlement.reimbursementVerified) {
      throw new Error('Funding settlement completed without verified sponsor reimbursement');
    }
  }

  private isEconomicallyViable(request: NativeGasFundingRequest, quote: NativeGasFundingQuote): boolean {
    if (!quote.economicallyViable) return false;
    let required: bigint;
    let net: bigint;
    let profit: bigint;
    let cost: bigint;
    let delivered: bigint;
    let minimum: bigint;
    try {
      required = BigInt(quote.sourceProceedsRequiredBaseUnits);
      net = BigInt(quote.estimatedNetProceedsBaseUnits);
      profit = BigInt(request.evidence.realizedProfitBaseUnits);
      cost = BigInt(quote.estimatedCostNativeWei);
      delivered = BigInt(quote.estimatedDeliveredNativeWei);
      minimum = BigInt(request.minimumDeliveredNativeWei || request.requiredNativeWei);
    } catch {
      return false;
    }
    if (required < 0n || net < 0n || cost < 0n || delivered < minimum || required > profit) return false;
    return !quote.reimbursementRequired || (required > 0n && net > 0n);
  }
}