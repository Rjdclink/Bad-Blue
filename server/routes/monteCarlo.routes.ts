/**
 * Monte Carlo Simulation API Routes
 * 
 * RESTful endpoints for Monte Carlo simulation management with:
 * - Bounded execution windows tied to Doomsday Clock
 * - Real-time state polling
 * - Constraint ingestion
 */

import { Router, Request, Response } from 'express';
import { 
  MonteCarloEngine, 
  createMonteCarloEngine,
  ConstraintType,
  type SimulationConfig,
} from '../services/monteCarlo';

const router = Router();

// Store active simulations
const simulations: Map<string, MonteCarloEngine> = new Map();

// ============================================================================
// NO-CACHE MIDDLEWARE
// ============================================================================

const noCache = (_req: Request, res: Response, next: () => void) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
  });
  next();
};

// ============================================================================
// SIMULATION MANAGEMENT
// ============================================================================

/**
 * POST /api/monte-carlo/simulations
 * Create a new Monte Carlo simulation
 */
router.post('/simulations', async (req: Request, res: Response) => {
  try {
    const { 
      latitude, 
      longitude, 
      uncertainty = 50,
      particleCount = 5000,
      config 
    } = req.body as { 
      latitude: number;
      longitude: number;
      uncertainty?: number;
      particleCount?: number;
      config?: Partial<SimulationConfig>;
    };

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'latitude and longitude are required',
      });
    }

    // Create and initialize simulation
    const engine = createMonteCarloEngine(config);
    engine.initialize(latitude, longitude, uncertainty, particleCount);
    
    const simulationId = engine.getSimulationId();
    simulations.set(simulationId, engine);

    res.status(201).json({
      success: true,
      data: {
        simulationId,
        particleCount,
        initialPosition: { latitude, longitude },
        uncertainty,
        status: 'INITIALIZED',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[MonteCarloAPI] Create simulation error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create simulation',
    });
  }
});

/**
 * GET /api/monte-carlo/simulations/:id
 * Get simulation info
 */
router.get('/simulations/:id', noCache, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const engine = simulations.get(id);

    if (!engine) {
      return res.status(404).json({
        success: false,
        error: 'Simulation not found',
      });
    }

    res.json({
      success: true,
      data: {
        simulationId: id,
        isRunning: engine.isRunning(),
        snapshots: engine.getSnapshots().length,
        constraints: engine.getConstraints().length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[MonteCarloAPI] Get simulation error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get simulation',
    });
  }
});

/**
 * GET /api/monte-carlo/simulations/:id/live
 * Get live render state (for UI polling)
 */
router.get('/simulations/:id/live', noCache, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const engine = simulations.get(id);

    if (!engine) {
      return res.status(404).json({
        success: false,
        error: 'Simulation not found',
      });
    }

    const liveState = engine.getLiveRenderState();

    res.json({
      success: true,
      data: liveState,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[MonteCarloAPI] Get live state error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get live state',
    });
  }
});

// ============================================================================
// EXECUTION WINDOWS
// ============================================================================

/**
 * POST /api/monte-carlo/simulations/:id/start
 * Start an execution window for specified tier
 */
router.post('/simulations/:id/start', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tier = 'BASIC' } = req.body as { tier?: 'BASIC' | 'ENHANCED' | 'FULL' | 'EYE_OF_GOD' };
    
    const engine = simulations.get(id);

    if (!engine) {
      return res.status(404).json({
        success: false,
        error: 'Simulation not found',
      });
    }

    if (engine.isRunning()) {
      return res.status(400).json({
        success: false,
        error: 'Simulation already running. Suspend first.',
      });
    }

    const window = engine.startExecutionWindow(tier);

    res.json({
      success: true,
      data: {
        window,
        message: `Started ${tier} execution window`,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[MonteCarloAPI] Start execution error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start execution',
    });
  }
});

/**
 * POST /api/monte-carlo/simulations/:id/suspend
 * Suspend execution (user hard stop)
 */
