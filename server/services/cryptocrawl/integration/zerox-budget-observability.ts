import logger from '../../../logger.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';

let timer: NodeJS.Timeout | null = null;

export function emitZeroXBudgetTelemetry(): void {
  const snapshot = marketDataProviders.getZeroXRequestBudgetSnapshot();
  logger.info('[CryptoRuntime] 0x local request budget', {
    component: 'ZeroXRequestBudget',
    ...snapshot,
    providerQuotaAuthoritative: false,
    tradingAuthority: false,
  });
}

export function ensureZeroXBudgetObservability(): void {
  if (timer || process.env.NO_INTERVALS === 'true') return;
  const intervalMs = Math.max(15_000, Number(process.env.ZEROX_LOCAL_BUDGET_TELEMETRY_MS || 60_000));
  emitZeroXBudgetTelemetry();
  timer = setInterval(emitZeroXBudgetTelemetry, intervalMs);
  timer.unref();
}
