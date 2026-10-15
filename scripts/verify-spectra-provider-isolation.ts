import assert from 'node:assert/strict';
import { acquireSpectraEnrolledTelemetry } from '../server/services/spectra/SpectraEnrolledAcquisition';
import { acquireSpectraOwnTracks } from '../server/services/spectra/SpectraOwnTracksAdapter';
import { acquireSpectraTraccar } from '../server/services/spectra/SpectraTraccarAdapter';
import { spectraFiniteNumber } from '../server/services/spectra/SpectraExternalSourceHttp';
import type { SpectraEnrolledDevice } from '../server/services/spectra/SpectraEnrolledDeviceRegistry';
import type { SpectraNormalizedProviderBatch } from '../server/services/spectra/SpectraProviderTelemetryNormalizer';

const device: SpectraEnrolledDevice = {
  phoneE164: '+14025550123', deviceRef: 'fixture-device', platform: 'android',
  ownTracksUser: 'fixture', ownTracksDevice: 'phone', traccarDeviceId: 44,
  metadata: {}, source: 'environment',
};
const env = {
  SPECTRA_OWNTRACKS_RECORDER_URL: 'https://owntracks.example.test',
  SPECTRA_TRACCAR_URL: 'https://traccar.example.test', SPECTRA_TRACCAR_TOKEN: 'fixture-token',
};
const batch = (sourceId: string): SpectraNormalizedProviderBatch => ({
  sourceId, metadata: {}, measurements: [{ kind: 'position', source: 'device_gps',
    latitude: 42, longitude: -94, timestamp: new Date().toISOString(), confidence: 0.8 }],
});
const wrapped = (sourceId: string) => ({ batches: [batch(sourceId)], attempts: [] });

for (const failureMode of ['synchronous', 'asynchronous']) {
for (const broken of ['inbox', 'active', 'ownTracks', 'traccar', 'carrier', 'all']) {
  const calls: string[] = [];
  const work = (name: string, value: any) => {
    calls.push(name);
    if (name === broken || broken === 'all') {
      if (failureMode === 'asynchronous') return Promise.reject(Error('FIXTURE_PRIVATE_ERROR'));
      throw Error('FIXTURE_PRIVATE_ERROR');
    }
    return value;
  };
  const result = await acquireSpectraEnrolledTelemetry({
    userId: 'fixture-user', phoneNumber: device.phoneE164, sessionId: 'fixture-session',
  }, { env, deps: {
    resolve: async () => ({ status: 'matched', device, databaseAvailable: true }),
    inbox: () => work('inbox', Promise.resolve(batch('inbox'))),
    active: () => work('active', Promise.resolve(wrapped('active'))),
    ownTracks: () => work('ownTracks', Promise.resolve(batch('ownTracks'))),
    traccar: () => work('traccar', Promise.resolve(batch('traccar'))),
    carrier: () => work('carrier', Promise.resolve(wrapped('carrier'))),
  } });
  assert.equal(calls.length, 5, 'one lane must not prevent independent lanes from being attempted');
  assert.equal(result.batches.length, broken === 'all' ? 0 : 4);
  assert(!result.batches.some(item => item.sourceId === broken));
  assert.equal(result.attempts.filter(item => item.status === 'failed').length, broken === 'all' ? 5 : 1);
  assert(!JSON.stringify(result).includes('FIXTURE_PRIVATE_ERROR'));
}
}
console.log('PASS each source can fail synchronously or asynchronously without discarding independent results');

let providerCalls = 0;
const unavailable = async () => { providerCalls++; throw Error('must not dispatch'); };
const unknown = await acquireSpectraEnrolledTelemetry({ userId: 'fixture-user', phoneNumber: device.phoneE164 }, {
  env, deps: { resolve: async () => ({ status: 'not-enrolled', databaseAvailable: true }),
    inbox: unavailable, active: unavailable, ownTracks: unavailable, traccar: unavailable, carrier: unavailable },
});
assert.equal(providerCalls, 0);
assert.equal(unknown.batches.length, 0);
console.log('PASS source isolation preserves existing subject binding; no new device linkage or lookup bypass');

const originalFetch = globalThis.fetch;
const invalidNumbers = [null, undefined, '', ' ', false, true, [], {}, 'Infinity', 'NaN'];
for (const value of invalidNumbers) assert.equal(spectraFiniteNumber(value), null);
assert.equal(spectraFiniteNumber(0), 0);
assert.equal(spectraFiniteNumber('0'), 0);
assert.equal(spectraFiniteNumber('-94.5'), -94.5);
try {
  const ownRow = () => ({ _type: 'location', lat: 42, lon: -94,
    tst: Math.floor(Date.now() / 1000), acc: null, alt: null, vel: null, cog: null });
  const traccarRow = () => ({ id: 99, deviceId: 44, valid: true,
    latitude: 42, longitude: -94, fixTime: new Date().toISOString(),
    accuracy: null, altitude: null, speed: null, course: null });
  const json = (value: unknown) => new Response(JSON.stringify(value), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  for (const field of ['lat', 'lon', 'tst']) {
    for (const value of invalidNumbers) {
      globalThis.fetch = async () => json([{ ...ownRow(), [field]: value }]);
      await assert.rejects(acquireSpectraOwnTracks(device, {}, env), /no usable location measurements/);
    }
  }
  for (const field of ['latitude', 'longitude', 'fixTime']) {
    for (const value of invalidNumbers) {
      globalThis.fetch = async input => String(input).includes('/devices/')
        ? json({ id: 44 }) : json([{ ...traccarRow(), [field]: value }]);
      await assert.rejects(acquireSpectraTraccar(device, {}, env), /missing usable coordinates/);
    }
  }
  globalThis.fetch = async () => json([{ ...ownRow(), lat: 0, lon: 0 }]);
  const own = (await acquireSpectraOwnTracks(device, {}, env)).measurements[0];
  assert.equal(own.latitude, 0); assert.equal(own.longitude, 0);
  for (const field of ['accuracy', 'altitude', 'speed', 'heading']) assert.equal((own as any)[field], undefined);
  globalThis.fetch = async input => String(input).includes('/devices/')
    ? json({ id: 44 }) : json([{ ...traccarRow(), latitude: 0, longitude: 0 }]);
  const traccar = (await acquireSpectraTraccar(device, {}, env)).measurements[0];
  assert.equal(traccar.latitude, 0); assert.equal(traccar.longitude, 0);
  for (const field of ['accuracy', 'altitude', 'speed', 'heading']) assert.equal((traccar as any)[field], undefined);
  console.log('PASS malformed/missing coordinates and timestamps cannot create fictitious fixes; genuine zero remains valid');
} finally {
  globalThis.fetch = originalFetch;
}
