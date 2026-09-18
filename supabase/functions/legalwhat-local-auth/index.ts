import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import bcrypt from "npm:bcryptjs@2.4.3";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  let key = "";
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      key = String(parsed?.default || "");
    } catch {}
  }
  key ||= Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) throw new Error("Supabase admin environment unavailable");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function normalizeEmail(raw: unknown): string {
  const email = String(raw || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email is required");
  return email;
}

function safeUser(row: any) {
  return {
    id: String(row.id),
    email: String(row.email || ""),
    firstName: row.first_name == null ? null : String(row.first_name),
    lastName: row.last_name == null ? null : String(row.last_name),
    status: String(row.status || "pending_payment"),
    hasPaidForAccess: row.has_paid_for_access === true,
  };
}

const RAILWAY_AUTH_SECRET_SHA256 = "3824b802f2a1cba6aa82f624c6aae41c64ef3c17f36a306d7c2986ef09056d53";

async function callerSecretMatches(candidate: string): Promise<boolean> {
  if (!candidate) return false;
  const bytes = new TextEncoder().encode(candidate);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (actual.length !== RAILWAY_AUTH_SECRET_SHA256.length) return false;

  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) {
    diff |= actual.charCodeAt(i) ^ RAILWAY_AUTH_SECRET_SHA256.charCodeAt(i);
  }
  return diff === 0;
}

async function ensureSubscriptionPlan(supabase: any, squarePlanVariationId: string): Promise<number> {
  const { data: existing, error: lookupError } = await supabase
    .from("plans")
    .select("id")
    .eq("square_plan_id", squarePlanVariationId)
    .eq("is_active", true)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookupError) throw new Error("Subscription plan lookup failed: " + lookupError.message);
  if (existing?.id) return Number(existing.id);

  const { data: inserted, error: insertError } = await supabase
    .from("plans")
    .insert({
      name: "LegalWhat Subscription",
      price: 2599,
      currency: "USD",
      interval: "monthly",
      square_plan_id: squarePlanVariationId,
      is_active: true,
    })
    .select("id")
    .single();
  if (insertError || !inserted?.id) {
    throw new Error("Subscription plan creation failed: " + (insertError?.message || "unknown error"));
  }
  return Number(inserted.id);
}

