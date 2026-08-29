import { createClient } from 'npm:@supabase/supabase-js@2.84.0';

const SYSTEM_KEY = 'cryptocrawler';
const OKX_BASE_URL = 'https://us.okx.com';
const ASSETS = ['USDT', 'USDC'] as const;
const NETWORK_PREFERENCE = ['arbitrum', 'base', 'optimism', 'polygon', 'bsc', 'erc20', 'ethereum'];

type Control = {
  desired_state: 'RUNNING' | 'TERMINATE_AND_SWEEP' | 'SWEEPING' | 'SWEPT' | 'MANUAL_REVIEW';
  terminal_epoch: string | null;
  terminal_detection_not_before: string | null;
  last_seen_active_at: string | null;
  retained_profit_usd: number | string;
};

type Leg = {
  leg_id: string;
  terminal_epoch: string;
  venue: string;
  asset: string;
  chain: string | null;
  status: 'PREPARED' | 'SUBMITTED' | 'CONFIRMED' | 'RETRYABLE' | 'MANUAL_REVIEW';
  client_id: string;
  amount: number | string | null;
  fee: number | string | null;
  withdrawal_id: string | null;
  transaction_hash: string | null;
  submitted_at: string | null;
};

type Secrets = {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  destination: string;
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function finite(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacBase64(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  let binary = '';
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function readSecret(name: string): Promise<string> {
  const { data, error } = await supabase.rpc('cryptocrawler_terminal_sweep_secret', { p_name: name });
  if (error) throw new Error(`vault secret ${name} unavailable: ${error.message}`);
  return String(data || '').trim();
}

async function loadSecrets(): Promise<Secrets> {
  const [apiKey, apiSecret, passphrase, destination] = await Promise.all([
    readSecret('cryptocrawler_okx_api_key'),
    readSecret('cryptocrawler_okx_api_secret'),
    readSecret('cryptocrawler_okx_api_passphrase'),
    readSecret('cryptocrawler_profit_wallet'),
  ]);
  if (!apiKey || !apiSecret || !passphrase) throw new Error('OKX terminal-sweep credentials are not synchronized');
  if (!/^0x[0-9a-fA-F]{40}$/.test(destination)) throw new Error('Terminal sweep wallet is missing or invalid');
  return { apiKey, apiSecret, passphrase, destination };
}

async function okxRequest(
  secrets: Secrets,
  path: string,
  method: 'GET' | 'POST',
  query: Record<string, string> = {},
  body?: Record<string, string>,
): Promise<any[]> {
  const search = new URLSearchParams(query).toString();
  const requestPath = `${path}${search ? `?${search}` : ''}`;
  const bodyText = body ? JSON.stringify(body) : '';
  const timestamp = new Date().toISOString();
  const sign = await hmacBase64(secrets.apiSecret, `${timestamp}${method}${requestPath}${bodyText}`);
  const result = await fetch(`${OKX_BASE_URL}${requestPath}`, {
    method,
    headers: {
      'OK-ACCESS-KEY': secrets.apiKey,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': secrets.passphrase,
      'Content-Type': 'application/json',
    },
    body: bodyText || undefined,
  });
  const json = await result.json().catch(() => ({}));
  if (!result.ok || String(json?.code ?? '0') !== '0') {
    throw new Error(`OKX ${method} ${path} failed (${result.status}/${String(json?.code ?? 'unknown')}): ${String(json?.msg ?? 'unknown error')}`);
  }
  return Array.isArray(json?.data) ? json.data : [];
}

function chainRank(chain: string): number {
  const normalized = chain.toLowerCase();
  const rank = NETWORK_PREFERENCE.findIndex(item => normalized.includes(item));
  return rank < 0 ? Number.MAX_SAFE_INTEGER : rank;
}

async function discoverRoute(secrets: Secrets, asset: typeof ASSETS[number]) {
  const [currencies, maxima] = await Promise.all([
    okxRequest(secrets, '/api/v5/asset/currencies', 'GET', { ccy: asset }),
    okxRequest(secrets, '/api/v5/account/max-withdrawal', 'GET', { ccy: asset }),
  ]);
  const maxWithdrawal = finite(maxima.find(item => String(item?.ccy || '').toUpperCase() === asset)?.maxWd);
  const routes = currencies
    .map(item => ({
      chain: String(item?.chain || ''),
      fee: finite(item?.fee),
      minWithdrawal: finite(item?.minWd),
      canWithdraw: item?.canWd === true || String(item?.canWd).toLowerCase() === 'true',
    }))
    .filter(route => route.chain && route.canWithdraw && chainRank(route.chain) < Number.MAX_SAFE_INTEGER)
    .sort((a, b) => a.fee - b.fee || chainRank(a.chain) - chainRank(b.chain));
  return { maxWithdrawal, route: routes[0] || null };
}

async function findHistory(secrets: Secrets, leg: Leg): Promise<any | null> {
  const query = leg.withdrawal_id ? { wdId: leg.withdrawal_id } : { clientId: leg.client_id };
  const history = await okxRequest(secrets, '/api/v5/asset/withdrawal-history', 'GET', query);
  return history.find(item => leg.withdrawal_id
    ? String(item?.wdId || '') === leg.withdrawal_id
    : String(item?.clientId || '') === leg.client_id) || null;
}

async function reconcileLeg(secrets: Secrets, leg: Leg): Promise<Leg> {
  if (leg.status !== 'SUBMITTED') return leg;
  try {
    const record = await findHistory(secrets, leg);
    if (!record) return leg;
    const withdrawalId = String(record?.wdId || leg.withdrawal_id || '');
    const state = String(record?.state ?? '');
    if (state === '2') {
      const { data, error } = await supabase.from('cryptocrawler_terminal_sweep_legs').update({
        status: 'CONFIRMED',
        withdrawal_id: withdrawalId || null,
        transaction_hash: String(record?.txId || '') || null,
        confirmed_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('leg_id', leg.leg_id).select().single();
      if (error) throw error;
      return data as Leg;
    }
    if (state === '-1' || state === '-2') {
      const { data, error } = await supabase.from('cryptocrawler_terminal_sweep_legs').update({
        status: 'RETRYABLE',
        withdrawal_id: withdrawalId || null,
        last_error: `OKX terminal withdrawal state ${state}`,
        updated_at: new Date().toISOString(),
      }).eq('leg_id', leg.leg_id).select().single();
      if (error) throw error;
      return data as Leg;
    }
    if (!leg.withdrawal_id && withdrawalId) {
      const { data, error } = await supabase.from('cryptocrawler_terminal_sweep_legs').update({
        withdrawal_id: withdrawalId,
        updated_at: new Date().toISOString(),
      }).eq('leg_id', leg.leg_id).select().single();
      if (error) throw error;
      return data as Leg;
    }
  } catch (error) {
    await supabase.from('cryptocrawler_terminal_sweep_legs').update({
      last_error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq('leg_id', leg.leg_id);
  }
  return leg;
}

async function submitAsset(secrets: Secrets, epoch: string, asset: typeof ASSETS[number]): Promise<void> {
  const { data: existing } = await supabase.from('cryptocrawler_terminal_sweep_legs')
    .select('*').eq('terminal_epoch', epoch).eq('venue', 'okx').eq('asset', asset).maybeSingle();
  if (existing) {
    const reconciled = await reconcileLeg(secrets, existing as Leg);
    if (reconciled.status === 'SUBMITTED' || reconciled.status === 'CONFIRMED' || reconciled.status === 'MANUAL_REVIEW') return;
    if (reconciled.status === 'RETRYABLE' && reconciled.submitted_at) {
      const age = Date.now() - new Date(reconciled.submitted_at).getTime();
      if (age < 120_000) return;
      const record = await findHistory(secrets, reconciled).catch(() => null);
      if (record) {
        await reconcileLeg(secrets, { ...reconciled, status: 'SUBMITTED' });
        return;
      }
    }
  }

  const { maxWithdrawal, route } = await discoverRoute(secrets, asset);
  if (!route) return;
  const amount = Number(Math.max(0, maxWithdrawal - route.fee).toFixed(6));
  if (amount < Math.max(route.minWithdrawal, 0.000001)) return;

  const clientId = (await sha256Hex(`cryptocrawler:${epoch}:okx:${asset}`)).slice(0, 32);
  const destinationHash = (await sha256Hex(secrets.destination.toLowerCase())).slice(0, 16);
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase.from('cryptocrawler_terminal_sweep_legs').upsert({
    terminal_epoch: epoch,
    venue: 'okx',
    asset,
    chain: route.chain,
    status: 'PREPARED',
    client_id: clientId,
    amount,
    fee: route.fee,
    destination_hash: destinationHash,
    updated_at: now,
  }, { onConflict: 'terminal_epoch,venue,asset', ignoreDuplicates: true }).select().maybeSingle();
  if (claimError) throw claimError;

  const { data: legRow, error: legError } = await supabase.from('cryptocrawler_terminal_sweep_legs')
    .select('*').eq('terminal_epoch', epoch).eq('venue', 'okx').eq('asset', asset).single();
  if (legError) throw legError;
  const leg = legRow as Leg;
  if (leg.status === 'SUBMITTED' || leg.status === 'CONFIRMED' || leg.status === 'MANUAL_REVIEW') return;

  await supabase.from('cryptocrawler_terminal_sweep_legs').update({
    status: 'SUBMITTED',
    attempt_count: (Number((legRow as any).attempt_count) || 0) + 1,
    submitted_at: now,
    last_error: null,
    updated_at: now,
  }).eq('leg_id', leg.leg_id);

  try {
    const data = await okxRequest(secrets, '/api/v5/asset/withdrawal', 'POST', {}, {
      amt: amount.toFixed(6),
      fee: String(route.fee),
      dest: '4',
      ccy: asset,
      chain: route.chain,
      toAddr: secrets.destination,
      clientId,
    });
    const withdrawalId = String(data[0]?.wdId || '');
    if (!withdrawalId) throw new Error('OKX accepted terminal withdrawal without wdId');
    await supabase.from('cryptocrawler_terminal_sweep_legs').update({
      withdrawal_id: withdrawalId,
      updated_at: new Date().toISOString(),
    }).eq('leg_id', leg.leg_id);
  } catch (error) {
    const record = await findHistory(secrets, { ...leg, status: 'SUBMITTED' }).catch(() => null);
    if (record?.wdId) {
      await supabase.from('cryptocrawler_terminal_sweep_legs').update({
        withdrawal_id: String(record.wdId),
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('leg_id', leg.leg_id);
      return;
    }
    await supabase.from('cryptocrawler_terminal_sweep_legs').update({
      last_error: `Ambiguous submission; reconcile before retry: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq('leg_id', leg.leg_id);
  }
  void claimed;
}

async function runSweep(control: Control): Promise<Record<string, unknown>> {
  const epoch = control.terminal_epoch;
  if (!epoch) throw new Error('Terminal sweep state is missing terminal_epoch');
  const secrets = await loadSecrets();

  for (const asset of ASSETS) await submitAsset(secrets, epoch, asset);

  const { data: legs, error } = await supabase.from('cryptocrawler_terminal_sweep_legs').select('*').eq('terminal_epoch', epoch);
  if (error) throw error;
  const reconciled: Leg[] = [];
  for (const leg of (legs || []) as Leg[]) reconciled.push(await reconcileLeg(secrets, leg));

  const stillPending = reconciled.some(leg => leg.status === 'SUBMITTED' || leg.status === 'PREPARED' || leg.status === 'RETRYABLE');
  const manual = reconciled.some(leg => leg.status === 'MANUAL_REVIEW');
  if (manual) {
    await supabase.from('cryptocrawler_terminal_sweep_control').update({
      desired_state: 'MANUAL_REVIEW',
      last_error: 'One or more terminal sweep legs require manual review',
      updated_at: new Date().toISOString(),
    }).eq('system_key', SYSTEM_KEY).eq('terminal_epoch', epoch);
  } else if (!stillPending) {
    const remaining = await Promise.all(ASSETS.map(asset => discoverRoute(secrets, asset).catch(() => ({ maxWithdrawal: 0, route: null }))));
    const withdrawableRemaining = remaining.some(item => item.route && item.maxWithdrawal > item.route.fee + item.route.minWithdrawal);
    if (!withdrawableRemaining) {
      const confirmedValue = reconciled.filter(leg => leg.status === 'CONFIRMED').reduce((sum, leg) => sum + finite(leg.amount), 0);
      await supabase.from('cryptocrawler_terminal_sweep_control').update({
        desired_state: 'SWEPT',
        swept_value_usd: confirmedValue,
        sweep_completed_at: new Date().toISOString(),
        worker_lease_owner: null,
        worker_lease_until: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('system_key', SYSTEM_KEY).eq('terminal_epoch', epoch);
      await supabase.rpc('cryptocrawler_terminal_sweep_finalize_events', { p_epoch: epoch });
    }
  }

  return { epoch, legs: reconciled.map(leg => ({ asset: leg.asset, status: leg.status, withdrawalIdPresent: Boolean(leg.withdrawal_id) })) };
}

Deno.serve(async () => {
  try {
    if (!supabaseUrl || !serviceRole) return response({ ok: false, reason: 'Supabase runtime credentials unavailable' }, 503);
    const { data, error } = await supabase.from('cryptocrawler_terminal_sweep_control').select('*').eq('system_key', SYSTEM_KEY).single();
    if (error) throw error;
    const control = data as Control;
    if (control.desired_state === 'RUNNING' || control.desired_state === 'SWEPT' || control.desired_state === 'MANUAL_REVIEW') {
      return response({ ok: true, state: control.desired_state, action: 'none' });
    }

    if (control.desired_state === 'TERMINATE_AND_SWEEP') {
      const notBefore = control.terminal_detection_not_before ? new Date(control.terminal_detection_not_before).getTime() : Number.POSITIVE_INFINITY;
      if (Date.now() < notBefore) return response({ ok: true, state: control.desired_state, action: 'grace_window' });
      const lastActive = control.last_seen_active_at ? new Date(control.last_seen_active_at).getTime() : 0;
      if (lastActive >= notBefore) return response({ ok: true, state: control.desired_state, action: 'active_runtime_evidence_blocks_sweep' });
      const { data: claimed, error: claimError } = await supabase.from('cryptocrawler_terminal_sweep_control').update({
        desired_state: 'SWEEPING',
        sweep_started_at: new Date().toISOString(),
        worker_lease_owner: crypto.randomUUID(),
        worker_lease_until: new Date(Date.now() + 120_000).toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('system_key', SYSTEM_KEY).eq('desired_state', 'TERMINATE_AND_SWEEP').eq('terminal_epoch', control.terminal_epoch).select().maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) return response({ ok: true, state: 'claim_lost', action: 'none' });
      return response({ ok: true, state: 'SWEEPING', ...(await runSweep(claimed as Control)) });
    }

    if (control.desired_state === 'SWEEPING') {
      return response({ ok: true, state: 'SWEEPING', ...(await runSweep(control)) });
    }
    return response({ ok: true, state: control.desired_state, action: 'none' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from('cryptocrawler_terminal_sweep_control').update({
      last_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq('system_key', SYSTEM_KEY).in('desired_state', ['TERMINATE_AND_SWEEP', 'SWEEPING']);
    return response({ ok: false, error: message }, 500);
  }
});
