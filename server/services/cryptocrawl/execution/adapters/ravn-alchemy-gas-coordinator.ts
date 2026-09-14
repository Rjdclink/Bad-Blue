export type ExactCallGasProvider = 'ravn' | 'alchemy-gas-manager' | 'unavailable';

export interface RavnExactCallSponsorshipCapability {
  provider: 'ravn';
  supportsArbitrarySponsoredCall: boolean;
  operatorMonetaryGasCostProvenZero: boolean;
  requiresNetworkProbe: boolean;
  reason: string;
}

export interface ExactCallGasCoordinationDecision {
  provider: ExactCallGasProvider;
  preferredProvider: 'ravn';
  fallbackProvider: 'alchemy-gas-manager';
  fallbackUsed: boolean;
  networkProbeAddedBeforeFallback: boolean;
  reason: string;
}

/**
 * RAVN's current public execution contract exposes swap-specific TRANSACTION,
 * SIGNATURE, and DEPOSIT payloads. SIGNATURE can be gasless to the signer, but
 * RAVN does not currently expose an API that accepts an already-built arbitrary
 * receiver call and sponsors that exact parent transaction. ZERO_CAPITAL_ATOMIC
 * therefore cannot treat RAVN as an exact-call gas sponsor until that capability
 * is independently proven.
 *
 * Keep this as a synchronous capability fact so an incompatible RAVN lane adds
 * no request, timeout, or selection latency before the Alchemy fallback.
 */
export function getRavnExactCallSponsorshipCapability(): RavnExactCallSponsorshipCapability {
  return {
    provider: 'ravn',
    supportsArbitrarySponsoredCall: false,
    operatorMonetaryGasCostProvenZero: false,
    requiresNetworkProbe: false,
    reason: 'RAVN gasless SIGNATURE execution settles a swap through an external solver and does not currently sponsor arbitrary prebuilt flash-receiver calldata',
  };
}

/**
 * Provider coordination for the exact atomic receiver transaction only.
 *
 * RAVN is preferred when it can prove BOTH arbitrary-call sponsorship and zero
 * operator monetary gas cost. Otherwise Alchemy remains the functional billed
 * fallback. An incompatible preferred lane is rejected synchronously so it can
 * never delay the fallback or globally suppress another execution path.
 */
export function selectExactCallGasProvider(input: {
  alchemyReady: boolean;
  ravnCapability?: RavnExactCallSponsorshipCapability;
}): ExactCallGasCoordinationDecision {
  const ravn = input.ravnCapability ?? getRavnExactCallSponsorshipCapability();

  if (ravn.supportsArbitrarySponsoredCall && ravn.operatorMonetaryGasCostProvenZero) {
    return {
      provider: 'ravn',
      preferredProvider: 'ravn',
      fallbackProvider: 'alchemy-gas-manager',
      fallbackUsed: false,
      networkProbeAddedBeforeFallback: ravn.requiresNetworkProbe,
      reason: 'RAVN proves zero-cost sponsorship of the exact arbitrary atomic receiver call',
    };
  }

  if (input.alchemyReady) {
    return {
      provider: 'alchemy-gas-manager',
      preferredProvider: 'ravn',
      fallbackProvider: 'alchemy-gas-manager',
      fallbackUsed: true,
      networkProbeAddedBeforeFallback: false,
      reason: `RAVN preferred lane is not exact-call compatible: ${ravn.reason}; using functional Alchemy fallback`,
    };
  }

  return {
    provider: 'unavailable',
    preferredProvider: 'ravn',
    fallbackProvider: 'alchemy-gas-manager',
    fallbackUsed: false,
    networkProbeAddedBeforeFallback: false,
    reason: `RAVN preferred lane is not exact-call compatible: ${ravn.reason}; Alchemy fallback is unavailable`,
  };
}
