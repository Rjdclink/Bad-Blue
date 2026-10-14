import assert from 'node:assert/strict';
import {
  acquireSpectraEnrolledTelemetry,
} from '../server/services/spectra/SpectraEnrolledAcquisition';
import {
  normalizeSpectraPhoneE164,
  resolveSpectraEnrolledDevice,
  resolveSpectraEnrolledDeviceByRef,
} from '../server/services/spectra/SpectraEnrolledDeviceRegistry';
import { normalizeSpectraProviderPayload } from '../server/services/spectra/SpectraProviderTelemetryNormalizer';
import type {
  SpectraActiveAcquisitionInput,
  SpectraActiveAcquisitionResult,
} from '../server/services/spectra/SpectraActiveAcquisition';

assert.equal(normalizeSpectraPhoneE164('(402) 555-0123'), '+14025550123');
assert.equal(normalizeSpectraPhoneE164('+44 7700 900123'), '+447700900123');
assert.equal(normalizeSpectraPhoneE164('bad'), null);

const env = {
  SPECTRA_ENROLLED_DEVICES_JSON: JSON.stringify([
    {
      userId: 'tenant-a',
      phoneNumber: '+14025550123',
      deviceRef: 'android-device-a',
      platform: 'android',
      subjectLabel: 'Jane Mary Doe',
    },
    {
      userId: 'tenant-a',
      phoneNumber: '+14025550124',
      deviceRef: 'apple-device-a',
      platform: 'ios',
      subjectLabel: 'John Public',
    },
  ]),
} as NodeJS.ProcessEnv;

const query = async () => ({ rows: [] });
const resolve = (
  userId: string,
  phoneNumber: string | undefined,
  options: any = {},
) => resolveSpectraEnrolledDevice(userId, phoneNumber, {
  ...options,
  query,
  env,
});
const resolveByRef = (
  userId: string,
  deviceRef: string | undefined,
  options: any = {},
) => resolveSpectraEnrolledDeviceByRef(userId, deviceRef, {
  ...options,
  query,
  env,
});

let activeCalls: SpectraActiveAcquisitionInput[] = [];
let carrierCalls = 0;
const carrierPhones: string[] = [];

const active = async (
  input: SpectraActiveAcquisitionInput,
): Promise<SpectraActiveAcquisitionResult> => {
  activeCalls.push({ ...input });
  if (input.platform === 'android') {
    const batch = normalizeSpectraProviderPayload(
      'android-radio-collector',
      'android-radio-fixture',
      {
        sessionId: input.sessionId,
        subjectLabel: input.subjectLabel,
        deviceRef: input.deviceRef,
        timestamp: '2026-10-03T15:02:00Z',
        cells: [{
          timestamp: '2026-10-03T15:02:00Z',
          type: 'lte',
          mcc: 310,
          mnc: 260,
          tac: 10,
          ci: 987654,
          pci: 42,
          signal: { rsrp: -95, rsrq: -10, rssnr: 18 },
        }],
        wifiRtt: [{
          timestamp: '2026-10-03T15:02:00Z',
          distanceMeters: 7,
          responderLocation: { latitude: 41.258, longitude: -95.938 },
        }],
        bleScans: [{
          timestamp: '2026-10-03T15:02:00Z',
          gateway: { latitude: 41.2581, longitude: -95.9381 },
          rssiDbm: -62,
          txPowerAtOneMeterDbm: -59,
        }],
      },
    );
    return {
      batches: [{
        ...batch,
        sessionId: input.sessionId,
        subjectLabel: input.subjectLabel,
        metadata: {
          ...batch.metadata,
          deviceRef: input.deviceRef,
          acquisition: 'active-provider-pull',
        },
      }],
      attempts: [{
        id: 'android-radio-collector-active',
        label: 'Android enrolled multi-radio collector',
        status: 'fulfilled',
        normalizerKind: 'android-radio-collector',
        measurementCount: batch.measurements.length,
      }],
    };
  }

  if (input.platform === 'ios') {
    return {
      batches: [{
        sessionId: input.sessionId,
        subjectLabel: input.subjectLabel,
        sourceId: 'apple-device-fixture',
        measurements: [{
          kind: 'position',
          source: 'device_gps',
          timestamp: '2026-10-03T15:03:00Z',
          latitude: 41.259,
          longitude: -95.939,
          accuracy: 4,
          confidence: 0.95,
          provider: 'apple-core-location',
          metadata: { deviceRef: input.deviceRef, platform: 'ios' },
        }, {
          kind: 'ranging',
          source: 'uwb_range',
          timestamp: '2026-10-03T15:03:00Z',
          provider: 'apple-nearby-interaction',
          anchors: [{
            id: 'apple-peer',
            latitude: 41.2591,
            longitude: -95.9391,
            distanceMeters: 2,
            uncertaintyMeters: 0.2,
          }],
          metadata: { deviceRef: input.deviceRef, platform: 'ios' },
        }],
        metadata: {
          normalization: 'canonical-telemetry',
          deviceRef: input.deviceRef,
        },
      }],
      attempts: [{
        id: 'apple-device-collector-active',
        label: 'Apple enrolled device telemetry collector',
        status: 'fulfilled',
        normalizerKind: 'canonical-telemetry',
        measurementCount: 2,
      }],
    };
  }

  return { batches: [], attempts: [] };
};

