# Migration Test Plan: users.status Column

## Overview
This document outlines the testing procedure for the `users.status` column migration that fixes the critical authentication failure issue.

## Pre-Deployment Verification

### 1. Code Review Checklist
- [x] Migration file created: `server/migrations/add_users_status_column.ts`
- [x] Migration registered in `server/index.ts`
- [x] Schema updated in `shared/schema.ts`
- [x] Migration is idempotent (safe to run multiple times)
- [x] Code review completed with feedback addressed
- [x] CodeQL security scan passed (0 alerts)

### 2. Migration Logic Verification
The migration performs these steps:
1. ✅ Check if `status` column exists (idempotent)
2. ✅ If not exists: Add column `VARCHAR(50) DEFAULT 'active' NOT NULL`
3. ✅ Create index `idx_users_status`
4. ✅ PostgreSQL automatically sets 'active' for existing rows

## Deployment Testing

### Test Case 1: Verify Migration Runs Successfully

**Deployment Location:** Railway

**Expected Log Output:**
```
[Migration] Adding status column to users table...
[Migration] ✓ Added status column to users table
[Migration] ✓ Created index on users.status
[STARTUP] ✓ Users Status Column migration complete
```

**Or if column already exists:**
```
[Migration] Adding status column to users table...
[Migration] ✓ status column already exists
[STARTUP] ✓ Users Status Column migration complete
```

**How to Verify:**
1. Deploy to Railway
2. Check Railway deployment logs
3. Look for migration messages (search for "Users Status Column")
4. Verify no errors in migration output

---

### Test Case 2: Verify Database Schema

**Connect to:** Supabase SQL Editor

**Run this query:**
```sql
-- Check column exists with correct type and default
SELECT 
    column_name, 
    data_type, 
    character_maximum_length,
    column_default, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name = 'status';
```

**Expected Result:**
```
column_name | data_type      | character_maximum_length | column_default | is_nullable
------------|----------------|--------------------------|----------------|-------------
status      | character varying | 50                    | 'active'::character varying | NO
```

**Verify:**
- ✅ Column exists
- ✅ Type is `character varying` (VARCHAR)
- ✅ Max length is 50
- ✅ Default value is 'active'
- ✅ is_nullable is NO (NOT NULL)

---

### Test Case 3: Verify Index Created

**Connect to:** Supabase SQL Editor

**Run this query:**
```sql
-- Check index exists
SELECT 
    indexname, 
    indexdef 
FROM pg_indexes 
WHERE tablename = 'users' 
AND indexname = 'idx_users_status';
```

**Expected Result:**
```
indexname         | indexdef
------------------|----------------------------------------------------------
idx_users_status  | CREATE INDEX idx_users_status ON public.users USING btree (status)
```

**Verify:**
- ✅ Index `idx_users_status` exists
- ✅ Index is on `users` table
- ✅ Index is on `status` column

---

### Test Case 4: Verify All Users Have Status

**Connect to:** Supabase SQL Editor

**Run this query:**
```sql
-- Check all users have status set
SELECT 
    COUNT(*) as total_users,
    COUNT(status) as users_with_status,
    COUNT(CASE WHEN status = 'active' THEN 1 END) as active_users
FROM users;
```

**Expected Result:**
```
total_users | users_with_status | active_users
------------|-------------------|-------------
     N      |        N          |      N
```

**Verify:**
- ✅ `total_users` = `users_with_status` (all users have status)
- ✅ All existing users have status = 'active'

---

### Test Case 5: Test Master Password Authentication

**Endpoint:** `POST https://your-app.railway.app/api/legalizo/auth/login`

**Request:**
```bash
curl -X POST https://your-app.railway.app/api/legalizo/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "Brclink1985@gmail.com",
    "password": "[MASTER_PASSWORD]"
  }'
```

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "user": {
    "id": "...",
    "email": "Brclink1985@gmail.com",
    "status": "active",
    ...
  }
}
```

**Verify:**
- ✅ Status code is 200 (not 500)
- ✅ Response includes user data
- ✅ User has status = 'active'
- ✅ No "column does not exist" error

---

### Test Case 6: Test Regular User Authentication

**Endpoint:** `POST https://your-app.railway.app/api/legalizo/auth/login`

