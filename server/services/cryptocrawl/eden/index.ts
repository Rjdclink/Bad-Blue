// Eden Module - Export all components

export { eden, EdenService } from './service';
export { EDEN_CONFIG, CONTROL_SIGNALS, ETHICAL_GUARDS } from './config';
export { 
  EdenDeploymentManager, 
  edenDeployment,
  RESOURCE_QUOTAS,
  STARBURST_CONFIG,
  type EdenNode,
  type EdenTier,
  type EdenRole,
  type EdenStatus,
  type RegionLatencyProfile,
  type DeploymentStrategy,
  type ResourceQuota,
  type StarburstConfig
} from './deployment';
export * from './types';
// Export schema items with explicit names to avoid conflicts with types.ts
export {
  edenLessons,
  edenStrategyTemplates,
  edenCainStates,
  edenMicroCrawlerStates,
  edenSnapshots,
  edenCataclysms,
  edenOpportunities,
  edenAuditLog,
  type EdenLesson,
  type InsertEdenLesson,
  type EdenStrategyTemplate,
  type InsertEdenStrategyTemplate,
  type EdenCainState,
  type InsertEdenCainState,
  type EdenMicroCrawlerState,
  type InsertEdenMicroCrawlerState,
  type EdenSnapshot as EdenSnapshotRow, // Renamed to avoid conflict with types.ts
  type InsertEdenSnapshot,
  type EdenCataclysm,
  type InsertEdenCataclysm,
  type EdenOpportunity,
  type InsertEdenOpportunity,
  type EdenAuditLog,
  type InsertEdenAuditLog,
} from './schema';
