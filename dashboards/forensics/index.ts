/**
 * FORENSICS DASHBOARD - OBSERVABILITY + WHY DID IT NOT ARB?
 * 
 * Provides complete visibility into:
 * - What was observed
 * - What gates ran
 * - What sims ran
 * - What decision was made
 * - What intent was emitted (or not)
 * - What the executor returned
 * - Which breaker vetoed
 * 
 * For any trace_id, answers the question with precision rather than guessing.
 */

import { EventEmitter } from 'events';
import {
  type ReactorEvent,
  type Observation,
  type GapDetected,
  type SimRequest,
  type SimResult,
  type ActionIntent,
  type ActionResult,
  type Telemetry,
  type Trip,
  type DecisionRecord,
  PUBSUB_TOPICS,
} from '../../packages/contracts/src/index';
import { getTransport, ReactorTransport } from '../../packages/contracts/src/transport';
import { getReactorCore, ReactorCore } from '../../services/reactor-core/index';

// ============================================================================
// TYPES
// ============================================================================

export interface TraceTimeline {
  trace_id: string;
  events: TimelineEvent[];
  summary: TraceSummary;
}

export interface TimelineEvent {
  timestamp: number;
  type: string;
  event: ReactorEvent;
  metadata?: Record<string, unknown>;
}

export interface TraceSummary {
  trace_id: string;
  started_at: number;
  ended_at?: number;
  duration_ms?: number;
  
  // Observations
  observation_count: number;
  observation_types: string[];
  data_quality: 'good' | 'degraded' | 'poor';
  
  // Gates
  gates_passed: string[];
  gates_failed: string[];
  veto_reason?: string;
  veto_details?: string;
  
  // Simulations
  simulations_requested: number;
  simulations_completed: number;
  simulations_degraded: number;
  avg_sim_confidence: number;
  
  // Intents
  intent_emitted: boolean;
  intent_type?: string;
  intent_target?: string;
  
  // Results
  execution_status?: string;
  execution_latency_ms?: number;
  execution_success: boolean;
  
  // Circuit breakers
  breakers_tripped: string[];
  
  // Final outcome
  outcome: 'success' | 'partial' | 'vetoed' | 'failed' | 'in_progress';
  outcome_reason: string;
}

export interface VetoAnalysis {
  trace_id: string;
  veto_time: number;
  veto_gate: string;
  veto_reason: string;
  contributing_factors: {
    factor: string;
    value: unknown;
    threshold?: unknown;
    impact: 'primary' | 'secondary' | 'minor';
  }[];
  recommendations: string[];
}

export interface SystemHealth {
  timestamp: number;
  overall_health: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    name: string;
    health: 'healthy' | 'degraded' | 'unhealthy';
    metrics: {
      throughput: number;
      error_rate: number;
      avg_latency_ms: number;
      queue_depth: number;
    };
    last_seen: number;
  }[];
  circuit_breakers: {
    name: string;
    status: 'open' | 'closed';
    trips_24h: number;
    last_trip?: number;
  }[];
  recent_trips: Trip[];
}

// ============================================================================
// FORENSICS DASHBOARD
// ============================================================================

export class ForensicsDashboard extends EventEmitter {
  private transport: ReactorTransport;
  private reactorCore?: ReactorCore;
  
  // Event stores (in-memory - production would use TimescaleDB or similar)
  private observations: Map<string, Observation[]> = new Map();
  private gaps: Map<string, GapDetected[]> = new Map();
  private simRequests: Map<string, SimRequest[]> = new Map();
  private simResults: Map<string, SimResult[]> = new Map();
  private intents: Map<string, ActionIntent[]> = new Map();
  private results: Map<string, ActionResult[]> = new Map();
  private trips: Trip[] = [];
  private telemetry: Map<string, Telemetry> = new Map();
  
  private isRunning: boolean = false;
  private maxEventsPerTrace: number = 1000;
  private maxTraces: number = 10000;

