import type { SpectraNormalizedProviderBatch } from './SpectraProviderTelemetryNormalizer';
import type { SpectraEnrolledDevice } from './SpectraEnrolledDeviceRegistry';
import {
  bearerHeader,
  configuredSpectraEndpoint,
  fetchSpectraConfiguredJson,
  joinSpectraEndpoint,
  spectraFiniteNumber,
} from './SpectraExternalSourceHttp';

function configuredBase(env: NodeJS.ProcessEnv): URL | null {
  return configuredSpectraEndpoint(env.SPECTRA_TRACCAR_URL);
}

export function spectraTraccarConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(configuredBase(env) && String(env.SPECTRA_TRACCAR_TOKEN || '').trim());
}

function apiRoot(base: URL): URL {
  const normalized = new URL(base.toString());
  if (!/\/api\/?$/i.test(normalized.pathname)) {
    return joinSpectraEndpoint(normalized, '/api');
  }
  normalized.pathname = normalized.pathname.replace(/\/+$/, '');
  return normalized;
}

function timestamp(...values: unknown[]): string | null {
  for (const value of values) {
    if ((typeof value !== 'string' && typeof value !== 'number')
      || (typeof value === 'string' && !value.trim())) continue;
    const date = new Date(value as any);
    if (Number.isFinite(date.getTime()) && date.getTime() <= Date.now() + 24 * 60 * 60_000) {
      return date.toISOString();
    }
  }
  return null;
}

export async function acquireSpectraTraccar(
  device: SpectraEnrolledDevice,
  input: { sessionId?: string; subjectLabel?: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<SpectraNormalizedProviderBatch> {
  const base = configuredBase(env);
  const token = String(env.SPECTRA_TRACCAR_TOKEN || '').trim();
  if (!base || !token) throw new Error('Traccar is not configured.');
  if (!device.traccarDeviceId) {
    throw new Error('Enrolled device has no Traccar device identifier.');
  }

  const headers = {
    Accept: 'application/json',
    ...bearerHeader(token),
  };
  const root = apiRoot(base);
  const deviceUrl = joinSpectraEndpoint(root, `/devices/${device.traccarDeviceId}`);
  const devicePayload = await fetchSpectraConfiguredJson(deviceUrl, {
    method: 'GET',
    headers,
  }, Number(env.SPECTRA_TRACCAR_TIMEOUT_MS || 7_000));

  if (Number(devicePayload?.id) !== device.traccarDeviceId) {
    throw new Error('Traccar returned a different device.');
  }
  const positionUrl = joinSpectraEndpoint(root, '/positions');
  positionUrl.searchParams.set('deviceId', String(device.traccarDeviceId));
  const positions = await fetchSpectraConfiguredJson(positionUrl, {
    method: 'GET',
    headers,
  }, Number(env.SPECTRA_TRACCAR_TIMEOUT_MS || 7_000));

  const rows = Array.isArray(positions) ? positions : [];
  const row = rows
    .filter((item: any) => Number(item?.deviceId) === device.traccarDeviceId)
    .sort((left: any, right: any) =>
      Date.parse(String(right?.fixTime || right?.deviceTime || right?.serverTime || ''))
      - Date.parse(String(left?.fixTime || left?.deviceTime || left?.serverTime || ''))
    )[0];
  if (!row) throw new Error('Traccar returned no matching position for the enrolled device.');
  if (row.valid === false) {
    throw new Error('Traccar latest position is explicitly marked invalid.');
  }
  const positionId = Number(row.id);

  const latitude = spectraFiniteNumber(row.latitude);
  const longitude = spectraFiniteNumber(row.longitude);
  const observedAt = timestamp(row.fixTime, row.deviceTime, row.serverTime);
  if (
    latitude === null || latitude < -90 || latitude > 90
    || longitude === null || longitude < -180 || longitude > 180
    || !observedAt
  ) {
    throw new Error('Traccar position is missing usable coordinates or time.');
  }

  const accuracy = spectraFiniteNumber(row.accuracy);
  const altitude = spectraFiniteNumber(row.altitude);
  const speedKnots = spectraFiniteNumber(row.speed);
  const course = spectraFiniteNumber(row.course);

  return {
    sessionId: input.sessionId,
    subjectLabel: input.subjectLabel,
    sourceId: 'traccar',
    measurements: [{
      kind: 'position',
      source: 'device_gps',
      timestamp: observedAt,
      latitude,
      longitude,
      altitude: altitude ?? undefined,
      accuracy: accuracy !== null && accuracy > 0 ? accuracy : undefined,
      speed: speedKnots !== null && speedKnots >= 0
        ? speedKnots * 0.514444
        : undefined,
      heading: course !== null && course >= 0 && course <= 360 ? course : undefined,
      confidence: accuracy !== null && accuracy > 0
        ? Math.max(0.25, Math.min(0.96, 1 - Math.log10(Math.max(1, accuracy)) / 6))
        : 0.6,
      provider: 'traccar',
      recordId: Number.isSafeInteger(positionId) && positionId > 0
        ? String(positionId)
        : undefined,
      correlationGroup: `traccar:${device.deviceRef}`,
      metadata: {
        providerKind: 'traccar',
        deviceRef: device.deviceRef,
        platform: device.platform,
        traccarDeviceId: device.traccarDeviceId,
        protocol: typeof row.protocol === 'string' ? row.protocol : undefined,
        deviceStatus: typeof devicePayload.status === 'string' ? devicePayload.status : undefined,
        positionValid: row.valid === true,
        address: typeof row.address === 'string' ? row.address.slice(0, 500) : undefined,
      },
    }],
    metadata: {
      acquisition: 'traccar-pull',
      deviceRef: device.deviceRef,
      traccarDeviceId: device.traccarDeviceId,
      acquiredAt: new Date().toISOString(),
    },
  };
}
