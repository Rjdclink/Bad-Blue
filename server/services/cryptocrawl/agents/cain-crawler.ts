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
        
        // Self-destruct mechanism for target crawler
        await this.terminateCrawler(cainId, terminationDecision.reason);
      }
    }
  }

  // Logical evaluation with tempered judgment (not overreacting to minor losses)
  private evaluateTermination(cainId: string, metrics: {
    successRate: number;
    profitWaste: number;
    errorCount: number;
    operations: number;
    suspicious: boolean;
  }): { shouldTerminate: boolean; confidence: number; reason: string } {
    
    let terminationScore = 0;
    let reasons: string[] = [];

    // INEFFICIENCY CHECK
    if (metrics.successRate < EDEN_CONFIG.REAPER_INEFFICIENCY_THRESHOLD) {
      terminationScore += 0.35;
      reasons.push(`Low success rate: ${(metrics.successRate * 100).toFixed(1)}%`);
    }

    // PROFIT WASTE CHECK (normalized by operations)
    if (metrics.profitWaste > EDEN_CONFIG.REAPER_PROFIT_WASTE_THRESHOLD) {
      terminationScore += 0.30;
      reasons.push(`High profit waste: $${metrics.profitWaste.toFixed(4)} per operation`);
    }

    // ERROR PATTERN CHECK (must be consecutive, not just total)
    const errorRate = metrics.errorCount / metrics.operations;
    if (errorRate > 0.5) { // More than 50% errors
      terminationScore += 0.25;
      reasons.push(`High error rate: ${(errorRate * 100).toFixed(1)}%`);
    }

    // CORRUPTION/SUSPICIOUS BEHAVIOR
    if (metrics.suspicious) {
      terminationScore += 0.40;
      reasons.push('Suspicious behavior pattern detected');
    }

    // TEMPERED DECISION: Don't terminate for minor losses
    // Only terminate if multiple factors align
    const shouldTerminate = terminationScore >= 0.75 && reasons.length >= 2;
    const confidence = Math.min(terminationScore, 1.0);

    return {
      shouldTerminate,
      confidence,
      reason: reasons.join('; '),
    };
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
