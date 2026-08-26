export interface ProfitEstimate {
  opportunityId: string;
  chain: string;
  grossProfitUsd: number;
  estimatedCostsUsd: number;
  estimatedNetProfitUsd: number;
  netProfitBps: number;
  confidence: number;
  observedAt: number;
  authoritative: false;
  label: 'ESTIMATE';
}

const estimates = new Map<string, ProfitEstimate>();
const MAX_ESTIMATES = Math.max(25, Number(process.env.CRYPTO_PROFIT_ESTIMATE_HISTORY || 250));

export function recordProfitEstimate(estimate: Omit<ProfitEstimate, 'authoritative' | 'label'>): ProfitEstimate {
  const value: ProfitEstimate = { ...estimate, authoritative: false, label: 'ESTIMATE' };
  estimates.set(value.opportunityId, value);
  if (estimates.size > MAX_ESTIMATES) {
    const oldest = [...estimates.values()].sort((a, b) => a.observedAt - b.observedAt)[0];
    if (oldest) estimates.delete(oldest.opportunityId);
  }
  return value;
}

export function getProfitEstimates(limit = 50): ProfitEstimate[] {
  return [...estimates.values()].sort((a, b) => b.estimatedNetProfitUsd - a.estimatedNetProfitUsd).slice(0, Math.max(1, limit));
}
