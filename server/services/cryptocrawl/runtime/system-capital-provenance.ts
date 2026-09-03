import {
  PostgresStage4CapitalProvenanceStore,
  type CapitalProvenanceState,
} from '../execution/adapters/stage4-capital-provenance.js';

const capitalStore = new PostgresStage4CapitalProvenanceStore();

export interface SponsoredSystemCapitalAttempt {
  scope: string;
  executionKey: string;
  bootstrapPending: boolean;
  stateBefore: CapitalProvenanceState;
}

export interface VerifiedSponsoredProfitEvidence {
  transactionHash: string;
  chain: string;
  asset: string;
  retainedProfitBaseUnits: bigint;
  sourceRecipient: string;
  sourceRecipientBalanceBeforeBaseUnits: bigint;
  sourceRecipientBalanceAfterBaseUnits: bigint;
}

function automaticProfitPayoutEnabled(): boolean {
  return process.env.CRYPTOCRAWL_AUTO_PROFIT_PAYOUT_ENABLED?.trim().toLowerCase() === 'true';
}

export function zeroCapitalSystemCapitalScope(input: {
  chain: string;
  inputToken: string;
  profitRecipient: string;
}): string {
  return `zero-capital:${input.chain.toLowerCase()}:${input.inputToken.toLowerCase()}:${input.profitRecipient.toLowerCase()}`;
}

export async function prepareSponsoredSystemCapital(input: {
  chain: string;
  inputToken: string;
  profitRecipient: string;
  opportunityId: string;
}): Promise<SponsoredSystemCapitalAttempt> {
  if (automaticProfitPayoutEnabled()) {
    throw new Error('System-capital bootstrap requires 100% retained-profit mode; exact payout-reserved base units are not yet available');
  }

  const scope = zeroCapitalSystemCapitalScope(input);
  const executionKey = `zero-capital:${input.chain.toLowerCase()}:${input.opportunityId}`;
  let state = await capitalStore.getOrCreate(scope);

  if (state.lifecycle === 'SELF_FUNDED') {
    return { scope, executionKey, bootstrapPending: false, stateBefore: state };
  }

  if (state.lifecycle === 'ZERO' || state.lifecycle === 'ZERO_RECOVERY_REQUIRED') {
    state = await capitalStore.markZeroGasExecutionReady(scope);
  }

  if (state.lifecycle === 'ATOMIC_EXECUTION_PENDING') {
    if (state.latestExecutionKey !== executionKey) {
      throw new Error(`System-capital bootstrap already has a different pending execution: ${state.latestExecutionKey || 'unknown'}`);
    }
    return { scope, executionKey, bootstrapPending: true, stateBefore: state };
  }

  if (state.lifecycle !== 'ZERO_GAS_EXECUTION_READY') {
    throw new Error(`System-capital bootstrap cannot prepare from lifecycle ${state.lifecycle}`);
  }

  state = await capitalStore.markAtomicExecutionPending(scope, executionKey);
  return { scope, executionKey, bootstrapPending: true, stateBefore: state };
}

export async function releaseFailedSponsoredBootstrap(attempt: SponsoredSystemCapitalAttempt | null): Promise<void> {
  if (!attempt?.bootstrapPending) return;
  const current = await capitalStore.getOrCreate(attempt.scope);
  if (current.lifecycle === 'ATOMIC_EXECUTION_PENDING' && current.latestExecutionKey === attempt.executionKey) {
    await capitalStore.markZeroGasExecutionReady(attempt.scope);
  }
}

export async function persistVerifiedSponsoredProfit(
  attempt: SponsoredSystemCapitalAttempt,
  proof: VerifiedSponsoredProfitEvidence,
): Promise<CapitalProvenanceState> {
  if (automaticProfitPayoutEnabled()) {
    throw new Error('Cannot credit the system-capital pool while automatic profit payout is enabled without exact retained base-unit allocation');
  }
  if (proof.retainedProfitBaseUnits <= 0n) throw new Error('Verified sponsored profit must be positive');
  if (proof.sourceRecipientBalanceAfterBaseUnits - proof.sourceRecipientBalanceBeforeBaseUnits !== proof.retainedProfitBaseUnits) {
    throw new Error('Verified sponsored profit does not equal the operational recipient token delta');
  }

  if (attempt.bootstrapPending) {
    return capitalStore.recordVerifiedBootstrapProfit({
      scope: attempt.scope,
      executionKey: attempt.executionKey,
      transactionHash: proof.transactionHash,
      chain: proof.chain,
      asset: proof.asset,
      residualProfit: proof.retainedProfitBaseUnits.toString(),
      zeroMonetaryGasVerified: true,
      zeroExternalNativeCapitalVerified: true,
      zeroExternalInputCapitalVerified: true,
      sourceRecipient: proof.sourceRecipient,
      sourceRecipientBalanceBeforeBaseUnits: proof.sourceRecipientBalanceBeforeBaseUnits.toString(),
      sourceRecipientBalanceAfterBaseUnits: proof.sourceRecipientBalanceAfterBaseUnits.toString(),
    });
  }

  return capitalStore.recordVerifiedRetainedProfit({
    scope: attempt.scope,
    executionKey: attempt.executionKey,
    transactionHash: proof.transactionHash,
    chain: proof.chain,
    asset: proof.asset,
    retainedProfit: proof.retainedProfitBaseUnits.toString(),
    settlementReceiptVerified: true,
    profitRecipientDeltaVerified: true,
    sourceRecipient: proof.sourceRecipient,
    sourceRecipientBalanceBeforeBaseUnits: proof.sourceRecipientBalanceBeforeBaseUnits.toString(),
    sourceRecipientBalanceAfterBaseUnits: proof.sourceRecipientBalanceAfterBaseUnits.toString(),
  });
}
