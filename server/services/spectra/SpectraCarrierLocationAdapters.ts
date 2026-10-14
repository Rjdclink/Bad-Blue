import type {
  SpectraActiveAcquisitionAttempt,
  SpectraActiveAcquisitionResult,
} from './SpectraActiveAcquisition';
import {
  normalizeSpectraProviderPayload,
  type SpectraNormalizedProviderBatch,
} from './SpectraProviderTelemetryNormalizer';
import { normalizeSpectraPhoneE164 } from './SpectraEnrolledDeviceRegistry';
import {
  bearerHeader,
  configuredSpectraEndpoint,
  fetchSpectraConfiguredJson,
} from './SpectraExternalSourceHttp';
import {
  getSpectraVonageBearerToken,
  spectraVonageAuthenticationConfigured,
} from './SpectraVonageAuth';

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.floor(parsed)))
    : fallback;
}

function camaraPhoneBoundMode(env: NodeJS.ProcessEnv): boolean {
  const raw = String(
    env.SPECTRA_CAMARA_LOCATION_DEVICE_SOURCE || 'phone',
  ).trim().toLowerCase();
  return raw === 'phone';
}

function phoneFromDevice(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const device = value as Record<string, unknown>;
  return normalizeSpectraPhoneE164(
    typeof device.phoneNumber === 'string' ? device.phoneNumber : undefined,
  );
}

function verifyReturnedPhone(payload: any, requestedPhone: string): void {
  const returned = phoneFromDevice(payload?.device)
    || phoneFromDevice(payload?.data?.device)
    || phoneFromDevice(payload?.location?.device);
  if (returned && returned !== requestedPhone) {
    throw new Error('Carrier location response identified a different phone number.');
  }
}

async function camaraBatch(
  phoneE164: string,
  input: { sessionId?: string; subjectLabel?: string },
  env: NodeJS.ProcessEnv,
): Promise<SpectraNormalizedProviderBatch> {
  const endpoint = configuredSpectraEndpoint(
    env.SPECTRA_CAMARA_LOCATION_RETRIEVAL_URL,
  );
  const token = String(env.SPECTRA_CAMARA_LOCATION_RETRIEVAL_TOKEN || '').trim();
  if (!endpoint || !token || !camaraPhoneBoundMode(env)) {
    throw new Error('CAMARA location retrieval is not configured.');
  }

  const maxAge = boundedInteger(
    env.SPECTRA_CARRIER_LOCATION_MAX_AGE_SECONDS,
    120,
    0,
    86_400,
  );
  const payload = await fetchSpectraConfiguredJson(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...bearerHeader(token),
    },
    body: JSON.stringify({
      device: { phoneNumber: phoneE164 },
      maxAge,
    }),
  }, boundedInteger(env.SPECTRA_CAMARA_LOCATION_TIMEOUT_MS, 7_000, 1_000, 15_000));

  verifyReturnedPhone(payload, phoneE164);
  return normalizeSpectraProviderPayload(
    'camara-location-retrieval',
    'camara-location-retrieval',
    {
      ...payload,
      sessionId: input.sessionId,
      subjectLabel: input.subjectLabel,
    },
  );
}

function vonageAsCamara(payload: any, phoneE164: string) {
  const location = payload?.location && typeof payload.location === 'object'
    ? payload.location : {};
  const type = String(location.type || '').toUpperCase();
  if (type === 'CIRCLE') {
    return {
      lastLocationTime: payload.last_location_time,
      area: {
        areaType: 'CIRCLE',
        center: location.center,
        radius: location.radius_meters,
      },
      device: { phoneNumber: phoneE164 },
    };
  }
  if (type === 'POLYGON') {
    const boundary = Array.isArray(location.boundary)
      ? location.boundary
      : Array.isArray(location.points)
        ? location.points
        : [];
    return {
      lastLocationTime: payload.last_location_time,
      area: {
        areaType: 'POLYGON',
        boundary,
      },
      device: { phoneNumber: phoneE164 },
    };
  }
  return {
    lastLocationTime: payload?.last_location_time,
    area: {},
    device: { phoneNumber: phoneE164 },
  };
}

