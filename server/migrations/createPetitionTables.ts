import { db } from '../db';
import { sql } from 'drizzle-orm';

export async function createPetitionTables() {
  console.log('[Migration] Starting Petition tables creation...');

  try {
    // Create petition_workflows table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS petition_workflows (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        
        city VARCHAR(100) NOT NULL,
        state VARCHAR(2) NOT NULL,
        city_population INTEGER,
        required_signatures INTEGER NOT NULL,
        
        officer_name TEXT NOT NULL,
        officer_badge VARCHAR,
        officer_department TEXT,
        misconduct_summary TEXT NOT NULL,
        requested_action TEXT NOT NULL,
        
        petitioner_name TEXT NOT NULL,
        petitioner_email VARCHAR,
        petitioner_address TEXT,
        
        status VARCHAR(30) NOT NULL DEFAULT 'collecting_input',
        
        petition_content TEXT,
        petition_content_generated_at TIMESTAMP,
        
        submission_channel VARCHAR(50),
        submission_target TEXT,
        
        residents_collected INTEGER DEFAULT 0,
        last_harvest_at TIMESTAMP,
        
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        submitted_at TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Created petition_workflows table');

    // Create indexes for petition_workflows
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_petition_user ON petition_workflows(user_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_petition_status ON petition_workflows(status);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_petition_city_state ON petition_workflows(city, state);
    `);
    console.log('[Migration] ✓ Created indexes for petition_workflows');

    // Create petition_sources table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS petition_sources (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id VARCHAR NOT NULL REFERENCES petition_workflows(id) ON DELETE CASCADE,
        
        source_type VARCHAR(30) NOT NULL,
        source_url TEXT,
        source_name TEXT,
        
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        
        residents_found INTEGER DEFAULT 0,
        error_message TEXT,
        
        harvested_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created petition_sources table');

    // Create indexes for petition_sources
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_source_workflow ON petition_sources(workflow_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_source_type ON petition_sources(source_type);
    `);
    console.log('[Migration] ✓ Created indexes for petition_sources');

    // Create petition_signers table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS petition_signers (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id VARCHAR NOT NULL REFERENCES petition_workflows(id) ON DELETE CASCADE,
        source_id VARCHAR REFERENCES petition_sources(id) ON DELETE SET NULL,
        
        full_name TEXT NOT NULL,
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(2),
        zip_code VARCHAR(10),
        
        dedupe_key VARCHAR(64),
        source_type VARCHAR(30),
        source_url TEXT,
        confidence_score INTEGER DEFAULT 100,
        
        harvested_at TIMESTAMP,
        verified BOOLEAN DEFAULT FALSE,
        
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created petition_signers table');

    // Create indexes for petition_signers
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_signer_workflow ON petition_signers(workflow_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_signer_dedupe ON petition_signers(dedupe_key);
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS unique_signer_per_workflow ON petition_signers(workflow_id, dedupe_key);
    `);
    console.log('[Migration] ✓ Created indexes for petition_signers');

    // Create petition_submissions table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS petition_submissions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id VARCHAR NOT NULL REFERENCES petition_workflows(id) ON DELETE CASCADE,
        
        submission_method VARCHAR(30) NOT NULL,
        target_address TEXT NOT NULL,
        
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        
        response_received BOOLEAN DEFAULT FALSE,
        response_content TEXT,
        confirmation_number VARCHAR,
        
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        
        attempted_at TIMESTAMP,
        confirmed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created petition_submissions table');

    // Create indexes for petition_submissions
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_submission_workflow ON petition_submissions(workflow_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_submission_status ON petition_submissions(status);
    `);
    console.log('[Migration] ✓ Created indexes for petition_submissions');

    // Create city_council_channels table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS city_council_channels (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        
        city VARCHAR(100) NOT NULL,
        state VARCHAR(2) NOT NULL,
        
        portal_url TEXT,
        email_addresses TEXT,
        clerk_email TEXT,
        clerk_address TEXT,
        
        last_verified_at TIMESTAMP,
        verification_status VARCHAR(20) DEFAULT 'unverified',
        notes TEXT,
        
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created city_council_channels table');

    // Create indexes for city_council_channels
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_city_state_unique ON city_council_channels(city, state);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_channel_verification ON city_council_channels(verification_status);
    `);
    console.log('[Migration] ✓ Created indexes for city_council_channels');

    console.log('[Migration] ✅ Successfully created all Petition tables and indexes');
    console.log('[Migration] ✅ Petition Workflows table: READY for petition creation');
    console.log('[Migration] ✅ Petition Sources table: READY for data source tracking');
    console.log('[Migration] ✅ Petition Signers table: READY for resident collection');
    console.log('[Migration] ✅ Petition Submissions table: READY for submission tracking');
    console.log('[Migration] ✅ City Council Channels table: READY for submission routing');
  } catch (error) {
    console.error('[Migration] Error creating Petition tables:', error);
    throw error;
  }
}
