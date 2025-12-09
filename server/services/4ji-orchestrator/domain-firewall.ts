/**
 * Domain Firewall - Strict isolation between LegalWhat and Crypto Crawler ecosystems
 * 
 * SECURITY PRINCIPLE:
 * - LegalWhat AI and Crypto Crawler AI are fully mirrored but completely isolated
 * - No cross-domain state access, knowledge transfer, or control flow
 * - Each domain operates as a fully autonomous twin entity
 * 
 * This firewall ensures:
 * 1. No shared state between domains
 * 2. No inter-domain message passing
 * 3. No cross-contamination of learned parameters
 * 4. Complete operational independence
 */

import { createLogger } from '../../logger';

const log = createLogger('DomainFirewall');

/**
 * Domain identifiers - Two parallel ecosystems
 */
export enum Domain {
  LEGAL_WHAT = 'legalwhat',
  CRYPTO_CRAWLER = 'cryptocrawler',
}

/**
 * Domain isolation context - Contains all domain-specific state
 */
interface DomainContext {
  domain: Domain;
  createdAt: Date;
  lastActivity: Date;
  operationCount: number;
  isolatedState: Map<string, unknown>;
  knowledgeBase: Map<string, unknown>;
  evolutionHistory: unknown[];
  errorLog: Array<{ timestamp: Date; error: string; resolved: boolean }>;
}

/**
 * Cross-domain access attempt - tracked for security monitoring
 */
interface AccessViolation {
  timestamp: Date;
  sourceDomain: Domain;
  targetDomain: Domain;
  attemptedOperation: string;
  stackTrace?: string;
  blocked: boolean;
}

/**
 * Domain Firewall - Ensures complete isolation between ecosystems
 */
export class DomainFirewall {
  private static contexts = new Map<Domain, DomainContext>();
  private static violations: AccessViolation[] = [];
  private static currentDomain: Domain | null = null;
  private static isInitialized = false;

  /**
   * Initialize the firewall with domain contexts
   */
  static initialize(): void {
    if (this.isInitialized) {
      log.warn('Domain Firewall already initialized');
      return;
    }

    // Create isolated contexts for each domain
    for (const domain of Object.values(Domain)) {
      this.contexts.set(domain as Domain, {
        domain: domain as Domain,
        createdAt: new Date(),
        lastActivity: new Date(),
        operationCount: 0,
        isolatedState: new Map(),
        knowledgeBase: new Map(),
        evolutionHistory: [],
        errorLog: [],
      });
    }

    this.isInitialized = true;
    log.info('Domain Firewall initialized with complete isolation', {
      domains: Object.values(Domain),
      isolationLevel: 'ABSOLUTE',
    });
  }

  /**
   * Enter a domain context - all subsequent operations are domain-scoped
   */
  static enterDomain(domain: Domain): DomainContext {
    this.ensureInitialized();

    if (this.currentDomain !== null && this.currentDomain !== domain) {
      // Attempting to switch domains without exiting first
      this.recordViolation({
        timestamp: new Date(),
        sourceDomain: this.currentDomain,
        targetDomain: domain,
        attemptedOperation: 'domain-switch',
        blocked: true,
      });
      
      throw new Error(
        `FIREWALL VIOLATION: Cannot switch from ${this.currentDomain} to ${domain} without exiting first`
      );
    }

    this.currentDomain = domain;
    const context = this.contexts.get(domain)!;
    context.lastActivity = new Date();
    context.operationCount++;

    log.debug('Entered domain context', { domain });
    return context;
  }

  /**
   * Exit the current domain context
   */
  static exitDomain(): void {
    if (this.currentDomain === null) {
      log.warn('No domain context to exit');
      return;
    }

    log.debug('Exited domain context', { domain: this.currentDomain });
    this.currentDomain = null;
  }

  /**
   * Get the current domain (or null if not in a domain context)
   */
  static getCurrentDomain(): Domain | null {
    return this.currentDomain;
  }

  /**
   * Execute a function within an isolated domain context
   */
  static async executeInDomain<T>(
    domain: Domain,
    operation: string,
    fn: (context: DomainContext) => Promise<T>
  ): Promise<T> {
    this.ensureInitialized();
    
    // Check for cross-domain attempt
    if (this.currentDomain !== null && this.currentDomain !== domain) {
      this.recordViolation({
        timestamp: new Date(),
        sourceDomain: this.currentDomain,
        targetDomain: domain,
        attemptedOperation: operation,
        blocked: true,
      });
      
      throw new Error(
        `FIREWALL BLOCKED: Cross-domain access from ${this.currentDomain} to ${domain} attempted in '${operation}'`
      );
    }

    const context = this.enterDomain(domain);
    
    try {
      const result = await fn(context);
      return result;
    } catch (error) {
      context.errorLog.push({
        timestamp: new Date(),
        error: error instanceof Error ? error.message : String(error),
        resolved: false,
      });
      throw error;
    } finally {
      this.exitDomain();
    }
  }

