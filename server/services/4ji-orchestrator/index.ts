/**
 * 4JI (Forge AI) - Unified Master Orchestrator System
 * 
 * This module provides the complete 4JI orchestration system with:
 * 
 * 1. UNIFIED ORCHESTRATOR (ForgeAI):
 *    - Single decision-making intelligence
 *    - Coordinates all 17+ AI models
 *    - Split operational domains with strict isolation
 *    - Advanced reasoning and inference capabilities
 * 
 * 2. DOMAIN FIREWALL:
 *    - Complete isolation between LegalWhat and Crypto Crawler
 *    - No cross-domain state access or knowledge transfer
 *    - Security monitoring and violation tracking
 *    - Parallel evolution without interference
 * 
 * 3. LEGALWHAT ORCHESTRATOR:
 *    - Legal platform operations management
 *    - ALEXARA voice intelligence integration
 *    - SEO and UX optimization
 *    - Document generation and filing
 * 
 * 4. SELF-REPAIR ENGINE:
 *    - Autonomous error detection
 *    - Solution research across web and repositories
 *    - Automatic fix implementation
 *    - Evolution tracking per domain
 * 
 * 5. CREATIVE PROMPT ENGINE (NEW):
 *    - Maximum creativity directive implementation
 *    - Recursive adaptive logic across all modalities
 *    - Autonomous decision-making and evolution
 *    - Applied to all orchestrator and sub-agent operations
 * 
 * 6. AUTONOMOUS EVOLUTION ENGINE (NEW):
 *    - Real-time learning table updates
 *    - Verified evolution transfers
 *    - Bidirectional knowledge flow within domain constraints
 *    - Performance monitoring and adaptive optimization
 * 
 * 7. SUB-AGENT COORDINATOR (NEW):
 *    - Unique identifier assignment for all agents
 *    - Full authorization for code execution, research, optimizations
 *    - Autonomous operation within domain constraints
 *    - 16+ specialized sub-agents across Legal and Crypto domains
 * 
 * ARCHITECTURE PRINCIPLES:
 * - LegalWhat and Crypto Crawler are fully mirrored twin systems
 * - Zero cross-domain awareness or influence
 * - Identical structural frameworks, independent execution
 * - Complete operational autonomy per domain
 * - Recursive task completion to the 4th power
 * 
 * MASTER PASSWORDS:
 * - SARBEAR → Legal What platform (no email required)
 * - CRPTCRWLR → Crypto Crawler dashboard (no email required)
 * - FORGEAI → 4JI admin console (orchestrator)
 * 
 * USAGE:
 * ```typescript
 * import { ForgeAI, Domain, DomainFirewall, SubAgentCoordinator } from './services/4ji-orchestrator';
 * 
 * // Initialize the unified orchestrator with all sub-systems
 * await ForgeAI.initialize();
 * await ForgeAI.start();
 * 
 * // Initialize sub-agent coordinator
 * SubAgentCoordinator.initialize();
 * 
 * // Initialize autonomous evolution
 * AutonomousEvolutionEngine.initialize();
 * AutonomousEvolutionEngine.start();
 * 
 * // Execute tasks within isolated domains
 * const result = await ForgeAI.executeTask({
 *   id: 'task-1',
 *   domain: Domain.LEGAL_WHAT,
 *   type: 'legal-consultation',
 *   priority: TaskPriority.HIGH_USER,
 *   requiredCapabilities: ['legal-analysis', 'reasoning'],
 *   prompt: 'Analyze this civil rights case...',
 * });
 * 
 * // Assign task to specific sub-agent
 * await SubAgentCoordinator.assignTask(
 *   '4JI-LEGAL-RESEARCH-001',
 *   'precedent-search',
 *   { query: 'civil rights violation precedents' }
 * );
 * ```
 */

// Core orchestrator
export { ForgeAI, type OrchestratorStatus, type OrchestratedTask, type OrchestratedResult } from './forge-ai';

// Domain isolation
export { DomainFirewall, Domain } from './domain-firewall';

// Domain-specific orchestrators
export { 
  LegalWhatOrchestrator, 
  type LegalWhatSystemStatus, 
  type LegalWhatMetrics,
  type LegalConsultationRequest,
  type LegalConsultationResult,
} from './legalwhat-orchestrator';

// Self-repair and evolution
export {
  SelfRepairEngine,
  ErrorSeverity,
  ErrorCategory,
  type DetectedAnomaly,
  type ResearchResult,
  type RepairAction,
} from './self-repair-engine';

// Creative prompt engine (NEW)
export {
  CreativePromptEngine,
  CREATIVE_IGNITION_PROMPT,
  type CreativeAgentConfig,
  type CreativeTaskContext,
  type EvolutionEntry,
  type LearningEntry,
} from './creative-prompt-engine';

// Autonomous evolution engine (NEW)
export {
  AutonomousEvolutionEngine,
  type OptimizationTask,
  type EnhancementTask,
  type TestResult,
  type PerformanceMetrics,
} from './autonomous-evolution-engine';

// Sub-agent coordinator (NEW)
export {
  SubAgentCoordinator,
  AuthorizationLevel,
  type SubAgentConfig,
  type SubAgentStatus,
  type SubAgentTask,
  type SubAgentCapability,
} from './sub-agent-coordinator';

// Re-export AI types for convenience
export type { AIModelConfig, AICapability } from './forge-ai';
