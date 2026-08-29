import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';

const SYSTEM_KEY = 'cryptocrawler';
const HEARTBEAT_MS = 15_000;
const TERMINAL_GRACE_SECONDS = 180;
const RAILWAY_DEPLOYMENT_ID = (process.env.RAILWAY_DEPLOYMENT_ID || '').trim();
const RAILWAY_SERVICE_ID = (process.env.RAILWAY_SERVICE_ID || '').trim();
const RAILWAY_ENVIRONMENT_ID = (process.env.RAILWAY_ENVIRONMENT_ID || '').trim();
const DESTINATION = (process.env.CRYPTO_PROFIT_WALLET_ADDRESS || '').trim();

let timer: NodeJS.Timeout | null = null;
let heartbeatInFlight: Promise<void> | null = null;
let signalInstalled = false;

const sigtermCandidateListener = (): void => {
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

async function heartbeatOnce(): Promise<void> {
  if (!isDatabaseConfigured) return;
  if (heartbeatInFlight) return heartbeatInFlight;
  heartbeatInFlight = (async () => {
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
  })().finally(() => { heartbeatInFlight = null; });
  return heartbeatInFlight;
}

export async function ensureTerminalTreasuryLifecycle(): Promise<void> {
  if (!isDatabaseConfigured || timer) return;
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
    });
  }), HEARTBEAT_MS);
  timer.unref?.();
  logger.info('[Treasury] Persistent terminal-sweep lifecycle online', {
    component: 'TerminalTreasuryLifecycle',
    deploymentIdPresent: Boolean(RAILWAY_DEPLOYMENT_ID),
    serviceIdPresent: Boolean(RAILWAY_SERVICE_ID),
    environmentIdPresent: Boolean(RAILWAY_ENVIRONMENT_ID),
    terminalGraceSeconds: TERMINAL_GRACE_SECONDS,
    runtimePolicy: 'retain_and_compound',
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
}

export function stopTerminalTreasuryLifecycle(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (signalInstalled) {
    process.removeListener('SIGTERM', sigtermCandidateListener);
    signalInstalled = false;
  }
}
