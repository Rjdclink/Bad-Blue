import logger from '../../../logger.js';
import {
  getCoinbaseKeyPermissions,
  getCoinbasePrivateAuthoritySnapshot,
  hasCoinbaseAdvancedTradeCredentials,
} from '../intelligence/coinbase-advanced-trade-authority.js';

let probeInFlight: Promise<void> | null = null;
let lastProbeAt = 0;
const PROBE_TTL_MS = Math.max(30_000, Number(process.env.CRYPTO_COINBASE_READINESS_TTL_MS || 300_000));

/**
 * Verifies the Coinbase key format and permissions without granting execution
 * capability. This probe is intentionally topology-local: invalid/unavailable
 * Coinbase credentials cannot block Kraken/OKX discovery or execution.
 */
export function ensureCoinbaseReadinessProbe(): Promise<void> {
  if (!hasCoinbaseAdvancedTradeCredentials()) {
    logger.info('[Coinbase] Advanced Trade credentials are not visible to this runtime; Coinbase remains public-discovery only', {
      component: 'CoinbaseReadiness',
      credentialAliasesChecked: [
        'COINBASE_API_KEY',
        'COINBASE_API_SECRET',
        'COINBASE_KEY_NAME',
        'COINBASE_KEY_SECRET',
        'CDP_API_KEY_NAME',
        'CDP_API_KEY_SECRET',
      ],
      executionPromoted: false,
    });
    return Promise.resolve();
  }
  if (probeInFlight) return probeInFlight;
  if (Date.now() - lastProbeAt < PROBE_TTL_MS && getCoinbasePrivateAuthoritySnapshot().permissionObservedAt) {
    return Promise.resolve();
  }

  probeInFlight = getCoinbaseKeyPermissions(true)
    .then(permissions => {
      lastProbeAt = Date.now();
      logger.info('[Coinbase] Advanced Trade credential readiness measured', {
        component: 'CoinbaseReadiness',
        canView: permissions.canView,
        canTrade: permissions.canTrade,
        canTransfer: permissions.canTransfer,
        canReceive: permissions.canReceive,
        portfolioBound: Boolean(permissions.portfolioUuid),
        executionPromoted: false,
        reason: permissions.canView && permissions.canTrade
          ? 'key permissions are sufficient for spot trading; fee and terminal-settlement adapters still require verification before capability promotion'
          : 'key permissions do not currently prove spot-trading readiness',
      });
    })
    .catch(error => {
      lastProbeAt = Date.now();
      logger.warn('[Coinbase] Advanced Trade credential probe degraded; Coinbase remains public-discovery only', {
        component: 'CoinbaseReadiness',
        error: error instanceof Error ? error.message : String(error),
        executionPromoted: false,
      });
    })
    .finally(() => { probeInFlight = null; });
  return probeInFlight;
}
