export type CryptoCrawlerCexVenue =
  | 'coinbase'
  | 'kraken'
  | 'okx'
  | 'binance'
  | 'kucoin'
  | 'bybit'
  | 'gate'
  | 'huobi'
  | 'mexc'
  | 'bitfinex'
  | 'cryptocom';

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
 * Capability means the codebase has an end-to-end implementation, not that a
 * particular runtime account is ready. Runtime permission, authenticated fee,
 * exact-product market data, inventory, governance and settlement evidence still
 * fail closed independently for every plan.
 */
const CAPABILITIES: Readonly<Record<CryptoCrawlerCexVenue, VenueCapability>> = Object.freeze({
  coinbase: Object.freeze({
    venue: 'coinbase',
    enabled: true,
    publicDiscovery: true,
    executableQuotes: true,
    measuredOrderBook: true,
    authenticatedFeeEvidence: true,
    liveExecution: true,
    settlementVerification: true,
    reason: 'Advanced Trade v3 product-book, authenticated permissions/fee tier, IOC order, fills, balances and terminal settlement are implemented; runtime evidence still gates every plan',
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
  mexc: Object.freeze({
    venue: 'mexc', enabled: true, publicDiscovery: true, executableQuotes: false,
    measuredOrderBook: false, authenticatedFeeEvidence: false, liveExecution: false,
    settlementVerification: false, reason: 'public spot discovery only; execution remains disabled until full measured/authenticated/settlement adapters exist',
  }),
  bitfinex: Object.freeze({
    venue: 'bitfinex', enabled: true, publicDiscovery: true, executableQuotes: false,
    measuredOrderBook: false, authenticatedFeeEvidence: false, liveExecution: false,
    settlementVerification: false, reason: 'public multi-ticker discovery only; execution remains disabled until full measured/authenticated/settlement adapters exist',
  }),
  cryptocom: Object.freeze({
    venue: 'cryptocom', enabled: true, publicDiscovery: true, executableQuotes: false,
    measuredOrderBook: false, authenticatedFeeEvidence: false, liveExecution: false,
    settlementVerification: false, reason: 'public Exchange v1 ticker discovery only; execution remains disabled until full measured/authenticated/settlement adapters exist',
  }),
});

export function getVenueCapability(venue: CryptoCrawlerCexVenue): Readonly<VenueCapability> {
  return CAPABILITIES[venue];
}

export function getVenueCapabilities(): ReadonlyArray<Readonly<VenueCapability>> {
  return Object.values(CAPABILITIES).map(capability => ({ ...capability }));
}

export function getActiveExecutableQuoteVenues(): Array<'coinbase' | 'kraken' | 'okx'> {
  return (['coinbase', 'kraken', 'okx'] as const).filter(venue => {
    const capability = CAPABILITIES[venue];
    return capability.enabled
      && capability.executableQuotes
      && capability.measuredOrderBook
      && capability.authenticatedFeeEvidence
      && capability.liveExecution
      && capability.settlementVerification;
  });
}

export function isVenueLiveExecutable(venue: CryptoCrawlerCexVenue): boolean {
  const capability = CAPABILITIES[venue];
  return capability.enabled && capability.liveExecution && capability.settlementVerification;
}
