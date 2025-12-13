/**
 * PANTHEON REACTOR CONTRACTS
 * 
 * Canonical Event Schemas - ONE SHARED LANGUAGE ACROSS CRYPTO + VOICE + SATELLITE
 * 
 * All modules MUST use these types for inter-service communication.
 * Schema validation is STRICT - reject any event missing required fields.
 * 
 * trace_id MUST be propagated end-to-end for forensic analysis.
 */

// ============================================================================
// SCHEMA VERSION
// ============================================================================

export const SCHEMA_VERSION = '1.0.0';

// ============================================================================
// DOMAIN TYPES
// ============================================================================

export type Domain = 'crypto' | 'voice' | 'satellite' | 'generic';
export type EventKind = 'observation' | 'gap' | 'simreq' | 'simres' | 'intent' | 'result' | 'telemetry' | 'trip';

// ============================================================================
// BASE EVENT INTERFACE
// ============================================================================

export interface BaseEvent {
  /** Unique event identifier */
  event_id: string;
  /** Trace ID for end-to-end tracking (MUST be propagated) */
  trace_id: string;
  /** Timestamp (epoch ms) */
  ts: number;
  /** Schema version for compatibility */
  schema_version: string;
}

// ============================================================================
// 1. OBSERVATION EVENT
// Generic sensor input:
// - Crypto: market data tick, book delta
// - Voice: text chunk, phoneme timing, acoustic feature request
// - Satellite: imagery tile, geo hint
// ============================================================================

export interface QualityFlags {
  /** Data freshness (0-1, 1 = real-time) */
  freshness: number;
  /** Data completeness (0-1) */
  completeness: number;
  /** Source reliability (0-1) */
  reliability: number;
  /** Is this data stale? */
  isStale: boolean;
  /** Any known issues */
  issues?: string[];
}

export interface Observation extends BaseEvent {
  kind: 'observation';
  /** Data source identifier */
  source: string;
  /** Observation type (e.g., 'tick', 'book_delta', 'text_chunk', 'satellite_tile') */
  type: string;
  /** Domain-specific payload */
  payload: CryptoObservationPayload | VoiceObservationPayload | SatelliteObservationPayload | Record<string, unknown>;
  /** Quality assessment */
  quality_flags: QualityFlags;
  /** Time-to-live in milliseconds (after which observation is stale) */
  ttl_ms: number;
}

// Crypto-specific observation payloads
export interface CryptoObservationPayload {
  type: 'tick' | 'book_delta' | 'trade' | 'funding_rate' | 'liquidation';
  exchange: string;
  symbol: string;
  data: {
    price?: number;
    volume?: number;
    bid?: number;
    ask?: number;
    spread?: number;
    depth?: { bids: [number, number][]; asks: [number, number][] };
    timestamp?: number;
  };
}

// Voice-specific observation payloads
export interface VoiceObservationPayload {
  type: 'text_chunk' | 'phoneme_timing' | 'acoustic_request' | 'ssml_segment';
  text?: string;
  phonemes?: string[];
  timing?: { start: number; end: number; phoneme: string }[];
  ssml?: string;
  language?: string;
  voice_id?: string;
}

