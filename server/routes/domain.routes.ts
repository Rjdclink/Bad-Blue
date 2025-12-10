/**
 * Domain Consultation Routes
 * 
 * API routes for:
 * - Launching domain sub-agents
 * - Processing consultations
 * - Managing domain knowledge
 * - Orchestrator control
 */

import { Router, Request, Response } from 'express';
import {
  initializeOrchestrator,
  launchSubAgent,
  parallelExecution,
  performResearch,
  generateDraft,
  detectAndFixErrors,
  optimizeVisuals,
  getOrchestratorStatus,
  getAllDomainInfo,
  synchronizeCrawlerUpdate
} from '../fourJIOrchestrator';
import {
  initializeCrawler,
  runCrawlCycle,
  getCrawlerStatus,
  getCrawlerConfig,
  forceCrawlSource,
  setCrawlerEnabled
} from '../legalCrawler';
import {
  initializeSelfOptimization,
  getOptimizationStatus,
  getEvolutionLog,
  triggerOptimization,
  setOptimizationEnabled
} from '../selfOptimization';
import { asyncHandler } from '../errorHandler';

const router = Router();

// Track initialization status
let systemInitialized = false;

/**
 * Initialize all systems on first request
 */
async function ensureInitialized(): Promise<void> {
  if (systemInitialized) return;
  
  console.log('[Domain Routes] Initializing 4JI systems...');
  
  try {
    await initializeOrchestrator();
    await initializeCrawler();
    await initializeSelfOptimization();
    
    systemInitialized = true;
    console.log('[Domain Routes] 4JI systems initialized');
  } catch (error: any) {
    console.error('[Domain Routes] Initialization error:', error.message);
    throw error;
  }
}

// ============================================
// DOMAIN CONSULTATION ROUTES
// ============================================

/**
 * Launch a sub-agent for a specific domain
 * POST /api/domains/:domainId/consult
 */
router.post('/:domainId/consult', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const { domainId } = req.params;
  const { query, context, sessionId } = req.body;
  const userId = (req as any).user?.id || (req as any).user?.claims?.sub || 'anonymous';
  
  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }
  
  console.log(`[Domain Routes] Consultation request for ${domainId}`);
  
  const response = await launchSubAgent(domainId, {
    userId,
    query,
    context,
    sessionId
  });
  
  res.json({
    success: true,
    domainId,
    response
  });
}));

/**
 * Get domain information
 * GET /api/domains/:domainId
 */
router.get('/:domainId', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const { domainId } = req.params;
  const allDomains = await getAllDomainInfo();
  const domain = allDomains.find(d => d.id === domainId);
  
  if (!domain) {
    return res.status(404).json({ error: 'Domain not found' });
  }
  
  res.json({ domain });
}));

/**
 * List all available domains
 * GET /api/domains
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const domains = await getAllDomainInfo();
  const orchestratorStatus = getOrchestratorStatus();
  
  res.json({
    domains,
    stats: {
      totalDomains: domains.length,
      totalConsultations: orchestratorStatus.totalConsultations,
      domainStats: orchestratorStatus.domainStats
    }
  });
}));

/**
 * Perform parallel consultation across multiple domains
 * POST /api/domains/parallel-consult
 */
router.post('/parallel-consult', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const { domainIds, query, context } = req.body;
  const userId = (req as any).user?.id || (req as any).user?.claims?.sub || 'anonymous';
  
  if (!domainIds || !Array.isArray(domainIds) || domainIds.length === 0) {
    return res.status(400).json({ error: 'domainIds array is required' });
  }
  
  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }
  
  const results = await parallelExecution(domainIds, {
    userId,
    query,
    context
  });
  
  // Convert Map to object for JSON response
  const resultsObject: Record<string, any> = {};
  results.forEach((value, key) => {
    if (value instanceof Error) {
      resultsObject[key] = { error: value.message };
    } else {
      resultsObject[key] = value;
    }
  });
  
  res.json({
    success: true,
    results: resultsObject
  });
}));

/**
 * Perform deep research
 * POST /api/domains/research
 */
router.post('/research', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const { query, domainId } = req.body;
  
  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }
  
  const research = await performResearch(query, domainId);
  
  res.json({
    success: true,
    research
  });
}));

/**
 * Generate a legal document draft
 * POST /api/domains/:domainId/draft
 */
router.post('/:domainId/draft', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const { domainId } = req.params;
  const { documentType, context } = req.body;
  
  if (!documentType) {
    return res.status(400).json({ error: 'documentType is required' });
  }
  
  const draft = await generateDraft(documentType, context || {}, domainId);
  
  res.json({
    success: true,
    draft
  });
}));

