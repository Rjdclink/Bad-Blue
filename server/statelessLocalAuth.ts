import crypto from "crypto";
import bcrypt from "bcrypt";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "./config";

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

export interface StatelessLocalSession {
  id: string;
}

interface LocalSessionPayload {
  v: 1;
  uid: string;
  exp: number;
  nonce: string;
}

let client: SupabaseClient | null | undefined;

function primarySupabaseClient(): SupabaseClient {
  if (client) return client;
  if (client === null) throw new Error("Primary Supabase HTTP authentication is not configured");

  // getConfig() captured the original LegalWhat project URL during bootstrap,
  // before CryptoCrawler compatibility code may remap legacy process.env names.
  const url = String(getConfig().SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();
  if (!url || !key) {
    client = null;
    throw new Error("Primary Supabase HTTP authentication is not configured");
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { "X-Client-Info": "legalwhat-server-auth" },
      fetch: (input, init) => fetch(input, {
        ...init,
        signal: AbortSignal.timeout(4_000),
      }),
    },
  });
  return client;
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
  const supabase = primarySupabaseClient();
  const [usersProbe, accountsProbe] = await Promise.all([
    supabase.from("users").select("id").limit(1),
    supabase.from("auth_accounts").select("id").limit(1),
  ]);
  if (usersProbe.error) throw new Error(`Users store probe failed: ${usersProbe.error.message}`);
  if (accountsProbe.error) throw new Error(`Auth accounts store probe failed: ${accountsProbe.error.message}`);
}

export async function getLocalUserByIdHttp(userId: string): Promise<StatelessLocalUser | null> {
  if (!userId) return null;
  const supabase = primarySupabaseClient();
  const { data, error } = await supabase
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
  const supabase = primarySupabaseClient();

  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("id,email,first_name,last_name,status,has_paid_for_access")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (userError) throw new Error(`User lookup failed: ${userError.message}`);
  if (!userRow) return null;

  const { data: authRow, error: authError } = await supabase
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
  // Login telemetry must not extend the credential-validation critical path.
  // These writes are best-effort metadata updates; authentication success is
  // already established once bcrypt verification completes.
  void Promise.allSettled([
    supabase.from("users").update({ last_login_at: now, updated_at: now }).eq("id", userRow.id),
    supabase.from("auth_accounts").update({ last_login_at: now, updated_at: now }).eq("id", authRow.id),
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

  const supabase = primarySupabaseClient();
  const { data: existing, error: lookupError } = await supabase
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (lookupError) throw new Error(`User lookup failed: ${lookupError.message}`);
  if (existing) throw new Error("Email already registered");

  const userId = crypto.randomUUID();
  const authId = crypto.randomUUID();
  const salt = await bcrypt.genSalt(BCRYPT_SALT_ROUNDS);
  const passwordHash = await bcrypt.hash(password, salt);
  const now = new Date().toISOString();

  const { data: userRow, error: userError } = await supabase
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

  const { error: authError } = await supabase.from("auth_accounts").insert({
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
    await supabase.from("users").delete().eq("id", userId);
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
    v: 1,
    uid: user.id,
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
    if (payload.v !== 1 || !Number.isSafeInteger(payload.exp) || payload.exp <= now) return null;
    if (!payload.uid || !/^[A-Za-z0-9_-]{20,}$/.test(payload.nonce || "")) return null;
    return { id: String(payload.uid) };
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

  const supabase = primarySupabaseClient();
  const { data: localAccounts, error: accountError } = await supabase
    .from("auth_accounts")
    .select("user_id")
    .eq("auth_type", "local");
  if (accountError) throw new Error(`Local account cleanup lookup failed: ${accountError.message}`);

  const localUserIds = [...new Set((localAccounts || []).map((row: any) => String(row.user_id || "")).filter(Boolean))];
  if (!localUserIds.length) return 0;

  const { data: candidateUsers, error: userError } = await supabase
    .from("users")
    .select("id,created_at")
    .in("id", localUserIds)
    .lt("created_at", cutoff.toISOString());
  if (userError) throw new Error(`Local account cleanup user lookup failed: ${userError.message}`);

  const ids = (candidateUsers || []).map((row: any) => String(row.id || "")).filter(Boolean);
  if (!ids.length) return 0;

  // Two legacy tables have non-cascading user foreign keys. Remove only rows
  // owned by the authorized pre-cutoff local test identities before deleting
  // the user records; all other user-owned tables cascade or set-null.
  for (const table of ["public_evidence", "document_creator_sessions"]) {
    const { error } = await supabase.from(table).delete().in("user_id", ids);
    if (error) throw new Error(`Local account cleanup failed for ${table}: ${error.message}`);
  }

  const { error: deleteError } = await supabase.from("users").delete().in("id", ids);
  if (deleteError) throw new Error(`Local account cleanup user delete failed: ${deleteError.message}`);

  return ids.length;
}
