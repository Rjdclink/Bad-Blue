/**
 * Stage 2A: Evidence Upload API Routes
 * Handles file uploads with law type associations
 */

import { type Express, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { pool } from '../db';
import { isAuthenticated } from '../auth';
import { asyncHandler } from '../errorHandler';
import { createLogger } from '../logger';
import { isValidLawType } from '@shared/lawTypes';

const log = createLogger('UploadRoutes');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'evidence');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error as Error, uploadDir);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = randomUUID();
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

// File filter for allowed types
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Allowed MIME types
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${file.mimetype}`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
});

export function setupUploadRoutes(app: Express): void {
  
  /**
   * POST /api/upload/evidence
   * Upload evidence file with law type association
   * 
   * Body (multipart/form-data):
   * - file: The file to upload
   * - lawType: Law type ID (optional)
   * - associatedWith: 'consultation' | 'document' (optional)
   */
  app.post(
    '/api/upload/evidence',
    isAuthenticated,
    upload.single('file'),
    asyncHandler(async (req: any, res: Response) => {
      const file = req.file;
      const { lawType, associatedWith } = req.body;
      const userId = req.user?.id;

      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Validate law type if provided
      if (lawType && !isValidLawType(lawType)) {
        // Clean up uploaded file
        await fs.unlink(file.path).catch(() => {});
        return res.status(400).json({ error: 'Invalid law type' });
      }

      // Validate associatedWith if provided
      if (associatedWith && !['consultation', 'document'].includes(associatedWith)) {
        await fs.unlink(file.path).catch(() => {});
        return res.status(400).json({ error: 'Invalid associatedWith value' });
      }

      try {
        // Store file metadata in database
        const result = await pool.query(
          `INSERT INTO evidence_files 
           (user_id, file_name, file_type, file_size, storage_path, law_type, associated_with)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, file_name, file_type, file_size, uploaded_at`,
          [
            userId,
            file.originalname,
            file.mimetype,
            file.size,
            file.path,
            lawType || null,
            associatedWith || null,
          ]
        );

        const uploadedFile = result.rows[0];
        
        log.info('File uploaded successfully', {
          fileId: uploadedFile.id,
          userId,
          fileName: file.originalname,
          size: file.size,
          lawType,
        });

        res.json({
          success: true,
          file: {
            id: uploadedFile.id,
            name: uploadedFile.file_name,
            type: uploadedFile.file_type,
            size: uploadedFile.file_size,
            uploadedAt: uploadedFile.uploaded_at,
          },
        });
      } catch (error) {
        // Clean up file on database error
        await fs.unlink(file.path).catch(() => {});
        log.error('Failed to save file metadata', { error, userId });
        throw error;
      }
    })
  );

  /**
   * GET /api/upload/evidence
   * Get list of uploaded files for the authenticated user
   * 
   * Query params:
   * - lawType: Filter by law type (optional)
   * - associatedWith: Filter by association (optional)
   */
  app.get(
    '/api/upload/evidence',
    isAuthenticated,
    asyncHandler(async (req: any, res: Response) => {
      const userId = req.user?.id;
      const { lawType, associatedWith } = req.query;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      let query = `
        SELECT id, file_name, file_type, file_size, uploaded_at, law_type, associated_with
        FROM evidence_files
        WHERE user_id = $1
      `;
      const params: any[] = [userId];
      let paramCount = 1;

      if (lawType) {
        paramCount++;
        query += ` AND law_type = $${paramCount}`;
        params.push(lawType);
      }

      if (associatedWith) {
        paramCount++;
        query += ` AND associated_with = $${paramCount}`;
        params.push(associatedWith);
      }

      query += ' ORDER BY uploaded_at DESC';

      const result = await pool.query(query, params);

      res.json({
        files: result.rows.map(row => ({
          id: row.id,
          name: row.file_name,
          type: row.file_type,
          size: row.file_size,
          uploadedAt: row.uploaded_at,
          lawType: row.law_type,
          associatedWith: row.associated_with,
        })),
      });
    })
  );

  /**
   * DELETE /api/upload/evidence/:id
   * Delete an uploaded file
   */
  app.delete(
    '/api/upload/evidence/:id',
    isAuthenticated,
    asyncHandler(async (req: any, res: Response) => {
      const { id } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Get file info
      const result = await pool.query(
        'SELECT storage_path FROM evidence_files WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'File not found' });
      }

      const storagePath = result.rows[0].storage_path;

      // Delete from database
      await pool.query('DELETE FROM evidence_files WHERE id = $1 AND user_id = $2', [id, userId]);

      // Delete physical file
      try {
        await fs.unlink(storagePath);
      } catch (error) {
        log.warn('Failed to delete physical file', { storagePath, error });
        // Continue even if physical file deletion fails
      }

      log.info('File deleted successfully', { fileId: id, userId });

      res.json({ success: true });
    })
  );

  log.info('Upload routes registered');
}
