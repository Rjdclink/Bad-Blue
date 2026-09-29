import crypto from "crypto";
import bcrypt from "bcrypt";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "./config";
import { pool } from "./db";
import type { TrialActivationOutcome } from "./trialAccess";

export const LOCAL_SESSION_COOKIE = "legalwhat_user";
const LOCAL_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_SALT_ROUNDS = 12;

export interface StatelessLocalUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  hasPaidForAccess: boolean;
  trialEligible?: boolean;
  trialStartedAt?: string | null;
  trialExpiresAt?: string | null;
  trialConsumedAt?: string | null;
}

export interface LocalTrialActivation {
  outcome: TrialActivationOutcome;
  user: StatelessLocalUser;
}

export interface StatelessLocalSession extends StatelessLocalUser {
  sessionVersion: 2;
}

export interface LocalSubscriptionStateUpdate {
  userId?: string;
  squareCustomerId?: string | null;
  squareSubscriptionId?: string | null;
  squarePlanVariationId?: string | null;
  status: string;
  hasPaidForAccess: boolean;
}

interface LocalSessionPayload {
  v: 2;
  uid: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  hasPaidForAccess: boolean;
  exp: number;
  nonce: string;
}

let client: SupabaseClient | undefined;
let clientSelection: Promise<SupabaseClient> | null = null;

type LocalAuthBackend =
  | { kind: "supabase"; client: SupabaseClient }
  | { kind: "edge" }
  | { kind: "postgres" };

let authBackend: LocalAuthBackend | null = null;
let authBackendSelection: Promise<LocalAuthBackend> | null = null;
let trialSchemaReady = false;
const LEGACY_LOCAL_USER_FIELDS = "id,email,first_name,last_name,status,has_paid_for_access";
const TRIAL_LOCAL_USER_FIELDS =
  `${LEGACY_LOCAL_USER_FIELDS},trial_eligible,trial_started_at,trial_expires_at,trial_consumed_at`;
function localUserSelectFields(): string {
  return trialSchemaReady ? TRIAL_LOCAL_USER_FIELDS : LEGACY_LOCAL_USER_FIELDS;
}
const AUTH_DB_QUERY_TIMEOUT_MS = 4_000;
// Supabase Edge Functions may incur a multi-second cold start after a deployment.
// Keep this bounded, but long enough for the first authenticated probe to warm the
// project-local function. Once selected, the backend is cached for the process.
const AUTH_EDGE_TIMEOUT_MS = 15_000;
const AUTH_EDGE_FUNCTION = "legalwhat-local-auth";

interface EdgeAuthResponse {
  ok?: boolean;
  user?: StatelessLocalUser | null;
  decision?: { outcome?: TrialActivationOutcome } | null;
  trialSchemaReady?: boolean;
  error?: string;
  fingerprint?: string | null;
}

