import crypto from "crypto";
import bcrypt from "bcrypt";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "./config";
import { pool } from "./db";

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
}

export interface StatelessLocalSession extends StatelessLocalUser {
  sessionVersion: 2;
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
const AUTH_DB_QUERY_TIMEOUT_MS = 4_000;
// Supabase Edge Functions may incur a multi-second cold start after a deployment.
// Keep this bounded, but long enough for the first authenticated probe to warm the
// project-local function. Once selected, the backend is cached for the process.
const AUTH_EDGE_TIMEOUT_MS = 15_000;
const AUTH_EDGE_FUNCTION = "legalwhat-local-auth";

interface EdgeAuthResponse {
  ok?: boolean;
  user?: StatelessLocalUser | null;
  error?: string;
}

async function edgeAuthRequest(
  action: "probe" | "login" | "register",
  payload: Record<string, unknown> = {},
): Promise<EdgeAuthResponse> {
  const url = String(getConfig().SUPABASE_URL || "").trim();
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

async function probeEdgeAuthStore(): Promise<void> {
  await edgeAuthRequest("probe");
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
  const url = String(getConfig().SUPABASE_URL || "").trim();
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
    let httpError: unknown = null;
    try {
      const supabase = await primarySupabaseClient();
      authBackend = { kind: "supabase", client: supabase };
      return authBackend;
    } catch (error) {
      httpError = error;
    }

    let edgeError: unknown = null;
    try {
      await probeEdgeAuthStore();
      authBackend = { kind: "edge" };
      console.warn("[AUTH] Direct Supabase server credential unavailable; using project-local Supabase Edge authentication authority");
      return authBackend;
    } catch (error) {
      edgeError = error;
    }

    try {
      await probePostgresAuthStore();
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
  return {
    id: String(row.id),
    email: String(row.email || ""),
    firstName: row.first_name == null ? null : String(row.first_name),
    lastName: row.last_name == null ? null : String(row.last_name),
    status: String(row.status || "active"),
    hasPaidForAccess: row.has_paid_for_access !== false,
  };
}

export async function probeLocalAuthStoreHttp(): Promise<void> {
  const backend = await resolveLocalAuthBackend();
  if (backend.kind === "edge") {
    await probeEdgeAuthStore();
    return;
  }
  if (backend.kind === "postgres") {
    await probePostgresAuthStore();
    return;
  }

  const [usersProbe, accountsProbe] = await Promise.all([
    backend.client.from("users").select("id").limit(1),
    backend.client.from("auth_accounts").select("id").limit(1),
  ]);
  if (usersProbe.error) throw new Error(`Users store probe failed: ${usersProbe.error.message}`);
  if (accountsProbe.error) throw new Error(`Auth accounts store probe failed: ${accountsProbe.error.message}`);
}

export async function getLocalUserByIdHttp(userId: string): Promise<StatelessLocalUser | null> {
  if (!userId) return null;
  const backend = await resolveLocalAuthBackend();

  if (backend.kind === "edge") {
    throw new Error("Edge authentication backend does not expose arbitrary user lookup");
  }
  if (backend.kind === "postgres") {
    const result = await authDbQuery(
      "SELECT id,email,first_name,last_name,status,has_paid_for_access FROM users WHERE id = $1 LIMIT 1",
      [userId],
    );
    return result.rows?.[0] ? mapUser(result.rows[0]) : null;
  }

  const { data, error } = await backend.client
    .from("users")
    .select("id,email,first_name,last_name,status,has_paid_for_access")
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
      "SELECT id,email,first_name,last_name,status,has_paid_for_access FROM users WHERE lower(email) = $1 LIMIT 1",
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
    .select("id,email,first_name,last_name,status,has_paid_for_access")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (userError) throw new Error(`User lookup failed: ${userError.message}`);
  if (!userRow) return null;

  const { data: authRow, error: authError } = await backend.client
    .from("auth_accounts")
    .select("id,user_id,password_hash")
    .eq("user_id", userRow.id)
    .eq("auth_type", "local")
    .maybeSingle();
  if (authError) throw new Error(`Authentication lookup failed: ${authError.message}`);
  if (!authRow?.password_hash) return null;

  const valid = await bcrypt.compare(password, String(authRow.password_hash));
  if (!valid) return null;

  const now = new Date().toISOString();
  void Promise.allSettled([
    backend.client.from("users").update({ last_login_at: now, updated_at: now }).eq("id", userRow.id),
    backend.client.from("auth_accounts").update({ last_login_at: now, updated_at: now }).eq("id", authRow.id),
  ]);

  return mapUser(userRow);
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

      const inserted = await dbClient.query(
        `INSERT INTO users
           (id,email,first_name,last_name,profile_image_url,status,has_paid_for_access,created_at,updated_at)
         VALUES ($1,$2,$3,$4,NULL,'active',true,$5,$5)
         RETURNING id,email,first_name,last_name,status,has_paid_for_access`,
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
      status: "active",
      has_paid_for_access: true,
      created_at: now,
      updated_at: now,
    })
    .select("id,email,first_name,last_name,status,has_paid_for_access")
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
      status: String(payload.status || "active"),
      hasPaidForAccess: payload.hasPaidForAccess !== false,
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

