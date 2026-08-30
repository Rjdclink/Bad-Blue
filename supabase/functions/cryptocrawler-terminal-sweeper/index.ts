import {
  SYSTEM_KEY, type Control,
  supabase, supabaseUrl, serviceRole,
  nowIso, loadSecrets, loadControl, claimWorker, releaseWorker,
} from './shared.ts';
import { processPerTradePayouts } from './payouts.ts';
import { runTerminalSweep } from './terminal.ts';

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function requiresManualWithdrawalConfiguration(message: string): boolean {
  return /58207|58239|withdrawal permission requires manual review|not whitelisted|private wallet via api/i.test(message);
}

Deno.serve(async () => {
  const owner = crypto.randomUUID();
  try {
    if (!supabaseUrl || !serviceRole) return response({ ok: false, reason: 'Supabase runtime credentials unavailable' }, 503);
    if (!await claimWorker(owner)) return response({ ok: true, action: 'worker_busy' });

    const secrets = await loadSecrets();
    let control = await loadControl();

    // Every invocation first processes/reconciles due per-terminal-trade payouts.
    // A new terminal settlement wakes this worker immediately; pg_cron remains the
    // independent recovery loop if Railway or the immediate wake disappears.
    const payouts = await processPerTradePayouts(secrets, control);
    control = await loadControl();

    if (control.desired_state === 'RUNNING') {
      return response({ ok: true, state: 'RUNNING', action: 'per_trade_eth_payouts', payouts });
    }
    if (control.desired_state === 'SWEPT' || control.desired_state === 'MANUAL_REVIEW') {
      return response({ ok: true, state: control.desired_state, action: 'none', payouts });
    }

    if (control.desired_state === 'TERMINATE_AND_SWEEP') {
      const notBefore = control.terminal_detection_not_before
        ? new Date(control.terminal_detection_not_before).getTime()
        : Number.POSITIVE_INFINITY;
      if (Date.now() < notBefore) return response({ ok: true, state: control.desired_state, action: 'grace_window', payouts });

      // A successor Railway process is allowed to stay alive for settlement and
      // recovery, but TerminalTreasuryLifecycle keeps its NEW-exposure barrier
      // armed and intentionally does not refresh last_seen_active_at while this
      // state is pending. Never cancel or defer the prior deployment's drain just
      // because the successor process is healthy.
      const { data: claimed, error: claimError } = await supabase.from('cryptocrawler_terminal_sweep_control').update({
        desired_state: 'SWEEPING', sweep_started_at: nowIso(), last_error: null, updated_at: nowIso(),
      }).eq('system_key', SYSTEM_KEY)
        .eq('desired_state', 'TERMINATE_AND_SWEEP')
        .eq('terminal_epoch', control.terminal_epoch)
        .select().maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) return response({ ok: true, state: 'claim_lost', action: 'none', payouts });
      control = claimed as Control;
    }

    if (control.desired_state === 'SWEEPING') {
      return response({ ok: true, state: 'SWEEPING', payouts, ...(await runTerminalSweep(secrets, control)) });
    }
    return response({ ok: true, state: control.desired_state, action: 'none', payouts });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const manual = requiresManualWithdrawalConfiguration(message);
      await supabase.from('cryptocrawler_terminal_sweep_control')
        .update({
          ...(manual ? { desired_state: 'MANUAL_REVIEW' } : {}),
          last_error: message.slice(0, 1000),
          updated_at: nowIso(),
        })
        .eq('system_key', SYSTEM_KEY)
        .in('desired_state', ['TERMINATE_AND_SWEEP', 'SWEEPING']);
    } catch { /* leave durable state for next worker invocation */ }
    return response({ ok: false, error: message }, 500);
  } finally {
    await releaseWorker(owner);
  }
});