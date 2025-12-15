/**
 * People Search API Routes
 * PRODUCTION READY - Full functionality with fail-fast retry
 */
import express, { Router, Request, Response } from 'express';
import { PeopleSearchAggregator } from '../services/peopleSearch/PeopleSearchAggregator';
import type { SearchQuery } from '../services/peopleSearch/types';

// EXPLICIT: Express Router initialization - no globals, no assumptions
if (!express || !express.Router) {
  throw new Error('FATAL: express not available. Cannot initialize People Search routes.');
}

const router: Router = express.Router();
const aggregator = new PeopleSearchAggregator();

/**
 * POST /api/people-search
 * Search for person across multiple public data sources
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

    // Execute search
    const result = await aggregator.search(query);

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
    
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
      jobCompleted: true,
      jobStatus: 'failed',
    });
  }
});

export default router;
