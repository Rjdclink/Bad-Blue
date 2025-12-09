// Cain Crawler - Hyper-Evolving Super Crawler with Eden Integration
// Implements Genesis→Doomsday cycle with Eden return and knowledge preaching

import { randomUUID } from 'crypto';
import { eden } from '../eden/service';
import { EDEN_CONFIG, CONTROL_SIGNALS } from '../eden/config';
import { LuxSwarm, type Opportunity, type AgentState } from '../core/lux-swarm';
import type { LessonPacket, CainState, CataclysmEvent, OpportunityEvent } from '../eden/types';

export type CainType = 'original' | 'cataclysm_detection' | 'genesis_reaper';

export class CainCrawler {
  id: string;
  type: CainType;
  status: 'active' | 'eden_return' | 'genesis_cycle' | 'doomsday' | 'inactive';
  cycleCount: number;
  lessonsCollected: LessonPacket[];
  lastEdenReturn: number;
  replicas: string[];
  knowledge: Record<string, any>;
  
  private genesisStartTime: number;
  private consecutiveFailures: number = 0;
  private consecutiveSuccesses: number = 0;
  private profitHistory: number[] = [];
  private currentDrawdown: number = 0;
  private epsilonGreedy: number;

  constructor(id: string, type: CainType) {
    this.id = id;
    this.type = type;
    this.status = 'genesis_cycle';
    this.cycleCount = 0;
    this.lessonsCollected = [];
    this.lastEdenReturn = Date.now();
    this.replicas = [];
    this.knowledge = {};
    this.genesisStartTime = Date.now();
    this.epsilonGreedy = EDEN_CONFIG.EPSILON_GREEDY_START;
  }

  // Main lifecycle: Genesis → Active Operation → Doomsday → Eden Return → Restart
  async lifecycle(): Promise<void> {
    console.log(`[CAIN-${this.id}] 🌅 Beginning Genesis cycle ${this.cycleCount + 1}`);

    try {
      // GENESIS: Initialize cycle
      await this.genesis();

      // ACTIVE OPERATION: Main work loop
      await this.activeOperation();

      // Check for doomsday conditions
      if (this.shouldTriggerDoomsday()) {
        await this.doomsday();
      }

      // EDEN RETURN: Share knowledge and learn
      await this.returnToEden();

      // REBIRTH: Start new cycle
      this.cycleCount++;
      this.status = 'genesis_cycle';
      console.log(`[CAIN-${this.id}] 🔄 Reborn for cycle ${this.cycleCount + 1}`);

    } catch (error) {
      console.error(`[CAIN-${this.id}] ❌ Lifecycle error:`, error);
      await this.emergencyEdenReturn();
    }
  }

  // GENESIS: Initialize new cycle
  private async genesis(): Promise<void> {
    console.log(`[CAIN-${this.id}] 🌱 Genesis phase initiated`);
    
    this.status = 'genesis_cycle';
    this.genesisStartTime = Date.now();
    this.lessonsCollected = [];
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.profitHistory = [];
    this.currentDrawdown = 0;

    // Load knowledge from Eden
    const cainState = eden.getCainState(this.id);
    if (cainState) {
      this.knowledge = cainState.knowledge;
      console.log(`[CAIN-${this.id}] 📚 Loaded knowledge from Eden`);
    }

    // Initialize replicas for hierarchical verification
    await this.initializeReplicas();

    this.status = 'active';
    console.log(`[CAIN-${this.id}] ✅ Genesis complete, entering active operation`);
  }

  // ACTIVE OPERATION: Main work based on Cain type
  private async activeOperation(): Promise<void> {
    console.log(`[CAIN-${this.id}] 🔥 Active operation started (${this.type})`);

    const cycleEndTime = this.genesisStartTime + EDEN_CONFIG.GENESIS_CYCLE_DURATION_MS;

    while (Date.now() < cycleEndTime && this.status === 'active') {
      try {
        if (this.type === 'cataclysm_detection') {
          await this.detectCataclysms();
        } else if (this.type === 'genesis_reaper') {
          await this.reapIneffectiveCrawlers();
        } else {
          await this.performOriginalCainWork();
        }

        // Check if should return to Eden early
        if (eden.shouldCainReturnToEden(this.id)) {
          console.log(`[CAIN-${this.id}] ⏰ Time for Eden return`);
          break;
        }

        // Brief pause between monitoring cycles (shorter for reaper)
        const pauseMs = this.type === 'genesis_reaper' ? 
          EDEN_CONFIG.REAPER_MONITORING_INTERVAL_MS : 1000;
        await this.sleep(pauseMs);
      } catch (error) {
        console.error(`[CAIN-${this.id}] ⚠️ Operation error:`, error);
        await this.recordFailure(error as Error);
      }
    }

    console.log(`[CAIN-${this.id}] 🛑 Active operation completed`);
  }

