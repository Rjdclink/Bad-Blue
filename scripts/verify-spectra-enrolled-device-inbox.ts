import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  authorizeSpectraEnrolledDeviceIngest,
  loadLatestSpectraEnrolledDeviceTelemetry,
  persistSpectraEnrolledDeviceTelemetry,
} from '../server/services/spectra/SpectraEnrolledTelemetryStore';

const token = 'fixture-device-token-that-is-long-enough';
const tokenHash = createHash('sha256').update(token).digest('hex');

const authorized = await authorizeSpectraEnrolledDeviceIngest(
  'android-device-a',
  token,
  {
    env: {} as NodeJS.ProcessEnv,
    query: async (_sql, parameters) => ({
      rows: parameters?.[1] === tokenHash
        ? [{
            user_id: 'tenant-a',
            phone_e164: '+14025550123',
            device_ref: 'android-device-a',
            platform: 'android',
            subject_label: 'Jane Doe',
          }]
        : [],
    }),
  },
);
assert.equal(authorized?.userId, 'tenant-a');
assert.equal(authorized?.deviceRef, 'android-device-a');
assert.equal(authorized?.platform, 'android');

const rejected = await authorizeSpectraEnrolledDeviceIngest(
  'android-device-a',
  'wrong-device-token-that-is-long-enough',
  {
    env: {} as NodeJS.ProcessEnv,
    query: async () => ({ rows: [] }),
  },
);
assert.equal(rejected, null);

const unavailableAuth = await authorizeSpectraEnrolledDeviceIngest(
  'apple-device-a',
  'apple-fixture-device-token-long-enough',
  {
    query: async () => { throw new Error('fixture database unavailable'); },
  },
);
assert.equal(unavailableAuth, null,
  'native device telemetry requires a durable server-side enrollment record');

const now = new Date().toISOString();
const batch = {
  sourceId: 'enrolled-android-device',
  measurements: [{
    kind: 'position',
    source: 'device_gps',
    timestamp: now,
    latitude: 41.258,
    longitude: -95.938,
    accuracy: 4,
    confidence: 0.95,
    provider: 'android-location',
    metadata: { deviceRef: 'android-device-a' },
  }],
  metadata: { fixture: true },
};

const persistedQueries: Array<{ sql: string; parameters?: unknown[] }> = [];
const stored = await persistSpectraEnrolledDeviceTelemetry(
  authorized!,
  'canonical-telemetry',
  batch as any,
  {
    query: async (sql, parameters) => {
      persistedQueries.push({ sql, parameters });
      return { rows: [] };
    },
  },
);
assert.equal(stored, true);
assert.equal(persistedQueries.length, 2);
assert.match(persistedQueries[0].sql, /INSERT INTO public\.spectra_enrolled_device_telemetry/);
assert.equal(persistedQueries[0].parameters?.[0], 'tenant-a');
assert.equal(persistedQueries[0].parameters?.[1], 'android-device-a');
assert.equal(persistedQueries[0].parameters?.[2], 'android');
assert.match(String(persistedQueries[0].parameters?.[5] || ''), /^[a-f0-9]{64}$/);
assert.match(persistedQueries[1].sql, /OFFSET 256/);

let latestParameters: unknown[] | undefined;
const latest = await loadLatestSpectraEnrolledDeviceTelemetry(
  'tenant-a',
  'ANDROID-DEVICE-A',
  {
    maxAgeMs: 120_000,
    query: async (_sql, parameters) => {
      latestParameters = parameters;
      return {
        rows: [{
          observed_at: now,
          payload: {
            ...batch,
            metadata: {
              ...batch.metadata,
              deviceRef: 'android-device-a',
              platform: 'android',
              enrolledDeviceInbox: true,
            },
          },
        }],
      };
    },
  },
);
assert.equal(latest?.measurements.length, 1);
assert.equal((latest?.metadata as any)?.deviceRef, 'android-device-a');
assert.equal(latestParameters?.[0], 'tenant-a');
assert.equal(latestParameters?.[1], 'ANDROID-DEVICE-A');
assert.equal(latestParameters?.[2], 120_000);

const missing = await loadLatestSpectraEnrolledDeviceTelemetry(
  'tenant-a',
  'android-device-a',
  { query: async () => ({ rows: [] }) },
);
assert.equal(missing, null);

console.log('SPECTRA enrolled-device telemetry authorization, bounded retention and fresh-inbox verification passed.');
