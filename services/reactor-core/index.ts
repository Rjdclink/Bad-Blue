/**
 * REACTOR CORE - THE DECISION BRAIN
 * 
 * Central orchestrator that:
 * 1. Subscribes to Pub/Sub observations and simulation results
 * 2. Normalizes inputs into Observation events
 * 3. Extracts features into Redis working memory
 * 4. Runs the 4-gate ignition pipeline:
 *    - Gate 1: Feasibility (spread, fees, slippage, latency bounds)
 *    - Gate 2: Simulation (trigger Monte Carlo if uncertainty non-trivial)
 *    - Gate 3: Policy (choose execution style, emit ActionIntent)
 *    - Gate 4: Safety (circuit breakers, risk envelopes)
 * 5. Emits ActionIntent (NEVER directly executes)
 * 
 * INVARIANT: Reactor Core must NEVER directly place crypto orders or synthesize voice.
 * It only emits ActionIntent events.
 */

import { EventEmitter } from 'events';
import { createHash, randomUUID } from 'crypto';
import {
  type ReactorEvent,
  type Observation,
  type GapDetected,
  type SimRequest,
  type SimResult,
  type ActionIntent,
  type Trip,
  type DecisionRecord,
  type Domain,
  type Severity,
  type RiskEnvelope,
  createBaseEvent,
  PUBSUB_TOPICS,
} from '../../packages/contracts/src/index';
import { ReactorTransport, getTransport } from '../../packages/contracts/src/transport';

// ============================================================================
// TYPES
// ============================================================================

export interface ReactorConfig {
  /** Enable dry-run mode (emit intents but don't mark for execution) */
  dryRun: boolean;
  /** Maximum pending simulations */
  maxPendingSimulations: number;
  /** Gate timeout (ms) */
  gateTimeoutMs: number;
  /** Minimum simulation confidence threshold (0-1) */
  minSimConfidence: number;
  /** Telemetry emission interval (ms) */
  telemetryIntervalMs: number;
  /** Circuit breaker configurations */
  circuitBreakers: CircuitBreakerConfig[];
  /** Feature extraction config */
  featureExtraction: FeatureExtractionConfig;
}

export interface CircuitBreakerConfig {
  name: string;
  domain: Domain;
  /** Threshold for tripping */
  threshold: number;
  /** Metric to track */
  metric: 'error_rate' | 'latency' | 'drawdown' | 'exposure' | 'queue_depth';
  /** Cooldown period (ms) */
  cooldownMs: number;
  /** Severity when tripped */
  severity: Severity;
}

export interface FeatureExtractionConfig {
  /** Window size for feature aggregation (ms) */
  windowMs: number;
  /** Features to extract */
  enabledFeatures: string[];
}

export interface GateResult {
  passed: boolean;
  reason?: string;
  metrics?: Record<string, number | undefined>;
  duration_ms: number;
}