const carrier = async (phoneNumber: string) => {
  carrierCalls += 1;
  carrierPhones.push(phoneNumber);
  return {
    batches: [],
    attempts: [{
      id: 'carrier-fixture',
      label: 'Carrier fixture',
      status: 'skipped' as const,
      normalizerKind: 'camara-location-retrieval',
      measurementCount: 0,
      reasonCode: 'not-configured' as const,
    }],
  };
};

const ownTracks = async () => {
  throw new Error('OwnTracks must not be called without an enrolled tracker binding');
};
const traccar = async () => {
  throw new Error('Traccar must not be called without an enrolled tracker binding');
};
const inbox = async () => null;

const android = await acquireSpectraEnrolledTelemetry({
  userId: 'tenant-a',
  phoneNumber: '(402) 555-0123',
  sessionId: 'session-a',
  subjectLabel: 'Jane Mary Doe',
}, {
  env,
  deps: { resolve, resolveByRef, active, ownTracks, traccar, carrier, inbox },
});
assert.equal(android.resolvedDeviceRef, 'android-device-a');
assert.equal(activeCalls.at(-1)?.deviceRef, 'android-device-a');
assert.equal(activeCalls.at(-1)?.platform, 'android');
assert.ok(android.batches[0]?.measurements.some(item => item.kind === 'radio'));
assert.ok(android.batches[0]?.measurements.some(item => item.kind === 'ranging'));
assert.ok(android.attempts.some(item =>
  item.id === 'android-radio-collector-active' && item.status === 'fulfilled'
));

const inboxAndroid = await acquireSpectraEnrolledTelemetry({
  userId: 'tenant-a',
  phoneNumber: '+14025550123',
  sessionId: 'session-inbox-android',
  subjectLabel: 'Jane Mary Doe',
}, {
  env,
  deps: {
    resolve,
    resolveByRef,
    active: async () => ({ batches: [], attempts: [] }),
    ownTracks,
    traccar,
    carrier,
    inbox: async (_userId: string, ref: string) => ({
      sourceId: 'enrolled-android-device',
      measurements: [{
        kind: 'position',
        source: 'device_gps',
        timestamp: '2026-10-03T15:02:30Z',
        latitude: 41.2585,
        longitude: -95.9385,
        accuracy: 4,
        confidence: 0.95,
        provider: 'android-location',
        metadata: { deviceRef: ref, platform: 'android' },
      }, {
        kind: 'radio',
        timestamp: '2026-10-03T15:02:30Z',
        radioType: 'lte',
        cellTowers: [{
          mobileCountryCode: 310,
          mobileNetworkCode: 260,
          cellId: 987654,
          radioType: 'lte',
          signalStrength: -95,
        }],
        metadata: { deviceRef: ref, platform: 'android' },
      }],
      metadata: { deviceRef: ref, platform: 'android' },
    }),
  },
});
assert.equal(inboxAndroid.resolvedDeviceRef, 'android-device-a');
assert.equal(inboxAndroid.batches.length, 1);
assert.equal(inboxAndroid.batches[0]?.sessionId, 'session-inbox-android');
assert.ok(inboxAndroid.batches[0]?.measurements.some(item => item.kind === 'radio'));
assert.equal(inboxAndroid.attempts[0]?.id, 'enrolled-device-inbox-active');
assert.equal(inboxAndroid.attempts[0]?.status, 'fulfilled');

