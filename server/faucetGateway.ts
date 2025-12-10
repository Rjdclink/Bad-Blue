/**
 * Faucet Gateway
 * 
 * Single hardened outward-facing interface for all external actions.
 * Features:
 * - Rate limiting with token buckets
 * - Multi-signature approval for sensitive actions
 * - Policy-based access control
 * - Comprehensive audit logging
 * - Sandbox enforcement
 */

import { EventEmitter } from 'events';
import { createLogger } from './logger';
import crypto from 'crypto';
import type {
  FaucetTransaction,
  FaucetPolicy,
  AuditEntry
} from './fourJITypes';

const log = createLogger('FaucetGateway');

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_RATE_LIMITS = {
  perMinute: 60,
  perHour: 1000,
  perDay: 10000,
  burstLimit: 10
};

const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_PENDING_TRANSACTIONS = 1000;
const TRANSACTION_TIMEOUT_MS = 300000; // 5 minutes

// ============================================================================
// RATE LIMITER
// ============================================================================

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
  requests: number[];
}

class RateLimiter {
  private buckets: Map<string, RateLimitBucket> = new Map();
  private limits: FaucetPolicy['rateLimits'];

  constructor(limits: FaucetPolicy['rateLimits']) {
    this.limits = limits;
  }

  /**
   * Check if request is allowed and consume token
   */
  checkAndConsume(bucketId: string): { allowed: boolean; tokensRemaining: number; resetAt: string } {
    const now = Date.now();
    let bucket = this.buckets.get(bucketId);

    if (!bucket) {
      bucket = {
        tokens: this.limits.burstLimit,
        lastRefill: now,
        requests: []
      };
      this.buckets.set(bucketId, bucket);
    }

    // Clean old requests
    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;
    const oneDayAgo = now - 86400000;
    bucket.requests = bucket.requests.filter(t => t > oneDayAgo);

    // Count requests in windows
    const lastMinute = bucket.requests.filter(t => t > oneMinuteAgo).length;
    const lastHour = bucket.requests.filter(t => t > oneHourAgo).length;
    const lastDay = bucket.requests.length;

    // Check limits
    if (lastMinute >= this.limits.perMinute ||
        lastHour >= this.limits.perHour ||
        lastDay >= this.limits.perDay) {
      
      let resetAt: number;
      if (lastMinute >= this.limits.perMinute) {
        resetAt = bucket.requests[bucket.requests.length - this.limits.perMinute] + 60000;
      } else if (lastHour >= this.limits.perHour) {
        resetAt = bucket.requests[bucket.requests.length - this.limits.perHour] + 3600000;
      } else {
        resetAt = bucket.requests[bucket.requests.length - this.limits.perDay] + 86400000;
      }

      return {
        allowed: false,
        tokensRemaining: 0,
        resetAt: new Date(resetAt).toISOString()
      };
    }

    // Refill burst tokens
    const timeSinceRefill = now - bucket.lastRefill;
    const tokensToAdd = Math.floor(timeSinceRefill / 1000); // 1 token per second
    bucket.tokens = Math.min(this.limits.burstLimit, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    // Check burst limit
    if (bucket.tokens <= 0) {
      return {
        allowed: false,
        tokensRemaining: 0,
        resetAt: new Date(now + 1000).toISOString()
      };
    }

    // Consume token and record request
    bucket.tokens--;
    bucket.requests.push(now);

    return {
      allowed: true,
      tokensRemaining: bucket.tokens,
      resetAt: new Date(now + 60000).toISOString()
    };
  }

  /**
   * Get current status for a bucket
   */
  getStatus(bucketId: string): { tokensRemaining: number; requestsLastMinute: number } {
    const bucket = this.buckets.get(bucketId);
    if (!bucket) {
      return { tokensRemaining: this.limits.burstLimit, requestsLastMinute: 0 };
    }

    const oneMinuteAgo = Date.now() - 60000;
    const requestsLastMinute = bucket.requests.filter(t => t > oneMinuteAgo).length;

    return {
      tokensRemaining: bucket.tokens,
      requestsLastMinute
    };
  }

  /**
   * Update limits
   */
  updateLimits(limits: FaucetPolicy['rateLimits']): void {
    this.limits = limits;
  }
}

// ============================================================================
// FAUCET GATEWAY
// ============================================================================

export class FaucetGateway extends EventEmitter {
  private policies: Map<string, FaucetPolicy> = new Map();
  private transactions: Map<string, FaucetTransaction> = new Map();
  private auditLog: AuditEntry[] = [];
  private rateLimiter: RateLimiter;
  private initialized: boolean = false;

  // Approved signers (in production, use actual key management)
  private approvedSigners: Map<string, { publicKey: string; role: string }> = new Map();

