/**
 * Crawler Job API Routes
 * PRODUCTION READY - Full functionality with fail-fast retry
 * 
 * RESTful endpoints for crawler job management with:
 * - No-cache headers for polling endpoints
 * - Partial report support
 * - Real-time status updates
 */

import express, { Router, Request, Response } from 'express';
import { 
  crawlerJobManager, 
  JobStatus, 
  type JobConfig 
} from '../services/crawlers/CrawlerJobManager';

// EXPLICIT: Express Router initialization - no globals, no assumptions
if (!express || !express.Router) {
  throw new Error('FATAL: express not available. Cannot initialize Crawler routes.');
}

const router: Router = express.Router();

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
// JOB MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * POST /api/crawler/jobs
 * Create a new crawl job
 */
router.post('/jobs', async (req: Request, res: Response) => {
  try {
    const { targets, config } = req.body as { 
      targets: string[]; 
      config?: Partial<JobConfig>;
    };

    if (!targets || !Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'targets must be a non-empty array of URLs',
      });
    }

    const job = crawlerJobManager.createJob(targets, config);

    res.status(201).json({
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        targets: job.targets.length,
        config: job.config,
      },
    });
  } catch (error) {
    console.error('[CrawlerAPI] Create job error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create job',
    });
  }
});

/**
 * POST /api/crawler/jobs/:jobId/start
 * Start a pending job
 */
router.post('/jobs/:jobId/start', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const started = crawlerJobManager.startJob(jobId);

    if (!started) {
      return res.status(400).json({
        success: false,
        error: 'Job cannot be started (not found or not in PENDING status)',
      });
    }

    res.json({
      success: true,
      data: {
        jobId,
        status: JobStatus.RUNNING,
        message: 'Job started successfully',
      },
    });
  } catch (error) {
    console.error('[CrawlerAPI] Start job error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start job',
    });
  }
});

/**
 * POST /api/crawler/jobs/:jobId/cancel
 * Cancel a running job
 */
router.post('/jobs/:jobId/cancel', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const cancelled = crawlerJobManager.cancelJob(jobId);

    if (!cancelled) {
      return res.status(400).json({
        success: false,
        error: 'Job cannot be cancelled (not found or already completed)',
      });
    }

    res.json({
      success: true,
      data: {
        jobId,
        status: JobStatus.CANCELLED,
        message: 'Job cancelled successfully',
      },
    });
  } catch (error) {
    console.error('[CrawlerAPI] Cancel job error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel job',
    });
  }
});

// ============================================================================
// POLLING ENDPOINTS (NO CACHE)
// ============================================================================

/**
 * GET /api/crawler/jobs/:jobId/status
 * Get job status for polling - NO CACHE
 */
router.get('/jobs/:jobId/status', noCache, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const status = crawlerJobManager.getJobStatusForPolling(jobId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }

    res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CrawlerAPI] Get status error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get job status',
    });
  }
});

/**
 * GET /api/crawler/jobs/:jobId
 * Get full job details - NO CACHE
 */
router.get('/jobs/:jobId', noCache, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const job = crawlerJobManager.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }

    res.json({
      success: true,
      data: job,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CrawlerAPI] Get job error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get job',
    });
  }
});

/**
 * GET /api/crawler/jobs/:jobId/report
 * Get latest report for job - NO CACHE
 */
router.get('/jobs/:jobId/report', noCache, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const { version } = req.query;

    // If version specified, check if we have a newer one
    if (version) {
      const job = crawlerJobManager.getJob(jobId);
      if (job && job.latestReportVersion <= parseInt(version as string, 10)) {
        // No new report available
        return res.status(304).json({
          success: true,
          data: null,
          message: 'No new report available',
          currentVersion: job.latestReportVersion,
        });
      }
    }

    const report = crawlerJobManager.getLatestReport(jobId);

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'No report available yet',
      });
    }

    res.json({
      success: true,
      data: report,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CrawlerAPI] Get report error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get report',
    });
  }
});

/**
 * GET /api/crawler/jobs/:jobId/reports
 * Get all reports for job
 */
router.get('/jobs/:jobId/reports', noCache, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const reports = crawlerJobManager.getReports(jobId);

    res.json({
      success: true,
      data: reports,
      count: reports.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CrawlerAPI] Get reports error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get reports',
    });
  }
});

/**
 * GET /api/crawler/jobs/:jobId/results
 * Get all results for job (append-only buffer)
 */
router.get('/jobs/:jobId/results', noCache, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const { since } = req.query;

    let results = crawlerJobManager.getResults(jobId);

    // Filter by timestamp if since is provided
    if (since) {
      const sinceDate = new Date(since as string);
      results = results.filter(r => r.timestamp > sinceDate);
    }

    res.json({
      success: true,
      data: results,
      count: results.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CrawlerAPI] Get results error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get results',
    });
  }
});

/**
 * POST /api/crawler/jobs/:jobId/compile
 * Force compile a report
 */
router.post('/jobs/:jobId/compile', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const report = crawlerJobManager.compileReport(jobId);

    if (!report) {
      return res.status(400).json({
        success: false,
        error: 'Failed to compile report (job not found or no results)',
      });
    }

    res.json({
      success: true,
      data: report,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CrawlerAPI] Compile report error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to compile report',
    });
  }
});

// ============================================================================
// DOOMSDAY CLOCK ENDPOINTS
// ============================================================================

/**
 * GET /api/crawler/jobs/:jobId/doomsday-clock
 * Get the doomsday clock state for UI display - NO CACHE
 * Returns real-time progress through each tier
 */
router.get('/jobs/:jobId/doomsday-clock', noCache, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const clockState = crawlerJobManager.getDoomsdayClockState(jobId);

    if (!clockState) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }

    res.json({
      success: true,
      data: clockState,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CrawlerAPI] Get doomsday clock error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get doomsday clock state',
    });
  }
});

/**
 * POST /api/crawler/jobs/:jobId/hard-stop
 * User-initiated hard stop via doomsday clock UI
 * Only allowed if minimum tier has been reached
 */
router.post('/jobs/:jobId/hard-stop', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const result = crawlerJobManager.hardStop(jobId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }

    res.json({
      success: true,
      data: {
        message: 'Job stopped successfully',
        finalReport: result.finalReport,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CrawlerAPI] Hard stop error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to stop job',
    });
  }
});

// ============================================================================
// JOB CLEANUP
// ============================================================================

/**
 * DELETE /api/crawler/jobs/:jobId
 * Cleanup a job
 */
router.delete('/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const job = crawlerJobManager.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }

    // Only allow cleanup of completed/failed/cancelled/stopped jobs
    if (job.status === JobStatus.RUNNING || job.status === JobStatus.PARTIAL_REPORT_AVAILABLE) {
      return res.status(400).json({
        success: false,
        error: 'Cannot cleanup running job. Use hard-stop first.',
      });
    }

    crawlerJobManager.cleanup(jobId);

    res.json({
      success: true,
      message: 'Job cleaned up successfully',
    });
  } catch (error) {
    console.error('[CrawlerAPI] Cleanup job error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cleanup job',
    });
  }
});

export default router;
