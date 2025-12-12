/**
 * Lexara Core Power System
 * 
 * The power architecture that sits under Lexara and makes her fast,
 * dependable, and capable of scaling when the rest of the system grows.
 * 
 * Boot Sequence (ORDER MATTERS):
 * Initialize PowerSpine → PowerReactor → PowerMesh → Heartline → LexaraCore
 * 
 * Components:
 * 1. PowerSpine - Primary Compute Orchestrator
 * 2. PowerReactor - Enhanced Computational Reactor  
 * 3. PowerMesh - Neural Fusion Router
 * 4. Heartline - Identity, Memory & Stability Core
 */

// Export PowerSpine
export {
  powerSpine,
  initializePowerSpine,
  requestCompute,
  releaseCompute,
  ensureStability,
  reportHealth,
  activateBurstMode,
  getQueueStatus,
  shutdownPowerSpine,
  powerSpineEvents,
  type TaskPriority,
  type ComputeTask,
  type SpineHealth,
  type ThrottleLevel,
  type SpineConfig
} from './PowerSpine';

// Export PowerReactor
export {
  powerReactor,
  initializePowerReactor,
  amplify,
  refine,
  boostIfNeeded,
  queueForBackgroundRefinement,
  getReactorStats,
  shutdownPowerReactor,
  reactorEvents,
  type TaskContext,
  type AmplificationResult,
  type RefinementResult,
  type ReactorStats,
  type ReactorConfig,
  type PowerLevel
} from './Reactor';

// Export PowerMesh
export {
  powerMesh,
  initializePowerMesh,
  fuseRequest,
  getPowerMeshHealth,
  getConnectorStatuses,
  setConnectorStatus,
  shutdownPowerMesh,
  powerMeshEvents,
  type ModelProvider,
  type ModelConnector,
  type FusionRequest,
  type FusionStrategy,
  type FusionResult,
  type PowerMeshHealth,
  type PowerMeshConfig
} from './PowerMesh';

// Export Heartline
export {
  heartline,
  initializeHeartline,
  defineIdentity,
  getIdentity,
  isOwner,
  maintainContinuity,
  recordTask,
  updateTaskProgress,
  pauseTask,
  resumeTask,
  completeTask,
  stabilizeEmotion,
  getEmotionalState,
  governReasoning,
  getHeartlineStatus,
  shutdownHeartline,
  heartlineEvents,
  type LexaraIdentity,
  type PersonalityTraits,
  type OwnerProfile,
  type TaskMemory,
  type TaskCheckpoint,
  type EmotionalState,
  type EmotionType,
  type ReasoningCheck,
  type HeartlineStatus,
  type HeartlineConfig
} from './Heartline';

// ============================================================================
// POWER SYSTEM INITIALIZATION
// ============================================================================

export interface PowerSystemStatus {
  initialized: boolean;
  spineStatus: 'online' | 'offline' | 'error';
  reactorStatus: 'online' | 'offline' | 'error';
  meshStatus: 'online' | 'offline' | 'error';
  heartlineStatus: 'online' | 'offline' | 'error';
  bootTime: Date | null;
  uptime: number;
}

let powerSystemStatus: PowerSystemStatus = {
  initialized: false,
  spineStatus: 'offline',
  reactorStatus: 'offline',
  meshStatus: 'offline',
  heartlineStatus: 'offline',
  bootTime: null,
  uptime: 0
};

/**
 * Initialize the complete Lexara Core Power System
 * 
 * Boot Sequence (ORDER MATTERS):
 * 1. PowerSpine - Must be first to manage compute resources
 * 2. PowerReactor - Needs spine for resource allocation
 * 3. PowerMesh - Needs reactor for amplification
 * 4. Heartline - Needs all systems for personality stabilization
 */
export async function initializeLexaraPowerSystem(): Promise<PowerSystemStatus> {
  console.log('[PowerSystem] ============================================');
  console.log('[PowerSystem] INITIALIZING LEXARA CORE POWER SYSTEM');
  console.log('[PowerSystem] ============================================');

  const bootStart = Date.now();
  
  try {
    // Step 1: Initialize PowerSpine
    console.log('[PowerSystem] Step 1/4: Initializing PowerSpine...');
    const { initializePowerSpine } = await import('./PowerSpine');
    await initializePowerSpine();
    powerSystemStatus.spineStatus = 'online';
    console.log('[PowerSystem] ✓ PowerSpine online');

    // Step 2: Initialize PowerReactor
    console.log('[PowerSystem] Step 2/4: Initializing PowerReactor...');
    const { initializePowerReactor } = await import('./Reactor');
    await initializePowerReactor();
    powerSystemStatus.reactorStatus = 'online';
    console.log('[PowerSystem] ✓ PowerReactor online');

    // Step 3: Initialize PowerMesh
    console.log('[PowerSystem] Step 3/4: Initializing PowerMesh...');
    const { initializePowerMesh } = await import('./PowerMesh');
    await initializePowerMesh();
    powerSystemStatus.meshStatus = 'online';
    console.log('[PowerSystem] ✓ PowerMesh online');

    // Step 4: Initialize Heartline
    console.log('[PowerSystem] Step 4/4: Initializing Heartline...');
    const { initializeHeartline } = await import('./Heartline');
    await initializeHeartline();
    powerSystemStatus.heartlineStatus = 'online';
    console.log('[PowerSystem] ✓ Heartline online');

    // Mark system as initialized
    powerSystemStatus.initialized = true;
    powerSystemStatus.bootTime = new Date();
    
    const bootDuration = Date.now() - bootStart;
    console.log('[PowerSystem] ============================================');
    console.log(`[PowerSystem] LEXARA POWER SYSTEM INITIALIZED (${bootDuration}ms)`);
    console.log('[PowerSystem] ============================================');

    return { ...powerSystemStatus };

  } catch (error: any) {
    console.error('[PowerSystem] ❌ Power system initialization failed:', error.message);
    powerSystemStatus.initialized = false;
    throw error;
  }
}