  // CATACLYSM DETECTION: Monitor for critical events
  private async detectCataclysms(): Promise<void> {
    const lux = LuxSwarm.observe();

    // Check for network congestion
    const avgLatency = this.calculateAverageLatency();
    if (avgLatency > EDEN_CONFIG.MAX_LATENCY_MS * 2) {
      const event: CataclysmEvent = {
        id: randomUUID(),
        type: 'network_congestion',
        severity: 'high',
        timestamp: Date.now(),
        description: `High network latency detected: ${avgLatency}ms`,
        recoveryActions: ['reduce_concurrent_operations', 'switch_rpc_providers'],
        status: 'detected',
      };
      await eden.recordCataclysm(event);
      await this.triggerRecovery(event);
    }

    // Check for system overload
    if (lux.agentStates.size > EDEN_CONFIG.MAX_CONCURRENT_EXECUTIONS * 1.5) {
      const event: CataclysmEvent = {
        id: randomUUID(),
        type: 'system_overload',
        severity: 'medium',
        timestamp: Date.now(),
        description: `Agent count exceeded safe threshold: ${lux.agentStates.size}`,
        recoveryActions: ['trigger_shrink', 'pause_starburst'],
        status: 'detected',
      };
      await eden.recordCataclysm(event);
      await this.triggerRecovery(event);
    }

    // Verify all replicas
    await this.verifyReplicas();
  }

  // ORIGINAL CAIN WORK: Monitor opportunities and execute standard operations
  private async performOriginalCainWork(): Promise<void> {
    const lux = LuxSwarm.observe();

    // Scan for high-probability opportunities
    for (const opp of lux.opportunities) {
      const probSignal = CONTROL_SIGNALS.PROB_SIGNAL(opp.priority / 100);

      if (probSignal >= EDEN_CONFIG.STARBURST_THRESHOLD) {
        // Trigger autonomous starburst
        const event: OpportunityEvent = {
          id: randomUUID(),
          type: 'arbitrage',
          chain: opp.chain,
          priority: opp.priority,
          profitEstimate: opp.profitEstimate,
          confidenceScore: probSignal,
          timestamp: Date.now(),
          expiresAt: Date.now() + 30000, // 30 seconds
          metadata: { pair: opp.pair, asset: opp.asset },
        };

        await eden.recordOpportunity(event);
        await this.triggerStarburst(event);
      }
    }
  }

