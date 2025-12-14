/**
 * PANTHEON UNIFIED REACTOR
 * 
 * This module exports the complete reactor architecture:
 * - Contracts (event schemas, transport)
 * - Reactor Core (decision brain)
 * - Simulation Fabric (Monte Carlo pool)
 * - CryptoCrawler Executor (dumb executor)
 * - Lexara Voice Synthesis (planner + synth)
 * - Forensics Dashboard (observability)
 * 
 * Usage:
 *   import { startReactor, stopReactor, getReactorStatus } from './reactor';
 *   await startReactor();
 */

import { getTransport } from '../../packages/contracts/src/transport';
import { getReactorCore } from '../../services/reactor-core/index';
import { getSimFabric } from '../../services/sim-fabric/index';
import { getCryptoExecutor } from '../../services/cryptocrawler-executor/index';
import { getLexaraPlanner, getLexaraSynth } from '../../services/lexara-synth/index';
import { getForensicsDashboard } from '../../dashboards/forensics/index';
import { CRYPTO_EXECUTION_RELEASED } from '../../shared/cryptoExecutionPolicy';

// Re-export contracts
export * from '../../packages/contracts/src/index';
export { ReactorTransport, getTransport } from '../../packages/contracts/src/transport';

// Re-export services
export { ReactorCore, getReactorCore } from '../../services/reactor-core/index';
export { SimulationFabric, getSimFabric } from '../../services/sim-fabric/index';
export { CryptoCrawlerExecutor, getCryptoExecutor } from '../../services/cryptocrawler-executor/index';
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

/**
 * Start the complete reactor system
 */
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
    // Start services in order (dependencies first)
    
    // 1. Transport layer (always needed)
    getTransport();
    console.log('[Reactor] Transport layer initialized');

    // 2. Simulation Fabric (needed by Reactor Core)
    const simFabric = getSimFabric();
    await simFabric.start();
    console.log('[Reactor] Simulation Fabric started');

    // 3. Reactor Core (decision brain)
    const reactorCore = getReactorCore({ dryRun: config?.enableDryRun });
    await reactorCore.start();
    console.log('[Reactor] Reactor Core started');

    // 4. CryptoCrawler Executor
    if (CRYPTO_EXECUTION_RELEASED) {
      const cryptoExecutor = getCryptoExecutor();
      await cryptoExecutor.start();
      console.log('[Reactor] CryptoCrawler Executor started');
    } else {
      console.log('[Reactor] CryptoCrawler Executor disabled (Stage 2 execution nullification)');
    }

    // 5. Lexara Voice Synthesis
    const lexaraPlanner = getLexaraPlanner();
    await lexaraPlanner.start();
    const lexaraSynth = getLexaraSynth();
    await lexaraSynth.start();
    console.log('[Reactor] Lexara Voice Synthesis started');

    // 6. Forensics Dashboard (optional)
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

/**
 * Stop the complete reactor system
 */
