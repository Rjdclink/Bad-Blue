/**
 * Hybrid Geoconsole Types
 * Enterprise-grade location tracking and analysis system
 * 
 * Multimodal Input Fusion + Monte Carlo Path Interpolation
 * Professional UI with weather-radar-style timeline
 */

// ================= CORE GPS TYPES =================

export interface GPSPoint {
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracy?: number;
  timestamp: Date;
  source: DataSource;
  confidence: number; // 0-1 scale
  metadata?: Record<string, unknown>;
}

export interface GeoJSONPoint {
  type: 'Point';
  coordinates: [number, number, number?]; // [lng, lat, alt?]
  properties?: Record<string, unknown>;
}

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: GeoJSONPoint | GeoJSONLineString | GeoJSONPolygon;
  properties: Record<string, unknown>;
}

export interface GeoJSONLineString {
  type: 'LineString';
  coordinates: Array<[number, number, number?]>;
}

export interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: Array<Array<[number, number]>>;
}

// ================= DATA SOURCES =================

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

export interface DataSourceConfig {
  source: DataSource;
  enabled: boolean;
  priority: number; // 1-10, higher = more trusted
  refreshInterval?: number; // ms
  confidenceWeight: number; // 0-1
}

// ================= MULTIMODAL INPUT FUSION =================

export interface InputFusionConfig {
  sources: DataSourceConfig[];
  conflictResolution: 'weighted_average' | 'highest_confidence' | 'most_recent' | 'consensus';
  minConfidenceThreshold: number;
  deduplicationRadius: number; // meters
  temporalWindow: number; // seconds - merge points within this window
}

export interface FusedLocation {
  point: GPSPoint;
  contributingSources: DataSource[];
  fusionMethod: string;
  rawInputs: GPSPoint[];
  qualityScore: number;
}

// ================= MONTE CARLO PATH INTERPOLATION =================

export interface MonteCarloConfig {
  iterations: number; // Number of simulations
  stepSize: number; // meters
  maxSpeed: number; // m/s - human walking ~1.4, car ~30
  accelerationVariance: number;
  directionVariance: number; // radians
  terrainAwareness: boolean;
  roadNetworkConstraint: boolean;
  probabilityThreshold: number; // 0-1
}

export interface InterpolatedPath {
  id: string;
  startPoint: GPSPoint;
  endPoint: GPSPoint;
  interpolatedPoints: GPSPoint[];
  probabilityDistribution: ProbabilityHeatmap;
  confidence: number;
  method: 'monte_carlo' | 'linear' | 'spline' | 'road_network';
  metadata: {
    iterations: number;
    computeTime: number;
    pathLength: number; // meters
    estimatedDuration: number; // seconds
  };
}

export interface ProbabilityHeatmap {
  bounds: BoundingBox;
  resolution: number; // meters per cell
  grid: number[][]; // probability values 0-1
  peakProbability: { lat: number; lng: number; value: number };
}

// ================= MOTION TRAIL & ANIMATION =================

export interface MotionTrail {
  id: string;
  points: TrailPoint[];
  startTime: Date;
  endTime: Date;
  totalDistance: number;
  averageSpeed: number;
  maxSpeed: number;
  stops: StopPoint[];
  segments: TrailSegment[];
}

export interface TrailPoint {
  position: GPSPoint;
  velocity?: { speed: number; heading: number };
  interpolated: boolean;
  opacity: number; // for rendering trail fade
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
  arrivalTime: Date;
  departureTime?: Date;
  duration: number; // seconds
  placeType?: string;
  placeName?: string;
}

// ================= TIMELINE & PLAYBACK =================

export interface TimelineConfig {
  historyDays: number; // default 3
  futurecastHours: number; // default 6
  playbackSpeed: number; // 1 = realtime, 60 = 1 min = 1 sec
  animationFps: number;
  trailFadeSeconds: number;
}

export interface TimelineState {
  currentTime: Date;
  isPlaying: boolean;
  playbackSpeed: number;
  visibleRange: { start: Date; end: Date };
  selectedPoint?: GPSPoint;
  hoveredPoint?: GPSPoint;
}

export interface PlaybackFrame {
  timestamp: Date;
  position: GPSPoint;
  trail: TrailPoint[];
  futurecast: GPSPoint[];
  heatmap?: number[][];
}

// ================= SATELLITE & IMAGERY LAYERS =================

