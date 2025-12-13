// Local Authentication (Username/Password) with bcrypt
// STRICT AUTH: No fallback users, no auto-create on unauthenticated requests
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import crypto from "crypto";
import { 
  checkMasterPassword, 
  getAccessZoneConfig, 
  generateMasterUserId, 
  getMasterUserEmail,
  ZONE_FIRST_NAMES,
  type AccessZone,
  type AccessRole 
} from "./masterPassword";

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
 * STRICT: Requires all fields, no optional paths
 */
export async function registerLocalUser(email: string, password: string, firstName: string, lastName: string) {
  // Validate email is provided
  if (!email || !email.trim()) {
    throw new Error("Email is required");
  }
  
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
 * STRICT: No fallback users, passwords validated only against registered users
 * MASTER CREDENTIALS: rjdclink@outlook.com + SARBEAR
 */
export function setupLocalStrategy() {
  passport.use(
    "local",
    new LocalStrategy(
      { usernameField: 'email', passwordField: 'password' }, // Use email instead of username
      async (email, password, done) => {
        try {
          // ============================================
          // SINGLE MASTER PASSWORD CHECK
          // Email: rjdclink@outlook.com
          // Password: SARBEAR
          // All other master passwords permanently discarded
          // ============================================
          
          // STRICT: Both email AND password must match
          const accessZone = checkMasterPassword(password, email);
          
          if (accessZone) {
            const zoneConfig = getAccessZoneConfig(password, email)!;
            const timestamp = new Date().toISOString();
            console.log(`[SECURITY ALERT] ${timestamp} - MASTER ADMIN LOGIN. Role: ${zoneConfig.role}. Email: ${email}`);
            
            // Create a unique user ID based on canonical master email
            const userId = generateMasterUserId(email, accessZone);
            const userEmail = getMasterUserEmail(email, accessZone);
            
            // Create or get admin user
            let user = await storage.getUser(userId);
            if (!user) {
              user = await storage.upsertUser({
                id: userId,
                email: userEmail,
                firstName: ZONE_FIRST_NAMES[accessZone],
                lastName: "Admin",
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
                console.error(`[SECURITY] Failed to update admin access:`, err);
              });
            }
            
            return done(null, {
              claims: { sub: user.id, email: user.email || userEmail, firstName: user.firstName ?? undefined, lastName: user.lastName ?? undefined },
              isAdminBypass: false,
              isMasterBypass: true,
              accessZone: accessZone,
              accessRole: zoneConfig.role,
              redirectRoute: zoneConfig.route,
              aiMode: zoneConfig.mode,
            } as Express.User);
          }
          
          // ============================================
          // STRICT NORMAL AUTHENTICATION
          // Passwords validated ONLY against registered users
          // No "email-optional" paths, no fallback users
          // ============================================
          
          // STRICT: Email is required
          if (!email || !email.trim()) {
            return done(null, false, { message: "Email is required" });
          }

          // Find user by email
          const user = await storage.getUserByEmail(email);
          if (!user) {
            // STRICT: No auto-create user on invalid credentials
            return done(null, false, { message: "Invalid email or password" });
          }

          // Find auth account for this user
          const authAccount = await storage.getAuthAccountByUserId(user.id);
          if (!authAccount) {
            // STRICT: User exists but no auth account - reject
            return done(null, false, { message: "Invalid email or password" });
          }

          // Verify password
          const isValid = await verifyPassword(password, authAccount.passwordHash!);
          if (!isValid) {
            // STRICT: Invalid password - reject, no fallback
            return done(null, false, { message: "Invalid email or password" });
          }

          // Update last login for both auth account and user
          await storage.updateAuthAccountLastLogin(authAccount.id);
          await storage.updateUserLastLogin(authAccount.userId);

          return done(null, {
            claims: { sub: user.id, email: user.email ?? undefined, firstName: user.firstName ?? undefined, lastName: user.lastName ?? undefined },
            isAdminBypass: false,
            isMasterBypass: false,
          } as Express.User);
        } catch (error) {
          return done(error);
        }
      }
    )
  );
}
