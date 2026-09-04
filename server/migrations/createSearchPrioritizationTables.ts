import { db } from '../db';
import { sql } from 'drizzle-orm';

export async function createSearchPrioritizationTables() {
  console.log('[Migration] Starting Search Prioritization tables creation...');

  try {
    // Create jurisdiction_populations table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS jurisdiction_populations (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        city VARCHAR(100) NOT NULL,
        state VARCHAR(2) NOT NULL,
        population INTEGER NOT NULL,
        region TEXT,
        entity_type VARCHAR(30) NOT NULL DEFAULT 'city',
        priority_score INTEGER DEFAULT 0,
        search_status VARCHAR(20) DEFAULT 'pending',
        last_searched_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(city, state)
      );
    `);
    console.log('[Migration] ✓ Created jurisdiction_populations table');

    // Create indexes for jurisdiction_populations
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_jurisdiction_state ON jurisdiction_populations(state);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_jurisdiction_population ON jurisdiction_populations(population DESC);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_jurisdiction_entity_type ON jurisdiction_populations(entity_type);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_jurisdiction_search_status ON jurisdiction_populations(search_status);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_jurisdiction_priority ON jurisdiction_populations(priority_score DESC);
    `);
    console.log('[Migration] ✓ Created indexes for jurisdiction_populations');

    // Create officer_category_priority table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS officer_category_priority (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        category_name VARCHAR(50) UNIQUE NOT NULL,
        priority_order INTEGER NOT NULL,
        search_interval_minutes INTEGER DEFAULT 10,
        rest_interval_minutes INTEGER DEFAULT 10,
        daily_budget_minutes INTEGER DEFAULT 60,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created officer_category_priority table');

    // Create index for officer_category_priority
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_category_priority_order ON officer_category_priority(priority_order);
    `);
    console.log('[Migration] ✓ Created indexes for officer_category_priority');

    // Insert default category priorities
    await db.execute(sql`
      INSERT INTO officer_category_priority (category_name, priority_order, search_interval_minutes, rest_interval_minutes, daily_budget_minutes)
      VALUES 
        ('municipal', 1, 10, 10, 90),
        ('town', 2, 10, 10, 45),
        ('state', 3, 10, 10, 25),
        ('government', 4, 10, 10, 15),
        ('corrections', 5, 10, 10, 5)
      ON CONFLICT (category_name) DO NOTHING;
    `);
    console.log('[Migration] ✓ Inserted default category priorities');

    // Create subagent_search_queue table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS subagent_search_queue (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        jurisdiction_id VARCHAR REFERENCES jurisdiction_populations(id) ON DELETE CASCADE,
        entity_type VARCHAR(30) NOT NULL,
        priority_score INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(20) DEFAULT 'queued',
        attempt_count INTEGER DEFAULT 0,
        last_attempt_at TIMESTAMP,
        next_attempt_at TIMESTAMP,
        error_message TEXT,
        officers_found INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created subagent_search_queue table');

    // Create indexes for subagent_search_queue
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_search_queue_status ON subagent_search_queue(status);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_search_queue_priority ON subagent_search_queue(priority_score DESC);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_search_queue_next_attempt ON subagent_search_queue(next_attempt_at);
    `);
    console.log('[Migration] ✓ Created indexes for subagent_search_queue');

    // Create subagent_search_sessions table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS subagent_search_sessions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        session_date VARCHAR(10) UNIQUE NOT NULL,
        total_budget_minutes INTEGER DEFAULT 180,
        minutes_used INTEGER DEFAULT 0,
        minutes_remaining INTEGER DEFAULT 180,
        interval_plan JSONB,
        searches_completed INTEGER DEFAULT 0,
        officers_found INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active',
        paused_at TIMESTAMP,
        resumed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created subagent_search_sessions table');

    // Create index for subagent_search_sessions
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_search_session_date ON subagent_search_sessions(session_date);
    `);
    console.log('[Migration] ✓ Created indexes for subagent_search_sessions');

    console.log('[Migration] ✅ Successfully created all Search Prioritization tables and indexes');
    console.log('[Migration] ✅ Jurisdiction Populations table: READY for population-based prioritization');
    console.log('[Migration] ✅ Officer Category Priority table: READY for category ordering');
    console.log('[Migration] ✅ Sub-Agent Search Queue table: READY for priority queue operations');
    console.log('[Migration] ✅ Sub-Agent Search Sessions table: READY for daily time budget tracking');

    return { success: true };
  } catch (error: any) {
    console.error('[Migration] Error creating Search Prioritization tables:', error.message);
    return { success: false, error: error.message };
  }
}