async function setSubscriptionState(supabase: any, body: any) {
  const requestedUserId = String(body?.userId || "").trim();
  const squareCustomerId = String(body?.squareCustomerId || "").trim();
  const squareSubscriptionId = String(body?.squareSubscriptionId || "").trim();
  const squarePlanVariationId = String(body?.squarePlanVariationId || "").trim();
  const status = String(body?.status || "").trim().toLowerCase();
  const hasPaidForAccess = body?.hasPaidForAccess === true;

  if (!status) throw new Error("Subscription status is required");
  if (!requestedUserId && !squareCustomerId) throw new Error("Subscription update requires a user or Square customer");
  if (hasPaidForAccess && (status !== "active" || !squareSubscriptionId || !squarePlanVariationId)) {
    throw new Error("Paid access requires a verified active Square subscription");
  }

  let userId = requestedUserId;
  if (!userId) {
    const { data: lookup, error } = await supabase
      .from("users")
      .select("id")
      .eq("square_customer_id", squareCustomerId)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Square customer lookup failed: " + error.message);
    userId = String(lookup?.id || "");
  }
  if (!userId) throw new Error("User not found for Square subscription");

  const { data: currentUser, error: currentUserError } = await supabase
    .from("users")
    .select("status,has_paid_for_access")
    .eq("id", userId)
    .single();
  if (currentUserError || !currentUser) {
    throw new Error("Subscription user lookup failed: " + (currentUserError?.message || "unknown error"));
  }

  const administrativelySuspended = String(currentUser.status || "").toLowerCase() === "suspended";
  let activeAdminOverride = false;
  if (!hasPaidForAccess && !administrativelySuspended) {
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
  const effectiveStatus = administrativelySuspended
    ? "suspended"
    : activeAdminOverride
      ? "active"
      : status;
  const effectivePaidAccess = administrativelySuspended
    ? false
    : activeAdminOverride
      ? true
      : hasPaidForAccess;

  const userPatch: Record<string, unknown> = {
    status: effectiveStatus,
    has_paid_for_access: effectivePaidAccess,
    updated_at: new Date().toISOString(),
  };
  if (squareCustomerId) userPatch.square_customer_id = squareCustomerId;

  // Revocations and pending states fail closed immediately. Grants are written
  // only after the durable Square subscription record has been persisted.
  if (!effectivePaidAccess) {
    const { error } = await supabase.from("users").update(userPatch).eq("id", userId);
    if (error) throw new Error("Subscription access update failed: " + error.message);
  }

  if (squareSubscriptionId && squarePlanVariationId) {
    const planId = await ensureSubscriptionPlan(supabase, squarePlanVariationId);
    const { data: existingSubscription, error: lookupError } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("square_subscription_id", squareSubscriptionId)
      .limit(1)
      .maybeSingle();
    if (lookupError) throw new Error("Subscription lookup failed: " + lookupError.message);

    if (existingSubscription?.id) {
      const { error } = await supabase
        .from("subscriptions")
        .update({
          plan_id: planId,
          status,
          square_subscription_id: squareSubscriptionId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingSubscription.id);
      if (error) throw new Error("Subscription update failed: " + error.message);
    } else {
      const now = new Date().toISOString();
      const { error } = await supabase.from("subscriptions").insert({
        user_id: userId,
        plan_id: planId,
        status,
        square_subscription_id: squareSubscriptionId,
        start_date: now,
        created_at: now,
        updated_at: now,
      });
      if (error) throw new Error("Subscription creation failed: " + error.message);
    }
  }

  if (effectivePaidAccess) {
    const { error } = await supabase.from("users").update(userPatch).eq("id", userId);
    if (error) throw new Error("Subscription access grant failed: " + error.message);
  }

  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("id,email,first_name,last_name,status,has_paid_for_access")
    .eq("id", userId)
    .single();
  if (userError || !userRow) throw new Error("Subscription user refresh failed: " + (userError?.message || "unknown error"));
  return safeUser(userRow);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const callerSecret = req.headers.get("x-legalwhat-auth-secret") || "";
  if (!(await callerSecretMatches(callerSecret))) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const supabase = adminClient();

    if (action === "probe") {
      const [usersProbe, accountsProbe] = await Promise.all([
        supabase.from("users").select("id").limit(1),
        supabase.from("auth_accounts").select("id").limit(1),
      ]);
      if (usersProbe.error) throw new Error("Users store probe failed: " + usersProbe.error.message);
      if (accountsProbe.error) throw new Error("Auth accounts store probe failed: " + accountsProbe.error.message);
      return json({ ok: true });
    }

    if (action === "user") {
      const userId = String(body?.userId || "").trim();
      if (!userId) return json({ ok: false, error: "User ID is required" }, 400);
      const { data: userRow, error } = await supabase
        .from("users")
        .select("id,email,first_name,last_name,status,has_paid_for_access")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw new Error("User lookup failed: " + error.message);
      return json({ ok: true, user: userRow ? safeUser(userRow) : null });
    }

    if (action === "login") {
      const email = normalizeEmail(body?.email);
      const password = String(body?.password || "");
      if (!password) return json({ ok: true, user: null });

      const { data: userRow, error: userError } = await supabase
        .from("users")
        .select("id,email,first_name,last_name,status,has_paid_for_access")
        .eq("email", email)
        .maybeSingle();
      if (userError) throw new Error("User lookup failed: " + userError.message);
      if (!userRow) return json({ ok: true, user: null });

      const { data: authRow, error: authError } = await supabase
        .from("auth_accounts")
        .select("id,user_id,password_hash")
        .eq("user_id", userRow.id)
        .eq("auth_type", "local")
        .maybeSingle();
      if (authError) throw new Error("Authentication lookup failed: " + authError.message);
      if (!authRow?.password_hash) return json({ ok: true, user: null });

      const valid = await bcrypt.compare(password, String(authRow.password_hash));
      if (!valid) return json({ ok: true, user: null });

      const now = new Date().toISOString();
      Promise.allSettled([
        supabase.from("users").update({ last_login_at: now, updated_at: now }).eq("id", userRow.id),
        supabase.from("auth_accounts").update({ last_login_at: now, updated_at: now }).eq("id", authRow.id),
      ]).catch(() => undefined);

      return json({ ok: true, user: safeUser(userRow) });
    }

    if (action === "register") {
      const email = normalizeEmail(body?.email);
      const firstName = String(body?.firstName || "").trim();
      const lastName = String(body?.lastName || "").trim();
      const password = String(body?.password || "");
      if (!firstName) return json({ ok: false, error: "First name is required" }, 400);
      if (!lastName) return json({ ok: false, error: "Last name is required" }, 400);
      if (password.length < 8) return json({ ok: false, error: "Password must be at least 8 characters" }, 400);

      const { data: existing, error: lookupError } = await supabase
        .from("users").select("id").eq("email", email).maybeSingle();
      if (lookupError) throw new Error("User lookup failed: " + lookupError.message);
      if (existing) return json({ ok: false, error: "Email already registered" }, 409);

      const userId = crypto.randomUUID();
      const authId = crypto.randomUUID();
      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(password, salt);
      const now = new Date().toISOString();

      const { data: userRow, error: userError } = await supabase
        .from("users")
        .insert({
          id: userId, email, first_name: firstName, last_name: lastName,
          profile_image_url: null, status: "pending_payment", has_paid_for_access: false,
          created_at: now, updated_at: now,
        })
        .select("id,email,first_name,last_name,status,has_paid_for_access")
        .single();
      if (userError || !userRow) {
        if (userError?.code === "23505") return json({ ok: false, error: "Email already registered" }, 409);
        throw new Error("User registration failed: " + (userError?.message || "unknown error"));
      }

      const { error: authError } = await supabase.from("auth_accounts").insert({
        id: authId, user_id: userId, auth_type: "local", username: "local-" + userId,
        password_hash: passwordHash, password_salt: salt, created_at: now, updated_at: now,
      });
      if (authError) {
        await supabase.from("users").delete().eq("id", userId);
        if (authError.code === "23505") return json({ ok: false, error: "Email already registered" }, 409);
        throw new Error("Authentication registration failed: " + authError.message);
      }

      return json({ ok: true, user: safeUser(userRow) }, 201);
    }

    if (action === "set_subscription") {
      const user = await setSubscriptionState(supabase, body);
      return json({ ok: true, user });
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (error) {
    console.error("[legalwhat-local-auth]", error instanceof Error ? error.message : String(error));
    return json({ ok: false, error: "Authentication backend unavailable" }, 503);
  }
});