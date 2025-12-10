/**
 * Migration: Add F.M.I. (Forensic Media Intelligence) fields to evidence_files table
 * 
 * This migration adds comprehensive metadata fields to support the F.M.I. system,
 * which provides OCR, text extraction, content classification, legal relevance tagging,
 * contradiction detection, corroboration checks, and case-linking capabilities.
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';

export async function addFMIFields() {

  console.log('Starting F.M.I. fields migration...');

  try {
    // Add F.M.I. analysis status tracking
    await db.execute(sql`
      ALTER TABLE evidence_files 
      ADD COLUMN IF NOT EXISTS fmi_analysis_status VARCHAR(20) DEFAULT 'pending'
    `);

    await db.execute(sql`
      ALTER TABLE evidence_files 
      ADD COLUMN IF NOT EXISTS fmi_analyzed_at TIMESTAMP
    `);

    // Add OCR and text extraction fields
    await db.execute(sql`
      ALTER TABLE evidence_files 
      ADD COLUMN IF NOT EXISTS extracted_text TEXT
    `);

    await db.execute(sql`
      ALTER TABLE evidence_files 
      ADD COLUMN IF NOT EXISTS extracted_metadata JSONB
    `);

    // Add content classification and legal relevance
    await db.execute(sql`
      ALTER TABLE evidence_files 
      ADD COLUMN IF NOT EXISTS content_classification JSONB
    `);

    await db.execute(sql`
      ALTER TABLE evidence_files 
      ADD COLUMN IF NOT EXISTS legal_relevance_tags TEXT[]
    `);

    await db.execute(sql`
      ALTER TABLE evidence_files 
      ADD COLUMN IF NOT EXISTS legal_issues_identified TEXT[]
    `);

    // Add intelligence analysis results
    await db.execute(sql`
      ALTER TABLE evidence_files 
      ADD COLUMN IF NOT EXISTS contradictions JSONB
    `);

    await db.execute(sql`
      ALTER TABLE evidence_files 
      ADD COLUMN IF NOT EXISTS corroboration JSONB
    `);

    await db.execute(sql`
      ALTER TABLE evidence_files 
      ADD COLUMN IF NOT EXISTS case_linkages JSONB
    `);

    // Add evidence assessment fields
    await db.execute(sql`
      ALTER TABLE evidence_files 
      ADD COLUMN IF NOT EXISTS evidence_strength VARCHAR(20)
    `);

    await db.execute(sql`
      ALTER TABLE evidence_files 
      ADD COLUMN IF NOT EXISTS admissibility_assessment VARCHAR(30)
    `);

    await db.execute(sql`
      ALTER TABLE evidence_files 
      ADD COLUMN IF NOT EXISTS key_findings TEXT[]
    `);

    // Add index for analysis status
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_fmi_analysis_status 
      ON evidence_files(fmi_analysis_status)
    `);

    console.log('✅ F.M.I. fields migration completed successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ F.M.I. fields migration failed:', error);
    throw error;
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  addFMIFields()
    .then(() => {
      console.log('Migration complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}