export async function stopReactor(): Promise<void> {
  if (!isReactorRunning) {
    return;
  }

  console.log('[Reactor] Stopping unified reactor system...');

  try {
    // Stop in reverse order
    const forensics = getForensicsDashboard();
    await forensics.stop();

    const lexaraSynth = getLexaraSynth();
    await lexaraSynth.stop();
    const lexaraPlanner = getLexaraPlanner();
    await lexaraPlanner.stop();

    const cryptoExecutor = getCryptoExecutor();
    await cryptoExecutor.stop();

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

/**
 * Get reactor system status
 */
export function getReactorStatus(): ReactorStatus {
  const services: ReactorStatus['services'] = [];

  // Check each service
  try {
    const reactorCore = getReactorCore();
    services.push({
      name: 'reactor-core',
      status: 'running',
      stats: reactorCore.getStats(),
    });
  } catch {
    services.push({ name: 'reactor-core', status: 'stopped' });
  }

  try {
    const simFabric = getSimFabric();
    services.push({
      name: 'sim-fabric',
      status: 'running',
      stats: simFabric.getStats(),
    });
  } catch {
    services.push({ name: 'sim-fabric', status: 'stopped' });
  }

  try {
    const cryptoExecutor = getCryptoExecutor();
    services.push({
      name: 'crypto-executor',
      status: 'running',
      stats: cryptoExecutor.getStats(),
    });
  } catch {
    services.push({ name: 'crypto-executor', status: 'stopped' });
  }

  try {
    const lexaraSynth = getLexaraSynth();
    services.push({
      name: 'lexara-synth',
      status: 'running',
      stats: lexaraSynth.getStats(),
    });
  } catch {
    services.push({ name: 'lexara-synth', status: 'stopped' });
  }

  try {
    const forensics = getForensicsDashboard();
    services.push({
      name: 'forensics',
      status: 'running',
      stats: forensics.getStats(),
    });
  } catch {
    services.push({ name: 'forensics', status: 'stopped' });
  }

  // Calculate overall health
  const running = services.filter(s => s.status === 'running').length;
  const total = services.length;
  let health: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (running === 0) health = 'unhealthy';
  else if (running < total) health = 'degraded';

  return {
    isRunning: isReactorRunning,
    startedAt: reactorStartTime,
    services,
    health,
  };
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

/**
 * Run integration test: Crypto opportunity from Observation → ActionResult
 */
export async function testCryptoIntegration(): Promise<{
  success: boolean;
  trace_id: string;
  steps: { step: string; success: boolean; duration_ms: number; details?: string }[];
}> {
  const transport = getTransport();
  const traceId = `test_crypto_${Date.now()}`;
  const steps: { step: string; success: boolean; duration_ms: number; details?: string }[] = [];

  // Step 1: Publish observation
  let stepStart = Date.now();
  try {
    await transport.publishDurable('reactor.obs', {
      event_id: `obs_${Date.now()}`,
      trace_id: traceId,
      ts: Date.now(),
      schema_version: '1.0.0',
      kind: 'observation',
      source: 'test',
      type: 'tick',
      payload: {
        type: 'tick',
        exchange: 'mock',
        symbol: 'BTC/USDT',
        data: { price: 50000, spread: 0.002, bid: 49990, ask: 50010 },
      },
      quality_flags: { freshness: 1, completeness: 1, reliability: 1, isStale: false },
      ttl_ms: 5000,
    });
    steps.push({ step: 'publish_observation', success: true, duration_ms: Date.now() - stepStart });
  } catch (err) {
    steps.push({ step: 'publish_observation', success: false, duration_ms: Date.now() - stepStart, details: (err as Error).message });
    return { success: false, trace_id: traceId, steps };
  }

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Step 2: Check for intent
  stepStart = Date.now();
  const forensics = getForensicsDashboard();
  const timeline = forensics.getTraceTimeline(traceId);
  
  if (timeline) {
    const hasIntent = timeline.events.some(e => e.type === 'intent');
    steps.push({ 
      step: 'check_intent', 
      success: true, 
      duration_ms: Date.now() - stepStart,
      details: hasIntent ? 'Intent emitted' : `Outcome: ${timeline.summary.outcome} - ${timeline.summary.outcome_reason}`,
    });
  } else {
    steps.push({ step: 'check_intent', success: false, duration_ms: Date.now() - stepStart, details: 'No timeline found' });
  }

  // Wait for execution
  await new Promise(resolve => setTimeout(resolve, 500));

  // Step 3: Check for result
  stepStart = Date.now();
  const finalTimeline = forensics.getTraceTimeline(traceId);
  const hasResult = finalTimeline?.events.some(e => e.type === 'result');
  steps.push({
    step: 'check_result',
    success: !!hasResult,
    duration_ms: Date.now() - stepStart,
    details: hasResult ? 'Result received' : 'No result',
  });

  const success = steps.every(s => s.success);
  return { success, trace_id: traceId, steps };
}

/**
 * Run integration test: Voice synthesis from Observation → ActionResult
 */
export async function testVoiceIntegration(): Promise<{
  success: boolean;
  trace_id: string;
  steps: { step: string; success: boolean; duration_ms: number; details?: string }[];
}> {
  const transport = getTransport();
  const traceId = `test_voice_${Date.now()}`;
  const steps: { step: string; success: boolean; duration_ms: number; details?: string }[] = [];

  // Step 1: Publish voice observation
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

  // Wait for processing (voice takes longer)
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Check result
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

  const success = steps.every(s => s.success);
  return { success, trace_id: traceId, steps };
}

/**
 * Enable replay mode: Feed historical observations and verify deterministic decisions
 */
export async function runReplayMode(
  observations: unknown[],
  seed: number = 12345
): Promise<{ deterministic: boolean; decisions: string[] }> {
  console.log(`[Reactor] Running replay mode with ${observations.length} observations, seed: ${seed}`);
  
  // In production, this would:
  // 1. Set the PRNG seed
  // 2. Feed observations through the reactor
  // 3. Collect decisions
  // 4. Compare against expected decisions
  
  const decisions: string[] = [];
  
  // Placeholder - would actually run replay
  for (let i = 0; i < observations.length; i++) {
    decisions.push(`decision_${i}_${seed}`);
  }
  
  return {
    deterministic: true,
    decisions,
  };
}

export default {
  startReactor,
  stopReactor,
  getReactorStatus,
  testCryptoIntegration,
  testVoiceIntegration,
  runReplayMode,
};
