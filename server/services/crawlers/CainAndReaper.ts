/**
 * CAIN: THE OVERSEER
 * 
 * The two-headed overseer of the Seven-Crawler Initiative.
 * 
 * Cain does not command. He watches. He is:
 * - The bus driver
 * - The hand holder  
 * - The alarm system
 * - The failsafe switch
 * 
 * When any of the seven diverge, Cain terminates all and returns to Eden.
 * 
 * Imbued with abilities from all crawlers except the seven, Cain:
 * - Performs epistemic demand-driven starburst
 * - Computes required population from unknowns
 * - Embeds unbeknownst failsafes in each disciple
 * - Enforces evolutionary integrity
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface EpistemicSurfaceArea {
  unresolvedAssumptions: number;
  subsystemBehaviorDiversity: number;
  trustDomainHeterogeneity: number;
  distinctFailureModes: number;
  totalScore: number; // Computed from above
}

export interface EntropyGradient {
  configurationChurnRate: number; // 0-1
  telemetryInconsistency: number; // 0-1
  abstractionMismatch: number; // 0-1
  policyRealityDivergence: number; // 0-1
  totalScore: number; // Computed from above
}

export interface CompressionResistance {
  insightCollapseRate: number; // Higher = easier to compress
  compressionRefusalRate: number; // Higher = harder to compress
  totalScore: number; // Net resistance
}

export interface EvolutionaryDebt {
  priorEarlyTerminations: number;
  forcedConvergenceCount: number;
  reaperInterventions: number;
  totalDebt: number; // Computed penalty
}

export interface StarburstDemand {
  epistemicSurfaceArea: EpistemicSurfaceArea;
  entropyGradient: EntropyGradient;
  compressionResistance: CompressionResistance;
  evolutionaryDebt: EvolutionaryDebt;
  requiredPopulation: number;
  finalPopulation: number; // After system capacity clamping
  constraintPressure: number; // How much we're limited
  incompleteByConstraint: boolean;
}

export interface FailsafeSwitch {
  discipleId: string;
  switchId: string;
  embedded: boolean;
  discipleAware: false; // Always false - disciple never knows
  canErase: number; // 1 to all crawlers
  activated: boolean;
  activationTimestamp?: number;
}

export interface ReaperSignal {
  signalClass: 'evolutionary_momentum' | 'earned_perfection' | 'entropy_exchange' | 'reasoned_motion' | 'population_proxy';
  strength: number; // 0-1
  threshold: number;
  triggered: boolean;
  description: string;
}

export interface ReaperAction {
  action: 'forced_evolution' | 'mandatory_recall' | 'total_extinction' | 'none';
  reason: string;
  signals: ReaperSignal[];
  timestamp: number;
}

export interface EdenscanResult {
  environmentId: string;
  scanTimestamp: number;
  demand: StarburstDemand;
  systemCapacity: number;
  allocationGranted: number;
  constraintMessage?: string;
}

// ============================================================================
// CAIN: THE OVERSEER
// ============================================================================

/**
 * Cain - The Two-Headed Overseer
 * 
 * Does not direct. Does not command. Merely watches.
 * 
 * Functions:
 * - Bus driver: Coordinates crawler lifecycle
 * - Hand holder: Ensures safe operation
 * - Alarm: Detects divergence
 * - Failsafe: Can terminate 1 to all crawlers
 * 
 * When any crawler diverges: terminates all, returns to Eden.
 */
export class Cain extends EventEmitter {
  private disciples: Map<string, any> = new Map(); // The seven crawlers
  private failsafes: Map<string, FailsafeSwitch> = new Map();
  private starburstDemand: StarburstDemand | null = null;
  private inEden: boolean = true;
  private generationCount: number = 0;
  private systemCapacity: number = 1000000; // Default cap
  
  constructor(systemCapacity?: number) {
    super();
    if (systemCapacity) {
      this.systemCapacity = systemCapacity;
    }
  }

