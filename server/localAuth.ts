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
  const normalizedEmail = email?.trim().toLowerCase();
  const normalizedFirstName = firstName?.trim();
  const normalizedLastName = lastName?.trim();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("A valid email is required");
  }
  if (!normalizedFirstName || !normalizedLastName) {
    throw new Error("First and last name are required");
  }

  const existingUser = await storage.getUserByEmail(normalizedEmail);
  if (existingUser) {
    throw new Error("Email already registered");
  }

  // Validate password strength
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  // Hash password
  const { hash, salt } = await hashPassword(password);

  const userId = crypto.randomUUID();
  try {
    return await storage.createLocalUser(
      {
        id: userId,
        email: normalizedEmail,
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
        profileImageUrl: null,
      },
      {
        authType: "local",
        username: `local-${userId}`,
        passwordHash: hash,
        passwordSalt: salt,
      },
    );
  } catch (error: any) {
    if (error?.code === '23505') {
      throw new Error('Email already registered');
    }
    throw error;
  }
}

/**
 * Setup passport-local strategy for email-based authentication
 * STRICT: No fallback users, passwords validated only against registered users
 * MASTER CREDENTIALS: configured through MASTER_ADMIN_EMAIL and MASTER_ADMIN_PASSWORD
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
          // Credentials are loaded only from the deployment environment.
          // All other master passwords permanently discarded
          // ============================================
          
          // STRICT: Both email AND password must match
          const accessZone = checkMasterPassword(password, email);
          
          if (accessZone) {
            console.info('[AUTH] MASTER_CREDENTIAL_MATCH');
            const zoneConfig = getAccessZoneConfig(password, email)!;
            console.info('[AUTH] MASTER_ACCESS_ZONE_RESOLVED', { role: zoneConfig.role });
            
            // Create a unique user ID based on canonical master email
            const userId = generateMasterUserId(email, accessZone);
            const userEmail = getMasterUserEmail(email, accessZone);
            
            // Create or get admin user
            console.info('[AUTH] MASTER_USER_LOOKUP');
            let user = await storage.getUser(userId);
            if (!user) {
              console.info('[AUTH] MASTER_USER_CREATE');
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
              console.info('[AUTH] MASTER_LAST_LOGIN_UPDATE');
              await storage.updateUserLastLogin(userId);
            }
            
            // Grant paid access (bypass payment gate)
            if (!user.hasPaidForAccess) {
              console.info('[AUTH] MASTER_ACCESS_UPDATE');
              await storage.updateUserAccess(userId, userId, 0);
            }
            
            console.info('[AUTH] PASSPORT_SUCCESS');
            return done(null, {
              id: user.id,
              claims: { sub: user.id, email: user.email || userEmail, firstName: user.firstName ?? undefined, lastName: user.lastName ?? undefined },
              isAdmin: true,
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
            id: user.id,
            claims: { sub: user.id, email: user.email ?? undefined, firstName: user.firstName ?? undefined, lastName: user.lastName ?? undefined },
            isAdmin: false,
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
