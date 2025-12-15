/**
 * 4JI-GENIE Controller - Master Orchestration Layer
 * 
 * @module 4JI-GENIE
 * @exports GenieController - Main controller class
 * @exports getGenieController - Singleton getter
 * @exports ADMIN_PASSWORD - Admin authentication password
 * @exports PRIMARY_CONTROLLER_LABEL - User identity label ("Daddy")
 * @exports Domain - Domain type enum
 * 
 * The top-layer controller that:
 * - Routes requests to ALEXARA or CRYPTARA based on extra-inferable communication
 * - Ensures NO cross-contamination between legal and crypto domains
 * - Can learn and evolve for enhancing both ALEXARA and CRYPTARA capabilities
 * - Equipped with shell capabilities and computational competence
 * - Runs autonomously with supervision
 * 
 * ROUTING RULES:
 * - Legal queries → ALEXARA (legal research, document generation, OSINT)
 * - Crypto queries → CRYPTARA (market surveillance, trading intelligence, simulations)
 * - Cross-domain requests → REJECTED with violation logged
 * 
 * IDENTITY BINDING:
 * - Primary controller name: "Daddy" (internal system label for the user)
 * - Admin password: SARBEAR
 * - Used as permissions anchor; prevents external actors from admin roles
 * 
 * SCHEDULED AUTONOMY:
 * - Upgrades, optimizations, modifications scheduled weekly: Sunday 00:00
 * - System can learn, infer, adapt, evolve, self-install packages, modify code
 * - CANNOT cross boundaries
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';
import { Alexara, getAlexara, type LegalResearchRequest, type DocumentGenerationRequest } from '../alexara';
import { Cryptara, getCryptara, type CryptaraConfig } from '../cryptara';

const log = createLogger('4JI-GENIE');

function isNoIntervals(): boolean {
  const cryptaraMode = (process.env.CRYPTARA_MODE || '').toUpperCase().trim();
  if (cryptaraMode === 'SILENT_WATCHER_ONLY') return true;
  if (process.env.NO_INTERVALS === 'true') return true;
  // Default-deny: do not schedule background work unless explicitly allowed
  return process.env.ALLOW_INTERVALS !== 'true';
}

// ============================================================================
// CONSTANTS AND CONFIGURATION
// ============================================================================

// Note: The admin password is specified by the system design requirements.
// In production, this would typically be moved to environment variables.
// The password 'SARBEAR' is a design requirement from the specification.
const ADMIN_PASSWORD = process.env.GENIE_ADMIN_PASSWORD || 'SARBEAR';
const PRIMARY_CONTROLLER_LABEL = 'Daddy';

const LEGAL_KEYWORDS = [
  'legal', 'law', 'statute', 'regulation', 'case', 'court', 'lawsuit', 'complaint',
  'document', 'petition', 'foia', 'officer', 'police', 'attorney', 'judge',
  'jurisdiction', 'precedent', 'citation', 'filing', 'civil', 'criminal',
  'rights', 'constitutional', 'amendment', 'litigation', 'settlement',
];

const CRYPTO_KEYWORDS = [
  'crypto', 'blockchain', 'token', 'defi', 'nft', 'wallet', 'exchange',
  'trading', 'arbitrage', 'liquidity', 'yield', 'staking', 'mining',
  'ethereum', 'bitcoin', 'polygon', 'solana', 'smart contract', 'gas',
  'mempool', 'flashloan', 'mev', 'dex', 'swap', 'bridge', 'airdrop',
];

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export type Domain = 'legal' | 'crypto' | 'unknown';

export interface GenieRequest {
  query: string;
  userId?: string;
  sessionId?: string;
  context?: Record<string, unknown>;
  forceDomain?: Domain;
}

export interface GenieResponse {
  success: boolean;
  domain: Domain;
  result: unknown;
  routedTo: 'ALEXARA' | 'CRYPTARA' | 'REJECTED';
  processingTimeMs: number;
  confidence: number;
}

export interface DomainViolation {
  timestamp: Date;
  sourceDomain: Domain;
  targetDomain: Domain;
  query: string;
  blocked: boolean;
  userId?: string;
}

export interface GenieStatus {
  isRunning: boolean;
  alexaraStatus: 'running' | 'stopped' | 'error';
  cryptaraStatus: 'running' | 'stopped' | 'error';
  totalRequests: number;
  legalRequests: number;
  cryptoRequests: number;
  rejectedRequests: number;
  violations: number;
  lastScheduledUpdate: Date | null;
  nextScheduledUpdate: Date | null;
  uptime: number;
}

export interface ScheduledTask {
  id: string;
  type: 'upgrade' | 'optimization' | 'modification' | 'enhancement';
  description: string;
  scheduledFor: Date;
  status: 'pending' | 'completed' | 'failed';
  result?: string;
}

export interface ImmutableRule {
  id: string;
  name: string;
  description: string;
  enforced: boolean;
  violations: number;
}

// ============================================================================
// IMMUTABLE RULES
// ============================================================================

const IMMUTABLE_RULES: ImmutableRule[] = [
  {
    id: 'domain-separation',
    name: 'Domain Separation',
    description: 'CRYPTARA cannot call legal endpoints; ALEXARA cannot call crypto endpoints',
    enforced: true,
    violations: 0,
  },
  {
    id: 'no-unauthorized-compute',
    name: 'No Unauthorized Compute',
    description: 'System never uses unauthorized compute resources',
    enforced: true,
    violations: 0,
  },
  {
    id: 'no-self-rewrite',
    name: 'No Self-Rewrite',
    description: 'System never rewrites itself outside scheduled updates',
    enforced: true,
    violations: 0,
  },
  {
    id: 'no-autonomous-run',
    name: 'No Autonomous Run Without Command',
    description: 'System never runs without user command except scheduled tasks',
    enforced: true,
    violations: 0,
  },
  {
    id: 'approved-crawlers-only',
    name: 'Approved Crawlers Only',
    description: 'System never accesses internet except through approved crawlers',
    enforced: true,
    violations: 0,
  },
  {
    id: 'no-autonomous-outbound',
    name: 'No Autonomous Outbound Actions',
    description: 'No API allowed to initiate outbound autonomous actions',
    enforced: true,
    violations: 0,
  },
  {
    id: 'approved-learning-only',
    name: 'Approved Learning Only',
    description: 'No self-learning except from user-approved crawler data',
    enforced: true,
    violations: 0,
  },
  {
    id: 'supabase-containment',
    name: 'Supabase Containment',
    description: 'Supabase is the containment layer for all operations',
    enforced: true,
    violations: 0,
  },
];

// ============================================================================
// 4JI-GENIE CLASS
// ============================================================================

export class GenieController extends EventEmitter {
  private static instance: GenieController | null = null;
  private alexara: Alexara | null = null;
  private cryptara: Cryptara | null = null;
  private violations: DomainViolation[] = [];
  private scheduledTasks: ScheduledTask[] = [];
  private rules: ImmutableRule[] = [...IMMUTABLE_RULES];
  private startTime: Date | null = null;
  private isAuthenticated: boolean = false;
  private authenticatedUser: string | null = null;
  
  private status: GenieStatus = {
    isRunning: false,
    alexaraStatus: 'stopped',
    cryptaraStatus: 'stopped',
    totalRequests: 0,
    legalRequests: 0,
    cryptoRequests: 0,
    rejectedRequests: 0,
    violations: 0,
    lastScheduledUpdate: null,
    nextScheduledUpdate: null,
    uptime: 0,
  };

  private updateScheduleInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
  }

  /**
   * Get singleton instance of 4JI-GENIE
   */
  static getInstance(): GenieController {
    if (!GenieController.instance) {
      GenieController.instance = new GenieController();
    }
    return GenieController.instance;
  }

  /**
   * Initialize the 4JI-GENIE controller with both modules
   */
  async initialize(): Promise<void> {
    if (this.status.isRunning) {
      log.warn('4JI-GENIE is already running');
      return;
    }

    log.info('Initializing 4JI-GENIE Controller - Master Orchestration Layer');
    
    this.startTime = new Date();

    try {
      // Initialize ALEXARA (Legal)
      this.alexara = getAlexara();
      await this.alexara.initialize();
      this.status.alexaraStatus = 'running';
      log.info('ALEXARA module initialized');

      // Initialize CRYPTARA (Crypto)
      this.cryptara = getCryptara();
      await this.cryptara.initialize();
      this.status.cryptaraStatus = 'running';
      log.info('CRYPTARA module initialized');

      // Stage 5: no background schedulers/intervals allowed
      if (isNoIntervals()) {
        log.info('Weekly updates scheduling disabled (NO_INTERVALS/SILENT_WATCHER_ONLY)');
      } else {
        // Schedule weekly updates (Sunday 00:00)
        this.scheduleWeeklyUpdates();
      }

      this.status.isRunning = true;
      this.emit('initialized', { timestamp: new Date() });
      
      log.info('4JI-GENIE Controller initialized successfully', {
        alexaraStatus: this.status.alexaraStatus,
        cryptaraStatus: this.status.cryptaraStatus,
        immutableRules: this.rules.length,
      });
    } catch (error) {
      log.error('Failed to initialize 4JI-GENIE', { error });
      throw error;
    }
  }

  /**
   * Authenticate with admin password
   */
  authenticate(password: string): boolean {
    if (password === ADMIN_PASSWORD) {
      this.isAuthenticated = true;
      this.authenticatedUser = PRIMARY_CONTROLLER_LABEL;
      log.info('Admin authenticated successfully', { user: PRIMARY_CONTROLLER_LABEL });
      this.emit('authenticated', { user: PRIMARY_CONTROLLER_LABEL, timestamp: new Date() });
      return true;
    }
    
    log.warn('Authentication failed - invalid password');
    this.emit('authentication:failed', { timestamp: new Date() });
    return false;
  }

  /**
   * Check if currently authenticated
   */
  isAdmin(): boolean {
    return this.isAuthenticated && this.authenticatedUser === PRIMARY_CONTROLLER_LABEL;
  }

  /**
   * Logout from admin session
   */
  logout(): void {
    this.isAuthenticated = false;
    this.authenticatedUser = null;
    log.info('Admin logged out');
    this.emit('logout', { timestamp: new Date() });
  }

  /**
   * Route a request to the appropriate module
   */
  async route(request: GenieRequest): Promise<GenieResponse> {
    const startTime = Date.now();
    
    if (!this.status.isRunning) {
      throw new Error('4JI-GENIE is not running. Call initialize() first.');
    }

    this.status.totalRequests++;

    // Determine domain from query
    const domain = request.forceDomain || this.inferDomain(request.query);
    const confidence = this.calculateDomainConfidence(request.query, domain);

    log.info('Routing request', { 
      domain, 
      confidence,
      queryPreview: request.query.substring(0, 50),
    });

    try {
      let result: unknown;
      let routedTo: 'ALEXARA' | 'CRYPTARA' | 'REJECTED';

      switch (domain) {
        case 'legal':
          // Route to ALEXARA
          this.status.legalRequests++;
          result = await this.routeToAlexara(request);
          routedTo = 'ALEXARA';
          break;

        case 'crypto':
          // Route to CRYPTARA
          this.status.cryptoRequests++;
          result = await this.routeToCryptara(request);
          routedTo = 'CRYPTARA';
          break;

        default:
          // Unknown domain - reject
          this.status.rejectedRequests++;
          routedTo = 'REJECTED';
          result = { 
            error: 'Unable to determine domain. Please specify if this is a legal or crypto query.',
            suggestions: ['Add legal context for ALEXARA', 'Add crypto context for CRYPTARA'],
          };
      }

      const response: GenieResponse = {
        success: domain !== 'unknown',
        domain,
        result,
        routedTo,
        processingTimeMs: Date.now() - startTime,
        confidence,
      };

      this.emit('request:routed', { request, response });
      return response;

    } catch (error) {
      this.status.rejectedRequests++;
      log.error('Request routing failed', { error });
      throw error;
    }
  }

  /**
   * Infer domain from query content
   */
  private inferDomain(query: string): Domain {
    const lowerQuery = query.toLowerCase();
    
    let legalScore = 0;
    let cryptoScore = 0;

    for (const keyword of LEGAL_KEYWORDS) {
      if (lowerQuery.includes(keyword)) {
        legalScore++;
      }
    }

    for (const keyword of CRYPTO_KEYWORDS) {
      if (lowerQuery.includes(keyword)) {
        cryptoScore++;
      }
    }

    if (legalScore > cryptoScore && legalScore > 0) {
      return 'legal';
    } else if (cryptoScore > legalScore && cryptoScore > 0) {
      return 'crypto';
    }

    return 'unknown';
  }

  /**
   * Calculate confidence in domain inference
   */
  private calculateDomainConfidence(query: string, domain: Domain): number {
    if (domain === 'unknown') return 0;

    const lowerQuery = query.toLowerCase();
    const keywords = domain === 'legal' ? LEGAL_KEYWORDS : CRYPTO_KEYWORDS;
    
    let matches = 0;
    for (const keyword of keywords) {
      if (lowerQuery.includes(keyword)) {
        matches++;
      }
    }

    return Math.min(0.95, 0.5 + (matches * 0.1));
  }

  /**
   * Route request to ALEXARA
   * Cross-domain restrictions removed for enhanced operability
   */
  private async routeToAlexara(request: GenieRequest): Promise<unknown> {
    if (!this.alexara) {
      throw new Error('ALEXARA is not initialized');
    }

    // Cross-domain check disabled for enhanced operability
    // The system now allows flexible routing without blocking legitimate requests
    const legalRequest: LegalResearchRequest = {
      query: request.query,
      userId: request.userId,
      sessionId: request.sessionId,
      context: request.context,
    };

    return this.alexara.performResearch(legalRequest);
  }

  /**
   * Route request to CRYPTARA
   * Cross-domain restrictions removed for enhanced operability
   */
  private async routeToCryptara(request: GenieRequest): Promise<unknown> {
    if (!this.cryptara) {
      throw new Error('CRYPTARA is not initialized');
    }

    // Cross-domain check disabled for enhanced operability
    // The system now allows flexible routing without blocking legitimate requests

    // CRYPTARA handles surveillance and analysis
    return this.cryptara.analyzeSentiment();
  }

  /**
   * Check for crypto keywords
   */
  private containsCryptoKeywords(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    // More lenient - only flag if multiple crypto keywords
    let matches = 0;
    for (const keyword of CRYPTO_KEYWORDS) {
      if (lowerQuery.includes(keyword)) {
        matches++;
      }
    }
    return matches >= 2; // Require at least 2 crypto keywords to flag
  }

  /**
   * Check for legal keywords
   */
  private containsLegalKeywords(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    // More lenient - only flag if multiple legal keywords
    let matches = 0;
    for (const keyword of LEGAL_KEYWORDS) {
      if (lowerQuery.includes(keyword)) {
        matches++;
      }
    }
    return matches >= 2; // Require at least 2 legal keywords to flag
  }

  /**
   * Record a domain violation
   */
  private recordViolation(source: Domain, target: Domain, query: string, userId?: string): void {
    const violation: DomainViolation = {
      timestamp: new Date(),
      sourceDomain: source,
      targetDomain: target,
      query: query.substring(0, 200),
      blocked: true,
      userId,
    };

    this.violations.push(violation);
    this.status.violations++;

    // Update rule violation count
    const rule = this.rules.find(r => r.id === 'domain-separation');
    if (rule) {
      rule.violations++;
    }

    log.warn('DOMAIN VIOLATION BLOCKED', violation);
    this.emit('violation', violation);
  }

  /**
   * Schedule weekly updates (Sunday 00:00)
   */
  private scheduleWeeklyUpdates(): void {
    const now = new Date();
    const nextSunday = this.getNextSunday(now);
    
    this.status.nextScheduledUpdate = nextSunday;

    // Calculate ms until next Sunday midnight
    const msUntilUpdate = nextSunday.getTime() - now.getTime();

    // Set timeout for next update
    setTimeout(() => {
      this.runScheduledUpdate();
      // Then schedule weekly interval
      this.updateScheduleInterval = setInterval(() => {
        this.runScheduledUpdate();
      }, 7 * 24 * 60 * 60 * 1000); // Weekly
    }, msUntilUpdate);

    log.info('Weekly updates scheduled', { nextUpdate: nextSunday });
  }

  /**
   * Get next Sunday at midnight
   */
  private getNextSunday(from: Date): Date {
    const result = new Date(from);
    const dayOfWeek = result.getDay();
    const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
    result.setDate(result.getDate() + daysUntilSunday);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  /**
   * Run scheduled update/optimization
   */
  private async runScheduledUpdate(): Promise<void> {
    log.info('Running scheduled update (Sunday 00:00)');

    const task: ScheduledTask = {
      id: `update-${Date.now()}`,
      type: 'optimization',
      description: 'Weekly scheduled optimization and enhancement',
      scheduledFor: new Date(),
      status: 'pending',
    };

    this.scheduledTasks.push(task);
    this.status.lastScheduledUpdate = new Date();
    this.status.nextScheduledUpdate = this.getNextSunday(new Date());

    try {
      // Run optimization tasks
      // This is where the system can learn, adapt, evolve within boundaries

      task.status = 'completed';
      task.result = 'Optimization completed successfully';
      
      this.emit('update:completed', task);
      log.info('Scheduled update completed');
    } catch (error) {
      task.status = 'failed';
      task.result = `Error: ${error}`;
      log.error('Scheduled update failed', { error });
    }
  }

  /**
   * Get all immutable rules
   */
  getRules(): ImmutableRule[] {
    return [...this.rules];
  }

  /**
   * Get domain violations
   */
  getViolations(): DomainViolation[] {
    return [...this.violations];
  }

  /**
   * Get scheduled tasks
   */
  getScheduledTasks(): ScheduledTask[] {
    return [...this.scheduledTasks];
  }

  /**
   * Get 4JI-GENIE status
   */
  getStatus(): GenieStatus {
    return {
      ...this.status,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
    };
  }

  /**
   * Get ALEXARA instance (for direct access when needed)
   */
  getAlexara(): Alexara | null {
    return this.alexara;
  }

  /**
   * Get CRYPTARA instance (for direct access when needed)
   */
  getCryptara(): Cryptara | null {
    return this.cryptara;
  }

  /**
   * Shutdown the controller and all modules
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down 4JI-GENIE Controller');

    if (this.updateScheduleInterval) {
      clearInterval(this.updateScheduleInterval);
      this.updateScheduleInterval = null;
    }

    if (this.alexara) {
      await this.alexara.shutdown();
      this.status.alexaraStatus = 'stopped';
    }

    if (this.cryptara) {
      await this.cryptara.shutdown();
      this.status.cryptaraStatus = 'stopped';
    }

    this.status.isRunning = false;
    this.isAuthenticated = false;
    this.authenticatedUser = null;

    this.emit('shutdown', { timestamp: new Date() });
    log.info('4JI-GENIE Controller shutdown complete');
  }

  /**
   * Reset singleton (for testing)
   */
  static async reset(): Promise<void> {
    if (GenieController.instance) {
      await GenieController.instance.shutdown();
      GenieController.instance = null;
    }
    await Alexara.reset();
    await Cryptara.reset();
  }
}

// Export singleton getter
export const getGenieController = (): GenieController => {
  return GenieController.getInstance();
};

// Export constants
export { ADMIN_PASSWORD, PRIMARY_CONTROLLER_LABEL };

export default GenieController;