const apple = await acquireSpectraEnrolledTelemetry({
  userId: 'tenant-a',
  phoneNumber: '+1 402 555 0124',
  sessionId: 'session-b',
  subjectLabel: 'John Public',
}, {
  env,
  deps: { resolve, resolveByRef, active, ownTracks, traccar, carrier, inbox },
});
assert.equal(apple.resolvedDeviceRef, 'apple-device-a');
assert.equal(activeCalls.at(-1)?.platform, 'ios');
assert.equal(apple.batches[0]?.measurements[0]?.source, 'device_gps');
assert.equal(apple.batches[0]?.measurements[1]?.source, 'uwb_range');

const directApple = await acquireSpectraEnrolledTelemetry({
  userId: 'tenant-a',
  deviceRef: 'APPLE-DEVICE-A',
  sessionId: 'session-direct-apple',
  subjectLabel: 'John Public',
}, {
  env,
  deps: { resolve, resolveByRef, active, ownTracks, traccar, carrier, inbox },
});
assert.equal(directApple.resolution?.status, 'matched');
assert.equal(directApple.resolvedDeviceRef, 'apple-device-a');
assert.equal(activeCalls.at(-1)?.platform, 'ios',
  'direct deviceRef lookup must inherit the enrolled platform');
assert.equal(carrierPhones.at(-1), '+14025550124',
  'direct deviceRef lookup must recover the enrolled phone for carrier lanes');

const callsBeforeUnenrolledRef = activeCalls.length;
const unenrolledRef = await acquireSpectraEnrolledTelemetry({
  userId: 'tenant-a',
  deviceRef: 'not-enrolled-device',
  sessionId: 'session-unenrolled-ref',
  subjectLabel: 'Unknown Person',
}, {
  env,
  deps: { resolve, resolveByRef, active, ownTracks, traccar, carrier, inbox },
});
assert.equal(unenrolledRef.resolution?.status, 'not-enrolled');
assert.equal(activeCalls.length, callsBeforeUnenrolledRef + 1,
  'pre-existing authorized direct-deviceRef acquisition remains available as an additive fallback');
assert.equal(activeCalls.at(-1)?.deviceRef, 'not-enrolled-device');
assert.equal(unenrolledRef.resolvedDeviceRef, 'not-enrolled-device');

const callsBeforeMissingIdentifier = activeCalls.length;
const noIdentifier = await acquireSpectraEnrolledTelemetry({
  userId: 'tenant-a',
  sessionId: 'session-no-identifier',
  subjectLabel: 'Jane Mary Doe',
}, {
  env,
  deps: { resolve, resolveByRef, active, ownTracks, traccar, carrier, inbox },
});
assert.equal(noIdentifier.batches.length, 0);
assert.equal(noIdentifier.attempts[0]?.reasonCode, 'missing-device');
assert.equal(activeCalls.length, callsBeforeMissingIdentifier,
  'a name-only investigation must not start live device acquisition');

