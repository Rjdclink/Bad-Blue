/**
 * Computational Beam Architecture - Core Types
 * 
 * Multi-Node, Multi-Provider, Distributed CPU-Amplification Architecture
 */

// ===== PROVIDER TYPES =====

export enum ComputeProvider {
  RAILWAY = 'railway',
  CLOUDFLARE_WORKERS = 'cloudflare_workers',
  GOOGLE_CLOUD_FUNCTIONS = 'google_cloud_functions',
  GOOGLE_CLOUD_VM = 'google_cloud_vm',
  LOCAL_MACHINE = 'local_machine',
}

export enum ComputeLayer {
  ANTENNA = 'antenna',      // Omni-directional - lightweight routing
  BEAM = 'beam',            // Directional - heavy compute
  BATTERY = 'battery',      // Super-battery - optimization
}

// ===== CREDENTIAL TYPES =====

export interface TripleCredentials {
  applicationAccessKey: string;
  adminPanelAuth: string;
  crawlerAuthToken: string;
}

export interface CredentialValidation {
  applicationAccessKey: boolean;
  adminPanelAuth: boolean;
  crawlerAuthToken: boolean;
  allValid: boolean;
  timestamp: Date;
}

// ===== TASK TYPES =====

export enum TaskType {
  WEBSOCKET_PING = 'websocket_ping',
  BASIC_PARSING = 'basic_parsing',
  MONTE_CARLO = 'monte_carlo',
  ML_PREDICTION = 'ml_prediction',
  ARBITRAGE_SCAN = 'arbitrage_scan',
  MARKET_AGGREGATION = 'market_aggregation',
  MOMENTUM_STRATEGY = 'momentum_strategy',
  ALPHA_DRIFT = 'alpha_drift',
  MICRO_TRIANGULATION = 'micro_triangulation',
}

export enum TaskIntensity {
  LIGHTWEIGHT = 'lightweight',
  MODERATE = 'moderate',
  HEAVY = 'heavy',
  EXTREME = 'extreme',
}

export interface Task {
  id: string;
  type: TaskType;
  intensity: TaskIntensity;
  payload: any;
  metadata: {
    created: Date;
    priority: number;
    retries: number;
    maxRetries: number;
  };
  routing?: {
    preferredProvider?: ComputeProvider;
    requiredLayer?: ComputeLayer;
    cpuIntensive: boolean;
    memoryIntensive: boolean;
    ioIntensive: boolean;
  };
}

// ===== COMPUTE NODE TYPES =====

export interface ComputeNode {
  id: string;
  provider: ComputeProvider;
  layer: ComputeLayer;
  status: 'active' | 'busy' | 'offline' | 'maintenance';
  capabilities: {
    maxConcurrentTasks: number;
    cpuCores: number;
    memoryMB: number;
    supportedTaskTypes: TaskType[];
  };
  metrics: {
    currentLoad: number;
    avgResponseTime: number;
    successRate: number;
    totalTasksCompleted: number;
  };
  health: {
    lastHealthCheck: Date;
    cpuUsage: number;
    memoryUsage: number;
    temperature?: number;
  };
}

// ===== OPTIMIZATION TYPES =====

export interface OptimizationStrategy {
  caching: {
    enabled: boolean;
    ttl: number;
    maxSize: number;
  };
  batching: {
    enabled: boolean;
    batchSize: number;
    flushInterval: number;
  };
  compression: {
    enabled: boolean;
    algorithm: 'gzip' | 'brotli' | 'none';
  };
  deduplication: {
    enabled: boolean;
    lookbackWindow: number;
  };
}

export interface StateCache {
  key: string;
  value: any;
  timestamp: Date;
  hits: number;
  ttl: number;
}

// ===== ROUTING TYPES =====

export interface RoutingDecision {
  taskId: string;
  selectedNode: ComputeNode;
  reason: string;
  alternativeNodes: ComputeNode[];
  confidence: number;
}

export interface LoadBalancingStrategy {
  algorithm: 'round-robin' | 'least-connections' | 'weighted' | 'intelligent';
  weights?: Map<ComputeProvider, number>;
}

// ===== INTEGRITY TYPES =====

export enum IntegrityTestType {
  OPERATIONAL = 'operational',
  AUTOMATED_PATCHING = 'automated_patching',
}

export interface IntegrityTestResult {
  testType: IntegrityTestType;
  passed: boolean;
  timestamp: Date;
  issues: Array<{
    component: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    resolved: boolean;
  }>;
  metrics: {
    operationalErrors: number;
    latencySpikes: number;
    failedRequests: number;
    stabilityScore: number; // 0-100
  };
}

export interface SystemIntegrity {
  overallStability: number; // 0-100
  lastTest: Date;
  testHistory: IntegrityTestResult[];
  requiredStability: number; // Default: 98
  meetsRequirement: boolean;
}

// ===== EXECUTION TYPES =====

export interface TaskExecution {
  taskId: string;
  nodeId: string;
  startTime: Date;
  endTime?: Date;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying';
  result?: any;
  error?: string;
  metrics: {
    cpuTimeMs: number;
    memoryPeakMB: number;
    networkRequests: number;
    cacheHits: number;
  };
}

// ===== SYSTEM STATUS TYPES =====

export interface SystemStatus {
  initialized: boolean;
  credentialsValid: boolean;
  activeNodes: number;
  totalNodes: number;
  queuedTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  systemIntegrity: SystemIntegrity;
  uptime: number;
  lastUpdate: Date;
}

// ===== CRAWLER STRATEGY TYPES =====

export enum CrawlerStrategy {
  MOMENTUM = 'momentum',
  ARBITRAGE = 'arbitrage',
  ALPHA_DRIFT = 'alpha_drift',
  MICRO_TRIANGULATION = 'micro_triangulation',
  PREDICTIVE_ML = 'predictive_ml',
}

export interface CrawlerTask extends Task {
  strategy: CrawlerStrategy;
  config: {
    maxDuration: number;
    timeout: number;
    fallbackStrategy?: CrawlerStrategy;
  };
}

// ===== ERROR TYPES =====

export class ComputationalBeamError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: any
  ) {
    super(message);
    this.name = 'ComputationalBeamError';
  }
}

export class CredentialValidationError extends ComputationalBeamError {
  constructor(message: string, context?: any) {
    super(message, 'CREDENTIAL_VALIDATION_ERROR', context);
    this.name = 'CredentialValidationError';
  }
}

export class TaskRoutingError extends ComputationalBeamError {
  constructor(message: string, context?: any) {
    super(message, 'TASK_ROUTING_ERROR', context);
    this.name = 'TaskRoutingError';
  }
}

export class IntegrityTestError extends ComputationalBeamError {
  constructor(message: string, context?: any) {
    super(message, 'INTEGRITY_TEST_ERROR', context);
    this.name = 'IntegrityTestError';
  }
}
