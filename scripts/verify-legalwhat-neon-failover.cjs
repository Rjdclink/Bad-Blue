const fs = require('fs');
const assert = require('assert');

const db = fs.readFileSync('server/db.ts', 'utf8');
const index = fs.readFileSync('server/index.ts', 'utf8');
const config = fs.readFileSync('server/config.ts', 'utf8');
const drizzle = fs.readFileSync('drizzle.neon.config.ts', 'utf8');

assert.match(config, /NEON_DATABASE_URL/);
assert.match(config, /NEON_DIRECT_DATABASE_URL/);
assert.match(db, /activateLegalWhatNeonFallback/);
assert.match(db, /Neon failover schema is not ready/);
assert.match(db, /CryptoCrawler Overflow authorities/);
assert.match(index, /primary_supabase_admission_unavailable/);
assert.match(drizzle, /NEON_DIRECT_DATABASE_URL/);
assert.doesNotMatch(drizzle, /SUPABASE_DATABASE_URL/);
assert.match(db, /SUPABASE_DATABASE_URL/);
assert.match(db, /isSupabasePostgresConnectionString/);

console.log('[verify-legalwhat-neon-failover] PASS');
