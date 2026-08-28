import logger from '../../../logger.js';
import { getDynamicMakerCanaryStatus } from '../execution/stablecoin-maker-strategy.js';
import { stageManager } from '../governance/stage-management.js';

const RESERVE_KEYS = [
  'CRYPTOCRAWL_INVENTORY_MIN_RESERVE_OKX_USDT',
  'CRYPTOCRAWL_INVENTORY_MIN_RESERVE_OKX_USDC',
  'CRYPTOCRAWL_INVENTORY_MIN_RESERVE_KRAKEN_USDT',
  'CRYPTOCRAWL_INVENTORY_MIN_RESERVE_KRAKEN_USDC',
] as const;

const operatorBaselines = new Map<string, number>();
let installed = false;
let listener: (() => void) | null = null;
let lastApplied = -1;

function finiteBoundedEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}

function rememberOperatorBaselines(): void {
  for (const key of RESERVE_KEYS) {
    if (operatorBaselines.has(key)) continue;
    const parsed = Number(process.env[key]);
    operatorBaselines.set(key, Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
  }
}

export interface RainbowMakerFuelStatus {
  makerCanaryCeilingUsd: number;
  proofSamples: number;
  proofWins: number;
  proofWinRate: number | null;
  bufferedCanaries: number;
  feeBufferBps: number;
  dynamicReserveUsd: number;
}

export function getRainbowMakerFuelStatus(): RainbowMakerFuelStatus {
  const proof = getDynamicMakerCanaryStatus();
  const bufferedCanaries = finiteBoundedEnv('CRYPTO_RAINBOW_MAKER_FUEL_CANARIES', 2, 1, 20);
  const feeBufferBps = finiteBoundedEnv('CRYPTO_RAINBOW_MAKER_FUEL_FEE_BUFFER_BPS', 25, 0, 500);
  const principalBuffer = proof.ceilingUsd * bufferedCanaries;
  const feeBuffer = principalBuffer * feeBufferBps / 10_000;
  return {
    makerCanaryCeilingUsd: proof.ceilingUsd,
    proofSamples: proof.samples,
    proofWins: proof.wins,
    proofWinRate: proof.winRate,
    bufferedCanaries,
    feeBufferBps,
    dynamicReserveUsd: Number((principalBuffer + feeBuffer).toFixed(6)),
  };
}

function applyDynamicReserve(): void {
  rememberOperatorBaselines();
  const status = getRainbowMakerFuelStatus();
  for (const key of RESERVE_KEYS) {
    const baseline = operatorBaselines.get(key) || 0;
    process.env[key] = String(Math.max(baseline, status.dynamicReserveUsd));
  }

  if (Math.abs(status.dynamicReserveUsd - lastApplied) < 1e-9) return;
  lastApplied = status.dynamicReserveUsd;
  logger.info('[RainbowBridge] Dynamic maker-fuel reserve updated', {
    component: 'RainbowMakerFuelReserve',
    makerCanaryCeilingUsd: status.makerCanaryCeilingUsd,
    makerProofSamples: status.proofSamples,
    makerProofWins: status.proofWins,
    makerProofWinRate: status.proofWinRate,
    bufferedCanaries: status.bufferedCanaries,
    feeBufferBps: status.feeBufferBps,
    dynamicReserveUsd: status.dynamicReserveUsd,
    venues: ['okx', 'kraken'],
    assets: ['USDT', 'USDC'],
    operatorMinimumsPreserved: true,
    payoutRule: 'rainbow_sweeps_only_inventory_above_protected_reserve',
  });
}

export function ensureRainbowMakerFuelReserve(): void {
  if (installed) return;
  installed = true;
  applyDynamicReserve();
  listener = () => applyDynamicReserve();
  stageManager.on('execution-evidence-recorded', listener);
}

export function stopRainbowMakerFuelReserve(): void {
  if (!installed) return;
  if (listener) stageManager.off('execution-evidence-recorded', listener);
  listener = null;
  installed = false;
}
