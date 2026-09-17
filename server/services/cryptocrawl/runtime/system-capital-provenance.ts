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
  /** Settlement recipient delta before provider-fronted gas liability is deducted. */
  grossProfitBaseUnits: bigint;
  /** Canonical all-in net profit after every measured gas/provider liability. */
  distributableNetProfitBaseUnits: bigint;
  retainedProfitBaseUnits: bigint;
  payoutReservedBaseUnits: bigint;
  sourceRecipient: string;
  sourceRecipientBalanceBeforeBaseUnits: bigint;
  sourceRecipientBalanceAfterBaseUnits: bigint;
  /** True only when the provider/paymaster monetary obligation is proven zero. */
  zeroOperatorMonetaryGasVerified?: boolean;
  /** True when a non-zero provider/paymaster liability is measured and deducted from distributableNetProfitBaseUnits. */
  providerGasLiabilityAccounted?: boolean;
  /** True only when no operator/personal native capital funded the bootstrap transaction. */
  zeroExternalNativeCapitalVerified?: boolean;
  /** True only when no operator/personal input-token capital funded the bootstrap transaction. */
  zeroExternalInputCapitalVerified?: boolean;
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
  if (proof.grossProfitBaseUnits <= 0n) throw new Error('Verified sponsored settlement gross profit must be positive');
  if (proof.distributableNetProfitBaseUnits <= 0n) throw new Error('Verified sponsored all-in net profit must be positive');
  if (proof.distributableNetProfitBaseUnits > proof.grossProfitBaseUnits) {
    throw new Error('Verified sponsored all-in net profit cannot exceed settlement gross profit');
  }
  if (proof.retainedProfitBaseUnits <= 0n) throw new Error('Verified sponsored retained profit must be positive');
  if (proof.payoutReservedBaseUnits < 0n) throw new Error('Verified sponsored payout reserve cannot be negative');
  if (proof.retainedProfitBaseUnits + proof.payoutReservedBaseUnits !== proof.distributableNetProfitBaseUnits) {
    throw new Error('Verified sponsored retained plus payout-reserved units must equal canonical all-in net profit');
  }
  if (proof.sourceRecipientBalanceAfterBaseUnits - proof.sourceRecipientBalanceBeforeBaseUnits !== proof.grossProfitBaseUnits) {
    throw new Error('Verified sponsored settlement gross profit does not equal the operational recipient token delta');
  }
  const gasTruthVerified = proof.zeroOperatorMonetaryGasVerified === true || proof.providerGasLiabilityAccounted === true;
  if (!gasTruthVerified) {
    throw new Error('Sponsored system-capital credit requires zero sponsor cost or proof that provider gas liability was deducted from canonical net profit');
  }

  if (attempt.bootstrapPending) {
    if (
      proof.zeroExternalNativeCapitalVerified !== true ||
      proof.zeroExternalInputCapitalVerified !== true
    ) {
      throw new Error(
        'Bootstrap system-capital credit requires zero external native capital and zero external input capital',
      );
    }
    return capitalStore.recordVerifiedBootstrapProfit({
      scope: attempt.scope,
      executionKey: attempt.executionKey,
      transactionHash: proof.transactionHash,
      chain: proof.chain,
      asset: proof.asset,
      residualProfit: proof.retainedProfitBaseUnits.toString(),
      zeroMonetaryGasVerified: proof.zeroOperatorMonetaryGasVerified === true,
      providerGasLiabilityAccounted: proof.providerGasLiabilityAccounted === true,
      zeroExternalNativeCapitalVerified: proof.zeroExternalNativeCapitalVerified,
      zeroExternalInputCapitalVerified: proof.zeroExternalInputCapitalVerified,
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
    grossProfit: proof.distributableNetProfitBaseUnits.toString(),
    settlementGrossProfit: proof.grossProfitBaseUnits.toString(),
    payoutReserved: proof.payoutReservedBaseUnits.toString(),
    settlementReceiptVerified: true,
    profitRecipientDeltaVerified: true,
    sourceRecipient: proof.sourceRecipient,
    sourceRecipientBalanceBeforeBaseUnits: proof.sourceRecipientBalanceBeforeBaseUnits.toString(),
    sourceRecipientBalanceAfterBaseUnits: proof.sourceRecipientBalanceAfterBaseUnits.toString(),
  });
}
