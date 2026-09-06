import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { getCryptaraNetworkSpecializationLearning } from '../../cryptara/network-specialization-learning.js';
import { getCryptaraZeroInitialCapitalFundingLearning, type ZeroCapitalFundingObservationOutcome } from '../../cryptara/zero-capital-funding-learning.js';

function finiteNonNegative(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function realizedCostUsd(feedback: CryptaraExecutionFeedback): number | undefined {
  const settlement = feedback.settlement;
  if (!settlement) return finiteNonNegative(feedback.feeUsd);
  const measured = [settlement.realized.exchangeFeeUsd, settlement.realized.gasUsd]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  if (measured.length > 0) return measured.reduce((sum, value) => sum + value, 0);
  return finiteNonNegative(feedback.feeUsd);
}

function terminalOutcome(feedback: CryptaraExecutionFeedback): ZeroCapitalFundingObservationOutcome {
  const settlement = feedback.settlement;
  if (!settlement) return 'ambiguous';
  if (settlement.status === 'settlement_unknown') return 'ambiguous';
  if (feedback.success && settlement.settlementConfirmed === true && settlement.status === 'filled') return 'success';
  return 'definitive_failure';
}

function terminalProtocol(feedback: CryptaraExecutionFeedback): string | undefined {
  const route = feedback.settlement?.venueOrRoute?.trim();
  if (!route) return undefined;
  const prefix = route.split(':', 1)[0]?.trim().toLowerCase();
  return prefix || undefined;
}

/**
 * Read-only learning fan-out from the canonical, deduplicated terminal-settlement
 * seam. This function cannot submit, settle, authorize, or alter canonical BPS.
 */
export function recordTerminalNetworkAndFundingLearning(
  feedback: CryptaraExecutionFeedback,
  eventId: string,
): void {
  const settlement = feedback.settlement;
  if (!settlement || settlement.terminal !== true) return;

  const observedAt = settlement.settledAt ?? settlement.submittedAt ?? feedback.timestamp;
  const latencyMs = settlement.settledAt !== null
    ? Math.max(0, settlement.settledAt - settlement.submittedAt)
    : Math.max(0, Number.isFinite(feedback.latencyMs) ? feedback.latencyMs : 0);
  const costUsd = realizedCostUsd(feedback);
  const netProfitUsd = typeof settlement.realized.netProfitUsd === 'number' && Number.isFinite(settlement.realized.netProfitUsd)
    ? settlement.realized.netProfitUsd
    : feedback.realizedProfitUsd ?? undefined;
  const protocol = terminalProtocol(feedback);
  const provenance = [
    `terminal_feedback:${eventId}`,
    ...(feedback.provenance || []),
    ...(settlement.provenance || []),
  ].slice(0, 64);

  const networkLearning = getCryptaraNetworkSpecializationLearning();
  networkLearning.record({
    network: feedback.chain,
    protocol,
    role: 'execution',
    terminal: true,
    success: feedback.success,
    observedAt,
    latencyMs,
    realizedCostUsd: costUsd,
    realizedNetProfitUsd: netProfitUsd,
    ambiguous: settlement.status === 'settlement_unknown',
    provenance,
  });
  networkLearning.record({
    network: feedback.chain,
    protocol,
    role: 'settlement',
    terminal: true,
    success: settlement.settlementConfirmed === true,
    observedAt,
    latencyMs,
    realizedCostUsd: costUsd,
    realizedNetProfitUsd: netProfitUsd,
    ambiguous: settlement.status === 'settlement_unknown',
    provenance,
  });

  if (!feedback.usedZeroCapital || !protocol) return;

  networkLearning.record({
    network: feedback.chain,
    protocol,
    role: 'atomic_principal',
    terminal: true,
    success: feedback.success,
    observedAt,
    latencyMs,
    realizedCostUsd: costUsd,
    realizedNetProfitUsd: netProfitUsd,
    ambiguous: settlement.status === 'settlement_unknown',
    provenance,
  });

  getCryptaraZeroInitialCapitalFundingLearning().record({
    opportunityId: feedback.opportunityId || eventId,
    chain: feedback.chain,
    strategy: feedback.strategy,
    laneId: `${feedback.chain.toLowerCase()}:${protocol}`,
    provider: protocol,
    stage: 'settlement',
    outcome: terminalOutcome(feedback),
    latencyMs,
    retryOrdinal: 0,
    redundancyDepth: protocol.includes('+') ? protocol.split('+').length : 1,
    realizedCostUsd: costUsd,
    guaranteedResidualProfitUsd: typeof netProfitUsd === 'number' && netProfitUsd > 0 ? netProfitUsd : undefined,
    observedAt,
    reason: feedback.notes,
  });
}

export const terminalNetworkFundingLearningAuthority = Object.freeze({
  executionAuthority: false as const,
  settlementAuthority: false as const,
  canonicalEconomicsAuthority: false as const,
  source: 'canonical_terminal_feedback' as const,
});
