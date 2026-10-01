// Platform-agnostic authentication setup
import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
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
  activateLocalTrialHttp,
  authenticateLocalUserHttp,
  createLocalSessionToken,
  createLocalPasswordResetTokenHttp,
  resetLocalPasswordHttp,
  getLocalSessionMaxAgeSeconds,
  registerLocalUserHttp,
  verifyLocalSessionToken,
  purgeLocalTestUsersBeforeHttp,
  probeLocalAuthStoreHttp,
  getLocalUserByIdHttp,
  type StatelessLocalSession,
  type StatelessLocalUser,
} from "./statelessLocalAuth";
import { getLegalWhatAccessState, getTrialRemainingMilliseconds } from "./trialAccess";
import { sendAdminEmail, sendEmail } from "./emailService";
import { getBaseUrl } from "./config";


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
    accessState: "master",
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

const BLOCKED_ACCESS_STATUSES = new Set(["suspended", "past_due", "canceled", "expired"]);
const PAID_ACCESS_CACHE_TTL_MS = 5_000;
const paidAccessCache = new Map<string, { user: StatelessLocalUser; expiresAt: number }>();

export function invalidatePaidAccessCache(userId?: string | null): void {
  const id = String(userId || "").trim();
  if (id) paidAccessCache.delete(id);
  else paidAccessCache.clear();
}

function cachePaidAccessUser(user: StatelessLocalUser): void {
  paidAccessCache.set(user.id, {
    user,
    expiresAt: Date.now() + PAID_ACCESS_CACHE_TTL_MS,
  });
}

function cachedPaidAccessUser(userId: string): StatelessLocalUser | null {
  const cached = paidAccessCache.get(userId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    paidAccessCache.delete(userId);
    return null;
  }
  return cached.user;
}

export function hasPaidServiceAccess(user: Pick<StatelessLocalUser, "status" | "hasPaidForAccess"> | any): boolean {
  if (!user || user.hasPaidForAccess !== true) return false;
  const status = String(user.status || "").trim().toLowerCase();
  return !BLOCKED_ACCESS_STATUSES.has(status);
}

function requestHasIdentity(req: any): boolean {
  return typeof req?.isAuthenticated === "function" &&
    req.isAuthenticated() === true &&
    Boolean(getPlatformUserId(req.user));
}