export interface FeasibilityMetrics {
  // Allow metrics to be treated as a numeric map when needed for generic gate plumbing
  [key: string]: number | undefined;
  net_spread_after_fees: number;
  expected_slippage: number;
  expected_fill_time_ms: number;
  latency_bounds_ms: number;
  // Voice-specific
  expected_quality?: number;
  expected_latency_ms?: number;
  expected_cost?: number;
}

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private isOpen: boolean = false;
  private openedAt: number = 0;
  private metrics: number[] = [];
  private metricWindow: number = 60000; // 1 minute rolling window

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  recordMetric(value: number): void {
    this.metrics.push(value);
    
    // Trim old metrics (keep recent 100)
    this.metrics = this.metrics.filter((_, i) => {
      return i > this.metrics.length - 100;
    });
  }

  check(): { allowed: boolean; tripEvent?: Trip } {
    const now = Date.now();

    // Check if in cooldown
    if (this.isOpen && now - this.openedAt < this.config.cooldownMs) {
      return { allowed: false };
    }

    // Reset if cooldown passed
    if (this.isOpen && now - this.openedAt >= this.config.cooldownMs) {
      this.isOpen = false;
    }

    // Check threshold
    const currentValue = this.getCurrentValue();
    if (currentValue > this.config.threshold) {
      this.isOpen = true;
      this.openedAt = now;

      const tripEvent: Trip = {
        ...createBaseEvent(),
        kind: 'trip',
        breaker_name: this.config.name,
        reason: `${this.config.metric} exceeded threshold: ${currentValue.toFixed(4)} > ${this.config.threshold}`,
        severity: this.config.severity,
        auto_recovery_policy: 'cooldown',
        cooldown_ms: this.config.cooldownMs,
        affected_components: [this.config.domain],
      };

      return { allowed: false, tripEvent };
    }

    return { allowed: true };
  }

  private getCurrentValue(): number {
    if (this.metrics.length === 0) return 0;
    
    switch (this.config.metric) {
      case 'error_rate':
        // Assume metrics are 0/1 for success/failure
        return this.metrics.reduce((a, b) => a + b, 0) / this.metrics.length;
      case 'latency':
      case 'drawdown':
      case 'exposure':
      case 'queue_depth':
        // Return max for these
        return Math.max(...this.metrics);
      default:
        return 0;
    }
  }

  getName(): string {
    return this.config.name;
  }
}

// ============================================================================
// DECISION LEDGER
// ============================================================================

class DecisionLedger {
  private records: Map<string, DecisionRecord> = new Map();
  private maxRecords: number = 10000;

  record(decision: DecisionRecord): void {
    this.records.set(decision.trace_id, decision);
    
    // Trim old records
    if (this.records.size > this.maxRecords) {
      const oldest = Array.from(this.records.keys()).slice(0, 100);
      for (const key of oldest) {
        this.records.delete(key);
      }
    }
  }

  get(traceId: string): DecisionRecord | undefined {
    return this.records.get(traceId);
  }

  getRecent(count: number = 100): DecisionRecord[] {
    return Array.from(this.records.values()).slice(-count);
  }

  getByOutcome(vetoed: boolean, count: number = 100): DecisionRecord[] {
    return Array.from(this.records.values())
      .filter(r => vetoed ? !!r.veto_reason : !!r.final_intent_hash)
      .slice(-count);
  }
}

// ============================================================================
// REACTOR CORE
// ============================================================================

export class ReactorCore extends EventEmitter {
  private config: ReactorConfig;
  private transport: ReactorTransport;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private decisionLedger: DecisionLedger;
  private pendingSimulations: Map<string, { request: SimRequest; callback: (result: SimResult) => void }> = new Map();
  private isRunning: boolean = false;
  private telemetryTimer: NodeJS.Timeout | null = null;
  private startTime: number = 0;
  private processedCount: number = 0;
  private errorCount: number = 0;

  constructor(config: Partial<ReactorConfig> = {}) {
    super();
    this.config = {
      dryRun: false,
      maxPendingSimulations: 100,
      gateTimeoutMs: 5000,
      minSimConfidence: 0.5,
      telemetryIntervalMs: 10000,
      circuitBreakers: [
        { name: 'crypto_error_rate', domain: 'crypto', threshold: 0.3, metric: 'error_rate', cooldownMs: 60000, severity: 'high' },
        { name: 'crypto_latency', domain: 'crypto', threshold: 5000, metric: 'latency', cooldownMs: 30000, severity: 'medium' },
        { name: 'voice_error_rate', domain: 'voice', threshold: 0.4, metric: 'error_rate', cooldownMs: 30000, severity: 'medium' },
        { name: 'voice_latency', domain: 'voice', threshold: 10000, metric: 'latency', cooldownMs: 20000, severity: 'low' },
      ],
      featureExtraction: {
        windowMs: 5000,
        enabledFeatures: ['spread', 'volume', 'volatility', 'momentum'],
      },
      ...config,
    };

    this.transport = getTransport();
    this.decisionLedger = new DecisionLedger();

    // Initialize circuit breakers
    for (const cbConfig of this.config.circuitBreakers) {
      this.circuitBreakers.set(cbConfig.name, new CircuitBreaker(cbConfig));
    }
  }

