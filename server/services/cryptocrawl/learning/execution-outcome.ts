export interface ExecutionOutcomeObservation {
  eventId: string;
  opportunityId?: string;
  timestamp: number;
  source: 'master_pipeline' | 'zero_capital' | 'flash_loan' | 'manual';
  chain: string;
  symbol: string;
  strategy: string;
  success: boolean;
  expectedProfitUsd: number;
  realizedProfitUsd: number;
  feeUsd: number;
  slippageBps: number;
  latencyMs: number;
  usedZeroCapital: boolean;
  provenance: string[];
  prediction?: {
    probability: number;
    expectedPositive: boolean;
    observedAt: number;
    model: 'cryptara-opportunity-assessment';
  };
}

export function getExecutionOutcomeKey(outcome: Pick<ExecutionOutcomeObservation, 'eventId' | 'opportunityId' | 'timestamp'>): string {
  return outcome.eventId || `${outcome.opportunityId || 'unknown'}:${outcome.timestamp}`;
}