export interface SatelliteLayer {
  id: string;
  provider: 'sentinel' | 'nasa_earthdata' | 'usgs' | 'google_earth' | 'mapbox';
  type: 'optical' | 'radar' | 'thermal' | 'composite';
  resolution: number; // meters
  captureDate: Date;
  bounds: BoundingBox;
  tileUrl: string;
  attribution: string;
  opacity: number;
  visible: boolean;
}

export interface MapLayer {
  id: string;
  name: string;
  type: 'base' | 'satellite' | 'overlay' | 'heatmap' | 'trail' | 'markers';
  visible: boolean;
  opacity: number;
  zIndex: number;
}

// ================= PUBLIC CAMERA INTEGRATION =================

export interface PublicCamera {
  id: string;
  name: string;
  location: GPSPoint;
  type: 'traffic' | 'city' | 'highway' | 'dot' | 'event' | 'webcam';
  streamUrl?: string;
  snapshotUrl?: string;
  lastUpdate: Date;
  fieldOfView?: { heading: number; fov: number; range: number };
  status: 'online' | 'offline' | 'unknown';
}

export interface CameraTimestamp {
  cameraId: string;
  timestamp: Date;
  confidence: number;
  imageHash?: string;
}

// ================= LOCATION INTELLIGENCE REPORT =================

export interface LocationIntelligenceReport {
  id: string;
  generatedAt: Date;
  subject: string;
  timeRange: { start: Date; end: Date };
  summary: {
    totalLocations: number;
    uniqueLocations: number;
    totalDistance: number;
    averageSpeed: number;
    dataQuality: number;
  };
  frequentLocations: FrequentLocation[];
  motionPattern: MotionPattern;
  trails: MotionTrail[];
  anomalies: LocationAnomaly[];
  dataSources: DataSourceSummary[];
  geojson: GeoJSONFeatureCollection;
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

export interface FrequentLocation {
  position: GPSPoint;
  visitCount: number;
  totalDuration: number;
  averageVisitDuration: number;
  firstVisit: Date;
  lastVisit: Date;
  category?: string;
  label?: string;
}

export interface MotionPattern {
  primaryMode: 'walking' | 'driving' | 'transit' | 'mixed';
  activityPeriods: { start: number; end: number; activity: string }[]; // hours of day
  weekdayPattern: Record<string, number[]>; // day -> hours with activity
  regularRoutes: RegularRoute[];
}

export interface RegularRoute {
  startLocation: GPSPoint;
  endLocation: GPSPoint;
  frequency: number;
  averageDuration: number;
  variations: InterpolatedPath[];
}

export interface LocationAnomaly {
  type: 'unusual_location' | 'unusual_time' | 'speed_anomaly' | 'gap';
  timestamp: Date;
  location?: GPSPoint;
  description: string;
  severity: 'low' | 'medium' | 'high';
}

export interface DataSourceSummary {
  source: DataSource;
  pointCount: number;
  averageConfidence: number;
  timeRange: { start: Date; end: Date };
}

// ================= BOUNDING & GEOMETRY =================

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface Circle {
  center: GPSPoint;
  radius: number; // meters
}

// ================= 4JI ORCHESTRATION =================

export interface GeoconsoleOrchestrationConfig {
  maxConcurrentOperations: number;
  computeBudget: number; // max compute units per cycle
  cacheStrategy: 'aggressive' | 'balanced' | 'minimal';
  prefetchDepth: number;
  refinementPasses: number;
  adaptiveResolution: boolean;
  gpuAcceleration: boolean;
}

export interface OrchestrationState {
  activeTasks: number;
  queuedTasks: number;
  computeUsage: number;
  cacheHitRate: number;
  lastOptimizationPass: Date;
  nextScheduledPass: Date;
}

// ================= UI STATE =================

export interface GeoconsoleUIState {
  mapCenter: [number, number];
  mapZoom: number;
  activeLayer: string;
  visibleLayers: string[];
  timeline: TimelineState;
  selectedEntity?: string;
  panelState: {
    leftPanel: 'collapsed' | 'expanded';
    rightPanel: 'collapsed' | 'expanded';
    bottomPanel: 'collapsed' | 'expanded';
  };
  colorScheme: 'light' | 'dark' | 'satellite';
  animationEnabled: boolean;
}

// ================= API RESPONSES =================

export interface GeoconsoleAPIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  metadata: {
    timestamp: Date;
    processingTime: number;
    cacheHit: boolean;
  };
}

export interface ProgressUpdate {
  taskId: string;
  stage: string;
  progress: number; // 0-100
  message: string;
  estimatedRemaining?: number; // seconds
}
