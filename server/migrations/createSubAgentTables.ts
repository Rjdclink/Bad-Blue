import { db } from '../db';
import { sql } from 'drizzle-orm';

export async function createSubAgentTables() {
  console.log('[Migration] Starting Sub-Agent tables creation...');

  try {
    // Create subagent_capabilities table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS subagent_capabilities (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        capability_name VARCHAR UNIQUE NOT NULL,
        description TEXT NOT NULL,
        success_count INTEGER DEFAULT 0 NOT NULL,
        fail_count INTEGER DEFAULT 0 NOT NULL,
        avg_execution_time_ms INTEGER,
        last_used TIMESTAMP,
        learned_at TIMESTAMP DEFAULT NOW() NOT NULL,
        limitations TEXT[],
        improvements TEXT[],
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created subagent_capabilities table');

    // Create indexes for subagent_capabilities
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_capability_name ON subagent_capabilities(capability_name);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_last_used ON subagent_capabilities(last_used);
    `);
    console.log('[Migration] ✓ Created indexes for subagent_capabilities');

    // Create subagent_learning_patterns table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS subagent_learning_patterns (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        pattern_type VARCHAR NOT NULL,
        pattern_data JSONB NOT NULL,
        confidence_score INTEGER DEFAULT 50 NOT NULL,
        times_observed INTEGER DEFAULT 1 NOT NULL,
        last_observed TIMESTAMP DEFAULT NOW() NOT NULL,
        associated_capabilities TEXT[],
        impact VARCHAR,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created subagent_learning_patterns table');

    // Create indexes for subagent_learning_patterns
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_pattern_type ON subagent_learning_patterns(pattern_type);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_confidence_score ON subagent_learning_patterns(confidence_score);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_last_observed ON subagent_learning_patterns(last_observed);
    `);
    console.log('[Migration] ✓ Created indexes for subagent_learning_patterns');

    // Create subagent_performance_metrics table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS subagent_performance_metrics (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        metric_name VARCHAR NOT NULL,
        metric_value INTEGER NOT NULL,
        measured_at TIMESTAMP DEFAULT NOW() NOT NULL,
        context JSONB,
        task_id VARCHAR,
        capability_name VARCHAR,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created subagent_performance_metrics table');

    // Create indexes for subagent_performance_metrics
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_metric_name ON subagent_performance_metrics(metric_name);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_measured_at ON subagent_performance_metrics(measured_at);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_metrics_capability_name ON subagent_performance_metrics(capability_name);
    `);
    console.log('[Migration] ✓ Created indexes for subagent_performance_metrics');

    // Create subagent_self_improvement_actions table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS subagent_self_improvement_actions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        action_type VARCHAR NOT NULL,
        description TEXT NOT NULL,
        before_state JSONB,
        after_state JSONB,
        success_metrics JSONB,
        rollback_available BOOLEAN DEFAULT TRUE NOT NULL,
        rolled_back BOOLEAN DEFAULT FALSE NOT NULL,
        rollback_reason TEXT,
        impact VARCHAR,
        capability_affected VARCHAR,
        implemented_at TIMESTAMP DEFAULT NOW() NOT NULL,
        evaluated_at TIMESTAMP,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created subagent_self_improvement_actions table');

    // Create indexes for subagent_self_improvement_actions
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_action_type ON subagent_self_improvement_actions(action_type);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_implemented_at ON subagent_self_improvement_actions(implemented_at);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_impact ON subagent_self_improvement_actions(impact);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_rolled_back ON subagent_self_improvement_actions(rolled_back);
    `);
    console.log('[Migration] ✓ Created indexes for subagent_self_improvement_actions');

    // Create officer_profiles table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS officer_profiles (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        officer_name TEXT NOT NULL,
        badge_number VARCHAR,
        department TEXT,
        rank TEXT,
        location TEXT,
        career_data JSONB,
        incidents JSONB,
        court_cases JSONB,
        news_mentions JSONB,
        community_complaints JSONB,
        sources TEXT[],
        data_quality_score INTEGER,
        last_updated TIMESTAMP DEFAULT NOW(),
        search_count INTEGER DEFAULT 0,
        last_searched_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created officer_profiles table');

    // Create indexes for officer_profiles
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS officer_profiles_name_idx ON officer_profiles(officer_name);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS officer_profiles_badge_idx ON officer_profiles(badge_number);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS officer_profiles_department_idx ON officer_profiles(department);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS officer_profiles_location_idx ON officer_profiles(location);
    `);
    console.log('[Migration] ✓ Created indexes for officer_profiles');

    // Create department_urls table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS department_urls (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        department_name TEXT NOT NULL,
        url TEXT NOT NULL,
        location TEXT NOT NULL,
        state VARCHAR(2) NOT NULL,
        department_type VARCHAR NOT NULL,
        verified BOOLEAN DEFAULT FALSE NOT NULL,
        last_verified TIMESTAMP,
        contact_email TEXT,
        phone VARCHAR,
        jurisdiction TEXT,
        serves_population INTEGER,
        sources TEXT[],
        discovered_at TIMESTAMP DEFAULT NOW() NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created department_urls table');

    // Create indexes for department_urls
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_department_state ON department_urls(state);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_department_type ON department_urls(department_type);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_discovered_at ON department_urls(discovered_at);
    `);
    console.log('[Migration] ✓ Created indexes for department_urls');

    // Create sub_agent_search_cycles table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sub_agent_search_cycles (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        current_cycle VARCHAR NOT NULL DEFAULT 'officer',
        last_cycle_start TIMESTAMP,
        next_cycle_start TIMESTAMP,
        search_state VARCHAR NOT NULL DEFAULT 'not_running',
        is_paused BOOLEAN DEFAULT FALSE NOT NULL,
        pause_context JSONB,
        cycle_count INTEGER DEFAULT 0 NOT NULL,
        last_officer_search_count INTEGER,
        last_department_search_count INTEGER,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[Migration] ✓ Created sub_agent_search_cycles table');

    // Create indexes for sub_agent_search_cycles
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_search_state ON sub_agent_search_cycles(search_state);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_is_paused ON sub_agent_search_cycles(is_paused);
    `);
    console.log('[Migration] ✓ Created indexes for sub_agent_search_cycles');

    // Create worker_alerts table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS worker_alerts (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        timestamp TIMESTAMP DEFAULT NOW() NOT NULL,
        alert_type VARCHAR NOT NULL,
        severity INTEGER NOT NULL,
        title VARCHAR NOT NULL,
        message TEXT NOT NULL,
        metadata JSONB,
        resolved BOOLEAN DEFAULT FALSE NOT NULL,
        resolved_at TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Created worker_alerts table');

    // Create indexes for worker_alerts
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_alert_type_resolved ON worker_alerts(alert_type, resolved);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_worker_alerts_timestamp ON worker_alerts(timestamp);
    `);
    console.log('[Migration] ✓ Created indexes for worker_alerts');

    // Create worker_failure_logs table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS worker_failure_logs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        timestamp TIMESTAMP DEFAULT NOW() NOT NULL,
        function_affected VARCHAR(255) NOT NULL,
        cause TEXT NOT NULL,
        system_state VARCHAR(20) NOT NULL,
        severity INTEGER NOT NULL,
        priority INTEGER,
        category VARCHAR(50),
        resolved BOOLEAN DEFAULT FALSE NOT NULL,
        resolved_at TIMESTAMP,
        metadata JSONB
      );
    `);
    console.log('[Migration] ✓ Created worker_failure_logs table');

    // Create indexes for worker_failure_logs
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_failure_timestamp ON worker_failure_logs(timestamp);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_failure_category_severity ON worker_failure_logs(category, severity DESC, timestamp DESC);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_failure_unresolved ON worker_failure_logs(resolved) WHERE resolved = false;
    `);
    console.log('[Migration] ✓ Created indexes for worker_failure_logs');

    // Create worker_function_errors table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS worker_function_errors (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        timestamp TIMESTAMP DEFAULT NOW() NOT NULL,
        function_tested VARCHAR(255) NOT NULL,
        expected_behavior TEXT NOT NULL,
        observed_behavior TEXT NOT NULL,
        severity INTEGER NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        notes TEXT
      );
    `);
    console.log('[Migration] ✓ Created worker_function_errors table');

    // Create indexes for worker_function_errors
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_func_error_timestamp ON worker_function_errors(timestamp);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_func_error_status_severity ON worker_function_errors(status, severity DESC);
    `);
    console.log('[Migration] ✓ Created indexes for worker_function_errors');

    // Create worker_repair_metrics table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS worker_repair_metrics (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        timestamp TIMESTAMP DEFAULT NOW() NOT NULL,
        total_repairs INTEGER NOT NULL,
        successful_repairs INTEGER NOT NULL,
        repair_success_rate INTEGER NOT NULL,
        avg_repair_time_ms INTEGER,
        categories_repaired TEXT[],
        notable_repairs JSONB,
        period_start TIMESTAMP NOT NULL,
        period_end TIMESTAMP NOT NULL,
        metadata JSONB
      );
    `);
    console.log('[Migration] ✓ Created worker_repair_metrics table');

    // Create indexes for worker_repair_metrics
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_repair_metrics_timestamp ON worker_repair_metrics(timestamp);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_repair_period ON worker_repair_metrics(period_start, period_end);
    `);
    console.log('[Migration] ✓ Created indexes for worker_repair_metrics');

    // Create worker_health_metrics table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS worker_health_metrics (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        timestamp TIMESTAMP DEFAULT NOW() NOT NULL,
        check_type VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL,
        consecutive_failures INTEGER DEFAULT 0 NOT NULL,
        last_success TIMESTAMP,
        last_failure TIMESTAMP,
        error_message TEXT,
        recovery_attempts INTEGER DEFAULT 0,
        auto_repaired BOOLEAN DEFAULT FALSE,
        metrics JSONB,
        metadata JSONB
      );
    `);
    console.log('[Migration] ✓ Created worker_health_metrics table');

    // Create indexes for worker_health_metrics
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_health_check_type ON worker_health_metrics(check_type);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_health_status ON worker_health_metrics(status);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_health_timestamp ON worker_health_metrics(timestamp);
    `);
    console.log('[Migration] ✓ Created indexes for worker_health_metrics');

    console.log('[Migration] ✅ Successfully created all Sub-Agent tables and indexes');
    console.log('[Migration] ✅ Officer Profiles table: READY for autonomous data storage');
    console.log('[Migration] ✅ Department URLs table: READY for autonomous data storage');
    console.log('[Migration] ✅ Search Cycles table: READY for autonomous operations');
    console.log('[Migration] ✅ Worker monitoring tables: READY for system alerts and diagnostics');
    console.log('[Migration] ✅ Worker health/repair metrics: READY for performance tracking');
    return true;
  } catch (error) {
    console.error('[Migration] ❌ Failed to create Sub-Agent tables:', error);
    throw error;
  }
}