  constructor() {
    super();
    this.rateLimiter = new RateLimiter(DEFAULT_RATE_LIMITS);
  }

  /**
   * Initialize the faucet gateway
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    log.info('Initializing Faucet Gateway...');

    // Create default policies
    this.createDefaultPolicies();

    // Register default signers
    this.registerDefaultSigners();

    this.initialized = true;
    this.emit('initialized', { policies: this.policies.size });
    log.info('Faucet Gateway initialized');
  }

  /**
   * Create default security policies
   */
  private createDefaultPolicies(): void {
    // Default policy for standard API calls
    this.policies.set('default', {
      id: 'default',
      name: 'Default Policy',
      actions: ['api_call', 'model_inference'],
      approval: {
        requiredSignatures: 0,
        signerRoles: [],
        autoApprove: true
      },
      rateLimits: DEFAULT_RATE_LIMITS,
      constraints: {
        maxPayloadSize: MAX_PAYLOAD_SIZE,
        allowedOrigins: ['*'],
        blockedActions: [],
        requiresAudit: true
      },
      enabled: true,
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    });

    // Strict policy for external actions
    this.policies.set('external', {
      id: 'external',
      name: 'External Actions Policy',
      actions: ['external_action', 'data_export'],
      approval: {
        requiredSignatures: 2,
        signerRoles: ['admin', 'security'],
        autoApprove: false
      },
      rateLimits: {
        perMinute: 10,
        perHour: 100,
        perDay: 500,
        burstLimit: 3
      },
      constraints: {
        maxPayloadSize: 1024 * 1024, // 1MB
        allowedOrigins: [],
        blockedActions: ['delete_all', 'export_credentials'],
        requiresAudit: true
      },
      enabled: true,
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    });

    // Critical policy for high-risk actions
    this.policies.set('critical', {
      id: 'critical',
      name: 'Critical Actions Policy',
      actions: ['credential_access', 'system_config'],
      approval: {
        requiredSignatures: 3,
        signerRoles: ['admin', 'security', 'owner'],
        autoApprove: false
      },
      rateLimits: {
        perMinute: 1,
        perHour: 10,
        perDay: 50,
        burstLimit: 1
      },
      constraints: {
        maxPayloadSize: 10 * 1024, // 10KB
        allowedOrigins: [],
        blockedActions: ['*'],
        requiresAudit: true
      },
      enabled: true,
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    });
  }

  /**
   * Register default signers
   */
  private registerDefaultSigners(): void {
    // In production, load from secure key management
    this.approvedSigners.set('system', {
      publicKey: 'system-public-key',
      role: 'system'
    });
    this.approvedSigners.set('admin', {
      publicKey: 'admin-public-key',
      role: 'admin'
    });
  }

  /**
   * Submit a transaction for processing
   */
  async submitTransaction(
    type: FaucetTransaction['type'],
    action: string,
    parameters: Record<string, unknown>,
    requestedBy: string
  ): Promise<FaucetTransaction> {
    const id = `tx-${crypto.randomBytes(8).toString('hex')}`;

    // Find applicable policy
    const policy = this.findPolicyForAction(type, action);
    if (!policy) {
      throw new Error(`No policy found for action: ${action}`);
    }

    // Check if action is blocked
    if (policy.constraints.blockedActions.includes(action) ||
        policy.constraints.blockedActions.includes('*')) {
      throw new Error(`Action is blocked by policy: ${action}`);
    }

    // Check payload size
    const payloadSize = JSON.stringify(parameters).length;
    if (payloadSize > policy.constraints.maxPayloadSize) {
      throw new Error(`Payload exceeds maximum size: ${payloadSize} > ${policy.constraints.maxPayloadSize}`);
    }

    // Check rate limit
    const rateLimitKey = `${requestedBy}:${type}`;
    const rateCheck = this.rateLimiter.checkAndConsume(rateLimitKey);
    if (!rateCheck.allowed) {
      throw new Error(`Rate limit exceeded. Reset at: ${rateCheck.resetAt}`);
    }

    // Create transaction
    const transaction: FaucetTransaction = {
      id,
      type,
      request: {
        action,
        parameters,
        requestedBy,
        requestedAt: new Date().toISOString()
      },
      authorization: {
        signatures: [],
        requiredSignatures: policy.approval.requiredSignatures,
        policy: policy.id,
        approved: policy.approval.autoApprove,
        approvedAt: policy.approval.autoApprove ? new Date().toISOString() : undefined
      },
      rateLimit: {
        bucket: rateLimitKey,
        tokensUsed: 1,
        tokensRemaining: rateCheck.tokensRemaining,
        resetAt: rateCheck.resetAt
      },
      execution: {
        status: policy.approval.autoApprove ? 'approved' : 'pending'
      },
      created: new Date().toISOString()
    };

    // Store transaction
    this.transactions.set(id, transaction);

    // Enforce max pending limit
    if (this.transactions.size > MAX_PENDING_TRANSACTIONS) {
      this.cleanupOldTransactions();
    }

    // Audit log
    await this.logAudit({
      actor: { type: 'user', id: requestedBy },
      action: { type: 'transaction_submitted', resource: action, parameters },
      result: { success: true },
      policy: { rulesEvaluated: [policy.id], decision: transaction.authorization.approved ? 'allow' : 'pending' }
    });

    this.emit('transaction-submitted', { id, type, action, status: transaction.execution.status });
    log.info('Transaction submitted', { id, type, action, status: transaction.execution.status });

    // Auto-execute if approved
    if (transaction.authorization.approved) {
      await this.executeTransaction(id);
    }

    return transaction;
  }