// ============================================
// ORCHESTRATOR CONTROL ROUTES
// ============================================

/**
 * Get orchestrator status
 * GET /api/orchestrator/status
 */
router.get('/orchestrator/status', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const status = getOrchestratorStatus();
  
  res.json({ status });
}));

/**
 * Trigger error detection and fixing
 * POST /api/orchestrator/fix-errors
 */
router.post('/orchestrator/fix-errors', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const result = await detectAndFixErrors();
  
  res.json({
    success: true,
    result
  });
}));

/**
 * Trigger visual optimization
 * POST /api/orchestrator/optimize-visuals
 */
router.post('/orchestrator/optimize-visuals', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const result = await optimizeVisuals();
  
  res.json({
    success: true,
    result
  });
}));

// ============================================
// CRAWLER CONTROL ROUTES
// ============================================

/**
 * Get crawler status
 * GET /api/crawler/status
 */
router.get('/crawler/status', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const status = getCrawlerStatus();
  const config = getCrawlerConfig();
  
  res.json({ status, config });
}));

/**
 * Trigger crawler run
 * POST /api/crawler/run
 */
router.post('/crawler/run', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const result = await runCrawlCycle();
  
  res.json({
    success: true,
    result
  });
}));

/**
 * Force crawl a specific source
 * POST /api/crawler/force/:sourceId
 */
router.post('/crawler/force/:sourceId', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const { sourceId } = req.params;
  
  const result = await forceCrawlSource(sourceId);
  
  res.json({
    success: true,
    result
  });
}));

/**
 * Enable/disable crawler
 * POST /api/crawler/toggle
 */
router.post('/crawler/toggle', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const { enabled } = req.body;
  
  setCrawlerEnabled(enabled);
  
  res.json({
    success: true,
    enabled
  });
}));

/**
 * Manually push update to domain
 * POST /api/crawler/sync-update
 */
router.post('/crawler/sync-update', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const { domainId, cases, statutes, templates } = req.body;
  
  if (!domainId) {
    return res.status(400).json({ error: 'domainId is required' });
  }
  
  await synchronizeCrawlerUpdate({
    domainId,
    cases,
    statutes,
    templates
  });
  
  res.json({
    success: true,
    message: `Update synchronized to ${domainId}`
  });
}));

// ============================================
// SELF-OPTIMIZATION CONTROL ROUTES
// ============================================

/**
 * Get optimization status
 * GET /api/optimization/status
 */
router.get('/optimization/status', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const status = getOptimizationStatus();
  
  res.json({ status });
}));

/**
 * Get evolution log
 * GET /api/optimization/evolution
 */
router.get('/optimization/evolution', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const limit = parseInt(req.query.limit as string) || 50;
  const log = getEvolutionLog(limit);
  
  res.json({ log });
}));

/**
 * Trigger optimization cycle
 * POST /api/optimization/run
 */
router.post('/optimization/run', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const result = await triggerOptimization();
  
  res.json({
    success: true,
    result
  });
}));

/**
 * Enable/disable self-optimization
 * POST /api/optimization/toggle
 */
router.post('/optimization/toggle', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const { enabled } = req.body;
  
  setOptimizationEnabled(enabled);
  
  res.json({
    success: true,
    enabled
  });
}));

// ============================================
// SYSTEM HEALTH ROUTE
// ============================================

/**
 * Get overall system health
 * GET /api/system/health
 */
router.get('/system/health', asyncHandler(async (req: Request, res: Response) => {
  await ensureInitialized();
  
  const orchestratorStatus = getOrchestratorStatus();
  const crawlerStatus = getCrawlerStatus();
  const optimizationStatus = getOptimizationStatus();
  
  const health = {
    overall: optimizationStatus.currentHealth,
    components: {
      orchestrator: {
        healthy: orchestratorStatus.activeDomains.length > 0,
        domains: orchestratorStatus.activeDomains.length,
        consultations: orchestratorStatus.totalConsultations,
        errors: orchestratorStatus.errorCount
      },
      crawler: {
        healthy: !crawlerStatus.isRunning || crawlerStatus.errors < 5,
        running: crawlerStatus.isRunning,
        totalCrawled: crawlerStatus.totalCrawled,
        errors: crawlerStatus.errors
      },
      optimization: {
        healthy: optimizationStatus.currentHealth > 50,
        health: optimizationStatus.currentHealth,
        issuesFixed: optimizationStatus.issuesFixed,
        lastOptimization: optimizationStatus.lastOptimization
      }
    },
    metrics: optimizationStatus.metrics
  };
  
  res.json(health);
}));

export default router;
