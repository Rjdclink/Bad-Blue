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
  res.setHeader("Set-Cookie", parts.join("; "));
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
  res.setHeader("Set-Cookie", parts.join("; "));
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

  app.post("/api/master-login", (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const accessZone = checkMasterPassword(password);
    if (!accessZone) {
      return res.status(401).json({ message: "Invalid master password" });
    }

    const zoneConfig = ACCESS_ZONES[accessZone];
    setMasterCookie(res, createMasterSessionToken());
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

  // Resolve master identity before any database-backed session lookup. This
  // keeps master recovery available even when the ordinary user DB is degraded.
  app.use((req, res, next) => {
    if (attachMasterIdentity(req)) return next();
    if (req.path === "/api/master-login") return next();
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
  app.get("/api/auth/user", (req, res, next) => {
    if (!hasValidMasterCookie(req)) return next();
    return res.json(masterPlatformUser());
  });

  const masterLogout = (req: any, res: any, next: any) => {
    if (!hasValidMasterCookie(req)) return next();
    clearMasterCookie(res);
    return res.json({ success: true });
  };
  app.get("/api/auth/logout", masterLogout);
  app.post("/api/auth/logout", masterLogout);

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