  // ==================== LIFECYCLE ====================

  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.startTime = Date.now();

    // Subscribe to observations
    this.transport.subscribeDurable(PUBSUB_TOPICS.OBS, async (event) => {
      await this.handleObservation(event as Observation);
    });

    // Subscribe to simulation results
    this.transport.subscribeDurable(PUBSUB_TOPICS.SIMRES, async (event) => {
      await this.handleSimResult(event as SimResult);
    });

    // Subscribe to gap events
    this.transport.subscribeDurable(PUBSUB_TOPICS.GAP, async (event) => {
      await this.handleGap(event as GapDetected);
    });

    // Start telemetry emission
    this.telemetryTimer = setInterval(() => {
      this.emitTelemetry();
    }, this.config.telemetryIntervalMs);

    console.log('[ReactorCore] Started');
    this.emit('started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }

    console.log('[ReactorCore] Stopped');
    this.emit('stopped');
  }

  // ==================== EVENT HANDLERS ====================

  private async handleObservation(obs: Observation): Promise<void> {
    this.processedCount++;

    try {
      // Check for duplicates
      if (await this.transport.isDuplicate(obs)) {
        return;
      }

      // Normalize and extract features
      const features = await this.extractFeatures(obs);
      await this.transport.storeFeatures(obs.trace_id, features);

      // Run the 4-gate pipeline
      const decision = await this.runGatePipeline(obs, features);

      // Record decision
      this.decisionLedger.record(decision);

      // Emit decision event
      this.emit('decision', decision);

    } catch (err) {
      this.errorCount++;
      console.error('[ReactorCore] Error handling observation:', err);
      this.emit('error', { observation: obs, error: err });
    }
  }

  private async handleSimResult(result: SimResult): Promise<void> {
    const pending = this.pendingSimulations.get(result.trace_id);
    if (pending) {
      pending.callback(result);
      this.pendingSimulations.delete(result.trace_id);
    }
  }

  private async handleGap(gap: GapDetected): Promise<void> {
    // Log gap for forensics
    console.log(`[ReactorCore] Gap detected: ${gap.domain} - ${gap.missingness} (${gap.severity})`);
    
    // If critical, might need to pause processing
    if (gap.severity === 'critical') {
      this.emit('critical_gap', gap);
    }
  }

  // ==================== FEATURE EXTRACTION ====================

  private async extractFeatures(obs: Observation): Promise<Record<string, unknown>> {
    const features: Record<string, unknown> = {
      timestamp: obs.ts,
      source: obs.source,
      type: obs.type,
      quality: obs.quality_flags,
    };

    // Domain-specific feature extraction
    if (obs.type === 'tick' || obs.type === 'book_delta') {
      const payload = obs.payload as any;
      features.crypto = {
        exchange: payload.exchange,
        symbol: payload.symbol,
        price: payload.data?.price,
        spread: payload.data?.spread,
        bid: payload.data?.bid,
        ask: payload.data?.ask,
        volume: payload.data?.volume,
      };
    }

    if (obs.type === 'text_chunk' || obs.type === 'ssml_segment') {
      const payload = obs.payload as any;
      features.voice = {
        text_length: payload.text?.length,
        language: payload.language,
        voice_id: payload.voice_id,
      };
    }

    if (obs.type === 'imagery_tile' || obs.type === 'geo_hint') {
      const payload = obs.payload as any;
      features.satellite = {
        coordinates: payload.coordinates,
        uncertainty: payload.uncertainty_m,
        confidence: payload.confidence,
      };
    }

    return features;
  }

  // ==================== 4-GATE PIPELINE ====================

