// Platform-agnostic authentication setup
import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";
import { sendWelcomeEmail } from "./emailService";
import { setupLocalStrategy } from "./localAuth";
import { getConfig } from "./config";
import { isDatabaseConfigured, pool } from "./db";
import { getPlatformUserId, normalizePlatformUser } from "./authIdentity";
import {
  ACCESS_ZONES,
  MASTER_INTERNAL_EMAIL,
  MASTER_SESSION_COOKIE,
  MASTER_USER_ID,
  ZONE_FIRST_NAMES,
  checkMasterPassword,
  createMasterSessionToken,
  getMasterSessionMaxAgeSeconds,
  verifyMasterSessionToken,
} from "./masterPassword";
import { authRateLimit } from "./rateLimit";
import {
  LOCAL_SESSION_COOKIE,
  authenticateLocalUserHttp,
  createLocalSessionToken,
  getLocalSessionMaxAgeSeconds,
  registerLocalUserHttp,
  verifyLocalSessionToken,
  getLocalUserByIdHttp,
  type StatelessLocalSession,
} from "./statelessLocalAuth";


function readCookie(req: any, name: string): string | null {
  const header = String(req.headers?.cookie || "");
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function masterPlatformUser(): Express.User {
  const zone = "admin" as const;
  const zoneConfig = ACCESS_ZONES[zone];
  return {
    id: MASTER_USER_ID,
    claims: {
      sub: MASTER_USER_ID,
      email: MASTER_INTERNAL_EMAIL,
      firstName: ZONE_FIRST_NAMES[zone],
      lastName: "Admin",
    },
    isAdmin: true,
    isAdminBypass: false,
    isMasterBypass: true,
    accessZone: zone,
    accessRole: zoneConfig.role,
    redirectRoute: zoneConfig.route,
    aiMode: zoneConfig.mode,
  };
}

function hasValidMasterCookie(req: any): boolean {
  return verifyMasterSessionToken(readCookie(req, MASTER_SESSION_COOKIE));
}

function attachMasterIdentity(req: any): boolean {
  if (!hasValidMasterCookie(req)) return false;
  req.user = masterPlatformUser();
  req.isAuthenticated = () => true;
  return true;
}

function localSessionIdentity(req: any): StatelessLocalSession | null {
  return verifyLocalSessionToken(readCookie(req, LOCAL_SESSION_COOKIE));
}

function attachLocalIdentity(req: any): boolean {
  const session = localSessionIdentity(req);
  if (!session) return false;
  req.user = {
    id: session.id,
    claims: { sub: session.id },
    isAdmin: false,
    isAdminBypass: false,
    isMasterBypass: false,
  } as Express.User;
  req.isAuthenticated = () => true;
  return true;
}

function setMasterCookie(res: any, token: string): void {
  const secure = getConfig().NODE_ENV === "production";
  const parts = [
    `${MASTER_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${getMasterSessionMaxAgeSeconds()}`,
  ];
  if (secure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function clearMasterCookie(res: any): void {
  const secure = getConfig().NODE_ENV === "production";
  const parts = [
    `${MASTER_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function setLocalCookie(res: any, token: string): void {
  const secure = getConfig().NODE_ENV === "production";
  const parts = [
    `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${getLocalSessionMaxAgeSeconds()}`,
  ];
  if (secure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function clearLocalCookie(res: any): void {
  const secure = getConfig().NODE_ENV === "production";
  const parts = [
    `${LOCAL_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const cfg = getConfig();

  // Fail hard: sessions require persistent storage.
  // No demo fallbacks (in-memory sessions) and no silent defaults.
  if (!isDatabaseConfigured) {
    throw new Error('Database is not configured. Refusing to start auth/session middleware without persistent session storage.');
  }

  // DB-backed sessions (normal mode)
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    pool: pool,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });

  return session({
    secret: cfg.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: cfg.NODE_ENV === 'production',
      sameSite: cfg.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: sessionTtl,
    },
  });
}


export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  
  // CRITICAL: Only apply session middleware to API routes to prevent database overload.
  // Master recovery uses a short-lived HMAC cookie and deliberately avoids the
  // ordinary database-backed session store.
  const sessionMiddleware = getSession();
  const passportInit = passport.initialize();
  const passportSession = passport.session();

  app.post("/api/master-login", authRateLimit, (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const accessZone = checkMasterPassword(password);
    if (!accessZone) {
      return res.status(401).json({ message: "Invalid master password" });
    }

    const zoneConfig = ACCESS_ZONES[accessZone];
    setMasterCookie(res, createMasterSessionToken());
    clearLocalCookie(res);
    return res.json({
      success: true,
      message: "Login successful",
      isMasterBypass: true,
      hasActiveSubscription: true,
      accessZone,
      accessRole: zoneConfig.role,
      redirectRoute: zoneConfig.route,
      aiMode: zoneConfig.mode,
    });
  });

  app.post("/api/local-login", authRateLimit, async (req, res) => {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email : "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const user = await authenticateLocalUserHttp(email, password);
      if (!user) return res.status(401).json({ message: "Invalid email or password" });

      setLocalCookie(res, createLocalSessionToken(user));
      clearMasterCookie(res);
      return res.json({
        success: true,
        user,
        hasActiveSubscription: user.hasPaidForAccess && user.status === "active",
      });
    } catch (error) {
      console.error("[AUTH] HTTP local login unavailable:", error instanceof Error ? error.message : String(error));
      return res.status(503).json({ message: "Authentication service is temporarily unavailable" });
    }
  });

  app.post("/api/local-register", authRateLimit, async (req, res) => {
    try {
      const user = await registerLocalUserHttp(
        typeof req.body?.email === "string" ? req.body.email : "",
        typeof req.body?.password === "string" ? req.body.password : "",
        typeof req.body?.firstName === "string" ? req.body.firstName : "",
        typeof req.body?.lastName === "string" ? req.body.lastName : "",
      );
      return res.status(201).json({ success: true, user, hasActiveSubscription: user.hasPaidForAccess && user.status === "active" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Registration failed";
      if (message === "Email already registered") return res.status(409).json({ message });
      if (/required|valid email|at least 8 characters/i.test(message)) return res.status(400).json({ message });
      console.error("[AUTH] HTTP local registration unavailable:", message);
      return res.status(503).json({ message: "Registration service is temporarily unavailable" });
    }
  });

  // Resolve master identity before any database-backed session lookup. This
  // keeps master recovery available even when the ordinary user DB is degraded.
  app.use((req, res, next) => {
    if (attachMasterIdentity(req) || attachLocalIdentity(req)) return next();
    if (req.path === "/api/master-login" || req.path === "/api/local-login" || req.path === "/api/local-register") return next();

    // An unauthenticated auth-state probe must never wait on the PostgreSQL
    // session store. Preserve legacy Passport sessions only when the browser
    // actually presents the legacy connect.sid cookie.
    if (req.path === "/api/auth/user" && !readCookie(req, "connect.sid")) return next();
    // Only apply session middleware to API routes or specific auth paths
    // NOTE: /admin/crypto is protected by cryptoAuthMiddleware which relies on passport sessions.
    // If we don't attach sessions here, crypto admin routes will always return 401 even with a valid cookie.
    if (
      req.path.startsWith('/api/') ||
      req.path.startsWith('/admin/crypto') ||
      req.path === '/login' ||
      req.path === '/signup' ||
      req.path === '/'
    ) {
      sessionMiddleware(req, res, (err) => {
        if (err) return next(err);
        passportInit(req, res, (err) => {
          if (err) return next(err);
          passportSession(req, res, next);
        });
      });
    } else {
      // Skip session middleware for static assets
      next();
    }
  });

  // Setup local strategy for username/password auth
  setupLocalStrategy();

  // Master-aware auth status/logout short-circuits must be registered before
  // the ordinary database-backed routes are installed later in registerRoutes.
  app.get("/api/auth/user", async (req, res, next) => {
    if (hasValidMasterCookie(req)) return res.json(masterPlatformUser());
    const localSession = localSessionIdentity(req);
    if (!localSession) {
      // No master/local token and no hydrated legacy Passport identity means
      // this is simply an unauthenticated browser, not a database error.
      if (!req.user) return res.json(null);
      return next();
    }

    try {
      const localUser = await getLocalUserByIdHttp(localSession.id);
      if (!localUser) {
        clearLocalCookie(res);
        return res.json(null);
      }
      return res.json({
        id: localUser.id,
        email: localUser.email,
        firstName: localUser.firstName,
        lastName: localUser.lastName,
        profileImageUrl: null,
        status: localUser.status,
        hasPaidForAccess: localUser.hasPaidForAccess,
        accessPaymentId: null,
        accessPaidAt: null,
        lastLoginAt: null,
        createdAt: null,
        updatedAt: null,
      });
    } catch (error) {
      console.error("[AUTH] HTTP session lookup unavailable:", error instanceof Error ? error.message : String(error));
      return res.status(503).json({ message: "Authentication service is temporarily unavailable" });
    }
  });

  const statelessLogout = (req: any, res: any, next: any) => {
    if (!hasValidMasterCookie(req) && !localSessionIdentity(req)) return next();
    clearMasterCookie(res);
    clearLocalCookie(res);
    return res.json({ success: true });
  };
  app.get("/api/auth/logout", statelessLogout);
  app.post("/api/auth/logout", statelessLogout);

  passport.serializeUser((user: Express.User, cb) => cb(null, normalizePlatformUser(user)));
  passport.deserializeUser((user: Express.User, cb) => cb(null, normalizePlatformUser(user)));

  console.log("✓ Local authentication enabled with optimized session handling");
  
  // Setup authentication routes for local auth only
  app.get("/api/login", (req, res) => {
    res.status(501).json({ 
      message: "Use local authentication endpoint (/api/auth/login) for login.",
      localAuthAvailable: true 
    });
  });

  app.get("/api/callback", (req, res) => {
    res.status(404).json({ message: "OAuth callback not configured" });
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect("/");
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated() || !getPlatformUserId(req.user)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // User is authenticated - continue
  return next();
};

export const adminAuthMiddleware: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Check if user is admin
  const user = normalizePlatformUser(req.user as Express.User);
  if (!user || (!user.isAdmin && !user.isMasterBypass && !user.isAdminBypass)) {
    return res.status(403).json({ message: "Forbidden - Admin access required" });
  }

  return next();
};
