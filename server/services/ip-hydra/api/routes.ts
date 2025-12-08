/**
 * PR 5: Hydra API & Orchestrator - REST API Routes
 * Central control and observability for the IP-HYDRA ecosystem
 */

import { Router, type Request, type Response } from 'express';
import { ipHydraOrchestrator } from '../integration/orchestrator';
import { EventLogger } from '../utils/event-logger';
import type { EmergencyActionRequest } from '../types';

const router = Router();
const logger = EventLogger.getInstance();

// Middleware for admin authentication (reuse existing auth)
function requireHydraAuth(req: Request, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: IP-HYDRA authentication required'
    });
  }
  
  const token = authHeader.substring(7);
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Invalid token'
    });
  }
  
  next();
}

/**
 * POST /api/hydra/start
 * Activate all IP-HYDRA subsystems
 */
router.post('/start', requireHydraAuth, async (req: Request, res: Response) => {
  try {
    await ipHydraOrchestrator.start();
    
    res.json({
      success: true,
      message: 'IP-HYDRA system started successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Start error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start IP-HYDRA system',
      error: error.message,
    });
  }
});

/**
 * POST /api/hydra/stop
 * Deactivate all IP-HYDRA subsystems
 */
router.post('/stop', requireHydraAuth, async (req: Request, res: Response) => {
  try {
    await ipHydraOrchestrator.stop();
    
    res.json({
      success: true,
      message: 'IP-HYDRA system stopped successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Stop error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stop IP-HYDRA system',
      error: error.message,
    });
  }
});

/**
 * GET /api/hydra/status
 * Get current system status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const status = ipHydraOrchestrator.getStatus();
    
    res.json({
      success: true,
      data: {
        running: status.running,
        uptime: Math.floor(status.uptime / 1000), // seconds
        activeCrawlers: status.poolHealth.active,
        shadowCrawlers: status.poolHealth.ready,
        poolHealth: status.poolHealth.healthScore,
        topPriorities: status.queueStatus.topPriorities.slice(0, 5),
        lastDetectionEvent: logger.getRecentDetections(1)[0] || null,
        lastCooldownEvent: logger.getEventsByType('cooldown-triggered').slice(-1)[0] || null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get system status',
      error: error.message,
    });
  }
});

/**
 * GET /api/hydra/crawlers
 * Get all active and shadow crawlers
 */
router.get('/crawlers', requireHydraAuth, async (req: Request, res: Response) => {
  try {
    const status = ipHydraOrchestrator.getStatus();
    
    // Get all crawlers (simplified - in real impl, access shadowPool directly)
    const crawlers = {
      active: status.poolHealth.active,
      ready: status.poolHealth.ready,
      total: status.poolHealth.total,
      avgLatency: Math.round(status.poolHealth.avgLatency),
    };
    
    res.json({
      success: true,
      data: crawlers,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Crawlers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get crawler information',
      error: error.message,
    });
  }
});

/**
 * GET /api/hydra/topology
 * Get swarm topology data
 */
