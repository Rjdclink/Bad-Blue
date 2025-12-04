# Phase 2 Part 1: Database Migrations Implementation

## Overview
Part 1 of Phase 2 implements the database foundation for platform-aware reconciliation and user consent tracking.

## Migrations Created

### 1. Reconciliation Jobs Platform Support

**Files:**
- `server/migrations/004_add_platform_to_reconciliation_jobs.sql` - Full migration with comments
- `db/migrations/0013_add_platform_to_reconciliation_jobs.sql` - Drizzle-kit compatible

**Changes to `reconciliation_jobs` table:**
- `platform` TEXT NOT NULL DEFAULT 'square' - Payment platform identifier
- `idempotency_key` TEXT - UUID for duplicate prevention  
- `payload` JSONB NOT NULL DEFAULT '{}' - Job-specific data
- `status` TEXT NOT NULL DEFAULT 'pending' - Job status tracking
- `attempts` INTEGER NOT NULL DEFAULT 0 - Retry counter
- `last_error` TEXT - Failure diagnostic information
- `started_at` TIMESTAMPTZ - Processing start timestamp
- `worker` TEXT - Worker hostname/ID for monitoring
- `completed_at` TIMESTAMPTZ - Job completion timestamp

**Constraints:**
- CHECK constraint on `status`: pending, processing, done, failed, manual_review
- CHECK constraint on `platform`: square, newplatform

**Indexes:**
- `idx_reconciliation_platform_status` ON (platform, status)
- `idx_reconciliation_status_created` ON (status, created_at)
- `ux_reconciliation_platform_idempotency` UNIQUE ON (platform, idempotency_key) WHERE idempotency_key IS NOT NULL
- `idx_reconciliation_worker` ON (worker) WHERE worker IS NOT NULL

### 2. User Consents Table

**Files:**
- `server/migrations/005_add_user_consents_table.sql` - Full migration with triggers
- `db/migrations/0014_add_user_consents_table.sql` - Drizzle-kit compatible

**Table structure:**
- `id` SERIAL PRIMARY KEY
- `user_id` INTEGER NOT NULL FK → users(id) ON DELETE CASCADE
- `payment_id` TEXT NOT NULL - Square payment/subscription ID
- `plan_id` TEXT - Plan ID at time of consent
- `consent_version` TEXT NOT NULL - Version format: v1.0, v1.1, etc.
- `consent_text` TEXT NOT NULL - Full legal acknowledgment
- `ip_address` TEXT - User IP for audit trail
- `user_agent` TEXT - Browser/device information
- `signature` TEXT - HMAC-SHA256 verification signature
- `created_at` TIMESTAMPTZ DEFAULT NOW()
- `updated_at` TIMESTAMPTZ DEFAULT NOW()

**Constraints:**
- CHECK constraint on `consent_version`: Must match format v#.#[.#]

**Indexes:**
- `ux_user_payment_consent` UNIQUE ON (user_id, payment_id, consent_version)
- `idx_user_consents_user_id` ON (user_id)
- `idx_user_consents_payment_id` ON (payment_id)
- `idx_user_consents_created_at` ON (created_at DESC)

**Triggers:**
- `update_user_consents_updated_at_trigger` - Auto-updates updated_at on row changes

## TypeScript Schema Updates

Added to `shared/schema.ts`:

```typescript
export const reconciliationJobs = pgTable("reconciliation_jobs", { ... });
export type ReconciliationJob = typeof reconciliationJobs.$inferSelect;
export type InsertReconciliationJob = typeof reconciliationJobs.$inferInsert;

export const userConsents = pgTable("user_consents", { ... });
export const userConsentsRelations = relations(userConsents, ({ one }) => ({
  user: one(users, { ... }),
}));
export type UserConsent = typeof userConsents.$inferSelect;
export type InsertUserConsent = typeof userConsents.$inferInsert;
```

## Migration Safety Features

1. **Idempotent Operations:** All operations use `IF NOT EXISTS` / conditional logic
2. **Backward Compatibility:** Default values provided for new columns
3. **Non-Breaking:** Existing columns/data unaffected
4. **Reversible:** Column additions can be rolled back if needed
5. **Performance:** Indexes created conditionally to avoid duplicates

## Running Migrations

### Method 1: Manual SQL Execution

```bash
# Apply reconciliation_jobs migration
psql $DATABASE_URL -f server/migrations/004_add_platform_to_reconciliation_jobs.sql

# Apply user_consents migration
psql $DATABASE_URL -f server/migrations/005_add_user_consents_table.sql
```

### Method 2: Using Migration Tool

```bash
# If using Drizzle Kit
npm run db:push

# Or apply specific migrations
npx drizzle-kit push:pg
```

### Method 3: Node.js Script

```typescript
import { pool } from './server/db';
import fs from 'fs';

async function runMigration(file: string) {
  const sql = fs.readFileSync(file, 'utf8');
  await pool.query(sql);
  console.log(`✅ Applied migration: ${file}`);
}

await runMigration('server/migrations/004_add_platform_to_reconciliation_jobs.sql');
await runMigration('server/migrations/005_add_user_consents_table.sql');
```

