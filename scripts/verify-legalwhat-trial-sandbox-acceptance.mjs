import assert from "node:assert/strict";
import crypto from "node:crypto";

const trialDbUrl = String(process.env.LEGALWHAT_TRIAL_TEST_NEON_DATABASE_URL || "").trim();
const configuredPrimaryUrl = String(process.env.SUPABASE_DATABASE_URL || "").trim();

function parsePostgresHost(raw, label) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} is missing or invalid`);
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`${label} is not a PostgreSQL URL`);
  }
  return parsed.hostname.toLowerCase();
}

const neonHost = parsePostgresHost(trialDbUrl, "Trial-test Neon URL");
const primaryHost = parsePostgresHost(configuredPrimaryUrl, "Configured primary database URL");
const primaryIsSupabase =
  /(^|\.)supabase\.(co|com|net)$/i.test(primaryHost) || primaryHost.includes(".supabase.");
if (!/(^|\.)neon\.tech$/i.test(neonHost) || neonHost === primaryHost || !primaryIsSupabase) {
  throw new Error("Isolation guard failed; refusing to test outside the distinct Neon database");
}

// Route every application database pool to Neon. Keep Supabase HTTP/Edge auth
// unusable without making requests to the configured production project.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("SUPABASE_")) process.env[key] = "";
}
for (const key of ["SUPABASE_DATABASE_URL", "SUPABASE_DB_URL", "DATABASE_URL"]) {
  process.env[key] = trialDbUrl;
}
for (const key of [
  "SUPABASE_DATABASE_URL_OVERFLOW",
  "SUPABASE_TRANSACTION_DATABASE_URL",
  "DATABASE_COORDINATION_URL",
  "CRYPTOCRAWL_COORDINATION_DATABASE_URL",
]) {
  process.env[key] = "";
}
process.env.SUPABASE_URL = "http://127.0.0.1:1";
process.env.LEGALWHAT_AUTH_SUPABASE_URL = "http://127.0.0.1:1";
process.env.LEGALWHAT_EDGE_AUTH_SECRET = "";
process.env.NODE_ENV = "development";
process.env.SQUARE_ENVIRONMENT = "sandbox";
process.env.SQUARE_ACCESS_TOKEN = "";
if (!process.env.SQUARE_SANDBOX_TOKEN && !process.env.SQUARE_SANDBOX_ACCESS_TOKEN) {
  throw new Error("Square Sandbox token alias is unavailable");
}

const { loadConfig, getConfig } = await import("../server/config.ts");
loadConfig();
const config = getConfig();
if (config.SQUARE_ENVIRONMENT !== "sandbox" || String(process.env.SQUARE_ACCESS_TOKEN || "").trim()) {
  throw new Error("Refusing to test unless Square is Sandbox-only");
}
if (!config.SQUARE_LOCATION_ID || !config.SQUARE_SUBSCRIPTION_PLAN_VARIATION_ID) {
  throw new Error("Development Square Sandbox location or plan variation is not configured");
}

const [{ default: express }, auth, localAuth, subscriptionRoutes, squareModule, dbModule] = await Promise.all([
  import("express"),
  import("../server/auth.ts"),
  import("../server/statelessLocalAuth.ts"),
  import("../server/routes/subscription.routes.ts"),
  import("../server/squareClient.ts"),
  import("../server/db.ts"),
]);

let httpServer;
let neonPool;
try {
  await localAuth.probeLocalAuthStoreHttp();
  assert.equal(await localAuth.isLocalTrialSchemaReady(), true, "Neon trial schema must be ready");

  const email = `legalwhat-sandbox-${crypto.randomUUID().replaceAll("-", "")}@gmail.com`;
  const password = `Sandbox-${crypto.randomBytes(8).toString("hex")}`;
  const app = express();
  app.use(express.json());
  await auth.setupAuth(app);
  subscriptionRoutes.setupSubscriptionRoutes(app);
  app.get("/__test/protected", auth.isAuthenticated, (_req, res) => res.json({ ok: true }));
  httpServer = await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  let cookie = "";

  async function api(path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { response, result: await response.json().catch(() => ({})) };
  }

  const signupResponse = await fetch(`${baseUrl}/api/local-register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, firstName: "Trial", lastName: "Acceptance" }),
  });
  const signup = await signupResponse.json().catch(() => ({}));
  assert.equal(signupResponse.status, 201, `Isolated signup failed: ${signup.message || "no message"}`);
  assert.equal(signup.trialOutcome, "ELIGIBLE", "A new account should receive a no-card trial");
  const user = signup.user;
  assert.ok(user?.id, "Signup must return the new account");
  assert.equal(user.trialEligible, true);
  assert.ok(user.trialStartedAt && user.trialExpiresAt && user.trialConsumedAt);
  assert.equal(user.hasPaidForAccess, false, "A trial must not grant paid status");
  const trialDurationSeconds = Math.round(
    (Date.parse(user.trialExpiresAt) - Date.parse(user.trialStartedAt)) / 1000,
  );
  assert.equal(trialDurationSeconds, 259200, "Trial must last exactly 72 hours");
  const setCookies =
    typeof signupResponse.headers.getSetCookie === "function"
      ? signupResponse.headers.getSetCookie()
      : [signupResponse.headers.get("set-cookie") || ""];
  const cookieMatch = setCookies.join(",").match(/\blegalwhat_user=([^;,\s]+)/);
  assert.ok(cookieMatch, "Signup must issue the local authenticated session cookie");
  cookie = `legalwhat_user=${cookieMatch[1]}`;

  const duringTrial = await api("/__test/protected");
  assert.equal(
    duringTrial.response.status,
    200,
    `Protected access should work during the trial: ${JSON.stringify(duringTrial.result)}`,
  );

  const { default: pg } = await import("pg");
  neonPool = new pg.Pool({
    connectionString: trialDbUrl,
    max: 1,
    connectionTimeoutMillis: 8000,
    statement_timeout: 8000,
    application_name: "legalwhat-trial-sandbox-acceptance",
  });
  await neonPool.query(
    `WITH expired AS (SELECT NOW()-INTERVAL '1 second' AS expires_at)
     UPDATE public.legalwhat_trial_entitlements e
        SET trial_started_at=expired.expires_at-INTERVAL '259200 seconds',
            trial_expires_at=expired.expires_at,
            trial_consumed_at=expired.expires_at-INTERVAL '259200 seconds'
       FROM expired
      WHERE e.user_id=$1`,
    [user.id],
  );
  await neonPool.query(
    `UPDATE public.users u
        SET trial_started_at=e.trial_started_at,
            trial_expires_at=e.trial_expires_at,
            trial_consumed_at=e.trial_consumed_at,
            updated_at=NOW()
       FROM public.legalwhat_trial_entitlements e
      WHERE u.id=e.user_id AND u.id=$1`,
    [user.id],
  );
  auth.invalidatePaidAccessCache(user.id);

  const afterExpiry = await api("/__test/protected");
  assert.equal(afterExpiry.response.status, 402, "Expired trial must deny protected access");
  assert.equal(afterExpiry.result.code, "TRIAL_EXPIRED");
  const sameAccountRepeat = await localAuth.activateLocalTrialHttp(user.id);
  assert.equal(sameAccountRepeat.outcome, "CLEAR_REPEAT", "An expired trial cannot be activated again");

  const checkout = await api("/api/subscription/checkout", {});
  assert.equal(
    checkout.response.status,
    200,
    `Sandbox checkout creation failed: ${checkout.result.message || "no message"}`,
  );
  assert.ok(checkout.result.checkoutUrl, "Sandbox checkout URL should be returned");
  const checkoutOrderId = String(checkout.result.orderId || "").trim();
  assert.ok(checkoutOrderId, "Square Sandbox checkout must return its hosted-checkout order ID");

  const square = squareModule.getSquareClient();
  const requestOptions = { timeoutInSeconds: 20, maxRetries: 1 };
  const customerResponse = await square.customers.create(
    {
      idempotencyKey: crypto.randomUUID(),
      givenName: "Trial",
      familyName: "Acceptance",
      emailAddress: email,
      referenceId: user.id,
    },
    requestOptions,
  );
  const customerId = String(customerResponse?.customer?.id || "");
  assert.ok(customerId, "Sandbox customer should be created");

  const cardResponse = await square.cards.create(
    {
      idempotencyKey: crypto.randomUUID(),
      sourceId: "cnon:card-nonce-ok",
      card: {
        customerId,
        cardholderName: "LegalWhat Trial Acceptance",
        referenceId: user.id,
        billingAddress: {
          addressLine1: "123 Test Street",
          locality: "Chicago",
          administrativeDistrictLevel1: "IL",
          postalCode: "60601",
          country: "US",
        },
      },
    },
    requestOptions,
  );
  const cardId = String(cardResponse?.card?.id || "");
  assert.ok(cardId, "Sandbox card on file should be created");

  const subscriptionResponse = await square.subscriptions.create(
    {
      idempotencyKey: crypto.randomUUID(),
      locationId: config.SQUARE_LOCATION_ID,
      planVariationId: config.SQUARE_SUBSCRIPTION_PLAN_VARIATION_ID,
      customerId,
      cardId,
      timezone: "America/Chicago",
    },
    requestOptions,
  );
  let subscription = subscriptionResponse?.subscription;
  const subscriptionId = String(subscription?.id || "");
  assert.ok(subscriptionId, "Sandbox subscription should be created");
  if (String(subscription.status || "").toUpperCase() !== "ACTIVE") {
    const refreshed = await square.subscriptions.get({ subscriptionId }, requestOptions);
    subscription = refreshed?.subscription || subscription;
  }
  assert.equal(
    String(subscription.status || "").toUpperCase(),
    "ACTIVE",
    "Square Sandbox subscription must be active",
  );

  // Hosted subscription-link orders are completed only through Square Checkout.
  // Use a separate open Sandbox order for the API payment-verification exercise.
  const orderResponse = await square.orders.create(
    {
      idempotencyKey: crypto.randomUUID(),
      order: {
        locationId: config.SQUARE_LOCATION_ID,
        customerId,
        referenceId: `trial-${crypto.randomUUID().replaceAll("-", "").slice(0, 32)}`,
        lineItems: [
          {
            name: "LegalWhat Sandbox Subscription Verification",
            quantity: "1",
            basePriceMoney: { amount: 1999n, currency: "USD" },
          },
        ],
      },
    },
    requestOptions,
  );
  const order = orderResponse?.order;
  const orderId = String(order?.id || "");
  assert.ok(orderId, "A separate Sandbox order should be created");
  assert.equal(String(order?.state || "").toUpperCase(), "OPEN", "Sandbox order must be open for payment");

  const paymentResponse = await square.payments.create(
    {
      sourceId: cardId,
      idempotencyKey: crypto.randomUUID(),
      amountMoney: { amount: 1999n, currency: "USD" },
      locationId: config.SQUARE_LOCATION_ID,
      orderId,
      customerId,
      note: `legalwhat-subscription:${user.id}`,
      autocomplete: true,
    },
    requestOptions,
  );
  const payment = paymentResponse?.payment;
  assert.ok(payment?.id, "Sandbox payment should be created");
  assert.equal(String(payment.status || "").toUpperCase(), "COMPLETED");
  assert.equal(String(payment.note || ""), `legalwhat-subscription:${user.id}`);
  assert.equal(Number(payment.amountMoney?.amount || 0), 1999);
  assert.equal(String(payment.amountMoney?.currency || "").toUpperCase(), "USD");
  assert.equal(String(payment.orderId || ""), orderId);

  let confirmation;
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await api("/api/subscription/confirm", { orderId });
    if (result.response.status === 200 && result.result.active === true) {
      confirmation = result;
      break;
    }
    if (result.response.status !== 202) {
      throw new Error(`Sandbox payment verification failed with HTTP ${result.response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  assert.ok(confirmation, "The app must verify the completed Sandbox payment and active subscription");

  auth.invalidatePaidAccessCache(user.id);
  const paidAccess = await api("/__test/protected");
  assert.equal(paidAccess.response.status, 200, "Verified subscription should restore protected access");

  const linkedUser = await localAuth.registerLocalUserHttp(
    `linked-${crypto.randomUUID()}@example.com`,
    `Sandbox-${crypto.randomBytes(8).toString("hex")}`,
    "Linked",
    "Repeat",
  );
  await localAuth.updateLocalUserSubscriptionHttp({
    userId: linkedUser.id,
    squareCustomerId: customerId,
    status: "pending_payment",
    hasPaidForAccess: false,
  });
  const linkedRepeat = await localAuth.activateLocalTrialHttp(linkedUser.id);
  assert.equal(linkedRepeat.outcome, "CLEAR_REPEAT", "A second account linked to the used Square customer is rejected");
  assert.equal(linkedRepeat.user.trialStartedAt, null, "Linked repeat account must receive no trial window");

  console.log(
    JSON.stringify(
      {
        isolation: "distinct Neon; Supabase API and Edge auth disabled",
        squareEnvironment: "sandbox",
        trialStartedWithoutPayment: true,
        trialDurationSeconds,
        expiredAccessDenied: true,
        sameAccountRepeatRejected: true,
        sandboxCheckoutCreated: true,
        sandboxSubscriptionActive: true,
        sandboxPaymentVerifiedByApp: true,
        paidAccessRestored: true,
        linkedRepeatTrialRejected: true,
      },
      null,
      2,
    ),
  );
} finally {
  if (httpServer) {
    httpServer.closeAllConnections?.();
    await new Promise((resolve) => httpServer.close(resolve));
  }
  if (neonPool) await neonPool.end();
  void dbModule.pool.end().catch(() => undefined);
  void dbModule.coordinationPool.end().catch(() => undefined);
}

process.exit(0);