/**
 * People Search API Routes
 * PRODUCTION READY - Full functionality with fail-fast retry
 * 
 * ARCHITECTURE:
 * - This route proxies requests to the People Search Worker service
 * - Main app does NOT import Playwright directly
 * - Worker handles all browser operations
 * - Server startup does NOT depend on worker availability
 */
import express, { Router, Request, Response } from 'express';
import { 
  peopleSearchProxy,
  isWorkerReady,
  checkWorkerHealth,
  validateWorkerBrowser 
} from '../services/peopleSearchProxy';
import type { SearchQuery } from '../services/peopleSearch/types';

// EXPLICIT: Express Router initialization - no globals, no assumptions
if (!express || !express.Router) {
  throw new Error('FATAL: express not available. Cannot initialize People Search routes.');
}

const router: Router = express.Router();

/**
 * POST /api/people-search
 * Search for person across multiple public data sources
 * 
 * NOTE: This proxies to the People Search Worker service.
 * If worker is unavailable, returns a 503 with clear error message.
 */
router.post('/', async (req, res) => {
  console.log('[PEOPLE SEARCH] Handler entered', {
    requestId: Date.now(),
    hasBody: !!req.body,
    firstName: req.body?.firstName,
    lastName: req.body?.lastName,
  });
  
  try {
    const { firstName, lastName, city, state, age } = req.body;

    // Validate required fields
    if (!firstName || !lastName) {
      console.log('[PEOPLE SEARCH] Validation failed: missing firstName or lastName');
      return res.status(400).json({
        success: false,
        error: 'firstName and lastName required',
      });
    }
    
    console.log('[PEOPLE SEARCH] Validation passed, executing search');

    // Build search query
    const query: SearchQuery = {
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
    };

    if (city) query.city = String(city).trim();
    if (state) query.state = String(state).trim();
    if (age) {
      const parsedAge = parseInt(String(age), 10);
      if (!isNaN(parsedAge) && parsedAge > 0) {
        query.age = parsedAge;
      }
    }

    console.log('[People Search API] Searching for:', query);

    // Get user ID if authenticated
    const userId = (req as any).user?.id || (req as any).user?.claims?.sub;
    let reportId: string | null = null;

    // Create initial report record
    if (userId) {
      const { storage } = await import('../storage');
      const fullName = `${firstName} ${lastName}`;
      const initialReport = await storage.createPeopleSearchReport({
        userId,
        searchQuery: fullName,
        subjectName: fullName,
        reportData: { status: 'processing', query },
        status: 'processing',
      });
      reportId = initialReport.id;
    }

    // Execute search via worker proxy
    const result = await peopleSearchProxy.search(query);

    // Update report with completed data
    if (reportId && userId) {
      const { storage } = await import('../storage');
      await storage.updatePeopleSearchReportStatus(
        reportId,
        'completed',
        result
      );
    }

    return res.json({
      success: true,
      data: result,
      jobId: reportId,
      jobCompleted: true,
      jobStatus: 'completed',
    });
  } catch (error) {
    console.error('[People Search API] Error:', error);
    
    // Check if this is a worker unavailable error
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    const isWorkerError = errorMessage.includes('Worker is not available') || 
                          errorMessage.includes('Worker validation');
    
    return res.status(isWorkerError ? 503 : 500).json({
      success: false,
      error: errorMessage,
      workerUnavailable: isWorkerError,
      jobCompleted: true,
      jobStatus: 'failed',
    });
  }
});

/**
 * GET /api/people-search/health
 * Check People Search Worker health status
 * This endpoint allows runtime verification without blocking main app startup
 */
router.get('/health', async (req, res) => {
  try {
    const health = await checkWorkerHealth();
    const ready = await isWorkerReady();
    
    res.status(ready ? 200 : 503).json({
      workerReady: ready,
      workerHealth: health,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[People Search API] Health check error:', error);
    res.status(503).json({
      workerReady: false,
      error: error instanceof Error ? error.message : 'Health check failed',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/people-search/validate
 * Validate the People Search Worker's browser installation
 * This runs a test crawl to verify browser is working
 */
router.post('/validate', async (req, res) => {
  try {
    console.log('[People Search API] Running browser validation...');
    const validation = await validateWorkerBrowser();
    
    res.status(validation.success ? 200 : 500).json({
      success: validation.success,
      validationError: validation.validationError,
      timestamp: validation.timestamp,
    });
  } catch (error) {
    console.error('[People Search API] Validation error:', error);
    res.status(500).json({
      success: false,
      validationError: error instanceof Error ? error.message : 'Validation failed',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
