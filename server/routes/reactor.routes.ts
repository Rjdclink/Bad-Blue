/**
 * Reactor API Routes
 * 
 * Provides endpoints for:
 * - Reactor status and health monitoring
 * - Job submission and management
 * - Monte Carlo simulation controls
 * - Heat monitor readings
 */

import express from 'express';
import { 
  computationalReactor,
  getReactorStatus,
  getHeatMonitor,
  submitJob,
  type ReactorJob
} from '../reactor';
import { isAdmin } from '../adminAuth';

const router = express.Router();

/**
 * GET /api/reactor/status
 * Get current reactor status including job queue and heat monitor
 */
router.get('/status', async (req, res) => {
  try {
    const status = getReactorStatus();
    const heatMonitor = getHeatMonitor();
    
    res.json({
      success: true,
      data: {
        ...status,
        heatMonitor,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('[Reactor API] Status error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get reactor status'
    });
  }
});

/**
 * GET /api/reactor/heat
 * Get current heat monitor readings
 */
router.get('/heat', async (req, res) => {
  try {
    const heatMonitor = getHeatMonitor();
    res.json({
      success: true,
      data: heatMonitor
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/reactor/metrics
 * Get recent job metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const metrics = computationalReactor.getRecentMetrics(Math.min(limit, 500));
    
    res.json({
      success: true,
      data: {
        metrics,
        count: metrics.length
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/reactor/job
 * Submit a new job to the reactor (admin only)
 */
router.post('/job', async (req, res) => {
  try {
    // Validate admin access
    if (!req.user || !isAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const { type, payload, priority } = req.body;
    
    if (!type || !payload) {
      return res.status(400).json({
        success: false,
        error: 'type and payload are required'
      });
    }

    const validTypes: ReactorJob['type'][] = [
      'monte_carlo', 'crawler_training', 'osint_sweep',
      'heatmap_update', 'model_optimization', 'batch_inference'
    ];

    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid job type. Valid types: ${validTypes.join(', ')}`
      });
    }

    const jobId = await submitJob(type, payload, priority || 5);
    
    res.json({
      success: true,
      data: {
        jobId,
        message: 'Job submitted successfully'
      }
    });
  } catch (error: any) {
    console.error('[Reactor API] Job submission error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/reactor/job/:jobId
 * Get status of a specific job
 */
router.get('/job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = computationalReactor.getJob(jobId);
    
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    res.json({
      success: true,
      data: job
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/reactor/job/:jobId
 * Cancel a queued job (admin only)
 */
router.delete('/job/:jobId', async (req, res) => {
  try {
    if (!req.user || !isAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const { jobId } = req.params;
    const cancelled = computationalReactor.cancelJob(jobId);
    
    res.json({
      success: true,
      data: {
        cancelled,
        jobId
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/reactor/enable
 * Enable or disable the reactor (admin only)
 */
router.post('/enable', async (req, res) => {
  try {
    if (!req.user || !isAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'enabled must be a boolean'
      });
    }

    computationalReactor.setEnabled(enabled);
    
    res.json({
      success: true,
      data: {
        enabled,
        message: `Reactor ${enabled ? 'enabled' : 'disabled'}`
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/reactor/monte-carlo
 * Schedule a Monte Carlo optimization run (admin only)
 */
router.post('/monte-carlo', async (req, res) => {
  try {
    if (!req.user || !isAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const { targetComponent, passesPerCycle, maxIterations } = req.body;
    
    if (!targetComponent) {
      return res.status(400).json({
        success: false,
        error: 'targetComponent is required'
      });
    }

    const jobId = await submitJob('monte_carlo', {
      targetComponent,
      config: {
        passesPerCycle: passesPerCycle || 10,
        maxIterations: maxIterations || 1000,
        cooldownMs: 1000
      }
    }, 7);
    
    res.json({
      success: true,
      data: {
        jobId,
        message: 'Monte Carlo optimization scheduled'
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
