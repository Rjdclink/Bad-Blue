/**
 * People Search API Routes
 */
import express from 'express';
import { PeopleSearchAggregator } from '../services/peopleSearch/PeopleSearchAggregator';
import type { SearchQuery } from '../services/peopleSearch/types';

const router = express.Router();
const aggregator = new PeopleSearchAggregator();

/**
 * POST /api/people-search
 * Search for person across multiple public data sources
 */
router.post('/api/people-search', async (req, res) => {
  try {
    const { firstName, lastName, city, state, age } = req.body;

    // Validate required fields
    if (!firstName || !lastName) {
      return res.status(400).json({
        success: false,
        error: 'firstName and lastName required',
      });
    }

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
