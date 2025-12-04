# Subscription System - Phase 1: Database Schema & Migration

## Status: ✅ COMPLETE

## Date: 2025-12-04

## Overview
Set up database tables for Square subscription management, extending existing schema to support $25.99/month Legalezo subscription plan.

---

## ✅ Dependencies Installed

```bash
npm install bcrypt square
```

**Packages Added:**
- `bcrypt` - Password hashing for local auth accounts
- `square` - Square API SDK for payment processing

---

## ✅ Environment Variables

Added to `.env.example`:

```env
# Square Payment Configuration
SQUARE_ACCESS_TOKEN=your_production_access_token
SQUARE_APPLICATION_ID=sq0idp-n5aXRG01aPrZ4KqxIh33Sw
SQUARE_LOCATION_ID=L0DRZCZ8YRK5K
SQUARE_ENVIRONMENT=production
SQUARE_WEBHOOK_SIGNATURE_KEY=your_webhook_signature_key

# Frontend Square Configuration
VITE_SQUARE_APPLICATION_ID=sq0idp-n5aXRG01aPrZ4KqxIh33Sw
VITE_SQUARE_LOCATION_ID=L0DRZCZ8YRK5K
VITE_SQUARE_ENVIRONMENT=production
```

**Required Actions:**
- [ ] Set `SQUARE_ACCESS_TOKEN` with production access token
- [ ] Set `SQUARE_WEBHOOK_SIGNATURE_KEY` with webhook signature key
- [ ] Replace `PLACEHOLDER_SQUARE_PLAN_ID` in migration with actual Square plan ID

---

## ✅ Migration Files Created

### 1. Primary Migration
**File:** `server/migrations/003_subscription_tables.sql`

**Tables Created:**
- `plans` - Subscription plans (seeded with $25.99/month Legalezo plan)
- `subscriptions` - User subscriptions with Square tracking
- `transactions` - Payment transaction history

**Users Table Extended:**
- `status VARCHAR(32) DEFAULT 'pending_payment'` - User subscription status
- `square_customer_id TEXT` - Square customer ID

**Indexes Created for Performance:**
- `idx_subscriptions_user_id` on subscriptions(user_id)
- `idx_subscriptions_status` on subscriptions(status)
- `idx_transactions_user_id` on transactions(user_id)
- `idx_transactions_subscription_id` on transactions(subscription_id)
- `idx_users_status` on users(status)
- `idx_users_square_customer_id` on users(square_customer_id)

### 2. Backup Migration
**File:** `db/migrations/0012_add_subscription_tables.sql`
(Same content, for drizzle-kit compatibility)

---

## ✅ TypeScript Schema Updated

**File:** `shared/schema.ts`

**Users Table Updated:**
- Added `status` field with TypeScript type
- Already had `squareCustomerId` field

**New Tables Added:**
1. **plans** - Subscription plan definitions
   ```typescript
   export type Plan = typeof plans.$inferSelect;
   export type InsertPlan = typeof plans.$inferInsert;
   ```

2. **subscriptions** - User subscription records
   ```typescript
   export type Subscription = typeof subscriptions.$inferSelect;
   export type InsertSubscription = typeof subscriptions.$inferInsert;
   ```
   - Relations: user, plan

3. **transactions** - Payment transaction records
   ```typescript
   export type Transaction = typeof transactions.$inferSelect;
   export type InsertTransaction = typeof transactions.$inferInsert;
   ```
   - Relations: user, subscription

---

## 🔧 Running the Migration

### Option 1: Via npm script (runs all .sql files in server/migrations/)
```bash
npm run migrate
```

### Option 2: Direct execution
```bash
tsx server/migrations/runMigrations.ts
```

### Manual execution (if needed)
```bash
psql $DATABASE_URL -f server/migrations/003_subscription_tables.sql
```

---

## ✅ Verification Steps

### 1. Check Tables Created
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('plans', 'subscriptions', 'transactions');
```

**Expected Output:** 3 rows (plans, subscriptions, transactions)

### 2. Verify Plan Seeded
```sql
SELECT * FROM plans;
```

**Expected Output:**
```
id | name                    | price | currency | interval | square_plan_id              | is_active | created_at
---|-------------------------|-------|----------|----------|----------------------------|-----------|------------
 1 | Legalezo Subscription  | 2599  | USD      | monthly  | PLACEHOLDER_SQUARE_PLAN_ID | true      | 2025-12-04...