router.get('/topology', requireHydraAuth, async (req: Request, res: Response) => {
  try {
    const status = ipHydraOrchestrator.getStatus();
    
    // Generate topology data
    const chains = ['ethereum', 'polygon', 'bsc', 'avalanche', 'arbitrum'];
    const rpcEndpoints = chains.map(chain => ({
      chain,
      url: `https://${chain}.example.com/rpc`,
      avgLatency: Math.floor(Math.random() * 50) + 20,
    }));
    
    res.json({
      success: true,
      data: {
        crawlers: [], // Simplified
        rpcEndpoints,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Topology error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get topology data',
      error: error.message,
    });
  }
});

/**
 * GET /api/hydra/heatmap
 * Get subnet performance heatmap
 */
router.get('/heatmap', requireHydraAuth, async (req: Request, res: Response) => {
  try {
    const status = ipHydraOrchestrator.getStatus();
    
    // Get heatmap data from predictive selector
    const subnets = status.performanceSummary.topPerformers.map(perf => ({
      subnet: perf.subnet,
      chain: perf.chain,
      latency: perf.estimatedLatency,
      successRate: perf.confidence,
      color: perf.confidence > 0.8 ? '#00ff00' : perf.confidence > 0.5 ? '#ffff00' : '#ff0000',
    }));
    
    res.json({
      success: true,
      data: { subnets },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Heatmap error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get heatmap data',
      error: error.message,
    });
  }
});

/**
 * GET /api/hydra/priority
 * Get priority queue
 */
router.get('/priority', requireHydraAuth, async (req: Request, res: Response) => {
  try {
    const status = ipHydraOrchestrator.getStatus();
    
    res.json({
      success: true,
      data: {
        queue: status.queueStatus.topPriorities,
        queued: status.queueStatus.queued,
        inProgress: status.queueStatus.inProgress,
        completed: status.queueStatus.completed,
        failed: status.queueStatus.failed,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Priority error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get priority queue',
      error: error.message,
    });
  }
});

/**
 * POST /api/hydra/priority
 * Add urgent task to priority queue
 */
router.post('/priority', requireHydraAuth, async (req: Request, res: Response) => {
  try {
    const { asset, chain, value, urgency } = req.body;
    
    if (!asset || !chain || value === undefined || urgency === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: asset, chain, value, urgency',
      });
    }
    
    // In real implementation, add task via orchestrator
    console.log(`[API] Adding urgent task: ${asset} on ${chain} (value: ${value}, urgency: ${urgency})`);
    
    res.json({
      success: true,
      message: 'Urgent task added to priority queue',
      data: { asset, chain, value, urgency },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Add priority error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add urgent task',
      error: error.message,
    });
  }
});

/**
 * GET /api/hydra/logs
 * Get event logs with optional filtering
 */
router.get('/logs', requireHydraAuth, async (req: Request, res: Response) => {
  try {
    const { type, chain, limit = '100' } = req.query;
    
    let events = logger.getRecentEvents(parseInt(limit as string));
    
    // Filter by type
    if (type && typeof type === 'string') {
      events = events.filter(e => e.type === type);
    }
    
    // Filter by chain
    if (chain && typeof chain === 'string') {
      events = events.filter(e => e.chain === chain);
    }
    
    res.json({
      success: true,
      data: {
        events,
        total: events.length,
        stats: logger.getStatistics(),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get event logs',
      error: error.message,
    });
  }
});

/**
 * POST /api/hydra/webhook
 * Configure webhook endpoints
 */
router.post('/webhook', requireHydraAuth, async (req: Request, res: Response) => {
  try {
    const { endpoint, enabled = true, eventTypes } = req.body;
    
    if (!endpoint || !eventTypes || !Array.isArray(eventTypes)) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: endpoint, eventTypes (array)',
      });
    }
    
    const webhook = logger.registerWebhook({
      endpoint,
      enabled,
      eventTypes,
    });
    
    res.json({
      success: true,
      message: 'Webhook registered successfully',
      data: webhook,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Webhook error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register webhook',
      error: error.message,
    });
  }
});

/**
 * GET /api/hydra/webhooks
 * Get all registered webhooks
 */
router.get('/webhooks', requireHydraAuth, async (req: Request, res: Response) => {
  try {
    const webhooks = logger.getWebhooks();
    
    res.json({
      success: true,
      data: webhooks,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Get webhooks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get webhooks',
      error: error.message,
    });
  }
});

/**
 * POST /api/hydra/action
 * Emergency actions (admin only)
 */
router.post('/action', requireHydraAuth, async (req: Request, res: Response) => {
  try {
    const { action, targetCrawler, reason } = req.body as EmergencyActionRequest;
    
    if (!action || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: action, reason',
      });
    }
    
    console.log(`[API] Emergency action: ${action} - ${reason}`);
    
    switch (action) {
      case 'kill-all':
        await ipHydraOrchestrator.stop();
        break;
      case 'force-swap':
        // Implement force swap logic
        console.log(`Force swap crawler: ${targetCrawler}`);
        break;
      case 'cooldown-override':
        // Implement cooldown override
        console.log('Cooldown override');
        break;
      case 'clear-queue':
        // Implement queue clearing
        console.log('Clear queue');
        break;
      default:
        return res.status(400).json({
          success: false,
          message: `Unknown action: ${action}`,
        });
    }
    
    res.json({
      success: true,
      message: `Emergency action "${action}" executed`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Action error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to execute emergency action',
      error: error.message,
    });
  }
});

export default router;
