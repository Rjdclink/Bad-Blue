/**
 * Monte Carlo Crawler Optimizer API Routes
 * 
 * RESTful API endpoints for controlling and monitoring
 * the Monte Carlo crawler optimization system.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  monteCarloCrawlerOptimizer,
  MONTE_CARLO_CRAWLERS,
  DEFAULT_MONTE_CARLO_CONFIG,
} from '../services/monteCarlo';
import { createLogger } from '../logger';

const router = Router();
const log = createLogger('MonteCarloRoutes');

// ============ VALIDATION SCHEMAS ============

const addSeedsSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(200),
});

const runOptimizationSchema = z.object({
  autoStart: z.boolean().optional().default(true),
});

// ============ API ENDPOINTS ============

/**
 * GET /api/montecarlo/config
 * Get current Monte Carlo configuration
 */
router.get('/config', async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        crawlers: MONTE_CARLO_CRAWLERS,
        config: DEFAULT_MONTE_CARLO_CONFIG,
      },
    });
  } catch (error) {
    log.error('Config endpoint error', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get configuration',
    });
  }
});

/**
 * GET /api/montecarlo/crawlers
 * Get list of selected crawler candidates
 */
router.get('/crawlers', async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        count: MONTE_CARLO_CRAWLERS.length,
        crawlers: MONTE_CARLO_CRAWLERS.map(c => ({
          id: c.id,
          name: c.name,
          description: c.description,
          initialWeight: c.initialWeight,
          capabilities: c.capabilities,
          bestFor: c.bestFor,
        })),
      },
    });
  } catch (error) {
    log.error('Crawlers endpoint error', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get crawlers',
    });
  }
});

/**
 * GET /api/montecarlo/status
 * Get current optimization status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const state = monteCarloCrawlerOptimizer.getState();
    
    res.json({
      success: true,
      data: {
        status: state.status,
        seeds: state.seeds.length,
        completedRuns: state.completedRuns,
        totalRuns: state.totalRuns,
        currentBatch: state.currentBatch,
        convergence: {
          isStable: state.convergence.isStable,
          stabileBatchCount: state.convergence.stabileBatchCount,
          rankings: state.convergence.rankings,
        },
        currentWeights: Object.fromEntries(state.currentWeights),
        startTime: state.startTime,
        endTime: state.endTime,
      },
    });
  } catch (error) {
    log.error('Status endpoint error', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get status',
    });
  }
});

/**
 * POST /api/montecarlo/seeds
 * Add seed URLs for optimization
 */
router.post('/seeds', async (req: Request, res: Response) => {
  try {
    const validation = addSeedsSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data',
        details: validation.error.errors,
      });
    }

    const { urls } = validation.data;
    
    monteCarloCrawlerOptimizer.addSeeds(urls);
    const state = monteCarloCrawlerOptimizer.getState();

    log.info('Seeds added', { count: urls.length, total: state.seeds.length });

    res.json({
      success: true,
      data: {
        added: urls.length,
        total: state.seeds.length,
        target: DEFAULT_MONTE_CARLO_CONFIG.seeds.count,
        seeds: state.seeds.slice(-10).map(s => ({ url: s.url, domain: s.domain, siteType: s.siteType })),
      },
    });
  } catch (error) {
    log.error('Add seeds endpoint error', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to add seeds',
    });
  }
});

/**
 * POST /api/montecarlo/run
 * Start Monte Carlo optimization
 */
router.post('/run', async (req: Request, res: Response) => {
  try {
    const state = monteCarloCrawlerOptimizer.getState();
    
    if (state.status === 'running') {
      return res.status(400).json({
        success: false,
        error: 'Optimization already running',
      });
    }

    if (state.seeds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No seeds added. Add seeds first with POST /api/montecarlo/seeds',
      });
    }

    // Start optimization in background
    monteCarloCrawlerOptimizer.runOptimization().catch(err => {
      log.error('Optimization failed', { error: err });
    });

    res.json({
      success: true,
      message: 'Optimization started',
      data: {
        seeds: state.seeds.length,
        iterationsPerSeed: DEFAULT_MONTE_CARLO_CONFIG.iterations.perSeed,
        totalRuns: state.seeds.length * DEFAULT_MONTE_CARLO_CONFIG.iterations.perSeed,
      },
    });
  } catch (error) {
    log.error('Run endpoint error', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to start optimization',
    });
  }
});

/**
 * GET /api/montecarlo/results
 * Get optimization results
 */
router.get('/results', async (req: Request, res: Response) => {
  try {
    const results = monteCarloCrawlerOptimizer.getResults();

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    log.error('Results endpoint error', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get results',
    });
  }
});

/**
 * POST /api/montecarlo/reset
 * Reset the optimizer
 */
router.post('/reset', async (req: Request, res: Response) => {
  try {
    monteCarloCrawlerOptimizer.reset();

    res.json({
      success: true,
      message: 'Optimizer reset successfully',
    });
  } catch (error) {
    log.error('Reset endpoint error', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to reset optimizer',
    });
  }
});

/**
 * GET /api/montecarlo/outcomes
 * Get recent run outcomes
 */
router.get('/outcomes', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const state = monteCarloCrawlerOptimizer.getState();
    
    const outcomes = state.outcomes.slice(-limit);

    res.json({
      success: true,
      data: {
        total: state.outcomes.length,
        returned: outcomes.length,
        outcomes: outcomes.map(o => ({
          runId: o.runId,
          seedUrl: o.seedUrl,
          iteration: o.iteration,
          crawler: o.parameters.crawlerId,
          score: o.score,
          results: o.results,
          timestamp: o.timestamp,
        })),
      },
    });
  } catch (error) {
    log.error('Outcomes endpoint error', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to get outcomes',
    });
  }
});

export default router;
