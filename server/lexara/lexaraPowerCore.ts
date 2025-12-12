/**
 * Lexara Power Core - Reactor Integration Module
 * 
 * This module provides Lexara's power management by wrapping the central
 * Computational Reactor (OPIF). Instead of implementing separate power logic,
 * Lexara sits on the reactor throne and leverages its job scheduling,
 * heat monitoring, and resource management capabilities.
 * 
 * Key Functions:
 * - ensureLexaraReactorInitialized(): One-time reactor initialization
 * - scheduleLexaraJob(): Submit Lexara tasks to the reactor
 * - getLexaraPowerState(): Get compact power/status for UI
 */

import {
  initializeReactor,
  submitJob,
  getReactorStatus,
  getHeatMonitor,
  reactorEvents,
  type ReactorJob,
  type HeatMonitor
} from '../reactor';

// ============================================================================
// STATE
// ============================================================================

let reactorInitialized = false;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Lexara job types that map to reactor job types
 */
export type LexaraJobType = 
  | 'legal_analysis'
  | 'people_radar'
  | 'satellite_pipeline'
  | 'multi_step_reasoning'
  | 'document_generation'
  | 'voice_processing';

/**
 * Compact power state for Lexara UI
 */
export interface LexaraPowerState {
  online: boolean;
  heat: HeatMonitor;
  queuedJobs: number;
  activeJobs: number;
  throttleLevel: 'none' | 'light' | 'moderate' | 'heavy';
  reactorHealth: 'healthy' | 'degraded' | 'critical';
}

/**
 * Options for scheduling a Lexara job
 */
export interface LexaraJobOptions {
  priority?: number;       // 1-10, default 5
  maxRetries?: number;     // default 3
  scheduledAt?: Date;      // default now
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Ensure the reactor is initialized for Lexara operations.
 * Safe to call multiple times - only initializes once.
 */
export async function ensureLexaraReactorInitialized(): Promise<void> {
  if (reactorInitialized) {
    return;
  }

  console.log('[LexaraPower] Initializing reactor for Lexara...');
  
  await initializeReactor({
    enabled: true,
    maxConcurrentJobs: 5,  // Lexara can handle moderate concurrency
    maxJobsPerHour: 200,   // Higher limit for active usage
  });

  reactorInitialized = true;
  console.log('[LexaraPower] Reactor initialized - Lexara is seated on the throne');
}

/**
 * Map Lexara job types to reactor job types
 */
function mapLexaraJobType(lexaraType: LexaraJobType): ReactorJob['type'] {
  const mapping: Record<LexaraJobType, ReactorJob['type']> = {
    'legal_analysis': 'batch_inference',
    'people_radar': 'osint_sweep',
    'satellite_pipeline': 'heatmap_update',
    'multi_step_reasoning': 'batch_inference',
    'document_generation': 'batch_inference',
    'voice_processing': 'batch_inference',
  };
  return mapping[lexaraType];
}

/**
 * Schedule a Lexara job through the reactor.
 * Thin wrapper around submitJob with sensible defaults for Lexara tasks.
 * 
 * @param type - The Lexara job type
 * @param payload - Job-specific data
 * @param options - Optional scheduling parameters
 * @returns Job ID for tracking
 */
export async function scheduleLexaraJob(
  type: LexaraJobType,
  payload: Record<string, unknown>,
  options: LexaraJobOptions = {}
): Promise<string> {
  // Ensure reactor is ready
  await ensureLexaraReactorInitialized();

  const reactorType = mapLexaraJobType(type);
  const priority = options.priority ?? 5;

  // Add Lexara metadata to payload
  const enrichedPayload = {
    ...payload,
    _lexaraJob: true,
    _lexaraType: type,
    _submittedAt: Date.now(),
  };

  console.log(`[LexaraPower] Scheduling job: ${type} (reactor type: ${reactorType}, priority: ${priority})`);

  const jobId = await submitJob(reactorType, enrichedPayload, priority);

  return jobId;
}

/**
 * Get Lexara's current power state from the reactor.
 * Returns a compact status object suitable for UI display.
 */
export function getLexaraPowerState(): LexaraPowerState {
  const status = getReactorStatus();
  const heat = getHeatMonitor();

  // Determine reactor health based on throttle level
  let reactorHealth: LexaraPowerState['reactorHealth'] = 'healthy';
  if (heat.throttleLevel === 'heavy') {
    reactorHealth = 'critical';
  } else if (heat.throttleLevel === 'moderate' || heat.throttleLevel === 'light') {
    reactorHealth = 'degraded';
  }

  return {
    online: status.enabled && reactorInitialized,
    heat,
    queuedJobs: heat.jobQueueSize,
    activeJobs: heat.activeJobs,
    throttleLevel: heat.throttleLevel,
    reactorHealth,
  };
}

/**
 * Check if Lexara's reactor is operational
 */
export function isLexaraOperational(): boolean {
  if (!reactorInitialized) {
    return false;
  }
  const state = getLexaraPowerState();
  return state.online && state.reactorHealth !== 'critical';
}

/**
 * Get the reactor events emitter for subscribing to reactor events
 */
export function getLexaraReactorEvents() {
  return reactorEvents;
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
  ensureLexaraReactorInitialized,
  scheduleLexaraJob,
  getLexaraPowerState,
  isLexaraOperational,
  getLexaraReactorEvents,
};
