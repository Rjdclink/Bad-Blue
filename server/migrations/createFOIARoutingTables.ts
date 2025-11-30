import { sql } from 'drizzle-orm';
import { db } from '../db';

export async function createFOIARoutingTables() {
  console.log('[Migration] Starting FOIA Routing tables creation...');
  
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS foia_routing_history (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        foia_id VARCHAR,
        agency_name VARCHAR NOT NULL,
        state VARCHAR(2) NOT NULL,
        city VARCHAR,
        routing_method VARCHAR(50) NOT NULL,
        success BOOLEAN NOT NULL DEFAULT false,
        recipient_email VARCHAR,
        recipient_type VARCHAR(50),
        notes TEXT,
        error_message TEXT,
        attempted_at TIMESTAMP DEFAULT NOW() NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    console.log('[Migration] ✓ Created foia_routing_history table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_foia_routing_agency ON foia_routing_history(agency_name, state);
      CREATE INDEX IF NOT EXISTS idx_foia_routing_foia_id ON foia_routing_history(foia_id);
      CREATE INDEX IF NOT EXISTS idx_foia_routing_success ON foia_routing_history(success);
      CREATE INDEX IF NOT EXISTS idx_foia_routing_attempted ON foia_routing_history(attempted_at);
    `);
    console.log('[Migration] ✓ Created indexes for foia_routing_history');

    console.log('[Migration] ✅ Successfully created FOIA Routing tables and indexes');
    console.log('[Migration] ✅ FOIA Routing History table: READY for tracking FOIA submissions');
    
    return { success: true };
  } catch (error) {
    console.error('[Migration] Error creating FOIA Routing tables:', error);
    return { success: false, error };
  }
}