router.post('/simulations/:id/suspend', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const engine = simulations.get(id);

    if (!engine) {
      return res.status(404).json({
        success: false,
        error: 'Simulation not found',
      });
    }

    if (!engine.isRunning()) {
      return res.status(400).json({
        success: false,
        error: 'Simulation not running',
      });
    }

    const snapshot = engine.suspend();

    res.json({
      success: true,
      data: {
        snapshot,
        message: 'Execution suspended',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[MonteCarloAPI] Suspend execution error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to suspend execution',
    });
  }
});

// ============================================================================
// CONSTRAINTS
// ============================================================================

/**
 * POST /api/monte-carlo/simulations/:id/constraints
 * Add a constraint (satellite capture, geo hint, etc.)
 */
router.post('/simulations/:id/constraints', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { 
      type = 'SATELLITE_CAPTURE',
      latitude,
      longitude,
      uncertainty = 50,
      confidence = 0.8,
      source = 'API',
      metadata,
    } = req.body as {
      type?: keyof typeof ConstraintType;
      latitude: number;
      longitude: number;
      uncertainty?: number;
      confidence?: number;
      source?: string;
      metadata?: Record<string, unknown>;
    };

    const engine = simulations.get(id);

    if (!engine) {
      return res.status(404).json({
        success: false,
        error: 'Simulation not found',
      });
    }

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'latitude and longitude are required',
      });
    }

    engine.addConstraint({
      type: ConstraintType[type] || ConstraintType.SATELLITE_CAPTURE,
      timestamp: Date.now(),
      latitude,
      longitude,
      uncertainty,
      confidence,
      source,
      metadata,
    });

    res.json({
      success: true,
      data: {
        message: 'Constraint added',
        constraintCount: engine.getConstraints().length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[MonteCarloAPI] Add constraint error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add constraint',
    });
  }
});

/**
 * GET /api/monte-carlo/simulations/:id/constraints
 * Get all constraints
 */
router.get('/simulations/:id/constraints', noCache, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const engine = simulations.get(id);

    if (!engine) {
      return res.status(404).json({
        success: false,
        error: 'Simulation not found',
      });
    }

    res.json({
      success: true,
      data: engine.getConstraints(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[MonteCarloAPI] Get constraints error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get constraints',
    });
  }
});

// ============================================================================
// SNAPSHOTS
// ============================================================================

/**
 * GET /api/monte-carlo/simulations/:id/snapshots
 * Get all snapshots
 */
router.get('/simulations/:id/snapshots', noCache, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const engine = simulations.get(id);

    if (!engine) {
      return res.status(404).json({
        success: false,
        error: 'Simulation not found',
      });
    }

    res.json({
      success: true,
      data: engine.getSnapshots(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[MonteCarloAPI] Get snapshots error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get snapshots',
    });
  }
});

/**
 * POST /api/monte-carlo/simulations/:id/snapshot
 * Create a snapshot manually
 */
router.post('/simulations/:id/snapshot', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const engine = simulations.get(id);

    if (!engine) {
      return res.status(404).json({
        success: false,
        error: 'Simulation not found',
      });
    }

    const snapshot = engine.createSnapshot();

    res.json({
      success: true,
      data: snapshot,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[MonteCarloAPI] Create snapshot error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create snapshot',
    });
  }
});

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * DELETE /api/monte-carlo/simulations/:id
 * Destroy a simulation
 */
router.delete('/simulations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const engine = simulations.get(id);

    if (!engine) {
      return res.status(404).json({
        success: false,
        error: 'Simulation not found',
      });
    }

    engine.destroy();
    simulations.delete(id);

    res.json({
      success: true,
      message: 'Simulation destroyed',
    });
  } catch (error) {
    console.error('[MonteCarloAPI] Destroy simulation error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to destroy simulation',
    });
  }
});

// ============================================================================
// CRAWLER OPTIMIZER ENDPOINTS
// ============================================================================

import {
  monteCarloCrawlerOptimizer,
  MONTE_CARLO_CRAWLERS,
  DEFAULT_MONTE_CARLO_CONFIG,
} from '../services/monteCarlo';

