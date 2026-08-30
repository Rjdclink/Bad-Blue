import {
  PAYOUT_QUOTES, SYSTEM_KEY, TERMINAL_DUST_EPSILON,
  type Control, type Leg, type Secrets,
  finite, floorPrecision, nowIso, deterministicId, sha256Hex, supabase,
} from './shared.ts';
import {
  ensureTransfer, findOrder, findWithdrawal, getEthRoute, getFundingBalances,
  getTickerPrice, getTradingBalances, placeMarketOrder, spotInstrumentExists,
  submitEthWithdrawal, waitOrderTerminal,
} from './okx.ts';

async function terminalMarketOrder(
  secrets: Secrets,
  epoch: string,
  instId: string,
  side: 'buy' | 'sell',
  amount: number,
  tgtCcy: 'base_ccy' | 'quote_ccy',
): Promise<boolean> {
  const clientId = await deterministicId(`terminal:${epoch}:order:${instId}:${side}`);
  let order = await findOrder(secrets, instId, null, clientId);
  let orderId = String(order?.ordId || '');
  if (!orderId) orderId = await placeMarketOrder(secrets, instId, side, amount, tgtCcy, clientId);
  order = await waitOrderTerminal(secrets, instId, orderId);
  return String(order?.state || '').toLowerCase() === 'filled';
}

async function terminalTransfer(
  secrets: Secrets,
  epoch: string,
  ccy: string,
  amount: number,
  from: '6' | '18',
  to: '6' | '18',
): Promise<boolean> {
  if (!(amount > TERMINAL_DUST_EPSILON)) return true;
  const result = await ensureTransfer(secrets, `terminal:${epoch}:transfer:${ccy}:${from}:${to}`, ccy, amount, from, to);
  return result.done;
}