async function edgeAuthRequest(
  action: "probe" | "login" | "register" | "user" | "set_subscription" | "activate_trial" | "reset_fingerprint" | "reset_password",
  payload: Record<string, unknown> = {},
): Promise<EdgeAuthResponse> {
  const url = String(process.env.LEGALWHAT_AUTH_SUPABASE_URL || getConfig().SUPABASE_URL || "").trim();
  const edgeSecret = String(process.env.LEGALWHAT_EDGE_AUTH_SECRET || "").trim();
  if (!url || !edgeSecret) throw new Error("Supabase Edge authentication is not configured");

  const response = await fetch(`${url.replace(/\/$/, "")}/functions/v1/${AUTH_EDGE_FUNCTION}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-legalwhat-auth-secret": edgeSecret,
      "x-client-info": "legalwhat-railway-auth",
    },
    body: JSON.stringify({ action, ...payload }),
    signal: AbortSignal.timeout(AUTH_EDGE_TIMEOUT_MS),
  });

  let body: EdgeAuthResponse;
  try {
    body = await response.json() as EdgeAuthResponse;
  } catch {
    throw new Error(`Supabase Edge authentication returned HTTP ${response.status}`);
  }

  if (!response.ok || body.ok !== true) {
    throw new Error(body.error || `Supabase Edge authentication returned HTTP ${response.status}`);
  }
  return body;
}

async function probeEdgeAuthStore(): Promise<boolean> {
  const result = await edgeAuthRequest("probe");
  return result.trialSchemaReady === true;
}

async function authDbQuery(text: string, values: unknown[] = []): Promise<any> {
  return pool.query({
    text,
    values,
    query_timeout: AUTH_DB_QUERY_TIMEOUT_MS,
  } as any);
}

async function probePostgresAuthStore(): Promise<void> {
  await Promise.all([
    authDbQuery("SELECT id FROM users LIMIT 1"),
    authDbQuery("SELECT id FROM auth_accounts LIMIT 1"),
  ]);
}

async function probePostgresTrialSchema(): Promise<boolean> {
  try {
    const result = await authDbQuery(`
      SELECT
        (SELECT count(*) = 4 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'users'
            AND column_name IN ('trial_eligible','trial_started_at','trial_expires_at','trial_consumed_at'))
        AND to_regprocedure('public.legalwhat_activate_trial(character varying)') IS NOT NULL
        AND to_regprocedure('public.legalwhat_bind_trial_square_customer(character varying,character varying)') IS NOT NULL
        AS ready
    `);
    return result.rows?.[0]?.ready === true;
  } catch {
    return false;
  }
}

async function probeSupabaseTrialSchema(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { error: columnError } = await supabase
      .from("users")
      .select("trial_eligible,trial_started_at,trial_expires_at,trial_consumed_at")
      .limit(0);
    if (columnError) return false;
    const { data, error } = await supabase.rpc("legalwhat_trial_schema_ready");
    return !error && data === true;
  } catch {
    return false;
  }
}

function buildPrimarySupabaseClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { "X-Client-Info": "legalwhat-server-auth" },
      fetch: (input, init) => fetch(input, {
        ...init,
        signal: AbortSignal.timeout(4_000),
      }),
    },
  });
}

async function primarySupabaseClient(): Promise<SupabaseClient> {
  if (client) return client;
  if (clientSelection) return clientSelection;

  // Prefer Supabase's modern server-only secret key, while retaining the legacy
  // service_role key as a bounded rotation fallback. A stale legacy key must not
  // shadow a valid modern key. Candidate keys are validated against both tables
  // required by LegalWhat local authentication before one becomes authoritative.
  const url = String(
    process.env.LEGALWHAT_AUTH_SUPABASE_URL ||
    getConfig().LEGALWHAT_AUTH_SUPABASE_URL ||
    getConfig().SUPABASE_URL ||
    ""
  ).trim();
  const keys = [
    String(process.env.SUPABASE_SECRET_KEY || "").trim(),
    String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  ].filter((value, index, values) => value && values.indexOf(value) === index);

  if (!url || !keys.length) {
    throw new Error("Primary Supabase HTTP authentication is not configured");
  }

  clientSelection = (async () => {
    let lastError = "no valid server key";
    for (const key of keys) {
      const candidate = buildPrimarySupabaseClient(url, key);
      const [usersProbe, accountsProbe] = await Promise.all([
        candidate.from("users").select("id").limit(1),
        candidate.from("auth_accounts").select("id").limit(1),
      ]);
      if (!usersProbe.error && !accountsProbe.error) {
        client = candidate;
        return candidate;
      }
      lastError = usersProbe.error?.message || accountsProbe.error?.message || lastError;
    }

    throw new Error(`No configured Supabase server key can access the LegalWhat authentication store: ${lastError}`);
  })();

  try {
    return await clientSelection;
  } finally {
    clientSelection = null;
  }
}

async function resolveLocalAuthBackend(): Promise<LocalAuthBackend> {
  if (authBackend) return authBackend;
  if (authBackendSelection) return authBackendSelection;

  authBackendSelection = (async () => {
    const dedicatedAuthConfigured = Boolean(
      String(
        process.env.LEGALWHAT_AUTH_SUPABASE_URL ||
        getConfig().LEGALWHAT_AUTH_SUPABASE_URL ||
        ""
      ).trim()
    );
    const edgeSecretConfigured = Boolean(String(process.env.LEGALWHAT_EDGE_AUTH_SECRET || "").trim());

    let edgeError: unknown = null;
    let httpError: unknown = null;

    // An explicitly configured LegalWhat auth project is the canonical identity
    // authority. Prefer its private Edge function so a server key belonging to the
    // general application project cannot silently redirect signups elsewhere.
    if (dedicatedAuthConfigured && edgeSecretConfigured) {
      try {
        trialSchemaReady = await probeEdgeAuthStore();
        authBackend = { kind: "edge" };
        return authBackend;
      } catch (error) {
        edgeError = error;
      }
    }

    try {
      const supabase = await primarySupabaseClient();
      trialSchemaReady = await probeSupabaseTrialSchema(supabase);
      authBackend = { kind: "supabase", client: supabase };
      return authBackend;
    } catch (error) {
      httpError = error;
    }

    // When no dedicated Edge authority was attempted above, retain it as the
    // bounded fallback for deployments using the application Supabase project.
    if (!dedicatedAuthConfigured || !edgeSecretConfigured) {
      try {
        trialSchemaReady = await probeEdgeAuthStore();
        authBackend = { kind: "edge" };
        console.warn("[AUTH] Direct Supabase server credential unavailable; using project-local Supabase Edge authentication authority");
        return authBackend;
      } catch (error) {
        edgeError = error;
      }
    }

    try {
      await probePostgresAuthStore();
      trialSchemaReady = await probePostgresTrialSchema();
      authBackend = { kind: "postgres" };
      console.warn("[AUTH] Supabase HTTP and Edge authentication unavailable; using bounded canonical PostgreSQL auth store");
      return authBackend;
    } catch (postgresError) {
      const httpMessage = httpError instanceof Error ? httpError.message : String(httpError || "unavailable");
      const edgeMessage = edgeError instanceof Error ? edgeError.message : String(edgeError || "unavailable");
      const postgresMessage = postgresError instanceof Error ? postgresError.message : String(postgresError || "unavailable");
      throw new Error(`LegalWhat authentication stores unavailable: http=${httpMessage}; edge=${edgeMessage}; postgres=${postgresMessage}`);
    }
  })();

  try {
    return await authBackendSelection;
  } finally {
    authBackendSelection = null;
  }
}

function normalizeEmail(email: string): string {
  const value = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("A valid email is required");
  return value;
}

function normalizeName(value: string, label: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function mapUser(row: any): StatelessLocalUser {
  const mapTimestamp = (value: unknown): string | null => {
    if (value == null) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  };

  return {
    id: String(row.id),
    email: String(row.email || ""),
    firstName: row.first_name == null ? null : String(row.first_name),
    lastName: row.last_name == null ? null : String(row.last_name),
    status: String(row.status || "pending_payment"),
    hasPaidForAccess: row.has_paid_for_access === true,
    trialEligible: row.trial_eligible === true,
    trialStartedAt: mapTimestamp(row.trial_started_at),
    trialExpiresAt: mapTimestamp(row.trial_expires_at),
    trialConsumedAt: mapTimestamp(row.trial_consumed_at),
  };
}

export async function probeLocalAuthStoreHttp(): Promise<void> {
  const backend = await resolveLocalAuthBackend();
  if (backend.kind === "edge") {
    trialSchemaReady = await probeEdgeAuthStore();
    return;
  }
  if (backend.kind === "postgres") {
    await probePostgresAuthStore();
    trialSchemaReady = await probePostgresTrialSchema();
    return;
  }

  const [usersProbe, accountsProbe] = await Promise.all([
    backend.client.from("users").select("id").limit(1),
    backend.client.from("auth_accounts").select("id").limit(1),
  ]);
  if (usersProbe.error) throw new Error(`Users store probe failed: ${usersProbe.error.message}`);
  if (accountsProbe.error) throw new Error(`Auth accounts store probe failed: ${accountsProbe.error.message}`);
  trialSchemaReady = await probeSupabaseTrialSchema(backend.client);
}

export async function isLocalTrialSchemaReady(): Promise<boolean> {
  await resolveLocalAuthBackend();
  return trialSchemaReady;
}

export async function getLocalUserByIdHttp(userId: string): Promise<StatelessLocalUser | null> {
  if (!userId) return null;
  const backend = await resolveLocalAuthBackend();

  if (backend.kind === "edge") {
    const result = await edgeAuthRequest("user", { userId });
    return result.user || null;
  }
  if (backend.kind === "postgres") {
    const result = await authDbQuery(
      `SELECT ${localUserSelectFields()} FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    return result.rows?.[0] ? mapUser(result.rows[0]) : null;
  }

  const { data, error } = await backend.client
    .from("users")
    .select(localUserSelectFields())
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`User lookup failed: ${error.message}`);
  return data ? mapUser(data) : null;
}

