import { tlsFingerprintRandomizer as tlsRandomizer } from './TLSFingerprintRandomizer';
import { headersPolyfill as headersPolyFill } from './HeadersPolyfill';

export { tlsFingerprintRandomizer, TLSFingerprintRandomizer } from './TLSFingerprintRandomizer';
export { headersPolyfill, HeadersPolyfill } from './HeadersPolyfill';
export { StealthInfrastructure } from './StealthInfrastructure';

// Combined stats export
export async function getStealthStats() {
  const tlsStats = tlsRandomizer.getStats();
  const headersStats = headersPolyFill.getStats();

  return {
    tls: tlsStats,
    headers: headersStats,
  };
}
