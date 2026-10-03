import assert from 'node:assert/strict';
import {
  normalizeSpectraProviderPayload,
  SPECTRA_PROVIDER_NORMALIZER_KINDS,
  SpectraProviderNormalizationError,
} from '../server/services/spectra/SpectraProviderTelemetryNormalizer';

function measurement(batch: ReturnType<typeof normalizeSpectraProviderPayload>, index = 0) {
  const value = batch.measurements[index] as Record<string, any> | undefined;
  assert.ok(value, `Expected measurement at index ${index}`);
  return value;
}

{
  const batch = normalizeSpectraProviderPayload(
    'camara-location-retrieval',
    'carrier-a',
    {
      sessionId: 'camara-circle',
      subjectLabel: 'device',
      lastLocationTime: '2025-01-02T03:04:05Z',
      area: {
        areaType: 'CIRCLE',
        center: { latitude: 45.754114, longitude: 4.860374 },
        radius: 800,
      },
      device: { phoneNumber: '+123456789' },
    },
  );
  const point = measurement(batch);
  assert.equal(point.kind, 'position');
  assert.equal(point.source, 'network_region');
  assert.equal(point.latitude, 45.754114);
  assert.equal(point.longitude, 4.860374);
  assert.equal(point.accuracy, 800);
  assert.equal(point.metadata.deviceIdentifierReturned, true);
}

{
  const batch = normalizeSpectraProviderPayload(
    'camara-location-retrieval',
    'carrier-b',
    {
      lastLocationTime: '2025-01-02T03:04:05Z',
      area: {
        areaType: 'POLYGON',
        boundary: [
          { latitude: 45.754114, longitude: 4.860374 },
          { latitude: 45.753845, longitude: 4.863185 },
          { latitude: 45.752490, longitude: 4.861876 },
          { latitude: 45.751224, longitude: 4.861125 },
          { latitude: 45.751442, longitude: 4.859827 },
        ],
      },
    },
  );
  const point = measurement(batch);
  assert.equal(point.kind, 'position');
  assert.equal(point.source, 'network_region');
  assert.ok(point.latitude > 45.751 && point.latitude < 45.755);
  assert.ok(point.longitude > 4.859 && point.longitude < 4.864);
  assert.ok(point.accuracy > 100);
}

{
  const batch = normalizeSpectraProviderPayload(
    'bluetooth-scanner',
    'ble-array-1',
    {
      sessionId: 'ble-session',
      observations: [{
        timestamp: '2025-01-02T03:04:05Z',
        targetId: 'beacon-42',
        source: 'ble_rssi',
        anchors: [
          {
            id: 'scanner-a',
            latitude: 43.5446,
            longitude: -96.7311,
            rssiDbm: -61,
            txPowerAtOneMeterDbm: -59,
          },
          {
            id: 'scanner-b',
            latitude: 43.5450,
            longitude: -96.7300,
            rssiDbm: -66,
            txPowerAtOneMeterDbm: -59,
          },
          {
            id: 'scanner-c',
            latitude: 43.5439,
            longitude: -96.7298,
            rssiDbm: -64,
            txPowerAtOneMeterDbm: -59,
          },
        ],
      }],
    },
  );
  const ranging = measurement(batch);
  assert.equal(ranging.kind, 'ranging');
  assert.equal(ranging.source, 'ble_rssi');
  assert.equal(ranging.anchors.length, 3);
  assert.match(String(ranging.correlationGroup), /^bluetooth:ble-array-1:/);
}

{
  const batch = normalizeSpectraProviderPayload(
    'accessory-network',
    'partner-feed',
    {
      sessionId: 'accessory-session',
      network: 'google-find-hub',
      observations: [{
        timestamp: '2025-01-02T03:04:05Z',
        latitude: 41.2565,
        longitude: -95.9345,
        accuracy: 35,
        deviceRef: 'accessory-7',
        observationId: 'obs-1',
      }],
    },
  );
  const point = measurement(batch);
  assert.equal(point.kind, 'position');
  assert.equal(point.source, 'network_region');
  assert.equal(point.accuracy, 35);
  assert.equal(point.metadata.network, 'google-find-hub');
  assert.equal(point.metadata.deviceRef, 'accessory-7');
}