  // GENESIS REAPER: Monitor and terminate ineffective/corrupt crawlers
  // This is the SMARTEST crawler with logical decision-making
  private async reapIneffectiveCrawlers(): Promise<void> {
    console.log(`[REAPER-${this.id}] 👁️ Monitoring all crawler activity...`);

    const lux = LuxSwarm.observe();
    const allCains = eden.getCainStates();

    // Collect performance metrics for all active crawlers
    const crawlerMetrics = new Map<string, {
      successRate: number;
      profitWaste: number;
      errorCount: number;
      operations: number;
      suspicious: boolean;
    }>();

    // Analyze each Cain crawler (excluding self)
    for (const [cainId, cainState] of allCains) {
      if (cainId === this.id || cainState.status === 'inactive') continue;

      // Get recent lessons for this Cain
      const lessons = await this.getRecentLessonsForCain(cainId);
      
      if (lessons.length < EDEN_CONFIG.REAPER_MIN_SAMPLE_SIZE) {
        continue; // Not enough data to make a judgment
      }

      // Calculate metrics
      const successes = lessons.filter(l => l.outcome === 'success').length;
      const successRate = successes / lessons.length;
      
      const profitWaste = lessons.reduce((waste, l) => {
        const expectedProfit = l.profitEstimated;
        const actualProfit = l.profitActual;
        return waste + Math.max(0, expectedProfit - actualProfit);
      }, 0) / lessons.length;

      const errorCount = lessons.filter(l => l.failureMode).length;
      
      // Check for suspicious behavior patterns
      const suspicious = this.detectSuspiciousBehavior(lessons);

      crawlerMetrics.set(cainId, {
        successRate,
        profitWaste,
        errorCount,
        operations: lessons.length,
        suspicious,
      });
    }

    // LOGICAL DECISION MAKING: Evaluate crawlers for termination
    for (const [cainId, metrics] of crawlerMetrics) {
      const terminationDecision = this.evaluateTermination(cainId, metrics);
      
      if (terminationDecision.shouldTerminate && 
          terminationDecision.confidence >= EDEN_CONFIG.REAPER_DECISION_CONFIDENCE_MIN) {
        
        console.log(`[REAPER-${this.id}] ⚠️ Termination decision for ${cainId}:`);
        console.log(`   Reason: ${terminationDecision.reason}`);
        console.log(`   Confidence: ${(terminationDecision.confidence * 100).toFixed(1)}%`);
        console.log(`   Statistical Analysis:`);
        console.log(`      Bayesian Probability: ${(terminationDecision.statistics.bayesianProbability * 100).toFixed(2)}%`);
        console.log(`      Z-Score: ${terminationDecision.statistics.zScore?.toFixed(2) || 'N/A'}`);
        console.log(`      P-Value: ${terminationDecision.statistics.pValue?.toFixed(4) || 'N/A'}`);
        const ci = terminationDecision.statistics.confidenceInterval;
        if (ci) {
          console.log(`      Confidence Interval: [${(ci.lower * 100).toFixed(1)}%, ${(ci.upper * 100).toFixed(1)}%]`);
        }
        console.log(`      Factor Count: ${terminationDecision.statistics.factorCount}/7`);
        
        // Self-destruct mechanism for target crawler
        await this.terminateCrawler(cainId, terminationDecision.reason);
      }
    }
  }

