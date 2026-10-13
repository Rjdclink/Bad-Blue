export type CryptoCrawlerManualPowerPhase = 'OFF' | 'STARTING' | 'ON' | 'STOPPING';

let phase: CryptoCrawlerManualPowerPhase = 'OFF';
let workController = new AbortController();
workController.abort(new Error('CRYPTOCRAWLER_MASTER_POWER_OFF'));
const phaseListeners = new Set<(phase: CryptoCrawlerManualPowerPhase) => void>();

export function setCryptoCrawlerManualPowerPhase(next: CryptoCrawlerManualPowerPhase): void {
  const workAllowed = next === 'STARTING' || next === 'ON';
  if (workAllowed && workController.signal.aborted) workController = new AbortController();
  if (!workAllowed) workController.abort(new Error('CRYPTOCRAWLER_MASTER_POWER_OFF'));
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

/** Manual startup must collect prices before it can report ready. */
export function isCryptoCrawlerMarketDataAllowed(): boolean {
  return phase === 'STARTING' || phase === 'ON';
}

export function assertCryptoCrawlerDatabaseAccessAllowed(): void {
  if (!isCryptoCrawlerDatabaseAccessAllowed()) {
    throw new Error('CRYPTOCRAWLER_MASTER_POWER_OFF');
  }
}

/** Captured guards stay cancelled across a later restart. */
export function captureCryptoCrawlerWorkGuard(): () => void {
  const signal = workController.signal;
  return () => signal.throwIfAborted();
}

/** Cancels network work belonging to the current manual-power generation. */
export function cryptoCrawlerWorkSignal(): AbortSignal {
  return workController.signal;
}
