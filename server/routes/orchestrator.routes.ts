/**
 * 4JI Orchestrator API Routes
 * 
 * API endpoints for controlling the ForgeAI unified orchestrator system.
 * Requires FORGEAI master password for authentication.
 */

import express from 'express';
import { ForgeAI, Domain, DomainFirewall, LegalWhatOrchestrator, SubAgentCoordinator, type OrchestratedTask } from '../services/4ji-orchestrator';
import { createLogger } from '../logger';
import { TaskPriority } from '../aiTokenGovernor';

const router = express.Router();
const log = createLogger('4JI-API');

// In-memory state for tracking
let lastEvolutionRun: Date | null = null;

const ORCHESTRATOR_CAPABILITIES = new Set([
  'reasoning', 'coding', 'legal-analysis', 'creative-writing', 'data-extraction',
  'pattern-recognition', 'visual-analysis', 'long-context', 'fast-inference',
  'research', 'trading-analysis', 'market-prediction', 'blockchain-interaction',
  'document-generation', 'verification', 'orchestration',
]);

const PRIORITY_BY_NAME: Record<string, TaskPriority> = {
  critical: TaskPriority.CRITICAL_USER,
  high: TaskPriority.HIGH_USER,
  medium: TaskPriority.MEDIUM_BACKGROUND,
  low: TaskPriority.LOW_BACKGROUND,
};

