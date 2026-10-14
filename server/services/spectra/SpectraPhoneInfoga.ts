import { normalizeSpectraPhoneE164 } from './SpectraEnrolledDeviceRegistry';
import {
  bearerHeader,
  configuredSpectraEndpoint,
  fetchSpectraConfiguredJson,
  joinSpectraEndpoint,
} from './SpectraExternalSourceHttp';

export interface SpectraPhoneInfogaResult {
  status: 'not-configured' | 'ok' | 'partial' | 'failed';
  normalized?: Record<string, unknown>;
  scanners: Array<{
    scanner: string;
    status: 'ok' | 'failed';
    result?: unknown;
  }>;
}

function configuredBase(env: NodeJS.ProcessEnv): URL | null {
  return configuredSpectraEndpoint(env.SPECTRA_PHONEINFOGA_URL);
}

export function spectraPhoneInfogaConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(configuredBase(env));
}

function phoneInfogaPath(base: URL, path: string): URL {
  const prefix = base.pathname.replace(/\/+$/, '');
  return joinSpectraEndpoint(
    base,
    prefix.endsWith('/api') ? path.replace(/^\/api/, '') : path,
  );
}

function headers(env: NodeJS.ProcessEnv): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...bearerHeader(env.SPECTRA_PHONEINFOGA_TOKEN),
  };
}

function scannerNames(env: NodeJS.ProcessEnv): string[] {
  return [...new Set(
    String(env.SPECTRA_PHONEINFOGA_SCANNERS || '')
      .split(',')
      .map(value => value.trim())
      .filter(value => /^[a-z0-9_-]{1,50}$/i.test(value)),
  )].slice(0, 3);
}

export async function collectSpectraPhoneInfoga(
  phoneNumber: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SpectraPhoneInfogaResult> {
  const base = configuredBase(env);
  const phone = normalizeSpectraPhoneE164(phoneNumber);
  if (!base || !phone) {
    return { status: 'not-configured', scanners: [] };
  }

  const timeoutMs = Math.max(
    1_000,
    Math.min(15_000, Number(env.SPECTRA_PHONEINFOGA_TIMEOUT_MS || 7_000)),
  );

  try {
    const endpoint = phoneInfogaPath(base, '/api/v2/numbers');
    const normalized = await fetchSpectraConfiguredJson(endpoint, {
      method: 'POST',
      headers: headers(env),
      body: JSON.stringify({ number: phone }),
    }, timeoutMs);

    const scanners = await Promise.all(scannerNames(env).map(async scanner => {
      try {
        const scannerUrl = phoneInfogaPath(
          base,
          `/api/v2/scanners/${encodeURIComponent(scanner)}/run`,
        );
        const payload = await fetchSpectraConfiguredJson(scannerUrl, {
          method: 'POST',
          headers: headers(env),
          body: JSON.stringify({ number: phone, options: {} }),
        }, timeoutMs);
        return {
          scanner,
          status: 'ok' as const,
          result: payload?.result ?? payload,
        };
      } catch {
        return { scanner, status: 'failed' as const };
      }
    }));

    return {
      status: scanners.some(item => item.status === 'failed') ? 'partial' : 'ok',
      normalized: normalized && typeof normalized === 'object'
        ? {
            valid: normalized.valid,
            e164: normalized.e164,
            international: normalized.international,
            country: normalized.country,
            countryCode: normalized.countryCode,
            carrier: normalized.carrier,
          }
        : undefined,
      scanners,
    };
  } catch {
    return { status: 'failed', scanners: [] };
  }
}
