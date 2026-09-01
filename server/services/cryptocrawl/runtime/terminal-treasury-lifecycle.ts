import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';
import { rainbowProfitBridge } from '../compensation/rainbow-profit-bridge.js';
import { resolveExecutionWalletAddress, resolveTerminalPayoutAddress } from '../core/wallet-identity.js';
import { setTreasuryRestartSweepBarrier } from '../governance/treasury-execution-barrier.js';
import { withCryptaraSupabasePriority } from '../integration/cryptara-supabase-admission-worker.js';

const SYSTEM_KEY = 'cryptocrawler';
const HEARTBEAT_MS = 60_000;
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

type VaultSecretSpec = {
  name: string;
  value: string;
  optional: boolean;
  description: string;
};

let timer: NodeJS.Timeout | null = null;
let heartbeatInFlight: Promise<void> | null = null;
let lifecycleStarted = false;
let signalInstalled = false;
let workerSecretsSynchronized = false;
let consecutiveHeartbeatFailures = 0;
let heartbeatDegradedUntil = 0;

function highPriorityQuery(text: string, values: unknown[] = []) {
  return withCryptaraSupabasePriority('high', () => pool.query(text, values));
}

function criticalPriorityQuery(text: string, values: unknown[] = []) {
  return withCryptaraSupabasePriority('critical', () => pool.query(text, values));
}

function databaseBackoffMs(): number {
  const baseMs = Math.max(HEARTBEAT_MS, Number(process.env.CRYPTOCRAWL_TREASURY_DB_BACKOFF_BASE_MS || HEARTBEAT_MS));
  const maxMs = Math.max(baseMs, Number(process.env.CRYPTOCRAWL_TREASURY_DB_BACKOFF_MAX_MS || 120_000));
  const capMs = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, consecutiveHeartbeatFailures - 1)));
  const floorMs = Math.max(HEARTBEAT_MS, Math.floor(capMs / 2));
  return floorMs + Math.floor(Math.random() * Math.max(1, capMs - floorMs + 1));
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

async function syncWorkerSecrets(): Promise<void> {
  const requiredDescription = 'CryptoCrawler treasury worker secret synchronized from Railway runtime';
  const optionalDescription = 'CryptoCrawler optional treasury worker secret synchronized from Railway runtime';
  const secrets: VaultSecretSpec[] = [
    { name: 'cryptocrawler_okx_api_key', value: (process.env.OKX_API_KEY || '').trim(), optional: false, description: requiredDescription },
    { name: 'cryptocrawler_okx_api_secret', value: (process.env.OKX_API_SECRET || '').trim(), optional: false, description: requiredDescription },
    { name: 'cryptocrawler_okx_api_passphrase', value: (process.env.OKX_API_PASSPHRASE || '').trim(), optional: false, description: requiredDescription },
    { name: 'cryptocrawler_profit_wallet', value: DESTINATION, optional: false, description: requiredDescription },
    { name: 'cryptocrawler_supabase_url', value: (process.env.SUPABASE_URL || '').trim(), optional: false, description: requiredDescription },
    { name: 'cryptocrawler_supabase_service_key', value: (process.env.SUPABASE_SERVICE_KEY || '').trim(), optional: false, description: requiredDescription },
    { name: 'cryptocrawler_fallback_wallet', value: FALLBACK_DESTINATION, optional: true, description: optionalDescription },
  ];

  // Resolve all current Vault ids in one acquisition rather than one SELECT per
  // secret. Writes remain serialized so Vault mutation load is bounded and a
  // partially failed sync can safely retry from durable state on the next beat.
  const existing = await highPriorityQuery(
    'SELECT id, name FROM vault.secrets WHERE name = ANY($1::text[])',
    [secrets.map(secret => secret.name)],
  );
  const ids = new Map<string, string>(
    existing.rows
      .filter(row => row?.name && row?.id)
      .map(row => [String(row.name), String(row.id)]),
  );

  for (const secret of secrets) {
    const id = ids.get(secret.name) || '';
    if (id) {
      // Preserve the prior optional-secret rule: an existing fallback is updated
      // even to an empty value so stale fallback authority cannot survive config.
      if (!secret.optional && !secret.value) continue;
      await highPriorityQuery('SELECT vault.update_secret($1::uuid, $2, $3, $4)', [
        id, secret.value, secret.name, secret.description,
      ]);
      continue;
    }

    if (!secret.value) continue;
    await highPriorityQuery('SELECT vault.create_secret($1, $2, $3)', [
      secret.value, secret.name, secret.description,
    ]);
  }
}

