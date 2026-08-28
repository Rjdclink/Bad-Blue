import logger from '../../../logger.js';
import { getDynamicMakerCanaryStatus } from '../execution/stablecoin-maker-strategy.js';
import { stageManager } from '../governance/stage-management.js';

let installed = false;
let listener: (() => void) | null = null;
let lastApplied = -1;

function finiteBoundedEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
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

function publishDynamicReserve(): void {
  const status = getRainbowMakerFuelStatus();

  // This value is payout-policy telemetry only. Do NOT write it into
  // CRYPTOCRAWL_INVENTORY_MIN_RESERVE_*: that inventory field is intentionally
  // unavailable to the trading executor, so using it for maker fuel would make
  // the money we are trying to preserve impossible for maker orders to consume.
  process.env.CRYPTO_RAINBOW_MAKER_FUEL_RESERVE_USD = String(status.dynamicReserveUsd);

  if (Math.abs(status.dynamicReserveUsd - lastApplied) < 1e-9) return;
  lastApplied = status.dynamicReserveUsd;
  logger.info('[RainbowBridge] Dynamic maker-fuel payout reserve updated', {
    component: 'RainbowMakerFuelReserve',
    makerCanaryCeilingUsd: status.makerCanaryCeilingUsd,
    makerProofSamples: status.proofSamples,
    makerProofWins: status.proofWins,
    makerProofWinRate: status.proofWinRate,
    bufferedCanaries: status.bufferedCanaries,
    feeBufferBps: status.feeBufferBps,
    dynamicReserveUsd: status.dynamicReserveUsd,
    inventorySpendabilityPreserved: true,
    inventoryMinimumReserveMutated: false,
    payoutProtectionSignal: 'CRYPTO_RAINBOW_MAKER_FUEL_RESERVE_USD',
  });
}

export function ensureRainbowMakerFuelReserve(): void {
  if (installed) return;
  installed = true;
  publishDynamicReserve();
  listener = () => publishDynamicReserve();
  stageManager.on('execution-evidence-recorded', listener);
}

export function stopRainbowMakerFuelReserve(): void {
  if (!installed) return;
  if (listener) stageManager.off('execution-evidence-recorded', listener);
  listener = null;
  installed = false;
}
