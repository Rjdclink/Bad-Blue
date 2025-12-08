/**
 * IP-HYDRA Main Entry Point
 * Export all components for integration with the existing system
 */

// Core components
export { ShadowPool } from './shadow-swarm/pool';
export { PriorityTaskManager } from './shadow-swarm/priority-manager';

// Brain components
export { PredictiveSelector } from './brain/predictive-selector';
export { CooldownController } from './brain/cooldown-controller';

// Integration
export { IPHydraOrchestrator, ipHydraOrchestrator } from './integration/orchestrator';
export type { EnhancedLuxSignal } from './integration/orchestrator';

// API
export { default as hydraApiRoutes } from './api/routes';

// Utils
export { EventLogger } from './utils/event-logger';

// Types
export * from './types';
