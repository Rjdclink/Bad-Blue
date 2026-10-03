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
    'android-uwb-sensor-fusion',
    'androidx-uwb',
    {
      dataStalenessThresholdMillis: 2000,
      estimates: [{
        timestamp: '2026-10-02T20:59:55Z',
        estimateType: 'PreciseEstimate',
        peerId: 'peer-uwb-1',
        distanceMeters: 3.5,
        distanceUncertaintyMeters: 0.08,
        azimuthDegrees: 24,
        anchor: { latitude: 43.5446, longitude: -96.7311 },
        estimateAgeMillis: 40,
      }, {
        timestamp: '2026-10-02T20:59:55Z',
        estimateType: 'DriftingEstimate',
        peerId: 'peer-uwb-2',
        distanceMeters: 4.1,
        estimateAgeMillis: 2500,
        odometry: { dxMeters: 1.2, dyMeters: 0.4 },
      }],
    },
  );
  const precise = measurement(batch, 0);
  const drifting = measurement(batch, 1);
  assert.equal(precise.kind, 'ranging');
  assert.equal(precise.source, 'uwb_direction');
  assert.equal(precise.metadata.estimateType, 'precise');
  assert.equal(drifting.kind, 'sensor');
  assert.equal(drifting.source, 'uwb_context');
  assert.equal(drifting.metadata.estimateType, 'drifting');
  assert.equal(drifting.metadata.estimateStale, true);
}

{
  const batch = normalizeSpectraProviderPayload(
    'nr-positioning',
    '5g-lmf',
    {
      results: [{
        timestamp: '2026-10-02T20:59:55Z',
        positioningMethod: 'multi-RTT',
        solution: {
          latitude: 43.5446003,
          longitude: -96.7310998,
          horizontalAccuracyMeters: 0.8,
          accuracyConfidenceLevel: 0.95,
          horizontalProtectionLevelMeters: 1.4,
          covariance: {
            eastVariance: 0.09,
            northVariance: 0.12,
          },
        },
        prsRsrpDbm: -84,
        prsSinrDb: 18,
        nlosProbability: 0.03,
        bandwidthHz: 100000000,
        positioningFrequencyLayers: 2,
      }],
    },
  );
  const position = measurement(batch);
  assert.equal(position.kind, 'position');
  assert.equal(position.source, 'nr_positioning');
  assert.equal(position.metadata.method, 'multi-rtt');
  assert.equal(position.metadata.nlosProbability, 0.03);
  assert.equal(position.metadata.horizontalProtectionLevelMeters, 1.4);
  assert.equal(position.metadata.accuracyConfidenceLevel, 0.95);
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
    'gnss-precision-solution',
    'rtk-rover',
    {
      solutions: [{
        timestamp: '2026-10-02T20:59:55Z',
        latitude: 43.5446002,
        longitude: -96.7311001,
        solutionType: 'RTK Fixed',
        horizontalAccuracyMeters: 0.025,
        verticalAccuracyMeters: 0.05,
        accuracyConfidenceLevel: 0.95,
        ambiguityRatio: 4.8,
        ambiguitiesFixed: true,
        baselineMeters: 5400,
        satellitesUsed: 19,
        hdop: 0.7,
        corrections: {
          transport: 'NTRIP',
          format: 'RTCM3',
          ageSeconds: 0.8,
          mountpoint: 'VRS_NEAR',
          rtcmMessages: [1005, 1077, 1087, 1097, 1127, 1230],
        },
        integrity: {
          horizontalProtectionLevelMeters: 0.08,
          verticalProtectionLevelMeters: 0.15,
        },
        covariance: {
          eastVariance: 0.0001,
          northVariance: 0.0001,
          eastNorthCovariance: 0,
        },
      }],
    },
  );
  const position = measurement(batch, 0);
  const correction = measurement(batch, 1);
  assert.equal(position.kind, 'position');
  assert.equal(position.source, 'gnss_fix');
  assert.equal(position.metadata.solutionType, 'rtk-fixed');
  assert.equal(position.metadata.correctionTransport, 'NTRIP');
  assert.equal(position.metadata.correctionFormat, 'RTCM3');
  assert.equal(position.metadata.ambiguitiesFixed, true);
  assert.equal(position.metadata.horizontalProtectionLevelMeters, 0.08);
  assert.equal(correction.kind, 'sensor');
  assert.equal(correction.source, 'gnss_corrections');
  assert.equal(correction.values.correctionAgeSeconds, 0.8);
}