{
  const batch = normalizeSpectraProviderPayload(
    'bluetooth-channel-sounding',
    'bluetooth-6-locator',
    {
      observations: [{
        timestamp: '2025-01-02T03:04:05Z',
        peerId: 'peer-1',
        anchor: { id: 'anchor-1', latitude: 43.5446, longitude: -96.7311 },
        pbrDistanceMeters: 4.8,
        pbrUncertaintyMeters: 0.12,
        rttDistanceMeters: 5.0,
        rttUncertaintyMeters: 0.3,
      }],
    },
  );
  const ranging = measurement(batch);
  assert.equal(ranging.kind, 'ranging');
  assert.equal(ranging.source, 'bluetooth_channel_sounding');
  assert.equal(ranging.metadata.technology, 'bluetooth-6-channel-sounding');
  assert.ok(ranging.anchors[0].distanceMeters > 4.8);
  assert.ok(ranging.anchors[0].distanceMeters < 5.0);
}

{
  const batch = normalizeSpectraProviderPayload(
    'ble-direction-finding',
    'aod-array',
    {
      observations: [{
        timestamp: '2025-01-02T03:04:05Z',
        method: 'aod',
        targetRef: 'tag-9',
        locator: { latitude: 43.545, longitude: -96.73 },
        distanceMeters: 12,
        bearingDegrees: 82,
        bearingReference: 'true_north',
        antennaArrayId: 'array-2',
      }],
    },
  );
  const ranging = measurement(batch);
  assert.equal(ranging.kind, 'ranging');
  assert.equal(ranging.source, 'ble_aod');
  assert.equal(ranging.metadata.directionMethod, 'aod');
  assert.equal(ranging.anchors[0].bearingReference, 'true_north');
}

{
  const batch = normalizeSpectraProviderPayload(
    'android-wifi-ranging',
    'pixel-rtt',
    {
      results: [{
        timestamp: '2025-01-02T03:04:05Z',
        protocol: '802.11az NTB',
        bssid: '00:11:22:33:44:55',
        distanceMm: 6450,
        distanceStdDevMm: 420,
        responderLocation: { latitude: 41.2565, longitude: -95.9345 },
        isWifiAwarePeer: true,
      }],
    },
  );
  const ranging = measurement(batch);
  assert.equal(ranging.kind, 'ranging');
  assert.equal(ranging.source, 'wifi_rtt');
  assert.equal(ranging.metadata.protocol, '802.11az-ntb');
  assert.equal(ranging.metadata.wifiAwarePeer, true);
  assert.equal(ranging.anchors[0].distanceMeters, 6.45);
}

{
  const batch = normalizeSpectraProviderPayload(
    'android-ranging-manager',
    'android-ranging',
    {
      results: [{
        timestamp: '2026-10-02T20:59:55Z',
        technology: 'UWB',
        peerId: 'uwb-peer',
        anchor: { latitude: 43.5446, longitude: -96.7311 },
        distanceMeters: 7.5,
        distanceUncertaintyMeters: 0.2,
        azimuthDegrees: 35,
        bearingReference: 'true_north',
      }, {
        timestamp: '2026-10-02T20:59:55Z',
        technology: 'Bluetooth Channel Sounding',
        peerId: 'bt-peer',
        anchor: { latitude: 43.5447, longitude: -96.7310 },
        distanceMeters: 5.2,
        distanceUncertaintyMeters: 0.15,
      }],
    },
  );
  assert.equal(measurement(batch, 0).source, 'uwb_direction');
  assert.equal(measurement(batch, 1).source, 'bluetooth_channel_sounding');
  assert.equal(measurement(batch, 0).metadata.providerKind, 'android-ranging-manager');
}