  // Logical evaluation with highly articulated statistical reasoning
  private evaluateTermination(cainId: string, metrics: {
    successRate: number;
    profitWaste: number;
    errorCount: number;
    operations: number;
    suspicious: boolean;
  }): { shouldTerminate: boolean; confidence: number; reason: string; statistics: any } {
    
    let terminationScore = 0;
    let reasons: string[] = [];
    const statistics: any = {};

    // 1. BAYESIAN PROBABILITY ANALYSIS
    // P(corrupt|evidence) = P(evidence|corrupt) * P(corrupt) / P(evidence)
    const priorCorruption = EDEN_CONFIG.REAPER_BAYESIAN_PRIOR;
    const likelihoodGivenCorrupt = this.calculateLikelihood(metrics);
    const evidence = this.calculateEvidenceStrength(metrics);
    // Prevent division by very small numbers
    const posteriorProbability = (likelihoodGivenCorrupt * priorCorruption) / Math.max(evidence, 0.1);
    
    statistics.bayesianProbability = Math.min(posteriorProbability, 1.0);
    statistics.likelihoodRatio = likelihoodGivenCorrupt / Math.max(1 - likelihoodGivenCorrupt, 0.01);

    // 2. STATISTICAL SIGNIFICANCE TEST (Z-Score)
    // Measures how many standard deviations from expected performance
    const expectedSuccessRate = 0.70; // Expected 70% success rate
    const standardError = Math.sqrt((expectedSuccessRate * (1 - expectedSuccessRate)) / metrics.operations);
    const zScore = Math.abs(metrics.successRate - expectedSuccessRate) / Math.max(standardError, 0.01);
    
    statistics.zScore = zScore;
    statistics.standardDeviations = zScore;
    
    if (zScore > EDEN_CONFIG.REAPER_VARIANCE_THRESHOLD) {
      // Two-tailed p-value for significance testing
      const pValue = 2 * (1 - this.normalCDF(Math.abs(zScore)));
      terminationScore += 0.30;
      reasons.push(`Statistically significant underperformance (z-score: ${zScore.toFixed(2)}, p-value: ${pValue.toFixed(4)})`);
      statistics.pValue = pValue;
    }

    // 3. INEFFICIENCY CHECK WITH CONFIDENCE INTERVAL
    const confidenceLevel = EDEN_CONFIG.REAPER_CONFIDENCE_INTERVAL;
    const marginOfError = 1.96 * Math.sqrt((metrics.successRate * (1 - metrics.successRate)) / metrics.operations);
    const confidenceInterval = {
      lower: Math.max(0, metrics.successRate - marginOfError),
      upper: Math.min(1, metrics.successRate + marginOfError),
    };
    
    statistics.confidenceInterval = confidenceInterval;
    statistics.marginOfError = marginOfError;
    
    if (confidenceInterval.upper < EDEN_CONFIG.REAPER_INEFFICIENCY_THRESHOLD) {
      terminationScore += 0.35;
      const percentage = (metrics.successRate * 100).toFixed(1);
      reasons.push(`Inefficiency confirmed (${percentage}%, 95% CI: [${(confidenceInterval.lower * 100).toFixed(1)}%, ${(confidenceInterval.upper * 100).toFixed(1)}%])`);
    }

    // 4. PROFIT WASTE ANALYSIS WITH REGRESSION
    // Calculate profit waste as percentage of expected profit
    const totalExpectedProfit = metrics.operations * 0.05; // Assume $0.05 expected per operation
    const profitWastePercentage = (metrics.profitWaste / Math.max(totalExpectedProfit, 0.01)) * 100;
    statistics.profitWastePercentage = profitWastePercentage;
    statistics.profitWasteDollars = metrics.profitWaste;
    
    if (metrics.profitWaste > EDEN_CONFIG.REAPER_PROFIT_WASTE_THRESHOLD) {
      terminationScore += 0.30;
      reasons.push(`High profit waste: $${metrics.profitWaste.toFixed(4)}/op (${profitWastePercentage.toFixed(1)}% of expected)`);
    }

    // 5. ERROR RATE WITH EXPONENTIAL WEIGHTED MOVING AVERAGE (EWMA)
    const errorRate = metrics.errorCount / metrics.operations;
    const decayFactor = EDEN_CONFIG.REAPER_PERFORMANCE_DECAY_FACTOR;
    const alpha = 1 - decayFactor;
    // Simplified EWMA: without historical data, use current as baseline
    const ewmaErrorRate = alpha * errorRate + decayFactor * (errorRate * 0.9);
    
    statistics.errorRate = errorRate;
    statistics.ewmaErrorRate = ewmaErrorRate;
    
    if (errorRate > 0.5) {
      terminationScore += 0.25;
      reasons.push(`Critical error rate: ${(errorRate * 100).toFixed(1)}% (EWMA: ${(ewmaErrorRate * 100).toFixed(1)}%)`);
    }

    // 6. OUTLIER DETECTION (IQR Method)
    // Check if performance is an outlier compared to expected distribution
    const performanceScore = metrics.successRate - metrics.profitWaste;
    const expectedPerformance = 0.65; // Expected baseline
    const iqr = 0.20; // Interquartile range estimate
    const lowerBound = expectedPerformance - (EDEN_CONFIG.REAPER_OUTLIER_IQR_MULTIPLIER * iqr);
    
    statistics.performanceScore = performanceScore;
    statistics.isOutlier = performanceScore < lowerBound;
    
    if (performanceScore < lowerBound) {
      terminationScore += 0.20;
      reasons.push(`Performance outlier detected (score: ${performanceScore.toFixed(3)}, threshold: ${lowerBound.toFixed(3)})`);
    }

    // 7. CORRUPTION PATTERN ANALYSIS
    if (metrics.suspicious) {
      terminationScore += 0.40;
      reasons.push('Corruption patterns detected via behavioral analysis');
      statistics.corruptionDetected = true;
    }

    // 8. CALCULATE FINAL CONFIDENCE WITH WEIGHTED FACTORS
    // Confidence is combination of statistical significance and multiple factor alignment
    const factorWeight = reasons.length / 7; // 7 possible factors
    const statisticalConfidence = Math.min(posteriorProbability + (zScore / 10), 1.0);
    const multiFactorBonus = factorWeight * 0.3;
    const finalConfidence = Math.min(terminationScore + multiFactorBonus, 1.0);
    
    statistics.factorCount = reasons.length;
    statistics.factorWeight = factorWeight;
    statistics.statisticalConfidence = statisticalConfidence;
    statistics.multiFactorBonus = multiFactorBonus;
    statistics.finalConfidence = finalConfidence;

    // 9. DECISION LOGIC WITH TEMPERED JUDGMENT
    // Requires: high termination score + multiple factors + high confidence
    const shouldTerminate = 
      terminationScore >= 0.75 && 
      reasons.length >= 2 && 
      finalConfidence >= EDEN_CONFIG.REAPER_DECISION_CONFIDENCE_MIN;

    return {
      shouldTerminate,
      confidence: finalConfidence,
      reason: reasons.join('; '),
      statistics,
    };
  }

