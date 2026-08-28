import logger from '../../../logger.js';
import {
  getCoinbaseKeyPermissions,
  getCoinbasePrivateAuthoritySnapshot,
  hasCoinbaseAdvancedTradeCredentials,
} from '../intelligence/coinbase-advanced-trade-authority.js';
import { getCoinbaseSpotFeeEvidence } from '../intelligence/coinbase-fee-evidence.js';

let probeInFlight: Promise<void> | null = null;
let lastProbeAt = 0;
const PROBE_TTL_MS = Math.max(30_000, Number(process.env.CRYPTO_COINBASE_READINESS_TTL_MS || 300_000));

/**
 * Verifies Coinbase Advanced Trade credentials, permissions, and the account's
 * authenticated SPOT fee tier without granting execution capability by itself.
 *
 * This probe is intentionally topology-local: invalid/unavailable Coinbase
 * credentials cannot block Kraken/OKX discovery or execution. Likewise, key
 * visibility never promotes Coinbase into the canonical executor; executable
 * market data and terminal settlement wiring must also be proven.
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

  probeInFlight = (async () => {
    const permissions = await getCoinbaseKeyPermissions(true);
    let feeEvidence: Awaited<ReturnType<typeof getCoinbaseSpotFeeEvidence>> | null = null;
    let feeError: string | null = null;
    if (permissions.canView) {
      try {
        feeEvidence = await getCoinbaseSpotFeeEvidence(true);
      } catch (error) {
        feeError = error instanceof Error ? error.message : String(error);
      }
    }
    lastProbeAt = Date.now();
    logger.info('[Coinbase] Advanced Trade credential readiness measured', {
      component: 'CoinbaseReadiness',
      canView: permissions.canView,
      canTrade: permissions.canTrade,
      canTransfer: permissions.canTransfer,
      canReceive: permissions.canReceive,
      portfolioBound: Boolean(permissions.portfolioUuid),
      authenticatedSpotFeeTier: feeEvidence ? {
        takerFeeBps: feeEvidence.takerFeeBps,
        makerFeeBps: feeEvidence.makerFeeBps,
        pricingTier: feeEvidence.pricingTier,
        source: feeEvidence.source,
      } : null,
      feeEvidenceError: feeError,
      executionPromoted: false,
      reason: permissions.canView && permissions.canTrade && feeEvidence
        ? 'key permissions and authenticated SPOT fees are verified; Coinbase remains non-executable until Advanced Trade market-data and canonical terminal-settlement integration are jointly proven'
        : permissions.canView && permissions.canTrade
          ? 'key permissions are sufficient for spot trading but authenticated SPOT fee evidence is not currently verified'
          : 'key permissions do not currently prove spot-trading readiness',
    });
  })()
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
