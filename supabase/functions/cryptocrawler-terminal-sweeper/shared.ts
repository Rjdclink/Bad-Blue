import { createClient } from 'npm:@supabase/supabase-js@2.84.0';

export const SYSTEM_KEY = 'cryptocrawler';
export const PAYOUT_QUOTES = ['USDT', 'USDC'] as const;
export const WORKER_LEASE_SECONDS = 120;
export const MAX_PAYOUT_JOBS_PER_RUN = 20;
export const MAX_CONVERSION_SLIPPAGE_PCT = 0.005;
export const TERMINAL_DUST_EPSILON = 1e-10;

export type TreasuryState = 'RUNNING' | 'TERMINATE_AND_SWEEP' | 'SWEEPING' | 'SWEPT' | 'MANUAL_REVIEW';
export type PayoutStatus = 'QUEUED' | 'CONVERTING' | 'WITHDRAWING' | 'SUBMITTED' | 'CONFIRMED' | 'RETRYABLE' | 'MANUAL_REVIEW' | 'TERMINAL_SWEPT';
export type LegStatus = 'PREPARED' | 'SUBMITTED' | 'CONFIRMED' | 'RETRYABLE' | 'MANUAL_REVIEW';

export type Control = {
  desired_state: TreasuryState;
  terminal_epoch: string | null;
  terminal_detection_not_before: string | null;
  last_seen_active_at: string | null;
  retained_profit_usd: number | string;
};

export type PayoutJob = {
  event_id: string;
  opportunity_id: string | null;
  realized_profit_usd: number | string;
  payout_target_usd: number | string;
  retained_target_usd: number | string;
  payout_asset: 'ETH';
  payout_network: 'ethereum';
  status: PayoutStatus;
  source_venue: string | null;
  quote_asset: string | null;
  conversion_client_id: string | null;
  conversion_trade_id: string | null;
  conversion_quote_spent: number | string | null;
  conversion_eth_acquired: number | string | null;
  conversion_price_usd: number | string | null;
  transfer_client_id: string | null;
  transfer_id: string | null;
  payout_amount_eth: number | string | null;
  payout_fee_eth: number | string | null;
  payout_operating_cost_usd: number | string;
  withdrawal_client_id: string | null;
  withdrawal_id: string | null;
  transaction_hash: string | null;
  destination_hash: string;
  attempt_count: number;
  last_attempt_at: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type Leg = {
  leg_id: string;
  terminal_epoch: string;
  venue: string;
  asset: string;
  chain: string | null;
  status: LegStatus;
  client_id: string;
  amount: number | string | null;
  fee: number | string | null;
  withdrawal_id: string | null;
  transaction_hash: string | null;
  submitted_at: string | null;
};

export type Secrets = { apiKey: string; apiSecret: string; passphrase: string; destination: string };
export type EthRoute = { chain: string; feeEth: number; minWithdrawalEth: number; maxWithdrawalEth: number; precision: number };

export const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
export const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
export const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

export function finite(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function positive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function bool(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === 'true';
}

export function nowIso(): string { return new Date().toISOString(); }
export function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
export function round(value: number, digits = 12): number { return Number(value.toFixed(digits)); }
export function floorPrecision(value: number, precision: number): number {
  const factor = 10 ** Math.max(0, Math.min(12, precision));
  return Math.floor((value + Number.EPSILON) * factor) / factor;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function deterministicId(value: string): Promise<string> {
  return (await sha256Hex(value)).slice(0, 32);
}

async function readSecret(name: string): Promise<string> {
  const { data, error } = await supabase.rpc('cryptocrawler_terminal_sweep_secret', { p_name: name });
  if (error) throw new Error(`vault secret ${name} unavailable: ${error.message}`);
  return String(data || '').trim();
}

export async function loadSecrets(): Promise<Secrets> {
  const [apiKey, apiSecret, passphrase, destination] = await Promise.all([
    readSecret('cryptocrawler_okx_api_key'),
    readSecret('cryptocrawler_okx_api_secret'),
    readSecret('cryptocrawler_okx_api_passphrase'),
    readSecret('cryptocrawler_profit_wallet'),
  ]);
  if (!apiKey || !apiSecret || !passphrase) throw new Error('OKX treasury credentials are not synchronized');
  if (!/^0x[0-9a-fA-F]{40}$/.test(destination)) throw new Error('MetaMask payout wallet is missing or invalid');
  return { apiKey, apiSecret, passphrase, destination };
}

export async function updateJob(eventId: string, patch: Record<string, unknown>): Promise<PayoutJob> {
  const { data, error } = await supabase.from('cryptocrawler_profit_payout_jobs')
    .update({ ...patch, updated_at: nowIso() }).eq('event_id', eventId).select('*').single();
  if (error) throw error;
  return data as PayoutJob;
}

export async function loadControl(): Promise<Control> {
  const { data, error } = await supabase.from('cryptocrawler_terminal_sweep_control')
    .select('*').eq('system_key', SYSTEM_KEY).single();
  if (error) throw error;
  return data as Control;
}

export async function claimWorker(owner: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('cryptocrawler_treasury_worker_claim', {
    p_owner: owner, p_lease_seconds: WORKER_LEASE_SECONDS,
  });
  if (error) throw error;
  return data === true;
}

export async function releaseWorker(owner: string): Promise<void> {
  try { await supabase.rpc('cryptocrawler_treasury_worker_release', { p_owner: owner }); } catch { /* lease expires */ }
}
