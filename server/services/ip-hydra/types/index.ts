/**
 * IP-HYDRA Type Definitions
 * Core types for Shadow Swarm, Hydra Brain, and API systems
 */

// Shadow Status Types
export type ShadowStatus = 'pre-warmed' | 'ready' | 'active' | 'obsolete';
export type CrawlerStrategy = 'direct' | 'flashloan' | 'stealth';

// Shadow Crawler Entity
export interface ShadowCrawler {
  id: string;
  namespace: string;
  mac: string;
  ip: string;
  status: ShadowStatus;
  chain: string;
  assignedAsset?: string;
  assignedTask?: string;
  latency: number;
  createdAt: Date;
  lastActive: Date;
  parentId?: string; // For snake-skin lineage
  generation: number; // 0 = original, 1+ = spawned
}

// Asset Detection Event
export interface AssetDetectionEvent {
  id: string;
  assetType: string;
  assetValue: number;
  chain: string;
  urgency: number; // 0-100
  detectionRisk: number; // 0-100
  timestamp: Date;
  crawlerId: string;
}

// Priority Task
export interface PriorityTask {
  id: string;
  asset: string;
  chain: string;
  value: number;
  urgency: number; // 0-100
  detectionRisk: number; // 0-100
  priority: number; // Calculated from value, urgency, chain, risk
  assignedCrawler?: string;
  status: 'queued' | 'in-progress' | 'completed' | 'failed';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

// Crawler Ancestry for Snake-Skin lineage
export interface CrawlerAncestry {
  id: string;
  parentId?: string;
  childIds: string[];
  assetDetected?: string;
  timestamp: Date;
  generation: number;
}

// Detection Event Types
export interface DetectionEvent {
  id: string;
  crawlerId: string;
  type: 'network-ban' | 'rate-limit' | 'suspicious-activity' | 'connection-failed';
  severity: 'low' | 'medium' | 'high';
  subnet: string;
  chain: string;
  timestamp: Date;
}

// Pool Configuration
export interface PoolConfig {
  totalSize: number; // Default 10
  minPerChain: number; // Default 2
  chains: string[];
}

// Lifecycle Event Types
export type LifecycleEventType = 
  | 'shadow-created'
  | 'shadow-promoted'
  | 'shadow-swapped'
  | 'shadow-obsolete'
  | 'snake-spawned'
  | 'detection-event'
  | 'failover'
  | 'cooldown-triggered'
  | 'urgency-override';

export interface LifecycleEvent {
  id: string;
  type: LifecycleEventType;
  crawlerId: string;
  chain?: string;
  subnet?: string;
  metadata: Record<string, any>;
  timestamp: Date;
}

// Subnet Performance Metrics (for ML/Brain)
export interface SubnetMetrics {
  subnet: string;
  chain: string;
  assetType?: string;
  latency: number[];
  detectionCount: number;
  successCount: number;
  lastUsed: Date;
  blacklistedUntil?: Date;
}

// Intensity Tracking
export interface IntensityMetrics {
  chain: string;
  swapsPerMinute: number;
  lastSwap: Date;
  cooldownUntil?: Date;
  cooldownDuration: number; // seconds
}

// Webhook Configuration
export interface WebhookConfig {
  id: string;
  endpoint: string;
  enabled: boolean;
  eventTypes: LifecycleEventType[];
  lastSuccess?: Date;
  lastFailure?: Date;
}

// API Status Response
export interface HydraStatus {
  running: boolean;
  activeCrawlers: number;
  shadowCrawlers: number;
  poolHealth: number; // 0-100
  topPriorities: PriorityTask[];
  lastDetectionEvent?: DetectionEvent;
  lastCooldownEvent?: LifecycleEvent;
  uptime: number; // seconds
}

// Topology Data
export interface TopologyData {
  crawlers: Array<{
    id: string;
    ip: string;
    chain: string;
    proximity: number; // ms to RPC
  }>;
  rpcEndpoints: Array<{
    chain: string;
    url: string;
    avgLatency: number;
  }>;
}

// Heatmap Data
export interface HeatmapData {
  subnets: Array<{
    subnet: string;
    chain: string;
    latency: number;
    successRate: number;
    color: string; // hex color for visualization
  }>;
}

// Prediction Result (ML)
export interface SubnetPrediction {
  subnet: string;
  chain: string;
  confidence: number; // 0-1
  estimatedLatency: number;
  riskScore: number; // 0-100
  reasoning: string;
}

// Emergency Action Types
export type EmergencyAction = 
  | 'kill-all'
  | 'force-swap'
  | 'cooldown-override'
  | 'clear-queue';

export interface EmergencyActionRequest {
  action: EmergencyAction;
  targetCrawler?: string;
  reason: string;
}

// All types are defined in this file and exported above
