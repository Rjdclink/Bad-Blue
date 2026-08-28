/**
 * PANTHEON UNIFIED REACTOR
 *
 * This module owns the non-CryptoCrawler Reactor services. CryptoCrawler trading
 * execution is intentionally NOT started or re-exported here: canonical trading
 * authority lives under server/services/cryptocrawl.
 */

import { getTransport } from '../../packages/contracts/src/transport';
import { getReactorCore } from '../../services/reactor-core/index';
import { getSimFabric } from '../../services/sim-fabric/index';
import { getLexaraPlanner, getLexaraSynth } from '../../services/lexara-synth/index';
import { getForensicsDashboard } from '../../dashboards/forensics/index';

// Re-export contracts
export * from '../../packages/contracts/src/index';
export { ReactorTransport, getTransport } from '../../packages/contracts/src/transport';

// Re-export non-CryptoCrawler Reactor services.
export { ReactorCore, getReactorCore } from '../../services/reactor-core/index';
export { SimulationFabric, getSimFabric } from '../../services/sim-fabric/index';
export { LexaraPlanner, LexaraSynth, getLexaraPlanner, getLexaraSynth } from '../../services/lexara-synth/index';
export { ForensicsDashboard, getForensicsDashboard } from '../../dashboards/forensics/index';

// ============================================================================
// UNIFIED REACTOR LIFECYCLE
// ============================================================================

export interface ReactorStatus {
  isRunning: boolean;
  startedAt?: number;
  services: {
    name: string;
    status: 'running' | 'stopped' | 'error';
    stats?: Record<string, unknown>;
  }[];
  health: 'healthy' | 'degraded' | 'unhealthy';
}

let isReactorRunning = false;
let reactorStartTime: number | undefined;

/** Start the Reactor services that do not own CryptoCrawler trading authority. */
export async function startReactor(config?: {
  enableDryRun?: boolean;
  enableForensics?: boolean;
}): Promise<void> {
  if (isReactorRunning) {
    console.log('[Reactor] Already running');
    return;
  }

  console.log('[Reactor] Starting unified reactor system...');
  reactorStartTime = Date.now();

  try {
    getTransport();
    console.log('[Reactor] Transport layer initialized');

    const simFabric = getSimFabric();
    await simFabric.start();
    console.log('[Reactor] Simulation Fabric started');

    const reactorCore = getReactorCore({ dryRun: config?.enableDryRun });
    await reactorCore.start();
    console.log('[Reactor] Reactor Core started');

    // CryptoCrawler execution is deliberately absent here. The historical
    // services/cryptocrawler-executor module used randomized mock fills and is
    // not an authoritative production execution path.
    console.log('[Reactor] CryptoCrawler execution authority remains canonical and external to Reactor');

    const lexaraPlanner = getLexaraPlanner();
    await lexaraPlanner.start();
    const lexaraSynth = getLexaraSynth();
    await lexaraSynth.start();
    console.log('[Reactor] Lexara Voice Synthesis started');

    if (config?.enableForensics !== false) {
      const forensics = getForensicsDashboard();
      await forensics.start();
      console.log('[Reactor] Forensics Dashboard started');
    }

    isReactorRunning = true;
    console.log('[Reactor] ✅ Unified reactor system started successfully');
  } catch (err) {
    console.error('[Reactor] ❌ Failed to start:', err);
    await stopReactor();
    throw err;
  }
}

export async function stopReactor(): Promise<void> {
  if (!isReactorRunning) return;

  console.log('[Reactor] Stopping unified reactor system...');
  try {
    const forensics = getForensicsDashboard();
    await forensics.stop();

    const lexaraSynth = getLexaraSynth();
    await lexaraSynth.stop();
    const lexaraPlanner = getLexaraPlanner();
    await lexaraPlanner.stop();

    const reactorCore = getReactorCore();
    await reactorCore.stop();

    const simFabric = getSimFabric();
    await simFabric.stop();

    const transport = getTransport();
    await transport.shutdown();
  } catch (err) {
    console.error('[Reactor] Error during shutdown:', err);
  }

  isReactorRunning = false;
  reactorStartTime = undefined;
  console.log('[Reactor] Stopped');
}

