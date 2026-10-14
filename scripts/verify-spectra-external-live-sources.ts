import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { acquireSpectraOwnTracks } from '../server/services/spectra/SpectraOwnTracksAdapter';
import { acquireSpectraTraccar } from '../server/services/spectra/SpectraTraccarAdapter';
import { acquireSpectraCarrierLocations } from '../server/services/spectra/SpectraCarrierLocationAdapters';
import { getSpectraVonageBearerToken, mintSpectraVonageApplicationJwt } from '../server/services/spectra/SpectraVonageAuth';
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
      assert.equal(String(input), 'https://owntracks.example/api/0/locations');
      assert.equal(init?.method, 'POST');
      assert.match(String(init?.body), /user=jane/);
      assert.match(String(init?.body), /device=phone/);
      assert.match(String(init?.body), /limit=8/);
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

    const prefixedEnv = {
      ...env,
      SPECTRA_OWNTRACKS_RECORDER_URL: 'https://owntracks.example/owntracks',
    } as NodeJS.ProcessEnv;
    globalThis.fetch = async (input: any) => {
      assert.equal(String(input), 'https://owntracks.example/owntracks/api/0/locations');
      return new Response(JSON.stringify({
        data: [{
          _type: 'location',
          topic: 'owntracks/jane/phone',
          lat: 41.25, lon: -95.93, tst: 1791039720, acc: 7,
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const prefixed = await acquireSpectraOwnTracks(
      device,
      { sessionId: 's1-prefix', subjectLabel: 'Jane Doe' },
      prefixedEnv,
    );
    assert.equal(prefixed.measurements.length, 1);
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

    const tokenBoundEnv = {
      ...env,
      SPECTRA_CAMARA_LOCATION_DEVICE_SOURCE: 'token',
      SPECTRA_VONAGE_LOCATION_TOKEN: '',
    } as NodeJS.ProcessEnv;
    globalThis.fetch = async (input: any, init?: RequestInit) => {
      assert.equal(String(input), 'https://camara.example/retrieve');
      const body = JSON.parse(String(init?.body || '{}'));
      assert.equal(body.device, undefined,
        'CAMARA three-legged/token-bound mode must not redundantly send a device identifier');
      assert.equal(body.maxAge, 90);
      return new Response(JSON.stringify({
        lastLocationTime: '2026-10-03T15:05:02Z',
        area: {
          areaType: 'CIRCLE',
          center: { latitude: 41.2705, longitude: -95.9505 },
          radius: 450,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const tokenBound = await acquireSpectraCarrierLocations(
      '+14025550123',
      { sessionId: 's3-token', subjectLabel: 'Jane Doe' },
      tokenBoundEnv,
    );
    assert.equal(tokenBound.batches.length, 1);
    assert.equal(tokenBound.attempts.find(item =>
      item.id === 'camara-location-retrieval-active')?.status, 'fulfilled');

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
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const directJwt = mintSpectraVonageApplicationJwt(
      'fixture-vonage-app',
      privatePem,
      1_800_000_000,
    );
    const jwtParts = directJwt.split('.');
    assert.equal(jwtParts.length, 3);
    const jwtPayload = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString('utf8'));
    assert.equal(jwtPayload.application_id, 'fixture-vonage-app');
    assert.equal(jwtPayload.exp - jwtPayload.iat, 300);
    assert.deepEqual(jwtPayload.acl, { paths: {} });

    const env = {
      SPECTRA_VONAGE_APPLICATION_ID: 'fixture-vonage-app',
      SPECTRA_VONAGE_PRIVATE_KEY: privatePem,
      SPECTRA_VONAGE_OAUTH_SCOPE: 'fixture-location-scope',
      SPECTRA_VONAGE_AUTHORIZATION_URL: 'https://vonage.example/oauth2/bc-authorize',
      SPECTRA_VONAGE_TOKEN_URL: 'https://vonage.example/oauth2/token',
      SPECTRA_VONAGE_AUTH_TIMEOUT_MS: '3000',
    } as NodeJS.ProcessEnv;
    let authCalls = 0;
    globalThis.fetch = async (input: any, init?: RequestInit) => {
      authCalls += 1;
      const url = String(input);
      assert.match(
        String((init?.headers as Record<string, string>)?.Authorization || ''),
        /^Bearer eyJ/,
      );
      if (url.endsWith('/oauth2/bc-authorize')) {
        const body = new URLSearchParams(String(init?.body || ''));
        assert.equal(body.get('login_hint'), '+14025550123');
        assert.equal(body.get('scope'), 'fixture-location-scope');
        return new Response(JSON.stringify({
          auth_req_id: 'fixture-auth-request',
          expires_in: 120,
          interval: 0,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      assert.equal(url, 'https://vonage.example/oauth2/token');
      const body = new URLSearchParams(String(init?.body || ''));
      assert.equal(body.get('auth_req_id'), 'fixture-auth-request');
      assert.equal(body.get('grant_type'), 'urn:openid:params:grant-type:ciba');
      return new Response(JSON.stringify({
        access_token: 'fixture-network-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const accessToken = await getSpectraVonageBearerToken('+14025550123', env);
    assert.equal(accessToken, 'fixture-network-access-token');
    assert.equal(authCalls, 2);
  }

  {
    const nativeFallback = await collectSpectraPhoneInfoga(
      '+1 (402) 555-0123',
      {} as NodeJS.ProcessEnv,
    );
    assert.equal(nativeFallback.status, 'native-fallback');
    assert.equal(nativeFallback.normalized?.e164, '+14025550123');
    assert.ok(nativeFallback.searchQueries.length >= 5);
    assert.ok(nativeFallback.searchQueries.every(query =>
      query.includes('4025550123') || query.includes('+14025550123')
    ), 'native fallback queries remain bound to the normalized phone');
  }

  {
    const env = {
      SPECTRA_PHONEINFOGA_URL: 'https://retry-phoneinfoga.example',
      SPECTRA_PHONEINFOGA_SCANNERS: 'local',
    } as NodeJS.ProcessEnv;
    let transientNumberCalls = 0;
    globalThis.fetch = async (input: any) => {
      const url = String(input);
      if (url.endsWith('/api/v2/numbers')) {
        transientNumberCalls += 1;
        if (transientNumberCalls === 1) {
          return new Response('temporary outage', { status: 503 });
        }
        return new Response(JSON.stringify({
          valid: true,
          e164: '+14025550123',
          country: 'United States',
          carrier: 'Fixture',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const recovered = await collectSpectraPhoneInfoga('+14025550123', env);
    assert.equal(recovered.status, 'ok');
    assert.equal(transientNumberCalls, 2,
      'transient configured-provider failure gets exactly one recovery attempt');

    let permanentCalls = 0;
    globalThis.fetch = async () => {
      permanentCalls += 1;
      return new Response('unauthorized', { status: 401 });
    };
    const permanent = await collectSpectraPhoneInfoga('+14025550123', env);
    assert.equal(permanent.status, 'failed');
    assert.equal(permanentCalls, 1,
      'authentication failure is skipped without a pointless retry');
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
        result: url.includes('/ovh/')
          ? { found: true, city: 'Omaha', zip_code: '68102' }
          : { carrier: 'Fixture Wireless' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const result = await collectSpectraPhoneInfoga('+1 (402) 555-0123', env);
    assert.equal(result.status, 'ok');
    assert.equal(result.normalized?.e164, '+14025550123');
    assert.deepEqual(result.scanners.map(item => item.status), ['ok', 'ok']);
    assert.ok(result.searchQueries.some(query => query.includes('Omaha')));
    assert.ok(result.searchQueries.every(query => query.includes('+14025550123')),
      'PhoneInfoga context expansion remains bound to the normalized phone clue');
  }

  {
    const env = {
      SPECTRA_PHONEINFOGA_URL: 'https://phoneinfoga.example',
    } as NodeJS.ProcessEnv;
    globalThis.fetch = async (input: any, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v2/numbers')) {
        return new Response(JSON.stringify({
          valid: true,
          e164: '+14025550123',
          country: 'United States',
          carrier: 'Fixture',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/v2/scanners')) {
        assert.equal(init?.method, 'GET');
        return new Response(JSON.stringify({
          scanners: [
            { name: 'numverify' },
            { name: 'googlesearch' },
            { name: 'local' },
            { name: 'googlecse' },
            { name: 'ovh' },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      assert.match(url, /\/api\/v2\/scanners\/(?:googlesearch|ovh|local)\/run$/);
      if (url.includes('/googlesearch/')) {
        return new Response(JSON.stringify({
          result: {
            social_media: [{
              number: '+14025550123',
              dork: 'site:linkedin.com intext:"4025550123"',
            }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await collectSpectraPhoneInfoga('+14025550123', env);
    assert.equal(result.status, 'ok');
    assert.deepEqual(
      result.scanners.map(item => item.scanner),
      ['googlesearch', 'ovh', 'local'],
      'default PhoneInfoga mode must use only upstream keyless scanners',
    );
    assert.ok(result.searchQueries.some(query => query.includes('site:linkedin.com')));
    assert.ok(!result.scanners.some(item =>
      item.scanner === 'numverify' || item.scanner === 'googlecse'
    ), 'credential-backed PhoneInfoga scanners remain explicit opt-in');
  }

  {
    const records: SpectraRetrievedEvidence[] = [{
      url: 'https://publisher.example/article',
      requestedUrl: 'https://publisher.example/article',
      retrievedAt: '2026-10-03T15:06:00Z',
      title: 'Jane Doe public profile',
      textExcerpt: [
        'Jane Doe can be reached at jane@example.test or +1 (402) 555-0123.',
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
    assert.ok(
      repeated.every(query => !queries.includes(query)),
      'a clue already emitted in an earlier recursive batch must not be emitted again',
    );
    const exhausted = buildSpectraRecursiveClueQueries('Jane Doe', records, seen, 4);
    assert.equal(exhausted.length, 0, 'all retrieved clues are exhausted without duplicates');

    const unrelated: SpectraRetrievedEvidence[] = [{
      ...records[0],
      url: 'https://unrelated.example/profile',
      requestedUrl: 'https://unrelated.example/profile',
      title: 'Another Person',
      textExcerpt: 'Contact other@example.test or +1 202 555 0199.',
    }];
    assert.equal(
      buildSpectraRecursiveClueQueries('Jane Doe', unrelated, new Set<string>(), 4).length,
      0,
      'retrieved clues from an unrelated page must not seed a recursive branch',
    );

    const phoneBoundPage: SpectraRetrievedEvidence[] = [{
      ...records[0],
      url: 'https://directory.example/record',
      requestedUrl: 'https://directory.example/record',
      title: 'Public directory record',
      textExcerpt: 'Contact +1 (402) 555-0123. Alternate profile @phone_bound_handle.',
    }];
    const phoneBoundQueries = buildSpectraRecursiveClueQueries(
      'Jane Doe',
      phoneBoundPage,
      new Set<string>(),
      4,
      { phone: '+14025550123' },
    );
    assert.ok(phoneBoundQueries.some(query => query.includes('@phone_bound_handle')),
      'an exact supplied phone match may bind a retrieved page even when the page omits the name');
  }

  console.log('SPECTRA OwnTracks, Traccar, carrier, PhoneInfoga and recursive-source verification passed.');
} finally {
  globalThis.fetch = originalFetch;
}