  private async runGatePipeline(obs: Observation, features: Record<string, unknown>): Promise<DecisionRecord> {
    const traceId = obs.trace_id;
    const inputsHash = this.hashInputs(obs, features);
    const domain = this.inferDomain(obs);

    const decision: DecisionRecord = {
      id: randomUUID(),
      trace_id: traceId,
      timestamp: Date.now(),
      inputs_hash: inputsHash,
      gates: {
        feasibility: { passed: false },
        simulation: { passed: false, bypassed: false },
        policy: { passed: false },
        safety: { passed: false, breakers_checked: [] },
      },
    };

    // ===== GATE 1: FEASIBILITY =====
    const feasibilityResult = await this.gateFeasibility(domain, obs, features);
    decision.gates.feasibility = feasibilityResult;
    
    if (!feasibilityResult.passed) {
      decision.veto_reason = `Feasibility gate: ${feasibilityResult.reason}`;
      return decision;
    }

    // ===== GATE 2: SIMULATION =====
    const simulationResult = await this.gateSimulation(domain, obs, features);
    decision.gates.simulation = simulationResult;

    if (!simulationResult.passed && !simulationResult.bypassed) {
      decision.veto_reason = `Simulation gate: ${simulationResult.reason}`;
      return decision;
    }

    // ===== GATE 3: POLICY =====
    const policyResult = await this.gatePolicy(domain, obs, features, simulationResult);
    decision.gates.policy = policyResult;

    if (!policyResult.passed) {
      decision.veto_reason = `Policy gate: ${policyResult.reason}`;
      return decision;
    }

    // ===== GATE 4: SAFETY =====
    const safetyResult = await this.gateSafety(domain, obs, features, policyResult);
    decision.gates.safety = safetyResult;

    if (!safetyResult.passed) {
      decision.veto_reason = `Safety gate: ${safetyResult.reason}`;
      return decision;
    }

    // ===== EMIT ACTION INTENT =====
    const intent = await this.createActionIntent(domain, obs, features, policyResult);
    if (intent) {
      decision.final_intent_hash = this.hashIntent(intent);
      
      // Publish intent (but NOT execute - that's the executor's job)
      await this.transport.publishDurable(PUBSUB_TOPICS.INTENT, intent);
      
      console.log(`[ReactorCore] Emitted ActionIntent: ${intent.action_type} for ${intent.target} (trace: ${traceId})`);
    }

    return decision;
  }

  // ==================== GATE IMPLEMENTATIONS ====================

  private async gateFeasibility(domain: Domain, obs: Observation, features: Record<string, unknown>): Promise<GateResult & { metrics?: FeasibilityMetrics }> {
    const startTime = Date.now();

    if (domain === 'crypto') {
      const crypto = features.crypto as any;
      if (!crypto) {
        return { passed: false, reason: 'Missing crypto features', duration_ms: Date.now() - startTime };
      }

      // Compute feasibility metrics
      const spread = crypto.spread || (crypto.ask - crypto.bid) || 0;
      const expectedSlippage = spread * 0.5; // Simplified
      const expectedFees = 0.001; // 0.1% taker fee
      const netSpreadAfterFees = spread - expectedFees;
      
      const metrics: FeasibilityMetrics = {
        net_spread_after_fees: netSpreadAfterFees,
        expected_slippage: expectedSlippage,
        expected_fill_time_ms: 100, // Assume 100ms
        latency_bounds_ms: 500,
      };

      // Check if profitable after fees
      if (netSpreadAfterFees < 0.0001) {
        return {
          passed: false,
          reason: `Net spread after fees too low: ${(netSpreadAfterFees * 10000).toFixed(2)} bps`,
          metrics,
          duration_ms: Date.now() - startTime,
        };
      }

      return { passed: true, metrics, duration_ms: Date.now() - startTime };
    }

    if (domain === 'voice') {
      const voice = features.voice as any;
      if (!voice) {
        return { passed: false, reason: 'Missing voice features', duration_ms: Date.now() - startTime };
      }

      // Voice feasibility: check text length, provider availability
      if (voice.text_length > 5000) {
        return { passed: false, reason: 'Text too long for single synthesis', duration_ms: Date.now() - startTime };
      }

      return { passed: true, duration_ms: Date.now() - startTime };
    }

    if (domain === 'satellite') {
      const sat = features.satellite as any;
      if (!sat) {
        return { passed: false, reason: 'Missing satellite features', duration_ms: Date.now() - startTime };
      }

      // Check coordinate validity
      if (!sat.coordinates || Math.abs(sat.coordinates.lat) > 90 || Math.abs(sat.coordinates.lng) > 180) {
        return { passed: false, reason: 'Invalid coordinates', duration_ms: Date.now() - startTime };
      }

      return { passed: true, duration_ms: Date.now() - startTime };
    }

    return { passed: true, duration_ms: Date.now() - startTime };
  }

