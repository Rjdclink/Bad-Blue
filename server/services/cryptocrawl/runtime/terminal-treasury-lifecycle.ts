import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import { resolveTerminalPayoutAddress } from '../core/wallet-identity.js';

const SYSTEM_KEY = 'cryptocrawler';
const HEARTBEAT_MS = 15_000;
const TERMINAL_GRACE_SECONDS = 180;
const TREASURY_WAKE_TIMEOUT_MS = 10_000;
const RAILWAY_DEPLOYMENT_ID = (process.env.RAILWAY_DEPLOYMENT_ID || '').trim();
const RAILWAY_SERVICE_ID = (process.env.RAILWAY_SERVICE_ID || '').trim();
const RAILWAY_ENVIRONMENT_ID = (process.env.RAILWAY_ENVIRONMENT_ID || '').trim();
const DESTINATION = resolveTerminalPayoutAddress() || '';

let timer: NodeJS.Timeout | null = null;
let heartbeatInFlight: Promise<void> | null = null;
let treasuryWakeInFlight: Promise<boolean> | null = null;
let signalInstalled = false;
let consecutiveHeartbeatFailures = 0;
let heartbeatDegradedUntil = 0;

function databaseBackoffMs(): number {
  const baseMs = Math.max(HEARTBEAT_MS, Number(process.env.CRYPTOCRAWL_TREASURY_DB_BACKOFF_BASE_MS || HEARTBEAT_MS));
  const maxMs = Math.max(baseMs, Number(process.env.CRYPTOCRAWL_TREASURY_DB_BACKOFF_MAX_MS || 120_000));
  return Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, consecutiveHeartbeatFailures - 1)));
}

