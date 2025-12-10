/**
 * Admin Control Panel - 4JI-GENIE Administration Interface
 * 
 * Provides:
 * - Autonomy scheduler (weekly updates: Sunday 00:00)
 * - Module diagnostics (plain English synopsis only)
 * - Database shadow monitor
 * - Permissions matrix hub with approval checkboxes
 * - Crypto faucet and research run scheduling
 * - Install/download approval with detailed checkbox controller
 * 
 * AUTHENTICATION:
 * - Admin password: SARBEAR
 * - Identity binding: "Daddy" = internal system label for the user
 * - Prevents external actors from taking administrative roles
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../logger';
import { GenieController, getGenieController } from './index';
import { ImmutableRuleEngine, getRuleEngine } from './immutable-rules';

const log = createLogger('AdminPanel');

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export interface SchedulerConfig {
  enabled: boolean;
  weekday: 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
  hour: number; // 0-23
  minute: number; // 0-59
  lastRun: Date | null;
  nextRun: Date | null;
}

export interface ModuleDiagnostic {
  moduleName: string;
  status: 'healthy' | 'degraded' | 'error' | 'offline';
  synopsis: string; // Plain English description
  lastCheck: Date;
  metrics: {
    uptime: number;
    requestsProcessed: number;
    errorRate: number;
    avgResponseTimeMs: number;
  };
}

export interface DatabaseShadowStatus {
  primaryStorage: 'local' | 'supabase';
  shadowStorage: 'supabase';
  syncStatus: 'synced' | 'syncing' | 'out-of-sync' | 'error';
  lastSync: Date | null;
  pendingChanges: number;
  redundancyHealth: 'healthy' | 'degraded' | 'critical';
}

export interface PermissionEntry {
  id: string;
  name: string;
  category: 'crawler' | 'faucet' | 'install' | 'update' | 'upgrade' | 'package';
  description: string;
  approved: boolean;
  approvedBy: string | null;
  approvedAt: Date | null;
  scheduledFor: Date | null;
  weekday: string | null;
  timeSlot: string | null;
}

export interface InstallRequest {
  id: string;
  packageName: string;
  version: string;
  type: 'npm' | 'pip' | 'system' | 'custom';
  reason: string;
  requestedBy: string;
  requestedAt: Date;
  status: 'pending' | 'approved' | 'rejected' | 'installed';
  approvedBy: string | null;
  scheduledWeekday: string | null;
  scheduledTime: string | null;
}

export interface AdminPanelStatus {
  isAuthenticated: boolean;
  authenticatedUser: string | null;
  lastLogin: Date | null;
  genieStatus: 'running' | 'stopped' | 'error';
  schedulerStatus: 'active' | 'paused' | 'error';
  pendingApprovals: number;
}

// ============================================================================
// ADMIN CONTROL PANEL CLASS
// ============================================================================

export class AdminControlPanel extends EventEmitter {
  private static instance: AdminControlPanel | null = null;
  private genie: GenieController | null = null;
  private ruleEngine: ImmutableRuleEngine | null = null;
  private isAuthenticated: boolean = false;
  private authenticatedUser: string | null = null;
  private lastLogin: Date | null = null;

  private schedulerConfig: SchedulerConfig = {
    enabled: true,
    weekday: 'sunday',
    hour: 0,
    minute: 0,
    lastRun: null,
    nextRun: null,
  };

  private permissions: Map<string, PermissionEntry> = new Map();
  private installRequests: InstallRequest[] = [];

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): AdminControlPanel {
    if (!AdminControlPanel.instance) {
      AdminControlPanel.instance = new AdminControlPanel();
    }
    return AdminControlPanel.instance;
  }

  /**
   * Initialize the admin panel
   */
  async initialize(): Promise<void> {
    log.info('Initializing Admin Control Panel');

    this.genie = getGenieController();
    this.ruleEngine = getRuleEngine();
    this.ruleEngine.initialize();

    // Initialize default permissions
    this.initializeDefaultPermissions();

    // Calculate next scheduled run
    this.calculateNextRun();

    this.emit('initialized', { timestamp: new Date() });
    log.info('Admin Control Panel initialized');
  }

  /**
   * Authenticate with admin password
   */
  authenticate(password: string): boolean {
    const success = this.genie?.authenticate(password) ?? false;
    
    if (success) {
      this.isAuthenticated = true;
      this.authenticatedUser = 'Daddy';
      this.lastLogin = new Date();
      this.emit('authenticated', { timestamp: new Date() });
    }

    return success;
  }

  /**
   * Check if authenticated
   */
  isAdmin(): boolean {
    return this.isAuthenticated;
  }

  /**
   * Logout
   */
  logout(): void {
    this.isAuthenticated = false;
    this.authenticatedUser = null;
    this.genie?.logout();
    this.emit('logout', { timestamp: new Date() });
  }

  /**
   * Initialize default permission entries
   */
  private initializeDefaultPermissions(): void {
    const defaultPermissions: PermissionEntry[] = [
      {
        id: 'perm-alexara-crawler',
        name: 'ALEXARA Legal Crawler',
        category: 'crawler',
        description: 'Legal OSINT crawler: 5 min/hour, 24/7',
        approved: true,
        approvedBy: 'system',
        approvedAt: new Date(),
        scheduledFor: null,
        weekday: null,
        timeSlot: null,
      },
      {
        id: 'perm-cryptara-crawler',
        name: 'CRYPTARA Market Crawler',
        category: 'crawler',
        description: 'Crypto market surveillance: continuous monitoring',
        approved: true,
        approvedBy: 'system',
        approvedAt: new Date(),
        scheduledFor: null,
        weekday: null,
        timeSlot: null,
      },
      {
        id: 'perm-crypto-faucet',
        name: 'Crypto Faucet Trigger',
        category: 'faucet',
        description: 'Faucet-initiated crypto operations',
        approved: false,
        approvedBy: null,
        approvedAt: null,
        scheduledFor: null,
        weekday: null,
        timeSlot: null,
      },
      {
        id: 'perm-research-run',
        name: 'Research Run',
        category: 'crawler',
        description: 'Manual research crawling trigger',
        approved: false,
        approvedBy: null,
        approvedAt: null,
        scheduledFor: null,
        weekday: null,
        timeSlot: null,
      },
      {
        id: 'perm-weekly-update',
        name: 'Weekly System Update',
        category: 'update',
        description: 'Scheduled optimizations: Sunday 00:00',
        approved: true,
        approvedBy: 'system',
        approvedAt: new Date(),
        scheduledFor: null,
        weekday: 'sunday',
        timeSlot: '00:00',
      },
    ];

    for (const perm of defaultPermissions) {
      this.permissions.set(perm.id, perm);
    }
  }

  /**
   * Calculate next scheduled run
   */
  private calculateNextRun(): void {
    const now = new Date();
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDayIndex = weekdays.indexOf(this.schedulerConfig.weekday);
    const currentDayIndex = now.getDay();
    
    let daysUntil = targetDayIndex - currentDayIndex;
    if (daysUntil <= 0) {
      daysUntil += 7;
    }

    const nextRun = new Date(now);
    nextRun.setDate(nextRun.getDate() + daysUntil);
    nextRun.setHours(this.schedulerConfig.hour, this.schedulerConfig.minute, 0, 0);

    this.schedulerConfig.nextRun = nextRun;
  }

  // ============================================================================
  // MODULE DIAGNOSTICS (Plain English)
  // ============================================================================

  /**
   * Get module diagnostics in plain English
   */
  getModuleDiagnostics(): ModuleDiagnostic[] {
    const diagnostics: ModuleDiagnostic[] = [];

    // ALEXARA diagnostic
    const alexaraStatus = this.genie?.getAlexara()?.getStatus();
    diagnostics.push({
      moduleName: 'ALEXARA (Legal Intelligence)',
      status: alexaraStatus?.isRunning ? 'healthy' : 'offline',
      synopsis: alexaraStatus?.isRunning 
        ? `ALEXARA is running smoothly. It has processed ${alexaraStatus.totalResearchQueries} legal research queries and generated ${alexaraStatus.totalDocumentsGenerated} documents. ${alexaraStatus.isResearching ? 'Currently conducting legal research.' : 'Ready for new queries.'}`
        : 'ALEXARA is currently offline. Initialize 4JI-GENIE to start legal intelligence services.',
      lastCheck: new Date(),
      metrics: {
        uptime: alexaraStatus?.uptime ?? 0,
        requestsProcessed: alexaraStatus?.totalResearchQueries ?? 0,
        errorRate: alexaraStatus ? (alexaraStatus.errorCount / Math.max(alexaraStatus.totalResearchQueries, 1)) * 100 : 0,
        avgResponseTimeMs: 250,
      },
    });

    // CRYPTARA diagnostic
    const cryptaraStatus = this.genie?.getCryptara()?.getStatus();
    diagnostics.push({
      moduleName: 'CRYPTARA (Crypto Intelligence)',
      status: cryptaraStatus?.isRunning ? 'healthy' : 'offline',
      synopsis: cryptaraStatus?.isRunning
        ? `CRYPTARA is actively surveilling crypto markets. It has run ${cryptaraStatus.totalSimulations} Monte Carlo simulations, detected ${cryptaraStatus.totalPatterns} patterns, and generated ${cryptaraStatus.totalPredictions} predictions. Faucet status: ${cryptaraStatus.faucetStatus}.`
        : 'CRYPTARA is currently offline. Initialize 4JI-GENIE to start crypto surveillance.',
      lastCheck: new Date(),
      metrics: {
        uptime: cryptaraStatus?.uptime ?? 0,
        requestsProcessed: cryptaraStatus?.totalSimulations ?? 0,
        errorRate: cryptaraStatus ? (cryptaraStatus.errorCount / Math.max(cryptaraStatus.totalSimulations, 1)) * 100 : 0,
        avgResponseTimeMs: 500,
      },
    });

    // 4JI-GENIE diagnostic
    const genieStatus = this.genie?.getStatus();
    diagnostics.push({
      moduleName: '4JI-GENIE (Master Controller)',
      status: genieStatus?.isRunning ? 'healthy' : 'offline',
      synopsis: genieStatus?.isRunning
        ? `4JI-GENIE is orchestrating the system. It has routed ${genieStatus.totalRequests} requests (${genieStatus.legalRequests} legal, ${genieStatus.cryptoRequests} crypto, ${genieStatus.rejectedRequests} rejected). ${genieStatus.violations} domain violations have been blocked.`
        : 'The master controller is offline. Please initialize the system.',
      lastCheck: new Date(),
      metrics: {
        uptime: genieStatus?.uptime ?? 0,
        requestsProcessed: genieStatus?.totalRequests ?? 0,
        errorRate: genieStatus ? (genieStatus.rejectedRequests / Math.max(genieStatus.totalRequests, 1)) * 100 : 0,
        avgResponseTimeMs: 100,
      },
    });

    // Rule Engine diagnostic
    const ruleStatus = this.ruleEngine?.getStatus();
    diagnostics.push({
      moduleName: 'Immutable Rule Engine',
      status: ruleStatus?.initialized ? 'healthy' : 'offline',
      synopsis: ruleStatus?.initialized
        ? `The rule engine is enforcing ${ruleStatus.enabledRules} security rules. ${ruleStatus.totalViolations} total violations detected, ${ruleStatus.blockedViolations} were blocked. The system's boundaries are being maintained.`
        : 'Rule engine not initialized. System boundaries may not be enforced.',
      lastCheck: new Date(),
      metrics: {
        uptime: 0,
        requestsProcessed: ruleStatus?.totalViolations ?? 0,
        errorRate: 0,
        avgResponseTimeMs: 1,
      },
    });

    return diagnostics;
  }

  // ============================================================================
  // DATABASE SHADOW MONITOR
  // ============================================================================

  /**
   * Get database shadow status
   */
  getDatabaseShadowStatus(): DatabaseShadowStatus {
    // In production, this would query actual database sync status
    return {
      primaryStorage: 'local',
      shadowStorage: 'supabase',
      syncStatus: 'synced',
      lastSync: new Date(),
      pendingChanges: 0,
      redundancyHealth: 'healthy',
    };
  }

  // ============================================================================
  // PERMISSIONS MATRIX HUB
  // ============================================================================

  /**
   * Get all permissions
   */
  getPermissions(): PermissionEntry[] {
    return Array.from(this.permissions.values());
  }

  /**
   * Get permissions by category
   */
  getPermissionsByCategory(category: PermissionEntry['category']): PermissionEntry[] {
    return Array.from(this.permissions.values()).filter(p => p.category === category);
  }

  /**
   * Approve a permission
   */
  approvePermission(
    permissionId: string,
    weekday?: string,
    timeSlot?: string
  ): boolean {
    if (!this.isAuthenticated) {
      log.warn('Cannot approve permission: not authenticated');
      return false;
    }

    const permission = this.permissions.get(permissionId);
    if (!permission) {
      log.warn('Permission not found', { permissionId });
      return false;
    }

    permission.approved = true;
    permission.approvedBy = this.authenticatedUser;
    permission.approvedAt = new Date();
    permission.weekday = weekday ?? null;
    permission.timeSlot = timeSlot ?? null;

    log.info('Permission approved', { 
      permissionId, 
      approvedBy: this.authenticatedUser,
      weekday,
      timeSlot,
    });

    this.emit('permission:approved', permission);
    return true;
  }

  /**
   * Revoke a permission
   */
  revokePermission(permissionId: string): boolean {
    if (!this.isAuthenticated) {
      log.warn('Cannot revoke permission: not authenticated');
      return false;
    }

    const permission = this.permissions.get(permissionId);
    if (!permission) {
      log.warn('Permission not found', { permissionId });
      return false;
    }

    permission.approved = false;
    permission.approvedBy = null;
    permission.approvedAt = null;

    log.info('Permission revoked', { permissionId });
    this.emit('permission:revoked', permission);
    return true;
  }

  // ============================================================================
  // INSTALL/DOWNLOAD APPROVAL
  // ============================================================================

  /**
   * Request package installation
   */
  requestInstall(
    packageName: string,
    version: string,
    type: InstallRequest['type'],
    reason: string
  ): InstallRequest {
    const request: InstallRequest = {
      id: `install-${Date.now()}`,
      packageName,
      version,
      type,
      reason,
      requestedBy: 'system',
      requestedAt: new Date(),
      status: 'pending',
      approvedBy: null,
      scheduledWeekday: null,
      scheduledTime: null,
    };

    this.installRequests.push(request);
    log.info('Install request created', { packageName, version, type });
    this.emit('install:requested', request);

    return request;
  }

  /**
   * Approve install request with scheduling
   */
  approveInstall(
    requestId: string,
    weekday: string,
    timeSlot: string
  ): boolean {
    if (!this.isAuthenticated) {
      log.warn('Cannot approve install: not authenticated');
      return false;
    }

    const request = this.installRequests.find(r => r.id === requestId);
    if (!request) {
      log.warn('Install request not found', { requestId });
      return false;
    }

    request.status = 'approved';
    request.approvedBy = this.authenticatedUser;
    request.scheduledWeekday = weekday;
    request.scheduledTime = timeSlot;

    log.info('Install request approved', {
      requestId,
      packageName: request.packageName,
      scheduledFor: `${weekday} at ${timeSlot}`,
    });

    this.emit('install:approved', request);
    return true;
  }

  /**
   * Get pending install requests
   */
  getPendingInstalls(): InstallRequest[] {
    return this.installRequests.filter(r => r.status === 'pending');
  }

  /**
   * Get all install requests
   */
  getAllInstalls(): InstallRequest[] {
    return [...this.installRequests];
  }

  // ============================================================================
  // SCHEDULER CONFIGURATION
  // ============================================================================

  /**
   * Get scheduler configuration
   */
  getSchedulerConfig(): SchedulerConfig {
    return { ...this.schedulerConfig };
  }

  /**
   * Update scheduler configuration
   */
  updateScheduler(config: Partial<SchedulerConfig>): boolean {
    if (!this.isAuthenticated) {
      log.warn('Cannot update scheduler: not authenticated');
      return false;
    }

    this.schedulerConfig = { ...this.schedulerConfig, ...config };
    this.calculateNextRun();

    log.info('Scheduler updated', this.schedulerConfig);
    this.emit('scheduler:updated', this.schedulerConfig);
    return true;
  }

  // ============================================================================
  // STATUS AND MONITORING
  // ============================================================================

  /**
   * Get admin panel status
   */
  getStatus(): AdminPanelStatus {
    const genieStatus = this.genie?.getStatus();
    const pendingApprovals = this.installRequests.filter(r => r.status === 'pending').length;

    return {
      isAuthenticated: this.isAuthenticated,
      authenticatedUser: this.authenticatedUser,
      lastLogin: this.lastLogin,
      genieStatus: genieStatus?.isRunning ? 'running' : 'stopped',
      schedulerStatus: this.schedulerConfig.enabled ? 'active' : 'paused',
      pendingApprovals,
    };
  }

  /**
   * Reset singleton (for testing)
   */
  static reset(): void {
    AdminControlPanel.instance = null;
  }
}

// Export singleton getter
export const getAdminPanel = (): AdminControlPanel => {
  return AdminControlPanel.getInstance();
};

export default AdminControlPanel;
