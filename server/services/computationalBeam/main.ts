/**
 * Computational Beam Architecture - Main Exports
 * 
 * Multi-Node, Multi-Provider, Distributed CPU-Amplification Architecture
 */

// Main orchestrator
export { 
  computationalBeam, 
  ComputationalBeamOrchestrator 
} from './index';

// Core types
export * from './types';

// Subsystems
export { 
  credentialValidator, 
  CredentialValidator 
} from './credentialValidator';

export { 
  omniAntennaLayer, 
  OmniAntennaLayer 
} from './omniAntennaLayer';

export { 
  directionalBeamLayer, 
  DirectionalBeamLayer 
} from './directionalBeamLayer';

export { 
  superBatteryLayer, 
  SuperBatteryLayer 
} from './superBatteryLayer';

export { 
  workloadRouter, 
  WorkloadRouter 
} from './workloadRouter';

export { 
  integrityTestingSystem, 
  IntegrityTestingSystem 
} from './integrityTesting';

// Advanced modules
export {
  neuralLoadPredictor,
  NeuralLoadPredictor
} from './neuralLoadPredictor';

export {
  metricsAnalytics,
  AdvancedMetricsAnalytics
} from './metricsAnalytics';

// Testing and validation
export { runIntegrationTest } from './test-integration';
export { demo } from './demo';
export { ComputationalBeamValidator } from './validate';
