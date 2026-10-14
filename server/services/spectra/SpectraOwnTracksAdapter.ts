import type { SpectraNormalizedProviderBatch } from './SpectraProviderTelemetryNormalizer';
import type { SpectraEnrolledDevice } from './SpectraEnrolledDeviceRegistry';
import {
  basicHeader,
  bearerHeader,
  configuredSpectraEndpoint,
  fetchSpectraConfiguredJson,
  joinSpectraEndpoint,
} from './SpectraExternalSourceHttp';

function timestamp(value: unknown): string | null {
  const numeric = Number(value);
  const raw = Number.isFinite(numeric)
    ? (Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric)
    : value;
  const date = new Date(raw as any);
  const time = date.getTime();
  return Number.isFinite(time) && time <= Date.now() + 24 * 60 * 60_000
    ? date.toISOString()
    : null;
}

function configuredBase(env: NodeJS.ProcessEnv): URL | null {
  return configuredSpectraEndpoint(env.SPECTRA_OWNTRACKS_RECORDER_URL);
}

export function spectraOwnTracksConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(configuredBase(env));
}

function recorderLocationsEndpoint(base: URL): URL {
  const path = base.pathname.replace(/\/+$/, '');
  return joinSpectraEndpoint(
    base,
    path.endsWith('/owntracks') ? '/api/0/locations' : '/owntracks/api/0/locations',
  );
}

function authorization(env: NodeJS.ProcessEnv): Record<string, string> {
  const explicit = String(env.SPECTRA_OWNTRACKS_AUTHORIZATION || '').trim();
  if (explicit) return bearerHeader(explicit);
  return basicHeader(
    env.SPECTRA_OWNTRACKS_USERNAME,
    env.SPECTRA_OWNTRACKS_PASSWORD,
  );
}

function matchingTopic(
  topic: unknown,
  user: string,
  device: string,
): boolean {
  if (typeof topic !== 'string' || !topic.trim()) return true;
  return topic.trim().toLowerCase()
    === `owntracks/${user}/${device}`.toLowerCase();
}

export async function acquireSpectraOwnTracks(
  device: SpectraEnrolledDevice,
  input: { sessionId?: string; subjectLabel?: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<SpectraNormalizedProviderBatch> {
  const base = configuredBase(env);
  if (!base) throw new Error('OwnTracks Recorder is not configured.');
  const user = String(device.ownTracksUser || '').trim();
  const tracker = String(device.ownTracksDevice || '').trim();
  if (!user || !tracker) {
    throw new Error('Enrolled device has no OwnTracks user/device binding.');
  }

  const endpoint = recorderLocationsEndpoint(base);
  const body = new URLSearchParams({ user, device: tracker });
  const payload = await fetchSpectraConfiguredJson(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...authorization(env),
    },
    body: body.toString(),
  }, Number(env.SPECTRA_OWNTRACKS_TIMEOUT_MS || 7_000));

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const measurements = rows.flatMap((row: any) => {
    if (!row || row._type !== 'location') return [];
    if (!matchingTopic(row.topic, user, tracker)) return [];
    const latitude = Number(row.lat);
    const longitude = Number(row.lon);
    const observedAt = timestamp(row.tst ?? row.isotst);
    if (
      !Number.isFinite(latitude)
      || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude)
      || longitude < -180 || longitude > 180
      || !observedAt
    ) return [];
    const accuracy = Number(row.acc);
    const altitude = Number(row.alt);
    const speedKph = Number(row.vel);
    const heading = Number(row.cog);
    return [{
      kind: 'position',
      source: 'device_gps',
      timestamp: observedAt,
      latitude,
      longitude,
      altitude: Number.isFinite(altitude) ? altitude : undefined,
      accuracy: Number.isFinite(accuracy) && accuracy > 0 ? accuracy : undefined,
      speed: Number.isFinite(speedKph) && speedKph >= 0 ? speedKph / 3.6 : undefined,
      heading: Number.isFinite(heading) && heading >= 0 && heading <= 360 ? heading : undefined,
      confidence: Number.isFinite(accuracy) && accuracy > 0
        ? Math.max(0.25, Math.min(0.96, 1 - Math.log10(Math.max(1, accuracy)) / 6))
        : 0.6,
      provider: 'owntracks-recorder',
      correlationGroup: `owntracks:${device.deviceRef}`,
      metadata: {
        providerKind: 'owntracks-recorder',
        deviceRef: device.deviceRef,
        platform: device.platform,
        ownTracksUser: user,
        ownTracksDevice: tracker,
        trigger: typeof row.t === 'string' ? row.t : undefined,
        batteryPercent: Number.isFinite(Number(row.batt)) ? Number(row.batt) : undefined,
        connectivity: typeof row.conn === 'string' ? row.conn : undefined,
      },
    }];
  }).sort((left: any, right: any) =>
    Date.parse(right.timestamp) - Date.parse(left.timestamp)
  ).slice(0, 8);

  if (!measurements.length) {
    throw new Error('OwnTracks returned no usable location measurements for the enrolled device.');
  }

  return {
    sessionId: input.sessionId,
    subjectLabel: input.subjectLabel,
    sourceId: 'owntracks-recorder',
    measurements,
    metadata: {
      acquisition: 'owntracks-recorder-pull',
      deviceRef: device.deviceRef,
      recordCount: measurements.length,
      acquiredAt: new Date().toISOString(),
    },
  };
}