const callsBeforeWrongDevice = activeCalls.length;
const carrierBeforeWrongDevice = carrierCalls;
const wrongDevice = await acquireSpectraEnrolledTelemetry({
  userId: 'tenant-a',
  phoneNumber: '+14025550123',
  deviceRef: 'different-device',
  sessionId: 'session-c',
  subjectLabel: 'Jane Mary Doe',
}, {
  env,
  deps: { resolve, resolveByRef, active, ownTracks, traccar, carrier, inbox },
});
assert.equal(wrongDevice.batches.length, 0);
assert.equal(wrongDevice.resolution?.status, 'mismatch');
assert.equal(activeCalls.length, callsBeforeWrongDevice,
  'device mismatch must be rejected before active acquisition');
assert.equal(carrierCalls, carrierBeforeWrongDevice,
  'device mismatch must be rejected before carrier acquisition');
assert.equal(wrongDevice.attempts[0]?.reasonCode, 'identity-mismatch');

const callsBeforeWrongIdentity = activeCalls.length;
const wrongIdentity = await acquireSpectraEnrolledTelemetry({
  userId: 'tenant-a',
  phoneNumber: '+14025550123',
  sessionId: 'session-d',
  subjectLabel: 'Different Person',
}, {
  env,
  deps: { resolve, resolveByRef, active, ownTracks, traccar, carrier, inbox },
});
assert.equal(wrongIdentity.batches.length, 0);
assert.equal(wrongIdentity.resolution?.status, 'mismatch');
assert.equal(activeCalls.length, callsBeforeWrongIdentity,
  'subject mismatch must be rejected before active acquisition');

const missing = await acquireSpectraEnrolledTelemetry({
  userId: 'tenant-a',
  phoneNumber: '+14025550999',
  sessionId: 'session-e',
  subjectLabel: 'Unknown Person',
}, {
  env,
  deps: { resolve, resolveByRef, active, ownTracks, traccar, carrier, inbox },
});
assert.equal(missing.batches.length, 0);
assert.equal(missing.resolution?.status, 'not-enrolled');
assert.equal(missing.attempts[0]?.reasonCode, 'not-enrolled');

const unavailableResolution = await resolveSpectraEnrolledDevice(
  'tenant-a',
  '+14025550126',
  {
    query: async () => { throw new Error('fixture database unavailable'); },
    env: {} as NodeJS.ProcessEnv,
  },
);
assert.equal(unavailableResolution.status, 'unavailable',
  'database failure without a server-side fallback must not be mislabeled as not enrolled');

const callsBeforeRegistryOutage = activeCalls.length;
const registryOutage = await acquireSpectraEnrolledTelemetry({
  userId: 'tenant-a',
  phoneNumber: '+14025550126',
  sessionId: 'session-registry-outage',
  subjectLabel: 'Unknown Person',
}, {
  env: {} as NodeJS.ProcessEnv,
  deps: {
    resolve: async () => unavailableResolution,
    resolveByRef,
    active,
    ownTracks,
    traccar,
    carrier,
    inbox,
  },
});
assert.equal(registryOutage.batches.length, 0);
assert.equal(registryOutage.attempts[0]?.reasonCode, 'registry-unavailable');
assert.equal(activeCalls.length, callsBeforeRegistryOutage,
  'registry outage must skip live acquisition rather than guessing enrollment');

const ambiguousEnv = {
  SPECTRA_ENROLLED_DEVICES_JSON: JSON.stringify([
    { userId: 'tenant-a', phoneNumber: '+14025550125', deviceRef: 'device-x', platform: 'android' },
    { userId: 'tenant-a', phoneNumber: '+14025550125', deviceRef: 'device-y', platform: 'android' },
  ]),
} as NodeJS.ProcessEnv;
const ambiguous = await resolveSpectraEnrolledDevice(
  'tenant-a', '+14025550125', { query, env: ambiguousEnv },
);
assert.equal(ambiguous.status, 'ambiguous');

const otherTenant = await resolveSpectraEnrolledDevice(
  'tenant-b', '+14025550123', { query, env },
);
assert.equal(otherTenant.status, 'not-enrolled',
  'enrollment mappings are tenant-scoped');

console.log('SPECTRA enrolled phone/deviceRef -> Android/Apple telemetry routing verification passed.');
