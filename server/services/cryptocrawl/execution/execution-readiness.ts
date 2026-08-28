import { normalizePrivateKey } from '../core/wallet-identity.js';

export interface CanonicalExecutionCapabilities {
  explicitPayloadRequired: boolean;
  genericOnChainPayloadBuilder: boolean;
  structuredOnChainPayloadBuilder: boolean;
  autonomousRoutePlanner: boolean;
  flashLoanReceiverSupport: boolean;
  liveOrderGuarded: boolean;
  privateRelayOptional: boolean;
  supportedCentralizedVenues: Array<'coinbase' | 'kraken' | 'okx'>;
}

export interface CanonicalExecutionEnvironmentReadiness {
  noExecutionGuardEnabled: boolean;
  placeholderExecutionAllowed: boolean;
  liveExecutionEnabled: boolean;
  liveExecutionConfirmed: boolean;
  rpcConfigured: boolean;
  walletConfigured: boolean;
  krakenConfigured: boolean;
  okxConfigured: boolean;
  coinbaseConfigured: boolean;
  centralizedExchangeConfigured: boolean;
  flashbotsAuthConfigured: boolean;
  privateRelayReady: boolean;
  zeroCapitalExecutionEnabled: boolean;
  zeroCapitalReceiverConfigured: boolean;
  liveCentralizedReady: boolean;
  liveOnchainReady: boolean;
  anyLiveRouteReady: boolean;
}

const CAPABILITIES: CanonicalExecutionCapabilities = Object.freeze({
  explicitPayloadRequired: true,
  genericOnChainPayloadBuilder: false,
  structuredOnChainPayloadBuilder: true,
  autonomousRoutePlanner: true,
  flashLoanReceiverSupport: true,
  liveOrderGuarded: true,
  privateRelayOptional: true,
  supportedCentralizedVenues: ['coinbase', 'kraken', 'okx'] as Array<'coinbase' | 'kraken' | 'okx'>,
});

export function getCanonicalExecutionCapabilities(): CanonicalExecutionCapabilities {
  return {
    ...CAPABILITIES,
    supportedCentralizedVenues: [...CAPABILITIES.supportedCentralizedVenues],
  };
}

/**
 * Topology-specific readiness only. A configured environment variable is not
 * treated as proven venue permission, fee, inventory, depth, settlement, or
 * execution evidence; those remain per-plan runtime gates.
 *
 * Coinbase is an optional venue. The CEX topology is environment-ready when any
 * two supported venue accounts are configured; unsupported pairings still fail
 * closed in the verifier/executor.
 *
 * Flashbots/private relays are optional enhancements to direct on-chain
 * broadcast. Their absence never makes an otherwise valid direct route unready.
 */
export function assessCanonicalExecutionEnvironment(): CanonicalExecutionEnvironmentReadiness {
  const noExecutionGuardEnabled = process.env.NO_EXECUTION === 'true';
  const placeholderExecutionAllowed = process.env.CRYPTO_ALLOW_PLACEHOLDER_EXECUTION === 'true';
  const liveExecutionEnabled = process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true';
  const liveExecutionConfirmed = process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';
  const rpcConfigured = Boolean(
    process.env.PRIVATE_RPC_URL?.trim()
    || process.env.RPC_URL?.trim()
    || process.env.ETHEREUM_RPC_URL?.trim(),
  );
  const walletConfigured = Boolean(normalizePrivateKey(process.env.WALLET_PRIVATE_KEY));
  const krakenConfigured = Boolean(process.env.KRAKEN_API_KEY?.trim() && process.env.KRAKEN_API_SECRET?.trim());
  const okxConfigured = Boolean(
    process.env.OKX_API_KEY?.trim()
    && process.env.OKX_API_SECRET?.trim()
    && process.env.OKX_API_PASSPHRASE?.trim(),
  );
  const coinbaseConfigured = Boolean(
    (process.env.COINBASE_API_KEY?.trim() || process.env.COINBASE_KEY_NAME?.trim() || process.env.CDP_API_KEY_NAME?.trim())
    && (process.env.COINBASE_API_SECRET?.trim() || process.env.COINBASE_KEY_SECRET?.trim() || process.env.CDP_API_KEY_SECRET?.trim()),
  );
  const centralizedExchangeConfigured = [krakenConfigured, okxConfigured, coinbaseConfigured].filter(Boolean).length >= 2;
  const flashbotsAuthConfigured = Boolean(normalizePrivateKey(process.env.FLASHBOTS_AUTH_KEY));
  const privateRelayReady = rpcConfigured && flashbotsAuthConfigured;
  const zeroCapitalExecutionEnabled = process.env.ZERO_CAPITAL_ENABLE_EXECUTION === 'true';
  const zeroCapitalReceiverConfigured = Boolean(process.env.ZERO_CAPITAL_FLASHLOAN_RECEIVER?.trim());

  const executionPostureOpen = !noExecutionGuardEnabled && liveExecutionEnabled && liveExecutionConfirmed;
  const liveCentralizedReady = executionPostureOpen && centralizedExchangeConfigured;
  const liveOnchainReady = executionPostureOpen
    && rpcConfigured
    && walletConfigured
    && CAPABILITIES.structuredOnChainPayloadBuilder;

  return {
    noExecutionGuardEnabled,
    placeholderExecutionAllowed,
    liveExecutionEnabled,
    liveExecutionConfirmed,
    rpcConfigured,
    walletConfigured,
    krakenConfigured,
    okxConfigured,
    coinbaseConfigured,
    centralizedExchangeConfigured,
    flashbotsAuthConfigured,
    privateRelayReady,
    zeroCapitalExecutionEnabled,
    zeroCapitalReceiverConfigured,
    liveCentralizedReady,
    liveOnchainReady,
    anyLiveRouteReady: liveCentralizedReady || liveOnchainReady,
  };
}
