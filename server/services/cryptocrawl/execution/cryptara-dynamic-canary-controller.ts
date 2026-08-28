import { stageManager } from '../governance/stage-management.js';

export interface DynamicMakerCanaryDecision {
  bootstrapUsd: number;
  ceilingUsd: number;
  hardMaxUsd: number;
  samples: number;
  wins: number;
  losses: number;
  winRate: number | null;
  realizedProfitUsd: number;
  realizedLossUsd: number;
  profitFactor: number | null;
  confidenceScore: number;
  evidenceMultiplier: number;
  drawdownPenalty: number;
  sizingAuthority: 'bootstrap' | 'cryptara_realized_evidence';
}

function boundedEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}

function isMakerEvidence(item: ReturnType<typeof stageManager.getState>['cryptaraExecutionEvidence'][number]): boolean {
  const strategy = String(item.strategy || '').toLowerCase();
  const provenance = item.provenance || [];
  return strategy.includes('maker') || provenance.some(entry => String(entry).toLowerCase().includes('maker'));
}

function continuousEvidenceMultiplier(input: {
  samples: number;
  winRate: number | null;
  profitFactor: number | null;
  drawdownPenalty: number;
}): number {
  if (input.samples <= 0 || input.winRate === null) return 1;
  const sampleConfidence = 1 - Math.exp(-input.samples / 18);
  const winQuality = Math.max(0, Math.min(1, (input.winRate - 0.50) / 0.50));
  const profitQuality = input.profitFactor === null
    ? 0.35
    : Math.max(0, Math.min(1, Math.log10(Math.max(1, input.profitFactor)) / 1.5));
  const quality = Math.max(0, Math.min(1,
    sampleConfidence * (0.65 * winQuality + 0.35 * profitQuality) * input.drawdownPenalty,
  ));

  // Smooth logarithmic capital expansion. The maximum multiplier is intentionally
  // derived from the configured hard ceiling rather than a fixed tier table.
  return Math.exp(Math.log(1_000_000) * quality);
}

export function getCryptaraDynamicMakerCanaryDecision(): DynamicMakerCanaryDecision {
  const bootstrapUsd = boundedEnv('CRYPTO_ARBITRAGE_MAKER_CANARY_BOOTSTRAP_USD', 1, 1, 100);
  const hardMaxUsd = boundedEnv('CRYPTO_ARBITRAGE_MAKER_CANARY_MAX_USD', 1_000_000, bootstrapUsd, 1_000_000);
  const historyLimit = Math.floor(boundedEnv('CRYPTO_ARBITRAGE_MAKER_CANARY_EVIDENCE_WINDOW', 100, 10, 500));
  const evidence = stageManager.getState().cryptaraExecutionEvidence
    .filter(item => item.settlementConfirmed === true && isMakerEvidence(item))
    .slice(-historyLimit);

  const wins = evidence.filter(item => item.success === true && Number(item.realizedProfitUsd) > 0);
  const losses = evidence.filter(item => Number(item.realizedProfitUsd) < 0 || item.success === false);
  const realizedProfitUsd = wins.reduce((sum, item) => sum + Math.max(0, Number(item.realizedProfitUsd) || 0), 0);
  const realizedLossUsd = losses.reduce((sum, item) => sum + Math.abs(Math.min(0, Number(item.realizedProfitUsd) || 0)), 0);
  const winRate = evidence.length > 0 ? wins.length / evidence.length : null;
  const profitFactor = realizedLossUsd > 0 ? realizedProfitUsd / realizedLossUsd : realizedProfitUsd > 0 ? Number.POSITIVE_INFINITY : null;

  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const item of evidence) {
    running += Number(item.realizedProfitUsd) || 0;
    peak = Math.max(peak, running);
    maxDrawdown = Math.max(maxDrawdown, peak - running);
  }
  const drawdownReference = Math.max(bootstrapUsd, realizedProfitUsd, 1);
  const drawdownPenalty = Math.max(0.10, Math.min(1, 1 - maxDrawdown / drawdownReference));
  const evidenceMultiplier = continuousEvidenceMultiplier({
    samples: evidence.length,
    winRate,
    profitFactor,
    drawdownPenalty,
  });
  const ceilingUsd = Math.max(bootstrapUsd, Math.min(hardMaxUsd, bootstrapUsd * evidenceMultiplier));
  const confidenceScore = evidence.length === 0 || winRate === null
    ? 0
    : Math.max(0, Math.min(1, (1 - Math.exp(-evidence.length / 18)) * winRate * drawdownPenalty));

  return {
    bootstrapUsd,
    ceilingUsd,
    hardMaxUsd,
    samples: evidence.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    realizedProfitUsd,
    realizedLossUsd,
    profitFactor,
    confidenceScore,
    evidenceMultiplier,
    drawdownPenalty,
    sizingAuthority: evidence.length > 0 ? 'cryptara_realized_evidence' : 'bootstrap',
  };
}