**Request:**
```bash
curl -X POST https://your-app.railway.app/api/legalizo/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "[test-user-email]",
    "password": "[test-user-password]"
  }'
```

**Expected Response:** `200 OK`
```json
{
  "success": true,
  "user": {
    "id": "...",
    "email": "[test-user-email]",
    "status": "active",
    ...
  }
}
```

**Verify:**
- ✅ Status code is 200 (not 500)
- ✅ Response includes user data
- ✅ User has status = 'active'

---

### Test Case 7: Verify No PostgreSQL Errors in Logs

**Check:** Railway deployment logs

**Search for:**
- ❌ "column \"status\" does not exist"
- ❌ "error: column "status" does not exist"
- ❌ "Error Code: 42703"
- ❌ "undefined_column"

**Expected Result:**
- ✅ No errors related to missing status column
- ✅ No 42703 error codes in authentication logs

---

### Test Case 8: Test Subscription Middleware

**Endpoint:** Any protected route using `ensureActiveSubscription` middleware

**Expected Behavior:**
- ✅ Users with status = 'active' can access protected routes
- ✅ Users with status = 'pending_payment' receive 403 with helpful message
- ✅ Users with status = 'past_due' receive 403 with helpful message
- ✅ Users with status = 'canceled' receive 403 with helpful message

---

## Rollback Plan (If Needed)

If the migration causes issues, it can be rolled back:

```sql
-- Connect to Supabase SQL Editor

-- Drop the index
DROP INDEX IF EXISTS idx_users_status;

-- Remove the column
ALTER TABLE users DROP COLUMN IF EXISTS status;
```

**Note:** This will cause authentication to fail again. Only rollback if there's a critical issue with the migration itself.

---

## Post-Deployment Monitoring

### Metrics to Watch (First 24 Hours)

1. **Authentication Success Rate**
   - Monitor authentication endpoint logs
   - Look for 200 OK responses (success)
   - Alert if 500 errors continue

2. **Database Query Performance**
   - Check query times for authentication queries
   - Verify index is being used

3. **User Login Activity**
   - Monitor user login timestamps
   - Verify users can successfully authenticate

### Railway Logs to Monitor

```bash
# Watch for successful logins
grep "login" railway-logs.txt | grep "200"

# Watch for migration messages
grep "Migration" railway-logs.txt

# Watch for database errors
grep "error.*column" railway-logs.txt
```

---

## Success Criteria

The migration is considered successful if:

- [x] Migration runs without errors
- [ ] Database schema has status column (VARCHAR(50), NOT NULL, DEFAULT 'active')
- [ ] Index idx_users_status exists
- [ ] All existing users have status = 'active'
- [ ] Master password authentication returns 200 OK
- [ ] Regular user authentication returns 200 OK
- [ ] No "column does not exist" errors in logs
- [ ] No 42703 PostgreSQL error codes
- [ ] Protected routes work correctly with subscription middleware

---

## Troubleshooting

### Issue: Migration doesn't run

**Solution:**
1. Check Railway logs for errors
2. Verify DATABASE_URL environment variable is set
3. Check server/index.ts import statement
4. Verify migration is in the migrations array

### Issue: Column still doesn't exist after migration

**Solution:**
1. Check migration logs for "already exists" message
2. Manually verify in Supabase SQL Editor
3. If needed, run migration SQL manually:
   ```sql
   ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active' NOT NULL;
   CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
   ```

### Issue: Authentication still fails with 500 error

**Solution:**
1. Check error logs for exact error message
2. Verify column exists in database
3. Verify application is using updated schema
4. Restart Railway service to pick up changes

---

## Timeline

1. **Deploy to Railway:** ~5 minutes
2. **Migration runs:** < 1 second
3. **Verify in logs:** ~2 minutes
4. **Test authentication:** ~5 minutes
5. **Verify database:** ~3 minutes
6. **Monitor for issues:** 24 hours

**Total deployment time:** ~15 minutes
**Monitoring period:** 24 hours

---

## Contact

If issues arise during deployment or testing, refer to the error logs and this test plan for troubleshooting steps.
