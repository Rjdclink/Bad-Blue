/**
 * Routing Module - Index
 * 
 * Exports the Routing Engine for intelligent model selection
 */

export {
  routingEngine,
  initializeRoutingEngine,
  routeRequest,
  executeWithFallback,
  getModelStatuses,
  shutdownRoutingEngine,
  routingEvents,
  type ModelConfig,
  type RouteConfig,
  type RoutingDecision,
  type RoutingStrategy,
  type HealthCheckResult
} from './routingEngine';

import routingEngineDefault from './routingEngine';
export default routingEngineDefault;