/**
 * GET /api/monte-carlo/crawler/config
 * Get crawler optimizer configuration
 */
router.get('/crawler/config', async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        crawlers: MONTE_CARLO_CRAWLERS,
        config: DEFAULT_MONTE_CARLO_CONFIG,
      },
    });
  } catch (error) {
    console.error('[MonteCarloAPI] Crawler config error:', error);
    res.status(500).json({ success: false, error: 'Failed to get configuration' });
  }
});

/**
 * GET /api/monte-carlo/crawler/status
 * Get crawler optimizer status
 */
router.get('/crawler/status', noCache, async (req: Request, res: Response) => {
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
        convergence: state.convergence,
        currentWeights: Object.fromEntries(state.currentWeights),
      },
    });
  } catch (error) {
    console.error('[MonteCarloAPI] Crawler status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get status' });
  }
});

/**
 * POST /api/monte-carlo/crawler/seeds
 * Add seed URLs
 */
router.post('/crawler/seeds', async (req: Request, res: Response) => {
  try {
    const { urls } = req.body as { urls: string[] };
    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ success: false, error: 'urls array required' });
    }
    monteCarloCrawlerOptimizer.addSeeds(urls);
    const state = monteCarloCrawlerOptimizer.getState();
    res.json({
      success: true,
      data: { added: urls.length, total: state.seeds.length },
    });
  } catch (error) {
    console.error('[MonteCarloAPI] Add seeds error:', error);
    res.status(500).json({ success: false, error: 'Failed to add seeds' });
  }
});

/**
 * POST /api/monte-carlo/crawler/run
 * Start optimization
 */
router.post('/crawler/run', async (req: Request, res: Response) => {
  try {
    const state = monteCarloCrawlerOptimizer.getState();
    if (state.status === 'running') {
      return res.status(400).json({ success: false, error: 'Already running' });
    }
    if (state.seeds.length === 0) {
      return res.status(400).json({ success: false, error: 'Add seeds first' });
    }
    monteCarloCrawlerOptimizer.runOptimization().catch(console.error);
    res.json({ success: true, message: 'Optimization started' });
  } catch (error) {
    console.error('[MonteCarloAPI] Run error:', error);
    res.status(500).json({ success: false, error: 'Failed to start' });
  }
});

/**
 * GET /api/monte-carlo/crawler/results
 * Get optimization results
 */
router.get('/crawler/results', noCache, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: monteCarloCrawlerOptimizer.getResults() });
  } catch (error) {
    console.error('[MonteCarloAPI] Results error:', error);
    res.status(500).json({ success: false, error: 'Failed to get results' });
  }
});

/**
 * POST /api/monte-carlo/crawler/reset
 * Reset optimizer
 */
router.post('/crawler/reset', async (req: Request, res: Response) => {
  try {
    monteCarloCrawlerOptimizer.reset();
    res.json({ success: true, message: 'Reset complete' });
  } catch (error) {
    console.error('[MonteCarloAPI] Reset error:', error);
    res.status(500).json({ success: false, error: 'Failed to reset' });
  }
});

// ============================================================================
// EVOLUTIONARY CYCLE ENDPOINTS
// ============================================================================

import { evolutionaryCycleEngine } from '../services/monteCarlo';

/**
 * GET /api/monte-carlo/evolution/state
 * Get evolutionary cycle state
 */
router.get('/evolution/state', noCache, async (req: Request, res: Response) => {
  try {
    const state = evolutionaryCycleEngine.getState();
    res.json({
      success: true,
      data: {
        currentCycle: state.currentCycle,
        totalCycles: state.totalCycles,
        status: state.status,
        activeCrawlerCount: state.activeCrawlers.length,
        archivedCount: state.archivedCrawlers.length,
        convergenceStreak: state.convergenceStreak,
        architectureFrozen: state.architectureFrozen,
        activeCrawlers: state.activeCrawlers.map(c => ({
          id: c.id,
          name: c.name,
          baseCrawlerId: c.baseCrawlerId,
          generation: c.generation,
          posteriorConfidence: c.posteriorConfidence,
          trainingExposure: c.trainingExposure,
          averageScore: c.performance.averageScore,
          status: c.status,
        })),
      },
    });
  } catch (error) {
    console.error('[MonteCarloAPI] Evolution state error:', error);
    res.status(500).json({ success: false, error: 'Failed to get state' });
  }
});

