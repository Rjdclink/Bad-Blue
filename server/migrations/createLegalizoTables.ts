// Migration: Create LegalWhat Tables
import { db } from "../db";
import { sql } from "drizzle-orm";

export async function createLegalizoTables() {
  console.log("[MIGRATION] Creating LegalWhat tables...");

  try {
    // Create legalizo_subscriptions table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS legalizo_subscriptions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        square_subscription_id VARCHAR UNIQUE,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        plan_amount INTEGER NOT NULL DEFAULT 2599,
        current_period_start TIMESTAMP,
        current_period_end TIMESTAMP,
        canceled_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_legalizo_sub_user ON legalizo_subscriptions(user_id);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_legalizo_sub_status ON legalizo_subscriptions(status);
    `);

    // Create legalizo_consultation_sessions table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS legalizo_consultation_sessions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        law_type VARCHAR(100) NOT NULL,
        conversation_state JSONB NOT NULL DEFAULT '[]',
        consultation_data JSONB,
        document_data JSONB,
        status VARCHAR(50) NOT NULL DEFAULT 'in_progress',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP
      );
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_legalizo_consult_user ON legalizo_consultation_sessions(user_id);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_legalizo_consult_law_type ON legalizo_consultation_sessions(law_type);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_legalizo_consult_status ON legalizo_consultation_sessions(status);
    `);

    // Create people_search_reports table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS people_search_reports (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        search_query TEXT NOT NULL,
        subject_name VARCHAR(255),
        report_data JSONB NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'processing',
        error_message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP
      );
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_people_search_user ON people_search_reports(user_id);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_people_search_status ON people_search_reports(status);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_people_search_created ON people_search_reports(created_at);
    `);

    console.log("[MIGRATION] LegalWhat tables created successfully");
  } catch (error) {
    console.error("[MIGRATION] Error creating LegalWhat tables:", error);
    throw error;
  }
}
