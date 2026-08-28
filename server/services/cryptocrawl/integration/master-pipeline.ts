/**
 * @deprecated CryptoCrawler diagnostics compatibility facade.
 *
 * Historical versions of MasterPipeline owned LuxSwarm/Stealth/TripleDip/RL
 * execution paths. Those paths are retired. This class is intentionally limited
 * to readiness/status compatibility for existing admin and wire-check callers.
 * It grants no discovery, execution, settlement, learning, or scaling authority.
 */

import logger from '../../../logger.js';
import { getCryptara } from '../../cryptara/index.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import { TradingViewEngine } from '../babel/tradingview-integration.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import {
  assessSharedExecutionEnvironment,
  getSharedExecutionCapabilities,
} from '../execution/index.js';
import { ensureCryptaraAssessmentWiring } from './cryptara-assessment-wiring.js';

type ReadinessIssue = {
  id: string;
  severity: 'warn' | 'block';
  detail: string;
  remediation: string;
};

type DeploymentReadinessPass = {
  passNumber: number;
  status: 'pass' | 'warn' | 'fail';
  issues: ReadinessIssue[];
  cryptara: {
    liveSignalReady: boolean;
    tradingView: { ready: boolean; mode: string; detail: string };
    alchemy: { ready: boolean; mode: string; detail: string };
    rpc: { ready: boolean; mode: string; detail: string };
  };
  execution: ReturnType<typeof assessSharedExecutionEnvironment> & ReturnType<typeof getSharedExecutionCapabilities>;
};

class MasterPipeline {
  private initialized = false;
  private lastReadinessCheckAt: number | null = null;
  private lastFinalStatus: 'ready' | 'ready_with_warnings' | 'blocked' | 'not_checked' = 'not_checked';

  private isStrictConnectorMode(): boolean {
    return process.env.CRYPTO_REQUIRE_LIVE_CONNECTORS === 'true' || process.env.NODE_ENV === 'production';
  }

  /**
   * Compatibility initialization installs canonical Cryptara assessment wiring
   * and probes live signal readiness. It does not start a trading pipeline.
   */
  async initialize(): Promise<void> {
    ensureCryptaraAssessmentWiring();
    const cryptara = getCryptara({
      enabled: true,
      surveillanceMode: 'scheduled',
      faucetTriggered: true,
      monteCarloInterval: 6,
    });
    await cryptara.initialize();
    this.initialized = true;
    logger.info('MasterPipeline compatibility diagnostics initialized', {
      component: 'MasterPipeline',
      authority: 'diagnostics_only',
      legacyExecutionAuthority: false,
    });
  }