/**
 * Read the pre-heartbeat treasury state and apply the permitted successor update
 * in one PostgreSQL round trip. The state CTE is materialized and row-locked so
 * the returned value remains the state observed before a possible SWEPT->RUNNING
 * transition; sweep/manual-review states are read but never heartbeat-updated.
 */
async function heartbeatTreasuryState(): Promise<TreasuryState> {
  const result = await highPriorityQuery(
    `WITH state AS MATERIALIZED (
       SELECT desired_state
       FROM public.cryptocrawler_terminal_sweep_control
       WHERE system_key=$1
       FOR UPDATE
     ), updated AS (
       UPDATE public.cryptocrawler_terminal_sweep_control AS control
       SET desired_state = CASE WHEN state.desired_state='SWEPT' THEN 'RUNNING' ELSE control.desired_state END,
           terminal_epoch = CASE WHEN state.desired_state='SWEPT' THEN NULL ELSE control.terminal_epoch END,
           terminal_detection_not_before = CASE WHEN state.desired_state='SWEPT' THEN NULL ELSE control.terminal_detection_not_before END,
           intent_source = CASE WHEN state.desired_state='SWEPT' THEN 'successor_after_confirmed_restart_sweep' ELSE control.intent_source END,
           active_successor_deployment_id=NULLIF($2,''),
           last_observed_deployment_id=NULLIF($2,''),
           last_observed_deployment_status='SUCCESS',
           last_seen_active_at=now(),
           destination_address=COALESCE(NULLIF($3,''), control.destination_address),
           last_error = CASE WHEN state.desired_state='SWEPT' THEN NULL ELSE control.last_error END,
           updated_at=now()
       FROM state
       WHERE control.system_key=$1
         AND state.desired_state IN ('RUNNING','SWEPT')
       RETURNING state.desired_state AS prior_state
     )
     SELECT prior_state AS desired_state FROM updated
     UNION ALL
     SELECT desired_state FROM state WHERE desired_state NOT IN ('RUNNING','SWEPT')
     LIMIT 1`,
    [SYSTEM_KEY, RAILWAY_DEPLOYMENT_ID, DESTINATION],
  );
  return String(result.rows[0]?.desired_state || 'RUNNING') as TreasuryState;
}

async function heartbeatOnce(): Promise<void> {
  if (!isDatabaseConfigured || Date.now() < heartbeatDegradedUntil) return;
  if (heartbeatInFlight) return heartbeatInFlight;

  heartbeatInFlight = (async () => {
    try {
      // Secret synchronization is part of the durable heartbeat rather than a
      // one-shot startup precondition. A transient Supabase timeout therefore
      // cannot permanently leave the independent worker without current Railway
      // credentials or the WALLET_PRIVATE_KEY-derived public fallback address.
      if (!workerSecretsSynchronized) {
        await syncWorkerSecrets();
        workerSecretsSynchronized = true;
      }

      const state = await heartbeatTreasuryState();

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

      // RUNNING is heartbeated in the same query. SWEPT is atomically reopened to
      // RUNNING by that query before this barrier is cleared.
      setTreasuryRestartSweepBarrier(false);
      consecutiveHeartbeatFailures = 0;
      heartbeatDegradedUntil = 0;
    } catch (error) {
      workerSecretsSynchronized = false;
      consecutiveHeartbeatFailures += 1;
      heartbeatDegradedUntil = Date.now() + databaseBackoffMs();
      throw error;
    }
  })().finally(() => { heartbeatInFlight = null; });

  return heartbeatInFlight;
}

