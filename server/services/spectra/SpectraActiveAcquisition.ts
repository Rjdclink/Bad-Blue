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
  timeoutMs: number;
}

export interface SpectraActiveAcquisitionInput {
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
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.includes(':')
    ) return null;
    const octets = host.split('.').map(Number);
    if (
      octets.length === 4 &&
      octets.every((part, index) =>
        /^\d{1,3}$/.test(host.split('.')[index])
        && Number.isInteger(part) && part >= 0 && part <= 255
      )
    ) {
      const [first, second] = octets;
      if (
        first === 0 || first === 10 || first === 127 || first >= 224 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        (first === 198 && (second === 18 || second === 19))
      ) return null;
    }
    return url;
  } catch {
    return null;
  }
}

function validProviderTemplate(raw: string): boolean {
  // The requested device reference may appear in a path or query, never
  // in a hostname/authority where it could redirect provider credentials.
  const authority = /^https:\/\/([^/?#]+)/i.exec(raw)?.[1] || '';
  if (!authority || authority.includes('{{') || authority.includes('}}')) return false;
  const substituted = raw
    .replace(/\{\{deviceRef\}\}/g, 'managed-device')
    .replace(/\{\{sessionId\}\}/g, 'session');
  return Boolean(httpsUrl(substituted));
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

function requestedDeviceMatches(reported: string, requested: string): boolean {
  const fromProvider = reported.trim().toLowerCase().split('/').pop() || '';
  const supplied = requested.trim().toLowerCase();
  if (fromProvider === supplied) return true;
  const canonicalMac = (value: string) => value.replace(/[:-]/g, '');
  return /^[a-f0-9]{2}(?:[:-]?[a-f0-9]{2}){5}$/i.test(fromProvider)
    && /^[a-f0-9]{2}(?:[:-]?[a-f0-9]{2}){5}$/i.test(supplied)
    && canonicalMac(fromProvider) === canonicalMac(supplied);
}

function normalizeProviderResponse(
  payload: unknown,
  config: ActiveProviderConfig,
  input: SpectraActiveAcquisitionInput,
): SpectraNormalizedProviderBatch {
  const outer = record(payload);
  const data = record(outer.data);
  const body = Object.keys(data).length ? data : outer;
  const requestedSession = String(input.sessionId || '').trim();
  const requestedSubject = String(input.subjectLabel || '').trim();

  for (const candidate of [outer, body]) {
    const suppliedSession = typeof candidate.sessionId === 'string'
      ? candidate.sessionId.trim() : '';
    const suppliedSubject = typeof candidate.subjectLabel === 'string'
      ? candidate.subjectLabel.trim() : '';
    if (requestedSession && suppliedSession && suppliedSession !== requestedSession) {
      throw new Error('Active provider returned telemetry for a different session.');
    }
    if (requestedSubject && suppliedSubject && suppliedSubject !== requestedSubject) {
      throw new Error('Active provider returned telemetry for a different subject.');
    }
  }

  // A device-specific provider may not substitute another device's fix.
  // Match all identifiers present, including a Cisco results-array client
  // or an Android EMM resource path, before admitting measurements.
  if (config.target === 'device' && input.deviceRef) {
    const identifiers: unknown[] = [];
    const candidates = [outer, body, ...(
      config.normalizerKind === 'cisco-spaces-location' && Array.isArray(body.results)
        ? body.results.slice(0, 200)
        : []
    )];
    for (const candidate of candidates) {
      const item = record(candidate);
      identifiers.push(item.deviceRef, item.deviceId);
      if (config.normalizerKind === 'android-managed-lost-mode') {
        identifiers.push(
          typeof item.device === 'string' ? item.device : record(item.device).id,
        );
      }
      if (config.normalizerKind === 'apple-managed-lost-mode') {
        identifiers.push(item.UDID, item.udid);
      }
      if (config.normalizerKind === 'cisco-spaces-location') {
        identifiers.push(item.macAddress, item.MacAddress, item.clientMac);
      }
    }
    const asserted = identifiers.filter((id): id is string =>
      typeof id === 'string' && id.trim().length > 0
    );
    if (asserted.some(id => !requestedDeviceMatches(id, input.deviceRef!))) {
      throw new Error('Active provider returned telemetry for a different device.');
    }
  }

  const normalized = config.normalizerKind === 'canonical-telemetry'
    ? canonicalBatch(payload, config, input)
    : normalizeSpectraProviderPayload(config.normalizerKind, config.id, {
      ...outer,
      sessionId: requestedSession || undefined,
      subjectLabel: requestedSubject || undefined,
    });
  if (
    config.target === 'none' &&
    normalized.measurements.some(measurement => measurement.kind === 'position')
  ) {
    throw new Error('Untargeted provider positions cannot establish a subject location.');
  }

  return {
    ...normalized,
    sessionId: requestedSession || undefined,
    subjectLabel: requestedSubject || undefined,
    sourceId: config.id,
    metadata: {
      ...normalized.metadata,
      acquisition: 'active-provider-pull',
      adapterId: config.id,
    },
  };
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
    return parsed.flatMap((item: any) => {
      const id = String(item?.id || '').trim().slice(0, 120);
      const url = String(item?.url || '').trim();
      const normalizerKind = String(item?.normalizerKind || '').trim();
      const method = String(item?.method || 'POST').trim().toUpperCase();
      const target = String(item?.target || 'device').trim().toLowerCase();
      const hasBoundDevice = target !== 'device'
        || method === 'POST'
        || url.includes('{{deviceRef}}');

      if (
        !id
        || seen.has(id)
        || !validProviderTemplate(url)
        || !hasBoundDevice
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
  if (!url.includes('{{deviceRef}}') || !validProviderTemplate(url) || !token) return null;

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
  if (!url.includes('{{deviceRef}}') || !validProviderTemplate(url) || !token) return null;

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
  if (!url.includes('{{deviceRef}}') || !validProviderTemplate(url) || !token) return null;

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

  const response = await fetch(url, {
    method: config.method,
    headers,
    redirect: 'error',
    body: config.method === 'POST'
      ? JSON.stringify(acquisitionBody(input))
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
    builtInAndroidMdmAdapter(),
    builtInAppleMdmAdapter(),
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
    builtInAndroidMdmAdapter(),
    builtInAppleMdmAdapter(),
    builtInCiscoSpacesAdapter(),
    ...configuredAdapters(),
  ].filter((item): item is ActiveProviderConfig => Boolean(item));

  if (!adapters.length) {
    return {
      batches: [],
      attempts: [
        {
          id: 'android-managed-location-active',
          label: 'Android managed-device latest location',
          status: 'skipped',
          normalizerKind: 'android-managed-lost-mode',
          measurementCount: 0,
          reason: 'Android managed-location provider is not configured.',
        },
        {
          id: 'apple-managed-location-active',
          label: 'Apple supervised-device latest location',
          status: 'skipped',
          normalizerKind: 'apple-managed-lost-mode',
          measurementCount: 0,
          reason: 'Apple supervised-device location provider is not configured.',
        },
        {
          id: 'cisco-spaces-active-location',
          label: 'Cisco Spaces active device location',
          status: 'skipped',
          normalizerKind: 'cisco-spaces-location',
          measurementCount: 0,
          reason: 'Cisco Spaces device-location provider is not configured.',
        },
      ],
    };
  }

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
            reason: 'Required managed-device identifier was not supplied.',
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
