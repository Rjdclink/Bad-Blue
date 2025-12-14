/**
 * Inmate Search API Routes
 * 
 * Provides nationwide inmate locator functionality with:
 * - Federal Bureau of Prisons search
 * - State Department of Corrections search
 * - VINE victim notification system integration
 */

import express from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { 
  searchInmates, 
  getStateInfo, 
  getAllStatesInfo,
  getCacheStats 
} from '../services/inmateSearch';
import type { InmateSearchQuery } from '../services/inmateSearch/types';
import { apiRateLimit } from '../rateLimit';
import { sendValidationError, sendNoResults, sendUpstreamUnavailable, sendSystemError } from '../lib/apiResponse';

const router = express.Router();

// Validation schema for inmate search
const InmateSearchSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  middleName: z.string().max(100).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional(),
  state: z.string().length(2).toUpperCase().optional(),
  inmateId: z.string().max(50).optional(),
  searchScope: z.enum(['federal', 'state', 'county', 'all']).default('all'),
}).refine(data => data.firstName || data.lastName || data.inmateId, {
  message: 'At least firstName, lastName, or inmateId is required',
});

/**
 * POST /api/inmate-search
 * Search for inmates across federal and state correctional systems
 */
router.post('/', apiRateLimit, async (req, res) => {
  // Declare reportId outside try block for error handling access
  const startTime = Date.now();
  const correlationId = crypto.randomBytes(16).toString('hex');
  let reportId: string | null = null;
  const userId = (req as any).user?.id || (req as any).user?.claims?.sub;
  
  console.log('[INMATE SEARCH] Handler entered', {
    correlationId,
    hasBody: !!req.body,
    firstName: req.body?.firstName,
    lastName: req.body?.lastName,
  });
  
  try {
    // Validate request body
    const validation = InmateSearchSchema.safeParse(req.body);
    
    if (!validation.success) {
      console.log('[INMATE SEARCH] Validation failed', { correlationId, errors: validation.error.errors });
      
      // Convert Zod errors to field map
      const fields: Record<string, string> = {};
      validation.error.errors.forEach(err => {
        const path = err.path.join('.');
        fields[path] = err.message;
      });
      
      return sendValidationError(res, 'Validation failed', fields, correlationId);
    }
    
    console.log('[INMATE SEARCH] Validation passed, executing search', { correlationId });
    
    const query: InmateSearchQuery = {
      firstName: validation.data.firstName || '',
      lastName: validation.data.lastName || '',
      middleName: validation.data.middleName,
      dateOfBirth: validation.data.dateOfBirth,
      state: validation.data.state,
      inmateId: validation.data.inmateId,
      searchScope: validation.data.searchScope,
    };
    
    console.log('[Inmate Search API] Searching for:', {
      correlationId,
      firstName: query.firstName,
      lastName: query.lastName,
      state: query.state,
      scope: query.searchScope,
    });

    // Create initial report record if user is authenticated
    if (userId) {
      const { storage } = await import('../storage');
      const initialReport = await storage.createInmateSearchReport({
        userId,
        searchQuery: query,
        firstName: query.firstName,
        lastName: query.lastName,
        state: query.state,
        reportData: { status: 'processing', correlationId },
        status: 'processing',
      });
      reportId = initialReport.id;
    }
    
    // Execute the actual search
    const result = await searchInmates(query);
    
    const processingTimeMs = Date.now() - startTime;
    console.log('[INMATE SEARCH] Search completed', {
      correlationId,
      processingTimeMs,
      resultsCount: result.inmates?.length || 0,
      reportId,
    });

    // Check if no providers were available
    if (result.sources && result.sources.length > 0) {
      const allUnavailable = result.sources.every(s => s.status === 'error' || s.status === 'timeout');
      if (allUnavailable && result.inmates.length === 0) {
        console.log('[INMATE SEARCH] All providers unavailable', { correlationId });
        return sendUpstreamUnavailable(
          res,
          'No inmate search providers are currently available',
          { sources: result.sources, jobId: reportId },
          correlationId
        );
      }
    }
    
    // Check for upstream blocks (rate limits, etc)
    if (result.sources && result.sources.length > 0) {
      const blockedSources = result.sources.filter(s => 
        s.error && (s.error.includes('403') || s.error.includes('429') || s.error.includes('blocked'))
      );
      if (blockedSources.length > 0) {
        console.log('[INMATE SEARCH] Some providers blocked', { correlationId, blockedCount: blockedSources.length });
      }
    }

    // Update report with completed data
    if (reportId && userId) {
      const { storage } = await import('../storage');
      await storage.updateInmateSearchReportStatus(
        reportId,
        'completed',
        result
      );
    }
    
    // Return success or no_results
    if (result.inmates.length === 0) {
      return sendNoResults(
        res,
        'No inmates found matching search criteria',
        correlationId
      );
    }
    
    return res.json({
      type: 'success',
      success: true,
      data: result,
      meta: {
        correlationId,
        timestamp: new Date().toISOString(),
        processingTimeMs,
        jobId: reportId,
        jobCompleted: true,
        jobStatus: 'completed',
      },
    });
  } catch (error: any) {
    console.error('[Inmate Search API] Error:', { correlationId, error: error.message });

    // Update report with error if we have a reportId
    if (reportId && userId) {
      try {
        const { storage } = await import('../storage');
        await storage.updateInmateSearchReportStatus(
          reportId,
          'failed',
          undefined,
          error.message
        );
      } catch (updateError) {
        console.error('[Inmate Search API] Failed to update error status:', updateError);
      }
    }
    
    const { sendSystemError } = await import('../lib/apiResponse');
    return sendSystemError(res, error.message, {
      jobId: reportId,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    }, correlationId);
  }
});

/**
 * GET /api/inmate-search/states
 * Get list of all state corrections departments
 */
router.get('/states', async (req, res) => {
  try {
    const states = getAllStatesInfo();
    return res.json({
      success: true,
      data: states,
    });
  } catch (error: any) {
    console.error('[Inmate Search API] States error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch state information',
    });
  }
});

/**
 * GET /api/inmate-search/states/:stateCode
 * Get specific state corrections department info
 */
router.get('/states/:stateCode', async (req, res) => {
  try {
    const { stateCode } = req.params;
    
    if (!stateCode || stateCode.length !== 2) {
      return res.status(400).json({
        success: false,
        error: 'Valid 2-letter state code required',
      });
    }
    
    const stateInfo = getStateInfo(stateCode.toUpperCase());
    
    if (!stateInfo) {
      return res.status(404).json({
        success: false,
        error: `State not found: ${stateCode}`,
      });
    }
    
    return res.json({
      success: true,
      data: stateInfo,
    });
  } catch (error: any) {
    console.error('[Inmate Search API] State info error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch state information',
    });
  }
});

/**
 * GET /api/inmate-search/cache-stats
 * Get cache statistics (admin)
 */
router.get('/cache-stats', async (req, res) => {
  try {
    const stats = getCacheStats();
    return res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