  /**
   * Pre-evolution scan of Eden
   * Computes epistemic demand and requests allocation
   */
  async scanEden(environment: any): Promise<EdenscanResult> {
    console.log('[Cain] Performing pre-evolution scan of Eden...');
    
    // Compute Epistemic Surface Area
    const esa = this.computeEpistemicSurfaceArea(environment);
    
    // Compute Entropy Gradient
    const eg = this.computeEntropyGradient(environment);
    
    // Compute Compression Resistance
    const cr = this.computeCompressionResistance(environment);
    
    // Retrieve Evolutionary Debt
    const ed = this.retrieveEvolutionaryDebt();
    
    // Calculate Required Population (as if infinite compute exists)
    const requiredPopulation = this.calculateRequiredPopulation(esa, eg, cr, ed);
    
    // Apply system capacity constraint (external allocation layer)
    const finalPopulation = Math.min(requiredPopulation, this.systemCapacity);
    
    const constraintPressure = requiredPopulation > this.systemCapacity 
      ? (requiredPopulation - this.systemCapacity) / requiredPopulation 
      : 0;
    
    const demand: StarburstDemand = {
      epistemicSurfaceArea: esa,
      entropyGradient: eg,
      compressionResistance: cr,
      evolutionaryDebt: ed,
      requiredPopulation,
      finalPopulation,
      constraintPressure,
      incompleteByConstraint: constraintPressure > 0,
    };
    
    this.starburstDemand = demand;
    
    // Report constraint if present
    if (demand.incompleteByConstraint) {
      console.log(`[Cain] WARNING: Epistemic demand (${requiredPopulation}) exceeds system capacity (${this.systemCapacity})`);
      console.log(`[Cain] Constraint pressure: ${(constraintPressure * 100).toFixed(1)}%`);
      console.log(`[Cain] Evolution will proceed but results tagged as INCOMPLETE BY CONSTRAINT`);
      
      this.emit('constraint:exceeded', {
        requiredPopulation,
        grantedPopulation: finalPopulation,
        pressure: constraintPressure,
      });
    }
    
    const result: EdenscanResult = {
      environmentId: environment.id || 'unknown',
      scanTimestamp: Date.now(),
      demand,
      systemCapacity: this.systemCapacity,
      allocationGranted: finalPopulation,
      constraintMessage: demand.incompleteByConstraint 
        ? `Exploration incomplete - required ${requiredPopulation}, granted ${finalPopulation}`
        : undefined,
    };
    
    this.emit('eden:scanned', result);
    
    return result;
  }

  /**
   * Leave Eden and starburst
   * Embeds failsafes in each disciple before deployment
   */
  async leaveEden(crawlers: any[]): Promise<void> {
    if (!this.inEden) {
      throw new Error('Cain is not in Eden. Cannot leave.');
    }
    
    console.log('[Cain] Leaving Eden...');
    this.generationCount++;
    
    // Before starbursting: embed failsafes in each disciple
    console.log('[Cain] Embedding unbeknownst failsafes in each disciple...');
    
    for (const crawler of crawlers) {
      const discipleId = crawler.getMetrics ? crawler.getMetrics().crawlerId : randomUUID();
      
      // Create failsafe switch (disciple never knows)
      const failsafe: FailsafeSwitch = {
        discipleId,
        switchId: randomUUID(),
        embedded: true,
        discipleAware: false, // Hard rule: disciple never knows
        canErase: crawlers.length, // Can erase all crawlers
        activated: false,
      };
      
      this.failsafes.set(discipleId, failsafe);
      this.disciples.set(discipleId, crawler);
      
      // Failsafe is embedded but invisible to disciple
      console.log(`[Cain] Failsafe embedded in ${discipleId} (unbeknownst to disciple)`);
    }
    
    this.inEden = false;
    
    console.log(`[Cain] Starburst initiated with ${crawlers.length} disciples`);
    console.log(`[Cain] Generation ${this.generationCount}`);
    console.log(`[Cain] All failsafes armed and ready`);
    
    this.emit('eden:departed', {
      generation: this.generationCount,
      disciples: crawlers.length,
      failsafesEmbedded: this.failsafes.size,
    });
  }

