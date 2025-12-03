import { type Express, type Response } from 'express';
import { asyncHandler } from '../errorHandler';
import { createLogger } from '../logger';
import { pool } from '../db';

const log = createLogger('LawTypesRoutes');

export function setupLawTypesRoutes(app: Express): void {

  // Get all law types
  app.get('/api/law-types', asyncHandler(async (req, res: Response) => {
    log.debug('Fetching law types');

    const result = await pool.query(`
      SELECT * FROM law_type_definitions
      WHERE enabled = true
      ORDER BY sort_order
    `);

    res.json({ lawTypes: result.rows });
  }));

  // Navigate to law-specific tools
  app.post('/api/navigation/start-session', asyncHandler(async (req: any, res: Response) => {
    const { lawType, resumeSessionId } = req.body;

    log.info('Starting session navigation', { lawType, resumeSessionId });

    // Get law type configuration
    const result = await pool.query(`
      SELECT * FROM law_type_definitions
      WHERE id = $1
    `, [lawType]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Law type not found' });
    }

    const lawTypeConfig = result.rows[0];

    if (lawTypeConfig.uses_legacy_workflow && lawTypeConfig.redirect_url) {
      log.info('Redirecting to legacy workflow', { lawType, redirectUrl: lawTypeConfig.redirect_url });
      return res.json({
        redirectUrl: lawTypeConfig.redirect_url,
        sessionId: null,
        usesLegacyWorkflow: true,
      });
    }

    if (resumeSessionId) {
      res.json({
        redirectUrl: `/legal-tools?sessionId=${resumeSessionId}&lawType=${lawType}`,
        sessionId: resumeSessionId,
        usesLegacyWorkflow: false,
      });
    } else {
      res.json({
        redirectUrl: `/legal-tools?lawType=${lawType}`,
        sessionId: null,
        usesLegacyWorkflow: false,
      });
    }
  }));

  log.info('Law types routes registered');
}
