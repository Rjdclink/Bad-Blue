/**
 * Tests for Lexara Monte Carlo Enhancement & Consultation Optimization System
 * 
 * Validates the multi-layered Monte Carlo optimization engine that refines:
 * - Legal reasoning, comprehension, and analytical review
 * - Explanatory precision and hierarchical structuring
 * - Consultative engagement style
 * - Vocal gravitas and delivery optimization
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  lexaraMCOptimizer,
  lexaraMCOptimizerEvents,
  configureLexaraMCOptimizer,
  getLexaraMCOptimizerState,
  getActiveOptimizationProfile,
  runScheduledMCOptimization,
  runSessionBoundaryMCOptimization,
  startLexaraSession,
  endLexaraSession,
  recordLexaraDecisionBoundary,
  getOptimizedResponseParameters,
  type OptimizationProfile,
  type SessionContext,
  type DecisionBoundary,
} from '../lexara/LexaraMonteCarloOptimizer';

import {
  lexaraScheduler,
  schedulerEvents,
  startLexaraScheduler,
  stopLexaraScheduler,
  configureLexaraScheduler,
  getLexaraSchedulerState,
  setLexaraCycleEnabled,
  setLexaraCycleTime,
  forceRunLexaraCycle,
  getTimeUntilNextLexaraCycle,
} from '../lexara/LexaraOptimizationScheduler';

describe('LexaraMonteCarloOptimizer', () => {
  beforeEach(() => {
    // Configure for faster testing
    configureLexaraMCOptimizer({
      simulationsPerDomain: 10,
      maxIterations: 5,
      improvementThreshold: 0.0001,
      mutationRate: 0.3,
      mutationMagnitude: 0.15,
      convergenceThreshold: 0.00001,
      maxStagnantGenerations: 2,
    });
  });

  describe('Initialization', () => {
    it('should have a valid initial state', () => {
      const state = getLexaraMCOptimizerState();
      
      expect(state.isRunning).toBe(false);
      expect(state.activeProfile).toBeDefined();
      expect(state.profileHistory.length).toBeGreaterThan(0);
      expect(state.tonalStabilityScore).toBe(1.0);
    });

    it('should have a valid baseline profile', () => {
      const profile = getActiveOptimizationProfile();
      
      expect(profile.id).toBeDefined();
      expect(profile.version).toBeGreaterThanOrEqual(1);
      expect(profile.overallFitness).toBeGreaterThan(0);
      expect(profile.isActive).toBe(true);
    });

    it('should have all optimization domains populated', () => {
      const profile = getActiveOptimizationProfile();
      
      // Legal Understanding
      expect(profile.legalUnderstanding.issueIdentificationAccuracy).toBeGreaterThan(0);
      expect(profile.legalUnderstanding.contextualInterpretation).toBeGreaterThan(0);
      expect(profile.legalUnderstanding.doctrineReasoningPatterns).toBeGreaterThan(0);
      expect(profile.legalUnderstanding.riskOutcomeFraming).toBeGreaterThan(0);
      
      // Explanation Quality
      expect(profile.explanationQuality.hierarchicalStructuring).toBeGreaterThan(0);
      expect(profile.explanationQuality.plainLanguageTranslation).toBeGreaterThan(0);
      expect(profile.explanationQuality.analyticalSequencing).toBeGreaterThan(0);
      expect(profile.explanationQuality.ambiguityReduction).toBeGreaterThan(0);
      
      // Consultative Engagement
      expect(profile.consultativeEngagement.conversationalFlow).toBeGreaterThan(0);
      expect(profile.consultativeEngagement.clarifyingQuestionTiming).toBeGreaterThan(0);
      expect(profile.consultativeEngagement.responsivenessAndPacing).toBeGreaterThan(0);
      expect(profile.consultativeEngagement.confidenceWithoutIntimidation).toBeGreaterThan(0);
      expect(profile.consultativeEngagement.reassuranceWithAuthority).toBeGreaterThan(0);
      
      // Vocal Delivery
      expect(profile.vocalDelivery.speechCadenceEmphasis).toBeGreaterThan(0);
      expect(profile.vocalDelivery.perceivedConfidence).toBeGreaterThan(0);
      expect(profile.vocalDelivery.professionalToneStability).toBeGreaterThan(0);
      expect(profile.vocalDelivery.naturalDeliveryAntiRobotic).toBeGreaterThan(0);
    });
  });

  describe('Scheduled Optimization Cycle', () => {
    it('should run a scheduled optimization cycle', async () => {
      const stateBefore = getLexaraMCOptimizerState();
      const cyclesBefore = stateBefore.totalCyclesCompleted;
      
      const result = await runScheduledMCOptimization();
      
      expect(result).toBeDefined();
      expect(result.cycleType).toBe('scheduled');
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.simulationsRun).toBeGreaterThan(0);
      expect(result.generationsCompleted).toBe(4); // One per domain
      
      const stateAfter = getLexaraMCOptimizerState();
      expect(stateAfter.totalCyclesCompleted).toBe(cyclesBefore + 1);
    });

    it('should update the active profile after optimization', async () => {
      const profileBefore = getActiveOptimizationProfile();
      const versionBefore = profileBefore.version;
      
      await runScheduledMCOptimization();
      
      const profileAfter = getActiveOptimizationProfile();
      expect(profileAfter.version).toBe(versionBefore + 1);
      expect(profileAfter.id).not.toBe(profileBefore.id);
    });

    it('should track domain improvements', async () => {
      const result = await runScheduledMCOptimization();
      
      expect(result.domainImprovements).toBeDefined();
      expect(typeof result.domainImprovements.legal_understanding).toBe('number');
      expect(typeof result.domainImprovements.explanation_quality).toBe('number');
      expect(typeof result.domainImprovements.consultative_engagement).toBe('number');
      expect(typeof result.domainImprovements.vocal_delivery).toBe('number');
    });

    it('should maintain tonal stability', async () => {
      await runScheduledMCOptimization();
      
      const state = getLexaraMCOptimizerState();
      // Tonal stability should remain high (above 0.7)
      expect(state.tonalStabilityScore).toBeGreaterThanOrEqual(0.7);
    });

    it('should prevent concurrent optimization cycles', async () => {
      // Start first cycle
      const firstCycle = runScheduledMCOptimization();
      
      // Attempt second cycle while first is running
      try {
        await runScheduledMCOptimization();
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
      }
      
      // Wait for first cycle to complete
      await firstCycle;
    });
  });

  describe('Session Management', () => {
    afterEach(() => {
      endLexaraSession();
    });

    it('should start a new session', () => {
      const session = startLexaraSession('test-session-1');
      
      expect(session.sessionId).toBe('test-session-1');
      expect(session.interactionCount).toBe(0);
      expect(session.topicsDiscussed).toHaveLength(0);
      expect(session.decisionBoundaries).toHaveLength(0);
    });

    it('should record decision boundaries', () => {
      startLexaraSession('test-session-2');
      
      const boundary = recordLexaraDecisionBoundary('topic_shift', 'User switched to contract law');
      
      expect(boundary).toBeDefined();
      expect(boundary?.type).toBe('topic_shift');
      expect(boundary?.triggerContext).toBe('User switched to contract law');
      expect(boundary?.optimizationApplied).toBe(false);
    });

    it('should end session and clear context', () => {
      startLexaraSession('test-session-3');
      recordLexaraDecisionBoundary('complexity_escalation', 'Multi-jurisdictional issue');
      
      endLexaraSession();
      
      // After ending, should not be able to record boundaries
      const boundary = recordLexaraDecisionBoundary('sentiment_change', 'User became stressed');
      expect(boundary).toBeNull();
    });
  });

  describe('Session Boundary Optimization', () => {
    afterEach(() => {
      endLexaraSession();
    });

    it('should run optimization at response_completion boundary', async () => {
      const session = startLexaraSession('test-session-opt-1');
      const boundary: DecisionBoundary = {
        timestamp: new Date(),
        type: 'response_completion',
        triggerContext: 'Response to legal query completed',
        optimizationApplied: false,
      };
      
      const result = await runSessionBoundaryMCOptimization(session, boundary);
      
      expect(result).toBeDefined();
      expect(result?.cycleType).toBe('session_boundary');
      expect(boundary.optimizationApplied).toBe(true);
    });

    it('should skip optimization at non-completion boundaries', async () => {
      const session = startLexaraSession('test-session-opt-2');
      const boundary: DecisionBoundary = {
        timestamp: new Date(),
        type: 'topic_shift',
        triggerContext: 'Topic shift detected',
        optimizationApplied: false,
      };
      
      const result = await runSessionBoundaryMCOptimization(session, boundary);
      
      expect(result).toBeNull();
      expect(boundary.optimizationApplied).toBe(false);
    });
  });

  describe('Response Parameters', () => {
    it('should provide optimized response parameters', () => {
      const params = getOptimizedResponseParameters();
      
      expect(params.legalReasoningBias).toBeGreaterThan(0);
      expect(params.legalReasoningBias).toBeLessThanOrEqual(1);
      
      expect(['hierarchical', 'sequential', 'adaptive']).toContain(params.explanationStructure);
      expect(['professional', 'warm', 'balanced']).toContain(params.conversationalTone);
      
      expect(params.vocalEmphasisLevel).toBeGreaterThan(0);
      expect(params.vocalEmphasisLevel).toBeLessThanOrEqual(1);
    });
  });

  describe('Event Emission', () => {
    it('should emit cycle-started event', async () => {
      let eventEmitted = false;
      
      const handler = () => { eventEmitted = true; };
      lexaraMCOptimizerEvents.on('cycle-started', handler);
      
      await runScheduledMCOptimization();
      
      expect(eventEmitted).toBe(true);
      lexaraMCOptimizerEvents.off('cycle-started', handler);
    });

    it('should emit cycle-complete event', async () => {
      let eventData: any = null;
      
      const handler = (data: any) => { eventData = data; };
      lexaraMCOptimizerEvents.on('cycle-complete', handler);
      
      await runScheduledMCOptimization();
      
      expect(eventData).toBeDefined();
      expect(eventData.cycleId).toBeDefined();
      expect(eventData.totalImprovement).toBeDefined();
      
      lexaraMCOptimizerEvents.off('cycle-complete', handler);
    });
  });
});

describe('LexaraOptimizationScheduler', () => {
  beforeEach(() => {
    stopLexaraScheduler();
    // Configure for testing
    configureLexaraScheduler({
      enabled: true,
      minIntervalMs: 1000, // 1 second for testing
      maxSystemLoadPercent: 95,
      catchUpMissedCycles: false,
      maxCycleDurationMs: 60000,
    });
  });

  afterEach(() => {
    stopLexaraScheduler();
  });

  describe('Initialization', () => {
    it('should have three scheduled cycles by default', () => {
      const state = getLexaraSchedulerState();
      
      expect(state.scheduledCycles).toHaveLength(3);
      
      const cycleIds = state.scheduledCycles.map(c => c.id);
      expect(cycleIds).toContain('night-cycle');
      expect(cycleIds).toContain('morning-cycle');
      expect(cycleIds).toContain('evening-cycle');
    });

    it('should have correct default times (UTC)', () => {
      const state = getLexaraSchedulerState();
      
      const nightCycle = state.scheduledCycles.find(c => c.id === 'night-cycle');
      expect(nightCycle?.hourUTC).toBe(2);
      expect(nightCycle?.minuteUTC).toBe(0);
      
      const morningCycle = state.scheduledCycles.find(c => c.id === 'morning-cycle');
      expect(morningCycle?.hourUTC).toBe(10);
      expect(morningCycle?.minuteUTC).toBe(0);
      
      const eveningCycle = state.scheduledCycles.find(c => c.id === 'evening-cycle');
      expect(eveningCycle?.hourUTC).toBe(18);
      expect(eveningCycle?.minuteUTC).toBe(0);
    });

    it('should calculate next scheduled run', () => {
      const state = getLexaraSchedulerState();
      
      expect(state.nextScheduledRun).toBeInstanceOf(Date);
      expect(state.nextScheduledRun!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Scheduler Control', () => {
    it('should start the scheduler', () => {
      startLexaraScheduler();
      
      const state = getLexaraSchedulerState();
      expect(state.isActive).toBe(true);
    });

    it('should stop the scheduler', () => {
      startLexaraScheduler();
      stopLexaraScheduler();
      
      const state = getLexaraSchedulerState();
      expect(state.isActive).toBe(false);
    });

    it('should enable/disable individual cycles', () => {
      const result = setLexaraCycleEnabled('night-cycle', false);
      expect(result).toBe(true);
      
      const state = getLexaraSchedulerState();
      const nightCycle = state.scheduledCycles.find(c => c.id === 'night-cycle');
      expect(nightCycle?.enabled).toBe(false);
      
      // Re-enable
      setLexaraCycleEnabled('night-cycle', true);
    });

    it('should update cycle times', () => {
      const result = setLexaraCycleTime('morning-cycle', 11, 30);
      expect(result).toBe(true);
      
      const state = getLexaraSchedulerState();
      const morningCycle = state.scheduledCycles.find(c => c.id === 'morning-cycle');
      expect(morningCycle?.hourUTC).toBe(11);
      expect(morningCycle?.minuteUTC).toBe(30);
      
      // Reset to default
      setLexaraCycleTime('morning-cycle', 10, 0);
    });

    it('should reject invalid cycle times', () => {
      const result1 = setLexaraCycleTime('morning-cycle', 25, 0); // Invalid hour
      expect(result1).toBe(false);
      
      const result2 = setLexaraCycleTime('morning-cycle', 10, 60); // Invalid minute
      expect(result2).toBe(false);
    });
  });

  describe('Force Run', () => {
    it('should force run a specific cycle', async () => {
      // Configure optimizer for fast testing
      configureLexaraMCOptimizer({
        simulationsPerDomain: 5,
        maxIterations: 3,
      });
      
      const result = await forceRunLexaraCycle('night-cycle');
      
      expect(result).toBeDefined();
      expect(result?.cycleType).toBe('scheduled');
    });
  });

  describe('Time Until Next Run', () => {
    it('should return time until next scheduled run', () => {
      const timeUntil = getTimeUntilNextLexaraCycle();
      
      expect(timeUntil).toBeDefined();
      expect(timeUntil).toBeGreaterThan(0);
    });
  });

  describe('Event Emission', () => {
    it('should emit scheduler-started event', () => {
      let eventEmitted = false;
      
      const handler = () => { eventEmitted = true; };
      schedulerEvents.on('scheduler-started', handler);
      
      startLexaraScheduler();
      
      expect(eventEmitted).toBe(true);
      schedulerEvents.off('scheduler-started', handler);
    });

    it('should emit scheduler-stopped event', () => {
      let eventEmitted = false;
      
      const handler = () => { eventEmitted = true; };
      schedulerEvents.on('scheduler-stopped', handler);
      
      startLexaraScheduler();
      stopLexaraScheduler();
      
      expect(eventEmitted).toBe(true);
      schedulerEvents.off('scheduler-stopped', handler);
    });
  });
});

describe('Safety Constraints', () => {
  it('should not introduce latency - optimization happens pre-response', () => {
    // Get parameters is synchronous and fast
    const startTime = Date.now();
    getOptimizedResponseParameters();
    const duration = Date.now() - startTime;
    
    // Should be nearly instantaneous (under 10ms)
    expect(duration).toBeLessThan(10);
  });

  it('should maintain personality stability through second-order influence', async () => {
    const profileBefore = getActiveOptimizationProfile();
    
    // Run multiple optimization cycles
    await runScheduledMCOptimization();
    await runScheduledMCOptimization();
    
    const profileAfter = getActiveOptimizationProfile();
    
    // Changes should be gradual (max 15% per cycle, capped by second-order influence)
    const confidenceBefore = profileBefore.consultativeEngagement.confidenceWithoutIntimidation;
    const confidenceAfter = profileAfter.consultativeEngagement.confidenceWithoutIntimidation;
    const confidenceChange = Math.abs(confidenceAfter - confidenceBefore);
    
    // After 2 cycles, max change should be 2 * 0.15 = 0.30
    expect(confidenceChange).toBeLessThanOrEqual(0.30);
  });

  it('should not persist user-specific profiling beyond session', () => {
    // Start session with specific signals
    const session1 = startLexaraSession('user-session-1');
    session1.userSignals.emotionalState = 'anxious';
    session1.topicsDiscussed.push('employment law');
    endLexaraSession();
    
    // Start new session - should have clean slate
    const session2 = startLexaraSession('user-session-2');
    
    expect(session2.userSignals.emotionalState).toBe('calm'); // Default state
    expect(session2.topicsDiscussed).toHaveLength(0);
    
    endLexaraSession();
  });
});
