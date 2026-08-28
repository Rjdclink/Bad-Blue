import logger from '../../../logger.js';
import { arbitrageVerifier } from '../arbitrage/arbitrage-verifier.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';
import { endToEndLatencyHarness } from '../runtime/end-to-end-latency-harness.js';

let installed = false;

/**
 * Telemetry-only wrappers for public discovery boundaries that are already
 * canonical authorities. No return values, exceptions, cache semantics, or
 * eligibility decisions are changed.
 */
export function ensureDiscoveryLatencyInstrumentation(): void {
  if (installed) return;
  installed = true;

  const originalDiscoverUniverse = marketDataProviders.discoverUniverse.bind(marketDataProviders);
  marketDataProviders.discoverUniverse = async (...args: Parameters<typeof originalDiscoverUniverse>) => {
    const span = endToEndLatencyHarness.startSpan('ingest', 'network', {
      backend: 'market_data_universe_provider_boundary',
      provider: 'coingecko+coinstats',
      worker: 'main_process',
    });
    try {
      const result = await originalDiscoverUniverse(...args);
      span.end('ok');
      return result;
    } catch (error) {
      span.end('error');
      throw error;
    }
  };

  const originalEvaluateOnce = arbitrageVerifier.evaluateOnce.bind(arbitrageVerifier);
  arbitrageVerifier.evaluateOnce = async (...args: Parameters<typeof originalEvaluateOnce>) => {
    const request = args[0];
    const span = endToEndLatencyHarness.startSpan('deterministic_economics', 'network', {
      backend: 'arbitrage_verifier_composite_io_and_economics',
      provider: 'live_cex_quotes+authenticated_fee_evidence',
      worker: 'main_process',
      chain: request?.gas?.chain || 'cex',
      symbol: request?.symbol,
      strategy: 'verified_cex_arbitrage',
    });
    try {
      const result = await originalEvaluateOnce(...args);
      span.end('ok', result ? {
        venue: `${result.buyVenue}->${result.sellVenue}`,
        symbol: result.symbol,
      } : undefined);
      return result;
    } catch (error) {
      span.end('error');
      throw error;
    }
  };

  const originalCandidateRecord = measuredCandidateRegistry.record.bind(measuredCandidateRegistry);
  measuredCandidateRegistry.record = (input: Parameters<typeof originalCandidateRecord>[0]) => {
    const span = endToEndLatencyHarness.startSpan('candidate', 'compute', {
      traceId: input.opportunityId,
      backend: 'measured_candidate_registry',
      worker: 'main_process',
      venue: input.venues.length > 0 ? input.venues.join('->') : undefined,
      chain: input.chains.length > 0 ? input.chains.join('->') : undefined,
      symbol: input.assets.length === 1 ? input.assets[0] : undefined,
      strategy: input.topology,
    });
    try {
      const result = originalCandidateRecord(input);
      span.end('ok');
      return result;
    } catch (error) {
      span.end('error');
      throw error;
    }
  };

  logger.info('[LatencyHarness] Discovery stage instrumentation installed', {
    component: 'DiscoveryLatencyInstrumentation',
    stages: ['ingest', 'candidate', 'deterministic_economics'],
    deterministicEconomicsTimingSemantics: 'composite_live_provider_wait_plus_all_in_economics',
    authority: 'telemetry_only',
    executionAuthority: false,
    calculationAuthorityChanged: false,
  });
}