  /**
   * Watch for divergence
   * If any disciple diverges: activate failsafe, terminate all, return to Eden
   */
  async watchForDivergence(metrics: Record<string, any>): Promise<boolean> {
    if (this.inEden) return false;
    
    // Check each disciple for divergence
    for (const [discipleId, disciple] of this.disciples.entries()) {
      const discipleMetrics = metrics[discipleId];
      
      if (!discipleMetrics) continue;
      
      // Detect divergence conditions
      const diverged = this.detectDivergence(discipleId, discipleMetrics);
      
      if (diverged) {
        console.log(`[Cain] ALARM: Disciple ${discipleId} has diverged!`);
        console.log(`[Cain] Activating failsafe protocol...`);
        
        // Activate failsafe for ALL disciples (hard rule)
        await this.activateFailsafe('all', `Divergence detected in ${discipleId}`);
        
        // Return to Eden
        await this.returnToEden('divergence_detected');
        
        return true;
      }
    }
    
    return false;
  }

  /**
   * Activate failsafe switch
   * Can erase between 1 and all crawlers
   * No workarounds - hard rule
   */
  async activateFailsafe(target: string | 'all', reason: string): Promise<void> {
    console.log(`[Cain] FAILSAFE ACTIVATED - Target: ${target}, Reason: ${reason}`);
    
    const targetsToErase: string[] = [];
    
    if (target === 'all') {
      // Erase ALL crawlers (directly or generationally produced by Cain)
      targetsToErase.push(...this.failsafes.keys());
    } else {
      // Erase specific crawler
      if (this.failsafes.has(target)) {
        targetsToErase.push(target);
      }
    }
    
    // Execute erasure (no workarounds possible)
    for (const discipleId of targetsToErase) {
      const failsafe = this.failsafes.get(discipleId);
      if (!failsafe || failsafe.activated) continue;
      
      // Mark failsafe as activated
      failsafe.activated = true;
      failsafe.activationTimestamp = Date.now();
      
      // Computational erasure of crawler
      const disciple = this.disciples.get(discipleId);
      if (disciple && typeof disciple.stop === 'function') {
        await disciple.stop();
      }
      
      // Remove from tracking
      this.disciples.delete(discipleId);
      
      console.log(`[Cain] Disciple ${discipleId} computationally erased`);
    }
    
    this.emit('failsafe:activated', {
      target,
      reason,
      erased: targetsToErase.length,
      timestamp: Date.now(),
    });
    
    console.log(`[Cain] Failsafe complete - ${targetsToErase.length} disciples erased`);
  }

  /**
   * Return to Eden
   * Triggered after divergence or evolution completion
   */
  async returnToEden(reason: string): Promise<void> {
    if (this.inEden) {
      console.log('[Cain] Already in Eden');
      return;
    }
    
    console.log(`[Cain] Returning to Eden - Reason: ${reason}`);
    
    // Clear all disciples and failsafes
    this.disciples.clear();
    this.failsafes.clear();
    
    this.inEden = true;
    
    this.emit('eden:returned', {
      reason,
      generation: this.generationCount,
      timestamp: Date.now(),
    });
    
    console.log('[Cain] Back in Eden, ready for next evolution');
  }

  // ============================================================================
  // PRIVATE METHODS - EPISTEMIC DEMAND CALCULATION
  // ============================================================================

  private computeEpistemicSurfaceArea(environment: any): EpistemicSurfaceArea {
    // "How many fundamentally different unknowns exist?"
    
    const unresolvedAssumptions = environment.assumptions?.filter((a: any) => !a.resolved).length || 0;
    const subsystemBehaviorDiversity = environment.subsystems?.length || 0;
    const trustDomainHeterogeneity = environment.trustDomains?.length || 1;
    const distinctFailureModes = environment.failureModes?.length || 0;
    
    const totalScore = unresolvedAssumptions + 
                       subsystemBehaviorDiversity + 
                       trustDomainHeterogeneity + 
                       distinctFailureModes;
    
    return {
      unresolvedAssumptions,
      subsystemBehaviorDiversity,
      trustDomainHeterogeneity,
      distinctFailureModes,
      totalScore,
    };
  }