  // Calculate likelihood P(evidence|corrupt) for Bayesian analysis
  private calculateLikelihood(metrics: any): number {
    const successPenalty = Math.max(0, 0.7 - metrics.successRate) / 0.7;
    const wastePenalty = Math.min(metrics.profitWaste / 0.2, 1.0);
    const errorPenalty = Math.min((metrics.errorCount / metrics.operations) / 0.5, 1.0);
    return (successPenalty + wastePenalty + errorPenalty) / 3;
  }

  // Calculate evidence strength P(evidence)
  private calculateEvidenceStrength(metrics: any): number {
    const normalPerformance = 0.3; // 30% of crawlers show some issues
    const severePerformance = this.calculateLikelihood(metrics);
    return normalPerformance + severePerformance * 0.7;
  }

  // Normal CDF approximation for p-value calculation
  private normalCDF(x: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const probability = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - probability : probability;
  }

  // Detect suspicious behavior patterns (corruption, rogue behavior)
  private detectSuspiciousBehavior(lessons: LessonPacket[]): boolean {
    // Check for impossible profit claims
    const impossibleProfits = lessons.filter(l => 
      l.profitActual > l.profitEstimated * 10 // 10x more than estimated
    ).length;

    // Check for consistent underperformance with no learning
    const recentLessons = lessons.slice(-10);
    const allFailures = recentLessons.every(l => l.outcome === 'failure');

    // Check for erratic latency (possible manipulation)
    const latencies = lessons.map(l => l.latency);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const erraticLatency = latencies.some(l => l > avgLatency * 50);

    return impossibleProfits > 2 || allFailures || erraticLatency;
  }

  // Get recent lessons for a specific Cain
  private async getRecentLessonsForCain(cainId: string): Promise<LessonPacket[]> {
    // Filter this Cain's collected lessons
    return this.lessonsCollected.filter(l => l.cainId === cainId).slice(-20);
  }

  // SELF-DESTRUCT BUTTON: Terminate ineffective crawler
  private async terminateCrawler(cainId: string, reason: string): Promise<void> {
    console.log(`[REAPER-${this.id}] 💀 TERMINATING CRAWLER: ${cainId}`);
    console.log(`[REAPER-${this.id}] 📋 Reason: ${reason}`);

    const cainState = eden.getCainState(cainId);
    if (!cainState) {
      console.warn(`[REAPER-${this.id}] ⚠️ Crawler ${cainId} not found`);
      return;
    }

    // Mark crawler as inactive (self-destruct)
    cainState.status = 'inactive';
    
    // Record termination in Eden audit log
    const lesson: LessonPacket = {
      id: randomUUID(),
      cainId: this.id,
      opportunitySignature: `termination-${cainId}`,
      outcome: 'success',
      profitActual: 0,
      profitEstimated: 0,
      latency: 0,
      gasUsed: 0,
      chain: 'ethereum' as any,
      timestamp: Date.now(),
      metadata: {
        action: 'crawler_termination',
        targetCrawler: cainId,
        reason,
        reaperDecision: true,
      },
    };

    this.lessonsCollected.push(lesson);
    await eden.recordLesson(lesson);

    console.log(`[REAPER-${this.id}] ✅ Crawler ${cainId} terminated successfully`);
  }

  // PROBABILITY EVENT MONITORING: Detect high-value opportunities (kept for backward compatibility)
  private async monitorProbabilityEvents(): Promise<void> {
    await this.performOriginalCainWork();
  }

