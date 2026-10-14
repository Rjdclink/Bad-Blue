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
  searchQueries: string[];
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

function boundedPhoneInfogaQueries(
  phone: string,
  normalized: Record<string, unknown> | undefined,
  scanners: SpectraPhoneInfogaResult['scanners'],
): string[] {
  const queries = new Set<string>();
  const add = (value: string) => {
    const query = value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (query.length >= 3) queries.add(query);
  };
  const contextValue = (value: unknown) => {
    if (typeof value !== 'string') return;
    const text = value.trim().slice(0, 160);
    if (text.length >= 2) add(`"${phone}" "${text.replace(/"/g, '')}" public profile record location`);
  };
  for (const value of [normalized?.carrier, normalized?.country]) contextValue(value);

  const allowedContextKeys = new Set([
    'city', 'zip_code', 'zipcode', 'location', 'carrier',
    'country_name', 'country', 'line_type',
  ]);
  let visited = 0;
  const walk = (value: unknown, depth = 0) => {
    if (depth > 5 || visited >= 150 || queries.size >= 10) return;
    visited += 1;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 40)) walk(item, depth + 1);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 60)) {
      const lower = key.toLowerCase();
      if (lower === 'dork' && typeof child === 'string') add(child);
      else if (allowedContextKeys.has(lower)) contextValue(child);
      if (child && typeof child === 'object') walk(child, depth + 1);
      if (queries.size >= 10) break;
    }
  };
  for (const scanner of scanners) {
    if (scanner.status === 'ok') walk(scanner.result);
  }
  return [...queries].slice(0, 8);
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
    return { status: 'not-configured', scanners: [], searchQueries: [] };
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

    const normalizedContext = normalized && typeof normalized === 'object'
      ? {
          valid: normalized.valid,
          e164: normalized.e164,
          international: normalized.international,
          country: normalized.country,
          countryCode: normalized.countryCode,
          carrier: normalized.carrier,
        }
      : undefined;
    return {
      status: scanners.some(item => item.status === 'failed') ? 'partial' : 'ok',
      normalized: normalizedContext,
      scanners,
      searchQueries: boundedPhoneInfogaQueries(phone, normalizedContext, scanners),
    };
  } catch {
    return { status: 'failed', scanners: [], searchQueries: [] };
  }
}