function attachLocalIdentity(req: any): boolean {
  const session = localSessionIdentity(req);
  if (!session) return false;
  req.user = {
    id: session.id,
    email: session.email,
    firstName: session.firstName,
    lastName: session.lastName,
    status: session.status,
    hasPaidForAccess: session.hasPaidForAccess,
    claims: { sub: session.id, email: session.email },
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

export function issueLocalSessionCookie(res: any, user: Parameters<typeof createLocalSessionToken>[0]): void {
  setLocalCookie(res, createLocalSessionToken(user));
}

function localStateChanged(current: any, fresh: StatelessLocalUser): boolean {
  return String(current?.status || "") !== fresh.status ||
    current?.hasPaidForAccess !== fresh.hasPaidForAccess ||
    String(current?.email || "") !== fresh.email ||
    (current?.firstName ?? null) !== fresh.firstName ||
    (current?.lastName ?? null) !== fresh.lastName;
}

export async function refreshRequestUser(req: any, res?: any): Promise<any | null> {
  if (!requestHasIdentity(req)) return null;

  const current = req.user as any;
  if (current?.isMasterBypass || current?.isAdminBypass || current?.isAdmin) return current;

  const id = getPlatformUserId(current);
  if (!id) return null;

  const fresh = cachedPaidAccessUser(id) || await getLocalUserByIdHttp(id);
  if (!fresh) return null;
  cachePaidAccessUser(fresh);

  const nextUser = {
    ...current,
    id: fresh.id,
    email: fresh.email,
    firstName: fresh.firstName,
    lastName: fresh.lastName,
    status: fresh.status,
    hasPaidForAccess: fresh.hasPaidForAccess,
    trialEligible: fresh.trialEligible,
    trialStartedAt: fresh.trialStartedAt,
    trialExpiresAt: fresh.trialExpiresAt,
    trialConsumedAt: fresh.trialConsumedAt,
    claims: {
      ...(current?.claims || {}),
      sub: fresh.id,
      email: fresh.email,
    },
  };

  req.user = nextUser;
  req.isAuthenticated = () => true;

  if (res && readCookie(req, LOCAL_SESSION_COOKIE) && localStateChanged(current, fresh)) {
    issueLocalSessionCookie(res, fresh);
  }

  return nextUser;
}

export async function resolvePaidAccess(req: any, res?: any): Promise<{
  authenticated: boolean;
  authorized: boolean;
  reason: "ok" | "unauthenticated" | "subscription_required" | "auth_store_unavailable";
  accessState: "master" | "paid" | "trial_active" | "trial_expired" | "no_access";
  user: any | null;
}> {
  if (!requestHasIdentity(req)) {
    return { authenticated: false, authorized: false, reason: "unauthenticated", accessState: "no_access", user: null };
  }

  const current = req.user as any;
  if (current?.isMasterBypass || current?.isAdminBypass || current?.isAdmin) {
    return { authenticated: true, authorized: true, reason: "ok", accessState: "master", user: current };
  }

  try {
    const fresh = await refreshRequestUser(req, res);
    if (!fresh) {
      return { authenticated: false, authorized: false, reason: "unauthenticated", accessState: "no_access", user: null };
    }
    const accessState = getLegalWhatAccessState(fresh);
    const authorized = accessState === "paid" || accessState === "trial_active";
    return {
      authenticated: true,
      authorized,
      reason: authorized ? "ok" : "subscription_required",
      accessState,
      user: fresh,
    };
  } catch (error) {
    console.error("[AUTH] Paid-access freshness check unavailable:", error instanceof Error ? error.message : String(error));
    return { authenticated: true, authorized: false, reason: "auth_store_unavailable", accessState: "no_access", user: current };
  }
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

function clearLegacySessionCookie(res: any): void {
  const secure = getConfig().NODE_ENV === "production";
  const parts = [
    "connect.sid=",
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
      sameSite: 'lax',
      maxAge: sessionTtl,
    },
  });
}


export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  
  // Canonical master/local authentication is stateless at the application layer.
  // The PostgreSQL-backed Passport session stack is retained only as a bounded
  // compatibility reader for browsers that still present a legacy connect.sid.
  // It is created lazily so ordinary requests and startup never acquire a DB
  // session merely because authentication middleware exists.
  let legacySessionMiddleware: ReturnType<typeof getSession> | null = null;
  const passportInit = passport.initialize();
  const passportSession = passport.session();
  const getLegacySessionMiddleware = () => {
    if (!legacySessionMiddleware) legacySessionMiddleware = getSession();
    return legacySessionMiddleware;
  };

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
      accessState: "master",
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
      let user = await authenticateLocalUserHttp(email, password);
      if (!user) return res.status(401).json({ message: "Invalid email or password" });

      let trialOutcome: string | undefined;
      if (user.trialEligible && !user.trialStartedAt) {
        const activation = await activateLocalTrialHttp(user.id);
        user = activation.user;
        trialOutcome = activation.outcome;
      }

      setLocalCookie(res, createLocalSessionToken(user));
      cachePaidAccessUser(user);
      clearMasterCookie(res);
      return res.json({
        success: true,
        user,
        hasActiveSubscription: hasPaidServiceAccess(user),
        accessState: getLegalWhatAccessState(user),
        trialExpiresAt: user.trialExpiresAt || null,
        trialOutcome,
      });
    } catch (error) {
      console.error("[AUTH] HTTP local login unavailable:", error instanceof Error ? error.message : String(error));
      return res.status(503).json({ message: "Authentication service is temporarily unavailable" });
    }
  });

  app.post("/api/local-register", authRateLimit, async (req, res) => {
    try {
      const createdUser = await registerLocalUserHttp(
        typeof req.body?.email === "string" ? req.body.email : "",
        typeof req.body?.password === "string" ? req.body.password : "",
        typeof req.body?.firstName === "string" ? req.body.firstName : "",
        typeof req.body?.lastName === "string" ? req.body.lastName : "",
      );
      void sendAdminEmail({
        to: "contact.badblue@gmail.com",
        subject: "LegalWhat: New signup",
        message: `New LegalWhat signup\n\nName: ${[createdUser.firstName, createdUser.lastName].filter(Boolean).join(" ") || "Not provided"}\nEmail: ${createdUser.email}`,
      }).catch((error) => console.error("[AUTH] Signup notification failed:", error));
      const skipTrial = req.body?.skipTrial === true;
      const activation = skipTrial ? null : await activateLocalTrialHttp(createdUser.id);
      const user = activation?.user || createdUser;
      // Signup establishes a pending authenticated session so the user can move
      // directly into a trial or the existing Square subscription path.
      setLocalCookie(res, createLocalSessionToken(user));
      cachePaidAccessUser(user);
      clearMasterCookie(res);
      return res.status(201).json({
        success: true,
        user,
        hasActiveSubscription: hasPaidServiceAccess(user),
        accessState: getLegalWhatAccessState(user),
        trialExpiresAt: user.trialExpiresAt || null,
        trialOutcome: activation?.outcome,
        trialSkipped: skipTrial,
        paymentRequired: skipTrial ||
          activation?.outcome !== "ELIGIBLE" ||
          getLegalWhatAccessState(user) !== "trial_active",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Registration failed";
      if (message === "Email already registered") return res.status(409).json({ message });
      if (/required|valid email|at least 8 characters/i.test(message)) return res.status(400).json({ message });
      console.error("[AUTH] HTTP local registration unavailable:", message);
      return res.status(503).json({ message: "Registration service is temporarily unavailable" });
    }
  });

  app.post("/api/auth/forgot-password", authRateLimit, async (req, res) => {
    const generic = { message: "If that email belongs to a LegalWhat account, a password-reset link has been sent." };
    try {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const token = await createLocalPasswordResetTokenHttp(email);
      if (token) {
        const resetUrl = `${getBaseUrl().replace(/\/$/, "")}/login?reset=${encodeURIComponent(token)}`;
        void sendEmail({
          to: email,
          subject: "LegalWhat password reset",
          html: `<p>A password reset was requested for your LegalWhat account.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 30 minutes and stops working after your password changes.</p>`,
        }).catch((error) => console.error("[AUTH] Password-reset email failed:", error));
      }
    } catch (error) {
      console.error("[AUTH] Password-reset request failed:", error instanceof Error ? error.message : String(error));
    }
    return res.json(generic);
  });

  app.post("/api/auth/reset-password", authRateLimit, async (req, res) => {
    try {
      const token = typeof req.body?.token === "string" ? req.body.token : "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!await resetLocalPasswordHttp(token, password)) {
        return res.status(400).json({ message: "This password-reset link is invalid or has expired." });
      }
      clearLocalCookie(res);
      return res.json({ success: true, message: "Password updated. Please sign in with your new password." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/at least 8 characters/i.test(message)) return res.status(400).json({ message });
      return res.status(400).json({ message: "This password-reset link is invalid or has expired." });
    }
  });

  app.get("/api/auth/ready", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      await probeLocalAuthStoreHttp();
      return res.json({ ready: true, backend: "canonical-local-auth" });
    } catch (error) {
      console.error("[AUTH] HTTP auth-store readiness failed:", error instanceof Error ? error.message : String(error));
      return res.status(503).json({ ready: false });
    }
  });

  // Resolve canonical identities first. Only a request carrying the old
  // connect.sid cookie is allowed to enter the legacy PostgreSQL/Passport path.
  // This removes database-session work from unauthenticated API traffic and from
  // all new master/local sessions while preserving a bounded migration window.
  app.use((req, res, next) => {
    if (attachMasterIdentity(req) || attachLocalIdentity(req)) return next();

    if (!readCookie(req, "connect.sid")) return next();

    const sessionMiddleware = getLegacySessionMiddleware();
    sessionMiddleware(req, res, (err) => {
      if (err) return next(err);
      passportInit(req, res, (err) => {
        if (err) return next(err);
        passportSession(req, res, next);
      });
    });
  });

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

    // Revalidate durable access state on every auth-status refresh so a Square
    // cancellation, pause, administrative suspension, or override takes effect
    // without waiting for the signed identity cookie to expire.
    try {
      const fresh = await getLocalUserByIdHttp(localSession.id);
      if (!fresh) {
        clearLocalCookie(res);
        return res.json(null);
      }
      cachePaidAccessUser(fresh);
      if (localStateChanged(localSession, fresh)) {
        issueLocalSessionCookie(res, fresh);
      }
      return res.json({
        id: fresh.id,
        email: fresh.email,
        firstName: fresh.firstName,
        lastName: fresh.lastName,
        profileImageUrl: null,
        status: fresh.status,
        hasPaidForAccess: fresh.hasPaidForAccess,
          trialEligible: fresh.trialEligible === true,
          trialStartedAt: fresh.trialStartedAt || null,
          trialExpiresAt: fresh.trialExpiresAt || null,
          trialConsumedAt: fresh.trialConsumedAt || null,
          accessState: getLegalWhatAccessState(fresh),
          trialRemainingMs: getTrialRemainingMilliseconds(fresh),
          serverNow: new Date().toISOString(),
        accessPaymentId: null,
        accessPaidAt: null,
        lastLoginAt: null,
        createdAt: null,
        updatedAt: null,
      });
    } catch (error) {
      console.error("[AUTH] Durable auth-state refresh unavailable:", error instanceof Error ? error.message : String(error));
      return res.status(503).json({ message: "Authentication state is temporarily unavailable" });
    }
  });

  const canonicalLogout = (req: any, res: any) => {
    const finish = () => {
      clearMasterCookie(res);
      clearLocalCookie(res);
      clearLegacySessionCookie(res);
      return res.json({ success: true });
    };

    if (req.session?.destroy) {
      return req.session.destroy(() => finish());
    }
    return finish();
  };
  app.get("/api/auth/logout", canonicalLogout);
  app.post("/api/auth/logout", canonicalLogout);

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

  app.get("/api/logout", (req: any, res) => {
    const finish = () => {
      clearMasterCookie(res);
      clearLocalCookie(res);
      clearLegacySessionCookie(res);
      res.redirect("/");
    };
    if (req.session?.destroy) return req.session.destroy(() => finish());
    return finish();
  });

  const purgeCutoff = String(process.env.PURGE_LOCAL_TEST_USERS_BEFORE || "").trim();
  if (purgeCutoff) {
    try {
      const removed = await purgeLocalTestUsersBeforeHttp(purgeCutoff);
      console.info("[AUTH] Authorized pre-cutoff local test signup cleanup complete", {
        removed,
        cutoff: purgeCutoff,
      });
    } catch (error) {
      // Cleanup is maintenance-only and must not take the public application
      // offline. The cutoff keeps any later retry bounded to the same old users.
      console.error("[AUTH] Authorized local test signup cleanup failed", {
        cutoff: purgeCutoff,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const isIdentityAuthenticated: RequestHandler = async (req, res, next) => {
  if (!requestHasIdentity(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  return next();
};

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const decision = await resolvePaidAccess(req, res);
  if (!decision.authenticated) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (!decision.authorized) {
    if (decision.reason === "auth_store_unavailable") {
      return res.status(503).json({
        message: "Authentication state is temporarily unavailable",
        code: "AUTH_STATE_UNAVAILABLE",
      });
    }
    return res.status(402).json({
      message: decision.accessState === "trial_expired"
        ? "Your LegalWhat free trial has ended. Continue with the existing Square subscription checkout to restore access."
        : "Active LegalWhat subscription required",
      code: decision.accessState === "trial_expired" ? "TRIAL_EXPIRED" : "SUBSCRIPTION_REQUIRED",
      accessState: decision.accessState,
    });
  }

  // Carry the canonical, freshly resolved entitlement into protected server routes.
  // Downstream model routing must never infer paid status from client input.
  if (req.user) (req.user as any).accessState = decision.accessState;

  return next();
};

export const adminAuthMiddleware: RequestHandler = async (req, res, next) => {
  if (!requestHasIdentity(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Check if user is admin
  const user = normalizePlatformUser(req.user as Express.User);
  if (!user || (!user.isAdmin && !user.isMasterBypass && !user.isAdminBypass)) {
    return res.status(403).json({ message: "Forbidden - Admin access required" });
  }

  return next();
};