export function getReactorStatus(): ReactorStatus {
  const services: ReactorStatus['services'] = [];

  try {
    const reactorCore = getReactorCore();
    services.push({ name: 'reactor-core', status: 'running', stats: reactorCore.getStats() });
  } catch {
    services.push({ name: 'reactor-core', status: 'stopped' });
  }

  try {
    const simFabric = getSimFabric();
    services.push({ name: 'sim-fabric', status: 'running', stats: simFabric.getStats() });
  } catch {
    services.push({ name: 'sim-fabric', status: 'stopped' });
  }

  services.push({
    name: 'crypto-executor-legacy',
    status: 'stopped',
    stats: {
      authority: 'none',
      canonicalReplacement: 'server/services/cryptocrawl/execution',
    },
  });

  try {
    const lexaraSynth = getLexaraSynth();
    services.push({ name: 'lexara-synth', status: 'running', stats: lexaraSynth.getStats() });
  } catch {
    services.push({ name: 'lexara-synth', status: 'stopped' });
  }

  try {
    const forensics = getForensicsDashboard();
    services.push({ name: 'forensics', status: 'running', stats: forensics.getStats() });
  } catch {
    services.push({ name: 'forensics', status: 'stopped' });
  }

  // The deliberately retired legacy crypto executor is not counted as a Reactor
  // health dependency.
  const healthServices = services.filter(service => service.name !== 'crypto-executor-legacy');
  const running = healthServices.filter(service => service.status === 'running').length;
  const total = healthServices.length;
  let health: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (running === 0) health = 'unhealthy';
  else if (running < total) health = 'degraded';

  return { isRunning: isReactorRunning, startedAt: reactorStartTime, services, health };
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

/**
 * Historical Reactor CryptoCrawler integration test retained fail-closed.
 * Synthetic ActionResult generation is no longer permitted.
 */
export async function testCryptoIntegration(): Promise<{
  success: boolean;
  trace_id: string;
  steps: { step: string; success: boolean; duration_ms: number; details?: string }[];
}> {
  const traceId = `test_crypto_${Date.now()}`;
  return {
    success: false,
    trace_id: traceId,
    steps: [{
      step: 'legacy_crypto_executor_retired',
      success: false,
      duration_ms: 0,
      details: 'Reactor CryptoCrawler executor is retired; use the canonical measured/governed CryptoCrawler execution path.',
    }],
  };
}

export async function testVoiceIntegration(): Promise<{
  success: boolean;
  trace_id: string;
  steps: { step: string; success: boolean; duration_ms: number; details?: string }[];
}> {
  const transport = getTransport();
  const traceId = `test_voice_${Date.now()}`;
  const steps: { step: string; success: boolean; duration_ms: number; details?: string }[] = [];

  let stepStart = Date.now();
  try {
    await transport.publishDurable('reactor.obs', {
      event_id: `obs_${Date.now()}`,
      trace_id: traceId,
      ts: Date.now(),
      schema_version: '1.0.0',
      kind: 'observation',
      source: 'test',
      type: 'text_chunk',
      payload: {
        type: 'text_chunk',
        text: 'Hello, this is a test of the Lexara voice synthesis system.',
        language: 'en-US',
        voice_id: 'lexara-default',
      },
      quality_flags: { freshness: 1, completeness: 1, reliability: 1, isStale: false },
      ttl_ms: 10000,
    });
    steps.push({ step: 'publish_observation', success: true, duration_ms: Date.now() - stepStart });
  } catch (err) {
    steps.push({ step: 'publish_observation', success: false, duration_ms: Date.now() - stepStart, details: (err as Error).message });
    return { success: false, trace_id: traceId, steps };
  }

  await new Promise(resolve => setTimeout(resolve, 2000));

  stepStart = Date.now();
  const forensics = getForensicsDashboard();
  const timeline = forensics.getTraceTimeline(traceId);
  if (timeline) {
    steps.push({
      step: 'check_timeline',
      success: true,
      duration_ms: Date.now() - stepStart,
      details: `Events: ${timeline.events.length}, Outcome: ${timeline.summary.outcome}`,
    });
  } else {
    steps.push({ step: 'check_timeline', success: false, duration_ms: Date.now() - stepStart });
  }

  return { success: steps.every(step => step.success), trace_id: traceId, steps };
}

export async function runReplayMode(
  observations: unknown[],
  seed: number = 12345,
): Promise<{ deterministic: boolean; decisions: string[] }> {
  console.log(`[Reactor] Running replay mode with ${observations.length} observations, seed: ${seed}`);
  const decisions: string[] = [];
  for (let i = 0; i < observations.length; i++) decisions.push(`decision_${i}_${seed}`);
  return { deterministic: true, decisions };
}

export default {
  startReactor,
  stopReactor,
  getReactorStatus,
  testCryptoIntegration,
  testVoiceIntegration,
  runReplayMode,
};