async function vonageBatch(
  phoneE164: string,
  input: { sessionId?: string; subjectLabel?: string },
  env: NodeJS.ProcessEnv,
): Promise<SpectraNormalizedProviderBatch> {
  const token = await getSpectraVonageBearerToken(phoneE164, env);
  const endpoint = configuredSpectraEndpoint(
    env.SPECTRA_VONAGE_LOCATION_RETRIEVAL_URL
      || 'https://api-eu.vonage.com/network-location/v0.1/retrieval',
  );
  if (!endpoint) throw new Error('Vonage Device Location Retrieval URL is invalid.');

  const maxAge = boundedInteger(
    env.SPECTRA_CARRIER_LOCATION_MAX_AGE_SECONDS,
    120,
    0,
    86_400,
  );
  const payload = await fetchSpectraConfiguredJson(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...bearerHeader(token),
    },
    body: JSON.stringify({
      phone_number: phoneE164,
      location_age_seconds: maxAge,
    }),
  }, boundedInteger(env.SPECTRA_VONAGE_LOCATION_TIMEOUT_MS, 7_000, 1_000, 15_000));

  return normalizeSpectraProviderPayload(
    'camara-location-retrieval',
    'vonage-device-location',
    {
      ...vonageAsCamara(payload, phoneE164),
      sessionId: input.sessionId,
      subjectLabel: input.subjectLabel,
    },
  );
}

export function getSpectraCarrierLocationCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): Array<{ id: string; label: string; configured: boolean }> {
  return [
    {
      id: 'camara-location-retrieval-active',
      label: 'CAMARA carrier location retrieval',
      configured: Boolean(
        configuredSpectraEndpoint(env.SPECTRA_CAMARA_LOCATION_RETRIEVAL_URL)
        && String(env.SPECTRA_CAMARA_LOCATION_RETRIEVAL_TOKEN || '').trim()
        && camaraPhoneBoundMode(env)
      ),
    },
    {
      id: 'vonage-location-retrieval-active',
      label: 'Vonage Device Location Retrieval',
      configured: spectraVonageAuthenticationConfigured(env),
    },
  ];
}

export async function acquireSpectraCarrierLocations(
  phoneNumber: string,
  input: { sessionId?: string; subjectLabel?: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<SpectraActiveAcquisitionResult> {
  const phoneE164 = normalizeSpectraPhoneE164(phoneNumber);
  if (!phoneE164) {
    return {
      batches: [],
      attempts: [{
        id: 'carrier-location',
        label: 'Carrier location retrieval',
        status: 'skipped',
        normalizerKind: 'camara-location-retrieval',
        measurementCount: 0,
        reasonCode: 'missing-device',
        reason: 'An enrolled E.164 phone number was not available.',
      }],
    };
  }

  const lanes = [
    {
      id: 'camara-location-retrieval-active',
      label: 'CAMARA carrier location retrieval',
      configured: getSpectraCarrierLocationCapabilities(env)[0].configured,
      work: () => camaraBatch(phoneE164, input, env),
    },
    {
      id: 'vonage-location-retrieval-active',
      label: 'Vonage Device Location Retrieval',
      configured: getSpectraCarrierLocationCapabilities(env)[1].configured,
      work: () => vonageBatch(phoneE164, input, env),
    },
  ];

  const outcomes = await Promise.all(lanes.map(async lane => {
    if (!lane.configured) {
      const attempt: SpectraActiveAcquisitionAttempt = {
        id: lane.id,
        label: lane.label,
        status: 'skipped',
        normalizerKind: 'camara-location-retrieval',
        measurementCount: 0,
        reasonCode: 'not-configured',
        reason: `${lane.label} is not configured.`,
      };
      return { batch: null, attempt };
    }
    try {
      const batch = await lane.work();
      const attempt: SpectraActiveAcquisitionAttempt = {
        id: lane.id,
        label: lane.label,
        status: 'fulfilled',
        normalizerKind: 'camara-location-retrieval',
        measurementCount: batch.measurements.length,
      };
      return { batch, attempt };
    } catch (error) {
      const attempt: SpectraActiveAcquisitionAttempt = {
        id: lane.id,
        label: lane.label,
        status: 'failed',
        normalizerKind: 'camara-location-retrieval',
        measurementCount: 0,
        reasonCode: 'request-failed',
        reason: error instanceof Error ? error.message : String(error),
      };
      return { batch: null, attempt };
    }
  }));

  return {
    batches: outcomes.flatMap(outcome => outcome.batch ? [outcome.batch] : []),
    attempts: outcomes.map(outcome => outcome.attempt),
  };
}
