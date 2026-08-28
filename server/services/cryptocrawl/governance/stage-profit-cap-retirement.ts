import { stageManager } from './stage-management.js';

let installed = false;

/**
 * Retires the historical StageManager profit-ceiling compatibility methods.
 *
 * Canonical realized accounting is recordExecutionEvidence(), which is invoked
 * only from terminal normalized settlement feedback. Historical daily profit
 * numbers remain observational/advancement metadata; they may never halt an
 * otherwise eligible positive-economics execution.
 */
export function ensureStageProfitCapRetirement(): void {
  if (installed) return;
  installed = true;

  const target = stageManager as unknown as {
    recordTrade: (profitUsd: number) => void;
    getMaxDailyProfit: () => number;
  };

  target.recordTrade = (_profitUsd: number): never => {
    throw new Error(
      'StageManager.recordTrade is retired. Realized P/L must enter governance through terminal recordExecutionEvidence().',
    );
  };

  target.getMaxDailyProfit = (): number => Number.POSITIVE_INFINITY;
}