  private async gateSimulation(domain: Domain, obs: Observation, features: Record<string, unknown>): Promise<GateResult & { bypassed: boolean; sim_id?: string }> {
    const startTime = Date.now();

    // Determine if simulation is needed based on uncertainty
    const needsSimulation = this.assessUncertainty(domain, features);

    if (!needsSimulation) {
      // Bypass with logged justification
      return {
        passed: true,
        bypassed: true,
        reason: 'High confidence - simulation bypassed',
        duration_ms: Date.now() - startTime,
      };
    }

    // Check pending simulation limit
    if (this.pendingSimulations.size >= this.config.maxPendingSimulations) {
      return {
        passed: false,
        bypassed: false,
        reason: 'Too many pending simulations',
        duration_ms: Date.now() - startTime,
      };
    }

    // Request simulation
    const simRequest = this.createSimRequest(domain, obs, features);
    
    // For sync operation, we'll wait briefly for result
    // In production, this would be async with callback
    const simResult = await this.requestSimulation(simRequest);

    if (!simResult || simResult.confidence < this.config.minSimConfidence) {
      return {
        passed: false,
        bypassed: false,
        reason: simResult ? `Simulation confidence too low: ${simResult.confidence} (threshold: ${this.config.minSimConfidence})` : 'Simulation timeout',
        sim_id: simRequest.event_id,
        duration_ms: Date.now() - startTime,
      };
    }

    return {
      passed: true,
      bypassed: false,
      sim_id: simRequest.event_id,
      duration_ms: Date.now() - startTime,
    };
  }

  private async gatePolicy(domain: Domain, obs: Observation, features: Record<string, unknown>, simResult: GateResult): Promise<GateResult & { selected_action?: string }> {
    const startTime = Date.now();

    // Policy selection based on domain and features
    let selectedAction: string | undefined;

    if (domain === 'crypto') {
      const crypto = features.crypto as any;
      // Simple policy: market order if spread is good
      if (crypto?.spread && crypto.spread > 0.0005) {
        selectedAction = 'market_order';
      } else {
        selectedAction = 'limit_order';
      }
    }

    if (domain === 'voice') {
      selectedAction = 'synthesize';
    }

    if (domain === 'satellite') {
      selectedAction = 'monitor';
    }

    if (!selectedAction) {
      return {
        passed: false,
        reason: 'No suitable action policy found',
        duration_ms: Date.now() - startTime,
      };
    }

    return {
      passed: true,
      selected_action: selectedAction,
      duration_ms: Date.now() - startTime,
    };
  }

  private async gateSafety(domain: Domain, obs: Observation, features: Record<string, unknown>, policyResult: GateResult): Promise<GateResult & { breakers_checked: string[] }> {
    const startTime = Date.now();
    const breakersChecked: string[] = [];
    const tripEvents: Trip[] = [];

    // Check all circuit breakers for this domain
    for (const [name, breaker] of this.circuitBreakers) {
      if (name.startsWith(domain)) {
        breakersChecked.push(name);
        const { allowed, tripEvent } = breaker.check();
        
        if (!allowed) {
          if (tripEvent) {
            tripEvents.push(tripEvent);
            // Publish trip event
            await this.transport.publishDurable(PUBSUB_TOPICS.TRIP, tripEvent);
          }
          
          return {
            passed: false,
            reason: `Circuit breaker tripped: ${name}`,
            breakers_checked: breakersChecked,
            duration_ms: Date.now() - startTime,
          };
        }
      }
    }

    // Check risk envelope
    if (domain === 'crypto') {
      // Simple exposure check - in production, track actual positions
      // For now, always pass
    }

    return {
      passed: true,
      breakers_checked: breakersChecked,
      duration_ms: Date.now() - startTime,
    };
  }