async function consolidateOkxToEth(secrets: Secrets, epoch: string): Promise<{ ready: boolean; blockers: string[] }> {
  const blockers: string[] = [];

  // Funding assets cannot be traded. Move every non-ETH asset into Trading first.
  const funding = await getFundingBalances(secrets);
  for (const [asset, available] of Object.entries(funding)) {
    if (asset === 'ETH' || !(available > TERMINAL_DUST_EPSILON)) continue;
    try {
      if (!await terminalTransfer(secrets, epoch, asset, available, '6', '18')) blockers.push(`funding_transfer_pending:${asset}`);
    } catch (error) {
      blockers.push(`funding_transfer_failed:${asset}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (blockers.length > 0) return { ready: false, blockers };

  // Convert every non-ETH/non-stable trading asset through a real live OKX pair.
  let trading = await getTradingBalances(secrets);
  for (const [asset, available] of Object.entries(trading)) {
    if (asset === 'ETH' || PAYOUT_QUOTES.includes(asset as any) || !(available > TERMINAL_DUST_EPSILON)) continue;
    let sold = false;
    for (const quote of PAYOUT_QUOTES) {
      const instId = `${asset}-${quote}`;
      if (!await spotInstrumentExists(instId)) continue;
      try { sold = await terminalMarketOrder(secrets, epoch, instId, 'sell', available, 'base_ccy'); }
      catch (error) { blockers.push(`asset_conversion_failed:${asset}:${error instanceof Error ? error.message : String(error)}`); }
      if (sold) break;
    }
    if (!sold && !blockers.some(item => item.startsWith(`asset_conversion_failed:${asset}:`))) {
      blockers.push(`no_live_okx_spot_conversion_path:${asset}`);
    }
  }
  if (blockers.length > 0) return { ready: false, blockers };

  // Terminal policy intentionally drains the remaining 40%/operating treasury too.
  trading = await getTradingBalances(secrets, ['ETH', ...PAYOUT_QUOTES]);
  for (const quote of PAYOUT_QUOTES) {
    const available = trading[quote] || 0;
    if (!(available > TERMINAL_DUST_EPSILON)) continue;
    try {
      if (!await terminalMarketOrder(secrets, epoch, `ETH-${quote}`, 'buy', available, 'quote_ccy')) {
        blockers.push(`stable_conversion_pending:${quote}`);
      }
    } catch (error) {
      blockers.push(`stable_conversion_failed:${quote}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (blockers.length > 0) return { ready: false, blockers };

  trading = await getTradingBalances(secrets);
  const residual = Object.entries(trading).filter(([asset, amount]) => asset !== 'ETH' && amount > TERMINAL_DUST_EPSILON);
  blockers.push(...residual.map(([asset]) => `residual_trading_asset:${asset}`));
  return { ready: blockers.length === 0, blockers };
}

async function reconcileTerminalLeg(secrets: Secrets, leg: Leg): Promise<Leg> {
  if (leg.status !== 'SUBMITTED') return leg;
  const record = await findWithdrawal(secrets, leg.withdrawal_id, leg.client_id);
  if (!record) return leg;
  const withdrawalId = String(record.wdId || leg.withdrawal_id || '');
  const state = String(record.state ?? '');
  const txId = String(record.txId || '').trim();
  if (state === '2' && txId) {
    const { data, error } = await supabase.from('cryptocrawler_terminal_sweep_legs').update({
      status: 'CONFIRMED', withdrawal_id: withdrawalId, transaction_hash: txId,
      confirmed_at: nowIso(), last_error: null, updated_at: nowIso(),
    }).eq('leg_id', leg.leg_id).select().single();
    if (error) throw error;
    return data as Leg;
  }
  if (state.startsWith('-')) {
    const { data, error } = await supabase.from('cryptocrawler_terminal_sweep_legs').update({
      status: 'RETRYABLE', withdrawal_id: withdrawalId || null,
      last_error: `OKX terminal ETH withdrawal failure state ${state}`, updated_at: nowIso(),
    }).eq('leg_id', leg.leg_id).select().single();
    if (error) throw error;
    return data as Leg;
  }
  return leg;
}

async function submitTerminalEth(secrets: Secrets, epoch: string): Promise<Leg | null> {
  const route = await getEthRoute(secrets);
  const trading = await getTradingBalances(secrets, ['ETH']);
  if ((trading.ETH || 0) > TERMINAL_DUST_EPSILON && !await terminalTransfer(secrets, epoch, 'ETH', trading.ETH, '18', '6')) return null;

  const funding = await getFundingBalances(secrets, ['ETH']);
  const amount = floorPrecision(Math.max(0, (funding.ETH || 0) - route.feeEth), route.precision);
  if (amount < route.minWithdrawalEth) return null;
  if (route.maxWithdrawalEth > 0 && amount > route.maxWithdrawalEth) {
    throw new Error(`Terminal ETH amount ${amount} exceeds authenticated single-withdrawal max ${route.maxWithdrawalEth}`);
  }

  const clientId = await deterministicId(`terminal:${epoch}:okx:ETH:${route.chain}`);
  const destinationHash = (await sha256Hex(secrets.destination.toLowerCase())).slice(0, 16);
  const { error: upsertError } = await supabase.from('cryptocrawler_terminal_sweep_legs').upsert({
    terminal_epoch: epoch, venue: 'okx', asset: 'ETH', chain: route.chain,
    status: 'PREPARED', client_id: clientId, amount, fee: route.feeEth,
    destination_hash: destinationHash, updated_at: nowIso(),
  }, { onConflict: 'terminal_epoch,venue,asset', ignoreDuplicates: true });
  if (upsertError) throw upsertError;

  const { data, error } = await supabase.from('cryptocrawler_terminal_sweep_legs')
    .select('*').eq('terminal_epoch', epoch).eq('venue', 'okx').eq('asset', 'ETH').single();
  if (error) throw error;
  let leg = data as Leg;
  if (leg.status === 'CONFIRMED' || leg.status === 'MANUAL_REVIEW') return leg;
  if (leg.status === 'SUBMITTED') return reconcileTerminalLeg(secrets, leg);

  const recovered = await findWithdrawal(secrets, leg.withdrawal_id, clientId);
  if (recovered?.wdId) {
    const { data: updated, error: updateError } = await supabase.from('cryptocrawler_terminal_sweep_legs').update({
      status: 'SUBMITTED', withdrawal_id: String(recovered.wdId), updated_at: nowIso(), last_error: null,
    }).eq('leg_id', leg.leg_id).select().single();
    if (updateError) throw updateError;
    return reconcileTerminalLeg(secrets, updated as Leg);
  }

  await supabase.from('cryptocrawler_terminal_sweep_legs').update({
    status: 'SUBMITTED', attempt_count: Number((data as any).attempt_count || 0) + 1,
    submitted_at: nowIso(), updated_at: nowIso(), last_error: null,
  }).eq('leg_id', leg.leg_id);

  try {
    const withdrawalId = await submitEthWithdrawal(secrets, route, amount, clientId);
    const { data: updated, error: updateError } = await supabase.from('cryptocrawler_terminal_sweep_legs').update({
      withdrawal_id: withdrawalId, updated_at: nowIso(), last_error: null,
    }).eq('leg_id', leg.leg_id).select().single();
    if (updateError) throw updateError;
    leg = updated as Leg;
  } catch (error) {
    const ambiguous = await findWithdrawal(secrets, null, clientId);
    if (!ambiguous?.wdId) throw error;
    const { data: updated, error: updateError } = await supabase.from('cryptocrawler_terminal_sweep_legs').update({
      withdrawal_id: String(ambiguous.wdId), updated_at: nowIso(), last_error: null,
    }).eq('leg_id', leg.leg_id).select().single();
    if (updateError) throw updateError;
    leg = updated as Leg;
  }
  return reconcileTerminalLeg(secrets, leg);
}

async function terminalResidualBlockers(secrets: Secrets): Promise<string[]> {
  const [trading, funding] = await Promise.all([getTradingBalances(secrets), getFundingBalances(secrets)]);
  const blockers: string[] = [];
  for (const [asset, amount] of Object.entries(trading)) if (amount > TERMINAL_DUST_EPSILON) blockers.push(`trading:${asset}`);
  const route = await getEthRoute(secrets).catch(() => null);
  for (const [asset, amount] of Object.entries(funding)) {
    if (!(amount > TERMINAL_DUST_EPSILON)) continue;
    if (asset === 'ETH' && route && amount <= route.feeEth + route.minWithdrawalEth) continue;
    blockers.push(`funding:${asset}`);
  }
  return blockers;
}

export async function runTerminalSweep(secrets: Secrets, control: Control): Promise<Record<string, unknown>> {
  const epoch = control.terminal_epoch;
  if (!epoch) throw new Error('Terminal sweep state is missing terminal_epoch');

  const { count: inFlight, error: inFlightError } = await supabase.from('cryptocrawler_profit_payout_jobs')
    .select('event_id', { head: true, count: 'exact' }).in('status', ['CONVERTING', 'WITHDRAWING', 'SUBMITTED']);
  if (inFlightError) throw inFlightError;
  if ((inFlight || 0) > 0) return { epoch, action: 'wait_for_per_trade_payout_reconciliation', inFlight };

  const consolidation = await consolidateOkxToEth(secrets, epoch);
  if (!consolidation.ready) {
    await supabase.from('cryptocrawler_terminal_sweep_control').update({
      desired_state: 'MANUAL_REVIEW',
      last_error: `Terminal ETH consolidation blocked: ${consolidation.blockers.join('; ')}`.slice(0, 1000),
      updated_at: nowIso(),
    }).eq('system_key', SYSTEM_KEY).eq('terminal_epoch', epoch);
    return { epoch, action: 'manual_review', blockers: consolidation.blockers };
  }

  const leg = await submitTerminalEth(secrets, epoch);
  if (leg && leg.status !== 'CONFIRMED') return { epoch, action: 'terminal_eth_withdrawal_pending', legStatus: leg.status };

  const residual = await terminalResidualBlockers(secrets);
  if (residual.length > 0) return { epoch, action: 'terminal_residuals_remain', residual };

  const ethUsd = await getTickerPrice('ETH-USDT').catch(() => 0);
  const confirmedValueUsd = leg?.status === 'CONFIRMED' ? finite(leg.amount) * ethUsd : 0;
  const { error } = await supabase.from('cryptocrawler_terminal_sweep_control').update({
    desired_state: 'SWEPT', swept_value_usd: confirmedValueUsd, sweep_completed_at: nowIso(),
    worker_lease_owner: null, worker_lease_until: null, last_error: null, updated_at: nowIso(),
  }).eq('system_key', SYSTEM_KEY).eq('terminal_epoch', epoch);
  if (error) throw error;
  await supabase.rpc('cryptocrawler_terminal_sweep_finalize_events', { p_epoch: epoch });
  return { epoch, action: 'terminal_eth_sweep_confirmed', transactionHashPresent: Boolean(leg?.transaction_hash) };
}
