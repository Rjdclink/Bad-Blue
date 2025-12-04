# Master Password Implementation

## Overview
This document describes the implementation of the master password "SARBEAR" that bypasses payment requirements and can be used with any email or without email credentials.

## Master Password
- **Password**: `SARBEAR`
- **Works with**: ANY email address or without email
- **Bypasses**: Payment requirements and subscription checks
- **Access Level**: Full paid access to all features

## How It Works

### 1. Authentication Flow
When a user attempts to login with the master password:

1. **Priority Check**: Master password is checked FIRST, before admin bypass and rate limiting
2. **Email Handling**: Works with any email provided, or uses default if no email given
3. **User Creation**: Automatically creates a user account if one doesn't exist
4. **Access Granting**: Automatically grants paid/active subscription status
5. **Session Creation**: Creates a valid authentication session

### 2. Implementation Files

#### server/masterPassword.ts
Central utility module that defines:
- `MASTER_PASSWORD` constant: "SARBEAR"
- `generateMasterUserId()`: Creates consistent user IDs based on email
- `getMasterUserEmail()`: Handles email fallback logic
- `isMasterPassword()`: Password verification utility

#### server/localAuth.ts
Implements master password check in passport local strategy:
- Checks password against MASTER_PASSWORD constant
- Creates user with "Master" first name and "User" last name
- Grants paid access via `storage.updateUserAccess()`
- Sets `isMasterBypass: true` flag in user object

#### server/routes.ts
Handles master password in `/api/login/local` route:
- Checks before admin bypass and rate limiting
- Uses passport authentication strategy
- Returns success with `isMasterBypass` and `hasActiveSubscription` flags

#### server/legalizoRoutes.ts
Handles master password in `/api/legalizo/auth/login` route:
- Creates user in database if needed
- Creates active subscription with 1-year renewal
- Returns success with subscription status

### 3. Security Features

- **Audit Logging**: All master password usage is logged with timestamps
- **User Tracking**: Each email gets a unique user ID for tracking
- **Consistent Behavior**: Centralized logic ensures consistent implementation
- **Bypass Ordering**: Master password checked before rate limits (intentional)

## Usage Examples

### Example 1: Login with any email
```bash
POST /api/login/local
{
  "email": "anything@example.com",
  "password": "SARBEAR"
}
```
**Result**: Success, user created with email, full access granted

### Example 2: Login without email
```bash
POST /api/login/local
{
  "email": "",
  "password": "SARBEAR"
}
```
**Result**: Success, user created with default email "master@badblue.internal", full access granted

### Example 3: Legalizo login
```bash
POST /api/legalizo/auth/login
{
  "email": "test@test.com",
  "password": "SARBEAR"
}
```
**Result**: Success, user created in database with active subscription, full access granted

## Testing

Run the validation script to verify implementation:
```bash
node test-master-password.mjs --validate
```

Run live tests (requires server to be running):
```bash
node test-master-password.mjs
```

## Security Considerations

### By Design
- Master password is hardcoded (as requested in requirements)
- Bypasses payment (as requested in requirements)
- Bypasses rate limiting (intentional for master password)
- Works with any email (as requested in requirements)

### Security Measures
- All usage is logged with security alerts
- Unique user IDs prevent account conflicts
- Proper session management
- Consistent with other bypass mechanisms

## Integration Points

The master password integrates with:
1. **Authentication System**: Passport local strategy
2. **User Management**: storage.upsertUser()
3. **Payment System**: storage.updateUserAccess()
4. **Session Management**: req.login()
5. **Database**: legalizoSubscriptions table

## Response Flags

When master password is used, responses include:
- `success: true`
- `isMasterBypass: true`
- `hasActiveSubscription: true`
- User object with master user details

## Notes

- Master password creates unique users per email to avoid conflicts
- Users created via master password have firstName: "Master", lastName: "User"
- Payment bypass is permanent for created users
- Works across all login endpoints (local, legalizo)