// Satellite-specific observation payloads
export interface SatelliteObservationPayload {
  type: 'imagery_tile' | 'geo_hint' | 'osint_ping' | 'cell_tower' | 'wifi_signal';
  coordinates: { lat: number; lng: number };
  uncertainty_m: number;
  confidence: number;
  source_satellite?: string;
  capture_time?: number;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// 2. GAP DETECTED EVENT
// Indicates incomplete data + severity
// ============================================================================

export type MissingnessType = 
  | 'stale_data' 
  | 'missing_field' 
  | 'incomplete_book' 
  | 'no_recent_tick' 
  | 'audio_gap' 
  | 'satellite_occlusion'
  | 'network_partition';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface GapContext {
  /** What data was expected */
  expected: string;
  /** What was actually received */
  received: string;
  /** Time since last good data (ms) */
  gap_duration_ms: number;
  /** Affected symbols/entities */
  affected: string[];
}

export interface GapDetected extends BaseEvent {
  kind: 'gap';
  /** Which domain detected the gap */
  domain: Domain;
  /** Type of missingness */
  missingness: MissingnessType;
  /** How severe is the gap */
  severity: Severity;
  /** Context for debugging */
  context: GapContext;
}

// ============================================================================
// 3. SIMULATION REQUEST
// Request for Monte Carlo (or ensemble) with constraints
// ============================================================================

// Crypto simulation types
export type CryptoSimType = 
  | 'slippage_paths'
  | 'partial_fill'
  | 'spread_collapse'
  | 'latency_shock'
  | 'venue_outage'
  | 'funding_flip'
  | 'unwind_time';

// Voice simulation types
export type VoiceSimType =
  | 'prosody_candidates'
  | 'latency_jitter'
  | 'quality_score_distribution'
  | 'chunking_policy'
  | 'retry_policy';

// Satellite simulation types
export type SatelliteSimType =
  | 'position_paths'
  | 'occlusion_probability'
  | 'revisit_time'
  | 'confidence_envelope';

export type SimType = CryptoSimType | VoiceSimType | SatelliteSimType | string;

export interface SimConstraints {
  /** Maximum paths to generate */
  max_paths?: number;
  /** Confidence level required */
  min_confidence?: number;
  /** Position bounds for satellite sims */
  position_bounds?: { min_lat: number; max_lat: number; min_lng: number; max_lng: number };
  /** Price bounds for crypto sims */
  price_bounds?: { min: number; max: number };
  /** Quality bounds for voice sims */
  quality_bounds?: { min: number; max: number };
  /** Custom constraints */
  custom?: Record<string, unknown>;
}

export interface SimRequest extends BaseEvent {
  kind: 'simreq';
  /** Domain requesting simulation */
  domain: Domain;
  /** Type of simulation */
  sim_type: SimType;
  /** Number of Monte Carlo paths */
  n_paths: number;
  /** Simulation horizon in milliseconds */
  horizon_ms: number;
  /** Input features for the simulation */
  input_features: Record<string, unknown>;
  /** Constraints on the simulation */
  constraints: SimConstraints;
  /** Random seed for reproducibility */
  seed: number;
  /** Deadline for completion (epoch ms) */
  deadline_ts: number;
  /** Priority (0-10, 10 = highest) */
  priority: number;
}

// ============================================================================
// 4. SIMULATION RESULT
// Output from Monte Carlo fabric
// ============================================================================

export interface SimSummary {
  /** Expected value */
  expected_value: number;
  /** Variance */
  variance: number;
  /** Quantiles (e.g., 0.05, 0.25, 0.5, 0.75, 0.95) */
  quantiles: Record<string, number>;
  /** Conditional Value at Risk (tail risk) */
  cvar: number;
  /** Probability of success/target */
  success_probability?: number;
}

export interface SimDiagnostics {
  /** Number of paths actually computed */
  paths_computed: number;
  /** Was simulation degraded due to deadline? */
  degraded: boolean;
  /** Degradation reason if any */
  degradation_reason?: string;
  /** Convergence metric */
  convergence: number;
  /** Any warnings */
  warnings: string[];
}

export interface SimResult extends BaseEvent {
  kind: 'simres';
  /** Domain of the simulation */
  domain: Domain;
  /** Type of simulation */
  sim_type: SimType;
  /** Statistical summary */
  summary: SimSummary;
  /** Reference to stored ensemble paths (if too large to inline) */
  ensemble_ref?: string;
  /** Confidence in the result (0-1) */
  confidence: number;
  /** Diagnostic information */
  diagnostics: SimDiagnostics;
  /** Compute cost in milliseconds */
  cost_ms: number;
}

// ============================================================================
// 5. ACTION INTENT
// What the Reactor wants executed:
// - Crypto: order intent
// - Voice: synth plan
// - Satellite: retask suggestion
// ============================================================================

// Crypto action types
export type CryptoActionType = 'market_order' | 'limit_order' | 'cancel' | 'modify' | 'hedge' | 'unwind';

// Voice action types
export type VoiceActionType = 'synthesize' | 'stream_start' | 'stream_chunk' | 'stream_end' | 'cache_warmup';

// Satellite action types
export type SatelliteActionType = 'retask' | 'priority_capture' | 'monitor' | 'alert';

export type ActionType = CryptoActionType | VoiceActionType | SatelliteActionType | string;

export interface RiskEnvelope {
  /** Maximum acceptable loss */
  max_loss?: number;
  /** Maximum position size */
  max_position?: number;
  /** Maximum latency acceptable (ms) */
  max_latency_ms?: number;
  /** Minimum quality threshold */
  min_quality?: number;
  /** Custom risk parameters */
  custom?: Record<string, unknown>;
}

export interface ActionIntent extends BaseEvent {
  kind: 'intent';
  /** Domain of the action */
  domain: Domain;
  /** Type of action */
  action_type: ActionType;
  /** Target of the action (e.g., symbol, voice endpoint) */
  target: string;
  /** Action parameters */
  parameters: CryptoActionParams | VoiceActionParams | SatelliteActionParams | Record<string, unknown>;
  /** Risk constraints */
  risk_envelope: RiskEnvelope;
  /** When this intent expires (epoch ms) */
  expires_ts: number;
  /** Idempotency key to prevent duplicate execution */
  idempotency_key: string;
}

export interface CryptoActionParams {
  exchange: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price?: number;
  order_type: 'market' | 'limit' | 'stop';
  time_in_force?: 'GTC' | 'IOC' | 'FOK';
  reduce_only?: boolean;
}

export interface VoiceActionParams {
  text: string;
  voice_id: string;
  provider: string;
  settings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    speaking_rate?: number;
  };
  chunk_size?: number;
  output_format?: string;
}