{
  const batch = normalizeSpectraProviderPayload(
    'android-cellular',
    'android-telephony',
    {
      cells: [{
        timestamp: '2025-01-02T03:04:05Z',
        radioType: 'nr',
        mcc: 310,
        mnc: 260,
        tac: 12345,
        nci: 6871947,
        pci: 321,
        nrarfcn: 635334,
        registered: true,
        signal: {
          ssRsrp: -92,
          ssRsrq: -12,
          ssSinr: 19,
          csiRsrp: -95,
          csiRsrq: -13,
          csiSinr: 17,
          cqi: 11,
          csiCqiTableIndex: 2,
          timingAdvance: 180,
        },
      }],
    },
  );
  const radio = measurement(batch);
  assert.equal(radio.kind, 'radio');
  assert.equal(radio.radioType, 'nr');
  assert.equal(radio.cellTowers[0].newRadioCellId, 6871947);
  assert.equal(radio.cellTowers[0].physicalCellId, 321);
  assert.equal(radio.cellTowers[0].arfcn, 635334);
  assert.equal(radio.cellTowers[0].signal.ssRsrpDbm, -92);
  assert.equal(radio.cellTowers[0].signal.csiSinrDb, 17);
  assert.equal(radio.cellTowers[0].signal.cqi, 11);
}

{
  const batch = normalizeSpectraProviderPayload(
    'android-raw-gnss',
    'android-gnss',
    {
      epochs: [{
        timestamp: '2025-01-02T03:04:05Z',
        clock: {
          timeNanos: 1234567890,
          fullBiasNanos: -1230000000,
          biasUncertaintyNanos: 12,
        },
        satellites: [{
          svid: 7,
          constellationType: 1,
          pseudorangeMeters: 21453231.2,
          pseudorangeRateMetersPerSecond: -623.4,
          accumulatedDeltaRangeMeters: 12345.6,
          carrierFrequencyHz: 1575420000,
          cn0DbHz: 38.5,
        }],
        solution: {
          latitude: 43.5446,
          longitude: -96.7311,
          accuracyMeters: 4.5,
        },
      }],
    },
  );
  assert.equal(batch.measurements.length, 2);
  assert.equal(measurement(batch, 0).source, 'gnss_raw');
  assert.equal(measurement(batch, 1).source, 'gnss_fix');
  assert.equal(measurement(batch, 1).metadata.satelliteCount, 1);
}

{
  const batch = normalizeSpectraProviderPayload(
    'apple-nearby-interaction',
    'ios-nearby-interaction',
    {
      observations: [{
        timestamp: '2025-01-02T03:04:05Z',
        mode: 'uwb-edm',
        peerRef: 'watch-peer',
        distanceMeters: 18.2,
        anchor: { latitude: 43.544, longitude: -96.73 },
        uncertaintyMeters: 0.25,
      }],
    },
  );
  const ranging = measurement(batch);
  assert.equal(ranging.kind, 'ranging');
  assert.equal(ranging.source, 'uwb_range');
  assert.equal(ranging.metadata.extendedDistanceMeasurement, true);
}

{
  const batch = normalizeSpectraProviderPayload(
    'apple-nearby-interaction',
    'ios-channel-sounding',
    {
      observations: [{
        timestamp: '2025-01-02T03:04:05Z',
        mode: 'bluetooth-channel-sounding',
        peerRef: 'accessory-peer',
        solution: {
          latitude: 43.5447,
          longitude: -96.7312,
          accuracyMeters: 1.8,
        },
      }],
    },
  );
  const point = measurement(batch);
  assert.equal(point.kind, 'position');
  assert.equal(point.source, 'bluetooth_channel_sounding');
  assert.equal(point.metadata.bluetoothChannelSounding, true);
}

