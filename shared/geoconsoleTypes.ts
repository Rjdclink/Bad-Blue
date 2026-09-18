/**
 * Shared Geoconsole Types
 * 
 * Types shared between client and server for the geoconsole system
 */

// ================= CORE GPS TYPES =================

export interface GPSPoint {
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracy?: number;
  verticalAccuracy?: number;
  timestamp: Date | string;
  receivedAt?: Date | string;
  source: DataSource;
  confidence: number;
  observationKind?: 'observed' | 'inferred' | 'interpolated' | 'predicted' | 'historical';
  correlationGroup?: string;
  provenance?: {
    provider?: string;
    recordId?: string;
    capturedAt?: Date | string;
    transformedBy?: string[];
  };
  metadata?: Record<string, unknown>;
}

export interface LocationCandidate {
  latitude: number;
  longitude: number;
  label: string;
  confidence: number;
  basis: 'regional_context' | 'recorded_address' | 'inferred_location';
  accuracyMeters?: number;
}

export type DataSource = 
  | 'device_gps'
  | 'gnss_fix'
  | 'gnss_raw'
  | 'exif_photo'
  | 'exif_video'
  | 'xmp_sidecar'
  | 'json_sidecar'
  | 'wifi_handoff'
  | 'wifi_rssi'
  | 'wifi_rtt'
  | 'wifi_fingerprint'
  | 'cellular'
  | 'cell_serving'
  | 'cell_neighbor'
  | 'uwb_range'
  | 'uwb_direction'
  | 'bluetooth_proximity'
  | 'ble_rssi'
  | 'ble_aoa'
  | 'accelerometer'
  | 'imu_gyro'
  | 'magnetometer'
  | 'barometer'
  | 'browser_geolocation'
  | 'browser_timestamp'
  | 'network_region'
  | 'social_media'
  | 'social_geotag'
  | 'visual_detection'
  | 'vehicle_telemetry'
  | 'public_camera'
  | 'traffic_cam'
  | 'satellite_imagery'
  | 'historical_location'
  | 'public_record'
  | 'manual_input'
  | 'interpolated'
  | 'predicted';
// ================= MOTION TRAIL TYPES =================

export interface TrailPoint {
  position: GPSPoint;
  velocity?: { speed: number; heading: number };
  interpolated: boolean;
  opacity: number;
  color?: string;
}

export interface TrailSegment {
  startIndex: number;
  endIndex: number;
  segmentType: 'walking' | 'driving' | 'transit' | 'stationary' | 'unknown';
  averageSpeed: number;
  distance: number;
  duration: number;
}

export interface StopPoint {
  position: GPSPoint;
  arrivalTime: Date | string;
  departureTime?: Date | string;
  duration: number;
  placeType?: string;
  placeName?: string;
}

export interface MotionTrail {
  id: string;
  points: TrailPoint[];
  startTime: Date | string;
  endTime: Date | string;
  totalDistance: number;
  averageSpeed: number;
  maxSpeed: number;
  stops: StopPoint[];
  segments: TrailSegment[];
}

// ================= TIMELINE TYPES =================

export interface TimelineState {
  currentTime: Date;
  isPlaying: boolean;
  playbackSpeed: number;
  visibleRange: { start: Date; end: Date };
  selectedPoint?: GPSPoint;
  hoveredPoint?: GPSPoint;
}

// ================= LAYER TYPES =================

export interface LayerConfig {
  satellite: boolean;
  earthObservation?: boolean;
  trail: boolean;
  heatmap: boolean;
  markers: boolean;
  futurecast: boolean;
  weather?: boolean;
  terrain?: boolean;
  buildings?: boolean;
  uncertainty?: boolean;
  streetImagery?: boolean;
}

// ================= API TYPES =================

export interface GeoconsoleProcessRequest {
  inputs: GPSPoint[];
  sessionId?: string;
}

export interface GeoconsoleProcessResponse {
  success: boolean;
  data?: {
    fusedLocations: Array<{
      point: GPSPoint;
      contributingSources: DataSource[];
      fusionMethod: string;
      qualityScore: number;
    }>;
    trail: {
      id: string;
      pointCount: number;
      startTime: Date | string;
      endTime: Date | string;
      totalDistance: number;
      averageSpeed: number;
      segments: TrailSegment[];
      stops: StopPoint[];
    };
    futurecast: GPSPoint[];
  };
  error?: string;
  metadata?: {
    timestamp: Date | string;
    processingTime: number;
    cacheHit: boolean;
  };
}

// ================= SPEED THRESHOLDS =================

export const SPEED_THRESHOLDS = {
  stationary: 0.5, // m/s
  walking: 2.0,    // m/s (~4.5 mph)
  running: 5.0,    // m/s (~11 mph)
  cycling: 10.0,   // m/s (~22 mph)
  driving: 30.0,   // m/s (~67 mph)
} as const;

// ================= COLOR MAPPINGS =================

export const SPEED_COLORS = {
  stationary: '#3b82f6', // blue
  walking: '#22c55e',    // green
  running: '#eab308',    // yellow
  cycling: '#f97316',    // orange
  driving: '#ef4444',    // red
} as const;

// ================= UNIT CONVERSIONS =================

export const MPS_TO_MPH = 2.237;
export const MPS_TO_KPH = 3.6;
export const METERS_TO_MILES = 0.000621371;
export const METERS_TO_KM = 0.001;
