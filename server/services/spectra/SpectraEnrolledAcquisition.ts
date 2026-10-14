import {
  acquireSpectraActiveTelemetry,
  getSpectraActiveAcquisitionCapabilities,
  type SpectraActiveAcquisitionAttempt,
  type SpectraActiveAcquisitionResult,
} from './SpectraActiveAcquisition';
import {
  resolveSpectraEnrolledDevice,
  resolveSpectraEnrolledDeviceByRef,
  type SpectraEnrolledDeviceResolution,
} from './SpectraEnrolledDeviceRegistry';
import {
  acquireSpectraOwnTracks,
  spectraOwnTracksConfigured,
} from './SpectraOwnTracksAdapter';
import {
  acquireSpectraTraccar,
  spectraTraccarConfigured,
} from './SpectraTraccarAdapter';
import {
  acquireSpectraCarrierLocations,
  getSpectraCarrierLocationCapabilities,
} from './SpectraCarrierLocationAdapters';

export interface SpectraEnrolledAcquisitionInput {
  userId: string;
  phoneNumber?: string;
  deviceRef?: string;
  sessionId?: string;
  subjectLabel?: string;
}

export interface SpectraEnrolledAcquisitionResult extends SpectraActiveAcquisitionResult {
  resolvedDeviceRef?: string;
  resolution?: SpectraEnrolledDeviceResolution;
}

interface Deps {
  resolve: typeof resolveSpectraEnrolledDevice;
  resolveByRef: typeof resolveSpectraEnrolledDeviceByRef;
  active: typeof acquireSpectraActiveTelemetry;
  ownTracks: typeof acquireSpectraOwnTracks;
  traccar: typeof acquireSpectraTraccar;
  carrier: typeof acquireSpectraCarrierLocations;
}

function failedResolutionAttempt(
  resolution: SpectraEnrolledDeviceResolution,
): SpectraActiveAcquisitionAttempt {
  if (resolution.status === 'not-enrolled') {
    return {
      id: 'enrolled-device-resolution',
      label: 'Enrolled device resolution',
      status: 'skipped',
      normalizerKind: 'enrolled-device-binding',
      measurementCount: 0,
      reasonCode: 'not-enrolled',
      reason: 'Phone/device reference is not bound to an enrolled SPECTRA device.',
    };
  }
  if (resolution.status === 'ambiguous') {
    return {
      id: 'enrolled-device-resolution',
      label: 'Enrolled device resolution',
      status: 'failed',
      normalizerKind: 'enrolled-device-binding',
      measurementCount: 0,
      reasonCode: 'identity-mismatch',
      reason: 'Enrollment lookup resolved to more than one device reference.',
    };
  }
  if (resolution.status === 'mismatch') {
    return {
      id: 'enrolled-device-resolution',
      label: 'Enrolled device resolution',
      status: 'failed',
      normalizerKind: 'enrolled-device-binding',
      measurementCount: 0,
      reasonCode: 'identity-mismatch',
      reason: resolution.mismatch === 'device-ref'
        ? 'Supplied device reference does not match the enrolled device binding.'
        : 'Supplied subject does not match the enrolled device binding.',
    };
  }
  return {
    id: 'enrolled-device-resolution',
    label: 'Enrolled device resolution',
    status: 'failed',
    normalizerKind: 'enrolled-device-binding',
    measurementCount: 0,
    reasonCode: 'request-failed',
    reason: 'Enrolled device resolution failed.',
  };
}

