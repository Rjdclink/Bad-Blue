/**
 * Real-World Integration Tests for Risk Management System
 * Tests actual TypeScript modules in production-like conditions
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { DailyCapLadder, GlobalHaltController } from '../index.js';

describe('Daily Cap Ladder - Real World', () => {
  let capLadder: DailyCapLadder;

  beforeEach(() => {
    capLadder = new DailyCapLadder();
  });

  test('enforces Tier 1 cap at $200', () => {
    let totalProfit = 0;
    let tradesExecuted = 0;
    
    // Simulate trading until cap is hit
    for (let i = 0; i < 100; i++) {
      const tradeProfit = 10; // $10 per trade
      const allowed = capLadder.recordTrade(tradeProfit, true);
      
      if (allowed) {
        totalProfit += tradeProfit;
        tradesExecuted++;
      } else {
        // Cap should be reached
        break;
      }
    }
    
    expect(tradesExecuted).toBe(20); // 20 trades * $10 = $200
    expect(totalProfit).toBe(200);
    expect(capLadder.isHalted()).toBe(true);
  });

  test('tracks performance history correctly', () => {
    capLadder.recordTrade(50, true);
    capLadder.recordTrade(30, true);
    capLadder.recordTrade(20, false);
    
    const status = capLadder.getCapStatus();
    expect(status.currentDailyProfit).toBe(100);
    expect(status.percentOfCap).toBe(50); // 100/200 = 50%
  });

  test('validates tier advancement requirements', () => {
    const check = capLadder.checkAdvancement();
    
    expect(check.canAdvance).toBe(false);
    expect(check.reason).toContain('stable days');
    expect(check.currentTier).toBe(1);
    expect(check.requiredDays).toBe(5);
  });

  test('resumes after manual intervention', () => {
    // Trigger halt
    capLadder.enforceHalt('test', 'Manual test halt');
    expect(capLadder.isHalted()).toBe(true);
    
    // Resume
    capLadder.resume();
    expect(capLadder.isHalted()).toBe(false);
  });
});

describe('Global Halt Controller - Real World', () => {
  let haltController: GlobalHaltController;

  beforeEach(() => {
    haltController = new GlobalHaltController();
  });

  afterEach(() => {
    haltController.reset();
  });

  test('registers and monitors conditions', () => {
    const conditions = haltController.getConditions();
    expect(conditions.length).toBeGreaterThan(0);
    
    // Should have default conditions
    const drawdownCondition = conditions.find(c => c.type === 'drawdown');
    expect(drawdownCondition).toBeDefined();
    expect(drawdownCondition?.threshold).toBe(0.15);
  });

  test('triggers halt when threshold exceeded', () => {
    // Find drawdown condition
    const conditions = haltController.getConditions();
    const drawdownCondition = conditions.find(c => c.type === 'drawdown');
    
    // Update to exceed threshold
    if (drawdownCondition) {
      haltController.updateCondition(drawdownCondition.id, 0.20); // 20% > 15% threshold
    }
    
    expect(haltController.isHalted()).toBe(true);
  });

  test('auto-resumes when condition clears', (done) => {
    // Register auto-resume condition
    const conditionId = haltController.registerCondition(
      'execution_anomaly',
      'Test anomaly',
      0.25,
      'medium',
      true // auto-resume enabled
    );
    
    // Listen for resume event
    haltController.once('resume', (event) => {
      expect(event.resumeType).toBe('auto');
      done();
    });
    
    // Trigger halt
    haltController.updateCondition(conditionId, 0.30);
    expect(haltController.isHalted()).toBe(true);
    
    // Clear condition (simulate fix)
    haltController.updateCondition(conditionId, 0.15); // Below 80% of threshold
  });

  test('prevents auto-resume for critical conditions', () => {
    haltController.triggerHalt('Critical failure', 'critical');
    expect(haltController.isHalted()).toBe(true);
    
    // Try auto-resume (should fail)
    const resumed = haltController.resume(false);
    expect(resumed).toBe(false);
    expect(haltController.isHalted()).toBe(true);
    
    // Manual resume (should succeed)
    const manualResumed = haltController.resume(true);
    expect(manualResumed).toBe(true);
    expect(haltController.isHalted()).toBe(false);
  });

  test('tracks halt history', () => {
    haltController.triggerHalt('Test halt 1', 'medium');
    haltController.resume(true);
    haltController.triggerHalt('Test halt 2', 'high');
    haltController.resume(true);
    
    const history = haltController.getHaltHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Integration - Cap Ladder + Halt Controller', () => {
  let capLadder: DailyCapLadder;
  let haltController: GlobalHaltController;

  beforeEach(() => {
    capLadder = new DailyCapLadder();
    haltController = new GlobalHaltController();
  });

  afterEach(() => {
    haltController.reset();
  });

  test('halt controller stops execution when cap reached', () => {
    // Simulate trading loop
    for (let i = 0; i < 50; i++) {
      // Check halt status first (production pattern)
      if (haltController.isHalted()) {
        break;
      }
      
      const tradeProfit = 10;
      const allowed = capLadder.recordTrade(tradeProfit, true);
      
      if (!allowed) {
        // Cap reached - trigger halt
        haltController.updateConditionByType('daily_cap', 1.0);
        break;
      }
    }
    
    expect(capLadder.isHalted()).toBe(true);
    expect(haltController.isHalted()).toBe(true);
  });

  test('system resumes cleanly after halt', () => {
    // Trigger halt in both systems
    capLadder.enforceHalt('test', 'Integration test');
    haltController.triggerHalt('Integration test', 'medium');
    
    expect(capLadder.isHalted()).toBe(true);
    expect(haltController.isHalted()).toBe(true);
    
    // Resume both
    capLadder.resume();
    haltController.resume(true);
    
    expect(capLadder.isHalted()).toBe(false);
    expect(haltController.isHalted()).toBe(false);
    
    // Should be able to record new trades
    const allowed = capLadder.recordTrade(10, true);
    expect(allowed).toBe(true);
  });
});

describe('Production Scenarios', () => {
  let capLadder: DailyCapLadder;
  let haltController: GlobalHaltController;

  beforeEach(() => {
    capLadder = new DailyCapLadder();
    haltController = new GlobalHaltController();
  });

  afterEach(() => {
    haltController.reset();
  });

  test('handles rapid successive trades', () => {
    const trades = [];
    for (let i = 0; i < 30; i++) {
      const profit = Math.random() * 5 + 2; // $2-7 per trade
      const success = Math.random() > 0.2; // 80% success rate
      const allowed = capLadder.recordTrade(profit, success);
      
      if (allowed) {
        trades.push({ profit, success });
      }
    }
    
    const status = capLadder.getCapStatus();
    expect(status.currentDailyProfit).toBeLessThanOrEqual(200);
    
    // Calculate success rate
    const successfulTrades = trades.filter(t => t.success).length;
    const successRate = successfulTrades / trades.length;
    expect(successRate).toBeGreaterThan(0.7); // Should meet Tier 1 requirement
  });

  test('prevents execution during drawdown', () => {
    // Register drawdown monitor
    haltController.updateConditionByType('drawdown', 0.18); // 18% > 15% threshold
    
    expect(haltController.isHalted()).toBe(true);
    
    // Execution should be blocked
    const status = haltController.getStatus();
    expect(status.running).toBe(false);
  });

  test('logs all halt events for audit', () => {
    // Trigger multiple halt events
    haltController.triggerHalt('Event 1', 'low');
    haltController.resume(true);
    haltController.triggerHalt('Event 2', 'medium');
    haltController.resume(true);
    haltController.triggerHalt('Event 3', 'high');
    
    const history = haltController.getHaltHistory();
    expect(history.length).toBe(3);
    
    // Verify audit trail
    expect(history[0].reason).toContain('Event 1');
    expect(history[1].reason).toContain('Event 2');
    expect(history[2].reason).toContain('Event 3');
  });
});
