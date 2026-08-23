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
  
  // CRITICAL: Only apply session middleware to API routes to prevent database overload
  // Static assets should NOT trigger session queries
  const sessionMiddleware = getSession();
  const passportInit = passport.initialize();
  const passportSession = passport.session();
  
  // Middleware that conditionally applies session only to API routes
  app.use((req, res, next) => {
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
