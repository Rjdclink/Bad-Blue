import {
  normalizeSpectraProviderPayload,
  SPECTRA_PROVIDER_NORMALIZER_KINDS,
  type SpectraProviderNormalizerKind,
  type SpectraNormalizedProviderBatch,
} from './SpectraProviderTelemetryNormalizer';

export type SpectraActiveAcquisitionTarget = 'device' | 'none';

interface ActiveProviderConfig {
  id: string;
  label: string;
  url: string;
  method: 'GET' | 'POST';
  normalizerKind: SpectraProviderNormalizerKind | 'canonical-telemetry';
  target: SpectraActiveAcquisitionTarget;
  headersFromEnv?: Record<string, string>;
  queryFromEnv?: Record<string, string>;
  timeoutMs: number;
}

export interface SpectraActiveAcquisitionInput {
  deviceRef?: string;
  sessionId?: string;
  subjectLabel?: string;
  signal?: AbortSignal;
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

export interface SpectraActiveAcquisitionHealth {
  id: string;
  label: string;
  state: 'healthy' | 'degraded' | 'unknown';
  normalizerKind: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastError?: string;
  measurementCount: number;
  consecutiveFailures: number;
}

const activeHealth = new Map<string, SpectraActiveAcquisitionHealth>();

function recordActiveHealth(
  config: ActiveProviderConfig,
  status: 'fulfilled' | 'failed' | 'skipped',
  measurementCount: number,
  reason?: string,
): void {
  const existing = activeHealth.get(config.id);
  const now = new Date().toISOString();
  const failed = status === 'failed';
  activeHealth.set(config.id, {
    id: config.id,
    label: config.label,
    state: status === 'fulfilled'
      ? 'healthy'
      : failed
        ? 'degraded'
        : existing?.state || 'unknown',
    normalizerKind: config.normalizerKind,
    lastAttemptAt: now,
    lastSuccessAt: status === 'fulfilled' ? now : existing?.lastSuccessAt,
    lastErrorAt: failed ? now : existing?.lastErrorAt,
    lastError: failed ? String(reason || 'Unknown provider error').slice(0, 500) : undefined,
    measurementCount: status === 'fulfilled'
      ? measurementCount
      : existing?.measurementCount || 0,
    consecutiveFailures: failed
      ? (existing?.consecutiveFailures || 0) + 1
      : status === 'fulfilled'
        ? 0
        : existing?.consecutiveFailures || 0,
  });
}

export function getSpectraActiveAcquisitionHealth(): SpectraActiveAcquisitionHealth[] {
  return [...activeHealth.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(item => ({ ...item }));
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
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
  const deviceRef = normalizeDeviceRef(input.deviceRef);
  const expanded = raw
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
  if (config.target === 'none') return true;
  return Boolean(normalizeDeviceRef(input.deviceRef));
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
  const disallowedActiveNormalizers = new Set<string>([
    'camara-location-retrieval',
    'camara-location-verification',
    'camara-reachability',
    'camara-number-verification',
    'camara-device-identifier',
    'camara-kyc-match',
  ]);
  const raw = String(process.env.SPECTRA_ACTIVE_PROVIDER_ADAPTERS || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    return parsed.slice(0, 16).flatMap((item: any) => {
      const id = String(item?.id || '').trim().slice(0, 120);
      const url = String(item?.url || '').trim();
      const normalizerKind = String(item?.normalizerKind || '').trim();
      const method = String(item?.method || 'POST').trim().toUpperCase();
      const target = String(item?.target || 'device').trim().toLowerCase();
      const validationUrl = url
        .replace(/\{\{deviceRef\}\}/g, 'managed-device')
        .replace(/\{\{sessionId\}\}/g, 'session');

      if (
        !id
        || seen.has(id)
        || !httpsUrl(validationUrl)
        || !['GET', 'POST'].includes(method)
        || !['device', 'none'].includes(target)
        || disallowedActiveNormalizers.has(normalizerKind)
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
        queryFromEnv:
          item?.queryFromEnv && typeof item.queryFromEnv === 'object'
            ? Object.fromEntries(
                Object.entries(item.queryFromEnv)
                  .map(([parameter, envName]) => [String(parameter), String(envName)])
                  .filter(([parameter, envName]) => parameter && envName),
              )
            : undefined,
        timeoutMs: timeoutMs(item?.timeoutMs),
      }];
    });
  } catch {
    return [];
  }
}

function builtInAndroidMdmAdapter(): ActiveProviderConfig | null {
  const url = String(process.env.SPECTRA_ANDROID_MDM_LOCATION_URL_TEMPLATE || '').trim();
  const token = String(process.env.SPECTRA_ANDROID_MDM_LOCATION_TOKEN || '').trim();
  const validationUrl = url
    .replace(/\{\{deviceRef\}\}/g, 'managed-device')
    .replace(/\{\{sessionId\}\}/g, 'session');
  if (!httpsUrl(validationUrl) || !token) return null;

  return {
    id: 'android-managed-location-active',
    label: 'Android managed-device latest location',
    url,
    method: 'GET',
    normalizerKind: 'android-managed-lost-mode',
    target: 'device',
    headersFromEnv: {
      Authorization: 'SPECTRA_ANDROID_MDM_LOCATION_TOKEN',
    },
    timeoutMs: timeoutMs(process.env.SPECTRA_ANDROID_MDM_LOCATION_TIMEOUT_MS),
  };
}

function builtInAppleMdmAdapter(): ActiveProviderConfig | null {
  const url = String(process.env.SPECTRA_APPLE_MDM_LOCATION_URL_TEMPLATE || '').trim();
  const token = String(process.env.SPECTRA_APPLE_MDM_LOCATION_TOKEN || '').trim();
  const validationUrl = url
    .replace(/\{\{deviceRef\}\}/g, 'managed-device')
    .replace(/\{\{sessionId\}\}/g, 'session');
  if (!httpsUrl(validationUrl) || !token) return null;

  return {
    id: 'apple-managed-location-active',
    label: 'Apple supervised-device latest location',
    url,
    method: 'GET',
    normalizerKind: 'apple-managed-lost-mode',
    target: 'device',
    headersFromEnv: {
      Authorization: 'SPECTRA_APPLE_MDM_LOCATION_TOKEN',
    },
    timeoutMs: timeoutMs(process.env.SPECTRA_APPLE_MDM_LOCATION_TIMEOUT_MS),
  };
}

function builtInCiscoSpacesAdapter(): ActiveProviderConfig | null {
  const url = String(process.env.SPECTRA_CISCO_SPACES_DEVICE_URL_TEMPLATE || '').trim();
  const token = String(process.env.SPECTRA_CISCO_SPACES_TOKEN || '').trim();
  const validationUrl = url
    .replace(/\{\{deviceRef\}\}/g, 'managed-device')
    .replace(/\{\{sessionId\}\}/g, 'session');

  if (!httpsUrl(validationUrl) || !token) return null;

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

function builtInUniFiAdapter(): ActiveProviderConfig | null {
  const url = String(process.env.SPECTRA_UNIFI_CLIENT_URL_TEMPLATE || '').trim();
  const apiKey = String(process.env.SPECTRA_UNIFI_API_KEY || '').trim();
  const validationUrl = url
    .replace(/\{\{deviceRef\}\}/g, 'managed-device')
    .replace(/\{\{sessionId\}\}/g, 'session');

  if (!httpsUrl(validationUrl) || !apiKey) return null;

  return {
    id: 'unifi-client-location',
    label: 'UniFi connected-client observation',
    url,
    method: 'GET',
    normalizerKind: 'unifi-client-location',
    target: 'device',
    headersFromEnv: {
      'X-API-Key': 'SPECTRA_UNIFI_API_KEY',
    },
    timeoutMs: timeoutMs(process.env.SPECTRA_UNIFI_TIMEOUT_MS),
  };
}

function builtInFind3Adapter(): ActiveProviderConfig | null {
  const url = String(process.env.SPECTRA_FIND3_LOCATION_URL_TEMPLATE || '').trim();
  const validationUrl = url
    .replace(/\{\{deviceRef\}\}/g, 'managed-device')
    .replace(/\{\{sessionId\}\}/g, 'session');

  if (!httpsUrl(validationUrl)) return null;

  return {
    id: 'find3-indoor-positioning',
    label: 'FIND3 indoor fingerprint location',
    url,
    method: 'GET',
    normalizerKind: 'find3-location',
    target: 'device',
    timeoutMs: timeoutMs(process.env.SPECTRA_FIND3_TIMEOUT_MS),
  };
}

function builtInTraccarAdapter(): ActiveProviderConfig | null {
  const url = String(process.env.SPECTRA_TRACCAR_POSITION_URL_TEMPLATE || '').trim();
  const validationUrl = url
    .replace(/\{\{deviceRef\}\}/g, 'managed-device')
    .replace(/\{\{sessionId\}\}/g, 'session');
  if (!httpsUrl(validationUrl)) return null;

  return {
    id: 'traccar-position-bridge',
    label: 'Traccar latest position',
    url,
    method: 'GET',
    normalizerKind: 'traccar-position',
    target: 'device',
    headersFromEnv: String(process.env.SPECTRA_TRACCAR_AUTHORIZATION || '').trim()
      ? { Authorization: 'SPECTRA_TRACCAR_AUTHORIZATION' }
      : undefined,
    timeoutMs: timeoutMs(process.env.SPECTRA_TRACCAR_TIMEOUT_MS),
  };
}

function builtInKismetAdapter(): ActiveProviderConfig | null {
  const url = String(process.env.SPECTRA_KISMET_DEVICE_URL_TEMPLATE || '').trim();
  const validationUrl = url
    .replace(/\{\{deviceRef\}\}/g, 'managed-device')
    .replace(/\{\{sessionId\}\}/g, 'session');
  if (!httpsUrl(validationUrl)) return null;

  return {
    id: 'kismet-device-location',
    label: 'Kismet geolocated device',
    url,
    method: 'GET',
    normalizerKind: 'kismet-device-location',
    target: 'device',
    queryFromEnv: String(process.env.SPECTRA_KISMET_API_KEY || '').trim()
      ? { KISMET: 'SPECTRA_KISMET_API_KEY' }
      : undefined,
    timeoutMs: timeoutMs(process.env.SPECTRA_KISMET_TIMEOUT_MS),
  };
}

function builtInOpenWispAdapter(): ActiveProviderConfig | null {
  const url = String(process.env.SPECTRA_OPENWISP_WIFI_SESSIONS_URL_TEMPLATE || '').trim();
  const validationUrl = url
    .replace(/\{\{deviceRef\}\}/g, 'managed-device')
    .replace(/\{\{sessionId\}\}/g, 'session');
  if (!httpsUrl(validationUrl)) return null;

  return {
    id: 'openwisp-wifi-session-location',
    label: 'OpenWISP Wi-Fi client session',
    url,
    method: 'GET',
    normalizerKind: 'openwisp-wifi-session',
    target: 'device',
    headersFromEnv: String(process.env.SPECTRA_OPENWISP_AUTHORIZATION || '').trim()
      ? { Authorization: 'SPECTRA_OPENWISP_AUTHORIZATION' }
      : undefined,
    timeoutMs: timeoutMs(process.env.SPECTRA_OPENWISP_TIMEOUT_MS),
  };
}

function builtInOwnTracksAdapter(): ActiveProviderConfig | null {
  const url = String(process.env.SPECTRA_OWNTRACKS_LOCATION_URL_TEMPLATE || '').trim();
  const validationUrl = url
    .replace(/\{\{deviceRef\}\}/g, 'managed-device')
    .replace(/\{\{sessionId\}\}/g, 'session');
  if (!httpsUrl(validationUrl)) return null;

  return {
    id: 'owntracks-location-bridge',
    label: 'OwnTracks Recorder latest location',
    url,
    method: 'GET',
    normalizerKind: 'owntracks-location',
    target: 'device',
    headersFromEnv: String(process.env.SPECTRA_OWNTRACKS_AUTHORIZATION || '').trim()
      ? { Authorization: 'SPECTRA_OWNTRACKS_AUTHORIZATION' }
      : undefined,
    timeoutMs: timeoutMs(process.env.SPECTRA_OWNTRACKS_TIMEOUT_MS),
  };
}

function acquisitionBody(
  input: SpectraActiveAcquisitionInput,
): Record<string, unknown> {
  return {
    deviceRef: normalizeDeviceRef(input.deviceRef),
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

  for (const [parameter, envName] of Object.entries(config.queryFromEnv || {})) {
    const value = String(process.env[envName] || '').trim();
    if (value) url.searchParams.set(parameter, value);
  }

  const headers = headersFromConfig(config);
  if (
    [
      'cisco-spaces-active-location',
      'android-managed-location-active',
      'apple-managed-location-active',
    ].includes(config.id)
    && headers.Authorization
    && !/^(?:Bearer|Basic)\s+/i.test(headers.Authorization)
  ) {
    headers.Authorization = `Bearer ${headers.Authorization}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`SPECTRA active-provider timeout after ${config.timeoutMs}ms`));
  }, config.timeoutMs);
  const relayAbort = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) relayAbort();
  else input.signal?.addEventListener('abort', relayAbort, { once: true });

  try {
    const response = await fetch(url, {
      method: config.method,
      headers,
      redirect: 'error',
      body: config.method === 'POST'
        ? JSON.stringify(acquisitionBody(input))
        : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Active provider returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    return normalizeProviderResponse(payload, config, input);
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', relayAbort);
  }
}

export function getSpectraActiveAcquisitionCapabilities(): Array<{
  id: string;
  label: string;
  normalizerKind: string;
  target: SpectraActiveAcquisitionTarget;
}> {
  return [
    builtInAndroidMdmAdapter(),
    builtInAppleMdmAdapter(),
    builtInCiscoSpacesAdapter(),
    builtInUniFiAdapter(),
    builtInFind3Adapter(),
    builtInTraccarAdapter(),
    builtInKismetAdapter(),
    builtInOpenWispAdapter(),
    builtInOwnTracksAdapter(),
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
    builtInAndroidMdmAdapter(),
    builtInAppleMdmAdapter(),
    builtInCiscoSpacesAdapter(),
    builtInUniFiAdapter(),
    builtInFind3Adapter(),
    builtInTraccarAdapter(),
    builtInKismetAdapter(),
    builtInOpenWispAdapter(),
    builtInOwnTracksAdapter(),
    ...configuredAdapters(),
  ].filter((item): item is ActiveProviderConfig => Boolean(item));

  if (!adapters.length) return { batches: [], attempts: [] };

  const outcomes = await Promise.all(
    adapters.map(async config => {
      if (!targetAvailable(config, input)) {
        const reason = 'Required managed-device identifier was not supplied.';
        recordActiveHealth(config, 'skipped', 0, reason);
        return {
          batch: null,
          attempt: {
            id: config.id,
            label: config.label,
            status: 'skipped' as const,
            normalizerKind: config.normalizerKind,
            measurementCount: 0,
            reason,
          },
        };
      }

      try {
        const batch = await fetchAdapter(config, input);
        recordActiveHealth(config, 'fulfilled', batch.measurements.length);
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
        const reason = error instanceof Error ? error.message : String(error);
        recordActiveHealth(config, 'failed', 0, reason);
        return {
          batch: null,
          attempt: {
            id: config.id,
            label: config.label,
            status: 'failed' as const,
            normalizerKind: config.normalizerKind,
            measurementCount: 0,
            reason,
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