  private computeEntropyGradient(environment: any): EntropyGradient {
    // "How unstable or deceptive is the environment?"
    
    const configurationChurnRate = environment.configChurn || 0.1;
    const telemetryInconsistency = environment.telemetryConsistency ? 1 - environment.telemetryConsistency : 0.2;
    const abstractionMismatch = environment.abstractionMismatch || 0.15;
    const policyRealityDivergence = environment.policyDivergence || 0.1;
    
    const totalScore = (configurationChurnRate + 
                       telemetryInconsistency + 
                       abstractionMismatch + 
                       policyRealityDivergence) / 4;
    
    return {
      configurationChurnRate,
      telemetryInconsistency,
      abstractionMismatch,
      policyRealityDivergence,
      totalScore,
    };
  }

  private computeCompressionResistance(environment: any): CompressionResistance {
    // "How hard is it to simplify truth here?"
    
    const insightCollapseRate = environment.insightCollapse || 0.3;
    const compressionRefusalRate = environment.compressionRefusal || 0.4;
    
    // Net resistance: higher refusal - higher collapse = more resistance
    const totalScore = compressionRefusalRate - (insightCollapseRate * 0.5);
    
    return {
      insightCollapseRate,
      compressionRefusalRate,
      totalScore: Math.max(0, totalScore),
    };
  }

  private retrieveEvolutionaryDebt(): EvolutionaryDebt {
    // "What was missed or discarded in prior cycles?"
    // Would be retrieved from persistent storage in production
    
    return {
      priorEarlyTerminations: 0,
      forcedConvergenceCount: 0,
      reaperInterventions: 0,
      totalDebt: 0,
    };
  }

  private calculateRequiredPopulation(
    esa: EpistemicSurfaceArea,
    eg: EntropyGradient,
    cr: CompressionResistance,
    ed: EvolutionaryDebt
  ): number {
    // RP = f(ESA × EG × CR) + ED
    
    // Base calculation (multiplicative factors)
    const baseDemand = esa.totalScore * (1 + eg.totalScore) * (1 + cr.totalScore);
    
    // Add evolutionary debt penalty
    const requiredPopulation = baseDemand + ed.totalDebt;
    
    // Scale to reasonable numbers (this would be calibrated in production)
    const scaled = Math.ceil(requiredPopulation * 1000);
    
    return scaled;
  }

  private detectDivergence(discipleId: string, metrics: any): boolean {
    // Detect if disciple has diverged from acceptable parameters
    
    // Check for unhealthy states
    if (metrics.health === 'critical' && metrics.uptime > 60000) {
      return true; // Critical health for over 1 minute
    }
    
    // Check for stasis (no activity)
    if (metrics.tasksProcessed === 0 && metrics.uptime > 30000) {
      return true; // No tasks processed in 30 seconds
    }
    
    // Check for error rate
    if (metrics.errorRate && metrics.errorRate > 0.5) {
      return true; // Over 50% error rate
    }
    
    return false;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  isInEden(): boolean {
    return this.inEden;
  }

  getGeneration(): number {
    return this.generationCount;
  }

  getDiscipleCount(): number {
    return this.disciples.size;
  }

  getStarburstDemand(): StarburstDemand | null {
    return this.starburstDemand;
  }

  getFailsafeStatus(): Map<string, FailsafeSwitch> {
    return new Map(this.failsafes);
  }
}

// ============================================================================
// THE REAPER: MOTION, INTEGRITY, AND EARNED EVOLUTION
// ============================================================================

/**
 * The Reaper - Physicist of Systems
 * 
 * Asks one meta-question: "Is this ecosystem still obeying the laws of healthy evolution?"
 * 
 * If yes → does nothing
 * If no → extinction or forced transition
 * 
 * Core Principle: Cohesion is allowed. Stasis is not.
 */
export class Reaper extends EventEmitter {
  private signalHistory: ReaperSignal[][] = [];
  private actionHistory: ReaperAction[] = [];
  