  async reviewDeploymentReadiness(options?: { passes?: number; strictConnectors?: boolean }): Promise<{
    generatedAt: string;
    requestedPasses: number;
    strictConnectors: boolean;
    passes: DeploymentReadinessPass[];
    stableClearPasses: number;
    finalStatus: 'ready' | 'ready_with_warnings' | 'blocked';
    recommendations: string[];
  }> {
    const requestedPasses = Math.max(1, Math.min(5, options?.passes ?? 2));
    const strictConnectors = options?.strictConnectors ?? this.isStrictConnectorMode();
    const recommendations = new Set<string>();
    const passes: DeploymentReadinessPass[] = [];
    let stableClearPasses = 0;

    let initializationError: string | null = null;
    try {
      await this.initialize();
    } catch (error) {
      initializationError = error instanceof Error ? error.message : String(error);
    }

    const cryptara = getCryptara();

    for (let passNumber = 1; passNumber <= requestedPasses; passNumber++) {
      const issues: ReadinessIssue[] = [];
      const [tradingView, alchemy, cryptaraReadiness] = await Promise.all([
        TradingViewEngine.checkReadiness({ strictLive: strictConnectors }),
        alchemyIntegration.readinessCheck({ strictLive: strictConnectors }),
        cryptara.validateLiveSignalReadiness({ strictLive: strictConnectors }),
      ]);

      try {
        await multiProviderRpcManager.initialize(['ethereum']);
      } catch (error) {
        issues.push({
          id: 'rpc-initialize',
          severity: 'block',
          detail: error instanceof Error ? error.message : String(error),
          remediation: 'Restore a chain-verified configured RPC provider before claiming live readiness.',
        });
      }

      if (initializationError) {
        issues.push({
          id: 'cryptara-initialize',
          severity: 'block',
          detail: initializationError,
          remediation: 'Resolve Cryptara live-signal initialization blockers and rerun readiness review.',
        });
      }
      if (!tradingView.ready) {
        issues.push({
          id: 'tradingview-live',
          severity: strictConnectors ? 'block' : 'warn',
          detail: tradingView.detail,
          remediation: 'Restore live TradingView evidence or keep the runtime in non-live posture.',
        });
      }
      if (!cryptaraReadiness.liveSignalReady) {
        issues.push({
          id: 'cryptara-live-stack',
          severity: strictConnectors ? 'block' : 'warn',
          detail: `${cryptaraReadiness.tradingView.detail}; ${cryptaraReadiness.rpc.detail}`,
          remediation: 'Require live technical evidence and a chain-verified RPC before production execution.',
        });
      }
      if (!alchemy.ready) {
        issues.push({
          id: 'alchemy-enhanced-telemetry',
          severity: 'warn',
          detail: alchemy.detail,
          remediation: 'Restore Alchemy enhanced telemetry if that optional signal source is required.',
        });
      }

      const environment = assessSharedExecutionEnvironment();
      const capabilities = getSharedExecutionCapabilities();
      if (environment.noExecutionGuardEnabled && environment.liveExecutionEnabled) {
        issues.push({
          id: 'execution-guard-conflict',
          severity: 'block',
          detail: 'NO_EXECUTION=true conflicts with live execution posture.',
          remediation: 'Keep NO_EXECUTION authoritative until all live execution gates are intentionally enabled.',
        });
      }
      if (environment.placeholderExecutionAllowed) {
        issues.push({
          id: 'placeholder-execution-enabled',
          severity: 'block',
          detail: 'Placeholder execution is enabled.',
          remediation: 'Disable CRYPTO_ALLOW_PLACEHOLDER_EXECUTION in any environment claiming live readiness.',
        });
      }
      if (environment.liveExecutionEnabled && !environment.liveExecutionConfirmed) {
        issues.push({
          id: 'live-execution-unconfirmed',
          severity: 'block',
          detail: 'Live execution is enabled without the explicit confirmation guard.',
          remediation: 'Do not enable live execution until explicit live-order confirmation is intentionally configured.',
        });
      }
      if (environment.liveExecutionEnabled && !environment.anyLiveRouteReady) {
        issues.push({
          id: 'no-live-route',
          severity: 'block',
          detail: 'Live execution is enabled but no topology is fully ready.',
          remediation: 'Restore topology-specific signer/account/RPC/venue readiness before live execution.',
        });
      }

      const status: DeploymentReadinessPass['status'] = issues.some(issue => issue.severity === 'block')
        ? 'fail'
        : issues.length > 0
          ? 'warn'
          : 'pass';
      stableClearPasses = status === 'pass' ? stableClearPasses + 1 : 0;
      issues.forEach(issue => recommendations.add(issue.remediation));
      passes.push({
        passNumber,
        status,
        issues,
        cryptara: {
          liveSignalReady: cryptaraReadiness.liveSignalReady,
          tradingView: { ...cryptaraReadiness.tradingView },
          alchemy: { ...cryptaraReadiness.alchemy },
          rpc: { ...cryptaraReadiness.rpc },
        },
        execution: { ...environment, ...capabilities },
      });
    }

    const finalStatus: 'ready' | 'ready_with_warnings' | 'blocked' = stableClearPasses >= requestedPasses
      ? 'ready'
      : passes.some(pass => pass.status === 'fail')
        ? 'blocked'
        : 'ready_with_warnings';
    this.lastReadinessCheckAt = Date.now();
    this.lastFinalStatus = finalStatus;

    return {
      generatedAt: new Date().toISOString(),
      requestedPasses,
      strictConnectors,
      passes,
      stableClearPasses,
      finalStatus,
      recommendations: [...recommendations],
    };
  }

  /**
   * Historical execution entry point is intentionally retired.
   */
  async run(): Promise<void> {
    throw new Error('MasterPipeline execution authority is retired; use canonical measured discovery and CanonicalExecutionScheduler');
  }

  isRunning(): boolean {
    return false;
  }

  async stop(): Promise<void> {
    // Diagnostics facade owns no runtime loop.
  }

  getMetrics() {
    return {
      running: false,
      authority: 'diagnostics_only' as const,
      legacyExecutionAuthority: false,
      initialized: this.initialized,
      lastReadinessCheckAt: this.lastReadinessCheckAt,
      lastFinalStatus: this.lastFinalStatus,
      opportunitiesProcessed: 0,
      totalProfit: 0,
    };
  }
}

export const pipeline = new MasterPipeline();
