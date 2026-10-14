import assert from 'node:assert/strict';
import {
  acquireSpectraEnrolledTelemetry,
} from '../server/services/spectra/SpectraEnrolledAcquisition';
import {
  normalizeSpectraPhoneE164,
  resolveSpectraEnrolledDevice,
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

let activeCalls: SpectraActiveAcquisitionInput[] = [];
let carrierCalls = 0;

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

const carrier = async () => {
  carrierCalls += 1;
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

const android = await acquireSpectraEnrolledTelemetry({
  userId: 'tenant-a',
  phoneNumber: '(402) 555-0123',
  sessionId: 'session-a',
  subjectLabel: 'Jane Mary Doe',
}, {
  env,
  deps: { resolve, active, ownTracks, traccar, carrier },
});
assert.equal(android.resolvedDeviceRef, 'android-device-a');
assert.equal(activeCalls.at(-1)?.deviceRef, 'android-device-a');
assert.equal(activeCalls.at(-1)?.platform, 'android');
assert.ok(android.batches[0]?.measurements.some(item => item.kind === 'radio'));
assert.ok(android.batches[0]?.measurements.some(item => item.kind === 'ranging'));
assert.ok(android.attempts.some(item =>
  item.id === 'android-radio-collector-active' && item.status === 'fulfilled'
));

const apple = await acquireSpectraEnrolledTelemetry({
  userId: 'tenant-a',
  phoneNumber: '+1 402 555 0124',
  sessionId: 'session-b',
  subjectLabel: 'John Public',
}, {
  env,
  deps: { resolve, active, ownTracks, traccar, carrier },
});
assert.equal(apple.resolvedDeviceRef, 'apple-device-a');
assert.equal(activeCalls.at(-1)?.platform, 'ios');
assert.equal(apple.batches[0]?.measurements[0]?.source, 'device_gps');
assert.equal(apple.batches[0]?.measurements[1]?.source, 'uwb_range');

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
  deps: { resolve, active, ownTracks, traccar, carrier },
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
  deps: { resolve, active, ownTracks, traccar, carrier },
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
  deps: { resolve, active, ownTracks, traccar, carrier },
});
assert.equal(missing.batches.length, 0);
assert.equal(missing.resolution?.status, 'not-enrolled');
assert.equal(missing.attempts[0]?.reasonCode, 'not-enrolled');

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

console.log('SPECTRA enrolled phone -> deviceRef -> Android/Apple telemetry routing verification passed.');
