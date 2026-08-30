let restartSweepPending = false;
let restartSweepReason: string | null = null;

export interface TreasuryExecutionBarrierSnapshot {
  restartSweepPending: boolean;
  reason: string | null;
}

export function setTreasuryRestartSweepBarrier(active: boolean, reason?: string): void {
  restartSweepPending = active;
  restartSweepReason = active ? (reason || 'restart_treasury_sweep_pending') : null;
}

export function getTreasuryExecutionBarrier(): TreasuryExecutionBarrierSnapshot {
  return { restartSweepPending, reason: restartSweepReason };
}