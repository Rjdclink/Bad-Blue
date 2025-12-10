/**
 * 4JI Orchestrator API Routes
 * 
 * API endpoints for controlling the ForgeAI unified orchestrator system.
 * Requires FORGEAI master password for authentication.
 */

import express from 'express';
import { ForgeAI, Domain, DomainFirewall } from '../services/4ji-orchestrator';
import { createLogger } from '../logger';

const router = express.Router();
const log = createLogger('4JI-API');

// In-memory state for tracking
let lastEvolutionRun: Date | null = null;

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
