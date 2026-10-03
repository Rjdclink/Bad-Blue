import { randomUUID } from 'node:crypto';
import {
  normalizeSpectraProviderPayload,
  SPECTRA_PROVIDER_NORMALIZER_KINDS,
  type SpectraProviderNormalizerKind,
  type SpectraNormalizedProviderBatch,
} from './SpectraProviderTelemetryNormalizer';

export type SpectraActiveAcquisitionTarget =
  | 'phone'
  | 'device'
  | 'either'
  | 'none';

interface ActiveProviderConfig {
  id: string;
  label: string;
  url: string;
  method: 'GET' | 'POST';
  normalizerKind: SpectraProviderNormalizerKind | 'canonical-telemetry';
  target: SpectraActiveAcquisitionTarget;
  headersFromEnv?: Record<string, string>;
  timeoutMs: number;
}

export interface SpectraActiveAcquisitionInput {
  phoneNumber?: string;
  deviceRef?: string;
  sessionId?: string;
  subjectLabel?: string;
}

export interface SpectraActiveAcquisitionAttempt {
  id: string;
  label: string;
  status: 'fulfilled' | 'skipped' | 'failed';
  normalizerKind: string;
  measurementCount: number;
  reason?: string;
}

export interface SpectraActiveAcquisitionResult {
  batches: SpectraNormalizedProviderBatch[];
  attempts: SpectraActiveAcquisitionAttempt[];
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function normalizePhoneNumber(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return undefined;
  return `+${digits}`;
}

function normalizeDeviceRef(value?: string): string | undefined {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, 300) : undefined;
}

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.min(maximum, Math.floor(parsed))
    : fallback;
}

function timeoutMs(value: unknown): number {
  return Math.max(1_000, positiveInteger(value, 7_000, 15_000));
}

function httpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function templateUrl(
  raw: string,
  input: SpectraActiveAcquisitionInput,
): URL | null {
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  const deviceRef = normalizeDeviceRef(input.deviceRef);
  const expanded = raw
    .replace(/\{\{phoneNumber\}\}/g, encodeURIComponent(phoneNumber || ''))
    .replace(/\{\{deviceRef\}\}/g, encodeURIComponent(deviceRef || ''))
    .replace(/\{\{sessionId\}\}/g, encodeURIComponent(input.sessionId || ''));
  return httpsUrl(expanded);
}

function headersFromConfig(config: ActiveProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'LegalWhat-SPECTRA/1.0',
  };
  if (config.method === 'POST') headers['Content-Type'] = 'application/json';
  for (const [header, envName] of Object.entries(config.headersFromEnv || {})) {
    const value = String(process.env[envName] || '').trim();
    if (value) headers[header] = value;
  }
  return headers;
}

function targetAvailable(
  config: ActiveProviderConfig,
  input: SpectraActiveAcquisitionInput,
): boolean {
  const phone = Boolean(normalizePhoneNumber(input.phoneNumber));
  const device = Boolean(normalizeDeviceRef(input.deviceRef));
  if (config.target === 'none') return true;
  if (config.target === 'phone') return phone;
  if (config.target === 'device') return device;
  return phone || device;
}

function canonicalBatch(
  payload: unknown,
  config: ActiveProviderConfig,
  input: SpectraActiveAcquisitionInput,
): SpectraNormalizedProviderBatch {
  const outer = record(payload);
  const data = record(outer.data);
  const body = Object.keys(data).length ? data : outer;
  const measurements = Array.isArray(body.measurements)
    ? body.measurements.filter(item => item && typeof item === 'object')
    : [];

  if (!measurements.length) {
    throw new Error('Active provider returned no canonical telemetry measurements.');
  }

  return {
    sessionId: String(body.sessionId || input.sessionId || '').trim() || undefined,
    subjectLabel: String(body.subjectLabel || input.subjectLabel || '').trim() || undefined,
    sourceId: String(body.sourceId || config.id).trim().slice(0, 200),
    measurements: measurements.slice(0, 2000),
    metadata: {
      ...(record(body.metadata)),
      acquisition: 'active-provider-pull',
      adapterId: config.id,
      acquiredAt: new Date().toISOString(),
    },
  };
}