```

### 3. Verify Users Table Extended
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name IN ('status', 'square_customer_id');
```

**Expected Output:**
```
column_name       | data_type        | column_default
------------------|------------------|------------------
status            | character varying| 'pending_payment'
square_customer_id| text             | NULL
```

### 4. Verify Indexes Created
```sql
SELECT indexname, tablename 
FROM pg_indexes 
WHERE schemaname = 'public' 
AND indexname LIKE 'idx_%subscription%' 
OR indexname LIKE 'idx_%transaction%' 
OR indexname LIKE 'idx_users_%';
```

**Expected Output:** At least 6 indexes

### 5. Verify Foreign Key Constraints
```sql
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
AND tc.table_name IN ('subscriptions', 'transactions');
```

**Expected Output:** 4 foreign key constraints

---

## 📋 Testing Checklist

- [x] Dependencies installed (bcrypt, square)
- [x] Environment variables added to .env.example
- [x] Migration file created in server/migrations/
- [x] Backup migration created in db/migrations/
- [x] TypeScript schema updated with new tables
- [x] Users table extended with status and square_customer_id
- [ ] Migration runs without errors (run `npm run migrate`)
- [ ] Tables created and verified via SQL queries
- [ ] Plan seeded with $25.99/month Legalezo subscription
- [ ] Indexes created for performance
- [ ] Foreign key constraints in place
- [ ] TypeScript types compile without errors

---

## 🚧 Known Issues / TODOs

1. **⚠️ PLACEHOLDER_SQUARE_PLAN_ID** must be replaced with actual Square plan ID
   - Location: `server/migrations/003_subscription_tables.sql` line 58
   - Action: Create plan in Square Dashboard → Copy plan ID → Update migration

2. **Environment Variables** must be set in production
   - `SQUARE_ACCESS_TOKEN` - Production access token from Square Dashboard
   - `SQUARE_WEBHOOK_SIGNATURE_KEY` - Webhook signature key from Square Dashboard

3. **Migration Execution** required before Phase 2
   - Run `npm run migrate` to apply database changes

---

## 📦 Files Modified/Created

### Created:
- ✅ `server/migrations/003_subscription_tables.sql` (Migration with tables + seed)
- ✅ `db/migrations/0012_add_subscription_tables.sql` (Backup migration)
- ✅ `SUBSCRIPTION_PHASE1_NOTES.md` (This file)

### Modified:
- ✅ `shared/schema.ts` (Added plans, subscriptions, transactions tables + types)
- ✅ `package.json` (Added bcrypt and square dependencies)
- ⚠️ `.env.example` (Square config already present)

---

## 🔄 Next Phase

**Phase 2: Database Helpers & Authentication Middleware**

Will implement:
- Database helper functions for subscription management
- Authentication middleware to check subscription status
- Route protection for /welcome and other subscriber-only pages
- Utility functions for Square API interactions

**Prerequisites for Phase 2:**
- ✅ Phase 1 migration must be run successfully
- ⚠️ SQUARE_ACCESS_TOKEN environment variable must be set
- ⚠️ PLACEHOLDER_SQUARE_PLAN_ID must be replaced with actual Square plan ID

---

## 💡 Notes

- **User Status Values:** 
  - `pending_payment` - Default for new users
  - `active` - Active subscription
  - `past_due` - Payment failed but grace period active
  - `canceled` - Subscription canceled
  - `expired` - Subscription ended

- **Price Format:** Stored in cents (2599 = $25.99)

- **Square Plan:** Must be created in Square Dashboard first, then plan ID added to migration

- **Backward Compatibility:** Existing `hasPaidForAccess`, `accessPaymentId`, and `accessPaidAt` fields preserved for Stripe legacy data

---

**Phase 1 Status:** ✅ **READY FOR TESTING**

Run `npm run migrate` to apply database changes, then proceed to Phase 2.