export async function authenticateLocalUserHttp(email: string, password: string): Promise<StatelessLocalUser | null> {
  const normalizedEmail = normalizeEmail(email);
  if (!password) return null;
  const backend = await resolveLocalAuthBackend();

  if (backend.kind === "edge") {
    const result = await edgeAuthRequest("login", { email: normalizedEmail, password });
    return result.user || null;
  }

  if (backend.kind === "postgres") {
    const userResult = await authDbQuery(
      `SELECT ${localUserSelectFields()} FROM users WHERE lower(email) = $1 LIMIT 1`,
      [normalizedEmail],
    );
    const userRow = userResult.rows?.[0];
    if (!userRow) return null;

    const authResult = await authDbQuery(
      "SELECT id,user_id,password_hash FROM auth_accounts WHERE user_id = $1 AND auth_type = 'local' LIMIT 1",
      [userRow.id],
    );
    const authRow = authResult.rows?.[0];
    if (!authRow?.password_hash) return null;

    const valid = await bcrypt.compare(password, String(authRow.password_hash));
    if (!valid) return null;

    const now = new Date().toISOString();
    void Promise.allSettled([
      authDbQuery("UPDATE users SET last_login_at = $1, updated_at = $1 WHERE id = $2", [now, userRow.id]),
      authDbQuery("UPDATE auth_accounts SET last_login_at = $1, updated_at = $1 WHERE id = $2", [now, authRow.id]),
    ]);
    return mapUser(userRow);
  }

  const { data: userRow, error: userError } = await backend.client
    .from("users")
    .select(localUserSelectFields())
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (userError) throw new Error(`User lookup failed: ${userError.message}`);
  if (!userRow) return null;
  const authenticatedUserId = String((userRow as any).id || "");
  if (!authenticatedUserId) throw new Error("User lookup returned no account ID");

  const { data: authRow, error: authError } = await backend.client
    .from("auth_accounts")
    .select("id,user_id,password_hash")
    .eq("user_id", authenticatedUserId)
    .eq("auth_type", "local")
    .maybeSingle();
  if (authError) throw new Error(`Authentication lookup failed: ${authError.message}`);
  if (!authRow?.password_hash) return null;

  const valid = await bcrypt.compare(password, String(authRow.password_hash));
  if (!valid) return null;

  const now = new Date().toISOString();
  void Promise.allSettled([
    backend.client.from("users").update({ last_login_at: now, updated_at: now }).eq("id", authenticatedUserId),
    backend.client.from("auth_accounts").update({ last_login_at: now, updated_at: now }).eq("id", authRow.id),
  ]);

  return mapUser(userRow);
}


