/**
 * 4JI-GENIE API Routes
 * 
 * API endpoints for the dual-module AI system:
 * - Authentication (SARBEAR password)
 * - Request routing to ALEXARA or CRYPTARA
 * - Admin panel access
 * - Module diagnostics
 * - Permissions management
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../logger';
import { GenieController, getGenieController, type GenieRequest } from '../services/genie-controller';
import { AdminControlPanel, getAdminPanel } from '../services/genie-controller/admin-panel';
import { ImmutableRuleEngine, getRuleEngine } from '../services/genie-controller/immutable-rules';
import { authRateLimit } from '../rateLimit';

const log = createLogger('GenieRoutes');
const router = Router();

// ============================================================================
// INITIALIZATION
// ============================================================================

let genie: GenieController | null = null;
let adminPanel: AdminControlPanel | null = null;
let ruleEngine: ImmutableRuleEngine | null = null;
let initializationPromise: Promise<void> | null = null;

/**
 * Initialize the 4JI-GENIE system (cached initialization)
 */
async function initializeGenie(): Promise<void> {
  // Return existing initialization promise if one is in progress
  if (initializationPromise) {
    return initializationPromise;
  }
  
  // If already initialized, return immediately
  if (genie && adminPanel && ruleEngine) {
    return;
  }
  
  // Create and cache the initialization promise
  initializationPromise = (async () => {
    if (!genie) {
      genie = getGenieController();
      await genie.initialize();
    }
    if (!adminPanel) {
      adminPanel = getAdminPanel();
      await adminPanel.initialize();
    }
    if (!ruleEngine) {
      ruleEngine = getRuleEngine();
      ruleEngine.initialize();
    }
  })();
  
  await initializationPromise;
}

// ============================================================================
// AUTHENTICATION ROUTES
// ============================================================================

/**
 * POST /api/genie/auth/login
 * Authenticate with admin password
 */
