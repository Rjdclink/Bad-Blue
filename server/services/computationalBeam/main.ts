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