export interface SatelliteActionParams {
  coordinates: { lat: number; lng: number };
  radius_km: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  capture_window?: { start: number; end: number };
}

// ============================================================================
// 6. ACTION RESULT
// Outcome of the action
// ============================================================================

export type ActionStatus = 'success' | 'partial' | 'failed' | 'rejected' | 'expired' | 'cancelled';

export interface ActionResult extends BaseEvent {
  kind: 'result';
  /** Domain of the action */
  domain: Domain;
  /** Execution status */
  status: ActionStatus;
  /** Detailed result information */
  details: CryptoActionResult | VoiceActionResult | SatelliteActionResult | Record<string, unknown>;
  /** Execution latency in milliseconds */
  latency_ms: number;
  /** Idempotency key (matches ActionIntent) */
  idempotency_key: string;
}

export interface CryptoActionResult {
  order_id?: string;
  fill_price?: number;
  fill_quantity?: number;
  fees?: number;
  slippage?: number;
  state: 'new' | 'submitted' | 'acked' | 'partial' | 'filled' | 'canceled' | 'rejected';
  rejection_reason?: string;
}

export interface VoiceActionResult {
  audio_url?: string;
  audio_duration_ms?: number;
  characters_billed?: number;
  quality_score?: number;
  provider_latency_ms?: number;
  error?: string;
}

export interface SatelliteActionResult {
  capture_scheduled?: boolean;
  estimated_capture_time?: number;
  error?: string;
}

// ============================================================================
// 7. TELEMETRY
// Health, throughput, queue depths, error rates, and key performance metrics
// ============================================================================

export interface TelemetryMetrics {
  /** Events processed per second */
  throughput_eps: number;
  /** Current queue depth */
  queue_depth: number;
  /** Error rate (0-1) */
  error_rate: number;
  /** Average latency (ms) */
  avg_latency_ms: number;
  /** P99 latency (ms) */
  p99_latency_ms: number;
  /** Memory usage (MB) */
  memory_mb: number;
  /** CPU usage (0-1) */
  cpu_usage: number;
  /** Domain-specific metrics */
  custom: Record<string, number>;
}

export interface Telemetry extends BaseEvent {
  kind: 'telemetry';
  /** Service/component name */
  service: string;
  /** Health status */
  health: 'healthy' | 'degraded' | 'unhealthy';
  /** Metrics */
  metrics: TelemetryMetrics;
  /** Uptime in seconds */
  uptime_s: number;
}

// ============================================================================
// 8. TRIP (Circuit Breaker Trigger)
// ============================================================================

export type AutoRecoveryPolicy = 'manual' | 'cooldown' | 'exponential_backoff' | 'health_check';