  constructor() {
    super();
    this.transport = getTransport();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Get reactor core reference if available
    try {
      this.reactorCore = getReactorCore();
    } catch {
      console.log('[Forensics] ReactorCore not available');
    }

    // Subscribe to all event types
    this.transport.subscribeDurable(PUBSUB_TOPICS.OBS, async (event) => {
      this.storeEvent('observation', event as Observation);
    });

    this.transport.subscribeDurable(PUBSUB_TOPICS.GAP, async (event) => {
      this.storeEvent('gap', event as GapDetected);
    });

    this.transport.subscribeDurable(PUBSUB_TOPICS.SIMREQ, async (event) => {
      this.storeEvent('simreq', event as SimRequest);
    });

    this.transport.subscribeDurable(PUBSUB_TOPICS.SIMRES, async (event) => {
      this.storeEvent('simres', event as SimResult);
    });

    this.transport.subscribeDurable(PUBSUB_TOPICS.INTENT, async (event) => {
      this.storeEvent('intent', event as ActionIntent);
    });

    this.transport.subscribeDurable(PUBSUB_TOPICS.RESULT, async (event) => {
      this.storeEvent('result', event as ActionResult);
    });

    this.transport.subscribeDurable(PUBSUB_TOPICS.TELEMETRY, async (event) => {
      const t = event as Telemetry;
      this.telemetry.set(t.service, t);
    });

    this.transport.subscribeDurable(PUBSUB_TOPICS.TRIP, async (event) => {
      this.trips.push(event as Trip);
      // Keep only recent trips
      if (this.trips.length > 1000) {
        this.trips = this.trips.slice(-1000);
      }
    });

    console.log('[Forensics] Dashboard started');
    this.emit('started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    console.log('[Forensics] Dashboard stopped');
    this.emit('stopped');
  }

  private storeEvent(type: string, event: ReactorEvent): void {
    const traceId = event.trace_id;
    
    let store: Map<string, any[]>;
    switch (type) {
      case 'observation': store = this.observations; break;
      case 'gap': store = this.gaps; break;
      case 'simreq': store = this.simRequests; break;
      case 'simres': store = this.simResults; break;
      case 'intent': store = this.intents; break;
      case 'result': store = this.results; break;
      default: return;
    }

    if (!store.has(traceId)) {
      store.set(traceId, []);
    }
    
    const events = store.get(traceId)!;
    events.push(event);
    
    // Trim if too many
    if (events.length > this.maxEventsPerTrace) {
      events.shift();
    }

    // Cleanup old traces
    if (store.size > this.maxTraces) {
      const oldest = Array.from(store.keys()).slice(0, 100);
      for (const key of oldest) {
        store.delete(key);
      }
    }
  }

  // ==================== TRACE ANALYSIS ====================

  /**
   * Get complete timeline for a trace
   */
  getTraceTimeline(traceId: string): TraceTimeline | null {
    const events: TimelineEvent[] = [];

    // Collect all events for this trace
    for (const obs of this.observations.get(traceId) || []) {
      events.push({ timestamp: obs.ts, type: 'observation', event: obs });
    }
    for (const gap of this.gaps.get(traceId) || []) {
      events.push({ timestamp: gap.ts, type: 'gap', event: gap });
    }
    for (const req of this.simRequests.get(traceId) || []) {
      events.push({ timestamp: req.ts, type: 'simreq', event: req });
    }
    for (const res of this.simResults.get(traceId) || []) {
      events.push({ timestamp: res.ts, type: 'simres', event: res });
    }
    for (const intent of this.intents.get(traceId) || []) {
      events.push({ timestamp: intent.ts, type: 'intent', event: intent });
    }
    for (const result of this.results.get(traceId) || []) {
      events.push({ timestamp: result.ts, type: 'result', event: result });
    }

    if (events.length === 0) {
      return null;
    }

    // Sort by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    // Generate summary
    const summary = this.generateTraceSummary(traceId, events);

    return { trace_id: traceId, events, summary };
  }

  private generateTraceSummary(traceId: string, events: TimelineEvent[]): TraceSummary {
    const observations = events.filter(e => e.type === 'observation').map(e => e.event as Observation);
    const gaps = events.filter(e => e.type === 'gap').map(e => e.event as GapDetected);
    const simReqs = events.filter(e => e.type === 'simreq').map(e => e.event as SimRequest);
    const simRes = events.filter(e => e.type === 'simres').map(e => e.event as SimResult);
    const intents = events.filter(e => e.type === 'intent').map(e => e.event as ActionIntent);
    const results = events.filter(e => e.type === 'result').map(e => e.event as ActionResult);

    // Get decision record from reactor core if available
    let decision: DecisionRecord | undefined;
    if (this.reactorCore) {
      decision = this.reactorCore.getDecisionLedger().get(traceId);
    }

    // Determine gates passed/failed
    const gatesPassed: string[] = [];
    const gatesFailed: string[] = [];
    let vetoReason: string | undefined;
    let vetoDetails: string | undefined;

    if (decision) {
      if (decision.gates.feasibility.passed) gatesPassed.push('feasibility');
      else { gatesFailed.push('feasibility'); vetoReason = 'Feasibility gate failed'; vetoDetails = decision.gates.feasibility.reason; }
      
      if (decision.gates.simulation.passed || decision.gates.simulation.bypassed) gatesPassed.push('simulation');
      else if (gatesFailed.length === 0) { gatesFailed.push('simulation'); vetoReason = 'Simulation gate failed'; vetoDetails = decision.gates.simulation.reason; }
      
      if (decision.gates.policy.passed) gatesPassed.push('policy');
      else if (gatesFailed.length === 0) { gatesFailed.push('policy'); vetoReason = 'Policy gate failed'; vetoDetails = decision.gates.policy.reason; }
      
      if (decision.gates.safety.passed) gatesPassed.push('safety');
      else if (gatesFailed.length === 0) { gatesFailed.push('safety'); vetoReason = 'Safety gate failed'; vetoDetails = decision.gates.safety.reason; }

      if (decision.veto_reason) {
        vetoReason = decision.veto_reason;
      }
    }

    // Calculate data quality
    const avgQuality = observations.length > 0
      ? observations.reduce((sum, o) => sum + o.quality_flags.freshness * o.quality_flags.completeness, 0) / observations.length
      : 0;
    const dataQuality: 'good' | 'degraded' | 'poor' = avgQuality > 0.8 ? 'good' : avgQuality > 0.5 ? 'degraded' : 'poor';

    // Calculate sim metrics
    const avgSimConfidence = simRes.length > 0
      ? simRes.reduce((sum, r) => sum + r.confidence, 0) / simRes.length
      : 0;
    const simsDegraded = simRes.filter(r => r.diagnostics.degraded).length;

    // Determine outcome
    let outcome: 'success' | 'partial' | 'vetoed' | 'failed' | 'in_progress' = 'in_progress';
    let outcomeReason = 'Processing';

    if (results.length > 0) {
      const lastResult = results[results.length - 1];
      if (lastResult.status === 'success') {
        outcome = 'success';
        outcomeReason = 'Execution completed successfully';
      } else if (lastResult.status === 'partial') {
        outcome = 'partial';
        outcomeReason = 'Partial execution';
      } else {
        outcome = 'failed';
        outcomeReason = `Execution failed: ${(lastResult.details as any).rejection_reason || lastResult.status}`;
      }
    } else if (gatesFailed.length > 0) {
      outcome = 'vetoed';
      outcomeReason = vetoReason || 'Gate veto';
    } else if (intents.length === 0 && observations.length > 0) {
      outcome = 'vetoed';
      outcomeReason = 'No intent emitted';
    }

    // Find tripped breakers
    const trippedBreakers = this.trips
      .filter(t => events.some(e => e.timestamp >= t.ts - 1000 && e.timestamp <= t.ts + 1000))
      .map(t => t.breaker_name);

    return {
      trace_id: traceId,
      started_at: events[0]?.timestamp || 0,
      ended_at: events[events.length - 1]?.timestamp,
      duration_ms: events.length > 1 ? events[events.length - 1].timestamp - events[0].timestamp : 0,
      
      observation_count: observations.length,
      observation_types: [...new Set(observations.map(o => o.type))],
      data_quality: dataQuality,
      
      gates_passed: gatesPassed,
      gates_failed: gatesFailed,
      veto_reason: vetoReason,
      veto_details: vetoDetails,
      
      simulations_requested: simReqs.length,
      simulations_completed: simRes.length,
      simulations_degraded: simsDegraded,
      avg_sim_confidence: avgSimConfidence,
      
      intent_emitted: intents.length > 0,
      intent_type: intents[0]?.action_type,
      intent_target: intents[0]?.target,
      
      execution_status: results[0]?.status,
      execution_latency_ms: results[0]?.latency_ms,
      execution_success: results.some(r => r.status === 'success'),
      
      breakers_tripped: trippedBreakers,
      
      outcome,
      outcome_reason: outcomeReason,
    };
  }

  /**
   * Analyze why a trace was vetoed
   */
  analyzeVeto(traceId: string): VetoAnalysis | null {
    const timeline = this.getTraceTimeline(traceId);
    if (!timeline || timeline.summary.outcome !== 'vetoed') {
      return null;
    }

    const factors: VetoAnalysis['contributing_factors'] = [];
    const recommendations: string[] = [];

    // Get decision record
    let decision: DecisionRecord | undefined;
    if (this.reactorCore) {
      decision = this.reactorCore.getDecisionLedger().get(traceId);
    }

    // Analyze feasibility gate
    if (decision?.gates.feasibility && !decision.gates.feasibility.passed) {
      const metrics = decision.gates.feasibility.metrics as any;
      if (metrics) {
        if (metrics.net_spread_after_fees !== undefined) {
          factors.push({
            factor: 'Net spread after fees',
            value: `${(metrics.net_spread_after_fees * 10000).toFixed(2)} bps`,
            threshold: '> 1 bp',
            impact: 'primary',
          });
          recommendations.push('Wait for wider spread or reduce fee tier');
        }
        if (metrics.expected_slippage !== undefined) {
          factors.push({
            factor: 'Expected slippage',
            value: `${(metrics.expected_slippage * 10000).toFixed(2)} bps`,
            impact: 'secondary',
          });
        }
      }
    }

    // Analyze simulation gate
    if (decision?.gates.simulation && !decision.gates.simulation.passed && !decision.gates.simulation.bypassed) {
      factors.push({
        factor: 'Simulation confidence',
        value: 'Low',
        threshold: '> 50%',
        impact: 'primary',
      });
      recommendations.push('Increase simulation path count or improve input data quality');
    }

    // Analyze safety gate
    if (decision?.gates.safety && !decision.gates.safety.passed) {
      for (const breaker of decision.gates.safety.breakers_checked || []) {
        factors.push({
          factor: `Circuit breaker: ${breaker}`,
          value: 'Tripped',
          impact: 'primary',
        });
      }
      recommendations.push('Wait for circuit breaker cooldown');
    }

    // Check data quality
    const obs = timeline.events.filter(e => e.type === 'observation').map(e => e.event as Observation);
    if (obs.length > 0) {
      const avgFreshness = obs.reduce((s, o) => s + o.quality_flags.freshness, 0) / obs.length;
      if (avgFreshness < 0.8) {
        factors.push({
          factor: 'Data freshness',
          value: `${(avgFreshness * 100).toFixed(0)}%`,
          threshold: '> 80%',
          impact: 'secondary',
        });
        recommendations.push('Check data feed connectivity');
      }
    }

    return {
      trace_id: traceId,
      veto_time: timeline.summary.ended_at || timeline.summary.started_at,
      veto_gate: timeline.summary.gates_failed[0] || 'unknown',
      veto_reason: timeline.summary.veto_reason || 'Unknown',
      contributing_factors: factors,
      recommendations,
    };
  }

  // ==================== SYSTEM HEALTH ====================

  /**
   * Get overall system health
   */
  getSystemHealth(): SystemHealth {
    const now = Date.now();
    const services: SystemHealth['services'] = [];

    // Aggregate telemetry by service
    for (const [name, t] of this.telemetry) {
      services.push({
        name,
        health: t.health,
        metrics: {
          throughput: t.metrics.throughput_eps,
          error_rate: t.metrics.error_rate,
          avg_latency_ms: t.metrics.avg_latency_ms,
          queue_depth: t.metrics.queue_depth,
        },
        last_seen: t.ts,
      });
    }

    // Get circuit breaker status
    const breakers: SystemHealth['circuit_breakers'] = [];
    if (this.reactorCore) {
      for (const { name, status } of this.reactorCore.getCircuitBreakerStatus()) {
        const trips24h = this.trips.filter(t => 
          t.breaker_name === name && t.ts > now - 24 * 60 * 60 * 1000
        ).length;
        const lastTrip = this.trips.filter(t => t.breaker_name === name).pop();
        
        breakers.push({
          name,
          status: status as 'open' | 'closed',
          trips_24h: trips24h,
          last_trip: lastTrip?.ts,
        });
      }
    }

    // Recent trips (last hour)
    const recentTrips = this.trips.filter(t => t.ts > now - 60 * 60 * 1000);

    // Overall health
    const unhealthyServices = services.filter(s => s.health === 'unhealthy').length;
    const degradedServices = services.filter(s => s.health === 'degraded').length;
    const openBreakers = breakers.filter(b => b.status === 'open').length;

    let overallHealth: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (unhealthyServices > 0 || openBreakers > 1) {
      overallHealth = 'unhealthy';
    } else if (degradedServices > 0 || openBreakers > 0) {
      overallHealth = 'degraded';
    }

    return {
      timestamp: now,
      overall_health: overallHealth,
      services,
      circuit_breakers: breakers,
      recent_trips: recentTrips,
    };
  }

  // ==================== QUERY METHODS ====================

  /**
   * Get recent traces
   */
  getRecentTraces(count: number = 100): TraceSummary[] {
    const allTraceIds = new Set<string>();
    
    for (const [traceId] of this.observations) allTraceIds.add(traceId);
    for (const [traceId] of this.intents) allTraceIds.add(traceId);
    for (const [traceId] of this.results) allTraceIds.add(traceId);

    const summaries: TraceSummary[] = [];
    for (const traceId of Array.from(allTraceIds).slice(-count)) {
      const timeline = this.getTraceTimeline(traceId);
      if (timeline) {
        summaries.push(timeline.summary);
      }
    }

    return summaries.sort((a, b) => b.started_at - a.started_at);
  }

  /**
   * Get vetoed traces
   */
  getVetoedTraces(count: number = 100): TraceSummary[] {
    return this.getRecentTraces(count * 2)
      .filter(s => s.outcome === 'vetoed')
      .slice(0, count);
  }

  /**
   * Get failed traces
   */
  getFailedTraces(count: number = 100): TraceSummary[] {
    return this.getRecentTraces(count * 2)
      .filter(s => s.outcome === 'failed')
      .slice(0, count);
  }

  /**
   * Search traces by criteria
   */
  searchTraces(criteria: {
    outcome?: string;
    gate_failed?: string;
    intent_type?: string;
    min_latency_ms?: number;
    from_ts?: number;
    to_ts?: number;
  }): TraceSummary[] {
    return this.getRecentTraces(1000).filter(s => {
      if (criteria.outcome && s.outcome !== criteria.outcome) return false;
      if (criteria.gate_failed && !s.gates_failed.includes(criteria.gate_failed)) return false;
      if (criteria.intent_type && s.intent_type !== criteria.intent_type) return false;
      if (criteria.min_latency_ms && (s.execution_latency_ms || 0) < criteria.min_latency_ms) return false;
      if (criteria.from_ts && s.started_at < criteria.from_ts) return false;
      if (criteria.to_ts && s.started_at > criteria.to_ts) return false;
      return true;
    });
  }

  getStats(): { traces: number; observations: number; intents: number; results: number; trips: number } {
    return {
      traces: new Set([...this.observations.keys(), ...this.intents.keys()]).size,
      observations: Array.from(this.observations.values()).reduce((s, a) => s + a.length, 0),
      intents: Array.from(this.intents.values()).reduce((s, a) => s + a.length, 0),
      results: Array.from(this.results.values()).reduce((s, a) => s + a.length, 0),
      trips: this.trips.length,
    };
  }
}

// Singleton factory
let dashboardInstance: ForensicsDashboard | null = null;

export function getForensicsDashboard(): ForensicsDashboard {
  if (!dashboardInstance) {
    dashboardInstance = new ForensicsDashboard();
  }
  return dashboardInstance;
}

export default ForensicsDashboard;
