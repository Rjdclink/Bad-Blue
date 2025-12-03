#!/usr/bin/env node
const { Client } = require('pg');
require('dotenv').config();

async function verifyTables() {
  console.log('🔍 Stage 4 Verification\n');

  const client = new Client({
    connectionString: process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL,
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
    console.error('❌ Database verification failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

verifyTables();
