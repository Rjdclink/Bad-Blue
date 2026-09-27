import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const testUrl = String(process.env.LEGALWHAT_TRIAL_TEST_NEON_DATABASE_URL || "").trim();
const primaryUrl = String(process.env.SUPABASE_DATABASE_URL || "").trim();
const mode = process.argv[2] || "--verify";

function parsePostgresUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is missing or is not a valid URL`);
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`${label} must be a PostgreSQL connection URL`);
  }
  return parsed;
}

if (process.env.NODE_ENV === "production") {
  throw new Error("Trial test Neon preparation is disabled in production");
}
if (!["--verify", "--apply"].includes(mode)) {
  throw new Error("Use --verify for read-only checks or --apply for the isolated test schema");
}

const neonHost = parsePostgresUrl(testUrl, "LEGALWHAT_TRIAL_TEST_NEON_DATABASE_URL").hostname.toLowerCase();
const primaryHost = parsePostgresUrl(primaryUrl, "SUPABASE_DATABASE_URL").hostname.toLowerCase();
const targetIsNeon = /(^|\.)neon\.tech$/i.test(neonHost);
const primaryIsSupabase = /(^|\.)supabase\.(co|com|net)$/i.test(primaryHost) || primaryHost.includes(".supabase.");
const hostsAreDistinct = neonHost !== primaryHost;
if (!targetIsNeon || !primaryIsSupabase || !hostsAreDistinct) {
  throw new Error("Isolation check failed; target must be Neon and distinct from the configured Supabase primary");
}

const pool = new Pool({
  connectionString: testUrl,
  max: 1,
  connectionTimeoutMillis: 8_000,
  statement_timeout: 8_000,
  query_timeout: 10_000,
  application_name: "legalwhat-trial-test-neon-preparation",
});

async function readTargetState(client) {
  await client.query("BEGIN READ ONLY");
  try {
    const result = await client.query(`
      SELECT
        (SELECT count(*) FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE')::integer AS public_table_count,
        to_regclass('public.users') IS NOT NULL AS users_present,
        to_regclass('public.auth_accounts') IS NOT NULL AS auth_accounts_present,
        to_regclass('public.sessions') IS NOT NULL AS sessions_present,
        to_regclass('public.plans') IS NOT NULL AS plans_present,
        to_regclass('public.subscriptions') IS NOT NULL AS subscriptions_present,
        to_regclass('public.legalwhat_trial_entitlements') IS NOT NULL AS trial_entitlements_present,
        to_regclass('public.legalwhat_trial_attempts') IS NOT NULL AS trial_attempts_present,
        to_regprocedure('public.legalwhat_activate_trial(character varying)') IS NOT NULL AS activate_function_present,
        to_regprocedure('public.legalwhat_bind_trial_square_customer(character varying,character varying)') IS NOT NULL AS bind_function_present,
        (SELECT count(*) = 4 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='users'
            AND column_name = ANY(ARRAY['trial_eligible','trial_started_at','trial_expires_at','trial_consumed_at']))
          AS trial_columns_present
    `);
    return result.rows[0];
  } finally {
    await client.query("ROLLBACK");
  }
}

function isFullyReady(state) {
  return state.users_present && state.auth_accounts_present && state.sessions_present &&
    state.plans_present && state.subscriptions_present && state.trial_entitlements_present &&
    state.trial_attempts_present && state.activate_function_present && state.bind_function_present &&
    state.trial_columns_present;
}

try {
  const client = await pool.connect();
  try {
    const before = await readTargetState(client);
    const output = {
      targetProvider: "Neon",
      configuredPrimaryProvider: "Supabase",
      hostnamesDistinct: true,
      isolationVerified: true,
      publicTablesBefore: before.public_table_count,
      trialSchemaReadyBefore: isFullyReady(before),
      mode,
    };

    if (mode === "--verify") {
      console.log(JSON.stringify(output, null, 2));
      process.exitCode = isFullyReady(before) || before.public_table_count === 0 ? 0 : 2;
    } else if (isFullyReady(before)) {
      console.log(JSON.stringify({ ...output, trialSchemaReady: true, migrationApplied: false }, null, 2));
    } else {
      if (before.public_table_count !== 0) {
        throw new Error("Refusing to initialize a non-empty Neon database with an incomplete trial schema");
      }

      const baseSql = await fs.readFile(path.join(scriptDir, "trial-test-neon-base.sql"), "utf8");
      const trialSql = await fs.readFile(
        path.resolve(scriptDir, "../../supabase/migrations/20260927000000_legalwhat_trial_access.sql"),
        "utf8",
      );
      await client.query("BEGIN");
      try {
        await client.query(baseSql);
        await client.query(trialSql);
        const after = await client.query(`
          SELECT
            to_regclass('public.users') IS NOT NULL
              AND to_regclass('public.auth_accounts') IS NOT NULL
              AND to_regclass('public.sessions') IS NOT NULL
              AND to_regclass('public.plans') IS NOT NULL
              AND to_regclass('public.subscriptions') IS NOT NULL
              AND to_regclass('public.legalwhat_trial_entitlements') IS NOT NULL
              AND to_regclass('public.legalwhat_trial_attempts') IS NOT NULL
              AND to_regprocedure('public.legalwhat_activate_trial(character varying)') IS NOT NULL
              AND to_regprocedure('public.legalwhat_bind_trial_square_customer(character varying,character varying)') IS NOT NULL
              AND (SELECT count(*) = 4 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='users'
                  AND column_name = ANY(ARRAY['trial_eligible','trial_started_at','trial_expires_at','trial_consumed_at']))
              AS ready
        `);
        if (after.rows[0]?.ready !== true) throw new Error("Neon trial schema post-migration verification failed");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
      console.log(JSON.stringify({ ...output, trialSchemaReady: true, migrationApplied: true }, null, 2));
    }
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}