## Verification Queries

### Verify reconciliation_jobs columns:

```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns 
WHERE table_name = 'reconciliation_jobs'
ORDER BY ordinal_position;
```

Expected new columns:
- platform (text, default 'square', NOT NULL)
- idempotency_key (text, NULL)
- payload (jsonb, default '{}', NOT NULL)
- status (text, default 'pending', NOT NULL)
- attempts (integer, default 0, NOT NULL)
- last_error (text, NULL)
- started_at (timestamp with time zone, NULL)
- worker (text, NULL)
- completed_at (timestamp with time zone, NULL)

### Verify user_consents table:

```sql
SELECT * FROM information_schema.tables 
WHERE table_name = 'user_consents';

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'user_consents'
ORDER BY ordinal_position;
```

Expected structure: 11 columns (id, user_id, payment_id, plan_id, consent_version, consent_text, ip_address, user_agent, signature, created_at, updated_at)

### Verify indexes:

```sql
-- Reconciliation jobs indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'reconciliation_jobs'
AND indexname LIKE 'idx_reconciliation%' OR indexname LIKE 'ux_reconciliation%';

-- User consents indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'user_consents';
```

### Verify constraints:

```sql
-- Reconciliation jobs constraints
SELECT conname, contype, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'reconciliation_jobs'::regclass;

-- User consents constraints
SELECT conname, contype, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'user_consents'::regclass;
```

## Rollback Procedures

### If needed to rollback reconciliation_jobs changes:

```sql
-- Drop indexes
DROP INDEX IF EXISTS idx_reconciliation_platform_status;
DROP INDEX IF EXISTS idx_reconciliation_status_created;
DROP INDEX IF EXISTS ux_reconciliation_platform_idempotency;
DROP INDEX IF EXISTS idx_reconciliation_worker;

-- Drop constraints
ALTER TABLE reconciliation_jobs DROP CONSTRAINT IF EXISTS reconciliation_jobs_status_check;
ALTER TABLE reconciliation_jobs DROP CONSTRAINT IF EXISTS reconciliation_jobs_platform_check;

-- Drop columns (WARNING: Data loss)
ALTER TABLE reconciliation_jobs DROP COLUMN IF EXISTS platform;
ALTER TABLE reconciliation_jobs DROP COLUMN IF EXISTS idempotency_key;
ALTER TABLE reconciliation_jobs DROP COLUMN IF EXISTS payload;
ALTER TABLE reconciliation_jobs DROP COLUMN IF EXISTS status;
ALTER TABLE reconciliation_jobs DROP COLUMN IF EXISTS attempts;
ALTER TABLE reconciliation_jobs DROP COLUMN IF EXISTS last_error;
ALTER TABLE reconciliation_jobs DROP COLUMN IF EXISTS started_at;
ALTER TABLE reconciliation_jobs DROP COLUMN IF EXISTS worker;
ALTER TABLE reconciliation_jobs DROP COLUMN IF EXISTS completed_at;
```

### If needed to rollback user_consents table:

```sql
-- Drop trigger first
DROP TRIGGER IF EXISTS update_user_consents_updated_at_trigger ON user_consents;
DROP FUNCTION IF EXISTS update_user_consents_updated_at();

-- Drop table (WARNING: All consent data will be lost)
DROP TABLE IF EXISTS user_consents CASCADE;
```

## Testing Checklist

- [ ] Migrations applied successfully in dev environment
- [ ] All new columns present in reconciliation_jobs
- [ ] user_consents table created with all columns
- [ ] All indexes created
- [ ] All constraints active
- [ ] TypeScript types compile without errors
- [ ] No breaking changes to existing queries
- [ ] Trigger function works (test UPDATE on user_consents)

## Known Issues & TODOs

1. **TODO:** The `reconciliation_jobs` table is referenced but may not exist yet
   - If table doesn't exist, create it first with base columns before running this migration
   - Or modify migration to create table with all columns at once

2. **TODO:** Determine if `users.id` is INTEGER or VARCHAR
   - Current migration assumes FK from user_consents.user_id (VARCHAR) → users.id
   - Verify schema compatibility before applying

3. **Note:** Default platform 'square' ensures backward compatibility
   - Existing code that doesn't specify platform will default to 'square'
   - New code must explicitly pass platform='newplatform' for new platform jobs

## Next Steps (Part 2)

After migrations are applied and verified:

1. Implement reconciliation library (`server/lib/reconciliation.ts`)
2. Implement worker processor (`server/workers/reconciliation.processor.ts`)
3. Add worker configuration (queue names, concurrency, retries)
4. Implement newplatform client stub
5. Add unit tests for enqueueing logic
6. Add integration tests for end-to-end reconciliation flow

## References

- Square reconciliation documentation
- Drizzle ORM migrations guide
- PostgreSQL JSONB best practices
- Idempotency patterns for distributed systems
