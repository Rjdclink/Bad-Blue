export type SpectraAdapterMode =
  | 'live-telemetry'
  | 'provider-webhook'
  | 'radio-resolution'
  | 'ranging'
  | 'media'
  | 'camera'
  | 'street-imagery'
  | 'geocoder'
  | 'place-context'
  | 'weather'
  | 'earth-observation'
  | 'archive'
  | 'public-record'
  | 'generic-http';

export interface SpectraAdapterCapability {
  id: string;
  label: string;
  mode: SpectraAdapterMode;
  sourceTypes: string[];
  configured: () => boolean;
  priority: 'critical' | 'high' | 'supporting';
  supportsRealtime: boolean;
  notes: string;
}

const anyEnv = (...names: string[]) =>
  names.some(name => Boolean(String(process.env[name] || '').trim()));

export const SPECTRA_ADAPTER_CAPABILITIES: SpectraAdapterCapability[] = [
  {
    id: 'browser-geolocation',
    label: 'Browser geolocation stream',
    mode: 'live-telemetry',
    sourceTypes: ['browser_geolocation'],
    configured: () => true,
    priority: 'critical',
    supportsRealtime: true,
    notes: 'Client watchPosition observations are normalized and fused server-side.',
  },
  {
    id: 'signed-provider-webhook',
    label: 'Signed telemetry provider webhook',
    mode: 'provider-webhook',
    sourceTypes: [
      'device_gps','gnss_fix','gnss_raw','vehicle_telemetry',
      'visual_detection','network_region',
      'wifi_fingerprint','cellular','wifi_rtt','wifi_rssi','uwb_range','uwb_direction',
      'bluetooth_proximity','ble_rssi','ble_aoa',
      'accelerometer','imu_gyro','magnetometer','barometer',
    ],
    configured: () => anyEnv('SPECTRA_TELEMETRY_HMAC_SECRET'),
    priority: 'critical',
    supportsRealtime: true,
    notes: 'Generic adapter for external live telemetry feeds that can POST normalized measurements.',
  },
  {
    id: 'camara-location-retrieval-ingest',
    label: 'CAMARA / GSMA network-location ingest',
    mode: 'provider-webhook',
    sourceTypes: ['network_region'],
    configured: () => anyEnv('SPECTRA_TELEMETRY_HMAC_SECRET'),
    priority: 'critical',
    supportsRealtime: true,
    notes: 'Normalizes signed CAMARA Device Location Retrieval responses into the canonical SPECTRA location pipeline.',
  },
  {
    id: 'bluetooth-scanner-ingest',
    label: 'Bluetooth scanner telemetry ingest',
    mode: 'provider-webhook',
    sourceTypes: ['bluetooth_proximity', 'ble_rssi', 'ble_aoa'],
    configured: () => anyEnv('SPECTRA_TELEMETRY_HMAC_SECRET'),
    priority: 'critical',
    supportsRealtime: true,
    notes: 'Normalizes signed BLE scanner/ranging observations into the existing multilateration path.',
  },
  {
    id: 'accessory-network-ingest',
    label: 'Accessory-network location ingest',
    mode: 'provider-webhook',
    sourceTypes: ['network_region', 'bluetooth_proximity', 'ble_rssi'],
    configured: () => anyEnv('SPECTRA_TELEMETRY_HMAC_SECRET'),
    priority: 'high',
    supportsRealtime: true,
    notes: 'Provider-neutral bridge for partner/exported accessory-network observations, including Find My / Find Hub compatible upstream feeds.',
  },
  {
    id: 'generic-https-json-pull',
    label: 'Configured HTTPS JSON telemetry pull',
    mode: 'live-telemetry',
    sourceTypes: [
      'device_gps','gnss_fix','vehicle_telemetry','social_geotag',
      'public_camera','traffic_cam','historical_location','public_record',
    ],
    configured: () => {
      try {
        const configured = JSON.parse(String(process.env.SPECTRA_GENERIC_JSON_ADAPTERS || '[]'));
        return Array.isArray(configured) && configured.length > 0;
      } catch {
        return false;
      }
    },
    priority: 'high',
    supportsRealtime: true,
    notes: 'Fixed HTTPS pull adapters normalize provider JSON into SPECTRA observations.',
  },
  {
    id: 'beacondb-radio-geolocation',
    label: 'beaconDB radio geolocation',
    mode: 'radio-resolution',
    sourceTypes: ['wifi_fingerprint','cellular'],
    configured: () => true,
    priority: 'high',
    supportsRealtime: true,
    notes: 'Keyless Ichnaea-compatible Wi-Fi/cellular positioning fallback for supplied radio observations.',
  },
  {
    id: 'google-radio-geolocation',
    label: 'Google radio geolocation',
    mode: 'radio-resolution',
    sourceTypes: ['wifi_fingerprint','cellular'],
    configured: () => anyEnv(
      'SPECTRA_GOOGLE_GEOLOCATION_API_KEY',
      'GOOGLE_GEOLOCATION_API_KEY',
      'GOOGLE_MAPS_API_KEY',
    ),
    priority: 'critical',
    supportsRealtime: true,
    notes: 'Resolves supplied Wi-Fi/cellular observations into coordinates and an accuracy radius.',
  },
  {
    id: 'opencellid',
    label: 'OpenCellID cell-position fallback',
    mode: 'radio-resolution',
    sourceTypes: ['cellular','cell_serving','cell_neighbor'],
    configured: () => anyEnv('OPENCELLID_API_KEY'),
    priority: 'high',
    supportsRealtime: true,
    notes: 'Independent cell-position lookup when network identifiers are available.',
  },
  {
    id: 'multilateration',
    label: 'SPECTRA multilateration',
    mode: 'ranging',
    sourceTypes: ['wifi_rtt','wifi_rssi','uwb_range','uwb_direction','bluetooth_proximity','ble_rssi','ble_aoa'],
    configured: () => true,
    priority: 'critical',
    supportsRealtime: true,
    notes: 'Uses three or more range anchors for multilateration, or absolute true-north directional anchors when available, with measurement uncertainty.',
  },
  {
    id: 'structured-telemetry-import',
    label: 'Structured telemetry import',
    mode: 'live-telemetry',
    sourceTypes: ['device_gps','gnss_fix','vehicle_telemetry','social_geotag','historical_location','public_record'],
    configured: () => true,
    priority: 'high',
    supportsRealtime: false,
    notes: 'Imports timestamped GeoJSON, GPX, KML, NMEA, CSV and NDJSON location observations.',
  },
  {
    id: 'media-metadata',
    label: 'Media metadata extraction',
    mode: 'media',
    sourceTypes: ['exif_photo','exif_video','xmp_sidecar','json_sidecar'],
    configured: () => true,
    priority: 'critical',
    supportsRealtime: false,
    notes: 'EXIF/XMP/IPTC/QuickTime metadata and embedded coordinates/timestamps.',
  },
  {
    id: 'wikimedia-geosearch',
    label: 'Wikimedia geotagged media',
    mode: 'media',
    sourceTypes: ['social_geotag'],
    configured: () => true,
    priority: 'supporting',
    supportsRealtime: false,
    notes: 'Nearby geotagged media context.',
  },
  {
    id: 'flickr-geosearch',
    label: 'Flickr geotagged media',
    mode: 'media',
    sourceTypes: ['social_geotag'],
    configured: () => anyEnv('FLICKR_API_KEY'),
    priority: 'supporting',
    supportsRealtime: false,
    notes: 'Nearby public photo metadata when Flickr is configured.',
  },
  {
    id: 'kartaview',
    label: 'KartaView street imagery',
    mode: 'street-imagery',
    sourceTypes: ['visual_detection'],
    configured: () => true,
    priority: 'supporting',
    supportsRealtime: false,
    notes: 'Nearby geotagged street imagery, capture time and directional context.',
  },
  {
    id: 'external-camera-json',
    label: 'Configured external camera directory',
    mode: 'camera',
    sourceTypes: ['traffic_cam','public_camera'],
    configured: () => {
      try {
        const feeds = JSON.parse(String(process.env.SPECTRA_CAMERA_JSON_FEEDS || '[]'));
        return Array.isArray(feeds) && feeds.length > 0;
      } catch {
        return false;
      }
    },
    priority: 'high',
    supportsRealtime: true,
    notes: 'Provider-neutral camera directory adapter for configured JSON feeds with geospatial field mappings.',
  },
  {
    id: 'trafficland',
    label: 'TrafficLand camera network',
    mode: 'camera',
    sourceTypes: ['traffic_cam','public_camera'],
    configured: () =>
      Boolean(String(process.env.TRAFFICLAND_API_KEY || '').trim())
      && Boolean(String(process.env.TRAFFICLAND_SYSTEM || '').trim()),
    priority: 'high',
    supportsRealtime: true,
    notes: 'Nationwide camera metadata/images where the configured account has coverage.',
  },
  {
    id: 'arcgis-camera-feeds',
    label: 'Configured ArcGIS/511 camera feeds',
    mode: 'camera',
    sourceTypes: ['traffic_cam','public_camera'],
    configured: () => anyEnv('SPECTRA_CAMERA_ARCGIS_FEEDS'),
    priority: 'high',
    supportsRealtime: true,
    notes: 'State/local DOT and 511 camera layers registered through configuration.',
  },
  {
    id: 'nominatim',
    label: 'OpenStreetMap Nominatim',
    mode: 'geocoder',
    sourceTypes: ['historical_location','public_record'],
    configured: () => true,
    priority: 'high',
    supportsRealtime: false,
    notes: 'Address/place search and regional candidate resolution.',
  },
  {
    id: 'census-geocoder',
    label: 'US Census Geocoder',
    mode: 'geocoder',
    sourceTypes: ['historical_location','public_record'],
    configured: () => true,
    priority: 'high',
    supportsRealtime: false,
    notes: 'Independent U.S. address fallback.',
  },
  {
    id: 'overpass-place-context',
    label: 'OpenStreetMap Overpass place context',
    mode: 'place-context',
    sourceTypes: ['historical_location','public_record'],
    configured: () => true,
    priority: 'supporting',
    supportsRealtime: false,
    notes: 'Nearby named places, roads, businesses and landmarks around a candidate location.',
  },
  {
    id: 'geonames-place-context',
    label: 'GeoNames place context',
    mode: 'place-context',
    sourceTypes: ['historical_location','public_record'],
    configured: () => anyEnv('GEONAMES_USERNAME'),
    priority: 'supporting',
    supportsRealtime: false,
    notes: 'Independent nearby toponym and administrative-place context.',
  },
  {
    id: 'nws',
    label: 'National Weather Service observations',
    mode: 'weather',
    sourceTypes: ['public_record'],
    configured: () => true,
    priority: 'supporting',
    supportsRealtime: true,
    notes: 'Time/place corroboration using nearby official weather observations.',
  },
  {
    id: 'copernicus-stac',
    label: 'Copernicus STAC',
    mode: 'earth-observation',
    sourceTypes: ['satellite_imagery'],
    configured: () => true,
    priority: 'supporting',
    supportsRealtime: false,
    notes: 'Spatiotemporal Earth-observation catalogue context.',
  },
  {
    id: 'aggregate-camera-motion-context',
    label: 'Aggregate camera motion context',
    mode: 'camera',
    sourceTypes: ['traffic_cam','public_camera'],
    configured: () => true,
    priority: 'supporting',
    supportsRealtime: true,
    notes: 'Accepts bounded aggregate traffic counts, speeds, headings and congestion context without promoting scene traffic into a target location observation.',
  },
  {
    id: 'public-source-retrieval',
    label: 'Direct public source retrieval',
    mode: 'generic-http',
    sourceTypes: ['historical_location','public_record','social_geotag'],
    configured: () => true,
    priority: 'high',
    supportsRealtime: false,
    notes: 'Fetches bounded direct source pages/JSON and extracts explicit geospatial metadata before evidence admission.',
  },
  {
    id: 'common-crawl',
    label: 'Common Crawl archive index',
    mode: 'archive',
    sourceTypes: ['historical_location','public_record'],
    configured: () => true,
    priority: 'supporting',
    supportsRealtime: false,
    notes: 'Historical URL discovery used only as discovery; underlying captures remain separate evidence.',
  },
];

export function getSpectraAdapterCapabilities() {
  return SPECTRA_ADAPTER_CAPABILITIES.map(adapter => ({
    id: adapter.id,
    label: adapter.label,
    mode: adapter.mode,
    sourceTypes: adapter.sourceTypes,
    configured: adapter.configured(),
    priority: adapter.priority,
    supportsRealtime: adapter.supportsRealtime,
    notes: adapter.notes,
  }));
}
