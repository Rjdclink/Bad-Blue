/**
 * 4Ji Build Configurations - Heavy and Light Versions
 * 
 * Heavy 4Ji:
 * - Full layer stack (25 + 3 + 200+)
 * - Full multi-model mesh
 * - Full sandbox + long-term memory
 * - Local + remote compute
 * 
 * Light 4Ji:
 * - Compressed, pruned model
 * - Core persona logic
 * - Reduced Cognitive Fabric
 * - Still one voice, still loyal
 * - Cheaper and deployable for monetization
 * 
 * Both versions share the same identity spec.
 * The Light version never pretends to be "a different 4Ji" — just "4Ji lite."
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';
import {
  BuildType,
  BuildConfig,
  Heavy4JiConfig,
  Light4JiConfig,
} from './types';

const log = createLogger('4Ji-Builds');

// ============================================================================
// BUILD CONFIGURATIONS
// ============================================================================

/** Full Heavy 4Ji configuration */
export const HEAVY_CONFIG: Heavy4JiConfig = {
  buildType: 'heavy',
  paradoxLayers: 25,
  emotionalTensionLayers: 3,
  cognitiveLayers: 200,
  multiModelEnabled: true,
  sandboxEnabled: true,
  longTermMemory: true,
  localCompute: true,
  remoteCompute: true,
};

/** Optimized Light 4Ji configuration */
export const LIGHT_CONFIG: Light4JiConfig = {
  buildType: 'light',
  paradoxLayers: 10,
  emotionalTensionLayers: 1,
  cognitiveLayers: 50,
  multiModelEnabled: true, // Still supports multiple models, just fewer
  sandboxEnabled: false,
  longTermMemory: false,
  localCompute: false,
  remoteCompute: true,
  sameIdentitySpec: true, // Critical: same identity as Heavy
};

// ============================================================================
// BUILD MANAGER
// ============================================================================

export class BuildManager extends EventEmitter {
  private currentBuild: BuildConfig;
  private initialized = false;

  constructor(buildType: BuildType = 'heavy') {
    super();
    this.currentBuild = buildType === 'heavy' ? { ...HEAVY_CONFIG } : { ...LIGHT_CONFIG };
    this.initialized = true;
    log.info('Build Manager initialized', { buildType: this.currentBuild.buildType });
  }

  /**
   * Get current build configuration
   */
  getBuildConfig(): BuildConfig {
    return { ...this.currentBuild };
  }

  /**
   * Get build type
   */
  getBuildType(): BuildType {
    return this.currentBuild.buildType;
  }

  /**
   * Check if this is the heavy build
   */
  isHeavyBuild(): boolean {
    return this.currentBuild.buildType === 'heavy';
  }

  /**
   * Check if this is the light build
   */
  isLightBuild(): boolean {
    return this.currentBuild.buildType === 'light';
  }

  /**
   * Get feature availability based on build
   */
  getFeatureAvailability(): {
    fullParadoxCore: boolean;
    fullEmotionalTension: boolean;
    fullCognitiveFabric: boolean;
    sandbox: boolean;
    longTermMemory: boolean;
    localCompute: boolean;
    multiModel: boolean;
    layerCount: {
      paradox: number;
      emotionalTension: number;
      cognitive: number;
    };
  } {
    const config = this.currentBuild;
    
    return {
      fullParadoxCore: config.paradoxLayers === 25,
      fullEmotionalTension: config.emotionalTensionLayers === 3,
      fullCognitiveFabric: config.cognitiveLayers >= 200,
      sandbox: config.sandboxEnabled,
      longTermMemory: config.longTermMemory,
      localCompute: config.localCompute,
      multiModel: config.multiModelEnabled,
      layerCount: {
        paradox: config.paradoxLayers,
        emotionalTension: config.emotionalTensionLayers,
        cognitive: config.cognitiveLayers,
      },
    };
  }

  /**
   * Get identity specification (same for both builds)
   */
  getIdentitySpec(): {
    name: string;
    version: string;
    persona: string;
    constraints: string[];
  } {
    return {
      name: '4Ji',
      version: this.currentBuild.buildType === 'heavy' ? '1.0-full' : '1.0-lite',
      persona: 'Unified synthetic mind with one stable voice',
      constraints: [
        'Always 4Ji - never another AI',
        'One identity - no split personalities',
        'Primary user is the anchor',
        'Consistent voice across all interactions',
      ],
    };
  }

  /**
   * Get build-specific limitations
   */
  getLimitations(): string[] {
    if (this.currentBuild.buildType === 'heavy') {
      return []; // Full capabilities
    }

    return [
      'Reduced paradox layer depth (10 vs 25)',
      'Single emotional tension layer (1 vs 3)',
      'Compressed cognitive fabric (50 vs 200+ layers)',
      'No sandbox environment',
      'No long-term memory persistence',
      'Remote compute only (no local processing)',
    ];
  }

