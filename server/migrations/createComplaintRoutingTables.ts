/**
 * Migration: Create Complaint Routing Tables
 * Creates authority_contacts_cache, complaint_routing_history, and section_1983_filings tables
 */

import { pool } from '../db';

export async function createComplaintRoutingTables(): Promise<void> {
  const client = await pool.connect();
  
  try {
    console.log('[Migration] Starting Complaint Routing tables creation...');

    // Authority Contacts Cache table
    await client.query(`
      CREATE TABLE IF NOT EXISTS authority_contacts_cache (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        department_name TEXT NOT NULL,
        city VARCHAR(100) NOT NULL,
        county VARCHAR(100),
        state VARCHAR(2) NOT NULL,
        contact_name TEXT,
        contact_title TEXT,
        contact_email TEXT,
        contact_phone TEXT,
        contact_address TEXT,
        contact_type VARCHAR(30) NOT NULL,
        confidence VARCHAR(10) NOT NULL DEFAULT 'medium',
        source_url TEXT,
        source_type VARCHAR(30),
        last_verified_at TIMESTAMP,
        verification_status VARCHAR(20) DEFAULT 'unverified',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('[Migration] ✓ Created authority_contacts_cache table');

    // Indexes for authority_contacts_cache
    await client.query(`CREATE INDEX IF NOT EXISTS idx_authority_dept_city_state ON authority_contacts_cache(department_name, city, state)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_authority_contact_type ON authority_contacts_cache(contact_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_authority_active ON authority_contacts_cache(is_active)`);
    console.log('[Migration] ✓ Created indexes for authority_contacts_cache');

    // Complaint Routing History table
    await client.query(`
      CREATE TABLE IF NOT EXISTS complaint_routing_history (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        complaint_id VARCHAR REFERENCES complaints(id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL DEFAULT 1,
        recipient_email TEXT NOT NULL,
        recipient_name TEXT,
        recipient_type VARCHAR(30),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        status_message TEXT,
        email_subject TEXT,
        email_message_id VARCHAR,
        is_fallback BOOLEAN DEFAULT false,
        fallback_reason TEXT,
        attempted_at TIMESTAMP DEFAULT NOW(),
        delivered_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('[Migration] ✓ Created complaint_routing_history table');

    // Indexes for complaint_routing_history
    await client.query(`CREATE INDEX IF NOT EXISTS idx_routing_complaint ON complaint_routing_history(complaint_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_routing_status ON complaint_routing_history(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_routing_fallback ON complaint_routing_history(is_fallback)`);
    console.log('[Migration] ✓ Created indexes for complaint_routing_history');

    // Section 1983 Filings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS section_1983_filings (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        complaint_id VARCHAR REFERENCES complaints(id) ON DELETE SET NULL,
        lawsuit_filing_id VARCHAR REFERENCES lawsuit_filings(id) ON DELETE SET NULL,
        
        plaintiff_name TEXT NOT NULL,
        plaintiff_address TEXT NOT NULL,
        plaintiff_city VARCHAR(100) NOT NULL,
        plaintiff_state VARCHAR(2) NOT NULL,
        plaintiff_zip VARCHAR(10),
        plaintiff_phone VARCHAR,
        plaintiff_email VARCHAR,
        is_pro_se BOOLEAN DEFAULT true,
        
        attorney_name TEXT,
        attorney_bar_number VARCHAR,
        attorney_firm TEXT,
        attorney_address TEXT,
        attorney_phone VARCHAR,
        attorney_email VARCHAR,
        
        defendants JSONB NOT NULL,
        
        incident_date TIMESTAMP NOT NULL,
        incident_time VARCHAR,
        incident_location TEXT NOT NULL,
        incident_city VARCHAR(100) NOT NULL,
        incident_county VARCHAR(100),
        incident_state VARCHAR(2) NOT NULL,
        incident_description TEXT NOT NULL,
        
        claims JSONB NOT NULL,
        
        damages_compensatory JSONB,
        damages_punitive BOOLEAN DEFAULT false,
        damages_punitive_description TEXT,
        damages_injunctive TEXT,
        damages_declaratory TEXT,
        damages_attorneys_fees BOOLEAN DEFAULT true,
        
        district_court TEXT NOT NULL,
        court_division VARCHAR(100),
        venue_reason TEXT NOT NULL,
        
        generated_document TEXT,
        local_rules_applied JSONB,
        
        filing_fee INTEGER DEFAULT 40200,
        service_deadline TIMESTAMP,
        
        status VARCHAR(30) NOT NULL DEFAULT 'draft',
        
        payment_id VARCHAR,
        payment_status VARCHAR DEFAULT 'pending',
        amount_paid INTEGER,
        
        generated_at TIMESTAMP,
        downloaded_at TIMESTAMP,
        filed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('[Migration] ✓ Created section_1983_filings table');

    // Indexes for section_1983_filings
    await client.query(`CREATE INDEX IF NOT EXISTS idx_1983_user ON section_1983_filings(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_1983_status ON section_1983_filings(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_1983_district ON section_1983_filings(district_court)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_1983_incident_date ON section_1983_filings(incident_date)`);
    console.log('[Migration] ✓ Created indexes for section_1983_filings');

    console.log('[Migration] ✅ Successfully created all Complaint Routing tables and indexes');
    console.log('[Migration] ✅ Authority Contacts Cache table: READY for contact storage');
    console.log('[Migration] ✅ Complaint Routing History table: READY for routing tracking');
    console.log('[Migration] ✅ Section 1983 Filings table: READY for federal lawsuit filings');

  } catch (error: any) {
    console.error('[Migration] Error creating Complaint Routing tables:', error);
    throw error;
  } finally {
    client.release();
  }
}