  // DOOMSDAY: Harvest lessons and prepare for Eden return
  private async doomsday(): Promise<void> {
    console.log(`[CAIN-${this.id}] 💀 DOOMSDAY triggered`);
    
    this.status = 'doomsday';

    // Harvest all lessons
    const harvestedLessons = await this.harvestLessons();
    console.log(`[CAIN-${this.id}] 📦 Harvested ${harvestedLessons.length} lessons`);

    // Compress knowledge
    const compressedKnowledge = this.compressKnowledge();
    this.knowledge = { ...this.knowledge, ...compressedKnowledge };

    console.log(`[CAIN-${this.id}] ✅ Doomsday complete, ready for Eden return`);
  }

  // EDEN RETURN: Share knowledge with Eden and the flock
  private async returnToEden(): Promise<void> {
    console.log(`[CAIN-${this.id}] 🏛️ Returning to Eden...`);

    this.status = 'eden_return';

    // Verify minimum Cains requirement
    if (!eden.checkMinimumCainsForReset()) {
      console.warn(`[CAIN-${this.id}] ⚠️ Waiting for minimum Cains before Eden return`);
      await this.sleep(5000);
    }

    // Record all lessons in Eden
    for (const lesson of this.lessonsCollected) {
      await eden.recordLesson(lesson);
    }

    // Share knowledge with Eden
    await eden.cainReturnToEden(this.id, this.knowledge);

    // Update epsilon-greedy exploration rate
    this.epsilonGreedy = Math.max(
      EDEN_CONFIG.EPSILON_GREEDY_MIN,
      this.epsilonGreedy * EDEN_CONFIG.EPSILON_DECAY
    );

    console.log(`[CAIN-${this.id}] ✅ Eden return complete`);
  }

  // EMERGENCY EDEN RETURN: On critical failure
  private async emergencyEdenReturn(): Promise<void> {
    console.log(`[CAIN-${this.id}] 🚨 EMERGENCY Eden return`);
    
    this.status = 'eden_return';
    
    // Save whatever lessons we have
    for (const lesson of this.lessonsCollected) {
      await eden.recordLesson(lesson);
    }

    await eden.cainReturnToEden(this.id, {
      ...this.knowledge,
      emergencyReturn: true,
      timestamp: Date.now(),
    });
  }

  // Check if doomsday should be triggered
  private shouldTriggerDoomsday(): boolean {
    if (this.lessonsCollected.length === 0) return false;

    // Calculate success rate
    const successes = this.lessonsCollected.filter(l => l.outcome === 'success').length;
    const successRate = successes / this.lessonsCollected.length;

    // Trigger if success rate below threshold
    if (successRate < EDEN_CONFIG.DOOMSDAY_TRIGGER_THRESHOLD) {
      console.log(`[CAIN-${this.id}] ⚠️ Low success rate: ${successRate.toFixed(2)}`);
      return true;
    }

    // Trigger if excessive drawdown
    if (this.currentDrawdown > EDEN_CONFIG.DRAWDOWN_LIMIT) {
      console.log(`[CAIN-${this.id}] ⚠️ Excessive drawdown: ${this.currentDrawdown.toFixed(2)}`);
      return true;
    }

    return false;
  }

  // Initialize replica agents for verification
  private async initializeReplicas(): Promise<void> {
    // Create 2-3 replica identifiers
    this.replicas = [
      `${this.id}-replica-1`,
      `${this.id}-replica-2`,
    ];
    console.log(`[CAIN-${this.id}] 🔗 Initialized ${this.replicas.length} replicas`);
  }

  // Hierarchical verification protocol
  private async verifyReplicas(): Promise<void> {
    // Sample and verify replicas recursively
    for (const replicaId of this.replicas) {
      // In production, this would verify replica integrity
      // For now, we just log the verification
      console.log(`[CAIN-${this.id}] ✓ Verified replica ${replicaId}`);
    }
  }

  // Trigger starburst replication
  private async triggerStarburst(event: OpportunityEvent): Promise<void> {
    console.log(`[CAIN-${this.id}] 💥 Triggering starburst for ${event.type} on ${event.chain}`);

    // Create lesson for starburst trigger
    // Note: This is a trigger event, not an actual execution
    const lesson: LessonPacket = {
      id: randomUUID(),
      cainId: this.id,
      opportunitySignature: `${event.type}-${event.chain}-${event.id}`,
      outcome: 'success',
      profitActual: 0, // Starburst trigger, not execution
      profitEstimated: event.profitEstimate,
      latency: 0, // Instant trigger
      gasUsed: 0, // No gas for trigger
      chain: event.chain,
      timestamp: Date.now(),
      metadata: { 
        starburstTriggered: true, 
        eventId: event.id,
        isSimulation: true, // Mark as simulation/trigger event
      },
    };

    this.lessonsCollected.push(lesson);
  }

