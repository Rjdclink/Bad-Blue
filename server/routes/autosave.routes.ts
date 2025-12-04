import { type Express, type Response, type Request } from 'express';
import crypto from 'crypto';
import { asyncHandler } from '../errorHandler';
import { isAuthenticated } from '../auth';
import { createLogger } from '../logger';
import { pool } from '../db';

const log = createLogger('AutosaveRoutes');

// Type definitions
interface AuthenticatedRequest extends Request {
  body: any;
  params: any;
  query: any;
}

export function setupAutosaveRoutes(app: Express): void {

  // Create new work session
  app.post('/api/autosave/sessions', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.claims?.sub || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { lawType, sessionType, title, initialData } = req.body;

    log.info('Creating work session', { userId, lawType, sessionType });

    const sessionId = crypto.randomUUID();
    
    await pool.query(`
      INSERT INTO user_work_sessions (id, user_id, law_type, session_type, title, current_step, progress_percentage)
      VALUES ($1, $2, $3, $4, $5, 'consultation', 0)
    `, [sessionId, userId, lawType, sessionType, title || `${lawType} - ${new Date().toLocaleDateString()}`]);

    if (initialData) {
      await pool.query(`
        INSERT INTO autosave_snapshots (session_id, snapshot_data, snapshot_version)
        VALUES ($1, $2, 1)
      `, [sessionId, JSON.stringify(initialData)]);
    }

    res.json({
      sessionId,
      createdAt: new Date().toISOString(),
      lawType,
      sessionType,
    });
  }));

  // Get all user sessions
  app.get('/api/autosave/sessions', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.claims?.sub || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const includeCompleted = req.query.includeCompleted === 'true';
    const lawTypeFilter = req.query.lawType as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;

    log.info('Fetching user sessions', { userId, includeCompleted, lawTypeFilter });

    let query = `
      SELECT * FROM user_work_sessions
      WHERE user_id = $1
    `;
    const params: any[] = [userId];
    let paramIndex = 2;

    if (!includeCompleted) {
      query += ` AND is_complete = false`;
    }

    if (lawTypeFilter) {
      query += ` AND law_type = $${paramIndex}`;
      params.push(lawTypeFilter);
      paramIndex++;
    }

    query += ` ORDER BY last_accessed_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await pool.query(query, params);

    res.json({
      sessions: result.rows,
      total: result.rows.length,
    });
  }));

  // Get full session state
  app.get('/api/autosave/sessions/:sessionId', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.claims?.sub || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { sessionId } = req.params;

    log.info('Fetching session details', { userId, sessionId });

    // Get session
    const sessionResult = await pool.query(`
      SELECT * FROM user_work_sessions
      WHERE id = $1 AND user_id = $2
    `, [sessionId, userId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];

    // Get latest snapshot
    const snapshotResult = await pool.query(`
      SELECT * FROM autosave_snapshots
      WHERE session_id = $1
      ORDER BY snapshot_version DESC
      LIMIT 1
    `, [sessionId]);

    // Get consultation history
    const consultationResult = await pool.query(`
      SELECT * FROM consultation_history
      WHERE session_id = $1
      ORDER BY created_at ASC
    `, [sessionId]);

    // Get document drafts
    const draftsResult = await pool.query(`
      SELECT * FROM document_drafts
      WHERE session_id = $1
      ORDER BY version_number DESC
    `, [sessionId]);

    // Update last accessed timestamp
    await pool.query(`
      UPDATE user_work_sessions
      SET last_accessed_at = NOW()
      WHERE id = $1
    `, [sessionId]);

    res.json({
      session,
      latestSnapshot: snapshotResult.rows[0] ? {
        data: snapshotResult.rows[0].snapshot_data,
        version: snapshotResult.rows[0].snapshot_version,
        createdAt: snapshotResult.rows[0].created_at,
      } : null,
      consultationHistory: consultationResult.rows,
      documentDrafts: draftsResult.rows,
    });
  }));

  // Save snapshot (autosave)
  app.post('/api/autosave/sessions/:sessionId/snapshot', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.claims?.sub || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { sessionId } = req.params;
    const { data, currentStep, progressPercentage, fieldsChanged } = req.body;

    log.debug('Saving snapshot', { userId, sessionId, fieldsChanged });

    // Verify ownership
    const sessionResult = await pool.query(`
      SELECT * FROM user_work_sessions
      WHERE id = $1 AND user_id = $2
    `, [sessionId, userId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get current version
    const versionResult = await pool.query(`
      SELECT MAX(snapshot_version) as max_version
      FROM autosave_snapshots
      WHERE session_id = $1
    `, [sessionId]);

    const nextVersion = (versionResult.rows[0]?.max_version || 0) + 1;

    // Insert new snapshot
    const snapshotId = crypto.randomUUID();
    await pool.query(`
      INSERT INTO autosave_snapshots (id, session_id, snapshot_data, snapshot_version, fields_changed)
      VALUES ($1, $2, $3, $4, $5)
    `, [snapshotId, sessionId, JSON.stringify(data), nextVersion, fieldsChanged || []]);

    // Update session metadata
    let updateQuery = `
      UPDATE user_work_sessions
      SET last_autosave_at = NOW(), last_accessed_at = NOW()
    `;
    const updateParams: any[] = [];
    let paramIndex = 1;

    if (currentStep) {
      updateQuery += `, current_step = $${paramIndex}`;
      updateParams.push(currentStep);
      paramIndex++;
    }

    if (progressPercentage !== undefined) {
      updateQuery += `, progress_percentage = $${paramIndex}`;
      updateParams.push(progressPercentage);
      paramIndex++;
    }

    updateQuery += ` WHERE id = $${paramIndex}`;
    updateParams.push(sessionId);

    await pool.query(updateQuery, updateParams);

    res.json({
      snapshotId,
      version: nextVersion,
      savedAt: new Date().toISOString(),
    });
  }));

  // Update session metadata
  app.patch('/api/autosave/sessions/:sessionId', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.claims?.sub || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { sessionId } = req.params;
    const updates = req.body;

    log.info('Updating session', { userId, sessionId });

    // Verify ownership
    const sessionResult = await pool.query(`
      SELECT * FROM user_work_sessions
      WHERE id = $1 AND user_id = $2
    `, [sessionId, userId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const setClauses: string[] = ['updated_at = NOW()'];
    const params: any[] = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      setClauses.push(`${key} = $${paramIndex}`);
      params.push(value);
      paramIndex++;
    });

    params.push(sessionId);

    await pool.query(`
      UPDATE user_work_sessions
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
    `, params);

    res.json({ success: true });
  }));

  // Delete session
  app.delete('/api/autosave/sessions/:sessionId', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.claims?.sub || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { sessionId } = req.params;

    log.info('Deleting session', { userId, sessionId });

    const result = await pool.query(`
      DELETE FROM user_work_sessions
      WHERE id = $1 AND user_id = $2
    `, [sessionId, userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ success: true });
  }));

  // Add consultation message
  app.post('/api/autosave/sessions/:sessionId/consultation', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.claims?.sub || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { sessionId } = req.params;
    const { role, message, extractedData } = req.body;

    log.debug('Adding consultation message', { userId, sessionId, role });

    // Verify ownership
    const sessionResult = await pool.query(`
      SELECT law_type FROM user_work_sessions
      WHERE id = $1 AND user_id = $2
    `, [sessionId, userId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const lawType = sessionResult.rows[0].law_type;
    const consultationId = crypto.randomUUID();

    await pool.query(`
      INSERT INTO consultation_history (id, session_id, role, message, law_type, extracted_data)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [consultationId, sessionId, role, message, lawType, extractedData ? JSON.stringify(extractedData) : null]);

    res.json({ id: consultationId, createdAt: new Date().toISOString() });
  }));

  // Save document draft
  app.post('/api/autosave/sessions/:sessionId/document-draft', isAuthenticated, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.claims?.sub || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { sessionId } = req.params;
    const { content, documentType, generatedBy, aiProvider } = req.body;

    log.info('Saving document draft', { userId, sessionId, documentType });

    // Verify ownership
    const sessionResult = await pool.query(`
      SELECT law_type FROM user_work_sessions
      WHERE id = $1 AND user_id = $2
    `, [sessionId, userId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const lawType = sessionResult.rows[0].law_type;

    // Mark previous drafts as not latest
    await pool.query(`
      UPDATE document_drafts
      SET is_latest = false
      WHERE session_id = $1 AND is_latest = true
    `, [sessionId]);

    // Get next version number
    const versionResult = await pool.query(`
      SELECT MAX(version_number) as max_version
      FROM document_drafts
      WHERE session_id = $1
    `, [sessionId]);

    const nextVersion = (versionResult.rows[0]?.max_version || 0) + 1;
    const draftId = crypto.randomUUID();

    await pool.query(`
      INSERT INTO document_drafts (
        id, session_id, document_type, law_type, draft_content, 
        version_number, is_latest, generated_by, ai_provider
      )
      VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
    `, [draftId, sessionId, documentType, lawType, content, nextVersion, generatedBy, aiProvider]);

    res.json({
      draftId,
      version: nextVersion,
      createdAt: new Date().toISOString(),
    });
  }));

  log.info('Autosave routes registered');
}