  // ==================== HELPER METHODS ====================

  private inferDomain(obs: Observation): Domain {
    if (obs.type === 'tick' || obs.type === 'book_delta' || obs.type === 'trade') {
      return 'crypto';
    }
    if (obs.type === 'text_chunk' || obs.type === 'ssml_segment' || obs.type === 'phoneme_timing') {
      return 'voice';
    }
    if (obs.type === 'imagery_tile' || obs.type === 'geo_hint' || obs.type === 'osint_ping') {
      return 'satellite';
    }
    return 'generic';
  }

  private assessUncertainty(domain: Domain, features: Record<string, unknown>): boolean {
    // Simplified uncertainty assessment
    // In production, this would be more sophisticated
    if (domain === 'crypto') {
      const crypto = features.crypto as any;
      // High spread variance = high uncertainty
      return !crypto?.spread || crypto.spread < 0.001;
    }
    if (domain === 'satellite') {
      const sat = features.satellite as any;
      // Low confidence = high uncertainty
      return !sat?.confidence || sat.confidence < 0.8;
    }
    return false;
  }

  private createSimRequest(domain: Domain, obs: Observation, features: Record<string, unknown>): SimRequest {
    return {
      ...createBaseEvent(obs.trace_id),
      kind: 'simreq',
      domain,
      sim_type: domain === 'crypto' ? 'slippage_paths' : domain === 'voice' ? 'prosody_candidates' : 'position_paths',
      n_paths: 1000,
      horizon_ms: 5000,
      input_features: features,
      constraints: {},
      seed: Math.floor(Math.random() * 1000000),
      deadline_ts: Date.now() + this.config.gateTimeoutMs,
      priority: 5,
    };
  }