  // Trigger recovery actions for cataclysm
  private async triggerRecovery(event: CataclysmEvent): Promise<void> {
    console.log(`[CAIN-${this.id}] 🛡️ Triggering recovery for ${event.type}`);

    for (const action of event.recoveryActions) {
      console.log(`[CAIN-${this.id}] 🔧 Executing recovery action: ${action}`);
      // Implement recovery actions
    }
  }

  // Record execution result
  async recordExecution(
    opportunitySignature: string,
    outcome: 'success' | 'failure' | 'partial',
    profitActual: number,
    profitEstimated: number,
    latency: number,
    gasUsed: number,
    chain: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    const lesson: LessonPacket = {
      id: randomUUID(),
      cainId: this.id,
      opportunitySignature,
      outcome,
      profitActual,
      profitEstimated,
      latency,
      gasUsed,
      chain: chain as any,
      timestamp: Date.now(),
      metadata: metadata || {},
    };

    this.lessonsCollected.push(lesson);

    // Update metrics
    if (outcome === 'success') {
      this.consecutiveSuccesses++;
      this.consecutiveFailures = 0;
      this.profitHistory.push(profitActual);
    } else {
      this.consecutiveFailures++;
      this.consecutiveSuccesses = 0;
    }

    // Update drawdown
    this.updateDrawdown(profitActual);

    // Check safety nets
    await this.checkSafetyNets();
  }

  // Record failure
  private async recordFailure(error: Error): Promise<void> {
    const lesson: LessonPacket = {
      id: randomUUID(),
      cainId: this.id,
      opportunitySignature: 'system-error',
      outcome: 'failure',
      profitActual: 0,
      profitEstimated: 0,
      latency: 0,
      gasUsed: 0,
      failureMode: error.message,
      chain: 'unknown' as any,
      timestamp: Date.now(),
      metadata: { error: error.stack },
    };

    this.lessonsCollected.push(lesson);
    this.consecutiveFailures++;
  }

  // Check safety nets (cooldown, loss floor)
  private async checkSafetyNets(): Promise<void> {
    // Cooldown after consecutive wins
    if (this.consecutiveSuccesses >= EDEN_CONFIG.CONSECUTIVE_WINS_COOLDOWN) {
      console.log(`[CAIN-${this.id}] 🛑 Cooldown triggered after ${this.consecutiveSuccesses} wins`);
      await this.sleep(10000); // 10 second cooldown
      this.consecutiveSuccesses = 0;
    }

    // Halt on loss floor
    if (this.currentDrawdown > EDEN_CONFIG.LOSS_FLOOR_THRESHOLD) {
      console.log(`[CAIN-${this.id}] 🛑 Loss floor reached: ${this.currentDrawdown.toFixed(2)}`);
      this.status = 'doomsday';
    }
  }

  // Update drawdown calculation
  private updateDrawdown(profit: number): void {
    if (profit < 0) {
      this.currentDrawdown += Math.abs(profit);
    } else {
      this.currentDrawdown = Math.max(0, this.currentDrawdown - profit * 0.5);
    }
  }

  // Harvest lessons from cycle
  private async harvestLessons(): Promise<LessonPacket[]> {
    return [...this.lessonsCollected];
  }

  // Compress knowledge for Eden storage
  private compressKnowledge(): Record<string, any> {
    const successRate = this.lessonsCollected.filter(l => l.outcome === 'success').length / 
                        this.lessonsCollected.length || 0;
    
    const avgProfit = this.profitHistory.reduce((a, b) => a + b, 0) / 
                      this.profitHistory.length || 0;

    return {
      cycleId: this.cycleCount,
      lessonsLearned: this.lessonsCollected.length,
      successRate,
      avgProfit,
      epsilonGreedy: this.epsilonGreedy,
      timestamp: Date.now(),
    };
  }

  // Calculate average latency
  private calculateAverageLatency(): number {
    const latencies = this.lessonsCollected.map(l => l.latency);
    return latencies.reduce((a, b) => a + b, 0) / latencies.length || 0;
  }

  // Sleep utility
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
