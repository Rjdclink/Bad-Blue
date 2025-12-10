/**
 * 4JI Distributed Architecture - Core Types & Interfaces
 * 
 * Central type definitions for the distributed AI orchestration system:
 * - Model artifact management
 * - Edge worker coordination
 * - Volunteer compute pool
 * - Faucet gateway
 * - CRDT synchronization
 */

// ============================================================================
// MODEL ARTIFACT TYPES
// ============================================================================

export interface ModelArtifact {
  id: string;
  name: string;
  version: string;
  type: 'micro' | 'student' | 'teacher' | 'specialized';
  domain: 'legal' | 'crypto' | 'shared' | 'planning';
  
  // Compression metadata
  compression: {
    format: 'zstd';
    level: 3 | 4 | 5 | 6;
    originalSize: number;
    compressedSize: number;
    checksum: string;
  };
  
  // Quantization metadata
  quantization: {
    bits: 4 | 6 | 8 | 16 | 32;
    method: 'ptq' | 'qat' | 'none';
    calibrationSamples?: number;
  };
  
  // Storage
  storage: {
    weightsPath: string;
    metadataPath: string;
    signaturePath: string;
  };
  
  // Signature & verification
  signature: {
    algorithm: 'ed25519' | 'rsa-pss';
    publicKey: string;
    signature: string;
    signedAt: string;
    signedBy: string;
  };
  
  created: string;
  updated: string;
}

export interface ModelBundle {
  artifact: ModelArtifact;
  weightsData: Uint8Array;
  metadata: ModelMetadata;
  verified: boolean;
}

export interface ModelMetadata {
  architecture: string;
  parameters: number;
  layers: number;
  inputShape: number[];
  outputShape: number[];
  vocabulary?: number;
  contextLength?: number;
  capabilities: string[];
}

// ============================================================================
// EDGE WORKER TYPES
// ============================================================================

export interface EdgeWorker {
  id: string;
  deviceId: string;
  userId?: string;
  
  // Capabilities
  capabilities: {
    wasm: boolean;
    webgpu: boolean;
    webgl: boolean;
    simd: boolean;
    threads: boolean;
    memory: number; // MB available
    storage: number; // MB available
  };
  
  // Status
  status: 'online' | 'offline' | 'busy' | 'error';
  lastHeartbeat: string;
  
  // Cached models
  cachedModels: string[];
  
  // Federated learning participation
  federatedLearning: {
    enabled: boolean;
    lastContribution: string | null;
    contributionsCount: number;
    privacyLevel: 'high' | 'medium' | 'low';
  };
  
  // Sync state
  syncState: {
    lastSync: string;
    pendingChanges: number;
    conflictsResolved: number;
  };
  
  registered: string;
}

export interface EdgeTask {
  id: string;
  type: 'inference' | 'gradient' | 'cache' | 'sync';
  modelId: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  
  // Task payload
  payload: {
    input?: unknown;
    parameters?: Record<string, unknown>;
    maxLatencyMs?: number;
  };
  
  // Execution constraints
  constraints: {
    maxMemoryMb: number;
    maxDurationMs: number;
    requiresGpu: boolean;
  };
  
  created: string;
  deadline?: string;
}

export interface EdgeTaskResult {
  taskId: string;
  workerId: string;
  success: boolean;
  
  // Result data
  output?: unknown;
  error?: string;
  
  // Metrics
  metrics: {
    durationMs: number;
    memoryUsedMb: number;
    tokensProcessed?: number;
  };
  
  // Verification
  verification: {
    checksum: string;
    signature: string;
  };
  
  completed: string;
}

// ============================================================================
// VOLUNTEER COMPUTE TYPES
// ============================================================================

export interface VolunteerWorker {
  id: string;
  ownerId: string;
  
  // Registration
  registration: {
    attestation: string;
    publicKey: string;
    registeredAt: string;
    verifiedAt: string | null;
    consent: {
      scope: string[];
      expiresAt: string;
      signature: string;
    };
  };
  
  // Hardware specs
  hardware: {
    gpuModel?: string;
    gpuMemory?: number;
    cpuCores: number;
    ramGb: number;
    diskGb: number;
  };
  
  // Execution environment
  environment: {
    type: 'docker' | 'wasm' | 'vm';
    version: string;
    sandbox: boolean;
  };
  
