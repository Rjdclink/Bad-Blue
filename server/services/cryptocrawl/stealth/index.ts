/**
 * LEGACY COMPATIBILITY SHELL — Stealth Superiority
 *
 * The historical Stealth stack is retired from CryptoCrawler authority. Current
 * execution uses the governed verified-plan/topology-specific executors under
 * `execution/`. This facade exists only so historical imports compile.
 *
 * It cannot submit transactions, fabricate profit, learn from synthetic
 * outcomes, start health loops, or influence canonical eligibility.
 */

import type { Wallet, providers } from 'ethers';

export interface LegacyStealthOpportunity {
  asset?: string;
  pair?: string;
  chain?: string;
  priority?: number;
  profitEstimate?: number;
  timestamp?: number;
  [key: string]: unknown;
}

export interface StealthMetrics {
  latency: { avg: number; min: number; max: number; p95: number };
  successRate: number;
  costEfficiency: number;
  uptime: number;
  executionCount: number;
  profitTotal: number;
  lastUpdated: number;
}

export interface LegacyStealthExecutionResult {
  success: false;
  latency: number;
  error: string;
  profit?: never;
}

const RETIRED_MESSAGE = 'Legacy Stealth execution is retired; use canonical governed CryptoCrawler execution';

export class StealthSuperiority {
  async initialize(_wallet: Wallet, _providers: Map<string, providers.JsonRpcProvider>): Promise<void> {
    // Compatibility no-op. No providers/signers are retained.
  }

  async executeWithSuperiority(_opportunity: LegacyStealthOpportunity): Promise<LegacyStealthExecutionResult> {
    return { success: false, latency: 0, error: RETIRED_MESSAGE };
  }

  async executeBatch(opportunities: LegacyStealthOpportunity[]): Promise<LegacyStealthExecutionResult[]> {
    return opportunities.map(() => ({ success: false, latency: 0, error: RETIRED_MESSAGE }));
  }

  getMetrics(): StealthMetrics {
    return {
      latency: { avg: 0, min: 0, max: 0, p95: 0 },
      successRate: 0,
      costEfficiency: 0,
      uptime: 0,
      executionCount: 0,
      profitTotal: 0,
      lastUpdated: Date.now(),
    };
  }

  getHealthStatus() {
    return {
      healthy: false,
      authority: 'compatibility_only' as const,
      executionAllowed: false,
      reason: RETIRED_MESSAGE,
    };
  }

  shutdown(): void {
    // Compatibility no-op.
  }
}