async function optionalDeviceLane(
  id: string,
  label: string,
  normalizerKind: string,
  configured: boolean,
  bound: boolean,
  work: () => Promise<any>,
): Promise<{ batch: any | null; attempt: SpectraActiveAcquisitionAttempt }> {
  if (!configured) {
    return {
      batch: null,
      attempt: {
        id,
        label,
        status: 'skipped',
        normalizerKind,
        measurementCount: 0,
        reasonCode: 'not-configured',
        reason: `${label} is not configured.`,
      },
    };
  }
  if (!bound) {
    return {
      batch: null,
      attempt: {
        id,
        label,
        status: 'skipped',
        normalizerKind,
        measurementCount: 0,
        reasonCode: 'missing-device',
        reason: `Enrolled device has no ${label} binding.`,
      },
    };
  }
  try {
    const batch = await work();
    return {
      batch,
      attempt: {
        id,
        label,
        status: 'fulfilled',
        normalizerKind,
        measurementCount: batch.measurements.length,
      },
    };
  } catch (error) {
    return {
      batch: null,
      attempt: {
        id,
        label,
        status: 'failed',
        normalizerKind,
        measurementCount: 0,
        reasonCode: 'request-failed',
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function getSpectraEnrolledAcquisitionCapabilities(
  env: NodeJS.ProcessEnv = process.env,
) {
  return [
    ...getSpectraActiveAcquisitionCapabilities().map(item => ({ ...item, configured: true })),
    {
      id: 'owntracks-recorder-active',
      label: 'OwnTracks Recorder',
      normalizerKind: 'canonical-telemetry',
      target: 'device' as const,
      configured: spectraOwnTracksConfigured(env),
    },
    {
      id: 'traccar-active',
      label: 'Traccar',
      normalizerKind: 'canonical-telemetry',
      target: 'device' as const,
      configured: spectraTraccarConfigured(env),
    },
    ...getSpectraCarrierLocationCapabilities(env).map(item => ({
      ...item,
      normalizerKind: 'camara-location-retrieval',
      target: 'device' as const,
    })),
  ];
}

export async function acquireSpectraEnrolledTelemetry(
  input: SpectraEnrolledAcquisitionInput,
  options: {
    env?: NodeJS.ProcessEnv;
    deps?: Partial<Deps>;
  } = {},
): Promise<SpectraEnrolledAcquisitionResult> {
  const env = options.env || process.env;
  const deps: Deps = {
    resolve: options.deps?.resolve || resolveSpectraEnrolledDevice,
    resolveByRef: options.deps?.resolveByRef || resolveSpectraEnrolledDeviceByRef,
    active: options.deps?.active || acquireSpectraActiveTelemetry,
    ownTracks: options.deps?.ownTracks || acquireSpectraOwnTracks,
    traccar: options.deps?.traccar || acquireSpectraTraccar,
    carrier: options.deps?.carrier || acquireSpectraCarrierLocations,
  };

  const suppliedPhone = String(input.phoneNumber || '').trim();
  const suppliedDeviceRef = String(input.deviceRef || '').trim();
  if (!suppliedPhone && !suppliedDeviceRef) {
    return {
      batches: [],
      attempts: [{
        id: 'enrolled-device-resolution',
        label: 'Enrolled device resolution',
        status: 'skipped',
        normalizerKind: 'enrolled-device-binding',
        measurementCount: 0,
        reasonCode: 'missing-device',
        reason: 'No enrolled phone number or device reference was supplied.',
      }],
    };
  }

  // Every live device pull goes through the tenant-scoped enrollment registry.
  // A direct deviceRef is not a bypass around the phone -> enrollment path.
  const resolution = suppliedPhone
    ? await deps.resolve(input.userId, suppliedPhone, {
        suppliedDeviceRef: suppliedDeviceRef || undefined,
        subjectLabel: input.subjectLabel,
      })
    : await deps.resolveByRef(input.userId, suppliedDeviceRef, {
        subjectLabel: input.subjectLabel,
      });
  if (resolution.status !== 'matched') {
    return {
      batches: [],
      attempts: [failedResolutionAttempt(resolution)],
      resolution,
    };
  }

  const device = resolution.device;
  const activePromise = deps.active({
    deviceRef: device.deviceRef,
    platform: device.platform,
    sessionId: input.sessionId,
    subjectLabel: input.subjectLabel,
  });
  const ownTracksPromise = optionalDeviceLane(
    'owntracks-recorder-active',
    'OwnTracks Recorder',
    'canonical-telemetry',
    spectraOwnTracksConfigured(env),
    Boolean(device.ownTracksUser && device.ownTracksDevice),
    () => deps.ownTracks(device, {
      sessionId: input.sessionId,
      subjectLabel: input.subjectLabel,
    }, env),
  );
  const traccarPromise = optionalDeviceLane(
    'traccar-active',
    'Traccar',
    'canonical-telemetry',
    spectraTraccarConfigured(env),
    Boolean(device.traccarDeviceId),
    () => deps.traccar(device, {
      sessionId: input.sessionId,
      subjectLabel: input.subjectLabel,
    }, env),
  );
  const carrierPromise = deps.carrier(device.phoneE164, {
    sessionId: input.sessionId,
    subjectLabel: input.subjectLabel,
  }, env);

  const [active, ownTracks, traccar, carrier] = await Promise.all([
    activePromise,
    ownTracksPromise,
    traccarPromise,
    carrierPromise,
  ]);

  return {
    batches: [
      ...active.batches,
      ...(ownTracks.batch ? [ownTracks.batch] : []),
      ...(traccar.batch ? [traccar.batch] : []),
      ...carrier.batches,
    ],
    attempts: [
      ...active.attempts,
      ownTracks.attempt,
      traccar.attempt,
      ...carrier.attempts,
    ],
    resolvedDeviceRef: device.deviceRef,
    resolution,
  };
}