export interface Trip extends BaseEvent {
  kind: 'trip';
  /** Name of the circuit breaker that tripped */
  breaker_name: string;
  /** Why it tripped */
  reason: string;
  /** Severity of the trip */
  severity: Severity;
  /** How should recovery be handled */
  auto_recovery_policy: AutoRecoveryPolicy;
  /** Cooldown period in milliseconds (if applicable) */
  cooldown_ms?: number;
  /** Affected components */
  affected_components: string[];
}

// ============================================================================
// EVENT UNION TYPE
// ============================================================================

export type ReactorEvent = 
  | Observation
  | GapDetected
  | SimRequest
  | SimResult
  | ActionIntent
  | ActionResult
  | Telemetry
  | Trip;

// ============================================================================
// EVENT FACTORY
// ============================================================================

import { randomUUID } from 'crypto';

export function createEventId(): string {
  return randomUUID();
}

export function createTraceId(): string {
  return `trace_${randomUUID()}`;
}

export function createBaseEvent(traceId?: string): Omit<BaseEvent, 'event_id'> & { event_id: string } {
  return {
    event_id: createEventId(),
    trace_id: traceId || createTraceId(),
    ts: Date.now(),
    schema_version: SCHEMA_VERSION,
  };
}

// ============================================================================
// VALIDATION
// ============================================================================

export function validateEvent(event: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!event || typeof event !== 'object') {
    return { valid: false, errors: ['Event must be an object'] };
  }
  
  const e = event as Record<string, unknown>;
  
  // Check required base fields
  if (!e.event_id) errors.push('Missing event_id');
  if (!e.trace_id) errors.push('Missing trace_id');
  if (!e.ts) errors.push('Missing ts');
  if (!e.schema_version) errors.push('Missing schema_version');
  
  // Check schema version compatibility
  if (e.schema_version && e.schema_version !== SCHEMA_VERSION) {
    errors.push(`Schema version mismatch: expected ${SCHEMA_VERSION}, got ${e.schema_version}`);
  }
  
  return { valid: errors.length === 0, errors };
}

// ============================================================================
// TOPIC/SUBJECT NAMES (for transport layer)
// ============================================================================

export const PUBSUB_TOPICS = {
  OBS: 'reactor.obs',
  GAP: 'reactor.gap',
  SIMREQ: 'reactor.simreq',
  SIMRES: 'reactor.simres',
  INTENT: 'reactor.intent',
  RESULT: 'reactor.result',
  TELEMETRY: 'reactor.telemetry',
  TRIP: 'reactor.trip',
} as const;

export const NATS_SUBJECTS = {
  OBS_FAST: 'obs.fast.*',
  INTENT_FAST: 'intent.fast.*',
  STATE_FAST: 'state.fast.*',
  CANCEL_FAST: 'cancel.fast.*',
} as const;

export const REDIS_KEYS = {
  WM_OBS: 'wm:obs',
  WM_FEATURES: 'wm:features',
  WM_DEDUPE: 'wm:dedupe',
  WM_RATELIMIT: 'wm:ratelimit',
  WM_LASTGOOD: 'wm:lastgood',
  WM_VOICECACHE: 'wm:voicecache',
} as const;

// ============================================================================
// DECISION LEDGER TYPES
// ============================================================================

export interface DecisionRecord {
  id: string;
  trace_id: string;
  timestamp: number;
  /** Hash of input observations */
  inputs_hash: string;
  /** Gate outcomes */
  gates: {
    feasibility: { passed: boolean; reason?: string; metrics?: Record<string, number> };
    simulation: { passed: boolean; bypassed: boolean; reason?: string; sim_id?: string };
    policy: { passed: boolean; reason?: string; selected_action?: string };
    safety: { passed: boolean; reason?: string; breakers_checked: string[] };
  };
  /** Final intent hash (if emitted) */
  final_intent_hash?: string;
  /** If no intent was emitted, why */
  veto_reason?: string;
}

export default {
  SCHEMA_VERSION,
  PUBSUB_TOPICS,
  NATS_SUBJECTS,
  REDIS_KEYS,
  createEventId,
  createTraceId,
  createBaseEvent,
  validateEvent,
};
