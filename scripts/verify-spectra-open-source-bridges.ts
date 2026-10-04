import assert from 'node:assert/strict';
import {
  normalizeSpectraOpenSourceBridgePayload,
  SPECTRA_OPEN_SOURCE_BRIDGE_KINDS,
} from '../server/services/spectra/SpectraOpenSourceBridgeNormalizer';

const originalAnchors = process.env.SPECTRA_ANCHOR_CATALOG_JSON;
const originalBindings = process.env.SPECTRA_INFRASTRUCTURE_SUBJECT_BINDINGS;

try {
  assert.deepEqual(
    [...SPECTRA_OPEN_SOURCE_BRIDGE_KINDS].sort(),
    [
      'chirpstack-location',
      'espresense-observation',
      'find3-location',
      'kismet-device-location',
      'openwisp-wifi-session',
      'owntracks-location',
      'traccar-position',
    ].sort(),
    'all intended open-source bridge kinds must remain registered',
  );

  process.env.SPECTRA_INFRASTRUCTURE_SUBJECT_BINDINGS = JSON.stringify([
    {
      providerId: 'owntracks-test',
      identifier: 'client:phone-a',
      sessionId: 'spectra-owned-session',
      subjectLabel: 'Owned test device',
    },
  ]);

  const ownTracks = normalizeSpectraOpenSourceBridgePayload(
    'owntracks-location',
    'owntracks-test',
    {
      _type: 'location',
      lat: 41.2565,
      lon: -95.9345,
      acc: 5,
      vel: 36,
      cog: 90,
      tst: 1791061200,
      tid: 'PA',
      _spectraMqttTopic: 'owntracks/alice/phone-a',
    },
  );
  assert.equal(ownTracks.sessionId, 'spectra-owned-session');
  assert.equal(ownTracks.subjectLabel, 'Owned test device');
  assert.equal(ownTracks.measurements.length, 1);
  assert.equal(ownTracks.measurements[0].source, 'device_gps');
  assert.equal(ownTracks.measurements[0].speed, 10);
  assert.match(
    String(ownTracks.measurements[0].correlationGroup),
    /phone-a$/,
    'OwnTracks identity should prefer the stable MQTT device segment over display tid',
  );

  const ownTracksGeoJson = normalizeSpectraOpenSourceBridgePayload(
    'owntracks-location',
    'owntracks-geojson-test',
    {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-95.9346, 41.2566, 321],
        },
        properties: {
          tst: 1791061201,
          acc: 6,
          tid: 'PB',
          device: 'phone-b',
        },
      }],
    },
  );
  assert.equal(ownTracksGeoJson.measurements.length, 1);
  assert.equal(ownTracksGeoJson.measurements[0].latitude, 41.2566);
  assert.equal(ownTracksGeoJson.measurements[0].longitude, -95.9346);
  assert.equal(ownTracksGeoJson.measurements[0].altitude, 321);
  assert.equal(
    (ownTracksGeoJson.measurements[0].metadata as any).ownTracksGeoJsonFeature,
    true,
  );

  const chirpStack = normalizeSpectraOpenSourceBridgePayload(
    'chirpstack-location',
    'chirpstack-test',
    {
      time: '2026-10-03T23:00:00.000Z',
      deduplication_id: 'event-1',
      device_info: {
        dev_eui: '0102030405060708',
        tenant_id: 'tenant-1',
        application_id: 'app-1',
      },
      location: {
        latitude: 41.25,
        longitude: -95.93,
        altitude: 320,
        accuracy: 12,
        source: 'TDOA',
      },
    },
  );
  assert.equal(chirpStack.measurements.length, 1);
  assert.equal(chirpStack.measurements[0].accuracy, 12);
  assert.match(
    String(chirpStack.measurements[0].correlationGroup),
    /0102030405060708$/,
  );

  const find3 = normalizeSpectraOpenSourceBridgePayload(
    'find3-location',
    'find3-test',
    {
      data: {
        gps: { lat: 41.257, lon: -95.936 },
        prob: 0.91,
        seen: 2,
        device: 'wifi-phone-a',
        loc: 'office',
      },
    },
  );
  assert.equal(find3.measurements.length, 1);
  assert.equal(find3.measurements[0].source, 'wifi_fingerprint');
  assert.equal(find3.measurements[0].confidence, 0.91);
  assert.equal(
    (find3.measurements[0].metadata as any).find3LocationLabel,
    'office',
  );

  process.env.SPECTRA_ANCHOR_CATALOG_JSON = JSON.stringify([
    {
      id: 'office',
      latitude: 41.2575,
      longitude: -95.9365,
      accuracyMeters: 4,
    },
  ]);

  const find3LabelOnly = normalizeSpectraOpenSourceBridgePayload(
    'find3-location',
    'find3-test',
    {
      data: {
        prob: 0.83,
        seen: 1,
        device: 'wifi-phone-b',
        loc: 'office',
      },
    },
  );
  assert.equal(find3LabelOnly.measurements.length, 1);
  assert.equal(find3LabelOnly.measurements[0].latitude, 41.2575);
  assert.equal(find3LabelOnly.measurements[0].longitude, -95.9365);
  assert.equal(find3LabelOnly.measurements[0].accuracy, 4);
  assert.equal(
    (find3LabelOnly.measurements[0].metadata as any).find3CoordinateSource,
    'configured-location-label-anchor',
  );

  process.env.SPECTRA_ANCHOR_CATALOG_JSON = JSON.stringify([
    {
      id: 'room-kitchen',
      latitude: 41.255,
      longitude: -95.935,
      accuracyMeters: 1.5,
      aliases: ['kitchen'],
    },
    {
      id: 'ap-one',
      latitude: 41.256,
      longitude: -95.936,
      accuracyMeters: 15,
      metadata: { coverageMeters: 45 },
    },
  ]);

  const espresense = normalizeSpectraOpenSourceBridgePayload(
    'espresense-observation',
    'esp-test',
    {
      room: 'room-kitchen',
      id: 'ble-tag-a',
      distance: 3.25,
      rssi: -61,
      timestamp: '2026-10-03T23:00:01.000Z',
    },
  );
  assert.equal(espresense.measurements.length, 1);
  assert.equal(espresense.measurements[0].kind, 'ranging');
  assert.equal(espresense.measurements[0].source, 'ble_rssi');
  assert.equal((espresense.measurements[0].anchors as any[])[0].distanceMeters, 3.25);

  const kismet = normalizeSpectraOpenSourceBridgePayload(
    'kismet-device-location',
    'kismet-test',
    {
      'kismet.device.base.macaddr': 'AA:BB:CC:DD:EE:10',
      'kismet.device.base.phyname': 'IEEE802.11',
      'kismet.device.base.last_time': 1791061202,
      'kismet.device.base.location': {
        'kismet.common.location.avg_loc': {
          'kismet.common.location.geopoint': [-95.937, 41.258],
          'kismet.common.location.alt': 322,
        },
      },
    },
  );
  assert.equal(kismet.measurements.length, 1);
  assert.equal(kismet.measurements[0].source, 'wifi_fingerprint');
  assert.equal(kismet.measurements[0].latitude, 41.258);
  assert.equal(kismet.measurements[0].longitude, -95.937);

  const openWisp = normalizeSpectraOpenSourceBridgePayload(
    'openwisp-wifi-session',
    'openwisp-test',
    {
      results: [{
        id: 'session-1',
        organization: 'org-1',
        device: 'ap-one',
        ssid: 'corp-wifi',
        interface_name: 'wlan0',
        modified: '2026-10-03T23:00:03.000Z',
        client: {
          mac_address: 'AA:BB:CC:DD:EE:11',
          vendor: 'Example',
        },
      }],
    },
  );
  assert.equal(openWisp.measurements.length, 1);
  assert.equal(openWisp.measurements[0].source, 'wifi_fingerprint');
  assert.equal(openWisp.measurements[0].latitude, 41.256);
  assert.equal(openWisp.measurements[0].accuracy, 45);

  const traccar = normalizeSpectraOpenSourceBridgePayload(
    'traccar-position',
    'traccar-test',
    {
      id: 55,
      deviceId: 7,
      protocol: 'osmand',
      latitude: 41.259,
      longitude: -95.938,
      accuracy: 8,
      fixTime: '2026-10-03T23:00:04.000Z',
      valid: true,
      network: {
        cellTowers: [{ mobileCountryCode: 310, mobileNetworkCode: 260 }],
      },
    },
  );
  assert.equal(traccar.measurements.length, 1);
  assert.equal(traccar.measurements[0].source, 'device_gps');
  assert.equal(traccar.measurements[0].accuracy, 8);
  assert.match(String(traccar.measurements[0].correlationGroup), /:7$/);

  const meshtastic = normalizeSpectraOpenSourceBridgePayload(
    'meshtastic-position',
    'meshtastic-test',
    {
      from: 123456789,
      id: 42,
      rx_time: 1791061300,
      rx_rssi: -91,
      rx_snr: 8.5,
      via_mqtt: true,
      decoded: {
        payload: {
          latitude_i: 412566000,
          longitude_i: -959346000,
          altitude: 322,
          gps_accuracy: 5,
          ground_speed: 3.2,
          ground_track: 185,
          precision_bits: 28,
          sats_in_view: 11,
        },
      },
    },
  );
  assert.equal(meshtastic.measurements.length, 1);
  assert.equal(meshtastic.measurements[0].latitude, 41.2566);
  assert.equal(meshtastic.measurements[0].longitude, -95.9346);
  assert.equal(meshtastic.measurements[0].accuracy, 5);
  assert.equal(meshtastic.measurements[0].speed, 3.2);
  assert.equal(meshtastic.measurements[0].heading, 185);
  assert.equal(
    (meshtastic.measurements[0].metadata as any).meshtasticViaMqtt,
    true,
  );

  const traccarNetworkFallback = normalizeSpectraOpenSourceBridgePayload(
    'traccar-position',
    'traccar-network-test',
    {
      id: 56,
      deviceId: 8,
      protocol: 'watch',
      fixTime: '2026-10-03T23:00:05.000Z',
      network: {
        homeMobileCountryCode: 310,
        homeMobileNetworkCode: 260,
        radioType: 'lte',
        carrier: 'Example Carrier',
        wifiAccessPoints: [{
          macAddress: '00:11:22:33:44:55',
          signalStrength: -61,
          channel: 6,
        }],
        cellTowers: [{
          mobileCountryCode: 310,
          mobileNetworkCode: 260,
          locationAreaCode: 40495,
          cellId: 17811,
          signalStrength: -89,
          radioType: 'lte',
        }],
      },
    },
  );
  assert.equal(traccarNetworkFallback.measurements.length, 1);
  assert.equal(traccarNetworkFallback.measurements[0].kind, 'radio');
  assert.equal(
    (traccarNetworkFallback.measurements[0].metadata as any).traccarNetworkFallback,
    true,
  );
  assert.equal(
    (traccarNetworkFallback.measurements[0].wifiAccessPoints as any[])[0].macAddress,
    '00:11:22:33:44:55',
  );
  assert.equal(
    (traccarNetworkFallback.measurements[0].cellTowers as any[])[0].mobileNetworkCode,
    260,
  );

  console.log('SPECTRA open-source acquisition bridge verification passed');
} finally {
  if (originalAnchors === undefined) delete process.env.SPECTRA_ANCHOR_CATALOG_JSON;
  else process.env.SPECTRA_ANCHOR_CATALOG_JSON = originalAnchors;

  if (originalBindings === undefined) {
    delete process.env.SPECTRA_INFRASTRUCTURE_SUBJECT_BINDINGS;
  } else {
    process.env.SPECTRA_INFRASTRUCTURE_SUBJECT_BINDINGS = originalBindings;
  }
}
