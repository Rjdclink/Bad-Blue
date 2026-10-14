import assert from 'node:assert/strict';
import { acquireSpectraOwnTracks } from '../server/services/spectra/SpectraOwnTracksAdapter';
import { acquireSpectraTraccar } from '../server/services/spectra/SpectraTraccarAdapter';
import { acquireSpectraCarrierLocations } from '../server/services/spectra/SpectraCarrierLocationAdapters';
import { collectSpectraPhoneInfoga } from '../server/services/spectra/SpectraPhoneInfoga';
import {
  buildSpectraRecursiveClueQueries,
  extractSpectraRecursiveClues,
} from '../server/services/spectra/SpectraRecursiveClues';
import type { SpectraEnrolledDevice } from '../server/services/spectra/SpectraEnrolledDeviceRegistry';
import type { SpectraRetrievedEvidence } from '../server/services/spectra/SpectraPublicRetrieval';

const originalFetch = globalThis.fetch;

const device: SpectraEnrolledDevice = {
  phoneE164: '+14025550123',
  deviceRef: 'device-a',
  platform: 'android',
  subjectLabel: 'Jane Doe',
  ownTracksUser: 'jane',
  ownTracksDevice: 'phone',
  traccarDeviceId: 44,
  metadata: {},
  source: 'environment',
};