async function passwordFingerprintForEmail(email: string): Promise<string | null> {
  const normalizedEmail = normalizeEmail(email);
  const backend = await resolveLocalAuthBackend();
  const directClient = backend.kind === "edge" ? await primarySupabaseClient() : null;
  let passwordHash = "";
  if (backend.kind === "postgres") {
    const result = await authDbQuery(
      `SELECT a.password_hash FROM users u JOIN auth_accounts a ON a.user_id=u.id AND a.auth_type='local'
        WHERE lower(u.email)=$1 LIMIT 1`, [normalizedEmail]);
    passwordHash = String(result.rows?.[0]?.password_hash || "");
  } else {
    const supabase = backend.kind === "supabase" ? backend.client : directClient!;
    const { data: user } = await supabase.from("users").select("id").eq("email", normalizedEmail).maybeSingle();
    if (!user?.id) return null;
    const { data: account } = await supabase.from("auth_accounts").select("password_hash")
      .eq("user_id", user.id).eq("auth_type", "local").maybeSingle();
    passwordHash = String(account?.password_hash || "");
  }
  return passwordHash ? crypto.createHash("sha256").update(passwordHash).digest("base64url") : null;
}

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
export async function createLocalPasswordResetTokenHttp(email: string, now = Date.now()): Promise<string | null> {
  const normalizedEmail = normalizeEmail(email);
  const fingerprint = await passwordFingerprintForEmail(normalizedEmail);
  if (!fingerprint) return null;
  const payload = Buffer.from(JSON.stringify({
    v: 1, email: normalizedEmail, fingerprint, exp: now + PASSWORD_RESET_TTL_MS,
    nonce: crypto.randomBytes(24).toString("base64url"),
  }), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export async function resetLocalPasswordHttp(token: string, newPassword: string, now = Date.now()): Promise<boolean> {
  if (String(newPassword || "").length < 8) throw new Error("Password must be at least 8 characters");
  const [encoded, signature, ...extra] = String(token || "").split(".");
  if (extra.length || !encoded || !signature || !safeEquals(signature, sign(encoded))) return false;
  let payload: any;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { return false; }
  if (payload?.v !== 1 || !Number.isSafeInteger(payload?.exp) || payload.exp <= now ||
      typeof payload?.email !== "string" || typeof payload?.fingerprint !== "string") return false;
  const currentFingerprint = await passwordFingerprintForEmail(payload.email);
  if (!currentFingerprint || !safeEquals(currentFingerprint, payload.fingerprint)) return false;

  const backend = await resolveLocalAuthBackend();
  const directClient = backend.kind === "edge" ? await primarySupabaseClient() : null;
  const salt = await bcrypt.genSalt(BCRYPT_SALT_ROUNDS);
  const passwordHash = await bcrypt.hash(newPassword, salt);
  const updatedAt = new Date(now).toISOString();
  if (backend.kind === "postgres") {
    const result = await authDbQuery(
      `UPDATE auth_accounts a SET password_hash=$1,password_salt=$2,updated_at=$3
        FROM users u WHERE a.user_id=u.id AND a.auth_type='local' AND lower(u.email)=$4 RETURNING a.id`,
      [passwordHash, salt, updatedAt, payload.email]);
    return Boolean(result.rows?.[0]?.id);
  }
  const supabase = backend.kind === "supabase" ? backend.client : directClient!;
  const { data: user } = await supabase.from("users").select("id").eq("email", payload.email).maybeSingle();
  if (!user?.id) return false;
  const { error } = await supabase.from("auth_accounts").update({
    password_hash: passwordHash, password_salt: salt, updated_at: updatedAt,
  }).eq("user_id", user.id).eq("auth_type", "local");
  return !error;
}

export async function registerLocalUserHttp(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
): Promise<StatelessLocalUser> {
  const normalizedEmail = normalizeEmail(email);
  const normalizedFirstName = normalizeName(firstName, "First name");
  const normalizedLastName = normalizeName(lastName, "Last name");
  if (String(password || "").length < 8) throw new Error("Password must be at least 8 characters");

  const backend = await resolveLocalAuthBackend();

  if (backend.kind === "edge") {
    const result = await edgeAuthRequest("register", {
      email: normalizedEmail,
      password,
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
    });
    if (!result.user) throw new Error("Registration failed");
    return result.user;
  }

  const userId = crypto.randomUUID();
  const authId = crypto.randomUUID();
  const salt = await bcrypt.genSalt(BCRYPT_SALT_ROUNDS);
  const passwordHash = await bcrypt.hash(password, salt);
  const now = new Date().toISOString();

  if (backend.kind === "postgres") {
    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");
      await dbClient.query(`SET LOCAL statement_timeout = '${AUTH_DB_QUERY_TIMEOUT_MS}ms'`);

      const existing = await dbClient.query(
        "SELECT id FROM users WHERE lower(email) = $1 LIMIT 1",
        [normalizedEmail],
      );
      if (existing.rows?.length) throw new Error("Email already registered");

      const trialEligibilityColumn = trialSchemaReady ? ",trial_eligible" : "";
      const trialEligibilityValue = trialSchemaReady ? ",true" : "";
      const inserted = await dbClient.query(
        `INSERT INTO users
           (id,email,first_name,last_name,profile_image_url,status,has_paid_for_access${trialEligibilityColumn},created_at,updated_at)
         VALUES ($1,$2,$3,$4,NULL,'pending_payment',false${trialEligibilityValue},$5,$5)
         RETURNING ${localUserSelectFields()}`,
        [userId, normalizedEmail, normalizedFirstName, normalizedLastName, now],
      );

      await dbClient.query(
        `INSERT INTO auth_accounts
           (id,user_id,auth_type,username,password_hash,password_salt,created_at,updated_at)
         VALUES ($1,$2,'local',$3,$4,$5,$6,$6)`,
        [authId, userId, `local-${userId}`, passwordHash, salt, now],
      );
      await dbClient.query("COMMIT");
      return mapUser(inserted.rows[0]);
    } catch (error: any) {
      await dbClient.query("ROLLBACK").catch(() => undefined);
      if (error?.code === "23505" || error?.message === "Email already registered") {
        throw new Error("Email already registered");
      }
      throw error;
    } finally {
      dbClient.release();
    }
  }

  const { data: existing, error: lookupError } = await backend.client
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (lookupError) throw new Error(`User lookup failed: ${lookupError.message}`);
  if (existing) throw new Error("Email already registered");

  const { data: userRow, error: userError } = await backend.client
    .from("users")
    .insert({
      id: userId,
      email: normalizedEmail,
      first_name: normalizedFirstName,
      last_name: normalizedLastName,
      profile_image_url: null,
      status: "pending_payment",
      has_paid_for_access: false,
      ...(trialSchemaReady ? { trial_eligible: true } : {}),
      created_at: now,
      updated_at: now,
    })
    .select(localUserSelectFields())
    .single();

  if (userError || !userRow) {
    if (userError?.code === "23505") throw new Error("Email already registered");
    throw new Error(`User registration failed: ${userError?.message || "unknown error"}`);
  }

  const { error: authError } = await backend.client.from("auth_accounts").insert({
    id: authId,
    user_id: userId,
    auth_type: "local",
    username: `local-${userId}`,
    password_hash: passwordHash,
    password_salt: salt,
    created_at: now,
    updated_at: now,
  });

  if (authError) {
    await backend.client.from("users").delete().eq("id", userId);
    if (authError.code === "23505") throw new Error("Email already registered");
    throw new Error(`Authentication registration failed: ${authError.message}`);
  }

  return mapUser(userRow);
}

export async function activateLocalTrialHttp(userId: string): Promise<LocalTrialActivation> {
  const id = String(userId || "").trim();
  if (!id) throw new Error("A user account is required to activate a trial");

  const backend = await resolveLocalAuthBackend();
  if (!trialSchemaReady) {
    const user = await getLocalUserByIdHttp(id);
    if (!user) throw new Error("Trial account was not found");
    return { outcome: "AMBIGUOUS", user };
  }
  let decision: any;

  if (backend.kind === "edge") {
    const result = await edgeAuthRequest("activate_trial", { userId: id });
    decision = result.decision;
  } else if (backend.kind === "postgres") {
    const result = await authDbQuery(
      "SELECT public.legalwhat_activate_trial($1) AS decision",
      [id],
    );
    decision = result.rows?.[0]?.decision;
  } else {
    const { data, error } = await backend.client.rpc("legalwhat_activate_trial", {
      p_user_id: id,
    });
    if (error) throw new Error(`Trial activation failed: ${error.message}`);
    decision = data;
  }

  const outcome = String(decision?.outcome || "") as TrialActivationOutcome;
  if (!["ELIGIBLE", "CLEAR_REPEAT", "AMBIGUOUS"].includes(outcome)) {
    throw new Error("Trial authority returned an invalid decision");
  }

  const user = await getLocalUserByIdHttp(id);
  if (!user) throw new Error("Trial account was not found after activation");
  return { outcome, user };
}

function normalizeSubscriptionUpdate(update: LocalSubscriptionStateUpdate): LocalSubscriptionStateUpdate {
  const status = String(update.status || "").trim().toLowerCase();
  if (!status) throw new Error("Subscription status is required");
  const normalized: LocalSubscriptionStateUpdate = {
    userId: update.userId ? String(update.userId).trim() : undefined,
    squareCustomerId: update.squareCustomerId ? String(update.squareCustomerId).trim() : null,
    squareSubscriptionId: update.squareSubscriptionId ? String(update.squareSubscriptionId).trim() : null,
    squarePlanVariationId: update.squarePlanVariationId ? String(update.squarePlanVariationId).trim() : null,
    status,
    hasPaidForAccess: update.hasPaidForAccess === true,
  };

  if (!normalized.userId && !normalized.squareCustomerId) {
    throw new Error("Subscription update requires a user or Square customer");
  }
  if (normalized.hasPaidForAccess && (
    normalized.status !== "active" ||
    !normalized.squareSubscriptionId ||
    !normalized.squarePlanVariationId
  )) {
    throw new Error("Paid access requires a verified active Square subscription");
  }
  return normalized;
}

async function ensurePostgresSubscriptionPlan(dbClient: any, squarePlanVariationId: string): Promise<number> {
  const existing = await dbClient.query(
    "SELECT id FROM plans WHERE square_plan_id = $1 AND is_active = true ORDER BY id DESC LIMIT 1",
    [squarePlanVariationId],
  );
  if (existing.rows?.[0]?.id) return Number(existing.rows[0].id);

  const inserted = await dbClient.query(
    `INSERT INTO plans (name,price,currency,interval,square_plan_id,is_active,created_at)
     VALUES ('LegalWhat Subscription',1999,'USD','monthly',$1,true,NOW())
     RETURNING id`,
    [squarePlanVariationId],
  );
  return Number(inserted.rows[0].id);
}

async function persistPostgresSubscriptionState(
  dbClient: any,
  update: LocalSubscriptionStateUpdate,
): Promise<StatelessLocalUser> {
  let userId = update.userId || "";
  if (!userId) {
    const lookup = await dbClient.query(
      "SELECT id FROM users WHERE square_customer_id = $1 LIMIT 1",
      [update.squareCustomerId],
    );
    userId = String(lookup.rows?.[0]?.id || "");
  }
  if (!userId) throw new Error("User not found for Square subscription");

  const currentUserResult = await dbClient.query(
    "SELECT status,has_paid_for_access FROM users WHERE id = $1 LIMIT 1",
    [userId],
  );
  if (!currentUserResult.rows?.[0]) throw new Error("Subscription user was not found");

  const administrativelySuspended =
    String(currentUserResult.rows[0].status || "").toLowerCase() === "suspended";
  let activeAdminOverride = false;
  if (!update.hasPaidForAccess && !administrativelySuspended) {
    const overrideSchema = await dbClient.query(`
      SELECT to_regclass('public.user_subscriptions') IS NOT NULL
        AND (
          SELECT count(*) = 4
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='user_subscriptions'
            AND column_name = ANY(ARRAY['id','user_id','is_active','payment_id'])
        ) AS ready
    `);
    if (overrideSchema.rows?.[0]?.ready === true) {
      const overrideResult = await dbClient.query(
        `SELECT id FROM user_subscriptions
          WHERE user_id=$1 AND is_active=true AND payment_id IS NULL
          LIMIT 1`,
        [userId],
      );
      activeAdminOverride = Boolean(overrideResult.rows?.[0]?.id);
    }
  }
  const effectiveUserStatus = administrativelySuspended
    ? "suspended"
    : activeAdminOverride
      ? "active"
      : update.status;
  const effectivePaidAccess = administrativelySuspended
    ? false
    : activeAdminOverride
      ? true
      : update.hasPaidForAccess;

  if (!effectivePaidAccess) {
    await dbClient.query(
      `UPDATE users
          SET status=$1,
              has_paid_for_access=false,
              square_customer_id=COALESCE($2,square_customer_id),
              updated_at=NOW()
        WHERE id=$3`,
      [effectiveUserStatus, update.squareCustomerId, userId],
    );
  }

  if (update.squareSubscriptionId && update.squarePlanVariationId) {
    const planId = await ensurePostgresSubscriptionPlan(dbClient, update.squarePlanVariationId);
    const existingSubscription = await dbClient.query(
      "SELECT id FROM subscriptions WHERE square_subscription_id = $1 LIMIT 1",
      [update.squareSubscriptionId],
    );
    if (existingSubscription.rows?.[0]?.id) {
      await dbClient.query(
        `UPDATE subscriptions
            SET plan_id=$1,status=$2,square_subscription_id=$3,
                start_date=COALESCE(start_date,NOW()),updated_at=NOW()
          WHERE id=$4`,
        [planId, update.status, update.squareSubscriptionId, existingSubscription.rows[0].id],
      );
    } else {
      await dbClient.query(
        `INSERT INTO subscriptions
           (user_id,plan_id,status,square_subscription_id,start_date,created_at,updated_at)
         VALUES ($1,$2,$3,$4,NOW(),NOW(),NOW())`,
        [userId, planId, update.status, update.squareSubscriptionId],
      );
    }
  }

  if (effectivePaidAccess) {
    const updated = await dbClient.query(
      `UPDATE users
          SET status=$1,
              has_paid_for_access=true,
              square_customer_id=COALESCE($2,square_customer_id),
              updated_at=NOW()
        WHERE id=$3
        RETURNING ${localUserSelectFields()}`,
      [effectiveUserStatus, update.squareCustomerId, userId],
    );
    if (!updated.rows?.[0]) throw new Error("Subscription user update failed");
    if (update.squareCustomerId && trialSchemaReady) {
      await dbClient.query(
        "SELECT public.legalwhat_bind_trial_square_customer($1,$2)",
        [userId, update.squareCustomerId],
      );
    }
    return mapUser(updated.rows[0]);
  }

  if (update.squareCustomerId && trialSchemaReady) {
    await dbClient.query(
      "SELECT public.legalwhat_bind_trial_square_customer($1,$2)",
      [userId, update.squareCustomerId],
    );
  }

  const refreshed = await dbClient.query(
    `SELECT ${localUserSelectFields()} FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  if (!refreshed.rows?.[0]) throw new Error("Subscription user refresh failed");
  return mapUser(refreshed.rows[0]);
}

async function ensureSupabaseSubscriptionPlan(
  supabase: SupabaseClient,
  squarePlanVariationId: string,
): Promise<number> {
  const { data: existing, error: lookupError } = await supabase
    .from("plans")
    .select("id")
    .eq("square_plan_id", squarePlanVariationId)
    .eq("is_active", true)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookupError) throw new Error(`Subscription plan lookup failed: ${lookupError.message}`);
  if (existing?.id) return Number(existing.id);

  const { data: inserted, error: insertError } = await supabase
    .from("plans")
    .insert({
      name: "LegalWhat Subscription",
      price: 1999,
      currency: "USD",
      interval: "monthly",
      square_plan_id: squarePlanVariationId,
      is_active: true,
    })
    .select("id")
    .single();
  if (insertError || !inserted?.id) {
    throw new Error(`Subscription plan creation failed: ${insertError?.message || "unknown error"}`);
  }
  return Number(inserted.id);
}

async function persistSupabaseSubscriptionState(
  supabase: SupabaseClient,
  update: LocalSubscriptionStateUpdate,
): Promise<StatelessLocalUser> {
  let userId = update.userId || "";
  if (!userId) {
    const { data: userLookup, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("square_customer_id", update.squareCustomerId)
      .limit(1)
      .maybeSingle();
    if (lookupError) throw new Error(`Square customer lookup failed: ${lookupError.message}`);
    userId = String(userLookup?.id || "");
  }
  if (!userId) throw new Error("User not found for Square subscription");

  const { data: currentUser, error: currentUserError } = await supabase
    .from("users")
    .select("status,has_paid_for_access")
    .eq("id", userId)
    .single();
  if (currentUserError || !currentUser) {
    throw new Error(`Subscription user lookup failed: ${currentUserError?.message || "unknown error"}`);
  }

  const administrativelySuspended =
    String(currentUser.status || "").toLowerCase() === "suspended";
  let activeAdminOverride = false;
  if (!update.hasPaidForAccess && !administrativelySuspended) {
    const { data: override } = await supabase
      .from("user_subscriptions")
      .select("id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .is("payment_id", null)
      .limit(1)
      .maybeSingle();
    activeAdminOverride = Boolean(override?.id);
  }
  const effectiveUserStatus = administrativelySuspended
    ? "suspended"
    : activeAdminOverride
      ? "active"
      : update.status;
  const effectivePaidAccess = administrativelySuspended
    ? false
    : activeAdminOverride
      ? true
      : update.hasPaidForAccess;

  const userPatch: Record<string, unknown> = {
    status: effectiveUserStatus,
    has_paid_for_access: effectivePaidAccess,
    updated_at: new Date().toISOString(),
  };
  if (update.squareCustomerId) userPatch.square_customer_id = update.squareCustomerId;

  if (!effectivePaidAccess) {
    const { error } = await supabase.from("users").update(userPatch).eq("id", userId);
    if (error) throw new Error(`Subscription access update failed: ${error.message}`);
  }

  if (update.squareSubscriptionId && update.squarePlanVariationId) {
    const planId = await ensureSupabaseSubscriptionPlan(supabase, update.squarePlanVariationId);
    const { data: existingSubscription, error: subLookupError } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("square_subscription_id", update.squareSubscriptionId)
      .limit(1)
      .maybeSingle();
    if (subLookupError) throw new Error(`Subscription lookup failed: ${subLookupError.message}`);

    if (existingSubscription?.id) {
      const { error } = await supabase
        .from("subscriptions")
        .update({
          plan_id: planId,
          status: update.status,
          square_subscription_id: update.squareSubscriptionId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingSubscription.id);
      if (error) throw new Error(`Subscription update failed: ${error.message}`);
    } else {
      const now = new Date().toISOString();
      const { error } = await supabase.from("subscriptions").insert({
        user_id: userId,
        plan_id: planId,
        status: update.status,
        square_subscription_id: update.squareSubscriptionId,
        start_date: now,
        created_at: now,
        updated_at: now,
      });
      if (error) throw new Error(`Subscription creation failed: ${error.message}`);
    }
  }

  if (effectivePaidAccess) {
    const { data: userRow, error: userError } = await supabase
      .from("users")
      .update(userPatch)
      .eq("id", userId)
      .select(localUserSelectFields())
      .single();
    if (userError || !userRow) {
      throw new Error(`Subscription user update failed: ${userError?.message || "unknown error"}`);
    }
    if (update.squareCustomerId && trialSchemaReady) {
      const { error: bindError } = await supabase.rpc("legalwhat_bind_trial_square_customer", {
        p_user_id: userId,
        p_square_customer_id: update.squareCustomerId,
      });
      if (bindError) throw new Error(`Verified Square trial identity binding failed: ${bindError.message}`);
    }
    return mapUser(userRow);
  }

  if (update.squareCustomerId && trialSchemaReady) {
    const { error: bindError } = await supabase.rpc("legalwhat_bind_trial_square_customer", {
      p_user_id: userId,
      p_square_customer_id: update.squareCustomerId,
    });
    if (bindError) throw new Error(`Verified Square trial identity binding failed: ${bindError.message}`);
  }

  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select(localUserSelectFields())
    .eq("id", userId)
    .single();
  if (userError || !userRow) {
    throw new Error(`Subscription user refresh failed: ${userError?.message || "unknown error"}`);
  }
  return mapUser(userRow);
}

export async function updateLocalUserSubscriptionHttp(
  rawUpdate: LocalSubscriptionStateUpdate,
): Promise<StatelessLocalUser> {
  const update = normalizeSubscriptionUpdate(rawUpdate);
  const backend = await resolveLocalAuthBackend();

  if (backend.kind === "edge") {
    const result = await edgeAuthRequest("set_subscription", update as unknown as Record<string, unknown>);
    if (!result.user) throw new Error("Subscription persistence failed");
    return result.user;
  }

  if (backend.kind === "postgres") {
    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");
      await dbClient.query(`SET LOCAL statement_timeout = '${AUTH_DB_QUERY_TIMEOUT_MS}ms'`);
      const user = await persistPostgresSubscriptionState(dbClient, update);
      await dbClient.query("COMMIT");
      return user;
    } catch (error) {
      await dbClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      dbClient.release();
    }
  }

  return persistSupabaseSubscriptionState(backend.client, update);
}

function sessionSecret(): string {
  const secret = String(process.env.SESSION_SECRET || "").trim();
  if (secret.length < 32) throw new Error("SESSION_SECRET is required for local session signing");
  return secret;
}

function sign(encodedPayload: string): string {
  return crypto.createHmac("sha256", sessionSecret()).update(encodedPayload).digest("base64url");
}

function safeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

export function createLocalSessionToken(user: StatelessLocalUser, now = Date.now()): string {
  const payload: LocalSessionPayload = {
    v: 2,
    uid: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    status: user.status,
    hasPaidForAccess: user.hasPaidForAccess,
    exp: now + LOCAL_SESSION_TTL_MS,
    nonce: crypto.randomBytes(24).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyLocalSessionToken(token: string | null | undefined, now = Date.now()): StatelessLocalSession | null {
  if (!token) return null;
  const [encoded, signature, ...extra] = token.split(".");
  if (extra.length || !encoded || !signature || !safeEquals(signature, sign(encoded))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as LocalSessionPayload;
    if (payload.v !== 2 || !Number.isSafeInteger(payload.exp) || payload.exp <= now) return null;
    if (!payload.uid || !payload.email || !/^[A-Za-z0-9_-]{20,}$/.test(payload.nonce || "")) return null;
    return {
      id: String(payload.uid),
      email: String(payload.email),
      firstName: payload.firstName == null ? null : String(payload.firstName),
      lastName: payload.lastName == null ? null : String(payload.lastName),
      status: String(payload.status || "pending_payment"),
      hasPaidForAccess: payload.hasPaidForAccess === true,
      sessionVersion: 2,
    };
  } catch {
    return null;
  }
}

export function getLocalSessionMaxAgeSeconds(): number {
  return Math.floor(LOCAL_SESSION_TTL_MS / 1000);
}

/**
 * One-time cleanup for pre-existing local signup test accounts. The cutoff is
 * mandatory so a repeated deployment can never remove a user created after the
 * cleanup was authorized.
 */
export async function purgeLocalTestUsersBeforeHttp(cutoffIso: string): Promise<number> {
  const cutoff = new Date(cutoffIso);
  if (!Number.isFinite(cutoff.getTime())) throw new Error("Invalid local-test-user purge cutoff");

  const backend = await resolveLocalAuthBackend();

  if (backend.kind === "edge") {
    // Maintenance deletion is intentionally not exposed through the public
    // login Edge Function. This historical cleanup is optional after cutoff.
    return 0;
  }

  if (backend.kind === "postgres") {
    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");
      await dbClient.query(`SET LOCAL statement_timeout = '${AUTH_DB_QUERY_TIMEOUT_MS}ms'`);

      const candidate = await dbClient.query(
        `SELECT DISTINCT u.id
           FROM users u
           JOIN auth_accounts a ON a.user_id = u.id AND a.auth_type = 'local'
          WHERE u.created_at < $1`,
        [cutoff.toISOString()],
      );
      const ids = (candidate.rows || []).map((row: any) => String(row.id || "")).filter(Boolean);
      if (!ids.length) {
        await dbClient.query("COMMIT");
        return 0;
      }

      await dbClient.query("DELETE FROM public_evidence WHERE user_id = ANY($1::varchar[])", [ids]);
      await dbClient.query("DELETE FROM document_creator_sessions WHERE user_id = ANY($1::varchar[])", [ids]);
      await dbClient.query("DELETE FROM users WHERE id = ANY($1::varchar[])", [ids]);
      await dbClient.query("COMMIT");
      return ids.length;
    } catch (error) {
      await dbClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      dbClient.release();
    }
  }

  const { data: localAccounts, error: accountError } = await backend.client
    .from("auth_accounts")
    .select("user_id")
    .eq("auth_type", "local");
  if (accountError) throw new Error(`Local account cleanup lookup failed: ${accountError.message}`);

  const localUserIds = [...new Set((localAccounts || []).map((row: any) => String(row.user_id || "")).filter(Boolean))];
  if (!localUserIds.length) return 0;

  const { data: candidateUsers, error: userError } = await backend.client
    .from("users")
    .select("id,created_at")
    .in("id", localUserIds)
    .lt("created_at", cutoff.toISOString());
  if (userError) throw new Error(`Local account cleanup user lookup failed: ${userError.message}`);

  const ids = (candidateUsers || []).map((row: any) => String(row.id || "")).filter(Boolean);
  if (!ids.length) return 0;

  for (const table of ["public_evidence", "document_creator_sessions"]) {
    const { error } = await backend.client.from(table).delete().in("user_id", ids);
    if (error) throw new Error(`Local account cleanup failed for ${table}: ${error.message}`);
  }

  const { error: deleteError } = await backend.client.from("users").delete().in("id", ids);
  if (deleteError) throw new Error(`Local account cleanup user delete failed: ${deleteError.message}`);

  return ids.length;
}