// GET /api/orchestrator/status - Get orchestrator status
router.get('/status', async (req, res) => {
  try {
    const status = ForgeAI.getStatus();
    res.json({
      success: true,
      ...status,
      lastEvolutionRun: lastEvolutionRun?.toISOString() || null,
    });
  } catch (error: any) {
    log.error('Failed to get orchestrator status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/orchestrator/start - Start the orchestrator
router.post('/start', async (req, res) => {
  try {
    const status = ForgeAI.getStatus();
    
    if (status.isRunning) {
      return res.status(400).json({ 
        success: false, 
        error: 'Orchestrator is already running' 
      });
    }
    
    if (!status.isInitialized) {
      log.info('Initializing ForgeAI...');
      await ForgeAI.initialize();
    }
    
    log.info('Starting ForgeAI...');
    await ForgeAI.start();
    
    const newStatus = ForgeAI.getStatus();
    res.json({
      success: true,
      message: 'Orchestrator started successfully',
      status: newStatus,
    });
  } catch (error: any) {
    log.error('Failed to start orchestrator:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/orchestrator/stop - Stop the orchestrator
router.post('/stop', async (req, res) => {
  try {
    const status = ForgeAI.getStatus();
    
    if (!status.isRunning) {
      return res.status(400).json({ 
        success: false, 
        error: 'Orchestrator is not running' 
      });
    }
    
    log.info('Stopping ForgeAI...');
    ForgeAI.stop();
    
    res.json({
      success: true,
      message: 'Orchestrator stopped',
      uptime: status.uptime,
    });
  } catch (error: any) {
    log.error('Failed to stop orchestrator:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/orchestrator/task - Execute a real AI task in one isolated domain
router.post('/task', async (req, res) => {
  try {
    const { domain, type, prompt, systemPrompt, capabilities, priority, maxTokens, temperature, metadata } = req.body ?? {};

    if (domain !== 'legal' && domain !== 'crypto') {
      return res.status(400).json({ success: false, error: 'domain must be "legal" or "crypto"' });
    }
    if (typeof type !== 'string' || !type.trim() || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ success: false, error: 'type and prompt are required strings' });
    }
    if (!Array.isArray(capabilities) || capabilities.length === 0 || !capabilities.every((capability) => typeof capability === 'string' && ORCHESTRATOR_CAPABILITIES.has(capability))) {
      return res.status(400).json({ success: false, error: 'capabilities must be a non-empty list of supported capability names' });
    }

    const status = ForgeAI.getStatus();
    if (!status.isRunning) {
      return res.status(400).json({ success: false, error: 'Orchestrator must be running to execute a task' });
    }

    const requestedPriority = typeof priority === 'string' ? PRIORITY_BY_NAME[priority.toLowerCase()] : undefined;
    const task: OrchestratedTask = {
      id: `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      domain: domain === 'legal' ? Domain.LEGAL_WHAT : Domain.CRYPTO_CRAWLER,
      type: type.trim(),
      prompt: prompt.trim(),
      requiredCapabilities: capabilities,
      priority: requestedPriority ?? TaskPriority.MEDIUM_BACKGROUND,
      systemPrompt: typeof systemPrompt === 'string' ? systemPrompt : undefined,
      maxTokens: typeof maxTokens === 'number' ? Math.max(1, Math.min(Math.floor(maxTokens), 32768)) : undefined,
      temperature: typeof temperature === 'number' ? Math.max(0, Math.min(temperature, 2)) : undefined,
      metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : undefined,
    };

    const result = await ForgeAI.executeTask(task);
    res.status(result.success ? 200 : 502).json({ success: result.success, task, result });
  } catch (error: any) {
    log.error('Failed to execute orchestrated task:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/orchestrator/agents/:agentId/tasks - Queue an autonomous AI task for one sub-agent
router.post('/agents/:agentId/tasks', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { type, payload, priority } = req.body ?? {};

    if (typeof type !== 'string' || !type.trim()) {
      return res.status(400).json({ success: false, error: 'type is required' });
    }
    if (payload === undefined) {
      return res.status(400).json({ success: false, error: 'payload is required' });
    }

    SubAgentCoordinator.initialize();
    const agent = SubAgentCoordinator.getAgent(agentId);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Sub-agent not found' });
    }

    const normalizedPriority = typeof priority === 'number' ? Math.max(1, Math.min(Math.floor(priority), 10)) : 5;
    const taskId = await SubAgentCoordinator.assignTask(agentId, type.trim(), payload, normalizedPriority);
    res.status(202).json({ success: true, taskId, agentId, status: 'queued' });
  } catch (error: any) {
    log.error('Failed to assign sub-agent task:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/orchestrator/legal/document - Generate a legal document through LegalWhat
router.post('/legal/document', async (req, res) => {
  try {
    const { documentType, templateData } = req.body ?? {};
    if (typeof documentType !== 'string' || !documentType.trim() || !templateData || typeof templateData !== 'object' || Array.isArray(templateData)) {
      return res.status(400).json({ success: false, error: 'documentType and an object templateData are required' });
    }

    await LegalWhatOrchestrator.start();
    const result = await LegalWhatOrchestrator.generateDocument(documentType.trim(), templateData);
    res.json({ success: true, result });
  } catch (error: any) {
    log.error('Failed to generate LegalWhat document:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/orchestrator/legal/evidence - Analyze evidence through LegalWhat
router.post('/legal/evidence', async (req, res) => {
  try {
    const { evidence } = req.body ?? {};
    if (evidence === undefined) {
      return res.status(400).json({ success: false, error: 'evidence is required' });
    }

    await LegalWhatOrchestrator.start();
    const result = await LegalWhatOrchestrator.analyzeEvidence(evidence);
    res.json({ success: true, result });
  } catch (error: any) {
    log.error('Failed to analyze LegalWhat evidence:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/orchestrator/evolve - Trigger evolution cycle
router.post('/evolve', async (req, res) => {
  try {
    const { domain } = req.body;
    
    if (!domain || !['legal', 'crypto', 'both'].includes(domain)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid domain. Must be "legal", "crypto", or "both"' 
      });
    }
    
    const status = ForgeAI.getStatus();
    if (!status.isRunning) {
      return res.status(400).json({ 
        success: false, 
        error: 'Orchestrator must be running to trigger evolution' 
      });
    }
    
    log.info(`Triggering evolution for domain: ${domain}`);
    
    if (domain === 'legal' || domain === 'both') {
      await ForgeAI.triggerEvolution(Domain.LEGAL_WHAT);
    }
    if (domain === 'crypto' || domain === 'both') {
      await ForgeAI.triggerEvolution(Domain.CRYPTO_CRAWLER);
    }
    
    lastEvolutionRun = new Date();
    
    res.json({
      success: true,
      message: `Evolution triggered for ${domain}`,
      timestamp: lastEvolutionRun.toISOString(),
    });
  } catch (error: any) {
    log.error('Failed to trigger evolution:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/orchestrator/models - Get loaded AI models
router.get('/models', async (req, res) => {
  try {
    const status = ForgeAI.getStatus();
    
    // Return model info (simplified for API)
    res.json({
      success: true,
      modelsLoaded: status.modelsLoaded,
      domains: {
        legalwhat: {
          activeSubAgents: status.legalwhatStats.activeSubAgents,
          workerFunctions: status.legalwhatStats.workerFunctions,
        },
        cryptocrawler: {
          activeSubAgents: status.cryptocrawlerStats.activeSubAgents,
          workerFunctions: status.cryptocrawlerStats.workerFunctions,
        },
      },
    });
  } catch (error: any) {
    log.error('Failed to get models:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/orchestrator/domain/:domain - Get domain-specific stats
router.get('/domain/:domain', async (req, res) => {
  try {
    const { domain } = req.params;
    
    if (!['legal', 'crypto'].includes(domain)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid domain. Must be "legal" or "crypto"' 
      });
    }
    
    const domainEnum = domain === 'legal' ? Domain.LEGAL_WHAT : Domain.CRYPTO_CRAWLER;
    const stats = DomainFirewall.getDomainStats(domainEnum);
    const status = ForgeAI.getStatus();
    const domainStats = domain === 'legal' ? status.legalwhatStats : status.cryptocrawlerStats;
    
    res.json({
      success: true,
      domain,
      stats: {
        operations: domainStats.operations,
        errors: domainStats.errors,
        evolutionCycles: domainStats.evolutionCycles,
        lastActivity: domainStats.lastActivity?.toISOString() || null,
        activeSubAgents: domainStats.activeSubAgents,
        workerFunctions: domainStats.workerFunctions,
        unresolvedErrors: stats.unresolvedErrors,
      },
    });
  } catch (error: any) {
    log.error('Failed to get domain stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/orchestrator/isolation - Check domain isolation
router.get('/isolation', async (req, res) => {
  try {
    const isolation = DomainFirewall.verifyIsolation();
    
    res.json({
      success: true,
      ...isolation,
    });
  } catch (error: any) {
    log.error('Failed to verify isolation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/orchestrator/diagnostics - Run system diagnostics
router.post('/diagnostics', async (req, res) => {
  try {
    const status = ForgeAI.getStatus();
    const isolation = DomainFirewall.verifyIsolation();
    
    const diagnostics = {
      timestamp: new Date().toISOString(),
      orchestrator: {
        initialized: status.isInitialized,
        running: status.isRunning,
        uptime: status.uptime,
        health: status.systemHealth,
      },
      models: {
        loaded: status.modelsLoaded,
        totalOperations: status.totalOperations,
      },
      domains: {
        isolation: isolation.isIsolated,
        violations: isolation.violations,
        legal: {
          operations: status.legalwhatStats.operations,
          errors: status.legalwhatStats.errors,
          subAgents: status.legalwhatStats.activeSubAgents,
        },
        crypto: {
          operations: status.cryptocrawlerStats.operations,
          errors: status.cryptocrawlerStats.errors,
          subAgents: status.cryptocrawlerStats.activeSubAgents,
        },
      },
      recommendations: [] as string[],
    };
    
    // Generate recommendations
    if (!status.isRunning) {
      diagnostics.recommendations.push('Start the orchestrator to enable AI operations');
    }
    if (status.systemHealth < 80) {
      diagnostics.recommendations.push('System health is below optimal. Check for errors.');
    }
    if (!isolation.isIsolated) {
      diagnostics.recommendations.push('CRITICAL: Domain isolation breach detected!');
    }
    if (isolation.violations > 0) {
      diagnostics.recommendations.push(`${isolation.violations} isolation violations detected. Review security logs.`);
    }
    
    res.json({
      success: true,
      diagnostics,
    });
  } catch (error: any) {
    log.error('Failed to run diagnostics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export { router as orchestratorApi };
