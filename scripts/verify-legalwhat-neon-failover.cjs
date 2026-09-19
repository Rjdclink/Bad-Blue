const fs = require('fs');
const assert = require('assert');

const db = fs.readFileSync('server/db.ts', 'utf8');
const index = fs.readFileSync('server/index.ts', 'utf8');
const config = fs.readFileSync('server/config.ts', 'utf8');
const drizzle = fs.readFileSync('drizzle.neon.config.ts', 'utf8');
const schema = fs.readFileSync('shared/schema.ts', 'utf8');
const tts = fs.readFileSync('server/lexara/LexaraTTSMesh.ts', 'utf8');

assert.match(config, /NEON_DATABASE_URL/);
assert.match(config, /NEON_DIRECT_DATABASE_URL/);
assert.match(db, /activateLegalWhatNeonFallback/);
assert.match(db, /Neon failover schema is not ready/);
assert.match(db, /CryptoCrawler Overflow authorities/);
assert.match(index, /primary_supabase_admission_unavailable/);
assert.match(index, /schema_mutation_skipped/);
assert.match(index, /Runtime schema mutation disabled; verifying prepared schema only/);
assert.doesNotMatch(index, /await runAllSchemaMigrations/);
assert.doesNotMatch(index, /async function runMigrations/);
assert.match(drizzle, /NEON_DIRECT_DATABASE_URL/);
assert.doesNotMatch(drizzle, /SUPABASE_DATABASE_URL/);
assert.match(db, /SUPABASE_DATABASE_URL/);
assert.match(db, /isSupabasePostgresConnectionString/);
assert.match(db, /subagent_learning_patterns/);
assert.match(db, /subagent_search_sessions/);
assert.match(db, /officer_category_priority/);
assert.doesNotMatch(schema, /idx_cache_expired[^\n]*now\(\)/);
assert.match(schema, /idx_cache_expired[^\n]*expiresAt/);
assert.match(tts, /provider readiness probe degraded locally; mesh fallback remains authoritative/);
assert.doesNotMatch(tts, /log\.warn\('\[LEXARA TTS\] readiness probe failed locally'/);

console.log('[verify-legalwhat-neon-failover] PASS');
