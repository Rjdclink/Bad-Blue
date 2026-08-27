export type CryptoCrawlerCexVenue =
  | 'coinbase'
  | 'kraken'
  | 'okx'
  | 'binance'
  | 'kucoin'
  | 'bybit'
  | 'gate'
  | 'huobi';

export interface VenueCapability {
  venue: CryptoCrawlerCexVenue;
  enabled: boolean;
  publicDiscovery: boolean;
  executableQuotes: boolean;
  measuredOrderBook: boolean;
  authenticatedFeeEvidence: boolean;
  liveExecution: boolean;
  settlementVerification: boolean;
  reason: string;
}

/**
 * Capability is not the same thing as configuration. A venue is granted only
 * the powers implemented and settlement-safe in the current codebase.
 * Discovery-only venues may help build the measured universe but cannot become
 * executable merely because a public endpoint responds.
 */
const CAPABILITIES: Readonly<Record<CryptoCrawlerCexVenue, VenueCapability>> = Object.freeze({
  coinbase: Object.freeze({
    venue: 'coinbase',
    enabled: false,
    publicDiscovery: false,
    executableQuotes: false,
    measuredOrderBook: false,
    authenticatedFeeEvidence: false,
    liveExecution: false,
    settlementVerification: false,
    reason: 'intentionally inactive; no settlement-safe Coinbase execution path is enabled',
  }),
  kraken: Object.freeze({
    venue: 'kraken',
    enabled: true,
    publicDiscovery: true,
    executableQuotes: true,
    measuredOrderBook: true,
    authenticatedFeeEvidence: true,
    liveExecution: true,
    settlementVerification: true,
    reason: 'current production CEX quote, fee, execution, and settlement path',
  }),
  okx: Object.freeze({
    venue: 'okx',
    enabled: true,
    publicDiscovery: true,
    executableQuotes: true,
    measuredOrderBook: true,
    authenticatedFeeEvidence: true,
    liveExecution: true,
    settlementVerification: true,
    reason: 'current production CEX quote, fee, execution, and settlement path',
  }),
  binance: Object.freeze({
    venue: 'binance', enabled: true, publicDiscovery: true, executableQuotes: false,
    measuredOrderBook: false, authenticatedFeeEvidence: false, liveExecution: false,
    settlementVerification: false, reason: 'public discovery only until measured quote and settlement-safe execution adapters are installed',
  }),
  kucoin: Object.freeze({
    venue: 'kucoin', enabled: true, publicDiscovery: true, executableQuotes: false,
    measuredOrderBook: false, authenticatedFeeEvidence: false, liveExecution: false,
    settlementVerification: false, reason: 'public discovery only until measured quote and settlement-safe execution adapters are installed',
  }),
  bybit: Object.freeze({
    venue: 'bybit', enabled: true, publicDiscovery: true, executableQuotes: false,
    measuredOrderBook: false, authenticatedFeeEvidence: false, liveExecution: false,
    settlementVerification: false, reason: 'public discovery only until measured quote and settlement-safe execution adapters are installed',
  }),
  gate: Object.freeze({
    venue: 'gate', enabled: true, publicDiscovery: true, executableQuotes: false,
    measuredOrderBook: false, authenticatedFeeEvidence: false, liveExecution: false,
    settlementVerification: false, reason: 'public discovery only until measured quote and settlement-safe execution adapters are installed',
  }),
  huobi: Object.freeze({
    venue: 'huobi', enabled: true, publicDiscovery: true, executableQuotes: false,
    measuredOrderBook: false, authenticatedFeeEvidence: false, liveExecution: false,
    settlementVerification: false, reason: 'public discovery only until measured quote and settlement-safe execution adapters are installed',
  }),
});

export function getVenueCapability(venue: CryptoCrawlerCexVenue): Readonly<VenueCapability> {
  return CAPABILITIES[venue];
}

export function getVenueCapabilities(): ReadonlyArray<Readonly<VenueCapability>> {
  return Object.values(CAPABILITIES).map(capability => ({ ...capability }));
}

export function getActiveExecutableQuoteVenues(): Array<'kraken' | 'okx'> {
  return (['kraken', 'okx'] as const).filter(venue => {
    const capability = CAPABILITIES[venue];
    return capability.enabled
      && capability.executableQuotes
      && capability.measuredOrderBook
      && capability.liveExecution
      && capability.settlementVerification;
  });
}

export function isVenueLiveExecutable(venue: CryptoCrawlerCexVenue): boolean {
  const capability = CAPABILITIES[venue];
  return capability.enabled && capability.liveExecution && capability.settlementVerification;
}