  // Status & metrics
  status: 'available' | 'busy' | 'offline' | 'suspended';
  metrics: {
    tasksCompleted: number;
    tasksFailed: number;
    totalComputeHours: number;
    averageLatencyMs: number;
    creditsEarned: number;
  };
  
  // Trust score
  trustScore: number; // 0-100
  lastActive: string;
}

export interface ComputeTask {
  id: string;
  type: 'training' | 'inference' | 'monte-carlo' | 'distillation';
  priority: number; // 1-10
  
  // Task bundle
  bundle: {
    image: string; // Docker image or WASM module URL
    entrypoint: string;
    args: string[];
    env: Record<string, string>;
    inputArtifacts: string[];
    outputSpec: string[];
  };
  
  // Resource requirements
  resources: {
    minGpuMemory?: number;
    minCpuCores: number;
    minRamGb: number;
    maxDurationHours: number;
    preferGpu: boolean;
  };
  
  // Verification
  verification: {
    reproducible: boolean;
    checksumInputs: string;
    expectedOutputHash?: string;
  };
  
  // Scheduling
  scheduling: {
    window?: { start: string; end: string };
    deadline: string;
    retryCount: number;
    maxRetries: number;
  };
  
  created: string;
  assignedTo?: string;
  status: 'pending' | 'assigned' | 'running' | 'completed' | 'failed';
}

export interface ComputeTaskResult {
  taskId: string;
  workerId: string;
  success: boolean;
  
  // Outputs
  outputs: {
    artifactIds: string[];
    logs: string;
    metrics: Record<string, number>;
  };
  
  // Verification
  verification: {
    outputChecksums: Record<string, string>;
    signature: string;
    attestation: string;
  };
  
  // Resource usage
  usage: {
    durationHours: number;
    gpuHours?: number;
    cpuHours: number;
    peakMemoryGb: number;
  };
  
  // Credits
  credits: {
    earned: number;
    breakdown: Record<string, number>;
  };
  
  completed: string;
}

// ============================================================================
// FAUCET GATEWAY TYPES
// ============================================================================

export interface FaucetTransaction {
  id: string;
  type: 'api_call' | 'data_export' | 'model_inference' | 'external_action';
  
  // Request
  request: {
    action: string;
    parameters: Record<string, unknown>;
    requestedBy: string;
    requestedAt: string;
  };
  
  // Authorization
  authorization: {
    signatures: Array<{
      signerId: string;
      signature: string;
      signedAt: string;
    }>;
    requiredSignatures: number;
    policy: string;
    approved: boolean;
    approvedAt?: string;
  };
  
  // Rate limiting
  rateLimit: {
    bucket: string;
    tokensUsed: number;
    tokensRemaining: number;
    resetAt: string;
  };
  
  // Execution
  execution: {
    status: 'pending' | 'approved' | 'executing' | 'completed' | 'rejected' | 'failed';
    result?: unknown;
    error?: string;
    executedAt?: string;
  };
  
  created: string;
}

export interface FaucetPolicy {
  id: string;
  name: string;
  
  // Actions covered
  actions: string[];
  
  // Approval requirements
  approval: {
    requiredSignatures: number;
    signerRoles: string[];
    autoApprove: boolean;
    autoApproveConditions?: Record<string, unknown>;
  };
  
  // Rate limits
  rateLimits: {
    perMinute: number;
    perHour: number;
    perDay: number;
    burstLimit: number;
  };
  
  // Constraints
  constraints: {
    maxPayloadSize: number;
    allowedOrigins: string[];
    blockedActions: string[];
    requiresAudit: boolean;
  };
  
  enabled: boolean;
  created: string;
  updated: string;
}

// ============================================================================
// CRDT SYNC TYPES
// ============================================================================

export interface CRDTDocument<T = unknown> {
  id: string;
  collection: string;
  
  // CRDT state
  state: {
    value: T;
    vector: Record<string, number>; // Vector clock
    lastModified: string;
    modifiedBy: string;
  };
  
  // Sync metadata
  sync: {
    localVersion: number;
    remoteVersion: number;
    pendingOps: CRDTOperation[];
    lastSync: string;
  };
}

export interface CRDTOperation {
  id: string;
  type: 'set' | 'delete' | 'merge' | 'increment';
  path: string[];
  value?: unknown;
  timestamp: string;
  origin: string;
  vectorClock: Record<string, number>;
}

