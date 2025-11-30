import { db } from '../db';
import { sql } from 'drizzle-orm';

export async function createCoreTables() {
  console.log('[Migration] Starting Core tables creation...');

  try {
    // ============================================
    // 1. COMPLAINTS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS complaints (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        badge_lookup_id VARCHAR REFERENCES badge_lookups(id) ON DELETE SET NULL,
        officer_name TEXT NOT NULL,
        officer_badge VARCHAR,
        officer_department TEXT NOT NULL,
        state VARCHAR(2) NOT NULL,
        city TEXT NOT NULL,
        complaint_type VARCHAR NOT NULL,
        incident_date TIMESTAMP NOT NULL,
        incident_time VARCHAR,
        description TEXT NOT NULL,
        evidence_urls TEXT[],
        submission_venue VARCHAR,
        submission_email TEXT,
        submission_address TEXT,
        status VARCHAR NOT NULL DEFAULT 'pending',
        status_updated_at TIMESTAMP DEFAULT NOW(),
        submitted_at TIMESTAMP,
        payment_id VARCHAR,
        payment_status VARCHAR DEFAULT 'pending',
        amount_paid INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created complaints table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_complaints_user_id ON complaints(user_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
    `);
    console.log('[Migration] ✓ Created indexes for complaints');

    // ============================================
    // 2. LAWSUIT FILINGS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS lawsuit_filings (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        complaint_id VARCHAR REFERENCES complaints(id) ON DELETE SET NULL,
        officer_name TEXT NOT NULL,
        officer_badge VARCHAR,
        officer_department TEXT NOT NULL,
        state VARCHAR(2) NOT NULL,
        city TEXT NOT NULL,
        county TEXT,
        lawsuit_type VARCHAR NOT NULL,
        lawsuit_tier VARCHAR NOT NULL DEFAULT 'diy',
        incident_date TIMESTAMP NOT NULL,
        incident_time VARCHAR,
        description TEXT NOT NULL,
        plaintiff_name TEXT,
        plaintiff_address TEXT,
        return_mailing_address TEXT,
        damages_requested INTEGER,
        injury_details TEXT,
        subsequent_events TEXT,
        medical_costs INTEGER,
        evidence_urls TEXT[],
        witness_names TEXT[],
        generated_document TEXT,
        state_statutes TEXT[],
        filing_court TEXT,
        filing_address TEXT,
        filing_instructions TEXT,
        filing_fee INTEGER,
        e_filing_portal_url TEXT,
        e_filing_portal_name TEXT,
        clerk_of_court_address TEXT,
        tort_notice_required BOOLEAN DEFAULT FALSE,
        tort_notice_sent BOOLEAN DEFAULT FALSE,
        tort_notice_agency TEXT,
        tort_notice_sent_at TIMESTAMP,
        tort_notice_document TEXT,
        relevant_precedents TEXT[],
        status VARCHAR NOT NULL DEFAULT 'pending',
        status_updated_at TIMESTAMP DEFAULT NOW(),
        payment_id VARCHAR,
        payment_status VARCHAR DEFAULT 'pending',
        amount_paid INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created lawsuit_filings table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_lawsuit_filings_user_id ON lawsuit_filings(user_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_lawsuit_filings_status ON lawsuit_filings(status);
    `);
    console.log('[Migration] ✓ Created indexes for lawsuit_filings');

    // ============================================
    // 3. JURISDICTIONS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS jurisdictions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        state VARCHAR(2) NOT NULL,
        county TEXT,
        city TEXT,
        agency_type VARCHAR NOT NULL,
        agency_name TEXT NOT NULL,
        contact_email TEXT,
        contact_phone TEXT,
        contact_address TEXT,
        website_url TEXT,
        verified BOOLEAN DEFAULT FALSE,
        confidence INTEGER DEFAULT 50,
        verified_at TIMESTAMP,
        source TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created jurisdictions table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_jurisdiction_location ON jurisdictions(state, city, agency_type);
    `);
    console.log('[Migration] ✓ Created indexes for jurisdictions');

    // ============================================
    // 4. CONTACT MESSAGES TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        type VARCHAR NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR NOT NULL DEFAULT 'new',
        email_sent BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created contact_messages table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status);
    `);
    console.log('[Migration] ✓ Created indexes for contact_messages');

    // ============================================
    // 5. BADGE LOOKUPS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS badge_lookups (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        image_url TEXT,
        badge_number VARCHAR,
        department TEXT,
        officer_name TEXT,
        officer_rank TEXT,
        officer_years INTEGER,
        department_location TEXT,
        jurisdiction TEXT,
        analysis_confidence TEXT,
        raw_ai_response TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created badge_lookups table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_badge_lookups_user_id ON badge_lookups(user_id);
    `);
    console.log('[Migration] ✓ Created indexes for badge_lookups');

    // ============================================
    // 6. SAVED PROGRESS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS saved_progress (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        flow_key VARCHAR(50) NOT NULL,
        step_index INTEGER NOT NULL DEFAULT 0,
        form_data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created saved_progress table');

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS saved_progress_user_flow_unique ON saved_progress(user_id, flow_key);
    `);
    console.log('[Migration] ✓ Created indexes for saved_progress');

    // ============================================
    // 7. TRIAL CONSULTATIONS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS trial_consultations (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        ip_address VARCHAR NOT NULL,
        device_fingerprint TEXT,
        user_agent TEXT,
        question TEXT NOT NULL,
        response TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created trial_consultations table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS trial_consultations_ip_idx ON trial_consultations(ip_address);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS trial_consultations_fingerprint_idx ON trial_consultations(device_fingerprint);
    `);
    console.log('[Migration] ✓ Created indexes for trial_consultations');

    // ============================================
    // 8. DEVICE FINGERPRINTS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS device_fingerprints (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id TEXT NOT NULL UNIQUE,
        sample_used_at TIMESTAMP NOT NULL,
        ip_address VARCHAR,
        user_agent TEXT,
        state VARCHAR(2),
        situation TEXT,
        response TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created device_fingerprints table');

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS device_fingerprints_device_id_unique ON device_fingerprints(device_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS device_fingerprints_ip_idx ON device_fingerprints(ip_address);
    `);
    console.log('[Migration] ✓ Created indexes for device_fingerprints');

    // ============================================
    // 9. ADMIN ACCESS LOGS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_access_logs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id VARCHAR NOT NULL,
        ip_address VARCHAR,
        user_agent TEXT,
        session_id VARCHAR,
        accessed_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created admin_access_logs table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_admin_access_logs_admin_id ON admin_access_logs(admin_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_admin_access_logs_accessed_at ON admin_access_logs(accessed_at);
    `);
    console.log('[Migration] ✓ Created indexes for admin_access_logs');

    // ============================================
    // 10. AI SUB-AGENT LOGS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_subagent_logs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id VARCHAR NOT NULL,
        command TEXT NOT NULL,
        category VARCHAR,
        status VARCHAR NOT NULL DEFAULT 'processing',
        response TEXT,
        execution_time_ms INTEGER,
        error_message TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Created ai_subagent_logs table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ai_subagent_logs_admin_id ON ai_subagent_logs(admin_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ai_subagent_logs_status ON ai_subagent_logs(status);
    `);
    console.log('[Migration] ✓ Created indexes for ai_subagent_logs');

    // ============================================
    // 11. PETITIONS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS petitions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slug VARCHAR UNIQUE NOT NULL,
        officer_name TEXT NOT NULL,
        department TEXT NOT NULL,
        state TEXT NOT NULL,
        city TEXT,
        county TEXT,
        offense_description_original TEXT NOT NULL,
        offense_description_redrafted TEXT,
        additional_text TEXT,
        bottom_link TEXT,
        submitter_name TEXT NOT NULL,
        payment_id VARCHAR,
        signature_count INTEGER DEFAULT 0,
        last_compiled_at TIMESTAMP,
        shareable_url TEXT,
        social_media_shared BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created petitions table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_petitions_user_id ON petitions(user_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_petitions_slug ON petitions(slug);
    `);
    console.log('[Migration] ✓ Created indexes for petitions');

    // ============================================
    // 12. PETITION SIGNATURES TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS petition_signatures (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
        petition_id TEXT NOT NULL REFERENCES petitions(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        typed_signature TEXT NOT NULL,
        drawn_signature TEXT,
        signed_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created petition_signatures table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_petition_signatures_petition_id ON petition_signatures(petition_id);
    `);
    console.log('[Migration] ✓ Created indexes for petition_signatures');

    // ============================================
    // 13. FOIA REQUESTS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS foia_requests (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_full_name TEXT NOT NULL,
        user_email TEXT NOT NULL,
        mailing_address TEXT NOT NULL,
        state VARCHAR(2) NOT NULL,
        agency_type VARCHAR NOT NULL,
        agency_name TEXT,
        department_name TEXT NOT NULL,
        department_address TEXT,
        officer_name TEXT NOT NULL,
        incident_date TEXT,
        incident_time TEXT,
        incident_location TEXT,
        records_description TEXT NOT NULL,
        generated_letter TEXT,
        state_statute TEXT,
        statutory_deadline TEXT,
        authorization_accepted BOOLEAN DEFAULT FALSE,
        payment_id VARCHAR,
        payment_status VARCHAR DEFAULT 'pending',
        amount_paid INTEGER,
        status VARCHAR NOT NULL DEFAULT 'draft',
        status_updated_at TIMESTAMP DEFAULT NOW(),
        certified_mail_tracking_number TEXT,
        mailed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created foia_requests table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_foia_requests_user_id ON foia_requests(user_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_foia_requests_status ON foia_requests(status);
    `);
    console.log('[Migration] ✓ Created indexes for foia_requests');

    // ============================================
    // 14. FOIA STATE STATUTES TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS foia_state_statutes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        state VARCHAR(2) NOT NULL UNIQUE,
        statute_name TEXT NOT NULL,
        statute_citation TEXT NOT NULL,
        statutory_deadline TEXT NOT NULL,
        letter_template TEXT,
        additional_requirements TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created foia_state_statutes table');

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_foia_state_statutes_state ON foia_state_statutes(state);
    `);
    console.log('[Migration] ✓ Created indexes for foia_state_statutes');

    // ============================================
    // 15. COMPLAINT PATTERNS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS complaint_patterns (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        source_firm TEXT,
        source_citation TEXT,
        source_url TEXT,
        jurisdiction TEXT,
        violation_type TEXT,
        claim_types TEXT[],
        fact_pattern TEXT,
        document_structure JSONB,
        writing_style JSONB,
        legal_arguments JSONB,
        citation_style TEXT,
        outcome TEXT,
        settlement_amount INTEGER,
        effectiveness_score INTEGER,
        full_text TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created complaint_patterns table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_complaint_patterns_violation_type ON complaint_patterns(violation_type);
    `);
    console.log('[Migration] ✓ Created indexes for complaint_patterns');

    // ============================================
    // 16. LEGAL STRATEGIES TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS legal_strategies (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        strategy_name TEXT NOT NULL,
        strategy_type TEXT,
        applicable_claims TEXT[],
        description TEXT,
        implementation TEXT,
        example_text TEXT,
        success_rate INTEGER,
        usage_count INTEGER DEFAULT 0,
        jurisdiction TEXT,
        recommended_for TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created legal_strategies table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_legal_strategies_strategy_type ON legal_strategies(strategy_type);
    `);
    console.log('[Migration] ✓ Created indexes for legal_strategies');

    // ============================================
    // 17. CASE PATTERNS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS case_patterns (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id VARCHAR,
        case_type TEXT,
        fact_pattern TEXT NOT NULL,
        claim_types TEXT[],
        violation_type TEXT,
        jurisdiction TEXT,
        officer_conduct TEXT,
        plaintiff_injury TEXT,
        evidence TEXT[],
        witnesses BOOLEAN,
        outcome TEXT,
        strength_rating INTEGER,
        weaknesses TEXT[],
        strengths TEXT[],
        document_quality INTEGER,
        format_applied TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created case_patterns table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_case_patterns_case_type ON case_patterns(case_type);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_case_patterns_violation_type ON case_patterns(violation_type);
    `);
    console.log('[Migration] ✓ Created indexes for case_patterns');

    // ============================================
    // 18. DOCUMENT FORMATS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS document_formats (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        format_name TEXT NOT NULL,
        format_type TEXT,
        source TEXT,
        sections JSONB,
        heading_style TEXT,
        paragraph_style TEXT,
        citation_format TEXT,
        jurisdiction TEXT,
        court_level TEXT,
        claim_types TEXT[],
        template_text TEXT,
        required_fields TEXT[],
        usage_count INTEGER DEFAULT 0,
        success_rate INTEGER,
        average_quality_score INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created document_formats table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_document_formats_format_type ON document_formats(format_type);
    `);
    console.log('[Migration] ✓ Created indexes for document_formats');

    // ============================================
    // 19. APP SETTINGS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR PRIMARY KEY,
        value TEXT NOT NULL,
        updated_by VARCHAR,
        updated_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created app_settings table');

    // ============================================
    // 20. ADMIN SETTINGS AUDIT TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_settings_audit (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        setting_key VARCHAR NOT NULL,
        old_value TEXT,
        new_value TEXT NOT NULL,
        admin_id VARCHAR NOT NULL,
        ip_address VARCHAR,
        changed_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created admin_settings_audit table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_admin_settings_audit_setting_key ON admin_settings_audit(setting_key);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_admin_settings_audit_changed_at ON admin_settings_audit(changed_at);
    `);
    console.log('[Migration] ✓ Created indexes for admin_settings_audit');

    // ============================================
    // 21. SUBSCRIPTION TIERS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscription_tiers (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR NOT NULL UNIQUE,
        description TEXT,
        price_in_cents INTEGER NOT NULL,
        duration_days INTEGER NOT NULL,
        stripe_price_id VARCHAR,
        stripe_product_id VARCHAR,
        features TEXT[],
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created subscription_tiers table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_subscription_tiers_is_active ON subscription_tiers(is_active);
    `);
    console.log('[Migration] ✓ Created indexes for subscription_tiers');

    // ============================================
    // 22. USER SUBSCRIPTIONS TABLE
    // ============================================
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_subscriptions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tier_id VARCHAR NOT NULL REFERENCES subscription_tiers(id) ON DELETE CASCADE,
        start_date TIMESTAMP NOT NULL DEFAULT NOW(),
        end_date TIMESTAMP NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        payment_id VARCHAR,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created user_subscriptions table');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_user_subscriptions_tier_id ON user_subscriptions(tier_id);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_user_subscriptions_is_active ON user_subscriptions(is_active);
    `);
    console.log('[Migration] ✓ Created indexes for user_subscriptions');

    console.log('[Migration] ✅ Successfully created all Core tables and indexes');
    console.log('[Migration] ✅ Complaints table: READY for police complaint submissions');
    console.log('[Migration] ✅ Lawsuit Filings table: READY for civil rights lawsuits');
    console.log('[Migration] ✅ Jurisdictions table: READY for state-specific legal info');
    console.log('[Migration] ✅ Contact Messages table: READY for contact form');
    console.log('[Migration] ✅ Badge Lookups table: READY for officer badge lookups');
    console.log('[Migration] ✅ Saved Progress table: READY for autosave system');
    console.log('[Migration] ✅ Trial Consultations table: READY for IP-based consultations');
    console.log('[Migration] ✅ Device Fingerprints table: READY for rate limiting');
    console.log('[Migration] ✅ Admin Access Logs table: READY for security audit');
    console.log('[Migration] ✅ AI Sub-Agent Logs table: READY for AI activity logging');
    console.log('[Migration] ✅ Petitions table: READY for petition creation');
    console.log('[Migration] ✅ Petition Signatures table: READY for signature collection');
    console.log('[Migration] ✅ FOIA Requests table: READY for FOIA request records');
    console.log('[Migration] ✅ FOIA State Statutes table: READY for state-specific rules');
    console.log('[Migration] ✅ Complaint Patterns table: READY for AI-identified patterns');
    console.log('[Migration] ✅ Legal Strategies table: READY for legal strategy data');
    console.log('[Migration] ✅ Case Patterns table: READY for case pattern analysis');
    console.log('[Migration] ✅ Document Formats table: READY for document templates');
    console.log('[Migration] ✅ App Settings table: READY for application settings');
    console.log('[Migration] ✅ Admin Settings Audit table: READY for settings audit');
    console.log('[Migration] ✅ Subscription Tiers table: READY for subscription definitions');
    console.log('[Migration] ✅ User Subscriptions table: READY for user subscriptions');
    return true;
  } catch (error) {
    console.error('[Migration] ❌ Failed to create Core tables:', error);
    throw error;
  }
}