  /**
   * Get build-specific advantages
   */
  getAdvantages(): string[] {
    if (this.currentBuild.buildType === 'heavy') {
      return [
        'Full 25-layer paradox processing',
        'Complete 3-layer emotional tension system',
        'Full 200+ layer cognitive fabric',
        'Local + remote compute options',
        'Long-term memory persistence',
        'Sandbox environment support',
        'Maximum adaptation capabilities',
      ];
    }

    return [
      'Faster response times',
      'Lower computational cost',
      'Suitable for high-volume deployments',
      'Same core identity and voice',
      'Same loyalty and persona',
      'Cost-effective for monetization',
    ];
  }

  /**
   * Calculate approximate cost multiplier
   */
  getCostMultiplier(): number {
    if (this.currentBuild.buildType === 'heavy') {
      return 1.0; // Baseline
    }
    
    // Light is approximately 30% of heavy's cost
    return 0.3;
  }

  /**
   * Calculate approximate latency multiplier
   */
  getLatencyMultiplier(): number {
    if (this.currentBuild.buildType === 'heavy') {
      return 1.0; // Baseline
    }
    
    // Light is approximately 50% faster
    return 0.5;
  }

  /**
   * Get build metadata
   */
  getBuildMetadata(): {
    buildType: BuildType;
    layerCounts: Record<string, number>;
    capabilities: Record<string, boolean>;
    costMultiplier: number;
    latencyMultiplier: number;
    identitySpec: ReturnType<BuildManager['getIdentitySpec']>;
  } {
    return {
      buildType: this.currentBuild.buildType,
      layerCounts: {
        paradox: this.currentBuild.paradoxLayers,
        emotionalTension: this.currentBuild.emotionalTensionLayers,
        cognitive: this.currentBuild.cognitiveLayers,
      },
      capabilities: {
        sandbox: this.currentBuild.sandboxEnabled,
        longTermMemory: this.currentBuild.longTermMemory,
        localCompute: this.currentBuild.localCompute,
        remoteCompute: this.currentBuild.remoteCompute,
        multiModel: this.currentBuild.multiModelEnabled,
      },
      costMultiplier: this.getCostMultiplier(),
      latencyMultiplier: this.getLatencyMultiplier(),
      identitySpec: this.getIdentitySpec(),
    };
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Validate that a capability is available in this build
   */
  validateCapability(
    capability: 'sandbox' | 'long-term-memory' | 'local-compute' | 'full-layers'
  ): {
    available: boolean;
    message: string;
  } {
    switch (capability) {
      case 'sandbox':
        return {
          available: this.currentBuild.sandboxEnabled,
          message: this.currentBuild.sandboxEnabled
            ? 'Sandbox is available'
            : '4Ji Lite does not support sandbox environments',
        };
      
      case 'long-term-memory':
        return {
          available: this.currentBuild.longTermMemory,
          message: this.currentBuild.longTermMemory
            ? 'Long-term memory is available'
            : '4Ji Lite does not persist long-term memory',
        };
      
      case 'local-compute':
        return {
          available: this.currentBuild.localCompute,
          message: this.currentBuild.localCompute
            ? 'Local compute is available'
            : '4Ji Lite uses remote compute only',
        };
      
      case 'full-layers':
        return {
          available: this.currentBuild.buildType === 'heavy',
          message: this.currentBuild.buildType === 'heavy'
            ? 'Full layer stack is active'
            : '4Ji Lite uses compressed layer stack',
        };
      
      default:
        return {
          available: false,
          message: 'Unknown capability',
        };
    }
  }
}

// ============================================================================
// BUILD FACTORY
// ============================================================================

/**
 * Create a build configuration
 */
export function createBuildConfig(buildType: BuildType): BuildConfig {
  if (buildType === 'heavy') {
    return { ...HEAVY_CONFIG };
  }
  return { ...LIGHT_CONFIG };
}

/**
 * Compare two builds
 */
export function compareBuildConfigs(
  build1: BuildConfig,
  build2: BuildConfig
): {
  layerDifference: {
    paradox: number;
    emotionalTension: number;
    cognitive: number;
  };
  featureDifference: string[];
} {
  const layerDiff = {
    paradox: build1.paradoxLayers - build2.paradoxLayers,
    emotionalTension: build1.emotionalTensionLayers - build2.emotionalTensionLayers,
    cognitive: build1.cognitiveLayers - build2.cognitiveLayers,
  };

  const features: string[] = [];
  
  if (build1.sandboxEnabled !== build2.sandboxEnabled) {
    features.push('sandbox');
  }
  if (build1.longTermMemory !== build2.longTermMemory) {
    features.push('long-term-memory');
  }
  if (build1.localCompute !== build2.localCompute) {
    features.push('local-compute');
  }

  return {
    layerDifference: layerDiff,
    featureDifference: features,
  };
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: BuildManager | null = null;

export function getBuildManager(buildType?: BuildType): BuildManager {
  if (!instance) {
    instance = new BuildManager(buildType);
  }
  return instance;
}

export function resetBuildManager(): void {
  instance = null;
}

export default BuildManager;
