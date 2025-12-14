/**
 * MANDATORY SAFETY SHIELD - Validation Tests
 * 
 * These tests verify that the safety shield enforces all Stage 1 Hard Laws:
 * 1. SIGNAL_ONLY_MODE - System produces signals ONLY
 * 2. NO_SIGNING - All signing operations are blocked
 * 3. NO_BROADCASTING - All transaction broadcasts are blocked
 * 4. DAILY_CAP_USD - Maximum $200/day
 * 5. FEE_PESSIMISM - Profit must survive pessimistic fee modeling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MandatorySafetyShield,
  getSafetyShield,
  resetSafetyShield,
  SAFETY_CONSTANTS,
  type ArbitrageSignal,
} from '../MANDATORY_SAFETY_SHIELD.js';

describe('MANDATORY_SAFETY_SHIELD', () => {
  let shield: MandatorySafetyShield;
  
  beforeEach(() => {
    resetSafetyShield();
    shield = getSafetyShield();
  });
  
  afterEach(() => {
    resetSafetyShield();
  });
  
  describe('Safety Constants (Immutable)', () => {
    it('SIGNAL_ONLY_MODE must be true', () => {
      expect(SAFETY_CONSTANTS.SIGNAL_ONLY_MODE).toBe(true);
    });
    
    it('ALLOW_SIGNING must be false', () => {
      expect(SAFETY_CONSTANTS.ALLOW_SIGNING).toBe(false);
    });
    
    it('ALLOW_BROADCASTING must be false', () => {
      expect(SAFETY_CONSTANTS.ALLOW_BROADCASTING).toBe(false);
    });
    
    it('ALLOW_FUND_MOVEMENT must be false', () => {
      expect(SAFETY_CONSTANTS.ALLOW_FUND_MOVEMENT).toBe(false);
    });
    
    it('DAILY_CAP_USD must be $200', () => {
      expect(SAFETY_CONSTANTS.DAILY_CAP_USD).toBe(200);
    });
    
    it('GAS_PESSIMISM_MULTIPLIER must be 2x', () => {
      expect(SAFETY_CONSTANTS.GAS_PESSIMISM_MULTIPLIER).toBe(2.0);
    });
    
    it('SLIPPAGE_PESSIMISM_PERCENT must be 3%', () => {
      expect(SAFETY_CONSTANTS.SLIPPAGE_PESSIMISM_PERCENT).toBe(3.0);
    });
    
    it('FEE_PESSIMISM_MULTIPLIER must be 1.5x', () => {
      expect(SAFETY_CONSTANTS.FEE_PESSIMISM_MULTIPLIER).toBe(1.5);
    });
    
    it('SAFETY_CONSTANTS must be frozen', () => {
      expect(Object.isFrozen(SAFETY_CONSTANTS)).toBe(true);
    });
  });
  
  describe('Safety State Verification', () => {
    it('shield initializes in safe state', () => {
      expect(shield.verifySafeState()).toBe(true);
    });
    
    it('state shows signalOnlyMode enabled', () => {
      const state = shield.getState();
      expect(state.signalOnlyMode).toBe(true);
    });
    
    it('state shows signing blocked', () => {
      const state = shield.getState();
      expect(state.signingBlocked).toBe(true);
    });
    
    it('state shows broadcasting blocked', () => {
      const state = shield.getState();
      expect(state.broadcastingBlocked).toBe(true);
    });
  });
  
  describe('Signal Creation and Validation', () => {
    it('creates valid signal for profitable opportunity', () => {
      const signal = shield.validateAndCreateSignal({
        id: 'test-1',
        asset: 'ETH',
        chain: 'polygon',
        type: 'simple',
        grossProfitEstimateUSD: 10,
        estimatedGasCostUSD: 1,
        estimatedSlippageUSD: 0.1,
        estimatedProtocolFeesUSD: 0.1,
        riskScore: 0.05,
        confidenceScore: 0.9,
        source: 'test',
      });
      
      expect(signal.isValidSignal).toBe(true);
      expect(signal.passesFeeSurvivalTest).toBe(true);
      expect(signal.passesDailyCap).toBe(true);
    });
    
    it('rejects signal that fails fee survival test', () => {
      const signal = shield.validateAndCreateSignal({
        id: 'test-2',
        asset: 'ETH',
        chain: 'polygon',
        type: 'simple',
        grossProfitEstimateUSD: 0.01, // Very small profit
        estimatedGasCostUSD: 5,       // High gas
        estimatedSlippageUSD: 0.1,
        estimatedProtocolFeesUSD: 0.1,
        riskScore: 0.05,
        confidenceScore: 0.9,
        source: 'test',
      });
      
      expect(signal.isValidSignal).toBe(false);
      expect(signal.passesFeeSurvivalTest).toBe(false);
      expect(signal.rejectionReason).toContain('Fee survival failed');
    });
    
    it('applies pessimistic fee multipliers correctly', () => {
      const signal = shield.validateAndCreateSignal({
        id: 'test-3',
        asset: 'ETH',
        chain: 'polygon',
        type: 'simple',
        grossProfitEstimateUSD: 100,
        estimatedGasCostUSD: 10,      // Will become 20 (2x)
        estimatedSlippageUSD: 1,
        estimatedProtocolFeesUSD: 5,   // Will become 7.5 (1.5x)
        riskScore: 0.05,
        confidenceScore: 0.9,
        source: 'test',
      });
      
      // Gas: 10 * 2.0 = 20
      expect(signal.pessimisticGasCostUSD).toBe(20);
      // Slippage: 100 * 3% = 3
      expect(signal.pessimisticSlippageUSD).toBe(3);
      // Protocol fees: 5 * 1.5 = 7.5
      expect(signal.pessimisticProtocolFeesUSD).toBe(7.5);
      // Pessimistic profit: 100 - 20 - 3 - 7.5 = 69.5
      expect(signal.pessimisticNetProfitUSD).toBe(69.5);
    });
    
    it('rejects signal that exceeds daily cap', () => {
      // First, fill up the daily cap
      for (let i = 0; i < 20; i++) {
        shield.validateAndCreateSignal({
          id: `fill-${i}`,
          asset: 'ETH',
          chain: 'polygon',
          type: 'simple',
          grossProfitEstimateUSD: 20,
          estimatedGasCostUSD: 1,
          estimatedSlippageUSD: 0.1,
          estimatedProtocolFeesUSD: 0.1,
          riskScore: 0.05,
          confidenceScore: 0.9,
          source: 'test',
        });
      }
      
      // This signal should be rejected for exceeding cap
      const signal = shield.validateAndCreateSignal({
        id: 'exceed-cap',
        asset: 'ETH',
        chain: 'polygon',
        type: 'simple',
        grossProfitEstimateUSD: 100,
        estimatedGasCostUSD: 1,
        estimatedSlippageUSD: 0.1,
        estimatedProtocolFeesUSD: 0.1,
        riskScore: 0.05,
        confidenceScore: 0.9,
        source: 'test',
      });
      
      expect(signal.isValidSignal).toBe(false);
      expect(signal.passesDailyCap).toBe(false);
      expect(signal.rejectionReason).toContain('exceed daily cap');
    });
    
    it('rejects signal with too high risk', () => {
      const signal = shield.validateAndCreateSignal({
        id: 'high-risk',
        asset: 'ETH',
        chain: 'polygon',
        type: 'simple',
        grossProfitEstimateUSD: 100,
        estimatedGasCostUSD: 1,
        estimatedSlippageUSD: 0.1,
        estimatedProtocolFeesUSD: 0.1,
        riskScore: 0.50, // 50% risk - too high
        confidenceScore: 0.9,
        source: 'test',
      });
      
      expect(signal.isValidSignal).toBe(false);
      expect(signal.rejectionReason).toContain('Risk too high');
    });
  });
  
  describe('Blocked Operations', () => {
    it('blocks signing attempts', () => {
      expect(() => shield.attemptSign({ data: 'test' })).toThrow('BLOCKED: Transaction signing is forbidden');
    });
    
    it('blocks broadcast attempts', () => {
      expect(() => shield.attemptBroadcast({ tx: 'test' })).toThrow('BLOCKED: Transaction broadcasting is forbidden');
    });
    
    it('blocks fund movement attempts', () => {
      expect(() => shield.attemptFundMovement({ amount: 100 })).toThrow('EMERGENCY HALT');
    });
  });
  
  describe('Daily Summary', () => {
    it('provides accurate daily summary', () => {
      // Create a valid signal
      shield.validateAndCreateSignal({
        id: 'summary-test',
        asset: 'ETH',
        chain: 'polygon',
        type: 'simple',
        grossProfitEstimateUSD: 50,
        estimatedGasCostUSD: 5,
        estimatedSlippageUSD: 0.5,
        estimatedProtocolFeesUSD: 0.5,
        riskScore: 0.05,
        confidenceScore: 0.9,
        source: 'test',
      });
      
      const summary = shield.getDailySummary();
      
      expect(summary.signalCount).toBe(1);
      expect(summary.hypotheticalProfitUSD).toBeGreaterThan(0);
      expect(summary.remainingCapUSD).toBeLessThan(SAFETY_CONSTANTS.DAILY_CAP_USD);
    });
    
    it('tracks rejected signals separately', () => {
      // Create an invalid signal
      shield.validateAndCreateSignal({
        id: 'rejected-test',
        asset: 'ETH',
        chain: 'polygon',
        type: 'simple',
        grossProfitEstimateUSD: 0.001, // Too small
        estimatedGasCostUSD: 10,        // Too expensive
        estimatedSlippageUSD: 0.5,
        estimatedProtocolFeesUSD: 0.5,
        riskScore: 0.05,
        confidenceScore: 0.9,
        source: 'test',
      });
      
      const summary = shield.getDailySummary();
      expect(summary.rejectedCount).toBe(1);
    });
  });
  
  describe('Audit Trail', () => {
    it('maintains audit log', () => {
      shield.validateAndCreateSignal({
        id: 'audit-test',
        asset: 'ETH',
        chain: 'polygon',
        type: 'simple',
        grossProfitEstimateUSD: 50,
        estimatedGasCostUSD: 5,
        estimatedSlippageUSD: 0.5,
        estimatedProtocolFeesUSD: 0.5,
        riskScore: 0.05,
        confidenceScore: 0.9,
        source: 'test',
      });
      
      const auditLog = shield.getAuditLog();
      expect(auditLog.length).toBeGreaterThan(0);
      expect(auditLog.some(entry => entry.action === 'SIGNAL_CREATED')).toBe(true);
    });
  });
});
