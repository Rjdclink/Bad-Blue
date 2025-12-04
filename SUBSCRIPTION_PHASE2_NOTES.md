# Subscription Phase 2 Implementation Notes

## Date: 2025-12-04
## Status: COMPLETE ✅

## Overview
Phase 2 creates database helper utilities and authentication middleware to support subscription-based access control.

## Files Created

### 1. Database Helper (`server/lib/db.ts`)
Provides query wrapper functions around the existing database pool.

**Functions:**
- `query(text, params)` - Execute parameterized queries with logging
- `getClient()` - Get pooled client for transactions

**Usage:**
```typescript
import db from './lib/db';

// Simple query
const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

// Transaction
const client = await db.getClient();
try {
  await client.query('BEGIN');
  await client.query('INSERT INTO ...');
  await client.query('COMMIT');
} finally {
  client.release();
}
```

### 2. Authentication Middleware (`server/middleware/auth.ts`)
Extends authentication to include subscription status checking.

**Middleware Functions:**

#### `ensureAuthenticated`
- Checks if user is logged in (session exists)
- Returns 401 if not authenticated
- Use for routes that need login but not necessarily active subscription

#### `ensureActiveSubscription`
- Checks authentication + subscription status
- Returns 403 if subscription is not 'active'
- Provides specific error messages based on status:
  - `pending_payment` - "Please complete your subscription payment"
  - `past_due` - "Your subscription payment is past due"
  - `canceled` - "Your subscription has been canceled"
  - `expired` - "Your subscription is not active"
- **Use this to gate the Welcome page and Legal Tools**

#### `hasSubscription`
- Optional middleware to check if user has any subscription record
- Attaches `req.hasSubscription` flag for route logic
- Use to differentiate new users vs users needing payment renewal

## Integration with Existing Code

### Existing Authentication (`server/auth.ts`)
The project already has:
- `isAuthenticated` - Passport-based authentication
- `adminAuthMiddleware` - Admin access check

### New Middleware Usage
For subscription-gated routes, use the new middleware:

```typescript
import { ensureActiveSubscription } from './middleware/auth';

// Gate welcome page
app.get('/welcome', ensureActiveSubscription, (req, res) => {
  // Only active subscribers reach here
});

// Gate legal tools
app.get('/legal-tools', ensureActiveSubscription, (req, res) => {
  // Only active subscribers reach here
});
```

## Database Integration

### Queries Used
- **Subscription status check:**
  ```sql
  SELECT status FROM users WHERE id = $1
  ```

- **Subscription existence check:**
  ```sql
  SELECT id FROM subscriptions WHERE user_id = $1 LIMIT 1
  ```

### Expected User Statuses
From Phase 1 schema:
- `pending_payment` - User signed up but hasn't paid
- `active` - Subscription is active and paid
- `past_due` - Payment failed, grace period
- `canceled` - User canceled subscription
- `expired` - Subscription ended

## Session Configuration

The middleware expects Express sessions with:
```typescript
interface SessionData {
  userId: number;
}
```

This is compatible with the existing Passport session structure where `req.session.userId` is set during authentication.

## Error Handling

All middleware functions include try-catch blocks and return appropriate HTTP status codes:
- `401 Unauthorized` - Not logged in
- `403 Forbidden` - Logged in but subscription inactive
- `404 Not Found` - User ID not found in database
- `500 Internal Server Error` - Database query failed

## Testing Checklist

### Unit Testing
- [ ] `ensureAuthenticated` returns 401 when session.userId is undefined
- [ ] `ensureAuthenticated` calls next() when session.userId exists
- [ ] `ensureActiveSubscription` returns 401 without session
- [ ] `ensureActiveSubscription` returns 404 for non-existent user
- [ ] `ensureActiveSubscription` returns 403 for non-active statuses
- [ ] `ensureActiveSubscription` calls next() for active status
- [ ] `hasSubscription` sets req.hasSubscription correctly

### Integration Testing
- [ ] Database queries execute successfully
- [ ] Middleware integrates with existing Express routes
- [ ] Session data persists across requests
- [ ] Error messages are helpful and secure

### Manual Testing
```bash
# Test authentication check
curl -X GET http://localhost:5000/api/test-auth \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE"

# Test subscription check
curl -X GET http://localhost:5000/api/test-subscription \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE"
```

## Security Considerations

1. **SQL Injection Prevention**: All queries use parameterized statements
2. **Session Security**: Relies on existing Express session security (httpOnly cookies)
3. **Error Messages**: Generic errors don't expose internal details
4. **Database Connection**: Uses pooled connections for efficiency
5. **Input Validation**: userId from session is trusted (set by authentication)

## Dependencies

### Already Installed
- `express` - Web framework
- `express-session` - Session management
- `pg` - PostgreSQL client

### New (from Phase 1)
- `bcrypt` - Password hashing (for signup)
- `square` - Square API (for payments)

No additional dependencies required for Phase 2.

## Next Steps (Phase 3)

After Phase 2 is complete:
1. Create signup API endpoint (`POST /api/auth/signup`)
2. Create Square subscription API (`POST /api/subscriptions/create`)
3. Create webhook handler (`POST /api/webhooks/square`)
4. Update routes to use `ensureActiveSubscription` middleware
5. Create landing page UI
6. Create signup form UI

## Known Issues & TODOs

1. **Session Type Extension**: The `SessionData` interface extension may need to be moved to a shared types file if there are conflicts
2. **Database Pool**: Currently wraps the existing pool; consider refactoring to centralize all database queries
3. **Caching**: Subscription status could be cached in session to reduce DB queries
4. **Graceful Degradation**: Consider allowing partial access for `past_due` status (grace period)

## Verification Commands

```bash
# Check files created
ls -la server/lib/db.ts
ls -la server/middleware/auth.ts

# Check TypeScript compilation
npx tsc --noEmit server/lib/db.ts
npx tsc --noEmit server/middleware/auth.ts

# Test database helper
node -e "const db = require('./server/lib/db').default; db.query('SELECT 1').then(r => console.log('DB OK:', r.rows))"
```

## Documentation References

- Phase 1 Notes: `SUBSCRIPTION_PHASE1_NOTES.md`
- Database Schema: `shared/schema.ts`
- Migration: `server/migrations/003_subscription_tables.sql`

## Changelog

### 2025-12-04
- ✅ Created `server/lib/db.ts` with query helpers
- ✅ Created `server/middleware/auth.ts` with subscription middleware
- ✅ Added TypeScript type extensions for Express session
- ✅ Documented integration points and usage examples
- ✅ Provided testing checklist and verification commands

---

**Phase 2 Status**: ✅ COMPLETE - Ready for Phase 3 (API Endpoints)
