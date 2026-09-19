export type CryptoCrawlerManualPowerPhase = 'OFF' | 'STARTING' | 'ON' | 'STOPPING';

let phase: CryptoCrawlerManualPowerPhase = 'OFF';
const phaseListeners = new Set<(phase: CryptoCrawlerManualPowerPhase) => void>();

export function setCryptoCrawlerManualPowerPhase(next: CryptoCrawlerManualPowerPhase): void {
  phase = next;
  process.env.CRYPTOCRAWLER_MANUAL_POWER_PHASE = next;
  for (const listener of phaseListeners) {
    try {
      listener(next);
    } catch {
      // Lifecycle state must remain authoritative even if an observer misbehaves.
    }
  }
}

export function onCryptoCrawlerManualPowerPhaseChange(
  listener: (phase: CryptoCrawlerManualPowerPhase) => void,
): () => void {
  phaseListeners.add(listener);
  return () => phaseListeners.delete(listener);
}

export function getCryptoCrawlerManualPowerPhase(): CryptoCrawlerManualPowerPhase {
  return phase;
}

export function isCryptoCrawlerDatabaseAccessAllowed(): boolean {
  return phase === 'STARTING' || phase === 'ON' || phase === 'STOPPING';
}

export function isCryptoCrawlerMasterPowerOn(): boolean {
  return phase === 'ON';
}

export function assertCryptoCrawlerDatabaseAccessAllowed(): void {
  if (!isCryptoCrawlerDatabaseAccessAllowed()) {
    throw new Error('CRYPTOCRAWLER_MASTER_POWER_OFF');
  }
}
