import type { BpsActivityRow } from '../../../../shared/bps-activity.js';
import type { ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';

const CAPACITY = 300;
const rows: BpsActivityRow[] = [];
let sequence = 0;

/** Passive in-memory observations only; no timers, transports, or startup effects. */
export function recordBpsActivity(
  before: ZeroCapitalOpportunity,
  after: { profit: bigint; amount: bigint },
  stage: BpsActivityRow['stage'],
): void {
  if (before.flashLoanAmount <= 0n || after.amount <= 0n) return;
  const toBps = (profit: bigint, amount: bigint) => Number(profit * 10_000_000_000n / amount) / 1_000_000;
  const beforeBps = toBps(before.expectedProfit, before.flashLoanAmount);
  const afterBps = toBps(after.profit, after.amount);
  if (!Number.isFinite(beforeBps) || !Number.isFinite(afterBps)) return;
  rows.push({
    sequence: ++sequence, observedAt: Date.now(), opportunityId: before.id,
    asset: before.inputAssetSymbol, beforeBps, afterBps, stage,
    improved: after.profit * before.flashLoanAmount > before.expectedProfit * after.amount,
  });
  if (rows.length > CAPACITY) rows.splice(0, rows.length - CAPACITY);
}

export function getBpsActivitySnapshot() {
  return { rows: rows.map(row => ({ ...row })), capacity: CAPACITY };
}
