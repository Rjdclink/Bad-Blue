// Token Metrics Tables Migration
// Creates tables for tracking AI API usage and rate limiting

import { db } from '../db';
import { sql } from 'drizzle-orm';

export async function createTokenMetricsTables() {
  console.log('[Migration] Starting Token Metrics tables creation...');

  try {
    // Create ai_usage_metrics table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_usage_metrics (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        provider VARCHAR(50) NOT NULL,
        source VARCHAR(100) NOT NULL DEFAULT 'user',
        task_name VARCHAR(100) NOT NULL DEFAULT 'unknown',
        tokens_used INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER,
        verbosity VARCHAR(20) NOT NULL DEFAULT 'standard',
        priority INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        requests_made INTEGER DEFAULT 1,
        error_count INTEGER DEFAULT 0,
        success BOOLEAN NOT NULL DEFAULT true,
        timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
        date DATE DEFAULT CURRENT_DATE,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('[Migration] ✓ Created ai_usage_metrics table');

    await db.execute(sql`
      ALTER TABLE ai_usage_metrics
      ADD COLUMN IF NOT EXISTS source VARCHAR(100) NOT NULL DEFAULT 'user',
      ADD COLUMN IF NOT EXISTS task_name VARCHAR(100) NOT NULL DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS tokens_used INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS latency_ms INTEGER,
      ADD COLUMN IF NOT EXISTS verbosity VARCHAR(20) NOT NULL DEFAULT 'standard',
      ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS error_message TEXT,
      ADD COLUMN IF NOT EXISTS requests_made INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS error_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS success BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS date DATE DEFAULT CURRENT_DATE,
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
    `);
    console.log('[Migration] ✓ Reconciled ai_usage_metrics columns');

    // Create ai_cache table for caching AI responses
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_cache (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        cache_key VARCHAR(255) NOT NULL UNIQUE,
        provider VARCHAR(50) NOT NULL,
        task_type VARCHAR(100) NOT NULL,
        prompt_hash VARCHAR(64) NOT NULL,
        response TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        usage_count INTEGER DEFAULT 1,
        tokens_saved INTEGER DEFAULT 0,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('[Migration] ✓ Created ai_cache table');

    // Create token_metrics table for daily aggregates
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS token_metrics (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        provider VARCHAR(50) NOT NULL,
        total_tokens INTEGER DEFAULT 0,
        total_requests INTEGER DEFAULT 0,
        user_tokens INTEGER DEFAULT 0,
        user_requests INTEGER DEFAULT 0,
        autonomous_tokens INTEGER DEFAULT 0,
        autonomous_requests INTEGER DEFAULT 0,
        worker_tokens INTEGER DEFAULT 0,
        worker_requests INTEGER DEFAULT 0,
        cached_hits INTEGER DEFAULT 0,
        tokens_saved INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        UNIQUE(date, provider)
      )
    `);
    console.log('[Migration] ✓ Created token_metrics table');

    // Create indexes for ai_usage_metrics
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_date 
      ON ai_usage_metrics(provider, date);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ai_usage_source_date 
      ON ai_usage_metrics(source, date);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ai_usage_timestamp 
      ON ai_usage_metrics(timestamp);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_timestamp 
      ON ai_usage_metrics(provider, timestamp DESC);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ai_usage_task 
      ON ai_usage_metrics(task_name);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ai_usage_source 
      ON ai_usage_metrics(source);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ai_usage_source_timestamp 
      ON ai_usage_metrics(source, timestamp DESC);
    `);

    console.log('[Migration] ✓ Created indexes for ai_usage_metrics');

    // Create indexes for ai_cache
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ai_cache_key 
      ON ai_cache(cache_key);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ai_cache_expires 
      ON ai_cache(expires_at);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ai_cache_provider 
      ON ai_cache(provider, task_type);
    `);

    console.log('[Migration] ✓ Created indexes for ai_cache');

    // Create indexes for token_metrics
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_token_metrics_date 
      ON token_metrics(date);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_token_metrics_provider 
      ON token_metrics(provider);
    `);

    console.log('[Migration] ✓ Created indexes for token_metrics');

    console.log('[Migration] ✅ Successfully created all Token Metrics tables and indexes');
    console.log('[Migration] ✅ AI Usage Metrics table: READY for usage tracking');
    console.log('[Migration] ✅ AI Cache table: READY for response caching');
    console.log('[Migration] ✅ Token Metrics table: READY for daily aggregates');

    return true;
  } catch (error: any) {
    console.error('[Migration] ❌ Error creating Token Metrics tables:', error.message);
    
    // Check if it's just a "table already exists" error
    if (error.code === '42P07') {
      console.log('[Migration] ℹ️ Tables already exist, skipping creation');
      return true;
    }
    
    throw error;
  }
}