const sigtermCandidateListener = (): void => {
  // SIGTERM intent remains a direct best-effort safety write and is never
  // suppressed by routine-heartbeat backoff.
  void markTerminalSweepCandidate('SIGTERM').catch(error => {
    logger.warn('[Treasury] Terminal candidate persistence deferred', {
      component: 'TerminalTreasuryLifecycle',
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

async function upsertVaultSecret(name: string, value: string): Promise<void> {
  if (!value) return;
  const existing = await pool.query('SELECT id FROM vault.secrets WHERE name=$1 LIMIT 1', [name]);
  const id = existing.rows[0]?.id ? String(existing.rows[0].id) : '';
  if (id) {
    await pool.query('SELECT vault.update_secret($1::uuid, $2, $3, $4)', [
      id,
      value,
      name,
      'CryptoCrawler terminal treasury worker secret synchronized from Railway runtime',
    ]);
  } else {
    await pool.query('SELECT vault.create_secret($1, $2, $3)', [
      value,
      name,
      'CryptoCrawler terminal treasury worker secret synchronized from Railway runtime',
    ]);
  }
}

async function syncWorkerSecrets(): Promise<void> {
  const secrets: Array<[string, string]> = [
    ['cryptocrawler_okx_api_key', (process.env.OKX_API_KEY || '').trim()],
    ['cryptocrawler_okx_api_secret', (process.env.OKX_API_SECRET || '').trim()],
    ['cryptocrawler_okx_api_passphrase', (process.env.OKX_API_PASSPHRASE || '').trim()],
    ['cryptocrawler_profit_wallet', DESTINATION],
    ['cryptocrawler_supabase_url', (process.env.SUPABASE_URL || '').trim()],
    ['cryptocrawler_supabase_service_key', (process.env.SUPABASE_SERVICE_KEY || '').trim()],
  ];
  for (const [name, value] of secrets) await upsertVaultSecret(name, value);
}

/**
 * Wake the one persistent treasury worker immediately after a terminal profitable
 * settlement. This does not create a second withdrawal authority: the Railway
 * runtime only records the 60/40 allocation and asks the existing Supabase worker
 * to act. The minute cron remains recovery/reconciliation if this wake fails.
 */
export async function requestImmediateTreasuryWorkerRun(trigger = 'terminal_profit'): Promise<boolean> {
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!supabaseUrl || !serviceKey) {
    logger.warn('[Treasury] Immediate payout wake unavailable; durable queue remains for cron recovery', {
      component: 'TerminalTreasuryLifecycle',
      trigger,
      supabaseUrlConfigured: Boolean(supabaseUrl),
      serviceKeyConfigured: Boolean(serviceKey),
    });
    return false;
  }
  if (treasuryWakeInFlight) return treasuryWakeInFlight;

  treasuryWakeInFlight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TREASURY_WAKE_TIMEOUT_MS);
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/cryptocrawler-terminal-sweeper`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({ trigger }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`treasury worker wake returned HTTP ${response.status}`);
      }
      return true;
    } catch (error) {
      logger.warn('[Treasury] Immediate payout wake deferred; durable queue remains for cron recovery', {
        component: 'TerminalTreasuryLifecycle',
        trigger,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      clearTimeout(timeout);
    }
  })().finally(() => { treasuryWakeInFlight = null; });

  return treasuryWakeInFlight;
}

async function heartbeatOnce(): Promise<void> {
  if (!isDatabaseConfigured) return;
  if (Date.now() < heartbeatDegradedUntil) return;
  if (heartbeatInFlight) return heartbeatInFlight;
  heartbeatInFlight = (async () => {
    try {
      await pool.query(
        `UPDATE public.cryptocrawler_terminal_sweep_control
         SET desired_state = CASE WHEN desired_state='TERMINATE_AND_SWEEP' THEN 'RUNNING' ELSE desired_state END,
             terminal_epoch = CASE WHEN desired_state='TERMINATE_AND_SWEEP' THEN NULL ELSE terminal_epoch END,
             intent_source = CASE WHEN desired_state='TERMINATE_AND_SWEEP' THEN 'successor_runtime_recovered' ELSE intent_source END,
             active_successor_deployment_id = NULLIF($2,''),
             last_observed_deployment_id = NULLIF($2,''),
             last_observed_deployment_status = 'SUCCESS',
             last_seen_active_at = now(),
             terminal_detection_not_before = CASE WHEN desired_state='TERMINATE_AND_SWEEP' THEN NULL ELSE terminal_detection_not_before END,
             destination_address = COALESCE(NULLIF($3,''), destination_address),
             last_error = CASE WHEN desired_state='TERMINATE_AND_SWEEP' THEN NULL ELSE last_error END,
             updated_at = now()
         WHERE system_key=$1 AND desired_state IN ('RUNNING','TERMINATE_AND_SWEEP')`,
        [SYSTEM_KEY, RAILWAY_DEPLOYMENT_ID, DESTINATION],
      );
      consecutiveHeartbeatFailures = 0;
      heartbeatDegradedUntil = 0;
    } catch (error) {
      consecutiveHeartbeatFailures += 1;
      heartbeatDegradedUntil = Date.now() + databaseBackoffMs();
      throw error;
    }
  })().finally(() => { heartbeatInFlight = null; });
  return heartbeatInFlight;
}

export async function ensureTerminalTreasuryLifecycle(): Promise<void> {
  if (!isDatabaseConfigured || timer) return;
  if (!DESTINATION) {
    logger.warn('[Treasury] Terminal payout wallet is not configured; runtime retention remains active and payouts fail closed', {
      component: 'TerminalTreasuryLifecycle',
      destinationVariable: 'CRYPTO_PROFIT_WALLET_ADDRESS',
    });
  }
  await syncWorkerSecrets();
  await heartbeatOnce();
  if (!signalInstalled && RAILWAY_DEPLOYMENT_ID) {
    process.prependListener('SIGTERM', sigtermCandidateListener);
    signalInstalled = true;
  }
  timer = setInterval(() => void heartbeatOnce().catch(error => {
    logger.warn('[Treasury] Lifecycle heartbeat deferred', {
      component: 'TerminalTreasuryLifecycle',
      error: error instanceof Error ? error.message : String(error),
      consecutiveHeartbeatFailures,
      databaseRetryNotBeforeMs: Math.max(0, heartbeatDegradedUntil - Date.now()),
    });
  }), HEARTBEAT_MS);
  timer.unref?.();
  logger.info('[Treasury] Persistent treasury lifecycle online', {
    component: 'TerminalTreasuryLifecycle',
    deploymentIdPresent: Boolean(RAILWAY_DEPLOYMENT_ID),
    serviceIdPresent: Boolean(RAILWAY_SERVICE_ID),
    environmentIdPresent: Boolean(RAILWAY_ENVIRONMENT_ID),
    terminalPayoutConfigured: Boolean(DESTINATION),
    terminalGraceSeconds: TERMINAL_GRACE_SECONDS,
    runtimePolicy: 'per_trade_60_percent_eth_payout_40_percent_retain_plus_terminal_drain',
    immediateWorkerWake: true,
    cronRecoveryStillAuthoritative: true,
    routineDatabaseFailureBackoff: 'bounded_exponential',
    sigtermIntentWriteBackoffBypass: true,
  });
}

export async function markTerminalSweepCandidate(signal: string): Promise<void> {
  if (!isDatabaseConfigured) return;
  if (signal !== 'SIGTERM' || !RAILWAY_DEPLOYMENT_ID) return;
  await pool.query(
    `UPDATE public.cryptocrawler_terminal_sweep_control
     SET desired_state='TERMINATE_AND_SWEEP',
         terminal_epoch=gen_random_uuid(),
         intent_source='railway_sigterm_candidate',
         last_observed_deployment_id=$2,
         last_observed_deployment_status='REMOVING',
         active_successor_deployment_id=NULL,
         terminal_detection_not_before=now() + make_interval(secs => $3),
         sweep_requested_at=now(),
         last_error=NULL,
         updated_at=now()
     WHERE system_key=$1 AND desired_state='RUNNING'`,
    [SYSTEM_KEY, RAILWAY_DEPLOYMENT_ID, TERMINAL_GRACE_SECONDS],
  );
  void requestImmediateTreasuryWorkerRun('terminal_candidate');
}

export function stopTerminalTreasuryLifecycle(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (signalInstalled) {
    process.removeListener('SIGTERM', sigtermCandidateListener);
    signalInstalled = false;
  }
}
