/**
 * Reactor Routing - Index
 */

export {
  modelRouter,
  initializeModelRouter,
  routeRequest,
  routerEvents,
  type AIModel,
  type RoutingPolicy,
  type RouteRequest,
  type RouteResult
} from './model_router';

export {
  redundancyManager,
  initializeRedundancyManager,
  recordModelSuccess,
  recordModelFailure,
  isModelAvailable,
  getRedundancyStats,
  redundancyEvents,
  type ModelHealth,
  type RedundancyConfig
} from './redundancy_manager';
