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
 * ARCHITECTURE PRINCIPLES:
 * - LegalWhat and Crypto Crawler are fully mirrored twin systems
 * - Zero cross-domain awareness or influence
 * - Identical structural frameworks, independent execution
 * - Complete operational autonomy per domain
 * 
 * USAGE:
 * ```typescript
 * import { ForgeAI, Domain, DomainFirewall } from './services/4ji-orchestrator';
 * 
 * // Initialize the unified orchestrator
 * await ForgeAI.initialize();
 * await ForgeAI.start();
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
 * // Or use domain-specific orchestrators
 * import { LegalWhatOrchestrator } from './services/4ji-orchestrator';
 * 
 * await LegalWhatOrchestrator.initialize();
 * await LegalWhatOrchestrator.start();
 * 
 * const consultation = await LegalWhatOrchestrator.processConsultation({
 *   id: 'consult-1',
 *   situation: 'My civil rights were violated...',
 *   lawType: 'civil-rights',
 *   jurisdiction: 'federal',
 *   urgency: 'high',
 * });
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

// Re-export AI types for convenience
export type { AIModelConfig, AICapability } from './forge-ai';
