import assert from 'node:assert/strict';
import {
  acquireSpectraActiveTelemetry,
} from '../server/services/spectra/SpectraActiveAcquisition';
import {
  resolveSpectraNormalizedTelemetryBatch,
} from '../server/routes/geoconsole.routes';
import { assessSpectraLiveLocation } from '../server/services/spectra/SpectraLiveConfidence';

const environmentKeys = [
  'SPECTRA_TRACCAR_POSITION_URL_TEMPLATE',
  'SPECTRA_TRACCAR_AUTHORIZATION',
  'SPECTRA_ACTIVE_PROVIDER_ADAPTERS',
] as const;
const savedEnvironment = Object.fromEntries(
  environmentKeys.map(key => [key, process.env[key]]),
);
const savedFetch = globalThis.fetch;

async function run(): Promise<void> {
  process.env.SPECTRA_TRACCAR_POSITION_URL_TEMPLATE =
    'https://traccar.fixture/api/positions?deviceRef={{deviceRef}}';
  process.env.SPECTRA_TRACCAR_AUTHORIZATION = 'Bearer fixture-token';
  process.env.SPECTRA_ACTIVE_PROVIDER_ADAPTERS = '[]';

  let requests = 0;
  globalThis.fetch = async (input, init) => {
    requests += 1;
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://traccar.fixture');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer fixture-token');
    const deviceRef = url.searchParams.get('deviceRef');
    assert.ok(deviceRef === '17' || deviceRef === '18');
    const observedAt = deviceRef === '17'
      ? new Date().toISOString()
      : new Date(Date.now() - 60 * 60_000).toISOString();
    return new Response(JSON.stringify({
      id: deviceRef === '17' ? 101 : 102,
      deviceId: Number(deviceRef),
      protocol: 'osmand',
      latitude: 41.259,
      longitude: -95.938,
      accuracy: 8,
      fixTime: observedAt,
      valid: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const missingReference = await acquireSpectraActiveTelemetry({
    sessionId: 'fixture-missing-device',
    subjectLabel: 'Enrolled device fixture',
  });
  assert.equal(missingReference.batches.length, 0);
  assert.ok(missingReference.attempts.some(attempt =>
    attempt.id === 'traccar-position-bridge' && attempt.status === 'skipped'
  ));
  assert.equal(requests, 0, 'a subject label must not substitute for a device reference');

  for (const [deviceRef, expectedLive] of [['17', true], ['18', false]] as const) {
    const acquired = await acquireSpectraActiveTelemetry({
      deviceRef,
      sessionId: `fixture-device-${deviceRef}`,
      subjectLabel: 'Enrolled device fixture',
    });
    assert.equal(acquired.batches.length, 1);
    assert.equal(acquired.attempts.find(attempt =>
      attempt.id === 'traccar-position-bridge'
    )?.status, 'fulfilled');

    const canonical = await resolveSpectraNormalizedTelemetryBatch(acquired.batches[0], true);
    assert.equal(canonical.quality.points.length, 1);
    const point = canonical.quality.points[0];
    assert.equal(point.source, 'device_gps');
    assert.equal(point.latitude, 41.259);
    assert.equal(point.provenance?.provider, 'traccar-position-bridge');
    const assessment = assessSpectraLiveLocation(canonical.quality.points);
    assert.equal(assessment.isLive, expectedLive);
    assert.equal(assessment.status, expectedLive ? 'estimated' : 'stale');
  }
  assert.equal(requests, 2);
}

run().then(
  () => {
    console.log('SPECTRA provider-to-live-assessment pipeline verification passed.');
    process.exit(0);
  },
  error => {
    console.error(error);
    process.exit(1);
  },
).finally(() => {
  globalThis.fetch = savedFetch;
  for (const key of environmentKeys) {
    const saved = savedEnvironment[key];
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});
