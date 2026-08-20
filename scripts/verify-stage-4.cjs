#!/usr/bin/env node
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const REPO_ROOT = path.resolve(__dirname, '..');
const ENV_FILES = ['.env.local', '.env', '.env.production.local', '.env.production'];

const loadedEnvFiles = [];
for (const envFile of ENV_FILES) {
  const envPath = path.join(REPO_ROOT, envFile);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    loadedEnvFiles.push(envFile);
  }
}

function resolveConnectionString() {
  const candidates = [
    ['SUPABASE_DATABASE_URL', process.env.SUPABASE_DATABASE_URL],
    ['SUPABASE_DB_URL', process.env.SUPABASE_DB_URL],
    ['DATABASE_URL', process.env.DATABASE_URL],
  ];

  for (const [source, value] of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return { connectionString: value.trim(), source };
    }
  }

  return { connectionString: '', source: null };
}

async function verifyTables() {
  console.log('🔍 Stage 4 Verification\n');

  const { connectionString, source } = resolveConnectionString();
  if (!connectionString) {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    console.error('❌ Database verification failed: SUPABASE_DATABASE_URL / SUPABASE_DB_URL / DATABASE_URL is not set');
    console.error(`ℹ️  Loaded env files: ${loadedEnvFiles.length > 0 ? loadedEnvFiles.join(', ') : 'none'}`);
    if (supabaseUrl) {
      try {
        const hostname = new URL(supabaseUrl).hostname;
        const projectRef = hostname.split('.')[0] || '<project-ref>';
        console.error('ℹ️  SUPABASE_URL is set, but this verifier needs a Postgres connection string.');
        console.error('ℹ️  Set SUPABASE_DATABASE_URL (or SUPABASE_DB_URL) from Supabase Dashboard → Settings → Database → Connection string.');
        console.error(`ℹ️  Example host for this project: db.${projectRef}.supabase.co`);
      } catch {
        console.error('ℹ️  SUPABASE_URL is set, but this verifier needs SUPABASE_DATABASE_URL/SUPABASE_DB_URL (Postgres URI).');
      }
    }
    process.exit(1);
  }

  console.log(`ℹ️  Using ${source} for Stage 4 database verification`);

  const client = new Client({
    connectionString,
  });

  try {
    await client.connect();

    const requiredTables = [
      'user_work_sessions',
      'autosave_snapshots',
      'consultation_history',
      'document_drafts',
      'law_type_definitions'
    ];

    for (const table of requiredTables) {
      const result = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        );
      `, [table]);

      if (!result.rows[0].exists) {
        console.error(`❌ Table '${table}' not found`);
        process.exit(1);
      }
      console.log(`✅ Table '${table}' exists`);
    }

    // Check law types seeded
    const lawTypes = await client.query('SELECT COUNT(*) FROM law_type_definitions');
    const count = parseInt(lawTypes.rows[0].count);

    if (count < 9) {
      console.error(`❌ Expected 9 law types, found ${count}`);
      process.exit(1);
    }

    console.log(`✅ ${count} law types seeded`);
    console.log('\n✅ Stage 4 complete - Ready for Stage 5');

  } catch (error) {
    const details = error && error.message ? error.message : String(error);
    console.error('❌ Database verification failed:', details);
    process.exit(1);
  } finally {
    await client.end();
  }
}

verifyTables();