{
  const batch = normalizeSpectraProviderPayload(
    'android-raw-gnss',
    'android-integrity',
    {
      epochs: [{
        timestamp: '2026-10-02T20:59:55Z',
        clock: {
          timeNanos: 1234567890,
          fullBiasNanos: -1230000000,
          biasUncertaintyNanos: 4,
          timeUncertaintyNanos: 2,
          hardwareClockDiscontinuityCount: 3,
        },
        previousHardwareClockDiscontinuityCount: 3,
        automaticGainControls: [{
          carrierFrequencyHz: 1575420000,
          levelDb: 12,
        }, {
          carrierFrequencyHz: 1176450000,
          levelDb: 13,
        }],
        satellites: [
          {
            svid: 1,
            constellationType: 1,
            state: 16385,
            accumulatedDeltaRangeState: 9,
            accumulatedDeltaRangeMeters: 100.1,
            accumulatedDeltaRangeUncertaintyMeters: 0.02,
            carrierFrequencyHz: 1575420000,
            cn0DbHz: 38,
            multipathIndicator: 2,
          },
          {
            svid: 3,
            constellationType: 1,
            state: 16385,
            accumulatedDeltaRangeState: 9,
            accumulatedDeltaRangeMeters: 101.1,
            accumulatedDeltaRangeUncertaintyMeters: 0.02,
            carrierFrequencyHz: 1176450000,
            cn0DbHz: 37,
            multipathIndicator: 2,
          },
          {
            svid: 8,
            constellationType: 6,
            state: 16385,
            accumulatedDeltaRangeState: 9,
            accumulatedDeltaRangeMeters: 102.1,
            accumulatedDeltaRangeUncertaintyMeters: 0.03,
            carrierFrequencyHz: 1575420000,
            cn0DbHz: 36,
            multipathIndicator: 2,
          },
          {
            svid: 12,
            constellationType: 6,
            state: 16385,
            accumulatedDeltaRangeState: 9,
            accumulatedDeltaRangeMeters: 103.1,
            accumulatedDeltaRangeUncertaintyMeters: 0.03,
            carrierFrequencyHz: 1176450000,
            cn0DbHz: 35,
            multipathIndicator: 2,
          },
          {
            svid: 18,
            constellationType: 3,
            state: 16385,
            accumulatedDeltaRangeState: 9,
            accumulatedDeltaRangeMeters: 104.1,
            accumulatedDeltaRangeUncertaintyMeters: 0.04,
            carrierFrequencyHz: 1575420000,
            cn0DbHz: 34,
            multipathIndicator: 2,
          },
        ],
      }],
    },
  );
  const raw = measurement(batch, 0);
  assert.equal(raw.source, 'gnss_raw');
  assert.equal(raw.metadata.integrity.validTrackingCount, 5);
  assert.equal(raw.metadata.integrity.usableAdrCount, 5);
  assert.equal(raw.metadata.integrity.carrierPhaseReady, true);
  assert.equal(raw.metadata.integrity.dualFrequencyReady, true);
  assert.equal(raw.metadata.integrity.multiConstellationReady, true);
  assert.ok(raw.metadata.integrity.integrityScore > 0.8);
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
    'camara-number-verification',
    'carrier-identity',
    {
      timestamp: '2026-10-02T20:59:55Z',
      devicePhoneNumberVerified: true,
      phoneNumber: '+16055551212',
    },
  );
  const binding = measurement(batch);
  assert.equal(binding.kind, 'sensor');
  assert.equal(binding.source, 'identity_binding');
  assert.equal(binding.values.verified, 1);
  assert.equal(binding.metadata.bindingType, 'network-number-possession');
}

{
  const batch = normalizeSpectraProviderPayload(
    'camara-device-identifier',
    'carrier-identity',
    {
      timestamp: '2026-10-02T20:59:55Z',
      imei: '490154203237518',
      imeiSv: '4901542032375187',
      tac: '49015420',
      manufacturer: 'Example',
      model: 'Example Device',
    },
  );
  const binding = measurement(batch);
  assert.equal(binding.source, 'identity_binding');
  assert.equal(binding.values.identifierPresent, 1);
  assert.equal(binding.metadata.imei, '490154203237518');
  assert.equal(binding.metadata.tac, '49015420');
}

{
  const batch = normalizeSpectraProviderPayload(
    'camara-kyc-match',
    'carrier-kyc',
    {
      timestamp: '2026-10-02T20:59:55Z',
      nameMatchScore: 99.7,
      addressMatchScore: 99.2,
      verified: true,
    },
  );
  const binding = measurement(batch);
  assert.equal(binding.source, 'identity_binding');
  assert.ok(binding.values.matchScore > 0.99);
  assert.equal(binding.metadata.bindingType, 'operator-kyc-match');
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
    'arcore-geospatial-pose',
    'arcore-vps',
    {
      deviceRef: 'device-1',
      vpsAvailability: 'AVAILABLE',
      trackingState: 'TRACKING',
      poses: [{
        timestamp: '2026-10-02T20:59:55Z',
        geospatialPose: {
          latitude: 43.5446003,
          longitude: -96.7311002,
          altitude: 410.2,
          horizontalAccuracy: 1.2,
          verticalAccuracy: 2.5,
          orientationYawAccuracy: 2.0,
        },
      }],
    },
  );
  const point = measurement(batch);
  assert.equal(point.kind, 'position');
  assert.equal(point.source, 'visual_positioning');
  assert.equal(point.accuracy, 1.2);
  assert.equal(point.metadata.providerKind, 'arcore-geospatial-pose');
  assert.equal(point.metadata.accuracyConfidenceLevel, 0.68);
  assert.equal(point.metadata.correlationDomain, 'device-1');
  assert.equal(point.metadata.vpsUsed, true);
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
  'android-uwb-sensor-fusion',
  'nr-positioning',
  'android-cellular',
  'android-raw-gnss',
  'gnss-precision-solution',
  'apple-nearby-interaction',
  'android-radio-collector',
  'ble-gateway',
  'lorawan-observation',
  'universal-radio-log',
  'camara-location-verification',
  'camara-reachability',
  'camara-number-verification',
  'camara-device-identifier',
  'camara-kyc-match',
  'android-managed-lost-mode',
  'apple-managed-lost-mode',
  'meraki-scanning',
  'cisco-spaces-location',
  'aws-iot-device-location',
  'arcore-geospatial-pose',
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