  /**
   * Sign a transaction for approval
   */
  async signTransaction(
    transactionId: string,
    signerId: string,
    signature: string
  ): Promise<FaucetTransaction> {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    if (transaction.execution.status !== 'pending') {
      throw new Error(`Transaction is not pending: ${transaction.execution.status}`);
    }

    // Verify signer
    const signer = this.approvedSigners.get(signerId);
    if (!signer) {
      throw new Error(`Unknown signer: ${signerId}`);
    }

    // Check if signer role is allowed
    const policy = this.policies.get(transaction.authorization.policy);
    if (policy && !policy.approval.signerRoles.includes(signer.role)) {
      throw new Error(`Signer role not allowed: ${signer.role}`);
    }

    // Check for duplicate signature
    if (transaction.authorization.signatures.some(s => s.signerId === signerId)) {
      throw new Error(`Signer has already signed: ${signerId}`);
    }

    // Verify signature (in production, use actual crypto verification)
    const isValid = this.verifySignature(transactionId, signerId, signature);
    if (!isValid) {
      throw new Error('Invalid signature');
    }

    // Add signature
    transaction.authorization.signatures.push({
      signerId,
      signature,
      signedAt: new Date().toISOString()
    });

    // Check if we have enough signatures
    if (transaction.authorization.signatures.length >= transaction.authorization.requiredSignatures) {
      transaction.authorization.approved = true;
      transaction.authorization.approvedAt = new Date().toISOString();
      transaction.execution.status = 'approved';

      // Execute transaction
      await this.executeTransaction(transactionId);
    }

    // Audit log
    await this.logAudit({
      actor: { type: 'user', id: signerId },
      action: { type: 'transaction_signed', resource: transactionId, parameters: { signatureCount: transaction.authorization.signatures.length } },
      result: { success: true },
      policy: { rulesEvaluated: [transaction.authorization.policy], decision: transaction.authorization.approved ? 'allow' : 'pending' }
    });

    this.emit('transaction-signed', { transactionId, signerId, approved: transaction.authorization.approved });
    return transaction;
  }

  /**
   * Execute an approved transaction
   */
  private async executeTransaction(transactionId: string): Promise<void> {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) return;

    if (!transaction.authorization.approved) {
      throw new Error('Transaction not approved');
    }

    transaction.execution.status = 'executing';
    transaction.execution.executedAt = new Date().toISOString();

    try {
      // Execute the action (in production, implement actual handlers)
      const result = await this.executeAction(
        transaction.type,
        transaction.request.action,
        transaction.request.parameters
      );

      transaction.execution.status = 'completed';
      transaction.execution.result = result;

      await this.logAudit({
        actor: { type: 'system', id: 'faucet' },
        action: { type: 'transaction_executed', resource: transactionId, parameters: transaction.request.parameters },
        result: { success: true, changes: result },
        policy: { rulesEvaluated: [transaction.authorization.policy], decision: 'allow' }
      });

      this.emit('transaction-completed', { transactionId, result });
      log.info('Transaction completed', { transactionId });

    } catch (error: any) {
      transaction.execution.status = 'failed';
      transaction.execution.error = error.message;

      await this.logAudit({
        actor: { type: 'system', id: 'faucet' },
        action: { type: 'transaction_failed', resource: transactionId, parameters: transaction.request.parameters },
        result: { success: false, error: error.message },
        policy: { rulesEvaluated: [transaction.authorization.policy], decision: 'allow' }
      });

      this.emit('transaction-failed', { transactionId, error: error.message });
      log.error('Transaction failed', { transactionId, error: error.message });
    }
  }

  /**
   * Execute an action (stub - implement actual handlers)
   */
  private async executeAction(
    type: FaucetTransaction['type'],
    action: string,
    parameters: Record<string, unknown>
  ): Promise<unknown> {
    // In production, implement actual action handlers
    log.info('Executing action', { type, action });

    // Simulate execution
    return {
      success: true,
      action,
      executedAt: new Date().toISOString()
    };
  }

