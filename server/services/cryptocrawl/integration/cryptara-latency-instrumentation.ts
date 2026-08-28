import logger from '../../../logger.js';
import { getCryptara } from '../../cryptara/index.js';
import { endToEndLatencyHarness } from '../runtime/end-to-end-latency-harness.js';

let installed = false;

/**
 * Telemetry-only wrappers around existing public Cryptara boundaries.
 *
 * runMonteCarloSimulation is measured independently from
 * recordOpportunityObservation, so the S-80 mc_cache and ml_advisory stages do
 * not double-count the same wall-clock interval. The original methods remain the
 * sole calculation/decision authority and receive the original arguments/this.
 */
export function ensureCryptaraLatencyInstrumentation(): void {
  if (installed) return;
  installed = true;

  const cryptara = getCryptara() as any;
  const originalMonteCarlo = cryptara.runMonteCarloSimulation.bind(cryptara);
  const originalRecordObservation = cryptara.recordOpportunityObservation.bind(cryptara);

  cryptara.runMonteCarloSimulation = async (...args: unknown[]) => {
    const span = endToEndLatencyHarness.startSpan('mc_cache', 'compute', {
      backend: 'cryptara_monte_carlo',
      worker: 'main_process',
    });
    try {
      const result = await originalMonteCarlo(...args);
      span.end('ok');
      return result;
    } catch (error) {
      span.end('error');
      throw error;
    }
  };

  cryptara.recordOpportunityObservation = (context: any) => {
    const span = endToEndLatencyHarness.startSpan('ml_advisory', 'compute', {
      traceId: typeof context?.opportunityId === 'string' ? context.opportunityId : undefined,
      backend: 'cryptara_opportunity_assessment',
      worker: 'main_process',
      venue: context?.plan?.buyVenue && context?.plan?.sellVenue
        ? `${String(context.plan.buyVenue)}->${String(context.plan.sellVenue)}`
        : undefined,
      chain: typeof context?.chain === 'string' ? context.chain : undefined,
      symbol: typeof context?.symbol === 'string' ? context.symbol : undefined,
      strategy: context?.plan ? 'verified_arbitrage_assessment' : 'observed_opportunity_assessment',
    });
    try {
      const result = originalRecordObservation(context);
      span.end('ok');
      return result;
    } catch (error) {
      span.end('error');
      throw error;
    }
  };

  logger.info('[LatencyHarness] Cryptara stage instrumentation installed', {
    component: 'CryptaraLatencyInstrumentation',
    stages: ['mc_cache', 'ml_advisory'],
    authority: 'telemetry_only',
    executionAuthority: false,
    calculationAuthorityChanged: false,
  });
}
