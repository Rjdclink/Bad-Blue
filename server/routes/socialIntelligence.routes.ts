/**
 * PANTHEON Social Intelligence - API Routes
 * REST API endpoints for username search across platforms
 */

import express from 'express';
import { socialIntelligenceService } from '../services/socialIntelligence';
import type { SherlockSearchOptions } from '../services/socialIntelligence/types';
import { logger } from '../logger';

const router = express.Router();
const log = logger.child({ component: 'routes:socialIntelligence' });

/**
 * POST /api/social-intelligence/search-username
 * Search for a username across all or specified platforms
 */
router.post('/search-username', async (req, res) => {
  try {
    const { username, options } = req.body as {
      username: string;
      options?: Partial<SherlockSearchOptions>;
    };

    if (!username || typeof username !== 'string') {
      return res.status(400).json({
        error: 'Username is required',
      });
    }

    log.info('Username search requested', { username });

    const results = await socialIntelligenceService.findUserAcrossPlatforms(
      username,
      options
    );

    return res.json({
      username,
      results,
      total: results.length,
      found: results.filter((r) => r.exists).length,
    });
  } catch (error: any) {
    log.error('Username search failed', { error: error.message });
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * POST /api/social-intelligence/search-multiple
 * Search for multiple usernames
 */
router.post('/search-multiple', async (req, res) => {
  try {
    const { usernames, options } = req.body as {
      usernames: string[];
      options?: Partial<SherlockSearchOptions>;
    };

    if (!Array.isArray(usernames) || usernames.length === 0) {
      return res.status(400).json({
        error: 'Usernames array is required',
      });
    }

    if (usernames.length > 10) {
      return res.status(400).json({
        error: 'Maximum 10 usernames per request',
      });
    }

    log.info('Multiple username search requested', {
      count: usernames.length,
    });

    const allResults: Record<string, any[]> = {};

    for (const username of usernames) {
      const results = await socialIntelligenceService.findUserAcrossPlatforms(
        username,
        options
      );
      allResults[username] = results;
    }

    return res.json({
      usernames,
      results: allResults,
      total: Object.values(allResults).flat().length,
    });
  } catch (error: any) {
    log.error('Multiple username search failed', { error: error.message });
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * GET /api/social-intelligence/platforms
 * Get list of all supported platforms
 */
router.get('/platforms', async (req, res) => {
  try {
    const platforms = socialIntelligenceService.getSupportedPlatforms();
    const count = socialIntelligenceService.getPlatformCount();

    return res.json({
      platforms,
      count,
    });
  } catch (error: any) {
    log.error('Failed to get platforms', { error: error.message });
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * POST /api/social-intelligence/validate-username
 * Validate a username for a specific platform or generally
 */
router.post('/validate-username', async (req, res) => {
  try {
    const { username, platform } = req.body as {
      username: string;
      platform?: string;
    };

    if (!username || typeof username !== 'string') {
      return res.status(400).json({
        error: 'Username is required',
      });
    }

    const validation = socialIntelligenceService.validateUsername(
      username,
      platform
    );

    return res.json(validation);
  } catch (error: any) {
    log.error('Username validation failed', { error: error.message });
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * POST /api/social-intelligence/enrich-profile
 * Enrich a person profile with social media data
 */
router.post('/enrich-profile', async (req, res) => {
  try {
    const { name, possibleUsernames } = req.body as {
      name: string;
      possibleUsernames: string[];
    };

    if (!name || !Array.isArray(possibleUsernames)) {
      return res.status(400).json({
        error: 'Name and possibleUsernames array are required',
      });
    }

    log.info('Profile enrichment requested', { name });

    const enriched = await socialIntelligenceService.enrichPersonProfile({
      name,
      possibleUsernames,
    });

    return res.json(enriched);
  } catch (error: any) {
    log.error('Profile enrichment failed', { error: error.message });
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

export default router;