  private async requestSimulation(request: SimRequest): Promise<SimResult | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingSimulations.delete(request.trace_id);
        resolve(null);
      }, this.config.gateTimeoutMs);

      this.pendingSimulations.set(request.trace_id, {
        request,
        callback: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
      });

      // Publish simulation request
      this.transport.publishDurable(PUBSUB_TOPICS.SIMREQ, request);
    });
  }

  private async createActionIntent(domain: Domain, obs: Observation, features: Record<string, unknown>, policyResult: GateResult & { selected_action?: string }): Promise<ActionIntent | null> {
    if (!policyResult.selected_action) return null;

    const intent: ActionIntent = {
      ...createBaseEvent(obs.trace_id),
      kind: 'intent',
      domain,
      action_type: policyResult.selected_action,
      target: this.getTarget(domain, features),
      parameters: this.getParameters(domain, features, policyResult.selected_action),
      risk_envelope: this.getRiskEnvelope(domain),
      expires_ts: Date.now() + 30000, // 30 second expiry
      idempotency_key: `${obs.trace_id}_${policyResult.selected_action}_${Date.now()}`,
    };

    // Mark as dry-run if configured
    if (this.config.dryRun) {
      (intent as any).dry_run = true;
    }

    return intent;
  }

  private getTarget(domain: Domain, features: Record<string, unknown>): string {
    if (domain === 'crypto') {
      const crypto = features.crypto as any;
      return `${crypto?.exchange || 'unknown'}:${crypto?.symbol || 'unknown'}`;
    }
    if (domain === 'voice') {
      const voice = features.voice as any;
      return voice?.voice_id || 'default';
    }
    if (domain === 'satellite') {
      const sat = features.satellite as any;
      return sat?.coordinates ? `${sat.coordinates.lat},${sat.coordinates.lng}` : 'unknown';
    }
    return 'unknown';
  }

  private getParameters(domain: Domain, features: Record<string, unknown>, actionType: string): Record<string, unknown> {
    if (domain === 'crypto') {
      const crypto = features.crypto as any;
      return {
        exchange: crypto?.exchange,
        symbol: crypto?.symbol,
        side: 'buy', // Simplified
        quantity: 0.01, // Minimum size for safety
        order_type: actionType === 'market_order' ? 'market' : 'limit',
        price: actionType === 'limit_order' ? crypto?.bid : undefined,
      };
    }
    if (domain === 'voice') {
      const voice = features.voice as any;
      return {
        voice_id: voice?.voice_id,
        language: voice?.language,
        provider: 'elevenlabs',
      };
    }
    return {};
  }

  private getRiskEnvelope(domain: Domain): RiskEnvelope {
    if (domain === 'crypto') {
      return {
        max_loss: 100, // $100 max loss
        max_position: 1000, // $1000 max position
        max_latency_ms: 5000,
      };
    }
    if (domain === 'voice') {
      return {
        max_latency_ms: 10000,
        min_quality: 0.7,
      };
    }
    return {};
  }

  private hashInputs(obs: Observation, features: Record<string, unknown>): string {
    const data = JSON.stringify({ obs: { type: obs.type, source: obs.source }, features });
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  private hashIntent(intent: ActionIntent): string {
    const data = JSON.stringify({ action: intent.action_type, target: intent.target, params: intent.parameters });
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  private async emitTelemetry(): Promise<void> {
    const uptime = (Date.now() - this.startTime) / 1000;
    const errorRate = this.processedCount > 0 ? this.errorCount / this.processedCount : 0;

    const telemetry = {
      ...createBaseEvent(),
      kind: 'telemetry' as const,
      service: 'reactor-core',
      health: errorRate < 0.1 ? 'healthy' : errorRate < 0.3 ? 'degraded' : 'unhealthy',
      metrics: {
        throughput_eps: this.processedCount / Math.max(1, uptime),
        queue_depth: this.pendingSimulations.size,
        error_rate: errorRate,
        avg_latency_ms: 10, // Would need actual tracking
        p99_latency_ms: 50,
        memory_mb: process.memoryUsage().heapUsed / 1024 / 1024,
        cpu_usage: 0.1, // Would need actual tracking
        custom: {
          pending_sims: this.pendingSimulations.size,
          decisions_recorded: this.decisionLedger.getRecent(1).length > 0 ? 1 : 0,
        },
      },
      uptime_s: uptime,
    };

    await this.transport.publishDurable(PUBSUB_TOPICS.TELEMETRY, telemetry as any);
  }

  // ==================== PUBLIC API ====================

  getDecisionLedger(): DecisionLedger {
    return this.decisionLedger;
  }

  getCircuitBreakerStatus(): { name: string; status: 'open' | 'closed' }[] {
    return Array.from(this.circuitBreakers.entries()).map(([name, cb]) => ({
      name,
      status: cb.check().allowed ? 'closed' : 'open',
    }));
  }

  recordMetric(breakerName: string, value: number): void {
    const breaker = this.circuitBreakers.get(breakerName);
    if (breaker) {
      breaker.recordMetric(value);
    }
  }

  getStats(): { processed: number; errors: number; pendingSims: number; uptime: number } {
    return {
      processed: this.processedCount,
      errors: this.errorCount,
      pendingSims: this.pendingSimulations.size,
      uptime: (Date.now() - this.startTime) / 1000,
    };
  }
}

// Singleton factory
let reactorInstance: ReactorCore | null = null;

export function getReactorCore(config?: Partial<ReactorConfig>): ReactorCore {
  if (!reactorInstance) {
    reactorInstance = new ReactorCore(config);
  }
  return reactorInstance;
}

export default ReactorCore;