function logHeartbeatFailure(error: unknown): void {
  logger.warn('[Treasury] Lifecycle heartbeat deferred', {
    component: 'TerminalTreasuryLifecycle',
    error: error instanceof Error ? error.message : String(error),
    consecutiveHeartbeatFailures,
    databaseRetryNotBeforeMs: Math.max(0, heartbeatDegradedUntil - Date.now()),
    workerSecretsSynchronized,
  });
}

function nextHeartbeatDelayMs(): number {
  return Math.max(HEARTBEAT_MS, heartbeatDegradedUntil - Date.now());
}

function scheduleHeartbeat(): void {
  if (!lifecycleStarted || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void heartbeatOnce()
      .catch(logHeartbeatFailure)
      .finally(() => scheduleHeartbeat());
  }, nextHeartbeatDelayMs());
  timer.unref?.();
}

export async function ensureTerminalTreasuryLifecycle(): Promise<void> {
  if (!isDatabaseConfigured || lifecycleStarted) return;
  lifecycleStarted = true;
  if (!DESTINATION) {
    logger.warn('[Treasury] MetaMask payout wallet is not configured; payouts and restart drain fail closed', {
      component: 'TerminalTreasuryLifecycle', destinationVariable: 'CRYPTO_PROFIT_WALLET_ADDRESS',
    });
  }

  if (!signalInstalled && RAILWAY_DEPLOYMENT_ID) {
    process.prependListener('SIGTERM', sigtermCandidateListener);
    signalInstalled = true;
  }

  // Perform one startup proof, then schedule only after completion. A transient
  // outage cannot permanently disable retry, and a slow query cannot overlap a
  // second heartbeat or generate periodic no-op pressure during its backoff.
  await heartbeatOnce().catch(logHeartbeatFailure);
  scheduleHeartbeat();

  logger.info('[Treasury] Persistent treasury lifecycle online', {
    component: 'TerminalTreasuryLifecycle',
    deploymentIdPresent: Boolean(RAILWAY_DEPLOYMENT_ID),
    serviceIdPresent: Boolean(RAILWAY_SERVICE_ID),
    environmentIdPresent: Boolean(RAILWAY_ENVIRONMENT_ID),
    terminalPayoutConfigured: Boolean(DESTINATION),
    fallbackPayoutConfigured: Boolean(FALLBACK_DESTINATION),
    fallbackDerivedFromCanonicalExecutionWallet: Boolean(FALLBACK_DESTINATION),
    workerSecretSynchronizationRetryable: true,
    workerSecretsSynchronized,
    terminalGraceSeconds: TERMINAL_GRACE_SECONDS,
    steadyHeartbeatMs: HEARTBEAT_MS,
    heartbeatScheduling: 'completion_aware_one_shot',
    runtimePolicy: 'first_three_fixed_60_percent_then_persisted_dynamic_55_to_65_percent_eth_payout_remainder_retained_restart_drains_remaining_treasury',
    successorCancelsRestartSweep: false,
    successorNewExposureBlockedDuringSweep: true,
    settlementHedgeFlatteningStillAllowed: true,
    singlePayoutAuthority: 'supabase_worker_okx_only',
    fallbackActivation: 'confirmed_primary_withdrawal_terminal_failure_only',
    staleFallbackSecretAllowed: false,
    steadyHeartbeatRoundTrips: 1,
    vaultLookupRoundTripsPerSync: 1,
  });
}

export async function markTerminalSweepCandidate(signal: string): Promise<void> {
  if (!isDatabaseConfigured || signal !== 'SIGTERM' || !RAILWAY_DEPLOYMENT_ID) return;
  await criticalPriorityQuery(
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
  lifecycleStarted = false;
  if (timer) clearTimeout(timer);
  timer = null;
  workerSecretsSynchronized = false;
  if (signalInstalled) {
    process.removeListener('SIGTERM', sigtermCandidateListener);
    signalInstalled = false;
  }
}
