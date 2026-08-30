import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import { rainbowProfitBridge } from '../compensation/rainbow-profit-bridge.js';
import { resolveExecutionWalletAddress, resolveTerminalPayoutAddress } from '../core/wallet-identity.js';
import { setTreasuryRestartSweepBarrier } from '../governance/treasury-execution-barrier.js';

const SYSTEM_KEY = 'cryptocrawler';
const HEARTBEAT_MS = 15_000;
const TERMINAL_GRACE_SECONDS = 180;
const RAILWAY_DEPLOYMENT_ID = (process.env.RAILWAY_DEPLOYMENT_ID || '').trim();
const RAILWAY_SERVICE_ID = (process.env.RAILWAY_SERVICE_ID || '').trim();
const RAILWAY_ENVIRONMENT_ID = (process.env.RAILWAY_ENVIRONMENT_ID || '').trim();
const DESTINATION = resolveTerminalPayoutAddress() || '';
const EXECUTION_WALLET_DESTINATION = resolveExecutionWalletAddress().address || '';
const FALLBACK_DESTINATION = EXECUTION_WALLET_DESTINATION && EXECUTION_WALLET_DESTINATION.toLowerCase() !== DESTINATION.toLowerCase()
  ? EXECUTION_WALLET_DESTINATION
  : '';

type TreasuryState = 'RUNNING' | 'TERMINATE_AND_SWEEP' | 'SWEEPING' | 'SWEPT' | 'MANUAL_REVIEW';

let timer: NodeJS.Timeout | null = null;
let heartbeatInFlight: Promise<void> | null = null;
let signalInstalled = false;
let consecutiveHeartbeatFailures = 0;
let heartbeatDegradedUntil = 0;

function databaseBackoffMs(): number {
  const baseMs = Math.max(HEARTBEAT_MS, Number(process.env.CRYPTOCRAWL_TREASURY_DB_BACKOFF_BASE_MS || HEARTBEAT_MS));
  const maxMs = Math.max(baseMs, Number(process.env.CRYPTOCRAWL_TREASURY_DB_BACKOFF_MAX_MS || 120_000));
  return Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, consecutiveHeartbeatFailures - 1)));
}