  /**
   * Execute synchronous function within an isolated domain context
   */
  static executeInDomainSync<T>(
    domain: Domain,
    operation: string,
    fn: (context: DomainContext) => T
  ): T {
    this.ensureInitialized();
    
    // Check for cross-domain attempt
    if (this.currentDomain !== null && this.currentDomain !== domain) {
      this.recordViolation({
        timestamp: new Date(),
        sourceDomain: this.currentDomain,
        targetDomain: domain,
        attemptedOperation: operation,
        blocked: true,
      });
      
      throw new Error(
        `FIREWALL BLOCKED: Cross-domain access from ${this.currentDomain} to ${domain} attempted in '${operation}'`
      );
    }

    const context = this.enterDomain(domain);
    
    try {
      const result = fn(context);
      return result;
    } catch (error) {
      context.errorLog.push({
        timestamp: new Date(),
        error: error instanceof Error ? error.message : String(error),
        resolved: false,
      });
      throw error;
    } finally {
      this.exitDomain();
    }
  }

  /**
   * Store domain-specific state (isolated)
   */
  static storeState(domain: Domain, key: string, value: unknown): void {
    this.ensureInDomain(domain, 'storeState');
    const context = this.contexts.get(domain)!;
    context.isolatedState.set(key, value);
  }

  /**
   * Retrieve domain-specific state (isolated)
   */
  static getState<T>(domain: Domain, key: string): T | undefined {
    this.ensureInDomain(domain, 'getState');
    const context = this.contexts.get(domain)!;
    return context.isolatedState.get(key) as T | undefined;
  }

  /**
   * Store domain knowledge (isolated learning)
   */
  static storeKnowledge(domain: Domain, key: string, knowledge: unknown): void {
    this.ensureInDomain(domain, 'storeKnowledge');
    const context = this.contexts.get(domain)!;
    context.knowledgeBase.set(key, knowledge);
  }

  /**
   * Retrieve domain knowledge (isolated)
   */
  static getKnowledge<T>(domain: Domain, key: string): T | undefined {
    this.ensureInDomain(domain, 'getKnowledge');
    const context = this.contexts.get(domain)!;
    return context.knowledgeBase.get(key) as T | undefined;
  }

  /**
   * Record evolution event (isolated per domain)
   */
  static recordEvolution(domain: Domain, evolutionData: unknown): void {
    this.ensureInDomain(domain, 'recordEvolution');
    const context = this.contexts.get(domain)!;
    context.evolutionHistory.push({
      timestamp: new Date(),
      data: evolutionData,
    });
  }

  /**
   * Get domain statistics (read-only, no cross-domain access)
   */
  static getDomainStats(domain: Domain): {
    operationCount: number;
    errorCount: number;
    unresolvedErrors: number;
    knowledgeEntries: number;
    evolutionEvents: number;
    lastActivity: Date;
  } {
    // Stats can be queried from outside without entering domain
    const context = this.contexts.get(domain);
    if (!context) {
      throw new Error(`Unknown domain: ${domain}`);
    }

    return {
      operationCount: context.operationCount,
      errorCount: context.errorLog.length,
      unresolvedErrors: context.errorLog.filter(e => !e.resolved).length,
      knowledgeEntries: context.knowledgeBase.size,
      evolutionEvents: context.evolutionHistory.length,
      lastActivity: context.lastActivity,
    };
  }

  /**
   * Get all firewall violations (security audit)
   */
  static getViolations(): AccessViolation[] {
    return [...this.violations];
  }

  /**
   * Clear violation log (after review)
   */
  static clearViolations(): void {
    log.info('Clearing violation log', { count: this.violations.length });
    this.violations = [];
  }

  /**
   * Verify domain isolation - test function
   */
  static verifyIsolation(): {
    isIsolated: boolean;
    violations: number;
    crossDomainAttempts: number;
  } {
    const crossDomainAttempts = this.violations.filter(v => v.blocked).length;
    
    return {
      isIsolated: crossDomainAttempts === this.violations.length, // All attempts blocked
      violations: this.violations.length,
      crossDomainAttempts,
    };
  }

  /**
   * Reset firewall state (for testing)
   */
  static reset(): void {
    this.contexts.clear();
    this.violations = [];
    this.currentDomain = null;
    this.isInitialized = false;
    log.info('Domain Firewall reset');
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private static ensureInitialized(): void {
    if (!this.isInitialized) {
      this.initialize();
    }
  }

  private static ensureInDomain(domain: Domain, operation: string): void {
    this.ensureInitialized();
    
    if (this.currentDomain !== domain) {
      if (this.currentDomain === null) {
        throw new Error(
          `FIREWALL: Must enter domain ${domain} before ${operation}`
        );
      } else {
        this.recordViolation({
          timestamp: new Date(),
          sourceDomain: this.currentDomain,
          targetDomain: domain,
          attemptedOperation: operation,
          blocked: true,
        });
        
        throw new Error(
          `FIREWALL BLOCKED: ${operation} attempted on ${domain} from within ${this.currentDomain}`
        );
      }
    }
  }

  private static recordViolation(violation: AccessViolation): void {
    this.violations.push(violation);
    log.warn('FIREWALL VIOLATION DETECTED', {
      source: violation.sourceDomain,
      target: violation.targetDomain,
      operation: violation.attemptedOperation,
      blocked: violation.blocked,
    });
  }
}

export default DomainFirewall;