/**
 * POST /api/monte-carlo/evolution/cycle
 * Run a single evolutionary cycle
 */
router.post('/evolution/cycle', async (req: Request, res: Response) => {
  try {
    const state = evolutionaryCycleEngine.getState();
    if (state.status === 'running') {
      return res.status(400).json({ success: false, error: 'Cycle already running' });
    }

    const cycle = await evolutionaryCycleEngine.runCycle();
    
    res.json({
      success: true,
      data: {
        cycleId: cycle.cycleId,
        cycleNumber: cycle.cycleNumber,
        convergenceAchieved: cycle.convergenceAchieved,
        newVariantsIntroduced: cycle.newVariantsIntroduced,
        architectureFrozen: cycle.architectureFrozen,
        topPerformers: cycle.topPerformers,
        archivedCount: cycle.archivedCrawlers.length,
        duration: cycle.completedAt && cycle.startedAt
          ? cycle.completedAt.getTime() - cycle.startedAt.getTime()
          : 0,
      },
    });
  } catch (error) {
    console.error('[MonteCarloAPI] Run cycle error:', error);
    res.status(500).json({ success: false, error: 'Failed to run cycle' });
  }
});

/**
 * GET /api/monte-carlo/evolution/history
 * Get cycle history
 */
router.get('/evolution/history', noCache, async (req: Request, res: Response) => {
  try {
    const history = evolutionaryCycleEngine.getCycleHistory();
    res.json({
      success: true,
      data: {
        totalCycles: history.length,
        cycles: history.map(c => ({
          cycleId: c.cycleId,
          cycleNumber: c.cycleNumber,
          startedAt: c.startedAt,
          completedAt: c.completedAt,
          convergenceAchieved: c.convergenceAchieved,
          newVariantsIntroduced: c.newVariantsIntroduced,
          architectureFrozen: c.architectureFrozen,
          topPerformers: c.topPerformers,
        })),
      },
    });
  } catch (error) {
    console.error('[MonteCarloAPI] History error:', error);
    res.status(500).json({ success: false, error: 'Failed to get history' });
  }
});

/**
 * GET /api/monte-carlo/evolution/crawlers
 * Get active crawler variants
 */
router.get('/evolution/crawlers', noCache, async (req: Request, res: Response) => {
  try {
    const crawlers = evolutionaryCycleEngine.getActiveCrawlers();
    res.json({
      success: true,
      data: {
        count: crawlers.length,
        maxAllowed: 4,
        architectureFrozen: evolutionaryCycleEngine.isArchitectureFrozen(),
        crawlers: crawlers.map(c => ({
          id: c.id,
          name: c.name,
          baseCrawlerId: c.baseCrawlerId,
          generation: c.generation,
          status: c.status,
          parameters: c.parameters,
          performance: c.performance,
          posteriorConfidence: c.posteriorConfidence,
          trainingExposure: c.trainingExposure,
          explorationProbability: c.explorationProbability,
          createdAt: c.createdAt,
          frozenAt: c.frozenAt,
        })),
      },
    });
  } catch (error) {
    console.error('[MonteCarloAPI] Crawlers error:', error);
    res.status(500).json({ success: false, error: 'Failed to get crawlers' });
  }
});

/**
 * POST /api/monte-carlo/evolution/reset
 * Reset evolutionary engine
 */
router.post('/evolution/reset', async (req: Request, res: Response) => {
  try {
    evolutionaryCycleEngine.reset();
    res.json({ success: true, message: 'Evolutionary engine reset' });
  } catch (error) {
    console.error('[MonteCarloAPI] Evolution reset error:', error);
    res.status(500).json({ success: false, error: 'Failed to reset' });
  }
});

export default router;