function normalizeProviderResponse(
  payload: unknown,
  config: ActiveProviderConfig,
  input: SpectraActiveAcquisitionInput,
): SpectraNormalizedProviderBatch {
  if (config.normalizerKind === 'canonical-telemetry') {
    return canonicalBatch(payload, config, input);
  }
  return normalizeSpectraProviderPayload(
    config.normalizerKind,
    config.id,
    {
      sessionId: input.sessionId,
      subjectLabel: input.subjectLabel,
      ...record(payload),
    },
  );
}

function configuredAdapters(): ActiveProviderConfig[] {
  const raw = String(process.env.SPECTRA_ACTIVE_PROVIDER_ADAPTERS || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    return parsed.flatMap((item: any) => {
      const id = String(item?.id || '').trim().slice(0, 120);
      const url = String(item?.url || '').trim();
      const normalizerKind = String(item?.normalizerKind || '').trim();
      const method = String(item?.method || 'POST').trim().toUpperCase();
      const target = String(item?.target || 'either').trim().toLowerCase();
      if (
        !id
        || seen.has(id)
        || !httpsUrl(url)
        || !['GET', 'POST'].includes(method)
        || !['phone', 'device', 'either', 'none'].includes(target)
        || (
          normalizerKind !== 'canonical-telemetry'
          && !SPECTRA_PROVIDER_NORMALIZER_KINDS.includes(
            normalizerKind as SpectraProviderNormalizerKind,
          )
        )
      ) return [];

      seen.add(id);
      return [{
        id,
        label: String(item?.label || id).trim().slice(0, 200) || id,
        url,
        method: method as 'GET' | 'POST',
        normalizerKind:
          normalizerKind as SpectraProviderNormalizerKind | 'canonical-telemetry',
        target: target as SpectraActiveAcquisitionTarget,
        headersFromEnv:
          item?.headersFromEnv && typeof item.headersFromEnv === 'object'
            ? Object.fromEntries(
                Object.entries(item.headersFromEnv)
                  .map(([header, envName]) => [String(header), String(envName)])
                  .filter(([header, envName]) => header && envName),
              )
            : undefined,
        timeoutMs: timeoutMs(item?.timeoutMs),
      }];
    });
  } catch {
    return [];
  }
}

function builtInCamaraAdapter(): ActiveProviderConfig | null {
  const url = String(process.env.SPECTRA_CAMARA_LOCATION_RETRIEVAL_URL || '').trim();
  const token = String(
    process.env.SPECTRA_CAMARA_LOCATION_RETRIEVAL_TOKEN
    || process.env.SPECTRA_CAMARA_BEARER_TOKEN
    || '',
  ).trim();
  if (!httpsUrl(url) || !token) return null;
  return {
    id: 'camara-location-retrieval-active',
    label: 'CAMARA network location retrieval',
    url,
    method: 'POST',
    normalizerKind: 'camara-location-retrieval',
    target: 'phone',
    headersFromEnv: {
      Authorization: process.env.SPECTRA_CAMARA_LOCATION_RETRIEVAL_TOKEN
        ? 'SPECTRA_CAMARA_LOCATION_RETRIEVAL_TOKEN'
        : 'SPECTRA_CAMARA_BEARER_TOKEN',
    },
    timeoutMs: timeoutMs(process.env.SPECTRA_CAMARA_TIMEOUT_MS),
  };
}

function builtInCiscoSpacesAdapter(): ActiveProviderConfig | null {
  const url = String(process.env.SPECTRA_CISCO_SPACES_DEVICE_URL_TEMPLATE || '').trim();
  const token = String(process.env.SPECTRA_CISCO_SPACES_TOKEN || '').trim();
  if (!httpsUrl(
    url
      .replace(/\{\{deviceRef\}\}/g, 'device')
      .replace(/\{\{phoneNumber\}\}/g, '%2B15555555555')
      .replace(/\{\{sessionId\}\}/g, 'session'),
  ) || !token) return null;

  return {
    id: 'cisco-spaces-active-location',
    label: 'Cisco Spaces active device location',
    url,
    method: 'GET',
    normalizerKind: 'cisco-spaces-location',
    target: 'device',
    headersFromEnv: {
      Authorization: 'SPECTRA_CISCO_SPACES_TOKEN',
    },
    timeoutMs: timeoutMs(process.env.SPECTRA_CISCO_SPACES_TIMEOUT_MS),
  };
}