/**
 * Shutdown the complete Lexara Core Power System
 * Shutdown in reverse order of initialization
 */
export async function shutdownLexaraPowerSystem(): Promise<void> {
  console.log('[PowerSystem] ============================================');
  console.log('[PowerSystem] SHUTTING DOWN LEXARA CORE POWER SYSTEM');
  console.log('[PowerSystem] ============================================');

  try {
    // Shutdown in reverse order

    // Step 1: Shutdown Heartline first (most dependent)
    console.log('[PowerSystem] Step 1/4: Shutting down Heartline...');
    const { shutdownHeartline } = await import('./Heartline');
    await shutdownHeartline();
    powerSystemStatus.heartlineStatus = 'offline';
    console.log('[PowerSystem] ✓ Heartline offline');

    // Step 2: Shutdown PowerMesh
    console.log('[PowerSystem] Step 2/4: Shutting down PowerMesh...');
    const { shutdownPowerMesh } = await import('./PowerMesh');
    await shutdownPowerMesh();
    powerSystemStatus.meshStatus = 'offline';
    console.log('[PowerSystem] ✓ PowerMesh offline');

    // Step 3: Shutdown PowerReactor
    console.log('[PowerSystem] Step 3/4: Shutting down PowerReactor...');
    const { shutdownPowerReactor } = await import('./Reactor');
    await shutdownPowerReactor();
    powerSystemStatus.reactorStatus = 'offline';
    console.log('[PowerSystem] ✓ PowerReactor offline');

    // Step 4: Shutdown PowerSpine last (base system)
    console.log('[PowerSystem] Step 4/4: Shutting down PowerSpine...');
    const { shutdownPowerSpine } = await import('./PowerSpine');
    await shutdownPowerSpine();
    powerSystemStatus.spineStatus = 'offline';
    console.log('[PowerSystem] ✓ PowerSpine offline');

    powerSystemStatus.initialized = false;
    
    console.log('[PowerSystem] ============================================');
    console.log('[PowerSystem] LEXARA POWER SYSTEM SHUTDOWN COMPLETE');
    console.log('[PowerSystem] ============================================');

  } catch (error: any) {
    console.error('[PowerSystem] ❌ Power system shutdown error:', error.message);
    throw error;
  }
}

/**
 * Get current power system status
 */
export function getPowerSystemStatus(): PowerSystemStatus {
  if (powerSystemStatus.bootTime) {
    powerSystemStatus.uptime = Date.now() - powerSystemStatus.bootTime.getTime();
  }
  return { ...powerSystemStatus };
}

/**
 * Get comprehensive health report from all power system components
 */
export async function getPowerSystemHealth(): Promise<{
  overall: 'healthy' | 'degraded' | 'critical';
  spine: ReturnType<typeof import('./PowerSpine').reportHealth> | null;
  reactor: ReturnType<typeof import('./Reactor').getReactorStats> | null;
  mesh: ReturnType<typeof import('./PowerMesh').getPowerMeshHealth> | null;
  heartline: ReturnType<typeof import('./Heartline').getHeartlineStatus> | null;
}> {
  let spine = null;
  let reactor = null;
  let mesh = null;
  let heartline = null;

  try {
    const { reportHealth } = await import('./PowerSpine');
    spine = reportHealth();
  } catch { /* Component not ready */ }

  try {
    const { getReactorStats } = await import('./Reactor');
    reactor = getReactorStats();
  } catch { /* Component not ready */ }

  try {
    const { getPowerMeshHealth } = await import('./PowerMesh');
    mesh = getPowerMeshHealth();
  } catch { /* Component not ready */ }

  try {
    const { getHeartlineStatus } = await import('./Heartline');
    heartline = getHeartlineStatus();
  } catch { /* Component not ready */ }

  // Determine overall health
  let overall: 'healthy' | 'degraded' | 'critical' = 'healthy';
  
  const status = getPowerSystemStatus();
  const offlineCount = [
    status.spineStatus,
    status.reactorStatus,
    status.meshStatus,
    status.heartlineStatus
  ].filter(s => s !== 'online').length;

  if (offlineCount >= 3) {
    overall = 'critical';
  } else if (offlineCount >= 1) {
    overall = 'degraded';
  }

  return { overall, spine, reactor, mesh, heartline };
}

// Default export
export default {
  initializeLexaraPowerSystem,
  shutdownLexaraPowerSystem,
  getPowerSystemStatus,
  getPowerSystemHealth
};
