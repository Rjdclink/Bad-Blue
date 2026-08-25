import { stageManager } from '../../governance/stage-management.js';

/**
 * Railway emergency compute is bootstrap/recovery-only. Once verified paid
 * native gas meets the configured readiness threshold, the emergency Railway
 * path must remain dormant until readiness is lost again.
 */
export function isBootstrapRecoveryActive(): boolean {
  return !stageManager.isInitialGasReady();
}
