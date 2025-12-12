/**
 * Tests for Lexara Power Core
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LexaraPowerCore,
  getLexaraPowerCore,
  initializeLexaraPowerCore,
  shutdownLexaraPowerCore,
  PowerState,
  LexaraCapability,
  PowerBoostRequest,
} from '../lexaraPowerCore';

describe('LexaraPowerCore', () => {
  let powerCore: LexaraPowerCore;

  beforeEach(async () => {
    // Get fresh instance
    powerCore = new LexaraPowerCore();
  });

  afterEach(async () => {
    if (powerCore.isInitialized()) {
      await powerCore.shutdown();
    }
    // Clean up singleton
    await shutdownLexaraPowerCore();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await powerCore.initialize();
      
      expect(powerCore.isInitialized()).toBe(true);
      expect(powerCore.isOperational()).toBe(true);
    });

    it('should start in idle state after initialization', async () => {
      await powerCore.initialize();
      
      const state = powerCore.getState();
      expect(state.state).toBe('idle');
    });

    it('should initialize all capabilities', async () => {
      await powerCore.initialize();
      
      const capabilities = powerCore.getAllCapabilityStatuses();
      expect(capabilities.size).toBe(5);
      expect(capabilities.has('voice')).toBe(true);
      expect(capabilities.has('reasoning')).toBe(true);
      expect(capabilities.has('emotion')).toBe(true);
      expect(capabilities.has('memory')).toBe(true);
      expect(capabilities.has('response')).toBe(true);
    });

    it('should not initialize twice', async () => {
      await powerCore.initialize();
      await powerCore.initialize(); // Should not throw
      
      expect(powerCore.isInitialized()).toBe(true);
    });
  });

  describe('State Transitions', () => {
    beforeEach(async () => {
      await powerCore.initialize();
    });

    it('should transition from idle to active', async () => {
      const result = await powerCore.transitionState('active');
      
      expect(result.success).toBe(true);
      expect(result.previousState).toBe('idle');
      expect(result.newState).toBe('active');
    });

    it('should transition from idle to conservation', async () => {
      const result = await powerCore.transitionState('conservation');
      
      expect(result.success).toBe(true);
      expect(result.newState).toBe('conservation');
    });

    it('should transition from active to boosted', async () => {
      await powerCore.transitionState('active');
      const result = await powerCore.transitionState('boosted');
      
      expect(result.success).toBe(true);
      expect(result.newState).toBe('boosted');
    });

    it('should block invalid transitions', async () => {
      // Cannot go directly from idle to critical
      const result = await powerCore.transitionState('critical');
      
      expect(result.success).toBe(false);
      expect(result.newState).toBe('idle'); // Stays in idle
    });

    it('should allow transition to offline from any operational state', async () => {
      const result = await powerCore.transitionState('offline');
      
      expect(result.success).toBe(true);
      expect(result.newState).toBe('offline');
    });

    it('should update power level based on state', async () => {
      await powerCore.transitionState('active');
      let state = powerCore.getState();
      const activePower = state.powerLevel.current;
      
      await powerCore.transitionState('boosted');
      state = powerCore.getState();
      const boostedPower = state.powerLevel.current;
      
      expect(boostedPower).toBeGreaterThan(activePower);
    });
  });

  describe('Power Boost', () => {
    beforeEach(async () => {
      await powerCore.initialize();
      await powerCore.transitionState('active');
    });

    it('should grant power boost for valid request', async () => {
      const request: PowerBoostRequest = {
        capability: 'reasoning',
        duration: 5000,
        intensity: 1.5,
        reason: 'Complex query processing',
      };
      
      const response = await powerCore.requestBoost(request);
      
      expect(response.granted).toBe(true);
      expect(response.boostId).toBeTruthy();
      expect(response.actualIntensity).toBeGreaterThan(0);
    });

    it('should deny boost when in critical state', async () => {
      // Force transition to critical
      await powerCore.transitionState('conservation');
      await powerCore.transitionState('critical');
      
      const request: PowerBoostRequest = {
        capability: 'reasoning',
        duration: 5000,
        intensity: 1.5,
        reason: 'Test',
      };
      
      const response = await powerCore.requestBoost(request);
      
      expect(response.granted).toBe(false);
    });

    it('should track active boosts', async () => {
      const request: PowerBoostRequest = {
        capability: 'voice',
        duration: 10000,
        intensity: 1.2,
        reason: 'Voice enhancement',
      };
      
      await powerCore.requestBoost(request);
      const activeBoosts = powerCore.getActiveBoosts();
      
      expect(activeBoosts.length).toBe(1);
      expect(activeBoosts[0].capability).toBe('voice');
    });

    it('should increase capability output when boosted', async () => {
      const capabilityBefore = powerCore.getCapabilityStatus('reasoning');
      const outputBefore = capabilityBefore?.output || 0;
      
      const request: PowerBoostRequest = {
        capability: 'reasoning',
        duration: 10000,
        intensity: 1.5,
        reason: 'Test boost',
      };
      
      await powerCore.requestBoost(request);
      
      const capabilityAfter = powerCore.getCapabilityStatus('reasoning');
      const outputAfter = capabilityAfter?.output || 0;
      
      expect(outputAfter).toBeGreaterThan(outputBefore);
    });
  });

  describe('Capability Allocation', () => {
    beforeEach(async () => {
      await powerCore.initialize();
    });

    it('should set capability allocation', () => {
      const result = powerCore.setCapabilityAllocation('voice', 0.4);
      
      expect(result).toBe(true);
      
      const status = powerCore.getCapabilityStatus('voice');
      expect(status?.allocation).toBe(0.4);
    });

    it('should clamp allocation to valid range', () => {
      powerCore.setCapabilityAllocation('voice', 1.5); // Above max
      
      const status = powerCore.getCapabilityStatus('voice');
      expect(status?.allocation).toBeLessThanOrEqual(1);
    });

    it('should rebalance other capabilities when one changes', () => {
      // Set voice to 50%
      powerCore.setCapabilityAllocation('voice', 0.5);
      
      // Get all allocations
      const capabilities = powerCore.getAllCapabilityStatuses();
      let total = 0;
      for (const [, data] of capabilities) {
        total += data.allocation;
      }
      
      // Total should still be approximately 1
      expect(total).toBeCloseTo(1, 1);
    });
  });

  describe('Power Calculation', () => {
    beforeEach(async () => {
      await powerCore.initialize();
    });

    it('should calculate total power output', () => {
      const power = powerCore.calculateTotalPower();
      
      expect(power).toBeGreaterThan(0);
      expect(power).toBeLessThanOrEqual(1);
    });

    it('should have higher power in active state than idle', async () => {
      const idlePower = powerCore.calculateTotalPower();
      
      await powerCore.transitionState('active');
      const activePower = powerCore.calculateTotalPower();
      
      expect(activePower).toBeGreaterThan(idlePower);
    });

    it('should have highest power in boosted state', async () => {
      await powerCore.transitionState('active');
      const activePower = powerCore.calculateTotalPower();
      
      await powerCore.transitionState('boosted');
      const boostedPower = powerCore.calculateTotalPower();
      
      expect(boostedPower).toBeGreaterThan(activePower);
    });
  });

  describe('Metrics', () => {
    beforeEach(async () => {
      await powerCore.initialize();
    });

    it('should provide comprehensive metrics', () => {
      const metrics = powerCore.getMetrics();
      
      expect(metrics).toHaveProperty('totalPowerOutput');
      expect(metrics).toHaveProperty('averageEfficiency');
      expect(metrics).toHaveProperty('peakPower');
      expect(metrics).toHaveProperty('energyConsumed');
      expect(metrics).toHaveProperty('uptime');
      expect(metrics).toHaveProperty('stateTransitions');
      expect(metrics).toHaveProperty('boostsGranted');
      expect(metrics).toHaveProperty('currentState');
    });

    it('should track state transitions', async () => {
      await powerCore.transitionState('active');
      await powerCore.transitionState('boosted');
      
      const metrics = powerCore.getMetrics();
      // Initial idle + active + boosted = 3 transitions
      expect(metrics.stateTransitions).toBeGreaterThanOrEqual(2);
    });

    it('should track boosts granted', async () => {
      await powerCore.transitionState('active');
      
      await powerCore.requestBoost({
        capability: 'reasoning',
        duration: 5000,
        intensity: 1.2,
        reason: 'Test',
      });
      
      const metrics = powerCore.getMetrics();
      expect(metrics.boostsGranted).toBe(1);
    });
  });

  describe('Power Flow History', () => {
    beforeEach(async () => {
      await powerCore.initialize();
    });

    it('should provide power flow history', () => {
      const history = powerCore.getPowerFlowHistory();
      
      expect(Array.isArray(history)).toBe(true);
    });

    it('should limit history to requested count', async () => {
      // Wait a bit for some metrics to accumulate
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const history = powerCore.getPowerFlowHistory(5);
      
      expect(history.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Energy Management', () => {
    beforeEach(async () => {
      await powerCore.initialize();
    });

    it('should track energy levels', () => {
      const state = powerCore.getState();
      
      expect(state.energy.current).toBeGreaterThan(0);
      expect(state.energy.capacity).toBeGreaterThan(0);
    });

    it('should have higher drain in boosted mode', async () => {
      await powerCore.transitionState('active');
      const activeState = powerCore.getState();
      
      await powerCore.transitionState('boosted');
      const boostedState = powerCore.getState();
      
      expect(boostedState.energy.drainRate).toBeGreaterThan(activeState.energy.drainRate);
    });

    it('should have lower drain in conservation mode', async () => {
      const idleState = powerCore.getState();
      
      await powerCore.transitionState('conservation');
      const conservationState = powerCore.getState();
      
      expect(conservationState.energy.drainRate).toBeLessThan(idleState.energy.drainRate);
    });
  });

  describe('Shutdown', () => {
    beforeEach(async () => {
      await powerCore.initialize();
    });

    it('should shutdown cleanly', async () => {
      await powerCore.shutdown();
      
      expect(powerCore.isInitialized()).toBe(false);
      expect(powerCore.isOperational()).toBe(false);
    });

    it('should transition to offline on shutdown', async () => {
      await powerCore.shutdown();
      
      const state = powerCore.getState();
      expect(state.state).toBe('offline');
    });

    it('should clear active boosts on shutdown', async () => {
      await powerCore.transitionState('active');
      await powerCore.requestBoost({
        capability: 'reasoning',
        duration: 10000,
        intensity: 1.5,
        reason: 'Test',
      });
      
      await powerCore.shutdown();
      
      const activeBoosts = powerCore.getActiveBoosts();
      expect(activeBoosts.length).toBe(0);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance from getLexaraPowerCore', () => {
      const instance1 = getLexaraPowerCore();
      const instance2 = getLexaraPowerCore();
      
      expect(instance1).toBe(instance2);
    });

    it('should initialize and return singleton', async () => {
      const instance = await initializeLexaraPowerCore();
      
      expect(instance.isInitialized()).toBe(true);
    });
  });
});
