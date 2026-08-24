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
  settlement?: {
    status: string;
    terminal: boolean;
    settlementConfirmed: boolean;
    transactionHash?: string;
    blockNumber?: number;
    realizedProfitUsd?: number;
    feeUsd?: number;
    slippageBps?: number;
    latencyMs?: number;
    expectedProfitUsd?: number;
    receipts: Array<{
      transactionHash?: string;
      blockNumber?: number;
      status?: number;
      gasUsed?: string;
      effectiveGasPrice?: string;
    }>;
    provenance: string[];
  };
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