function acquisitionBody(
  config: ActiveProviderConfig,
  input: SpectraActiveAcquisitionInput,
): Record<string, unknown> {
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  const deviceRef = normalizeDeviceRef(input.deviceRef);

  if (config.id === 'camara-location-retrieval-active') {
    const maxAge = positiveInteger(
      process.env.SPECTRA_CAMARA_MAX_AGE_SECONDS,
      60,
      86_400,
    );
    const maxSurface = positiveInteger(
      process.env.SPECTRA_CAMARA_MAX_SURFACE_M2,
      0,
      2_147_483_647,
    );
    return {
      device: phoneNumber ? { phoneNumber } : undefined,
      maxAge,
      ...(maxSurface > 0 ? { maxSurface } : {}),
    };
  }

  return {
    phoneNumber,
    deviceRef,
    sessionId: input.sessionId,
    subjectLabel: input.subjectLabel,
    requestedAt: new Date().toISOString(),
  };
}

async function fetchAdapter(
  config: ActiveProviderConfig,
  input: SpectraActiveAcquisitionInput,
): Promise<SpectraNormalizedProviderBatch> {
  const url = templateUrl(config.url, input);
  if (!url) throw new Error('Configured active-provider URL is invalid.');

  const headers = headersFromConfig(config);
  if (
    config.id === 'camara-location-retrieval-active'
    && headers.Authorization
    && !/^Bearer\s+/i.test(headers.Authorization)
  ) {
    headers.Authorization = `Bearer ${headers.Authorization}`;
  }
  if (
    config.id === 'cisco-spaces-active-location'
    && headers.Authorization
    && !/^(?:Bearer|Basic)\s+/i.test(headers.Authorization)
  ) {
    headers.Authorization = `Bearer ${headers.Authorization}`;
  }

  if (config.id === 'camara-location-retrieval-active') {
    headers['x-correlator'] = randomUUID();
  }

  const response = await fetch(url, {
    method: config.method,
    headers,
    redirect: 'error',
    body: config.method === 'POST'
      ? JSON.stringify(acquisitionBody(config, input))
      : undefined,
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Active provider returned HTTP ${response.status}.`);
  }

  const payload = await response.json();
  return normalizeProviderResponse(payload, config, input);
}

export function getSpectraActiveAcquisitionCapabilities(): Array<{
  id: string;
  label: string;
  normalizerKind: string;
  target: SpectraActiveAcquisitionTarget;
}> {
  return [
    builtInCamaraAdapter(),
    builtInCiscoSpacesAdapter(),
    ...configuredAdapters(),
  ].filter((item): item is ActiveProviderConfig => Boolean(item))
    .map(item => ({
      id: item.id,
      label: item.label,
      normalizerKind: item.normalizerKind,
      target: item.target,
    }));
}

export async function acquireSpectraActiveTelemetry(
  input: SpectraActiveAcquisitionInput,
): Promise<SpectraActiveAcquisitionResult> {
  const adapters = [
    builtInCamaraAdapter(),
    builtInCiscoSpacesAdapter(),
    ...configuredAdapters(),
  ].filter((item): item is ActiveProviderConfig => Boolean(item));

  if (!adapters.length) return { batches: [], attempts: [] };

  const outcomes = await Promise.all(
    adapters.map(async config => {
      if (!targetAvailable(config, input)) {
        return {
          batch: null,
          attempt: {
            id: config.id,
            label: config.label,
            status: 'skipped' as const,
            normalizerKind: config.normalizerKind,
            measurementCount: 0,
            reason: 'Required target identifier was not supplied.',
          },
        };
      }

      try {
        const batch = await fetchAdapter(config, input);
        return {
          batch,
          attempt: {
            id: config.id,
            label: config.label,
            status: 'fulfilled' as const,
            normalizerKind: config.normalizerKind,
            measurementCount: batch.measurements.length,
          },
        };
      } catch (error) {
        return {
          batch: null,
          attempt: {
            id: config.id,
            label: config.label,
            status: 'failed' as const,
            normalizerKind: config.normalizerKind,
            measurementCount: 0,
            reason: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }),
  );

  return {
    batches: outcomes.flatMap(outcome => outcome.batch ? [outcome.batch] : []),
    attempts: outcomes.map(outcome => outcome.attempt),
  };
}
