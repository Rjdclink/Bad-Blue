/**
 * Migration: Create Document Creator Tables
 * Creates document_creator_sessions table for the Legal Document Creator feature
 * Uses db.execute for consistency with Drizzle ORM and SUPABASE_DATABASE_URL
 */

import { sql } from 'drizzle-orm';
import { db } from '../db';

export async function createDocumentCreatorTables(): Promise<void> {
  try {
    console.log('[Migration] Starting Document Creator tables creation...');
    console.log('[Migration] Using SUPABASE database connection');

    // Document Creator Sessions table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS document_creator_sessions (
        id TEXT PRIMARY KEY,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_state TEXT NOT NULL DEFAULT '[]',
        conversation_phase TEXT NOT NULL DEFAULT 'initial',
        document_type TEXT,
        jurisdiction_data TEXT,
        generated_document TEXT,
        payment_status TEXT DEFAULT 'pending',
        payment_id VARCHAR,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `);
    console.log('[Migration] ✓ Created document_creator_sessions table');

    // Indexes for document_creator_sessions
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_doc_creator_user ON document_creator_sessions(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_doc_creator_created ON document_creator_sessions(created_at DESC)`);
    console.log('[Migration] ✓ Created indexes for document_creator_sessions');

    console.log('[Migration] ✅ Successfully created Document Creator tables and indexes');
    console.log('[Migration] ✅ Document Creator Sessions table: READY for legal document creation');

  } catch (error: any) {
    console.error('[Migration] Error creating Document Creator tables:', error);
    throw error;
  }
}