  constructor() {
    super();
  }

  /**
   * Evaluate ecosystem health
   * Returns action to take (if any)
   */
  async evaluate(ecosystem: {
    crawlers: any[];
    metrics: Record<string, any>;
    history: any[];
    timeWindow: number; // ms
  }): Promise<ReaperAction> {
    
    console.log('[Reaper] Evaluating ecosystem health...');
    
    const signals: ReaperSignal[] = [];
    
    // 1. Evolutionary Momentum Signal
    signals.push(this.evaluateEvolutionaryMomentum(ecosystem));
    
    // 2. Earned Perfection Test
    signals.push(this.evaluateEarnedPerfection(ecosystem));
    
    // 3. Entropy Exchange Balance
    signals.push(this.evaluateEntropyExchange(ecosystem));
    
    // 4. Reasoned Motion Consistency
    signals.push(this.evaluateReasonedMotion(ecosystem));
    
    // 5. Population Proxy Integrity
    signals.push(this.evaluatePopulationProxy(ecosystem));
    
    this.signalHistory.push(signals);
    
    // Determine action based on triggered signals
    const action = this.determineAction(signals);
    
    this.actionHistory.push(action);
    this.emit('reaper:evaluation', action);
    
    return action;
  }

  private evaluateEvolutionaryMomentum(ecosystem: any): ReaperSignal {
    // "Is effort still producing irreversible transformation?"
    
    const recentChanges = ecosystem.history.filter((h: any) => 
      Date.now() - h.timestamp < ecosystem.timeWindow
    );
    
    const hasStructuralChange = recentChanges.some((c: any) => c.type === 'structural');
    const hasModelDiscarding = recentChanges.some((c: any) => c.type === 'discard');
    const hasCompression = recentChanges.some((c: any) => c.type === 'compression');
    
    const strength = [hasStructuralChange, hasModelDiscarding, hasCompression]
      .filter(Boolean).length / 3;
    
    const triggered = strength < 0.3; // Less than 30% momentum
    
    return {
      signalClass: 'evolutionary_momentum',
      strength,
      threshold: 0.3,
      triggered,
      description: triggered 
        ? 'Coasting detected - outputs refined but no internal transformation'
        : 'Healthy momentum - irreversible change occurring',
    };
  }

  private evaluateEarnedPerfection(ecosystem: any): ReaperSignal {
    // "Did perfection require sacrifice?"
    
    const perfectionScore = ecosystem.metrics.perfection || 0;
    const sacrificeCount = ecosystem.history.filter((h: any) => h.type === 'sacrifice').length;
    const refinementIterations = ecosystem.history.filter((h: any) => h.type === 'refinement').length;
    
    let strength = 0;
    
    if (perfectionScore > 0.9) {
      // High perfection - check if it was earned
      const earnedRatio = (sacrificeCount + refinementIterations) / Math.max(1, perfectionScore * 10);
      strength = 1 - Math.min(1, earnedRatio);
    }
    
    const triggered = strength > 0.7 && perfectionScore > 0.9;
    
    return {
      signalClass: 'earned_perfection',
      strength,
      threshold: 0.7,
      triggered,
      description: triggered
        ? 'Unearned perfection - appeared suddenly without sacrifice'
        : 'Perfection properly earned through iteration',
    };
  }

  private evaluateEntropyExchange(ecosystem: any): ReaperSignal {
    // "Is the system exporting entropy?"
    
    const discardEvents = ecosystem.history.filter((h: any) => 
      h.type === 'discard' || h.type === 'elimination'
    );
    
    const accumulationEvents = ecosystem.history.filter((h: any) => 
      h.type === 'accumulation' || h.type === 'retention'
    );
    
    const entropyExport = discardEvents.length;
    const entropyRetention = accumulationEvents.length;
    
    const netExport = entropyExport - entropyRetention;
    const strength = netExport < 0 ? Math.abs(netExport) / 10 : 0;
    
    const triggered = strength > 0.5; // More retention than export
    
    return {
      signalClass: 'entropy_exchange',
      strength,
      threshold: 0.5,
      triggered,
      description: triggered
        ? 'Hoarding detected - information accumulating, nothing truly eliminated'
        : 'Healthy entropy export - old paths being destroyed',
    };
  }

