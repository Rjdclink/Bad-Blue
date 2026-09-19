export type CryptoCrawlerManualPowerPhase = 'OFF' | 'STARTING' | 'ON' | 'STOPPING';

let phase: CryptoCrawlerManualPowerPhase = 'OFF';

export function setCryptoCrawlerManualPowerPhase(next: CryptoCrawlerManualPowerPhase): void {
  phase = next;
  process.env.CRYPTOCRAWLER_MANUAL_POWER_PHASE = next;
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