try {
  {
    const env = {
      SPECTRA_OWNTRACKS_RECORDER_URL: 'https://owntracks.example',
      SPECTRA_OWNTRACKS_USERNAME: 'fixture-user',
      SPECTRA_OWNTRACKS_PASSWORD: 'fixture-pass',
    } as NodeJS.ProcessEnv;

    globalThis.fetch = async (input: any, init?: RequestInit) => {
      assert.equal(String(input), 'https://owntracks.example/owntracks/api/0/locations');
      assert.equal(init?.method, 'POST');
      assert.match(String(init?.body), /user=jane/);
      assert.match(String(init?.body), /device=phone/);
      assert.match(
        String((init?.headers as Record<string, string>)?.Authorization),
        /^Basic /,
      );
      return new Response(JSON.stringify({
        data: [{
          _type: 'location',
          topic: 'owntracks/jane/phone',
          lat: 41.25,
          lon: -95.93,
          tst: 1791039720,
          acc: 7,
          alt: 320,
          vel: 18,
          cog: 90,
          batt: 82,
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const result = await acquireSpectraOwnTracks(
      device,
      { sessionId: 's1', subjectLabel: 'Jane Doe' },
      env,
    );
    assert.equal(result.measurements.length, 1);
    assert.equal(result.measurements[0]?.source, 'device_gps');
    assert.equal((result.measurements[0]?.metadata as any)?.deviceRef, 'device-a');
    assert.equal(result.measurements[0]?.speed, 5);
  }

  {
    const env = {
      SPECTRA_TRACCAR_URL: 'https://traccar.example',
      SPECTRA_TRACCAR_TOKEN: 'fixture-token',
    } as NodeJS.ProcessEnv;
    let calls = 0;

    globalThis.fetch = async (input: any, init?: RequestInit) => {
      calls++;
      assert.equal(
        (init?.headers as Record<string, string>)?.Authorization,
        'Bearer fixture-token',
      );
      if (String(input) === 'https://traccar.example/api/devices/44') {
        return new Response(JSON.stringify({
          id: 44,
          positionId: 99,
          status: 'online',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      assert.equal(String(input), 'https://traccar.example/api/positions?id=99');
      return new Response(JSON.stringify([{
        id: 99,
        deviceId: 44,
        protocol: 'osmand',
        serverTime: '2026-10-03T15:04:01Z',
        deviceTime: '2026-10-03T15:04:00Z',
        fixTime: '2026-10-03T15:04:00Z',
        valid: true,
        latitude: 41.26,
        longitude: -95.94,
        altitude: 321,
        speed: 10,
        course: 180,
        accuracy: 6,
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const result = await acquireSpectraTraccar(
      device,
      { sessionId: 's2', subjectLabel: 'Jane Doe' },
      env,
    );
    assert.equal(calls, 2);
    assert.equal(result.measurements[0]?.source, 'device_gps');
    assert.equal(result.measurements[0]?.speed, 5.14444);
    assert.equal((result.measurements[0]?.metadata as any)?.traccarDeviceId, 44);
  }

  {
    const env = {
      SPECTRA_CAMARA_LOCATION_RETRIEVAL_URL: 'https://camara.example/retrieve',
      SPECTRA_CAMARA_LOCATION_RETRIEVAL_TOKEN: 'camara-token',
      SPECTRA_VONAGE_LOCATION_RETRIEVAL_URL: 'https://vonage.example/retrieve',
      SPECTRA_VONAGE_LOCATION_TOKEN: 'vonage-token',
      SPECTRA_CARRIER_LOCATION_MAX_AGE_SECONDS: '90',
    } as NodeJS.ProcessEnv;

    globalThis.fetch = async (input: any, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body || '{}'));
      if (url === 'https://camara.example/retrieve') {
        assert.equal(body.device.phoneNumber, '+14025550123');
        assert.equal(body.maxAge, 90);
        return new Response(JSON.stringify({
          lastLocationTime: '2026-10-03T15:05:00Z',
          area: {
            areaType: 'CIRCLE',
            center: { latitude: 41.27, longitude: -95.95 },
            radius: 500,
          },
          device: { phoneNumber: '+14025550123' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      assert.equal(url, 'https://vonage.example/retrieve');
      assert.equal(body.phone_number, '+14025550123');
      return new Response(JSON.stringify({
        last_location_time: '2026-10-03T15:05:05Z',
        location: {
          type: 'CIRCLE',
          center: { latitude: 41.271, longitude: -95.951 },
          radius_meters: 350,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const result = await acquireSpectraCarrierLocations(
      '+14025550123',
      { sessionId: 's3', subjectLabel: 'Jane Doe' },
      env,
    );
    assert.equal(result.batches.length, 2);
    assert.equal(result.attempts.filter(item => item.status === 'fulfilled').length, 2);
    assert.ok(result.batches.every(batch =>
      batch.measurements[0]?.source === 'network_region'
    ));

    globalThis.fetch = async (input: any) => {
      if (String(input).includes('camara.example')) {
        return new Response('unavailable', { status: 503 });
      }
      return new Response(JSON.stringify({
        last_location_time: '2026-10-03T15:05:05Z',
        location: {
          type: 'CIRCLE',
          center: { latitude: 41.271, longitude: -95.951 },
          radius_meters: 350,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const partial = await acquireSpectraCarrierLocations(
      '+14025550123',
      { sessionId: 's4', subjectLabel: 'Jane Doe' },
      env,
    );
    assert.equal(partial.batches.length, 1,
      'one carrier lane may fail without cancelling an independent carrier');
    assert.equal(partial.attempts.some(item => item.status === 'failed'), true);
    assert.equal(partial.attempts.some(item => item.status === 'fulfilled'), true);
  }

  {
    const env = {
      SPECTRA_PHONEINFOGA_URL: 'https://phoneinfoga.example',
      SPECTRA_PHONEINFOGA_SCANNERS: 'local,ovh',
    } as NodeJS.ProcessEnv;

    globalThis.fetch = async (input: any, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v2/numbers')) {
        return new Response(JSON.stringify({
          valid: true,
          e164: '+14025550123',
          international: '+1 402-555-0123',
          country: 'United States',
          countryCode: 1,
          carrier: 'Fixture',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      assert.match(url, /\/api\/v2\/scanners\/(?:local|ovh)\/run$/);
      const body = JSON.parse(String(init?.body || '{}'));
      assert.equal(body.number, '+14025550123');
      return new Response(JSON.stringify({
        result: { fixture: true },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const result = await collectSpectraPhoneInfoga('+1 (402) 555-0123', env);
    assert.equal(result.status, 'ok');
    assert.equal(result.normalized?.e164, '+14025550123');
    assert.deepEqual(result.scanners.map(item => item.status), ['ok', 'ok']);
  }

  {
    const records: SpectraRetrievedEvidence[] = [{
      url: 'https://publisher.example/article',
      requestedUrl: 'https://publisher.example/article',
      retrievedAt: '2026-10-03T15:06:00Z',
      title: 'Public profile',
      textExcerpt: [
        'Contact jane@example.test or +1 (402) 555-0123.',
        'Public profile @jane_example.',
        'See https://bsky.app/profile/jane.example and https://portfolio.example/about.',
      ].join(' '),
      observations: [],
    }];

    const clues = extractSpectraRecursiveClues(records);
    assert.ok(clues.some(clue => clue.kind === 'email' && clue.value === 'jane@example.test'));
    assert.ok(clues.some(clue => clue.kind === 'social-handle' && clue.value === '@jane_example'));
    assert.ok(clues.some(clue => clue.kind === 'profile-url'));

    const seen = new Set<string>();
    const queries = buildSpectraRecursiveClueQueries('Jane Doe', records, seen, 4);
    assert.ok(queries.length >= 3);
    const repeated = buildSpectraRecursiveClueQueries('Jane Doe', records, seen, 4);
    assert.equal(repeated.length, 0, 'same retrieved clues are not recursively searched twice');
  }

  console.log('SPECTRA OwnTracks, Traccar, carrier, PhoneInfoga and recursive-source verification passed.');
} finally {
  globalThis.fetch = originalFetch;
}