{
  const batch = normalizeSpectraProviderPayload(
    'android-cellular',
    'android-cdma',
    {
      cells: [{
        timestamp: '2025-01-02T03:04:05Z',
        radioType: 'cdma',
        mcc: 310,
        sid: 42,
        nid: 7,
        bid: 1024,
        signal: {
          cdmaDbm: -91,
          cdmaEcio: -10,
          evdoDbm: -95,
          evdoEcio: -12,
          evdoSnr: 5,
        },
      }],
    },
  );
  const radio = measurement(batch);
  assert.equal(radio.kind, 'radio');
  assert.equal(radio.radioType, 'cdma');
  assert.equal(radio.homeMobileNetworkCode, 42);
  assert.equal(radio.cellTowers[0].locationAreaCode, 7);
  assert.equal(radio.cellTowers[0].cellId, 1024);
  assert.equal(radio.metadata.identifiers.systemId, 42);
  assert.equal(radio.metadata.identifiers.networkId, 7);
  assert.equal(radio.metadata.identifiers.baseStationId, 1024);
}

{
  const gnssLogger = [
    '# Raw,UtcTimeMillis,TimeNanos,FullBiasNanos,BiasNanos,BiasUncertaintyNanos,Svid,ConstellationType,ReceivedSvTimeNanos,ReceivedSvTimeUncertaintyNanos,Cn0DbHz,PseudorangeRateMetersPerSecond,AccumulatedDeltaRangeMeters,AccumulatedDeltaRangeUncertaintyMeters,CarrierFrequencyHz,CodeType',
    'Raw,1735787045000,1234567890,-1230000000,2,12,7,1,99887766,45,38.5,-623.4,12345.6,0.2,1575420000,C',
  ].join('\n');
  const batch = normalizeSpectraProviderPayload(
    'universal-radio-log',
    'gnsslogger-import',
    { text: gnssLogger },
  );
  const raw = measurement(batch);
  assert.equal(raw.kind, 'sensor');
  assert.equal(raw.source, 'gnss_raw');
  assert.equal(raw.metadata.satelliteCount, 1);
  assert.equal(raw.metadata.satellites[0].svid, 7);
  assert.equal(raw.metadata.satellites[0].carrierFrequencyHz, 1575420000);
}

{
  const batch = normalizeSpectraProviderPayload(
    'ble-gateway',
    'bluez-gateway',
    {
      observations: [{
        timestamp: '2025-01-02T03:04:05Z',
        gatewayKind: 'linux-bluez',
        gatewayId: 'gateway-1',
        beaconId: 'tag-3',
        gateway: { latitude: 43.5446, longitude: -96.7311 },
        rssiDbm: -63,
        txPowerAtOneMeterDbm: -59,
      }],
    },
  );
  const ranging = measurement(batch);
  assert.equal(ranging.kind, 'ranging');
  assert.equal(ranging.source, 'ble_rssi');
  assert.equal(ranging.metadata.gatewayKind, 'linux-bluez');
}

{
  const batch = normalizeSpectraProviderPayload(
    'lorawan-observation',
    'lora-solver',
    {
      timestamp: '2025-01-02T03:04:05Z',
      result: {
        latitude: 43.5446,
        longitude: -96.7311,
        accuracy: 180,
        algorithmType: 'Tdoa',
        numberOfGatewaysUsed: 4,
      },
      lorawan: [{
        gatewayId: 'gw-1',
        rssi: -91,
        snr: 8.5,
        toa: 611795075,
        antennaLocation: {
          latitude: 43.55,
          longitude: -96.74,
          altitude: 410,
        },
      }],
    },
  );
  assert.equal(measurement(batch, 0).kind, 'position');
  assert.equal(measurement(batch, 0).source, 'network_region');
  assert.equal(measurement(batch, 1).source, 'lorawan_radio');
}