const sigtermCandidateListener = (): void => {
  setTreasuryRestartSweepBarrier(true, 'railway_sigterm_restart_drain');
  void markTerminalSweepCandidate('SIGTERM').catch(error => {
    logger.warn('[Treasury] Restart-drain intent persistence deferred', {
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
      id, value, name, 'CryptoCrawler treasury worker secret synchronized from Railway runtime',
    ]);
  } else {
    await pool.query('SELECT vault.create_secret($1, $2, $3)', [
      value, name, 'CryptoCrawler treasury worker secret synchronized from Railway runtime',
    ]);
  }
}

async function syncWorkerSecrets(): Promise<void> {
  const secrets: Array<[string, string]> = [
    ['cryptocrawler_okx_api_key', (process.env.OKX_API_KEY || '').trim()],
    ['cryptocrawler_okx_api_secret', (process.env.OKX_API_SECRET || '').trim()],
    ['cryptocrawler_okx_api_passphrase', (process.env.OKX_API_PASSPHRASE || '').trim()],
    ['cryptocrawler_profit_wallet', DESTINATION],
    ['cryptocrawler_fallback_wallet', FALLBACK_DESTINATION],
    ['cryptocrawler_supabase_url', (process.env.SUPABASE_URL || '').trim()],
    ['cryptocrawler_supabase_service_key', (process.env.SUPABASE_SERVICE_KEY || '').trim()],
  ];
  for (const [name, value] of secrets) await upsertVaultSecret(name, value);
}

async function readTreasuryState(): Promise<TreasuryState> {
  const result = await pool.query(
    `SELECT desired_state FROM public.cryptocrawler_terminal_sweep_control WHERE system_key=$1`,
    [SYSTEM_KEY],
  );
  return String(result.rows[0]?.desired_state || 'RUNNING') as TreasuryState;
}

async function heartbeatOnce(): Promise<void> {
  if (!isDatabaseConfigured || Date.now() < heartbeatDegradedUntil) return;
  if (heartbeatInFlight) return heartbeatInFlight;

  heartbeatInFlight = (async () => {
    try {
      const state = await readTreasuryState();

      if (state === 'TERMINATE_AND_SWEEP' || state === 'SWEEPING') {
        // A successor process must not cancel the previous deployment's restart
        // drain and must not refresh last_seen_active_at. The central governance
        // barrier blocks only NEW exposure while cancel/hedge/settle remain live.
        setTreasuryRestartSweepBarrier(true, `treasury_state:${state}`);
        void rainbowProfitBridge.wake('terminal_candidate');
        consecutiveHeartbeatFailures = 0;
        heartbeatDegradedUntil = 0;
        return;
      }

      if (state === 'MANUAL_REVIEW') {
        setTreasuryRestartSweepBarrier(true, 'treasury_manual_review');
        consecutiveHeartbeatFailures = 0;
        heartbeatDegradedUntil = 0;
        return;
      }

      if (state === 'SWEPT') {
        // The restart drain is complete. A surviving/new deployment can now
        // reopen the lifecycle for future trading and future restart drains.
        await pool.query(
          `UPDATE public.cryptocrawler_terminal_sweep_control
           SET desired_state='RUNNING',
               terminal_epoch=NULL,
               terminal_detection_not_before=NULL,
               intent_source='successor_after_confirmed_restart_sweep',
               active_successor_deployment_id=NULLIF($2,''),
               last_observed_deployment_id=NULLIF($2,''),
               last_observed_deployment_status='SUCCESS',
               last_seen_active_at=now(),
               destination_address=COALESCE(NULLIF($3,''), destination_address),
               last_error=NULL,
               updated_at=now()
           WHERE system_key=$1 AND desired_state='SWEPT'`,
          [SYSTEM_KEY, RAILWAY_DEPLOYMENT_ID, DESTINATION],
        );
        setTreasuryRestartSweepBarrier(false);
        consecutiveHeartbeatFailures = 0;
        heartbeatDegradedUntil = 0;
        return;
      }

      await pool.query(
        `UPDATE public.cryptocrawler_terminal_sweep_control
         SET active_successor_deployment_id=NULLIF($2,''),
             last_observed_deployment_id=NULLIF($2,''),
             last_observed_deployment_status='SUCCESS',
             last_seen_active_at=now(),
             destination_address=COALESCE(NULLIF($3,''), destination_address),
             updated_at=now()
         WHERE system_key=$1 AND desired_state='RUNNING'`,
        [SYSTEM_KEY, RAILWAY_DEPLOYMENT_ID, DESTINATION],
      );
      setTreasuryRestartSweepBarrier(false);
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
    logger.warn('[Treasury] MetaMask payout wallet is not configured; payouts and restart drain fail closed', {
      component: 'TerminalTreasuryLifecycle', destinationVariable: 'CRYPTO_PROFIT_WALLET_ADDRESS',
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
    fallbackPayoutConfigured: Boolean(FALLBACK_DESTINATION),
    fallbackDerivedFromCanonicalExecutionWallet: Boolean(FALLBACK_DESTINATION),
    terminalGraceSeconds: TERMINAL_GRACE_SECONDS,
    runtimePolicy: 'first_three_fixed_60_percent_then_persisted_dynamic_55_to_65_percent_eth_payout_remainder_retained_restart_drains_remaining_treasury',
    successorCancelsRestartSweep: false,
    successorNewExposureBlockedDuringSweep: true,
    settlementHedgeFlatteningStillAllowed: true,
    singlePayoutAuthority: 'supabase_worker_okx_only',
    fallbackActivation: 'confirmed_primary_withdrawal_terminal_failure_only',
  });
}

export async function markTerminalSweepCandidate(signal: string): Promise<void> {
  if (!isDatabaseConfigured || signal !== 'SIGTERM' || !RAILWAY_DEPLOYMENT_ID) return;
  await pool.query(
    `UPDATE public.cryptocrawler_terminal_sweep_control
     SET desired_state='TERMINATE_AND_SWEEP',
         terminal_epoch=gen_random_uuid(),
         intent_source='railway_sigterm_restart_drain',
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
  void rainbowProfitBridge.wake('terminal_candidate');
}

export function stopTerminalTreasuryLifecycle(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (signalInstalled) {
    process.removeListener('SIGTERM', sigtermCandidateListener);
    signalInstalled = false;
  }
}