export interface SyncState {
  deviceId: string;
  collections: Record<string, {
    localVersion: number;
    remoteVersion: number;
    pendingOps: number;
    lastSync: string;
  }>;
  conflicts: SyncConflict[];
  status: 'synced' | 'syncing' | 'offline' | 'error';
}

export interface SyncConflict {
  id: string;
  documentId: string;
  collection: string;
  localValue: unknown;
  remoteValue: unknown;
  resolvedValue?: unknown;
  resolvedAt?: string;
  resolvedBy?: 'local' | 'remote' | 'merge' | 'manual';
}

// ============================================================================
// POLICY & GOVERNANCE TYPES
// ============================================================================

export interface PolicyRule {
  id: string;
  name: string;
  type: 'access' | 'action' | 'resource' | 'ethics';
  
  // Rule definition
  condition: {
    expression: string; // JSON Logic or similar
    parameters: Record<string, unknown>;
  };
  
  // Actions
  actions: {
    allow: string[];
    deny: string[];
    requireApproval: string[];
  };
  
  // Metadata
  priority: number;
  enabled: boolean;
  created: string;
  updated: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  
  // Actor
  actor: {
    type: 'user' | 'system' | 'worker' | 'crawler';
    id: string;
    ip?: string;
  };
  
  // Action
  action: {
    type: string;
    resource: string;
    parameters: Record<string, unknown>;
  };
  
  // Result
  result: {
    success: boolean;
    error?: string;
    changes?: unknown;
  };
  
  // Policy
  policy: {
    rulesEvaluated: string[];
    decision: 'allow' | 'deny' | 'pending';
  };
}

// ============================================================================
// ORCHESTRATOR STATE TYPES
// ============================================================================

export interface OrchestratorConfig {
  // Core settings
  core: {
    version: string;
    environment: 'development' | 'staging' | 'production';
    region: string;
  };
  
  // Model settings
  models: {
    defaultMicroModel: string;
    defaultStudentModel: string;
    compressionLevel: number;
    quantizationBits: number;
  };
  
  // Edge settings
  edge: {
    heartbeatIntervalMs: number;
    taskTimeoutMs: number;
    maxCachedModels: number;
  };
  
  // Volunteer compute settings
  volunteer: {
    minTrustScore: number;
    maxTaskDurationHours: number;
    creditRate: number;
  };
  
  // Faucet settings
  faucet: {
    defaultRateLimits: FaucetPolicy['rateLimits'];
    defaultRequiredSignatures: number;
  };
  
  // Scheduling
  scheduling: {
    maintenanceWindow: { start: string; end: string };
    monteCarloWindow: { start: string; end: string };
    timezone: string;
  };
}

export interface OrchestratorState {
  config: OrchestratorConfig;
  
  // Statistics
  stats: {
    edgeWorkers: { online: number; total: number };
    volunteerWorkers: { available: number; total: number };
    models: { loaded: number; total: number };
    tasks: { pending: number; running: number; completed: number };
    faucet: { pendingTx: number; completedTx: number };
  };
  
  // Health
  health: {
    status: 'healthy' | 'degraded' | 'critical';
    checks: Record<string, boolean>;
    lastCheck: string;
  };
  
  // Sync
  sync: {
    lastGlobalSync: string;
    pendingChanges: number;
    conflictCount: number;
  };
}

// ============================================================================
// BENEFICIAL CRAWLER TYPES (EXTENDED)
// ============================================================================

export interface BeneficialCrawlerTask {
  id: string;
  type: 'bug_scan' | 'security_scan' | 'dependency_check' | 'resource_healing' | 'optimization';
  
  // Target
  target: {
    scope: string; // e.g., 'server/**/*.ts'
    environment: 'test' | 'staging';
  };
  
  // Execution
  execution: {
    status: 'pending' | 'running' | 'completed' | 'failed';
    startedAt?: string;
    completedAt?: string;
    logs: string[];
  };
  
  // Findings
  findings: Array<{
    severity: 'info' | 'warning' | 'error' | 'critical';
    type: string;
    location: string;
    description: string;
    suggestedFix?: string;
  }>;
  
  // Actions (require approval)
  proposedActions: Array<{
    type: 'pr' | 'suggestion' | 'alert';
    description: string;
    changes?: unknown;
    approved: boolean;
    approvedBy?: string;
  }>;
  
  created: string;
}

export default {
  // Export types (for documentation)
  _types: 'ModelArtifact, EdgeWorker, VolunteerWorker, FaucetTransaction, CRDTDocument, PolicyRule'
};