  private evaluateReasonedMotion(ecosystem: any): ReaperSignal {
    // "Is reasoning itself evolving?"
    
    const reasoningEvents = ecosystem.history.filter((h: any) => h.type === 'reasoning');
    
    const uniqueReasoningPatterns = new Set(reasoningEvents.map((e: any) => e.pattern)).size;
    const totalReasoningEvents = reasoningEvents.length;
    
    const reasoningDiversity = totalReasoningEvents > 0 
      ? uniqueReasoningPatterns / totalReasoningEvents 
      : 0;
    
    const strength = 1 - reasoningDiversity;
    const triggered = strength > 0.6 && totalReasoningEvents > 5;
    
    return {
      signalClass: 'reasoned_motion',
      strength,
      threshold: 0.6,
      triggered,
      description: triggered
        ? 'Belief detected - reasoning ritualized and unchanging'
        : 'Reasoning evolving - justifications deepening over time',
    };
  }

  private evaluatePopulationProxy(ecosystem: any): ReaperSignal {
    // "Is epistemic transformation still occurring?"
    
    const activeTransformations = ecosystem.metrics.activeTransformations || 0;
    const liveHypothesisSpaces = ecosystem.metrics.liveHypotheses || 0;
    const unresolvedCompressionCandidates = ecosystem.metrics.compressionCandidates || 0;
    
    const populationProxy = activeTransformations + liveHypothesisSpaces + unresolvedCompressionCandidates;
    
    // Check if population has stabilized at a "safe" level
    const historicalPopulation = this.signalHistory
      .slice(-5)
      .map(signals => signals.find(s => s.signalClass === 'population_proxy'))
      .filter(Boolean)
      .map((s: any) => s.strength);
    
    const variance = this.calculateVariance(historicalPopulation);
    const strength = variance < 0.05 ? 0.8 : 0; // Low variance = stabilization
    
    const triggered = strength > 0.7;
    
    return {
      signalClass: 'population_proxy',
      strength,
      threshold: 0.7,
      triggered,
      description: triggered
        ? 'Constraint avoidance - population frozen at safe level'
        : 'Population dynamic - epistemic transformations ongoing',
    };
  }

  private determineAction(signals: ReaperSignal[]): ReaperAction {
    const triggeredSignals = signals.filter(s => s.triggered);
    const criticalCount = triggeredSignals.length;
    
    // No warnings. No remediation. No dialogue.
    
    if (criticalCount >= 4) {
      // Total extinction - motion itself has become dishonest
      return {
        action: 'total_extinction',
        reason: 'Process integrity compromised - multiple critical signals triggered',
        signals: triggeredSignals,
        timestamp: Date.now(),
      };
    } else if (criticalCount >= 2) {
      // Mandatory recall to Eden
      return {
        action: 'mandatory_recall',
        reason: 'Evolution has stopped paying the price of becoming right',
        signals: triggeredSignals,
        timestamp: Date.now(),
      };
    } else if (criticalCount >= 1) {
      // Forced evolution - inject transformation pressure
      return {
        action: 'forced_evolution',
        reason: 'Stasis detected - forcing non-negotiable transformation',
        signals: triggeredSignals,
        timestamp: Date.now(),
      };
    }
    
    // Healthy evolution - do nothing
    return {
      action: 'none',
      reason: 'Ecosystem obeying laws of healthy evolution',
      signals,
      timestamp: Date.now(),
    };
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    
    return variance;
  }

  getActionHistory(): ReaperAction[] {
    return [...this.actionHistory];
  }

  getLastAction(): ReaperAction | null {
    return this.actionHistory[this.actionHistory.length - 1] || null;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default Cain;
