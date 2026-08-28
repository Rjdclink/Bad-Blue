import logger from '../../../logger.js';
import { getGovernedInventoryReadiness } from '../execution/inventory-readiness-manager.js';

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

function emit(): void {
  if (inFlight) return;
  inFlight = true;
  try {
    const readiness = getGovernedInventoryReadiness();
    logger.info('[InventoryReadiness] Governed learned inventory readiness', {
      component: 'InventoryReadinessWiring',
      terminalSamples: readiness.terminalSamples,
      minimumSamplesForLearnedTarget: readiness.minimumSamplesForLearnedTarget,
      learnedTargets: readiness.learnedTargets.slice(0, 32),
      rebalancePlans: readiness.rebalancePlans.slice(0, 32),
      gasReadinessSeparated: readiness.gasReadinessSeparated,
      tokenApprovalPolicy: readiness.tokenApprovalPolicy,
      liveTransferExecutionEnabled: readiness.liveTransferExecutionEnabled,
      executionAuthority: readiness.executionAuthority,
    });
  } catch (error) {
    logger.warn('[InventoryReadiness] advisory readiness evaluation degraded', {
      component: 'InventoryReadinessWiring',
      error: error instanceof Error ? error.message : String(error),
      executionBlocked: false,
    });
  } finally {
    inFlight = false;
  }
}

export function ensureInventoryReadinessWiring(): void {
  if (timer || process.env.NO_INTERVALS === 'true') return;
  const intervalMs = Math.max(30_000, Number(process.env.CRYPTO_INVENTORY_READINESS_SWEEP_MS || 5 * 60_000));
  emit();
  timer = setInterval(emit, intervalMs);
  timer.unref();
  logger.info('[InventoryReadiness] learned inventory manager installed', {
    component: 'InventoryReadinessWiring',
    intervalMs,
    transferExecutionAuthority: false,
    learnedTargetsAdvisoryOnly: true,
    gasReadinessSeparated: true,
  });
}

export function stopInventoryReadinessWiring(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