router.post('/auth/login', authRateLimit, async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password is required' 
      });
    }

    await initializeGenie();
    
    const success = adminPanel?.authenticate(password) ?? false;
    
    if (success) {
      return res.json({ 
        success: true, 
        message: 'Authenticated as Daddy',
        user: 'Daddy',
      });
    } else {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid password' 
      });
    }
  } catch (error: any) {
    log.error('Login error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/genie/auth/logout
 * Logout from admin session
 */
router.post('/auth/logout', async (req: Request, res: Response) => {
  try {
    adminPanel?.logout();
    return res.json({ success: true, message: 'Logged out' });
  } catch (error: any) {
    log.error('Logout error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/genie/auth/status
 * Get authentication status
 */
router.get('/auth/status', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    const isAdmin = adminPanel?.isAdmin() ?? false;
    
    return res.json({ 
      success: true, 
      authenticated: isAdmin,
      user: isAdmin ? 'Daddy' : null,
    });
  } catch (error: any) {
    log.error('Auth status error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ============================================================================
// REQUEST ROUTING ROUTES
// ============================================================================

/**
 * POST /api/genie/route
 * Route a request to ALEXARA or CRYPTARA
 */
router.post('/route', async (req: Request, res: Response) => {
  try {
    const { query, userId, sessionId, context, forceDomain } = req.body;
    
    if (!query) {
      return res.status(400).json({ 
        success: false, 
        error: 'Query is required' 
      });
    }

    await initializeGenie();
    
    const request: GenieRequest = {
      query,
      userId,
      sessionId,
      context,
      forceDomain,
    };

    const response = await genie?.route(request);
    
    return res.json(response);
  } catch (error: any) {
    log.error('Route error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message,
      routedTo: 'REJECTED',
    });
  }
});

// ============================================================================
// MODULE STATUS ROUTES
// ============================================================================

/**
 * GET /api/genie/status
 * Get overall system status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    const genieStatus = genie?.getStatus();
    const panelStatus = adminPanel?.getStatus();
    const ruleStatus = ruleEngine?.getStatus();
    
    return res.json({
      success: true,
      genie: genieStatus,
      adminPanel: panelStatus,
      ruleEngine: ruleStatus,
    });
  } catch (error: any) {
    log.error('Status error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/genie/diagnostics
 * Get module diagnostics in plain English
 */
router.get('/diagnostics', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    const diagnostics = adminPanel?.getModuleDiagnostics() ?? [];
    
    return res.json({
      success: true,
      diagnostics,
    });
  } catch (error: any) {
    log.error('Diagnostics error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/genie/alexara/status
 * Get ALEXARA status
 */
router.get('/alexara/status', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    const alexara = genie?.getAlexara();
    const status = alexara?.getStatus();
    const crawlerSchedule = alexara?.getCrawlerSchedule();
    
    return res.json({
      success: true,
      status,
      crawlerSchedule,
    });
  } catch (error: any) {
    log.error('ALEXARA status error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/genie/cryptara/status
 * Get CRYPTARA status
 */
router.get('/cryptara/status', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    const cryptara = genie?.getCryptara();
    const status = cryptara?.getStatus();
    const patterns = cryptara?.getRecentPatterns();
    const predictions = cryptara?.getRecentPredictions();
    
    return res.json({
      success: true,
      status,
      recentPatterns: patterns?.slice(-10),
      recentPredictions: predictions?.slice(-10),
    });
  } catch (error: any) {
    log.error('CRYPTARA status error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ============================================================================
// ADMIN PANEL ROUTES
// ============================================================================

/**
 * GET /api/genie/admin/database-shadow
 * Get database shadow sync status
 */
router.get('/admin/database-shadow', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    const shadowStatus = adminPanel?.getDatabaseShadowStatus();
    
    return res.json({
      success: true,
      shadowStatus,
    });
  } catch (error: any) {
    log.error('Database shadow status error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/genie/admin/scheduler
 * Get scheduler configuration
 */
router.get('/admin/scheduler', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    const scheduler = adminPanel?.getSchedulerConfig();
    
    return res.json({
      success: true,
      scheduler,
    });
  } catch (error: any) {
    log.error('Scheduler error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * PUT /api/genie/admin/scheduler
 * Update scheduler configuration (requires authentication)
 */
router.put('/admin/scheduler', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    if (!adminPanel?.isAdmin()) {
      return res.status(403).json({ 
        success: false, 
        error: 'Authentication required' 
      });
    }
    
    const { enabled, weekday, hour, minute } = req.body;
    
    const success = adminPanel.updateScheduler({ enabled, weekday, hour, minute });
    
    return res.json({
      success,
      scheduler: adminPanel.getSchedulerConfig(),
    });
  } catch (error: any) {
    log.error('Scheduler update error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ============================================================================
// PERMISSIONS ROUTES
// ============================================================================

/**
 * GET /api/genie/permissions
 * Get all permissions
 */
router.get('/permissions', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    const permissions = adminPanel?.getPermissions() ?? [];
    
    return res.json({
      success: true,
      permissions,
    });
  } catch (error: any) {
    log.error('Permissions error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/genie/permissions/:id/approve
 * Approve a permission (requires authentication)
 */
router.post('/permissions/:id/approve', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    if (!adminPanel?.isAdmin()) {
      return res.status(403).json({ 
        success: false, 
        error: 'Authentication required' 
      });
    }
    
    const { id } = req.params;
    const { weekday, timeSlot } = req.body;
    
    const success = adminPanel.approvePermission(id, weekday, timeSlot);
    
    return res.json({
      success,
      permissions: adminPanel.getPermissions(),
    });
  } catch (error: any) {
    log.error('Permission approval error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/genie/permissions/:id/revoke
 * Revoke a permission (requires authentication)
 */
router.post('/permissions/:id/revoke', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    if (!adminPanel?.isAdmin()) {
      return res.status(403).json({ 
        success: false, 
        error: 'Authentication required' 
      });
    }
    
    const { id } = req.params;
    
    const success = adminPanel.revokePermission(id);
    
    return res.json({
      success,
      permissions: adminPanel.getPermissions(),
    });
  } catch (error: any) {
    log.error('Permission revocation error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ============================================================================
// INSTALL REQUESTS ROUTES
// ============================================================================

/**
 * GET /api/genie/installs
 * Get all install requests
 */
router.get('/installs', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    const installs = adminPanel?.getAllInstalls() ?? [];
    const pending = adminPanel?.getPendingInstalls() ?? [];
    
    return res.json({
      success: true,
      all: installs,
      pending,
    });
  } catch (error: any) {
    log.error('Installs error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/genie/installs/:id/approve
 * Approve an install request (requires authentication)
 */
router.post('/installs/:id/approve', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    if (!adminPanel?.isAdmin()) {
      return res.status(403).json({ 
        success: false, 
        error: 'Authentication required' 
      });
    }
    
    const { id } = req.params;
    const { weekday, timeSlot } = req.body;
    
    if (!weekday || !timeSlot) {
      return res.status(400).json({ 
        success: false, 
        error: 'weekday and timeSlot are required' 
      });
    }
    
    const success = adminPanel.approveInstall(id, weekday, timeSlot);
    
    return res.json({
      success,
      installs: adminPanel.getAllInstalls(),
    });
  } catch (error: any) {
    log.error('Install approval error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ============================================================================
// RULES ROUTES
// ============================================================================

/**
 * GET /api/genie/rules
 * Get all immutable rules
 */
router.get('/rules', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    const rules = ruleEngine?.getRules() ?? [];
    const violations = ruleEngine?.getViolations() ?? [];
    
    return res.json({
      success: true,
      rules,
      recentViolations: violations.slice(-20),
      status: ruleEngine?.getStatus(),
    });
  } catch (error: any) {
    log.error('Rules error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET /api/genie/violations
 * Get domain violations
 */
router.get('/violations', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    const genieViolations = genie?.getViolations() ?? [];
    const ruleViolations = ruleEngine?.getViolations() ?? [];
    
    return res.json({
      success: true,
      domainViolations: genieViolations,
      ruleViolations,
    });
  } catch (error: any) {
    log.error('Violations error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ============================================================================
// CRYPTARA FAUCET ROUTE
// ============================================================================

/**
 * POST /api/genie/cryptara/faucet
 * Trigger CRYPTARA faucet operation (requires authentication)
 */
router.post('/cryptara/faucet', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    if (!adminPanel?.isAdmin()) {
      return res.status(403).json({ 
        success: false, 
        error: 'Authentication required' 
      });
    }
    
    const { operationType } = req.body;
    
    if (!operationType) {
      return res.status(400).json({ 
        success: false, 
        error: 'operationType is required (simulation or evolution)' 
      });
    }
    
    const cryptara = genie?.getCryptara();
    await cryptara?.triggerFaucet(operationType);
    
    return res.json({
      success: true,
      message: `Faucet triggered: ${operationType}`,
      status: cryptara?.getStatus(),
    });
  } catch (error: any) {
    log.error('Faucet trigger error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/genie/cryptara/simulation
 * Run Monte Carlo simulation (requires authentication)
 */
router.post('/cryptara/simulation', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    if (!adminPanel?.isAdmin()) {
      return res.status(403).json({ 
        success: false, 
        error: 'Authentication required' 
      });
    }
    
    const cryptara = genie?.getCryptara();
    const result = await cryptara?.runMonteCarloSimulation();
    
    return res.json({
      success: true,
      simulation: result,
    });
  } catch (error: any) {
    log.error('Simulation error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ============================================================================
// ALEXARA RESEARCH ROUTE
// ============================================================================

/**
 * POST /api/genie/alexara/research
 * Perform legal research via ALEXARA
 */
router.post('/alexara/research', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    const { query, jurisdiction, lawType, userId, sessionId, context } = req.body;
    
    if (!query) {
      return res.status(400).json({ 
        success: false, 
        error: 'query is required' 
      });
    }
    
    const alexara = genie?.getAlexara();
    const result = await alexara?.performResearch({
      query,
      jurisdiction,
      lawType,
      userId,
      sessionId,
      context,
    });
    
    return res.json({
      success: true,
      result,
    });
  } catch (error: any) {
    log.error('Research error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * POST /api/genie/alexara/document
 * Generate legal document via ALEXARA
 */
router.post('/alexara/document', async (req: Request, res: Response) => {
  try {
    await initializeGenie();
    
    const { documentType, jurisdiction, context, userId } = req.body;
    
    if (!documentType || !jurisdiction) {
      return res.status(400).json({ 
        success: false, 
        error: 'documentType and jurisdiction are required' 
      });
    }
    
    const alexara = genie?.getAlexara();
    const result = await alexara?.generateDocument({
      documentType,
      jurisdiction,
      context: context || {},
      userId,
    });
    
    return res.json({
      success: true,
      result,
    });
  } catch (error: any) {
    log.error('Document generation error', { error });
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

export default router;