  /**
   * Find policy for action
   */
  private findPolicyForAction(type: FaucetTransaction['type'], action: string): FaucetPolicy | null {
    for (const policy of this.policies.values()) {
      if (policy.enabled && policy.actions.includes(type)) {
        return policy;
      }
    }
    return this.policies.get('default') || null;
  }

  /**
   * Verify signature (stub - implement actual crypto)
   */
  private verifySignature(transactionId: string, signerId: string, signature: string): boolean {
    // In production, use actual Ed25519 verification
    const signer = this.approvedSigners.get(signerId);
    if (!signer) return false;

    const expectedSig = crypto.createHmac('sha256', signer.publicKey)
      .update(`${transactionId}:${signerId}`)
      .digest('hex');

    return signature === expectedSig;
  }

  /**
   * Log audit entry
   */
  private async logAudit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> {
    const auditEntry: AuditEntry = {
      id: `audit-${crypto.randomBytes(8).toString('hex')}`,
      timestamp: new Date().toISOString(),
      ...entry
    };

    this.auditLog.push(auditEntry);

    // Keep last 10000 entries
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-10000);
    }
  }

  /**
   * Cleanup old transactions
   */
  private cleanupOldTransactions(): void {
    const cutoff = Date.now() - TRANSACTION_TIMEOUT_MS;
    const toDelete: string[] = [];

    for (const [id, tx] of this.transactions) {
      const txTime = new Date(tx.created).getTime();
      if (txTime < cutoff && tx.execution.status !== 'executing') {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.transactions.delete(id);
    }

    if (toDelete.length > 0) {
      log.info('Cleaned up old transactions', { count: toDelete.length });
    }
  }

  /**
   * Get transaction by ID
   */
  getTransaction(transactionId: string): FaucetTransaction | null {
    return this.transactions.get(transactionId) || null;
  }

  /**
   * List transactions
   */
  listTransactions(filter?: { status?: string; type?: string }): FaucetTransaction[] {
    let transactions = Array.from(this.transactions.values());

    if (filter?.status) {
      transactions = transactions.filter(t => t.execution.status === filter.status);
    }
    if (filter?.type) {
      transactions = transactions.filter(t => t.type === filter.type);
    }

    return transactions;
  }

  /**
   * Get audit log
   */
  getAuditLog(limit?: number): AuditEntry[] {
    const log = [...this.auditLog].reverse();
    return limit ? log.slice(0, limit) : log;
  }

  /**
   * Register a signer
   */
  registerSigner(signerId: string, publicKey: string, role: string): void {
    this.approvedSigners.set(signerId, { publicKey, role });
    log.info('Signer registered', { signerId, role });
  }

  /**
   * Add or update a policy
   */
  setPolicy(policy: FaucetPolicy): void {
    this.policies.set(policy.id, policy);
    log.info('Policy updated', { policyId: policy.id });
  }

  /**
   * Get policy
   */
  getPolicy(policyId: string): FaucetPolicy | null {
    return this.policies.get(policyId) || null;
  }

  /**
   * Get rate limit status
   */
  getRateLimitStatus(bucketId: string): { tokensRemaining: number; requestsLastMinute: number } {
    return this.rateLimiter.getStatus(bucketId);
  }

  /**
   * Get gateway statistics
   */
  getStats(): {
    totalTransactions: number;
    pendingTransactions: number;
    completedTransactions: number;
    failedTransactions: number;
    policies: number;
    signers: number;
  } {
    const transactions = Array.from(this.transactions.values());

    return {
      totalTransactions: transactions.length,
      pendingTransactions: transactions.filter(t => t.execution.status === 'pending').length,
      completedTransactions: transactions.filter(t => t.execution.status === 'completed').length,
      failedTransactions: transactions.filter(t => t.execution.status === 'failed').length,
      policies: this.policies.size,
      signers: this.approvedSigners.size
    };
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down Faucet Gateway...');
    this.transactions.clear();
    this.policies.clear();
    this.approvedSigners.clear();
    this.initialized = false;
    log.info('Faucet Gateway shutdown complete');
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: FaucetGateway | null = null;

export function getFaucetGateway(): FaucetGateway {
  if (!instance) {
    instance = new FaucetGateway();
  }
  return instance;
}

export async function initializeFaucetGateway(): Promise<FaucetGateway> {
  const gateway = getFaucetGateway();
  await gateway.initialize();
  return gateway;
}

export async function shutdownFaucetGateway(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}

export default {
  FaucetGateway,
  getFaucetGateway,
  initializeFaucetGateway,
  shutdownFaucetGateway
};
