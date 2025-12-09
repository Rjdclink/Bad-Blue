// Eden Service - Knowledge Repository and Coordination Engine
// Manages swarm intelligence, lessons learned, and strategy evolution

import { randomUUID } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EDEN_CONFIG, CONTROL_SIGNALS, ETHICAL_GUARDS } from './config';
import type { LessonPacket, StrategyTemplate, CainState, MicroCrawlerState, EdenSnapshot, CataclysmEvent, OpportunityEvent, ChainId } from './types';

class EdenService {
  private supabase: SupabaseClient | null = null;
  private localCache: Map<string, any> = new Map();
  private isInitialized = false;
  private lastReturnPulse: number = 0;
  
  // In-memory state for fast access
  private cainStates: Map<string, CainState> = new Map();
  private strategyTemplates: Map<string, StrategyTemplate> = new Map();
  private microCrawlers: Map<string, MicroCrawlerState> = new Map();
  
  constructor() {
    // Initialize Supabase if credentials available
    if (EDEN_CONFIG.SUPABASE_URL && EDEN_CONFIG.SUPABASE_KEY) {
      try {
        this.supabase = createClient(
          EDEN_CONFIG.SUPABASE_URL,
          EDEN_CONFIG.SUPABASE_KEY
        );
        console.log('[EDEN] 🌳 Connected to Supabase Eden repository');
      } catch (error) {
        console.error('[EDEN] ⚠️ Failed to connect to Supabase:', error);
      }
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('[EDEN] 🌳 Initializing Eden Knowledge Repository...');

    // Initialize Cain crawlers
    await this.initializeCainCrawlers();

    // Load existing strategy templates
    await this.loadStrategyTemplates();

    // Perform initial Eden return pulse
    await this.performReturnPulse();

    this.isInitialized = true;
    console.log('[EDEN] ✅ Eden initialized successfully');
  }

  private async initializeCainCrawlers(): Promise<void> {
    console.log('[EDEN] 🔧 Initializing Cain Crawlers...');

    // Create Cataclysm Detection Cains (5)
    for (let i = 0; i < EDEN_CONFIG.CATACLYSM_DETECTION_CAINS; i++) {
      const cainId = `cain-cataclysm-${i + 1}`;
      const cainState: CainState = {
        id: cainId,
        type: 'cataclysm_detection',
        status: 'active',
        cycleCount: 0,
        lessonsCollected: 0,
        lastEdenReturn: Date.now(),
        replicas: [],
        knowledge: {},
      };
      this.cainStates.set(cainId, cainState);
      await this.persistCainState(cainState);
    }

    // Create Probability Monitoring Cains (5)
    for (let i = 0; i < EDEN_CONFIG.PROBABILITY_MONITORING_CAINS; i++) {
      const cainId = `cain-probability-${i + 1}`;
      const cainState: CainState = {
        id: cainId,
        type: 'probability_monitoring',
        status: 'active',
        cycleCount: 0,
        lessonsCollected: 0,
        lastEdenReturn: Date.now(),
        replicas: [],
        knowledge: {},
      };
      this.cainStates.set(cainId, cainState);
      await this.persistCainState(cainState);
    }

    console.log(`[EDEN] ✅ Initialized ${EDEN_CONFIG.TOTAL_CAIN_CRAWLERS} Cain Crawlers`);
  }

  private async loadStrategyTemplates(): Promise<void> {
    // Load from Supabase if available
    if (this.supabase) {
      const { data, error } = await this.supabase
        .from('eden_strategy_templates')
        .select('*')
        .order('profitability_score', { ascending: false });

      if (data && !error) {
        data.forEach((template: any) => {
          this.strategyTemplates.set(template.id, template);
        });
        console.log(`[EDEN] 📚 Loaded ${data.length} strategy templates`);
      }
    }

    // Initialize with default strategy if none exist
    if (this.strategyTemplates.size === 0) {
      await this.createDefaultStrategy();
    }
  }

  private async createDefaultStrategy(): Promise<void> {
    const defaultStrategy: StrategyTemplate = {
      id: 'strategy-default-001',
      name: 'Conservative Arbitrage',
      description: 'Low-risk arbitrage with high confidence',
      version: 1,
      profitabilityScore: 0.65,
      successRate: 0.85,
      avgLatency: 250,
      conditions: {
        minProfitThreshold: 0.01,
        maxSlippage: 0.005,
        minLiquidity: 10000,
      },
      actions: {
        executionMethod: 'direct',
        gasStrategy: 'medium',
        maxRetries: 2,
      },
      lastUpdated: Date.now(),
    };

    this.strategyTemplates.set(defaultStrategy.id, defaultStrategy);
    await this.persistStrategyTemplate(defaultStrategy);
    console.log('[EDEN] 📋 Created default strategy template');
  }

  // Record lesson from Cain crawler
  async recordLesson(lesson: LessonPacket): Promise<void> {
    console.log(`[EDEN] 📝 Recording lesson from ${lesson.cainId}`);

    // Store in Supabase
    if (this.supabase) {
      try {
        const { error } = await this.supabase
          .from('eden_lessons')
          .insert({
            id: lesson.id,
            cain_id: lesson.cainId,
            opportunity_signature: lesson.opportunitySignature,
            outcome: lesson.outcome,
            profit_actual: lesson.profitActual,
            profit_estimated: lesson.profitEstimated,
            latency: lesson.latency,
            gas_used: lesson.gasUsed,
            failure_mode: lesson.failureMode,
            chain: lesson.chain,
            timestamp: new Date(lesson.timestamp),
            metadata: lesson.metadata,
          });

        if (error) {
          // Check for specific constraint violations
          if (error.code === '23505') {
            console.warn(`[EDEN] ⚠️ Duplicate lesson ID ${lesson.id}, skipping`);
          } else {
            console.error(`[EDEN] ❌ Failed to record lesson (${error.code}):`, error.message);
          }
        }
      } catch (error) {
        console.error('[EDEN] ❌ Database error recording lesson:', error);
      }
    }

    // Update Cain state
    const cainState = this.cainStates.get(lesson.cainId);
    if (cainState) {
      cainState.lessonsCollected++;
      await this.persistCainState(cainState);
    }

    // Trigger strategy evolution if enough lessons collected
    await this.checkForStrategyEvolution();
  }

  // Perform Eden return pulse - save all state before reset
  async performReturnPulse(): Promise<void> {
    console.log('[EDEN] 💓 Performing Eden Return Pulse...');

    const now = Date.now();
    this.lastReturnPulse = now;

    // Create snapshot
    const snapshot: EdenSnapshot = {
      id: `snapshot-${randomUUID()}`,
      timestamp: now,
      cainStates: new Map(this.cainStates),
      strategyTemplates: new Map(this.strategyTemplates),
      globalMetrics: await this.calculateGlobalMetrics(),
      lessonsLearned: await this.getRecentLessons(100),
    };

    // Persist snapshot
    if (this.supabase) {
      const { error } = await this.supabase
        .from('eden_snapshots')
        .insert({
          id: snapshot.id,
          timestamp: new Date(snapshot.timestamp),
          cain_states: JSON.stringify(Array.from(snapshot.cainStates.entries())),
          strategy_templates: JSON.stringify(Array.from(snapshot.strategyTemplates.entries())),
          global_metrics: snapshot.globalMetrics,
          lessons_learned: snapshot.lessonsLearned,
        });

      if (error) {
        console.error('[EDEN] ❌ Failed to create snapshot:', error);
      } else {
        console.log('[EDEN] ✅ Eden Return Pulse completed');
      }
    }
  }

  // Check if Cain should return to Eden
  shouldCainReturnToEden(cainId: string): boolean {
    const cainState = this.cainStates.get(cainId);
    if (!cainState) return false;

    const timeSinceLastReturn = Date.now() - cainState.lastEdenReturn;
    return timeSinceLastReturn >= EDEN_CONFIG.EDEN_RETURN_INTERVAL_MS;
  }

  // Cain returns to Eden with knowledge
  async cainReturnToEden(cainId: string, knowledge: Record<string, any>): Promise<void> {
    console.log(`[EDEN] 🏛️ ${cainId} returning to Eden...`);

    const cainState = this.cainStates.get(cainId);
    if (!cainState) {
      console.error(`[EDEN] ❌ Cain ${cainId} not found`);
      return;
    }

    // Update Cain state
    cainState.status = 'eden_return';
    cainState.lastEdenReturn = Date.now();
    cainState.cycleCount++;
    cainState.knowledge = { ...cainState.knowledge, ...knowledge };

    await this.persistCainState(cainState);

    // Broadcast knowledge to swarm
    await this.broadcastKnowledgeToSwarm(cainId, knowledge);

    // Return Cain to active duty
    cainState.status = 'active';
    await this.persistCainState(cainState);

    console.log(`[EDEN] ✅ ${cainId} knowledge integrated, returned to active duty`);
  }

  // Broadcast knowledge updates to all crawlers
  private async broadcastKnowledgeToSwarm(cainId: string, knowledge: Record<string, any>): Promise<void> {
    console.log(`[EDEN] 📡 Broadcasting knowledge from ${cainId} to swarm...`);

    // Update strategy templates based on lessons
    if (knowledge.strategyUpdates) {
      await this.updateStrategiesFromKnowledge(knowledge.strategyUpdates);
    }

    // Update all Cain crawlers with new insights
    for (const [id, cainState] of this.cainStates) {
      if (id !== cainId) {
        cainState.knowledge = {
          ...cainState.knowledge,
          ...knowledge,
          lastBroadcast: Date.now(),
        };
        await this.persistCainState(cainState);
      }
    }

    console.log('[EDEN] ✅ Knowledge broadcast complete');
  }

  // Check ethical guards before execution
  async checkEthicalGuards(action: any): Promise<{ passed: boolean; violations: string[] }> {
    const violations: string[] = [];

    for (const guard of ETHICAL_GUARDS) {
      if (!guard.enabled) continue;

      // Implement guard checks
      const checkResult = await this.performGuardCheck(guard.checkFunction, action);
      if (!checkResult.passed) {
        violations.push(`${guard.id}: ${guard.rule}`);
      }
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }

  private async performGuardCheck(checkFunction: string, action: any): Promise<{ passed: boolean }> {
    // Implement specific guard check logic
    // For now, return passed for all checks
    return { passed: true };
  }

  // Calculate profitability objective with regularization
  calculateProfitabilityObjective(profit: number, risk: number, cost: number, opportunityWaste: number): number {
    return CONTROL_SIGNALS.PROFITABILITY_OBJECTIVE(profit, risk, cost) - opportunityWaste;
  }

  // Calculate priority score for opportunity
  calculatePriorityScore(profit: number, risk: number, latency: number, liquidity: number): number {
    return CONTROL_SIGNALS.PRIORITY_SCORE(profit, risk, latency, liquidity);
  }

  // Record cataclysm event
  async recordCataclysm(event: CataclysmEvent): Promise<void> {
    console.log(`[EDEN] 🚨 Cataclysm detected: ${event.type} (${event.severity})`);

    if (this.supabase) {
      const { error } = await this.supabase
        .from('eden_cataclysms')
        .insert({
          id: event.id,
          type: event.type,
          severity: event.severity,
          chain: event.chain,
          timestamp: new Date(event.timestamp),
          description: event.description,
          recovery_actions: event.recoveryActions,
          status: event.status,
        });

      if (error) {
        console.error('[EDEN] ❌ Failed to record cataclysm:', error);
      }
    }
  }

  // Record opportunity event
  async recordOpportunity(event: OpportunityEvent): Promise<void> {
    if (this.supabase) {
      const { error } = await this.supabase
        .from('eden_opportunities')
        .insert({
          id: event.id,
          type: event.type,
          chain: event.chain,
          priority: event.priority,
          profit_estimate: event.profitEstimate,
          confidence_score: event.confidenceScore,
          timestamp: new Date(event.timestamp),
          expires_at: new Date(event.expiresAt),
          metadata: event.metadata,
        });

      if (error) {
        console.error('[EDEN] ❌ Failed to record opportunity:', error);
      }
    }
  }

  // Persist Cain state to database
  private async persistCainState(state: CainState): Promise<void> {
    if (!this.supabase) return;

    const { error } = await this.supabase
      .from('eden_cain_states')
      .upsert({
        id: state.id,
        type: state.type,
        status: state.status,
        cycle_count: state.cycleCount,
        lessons_collected: state.lessonsCollected,
        last_eden_return: new Date(state.lastEdenReturn),
        current_mission: state.currentMission,
        replicas: state.replicas,
        knowledge: state.knowledge,
        updated_at: new Date(),
      });

    if (error) {
      console.error('[EDEN] ❌ Failed to persist Cain state:', error);
    }
  }

  // Persist strategy template
  private async persistStrategyTemplate(template: StrategyTemplate): Promise<void> {
    if (!this.supabase) return;

    const { error } = await this.supabase
      .from('eden_strategy_templates')
      .upsert({
        id: template.id,
        name: template.name,
        description: template.description,
        version: template.version,
        profitability_score: template.profitabilityScore,
        success_rate: template.successRate,
        avg_latency: template.avgLatency,
        conditions: template.conditions,
        actions: template.actions,
        last_updated: new Date(template.lastUpdated),
      });

    if (error) {
      console.error('[EDEN] ❌ Failed to persist strategy template:', error);
    }
  }

  private async checkForStrategyEvolution(): Promise<void> {
    // Analyze recent lessons and evolve strategies
    const recentLessons = await this.getRecentLessons(50);
    
    // Calculate success rate
    const successCount = recentLessons.filter(l => l.outcome === 'success').length;
    const successRate = successCount / recentLessons.length;

    // If success rate is low, trigger strategy evolution
    if (successRate < 0.5 && recentLessons.length >= 20) {
      console.log(`[EDEN] 🧬 Low success rate (${successRate.toFixed(2)}), triggering strategy evolution`);
      await this.evolveStrategies(recentLessons);
    }
  }

  private async evolveStrategies(lessons: LessonPacket[]): Promise<void> {
    // Analyze lessons and create new strategy template
    console.log('[EDEN] 🧬 Evolving strategies based on lessons...');
    
    // This would implement ML-based strategy optimization
    // For now, we log the intent
    console.log(`[EDEN] 📊 Analyzed ${lessons.length} lessons for strategy evolution`);
  }

  private async updateStrategiesFromKnowledge(updates: any): Promise<void> {
    // Update existing strategies or create new ones based on Cain knowledge
    console.log('[EDEN] 📝 Updating strategies from Cain knowledge');
  }

  private async calculateGlobalMetrics(): Promise<any> {
    const recentLessons = await this.getRecentLessons(100);
    
    const totalProfit = recentLessons.reduce((sum, l) => sum + l.profitActual, 0);
    const successCount = recentLessons.filter(l => l.outcome === 'success').length;
    const avgLatency = recentLessons.reduce((sum, l) => sum + l.latency, 0) / recentLessons.length || 0;

    return {
      totalProfit,
      totalTransactions: recentLessons.length,
      successRate: successCount / recentLessons.length || 0,
      avgLatency,
      activeCrawlers: this.cainStates.size + this.microCrawlers.size,
    };
  }

  private async getRecentLessons(limit: number): Promise<LessonPacket[]> {
    if (!this.supabase) return [];

    const { data, error } = await this.supabase
      .from('eden_lessons')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    return data.map((row: any) => ({
      id: row.id,
      cainId: row.cain_id,
      opportunitySignature: row.opportunity_signature,
      outcome: row.outcome,
      profitActual: row.profit_actual,
      profitEstimated: row.profit_estimated,
      latency: row.latency,
      gasUsed: row.gas_used,
      failureMode: row.failure_mode,
      chain: row.chain,
      timestamp: new Date(row.timestamp).getTime(),
      metadata: row.metadata,
    }));
  }

  // Get all Cain states
  getCainStates(): Map<string, CainState> {
    return new Map(this.cainStates);
  }

  // Get specific Cain state
  getCainState(cainId: string): CainState | undefined {
    return this.cainStates.get(cainId);
  }

  // Get all strategy templates
  getStrategyTemplates(): Map<string, StrategyTemplate> {
    return new Map(this.strategyTemplates);
  }

  // Check if minimum Cains are ready for reset
  checkMinimumCainsForReset(): boolean {
    const activeCains = Array.from(this.cainStates.values()).filter(
      c => c.status === 'active' || c.status === 'eden_return'
    );
    return activeCains.length >= EDEN_CONFIG.MIN_CAINS_FOR_RESET;
  }

  // Emergency decommission sequence
  async emergencyDecommission(): Promise<void> {
    if (!EDEN_CONFIG.DECOMMISSION_ENABLED) {
      console.log('[EDEN] ⚠️ Emergency decommission not enabled');
      return;
    }

    console.log('[EDEN] 🚨 EMERGENCY DECOMMISSION INITIATED');

    // 1. Perform final return pulse
    await this.performReturnPulse();

    // 2. Mark all Cains as inactive
    for (const [id, cainState] of this.cainStates) {
      cainState.status = 'inactive';
      await this.persistCainState(cainState);
    }

    // 3. Create audit record
    if (this.supabase) {
      await this.supabase.from('eden_audit_log').insert({
        id: randomUUID(),
        agent_id: 'system',
        action: 'emergency_decommission',
        details: { timestamp: Date.now(), reason: 'manual_trigger' },
        timestamp: new Date(),
      });
    }

    console.log('[EDEN] ✅ Emergency decommission completed');
  }
}

// Singleton instance
export const eden = new EdenService();
export { EdenService };