{
  const batch = normalizeSpectraProviderPayload(
    'android-radio-collector',
    'android-collector',
    {
      timestamp: '2025-01-02T03:04:05Z',
      cells: [{
        timestamp: '2025-01-02T03:04:05Z',
        type: 'lte',
        mcc: 310,
        mnc: 410,
        tac: 42,
        ci: 123456,
        pci: 77,
        signal: { rsrp: -96, rsrq: -10, rssnr: 18, timingAdvance: 12 },
      }],
      wifiRtt: [{
        timestamp: '2025-01-02T03:04:05Z',
        distanceMeters: 8,
        responderLocation: { latitude: 43.544, longitude: -96.731 },
      }],
      bleScans: [{
        timestamp: '2025-01-02T03:04:05Z',
        gateway: { latitude: 43.545, longitude: -96.73 },
        rssiDbm: -60,
        txPowerAtOneMeterDbm: -59,
      }],
    },
  );
  assert.ok(batch.measurements.some(item => item.kind === 'radio'));
  assert.ok(batch.measurements.some(item => item.kind === 'ranging'));
}

{
  const batch = normalizeSpectraProviderPayload(
    'universal-radio-log',
    'vendor-log',
    {
      records: [{
        kind: '5g-nr',
        timestamp: '2025-01-02T03:04:05Z',
        radioType: 'nr',
        mcc: 310,
        mnc: 260,
        tac: 9,
        nci: 12345,
        pci: 8,
        ssRsrp: -100,
      }, {
        kind: 'bluetooth-channel-sounding',
        timestamp: '2025-01-02T03:04:05Z',
        anchor: { latitude: 43.544, longitude: -96.731 },
        pbrDistanceMeters: 3.2,
        rttDistanceMeters: 3.4,
      }],
    },
  );
  assert.ok(batch.measurements.some(item => item.kind === 'radio'));
  assert.ok(batch.measurements.some(item => item.kind === 'ranging'));
}

{
  const batch = normalizeSpectraProviderPayload(
    'android-managed-lost-mode',
    'android-management',
    {
      device: 'enterprises/e/devices/d1',
      retrievalTime: '2026-10-02T21:00:00Z',
      usageLogEvents: [{
        eventId: 'lost-1',
        eventTime: '2026-10-02T20:59:55Z',
        lostModeLocationEvent: {
          location: { latitude: 43.5446, longitude: -96.7311 },
          batteryLevel: 72,
        },
      }],
    },
  );
  const point = measurement(batch);
  assert.equal(point.kind, 'position');
  assert.equal(point.source, 'device_gps');
  assert.equal(point.metadata.providerKind, 'android-managed-lost-mode');
  assert.equal(point.metadata.batteryLevel, 72);
}

{
  const batch = normalizeSpectraProviderPayload(
    'apple-managed-lost-mode',
    'apple-mdm',
    {
      Latitude: 37.33385013244351,
      Longitude: -122.01079213269968,
      HorizontalAccuracy: 3.677859038862057,
      Timestamp: '2026-10-02T20:59:55Z',
      UDID: 'device-1',
      Status: 'Acknowledged',
    },
  );
  const point = measurement(batch);
  assert.equal(point.kind, 'position');
  assert.equal(point.source, 'device_gps');
  assert.equal(point.metadata.providerKind, 'apple-managed-lost-mode');
  assert.equal(point.accuracy, 3.677859038862057);
}

{
  const batch = normalizeSpectraProviderPayload(
    'meraki-scanning',
    'meraki',
    {
      version: '3.0',
      type: 'WiFi',
      data: {
        networkId: 'L_1',
        observations: [{
          clientId: 'client-1',
          locations: [{
            lat: 43.5446,
            lng: -96.7311,
            time: '2026-10-02T20:59:55Z',
            variance: 25,
            floorPlanId: 'floor-1',
          }],
        }],
      },
    },
  );
  const point = measurement(batch);
  assert.equal(point.source, 'wifi_fingerprint');
  assert.equal(point.metadata.providerKind, 'meraki-scanning');
  assert.equal(point.accuracy, 5);
}

