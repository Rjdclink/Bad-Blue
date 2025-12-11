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
  timestamp: Date | string;
  source: DataSource;
  confidence: number;
  metadata?: Record<string, unknown>;
}

export type DataSource = 
  | 'device_gps'
  | 'exif_photo'
  | 'exif_video'
  | 'xmp_sidecar'
  | 'json_sidecar'
  | 'wifi_handoff'
  | 'bluetooth_proximity'
  | 'accelerometer'
  | 'browser_timestamp'
  | 'social_media'
  | 'public_camera'
  | 'traffic_cam'
  | 'satellite_imagery'
  | 'public_record'
  | 'manual_input'
  | 'interpolated';

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
  trail: boolean;
  heatmap: boolean;
  markers: boolean;
  futurecast: boolean;
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