{
  const batch = normalizeSpectraProviderPayload(
    'cisco-spaces-location',
    'cisco-spaces',
    {
      events: [{
        eventType: 'DEVICE_LOCATION_UPDATE',
        eventId: 'evt-1',
        deviceId: 'device-1',
        timestamp: '2026-10-02T20:59:55Z',
        location: {
          latitude: 43.5446,
          longitude: -96.7311,
          accuracy: 12,
          mapId: 'map-1',
        },
      }],
    },
  );
  const point = measurement(batch);
  assert.equal(point.source, 'wifi_fingerprint');
  assert.equal(point.metadata.providerKind, 'cisco-spaces-location');
}

{
  const batch = normalizeSpectraProviderPayload(
    'aws-iot-device-location',
    'aws-iot',
    {
      type: 'Point',
      coordinates: [-96.7311, 43.5446, 410],
      WirelessDeviceId: 'wireless-1',
      properties: {
        measurementType: 'GNSS',
        horizontalAccuracy: 8,
        verticalAccuracy: 12,
        timestamp: '2026-10-02T20:59:55Z',
      },
    },
  );
  const point = measurement(batch);
  assert.equal(point.source, 'gnss_fix');
  assert.equal(point.metadata.providerKind, 'aws-iot-device-location');
  assert.equal(point.accuracy, 8);
}

{
  const batch = normalizeSpectraProviderPayload(
    'connected-vehicle-location',
    'tesla-fleet',
    {
      vehicleId: 'vehicle-1',
      location: {
        latitude: 43.5446,
        longitude: -96.7311,
        gps_as_of: 1790974795,
        speed: 14,
        heading: 180,
      },
    },
  );
  const point = measurement(batch);
  assert.equal(point.source, 'vehicle_telemetry');
  assert.equal(point.metadata.providerKind, 'connected-vehicle-location');
  assert.equal(point.speed, 14);
}

{
  const batch = normalizeSpectraProviderPayload(
    'camara-reachability',
    'carrier-network',
    {
      reachabilityStatus: 'CONNECTED_DATA',
      lastStatusTime: '2026-10-02T20:59:55Z',
    },
  );
  const context = measurement(batch);
  assert.equal(context.kind, 'sensor');
  assert.equal(context.source, 'network_reachability');
  assert.equal(context.values.connected, 1);
}

{
  const batch = normalizeSpectraProviderPayload(
    'camara-location-verification',
    'carrier-network',
    {
      verificationResult: true,
      lastLocationTime: '2026-10-02T20:59:55Z',
    },
  );
  const context = measurement(batch);
  assert.equal(context.kind, 'sensor');
  assert.equal(context.source, 'location_verification');
  assert.equal(context.values.verified, 1);
}

for (const kind of [
  'bluetooth-channel-sounding',
  'ble-direction-finding',
  'android-wifi-ranging',
  'android-ranging-manager',
  'android-cellular',
  'android-raw-gnss',
  'apple-nearby-interaction',
  'android-radio-collector',
  'ble-gateway',
  'lorawan-observation',
  'universal-radio-log',
  'camara-location-verification',
  'camara-reachability',
  'android-managed-lost-mode',
  'apple-managed-lost-mode',
  'meraki-scanning',
  'cisco-spaces-location',
  'aws-iot-device-location',
  'connected-vehicle-location',
]) {
  assert.ok(
    SPECTRA_PROVIDER_NORMALIZER_KINDS.includes(kind as any),
    `Expected provider normalizer registry to include ${kind}`,
  );
}

assert.throws(
  () => normalizeSpectraProviderPayload(
    'camara-location-retrieval',
    'carrier-a',
    { area: { areaType: 'CIRCLE' } },
  ),
  SpectraProviderNormalizationError,
);

assert.throws(
  () => normalizeSpectraProviderPayload(
    'bluetooth-scanner',
    'ble-array-1',
    { observations: [{ timestamp: '2025-01-02T03:04:05Z', anchors: [] }] },
  ),
  SpectraProviderNormalizationError,
);

console.log('SPECTRA provider normalizer regression checks passed.');
