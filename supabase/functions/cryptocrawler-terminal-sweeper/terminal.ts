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

function amountKey(amount: number): string {
  return Number(amount.toFixed(12)).toString();
}

function activeTerminalDestination(secrets: Secrets, leg: Leg): string {
  if (leg.destination_mode === 'fallback') {
    if (!secrets.fallbackDestination) throw new Error('Fallback restart-drain destination is armed but unavailable');
    return secrets.fallbackDestination;
  }
  return secrets.destination;
}

async function armTerminalFallback(secrets: Secrets, leg: Leg, withdrawalId: string, state: string): Promise<Leg> {
  const reason = `OKX terminal ETH withdrawal failure state ${state}`;
  if (leg.destination_mode === 'fallback' || !secrets.fallbackDestination) {
    const { data, error } = await supabase.from('cryptocrawler_terminal_sweep_legs').update({
      status: 'MANUAL_REVIEW',
      withdrawal_id: withdrawalId || leg.withdrawal_id,
      primary_failure_withdrawal_id: leg.primary_failure_withdrawal_id || (leg.destination_mode === 'primary' ? withdrawalId : null),
      primary_failure_at: leg.primary_failure_at || (leg.destination_mode === 'primary' ? nowIso() : null),
      primary_failure_reason: leg.primary_failure_reason || (leg.destination_mode === 'primary' ? reason : null),
      last_error: leg.destination_mode === 'fallback'
        ? `Fallback ${reason}; automatic destination failover exhausted`
        : `${reason}; no distinct Railway-derived fallback address is available`,
      updated_at: nowIso(),
    }).eq('leg_id', leg.leg_id).select().single();
    if (error) throw error;
    return data as Leg;
  }

  const fallbackClientId = await deterministicId(`terminal:${leg.terminal_epoch}:${leg.leg_id}:fallback:${secrets.fallbackDestination.toLowerCase()}`);
  const fallbackHash = (await sha256Hex(secrets.fallbackDestination.toLowerCase())).slice(0, 16);
  const { data, error } = await supabase.from('cryptocrawler_terminal_sweep_legs').update({
    status: 'RETRYABLE',
    destination_mode: 'fallback',
    destination_hash: fallbackHash,
    primary_failure_withdrawal_id: withdrawalId || leg.withdrawal_id,
    primary_failure_at: nowIso(),
    primary_failure_reason: reason,
    client_id: fallbackClientId,
    withdrawal_id: null,
    submitted_at: null,
    last_error: `${reason}; fallback destination armed after confirmed primary failure`,
    updated_at: nowIso(),
  }).eq('leg_id', leg.leg_id).select().single();
  if (error) throw error;
  return data as Leg;
}

async function terminalMarketOrder(
  secrets: Secrets,
  epoch: string,
  instId: string,
  side: 'buy' | 'sell',
  amount: number,
  tgtCcy: 'base_ccy' | 'quote_ccy',
): Promise<boolean> {
  const clientId = await deterministicId(`terminal:${epoch}:order:${instId}:${side}:${tgtCcy}:${amountKey(amount)}`);
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
  const result = await ensureTransfer(
    secrets,
    `terminal:${epoch}:transfer:${ccy}:${from}:${to}:${amountKey(amount)}`,
    ccy,
    amount,
    from,
    to,
  );
  return result.done;
}

async function consolidateOkxToEth(secrets: Secrets, epoch: string): Promise<{ ready: boolean; blockers: string[] }> {
  const blockers: string[] = [];

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

  let trading = await getTradingBalances(secrets);
  for (const [asset, available] of Object.entries(trading)) {
    if (asset === 'ETH' || PAYOUT_QUOTES.includes(asset as any) || !(available > TERMINAL_DUST_EPSILON)) continue;
    let sold = false;
    for (const quote of PAYOUT_QUOTES) {
      const instId = `${asset}-${quote}`;
      if (!await spotInstrumentExists(instId)) continue;
      try {
        sold = await terminalMarketOrder(secrets, epoch, instId, 'sell', available, 'base_ccy');
      } catch (error) {
        blockers.push(`asset_conversion_failed:${asset}:${error instanceof Error ? error.message : String(error)}`);
      }
      if (sold) break;
    }
    if (!sold && !blockers.some(item => item.startsWith(`asset_conversion_failed:${asset}:`))) {
      blockers.push(`no_live_okx_spot_conversion_path:${asset}`);
    }
  }
  if (blockers.length > 0) return { ready: false, blockers };

  // Restart/terminal policy drains the remaining operating treasury too. This is
  // intentionally separate from normal-runtime payouts, which convert only when due.
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
    return armTerminalFallback(secrets, leg, withdrawalId, state);
  }
  return leg;
}

async function existingTerminalLegs(epoch: string): Promise<Leg[]> {
  const { data, error } = await supabase.from('cryptocrawler_terminal_sweep_legs')
    .select('*').eq('terminal_epoch', epoch).eq('venue', 'okx').eq('asset', 'ETH')
    .order('leg_sequence', { ascending: true });
  if (error) throw error;
  return (data || []) as Leg[];
}

async function submitDurableTerminalLeg(secrets: Secrets, input: Leg): Promise<Leg> {
  let leg = input;
  if (leg.status === 'CONFIRMED' || leg.status === 'MANUAL_REVIEW') return leg;
  if (leg.status === 'SUBMITTED') return reconcileTerminalLeg(secrets, leg);

  const amount = finite(leg.amount);
  if (!(amount > 0)) throw new Error(`Terminal withdrawal leg ${leg.leg_id} has no positive amount`);
  const route = await getEthRoute(secrets);
  if (amount + 1e-12 < route.minWithdrawalEth) {
    throw new Error(`Terminal withdrawal leg ${leg.leg_id} is below the current authenticated minimum`);
  }
  if (route.maxWithdrawalEth > 0 && amount > route.maxWithdrawalEth + 1e-12) {
    throw new Error(`Terminal withdrawal leg ${leg.leg_id} exceeds the current authenticated maximum`);
  }

  const recovered = await findWithdrawal(secrets, leg.withdrawal_id, leg.client_id);
  if (recovered?.wdId) {
    const { data, error } = await supabase.from('cryptocrawler_terminal_sweep_legs').update({
      status: 'SUBMITTED', withdrawal_id: String(recovered.wdId), last_error: null, updated_at: nowIso(),
    }).eq('leg_id', leg.leg_id).select().single();
    if (error) throw error;
    return reconcileTerminalLeg(secrets, data as Leg);
  }

  const { data: submitted, error: submittedStateError } = await supabase.from('cryptocrawler_terminal_sweep_legs').update({
    status: 'SUBMITTED', attempt_count: Number((leg as any).attempt_count || 0) + 1,
    submitted_at: nowIso(), updated_at: nowIso(), last_error: null,
  }).eq('leg_id', leg.leg_id).select().single();
  if (submittedStateError) throw submittedStateError;
  leg = submitted as Leg;

  const destination = activeTerminalDestination(secrets, leg);
  try {
    const withdrawalId = await submitEthWithdrawal(secrets, route, amount, leg.client_id, destination);
    const { data, error } = await supabase.from('cryptocrawler_terminal_sweep_legs').update({
      withdrawal_id: withdrawalId, updated_at: nowIso(), last_error: null,
    }).eq('leg_id', leg.leg_id).select().single();
    if (error) throw error;
    leg = data as Leg;
  } catch (error) {
    const ambiguous = await findWithdrawal(secrets, null, leg.client_id);
    if (!ambiguous?.wdId) {
      await supabase.from('cryptocrawler_terminal_sweep_legs').update({
        status: 'RETRYABLE', last_error: (error instanceof Error ? error.message : String(error)).slice(0, 1000), updated_at: nowIso(),
      }).eq('leg_id', leg.leg_id);
      throw error;
    }
    const { data, error: updateError } = await supabase.from('cryptocrawler_terminal_sweep_legs').update({
      withdrawal_id: String(ambiguous.wdId), updated_at: nowIso(), last_error: null,
    }).eq('leg_id', leg.leg_id).select().single();
    if (updateError) throw updateError;
    leg = data as Leg;
  }
  return reconcileTerminalLeg(secrets, leg);
}

async function submitTerminalEth(secrets: Secrets, epoch: string): Promise<Leg | null> {
  const route = await getEthRoute(secrets);
  const priorLegs = await existingTerminalLegs(epoch);

  // Never skip a durable unresolved leg. A retry reuses the exact same leg,
  // client id and amount; only after it confirms may a new residual leg be made.
  for (const prior of priorLegs) {
    if (prior.status === 'MANUAL_REVIEW') return prior;
    if (prior.status === 'SUBMITTED' || prior.status === 'RETRYABLE' || prior.status === 'PREPARED') {
      return submitDurableTerminalLeg(secrets, prior);
    }
  }

  const trading = await getTradingBalances(secrets, ['ETH']);
  if ((trading.ETH || 0) > TERMINAL_DUST_EPSILON && !await terminalTransfer(secrets, epoch, 'ETH', trading.ETH, '18', '6')) return null;

  const funding = await getFundingBalances(secrets, ['ETH']);
  const withdrawableAfterFee = floorPrecision(Math.max(0, (funding.ETH || 0) - route.feeEth), route.precision);
  if (withdrawableAfterFee < route.minWithdrawalEth) return null;
  const amount = floorPrecision(
    route.maxWithdrawalEth > 0 ? Math.min(withdrawableAfterFee, route.maxWithdrawalEth) : withdrawableAfterFee,
    route.precision,
  );
  if (amount < route.minWithdrawalEth) return null;

  const sequence = priorLegs.reduce((max, leg) => Math.max(max, Number(leg.leg_sequence || 0)), 0) + 1;
  const clientId = await deterministicId(`terminal:${epoch}:okx:ETH:${route.chain}:leg:${sequence}:amount:${amountKey(amount)}`);
  const destinationHash = (await sha256Hex(secrets.destination.toLowerCase())).slice(0, 16);
  const { error: upsertError } = await supabase.from('cryptocrawler_terminal_sweep_legs').upsert({
    terminal_epoch: epoch, venue: 'okx', asset: 'ETH', leg_sequence: sequence, chain: route.chain,
    status: 'PREPARED', client_id: clientId, amount, fee: route.feeEth,
    destination_hash: destinationHash, destination_mode: 'primary', updated_at: nowIso(),
  }, { onConflict: 'terminal_epoch,venue,asset,leg_sequence', ignoreDuplicates: true });
  if (upsertError) throw upsertError;

  const { data, error } = await supabase.from('cryptocrawler_terminal_sweep_legs')
    .select('*').eq('terminal_epoch', epoch).eq('venue', 'okx').eq('asset', 'ETH').eq('leg_sequence', sequence).single();
  if (error) throw error;
  return submitDurableTerminalLeg(secrets, data as Leg);
}

async function terminalResidualBlockers(secrets: Secrets): Promise<string[]> {
  const [trading, funding] = await Promise.all([getTradingBalances(secrets), getFundingBalances(secrets)]);
  const blockers: string[] = [];
  for (const [asset, amount] of Object.entries(trading)) {
    if (amount > TERMINAL_DUST_EPSILON) blockers.push(`trading:${asset}`);
  }
  const route = await getEthRoute(secrets).catch(() => null);
  for (const [asset, amount] of Object.entries(funding)) {
    if (!(amount > TERMINAL_DUST_EPSILON)) continue;
    if (asset === 'ETH' && route && amount <= route.feeEth + route.minWithdrawalEth) continue;
    blockers.push(`funding:${asset}`);
  }
  return blockers;
}

async function payoutWorkInFlight(): Promise<{ jobs: number; batches: number }> {
  const [{ count: jobs, error: jobsError }, { count: batches, error: batchesError }] = await Promise.all([
    supabase.from('cryptocrawler_profit_payout_jobs')
      .select('event_id', { head: true, count: 'exact' }).in('status', ['CONVERTING', 'WITHDRAWING', 'SUBMITTED']),
    supabase.from('cryptocrawler_profit_payout_batches')
      .select('batch_id', { head: true, count: 'exact' }).in('status', ['CONVERTING', 'WITHDRAWING', 'SUBMITTED']),
  ]);
  if (jobsError) throw jobsError;
  if (batchesError) throw batchesError;
  return { jobs: jobs || 0, batches: batches || 0 };
}

export async function runTerminalSweep(secrets: Secrets, control: Control): Promise<Record<string, unknown>> {
  const epoch = control.terminal_epoch;
  if (!epoch) throw new Error('Terminal sweep state is missing terminal_epoch');

  const inFlight = await payoutWorkInFlight();
  if (inFlight.jobs > 0 || inFlight.batches > 0) {
    return { epoch, action: 'wait_for_profit_payout_reconciliation', inFlight };
  }

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
  if (leg?.status === 'MANUAL_REVIEW') {
    await supabase.from('cryptocrawler_terminal_sweep_control').update({
      desired_state: 'MANUAL_REVIEW',
      last_error: String((leg as any).last_error || 'Terminal ETH payout requires manual review').slice(0, 1000),
      updated_at: nowIso(),
    }).eq('system_key', SYSTEM_KEY).eq('terminal_epoch', epoch);
    return { epoch, action: 'manual_review', legStatus: leg.status, legSequence: leg.leg_sequence };
  }
  if (leg && leg.status !== 'CONFIRMED') {
    return { epoch, action: 'terminal_eth_withdrawal_pending', legStatus: leg.status, legSequence: leg.leg_sequence };
  }

  const residual = await terminalResidualBlockers(secrets);
  if (residual.length > 0) {
    return { epoch, action: 'terminal_residuals_remain', residual, nextLegRequired: true };
  }

  const ethUsd = await getTickerPrice('ETH-USDT').catch(() => 0);
  const legs = await existingTerminalLegs(epoch);
  const confirmedValueUsd = legs
    .filter(item => item.status === 'CONFIRMED')
    .reduce((sum, item) => sum + finite(item.amount) * ethUsd, 0);
  const allConfirmedHaveTxHash = legs
    .filter(item => item.status === 'CONFIRMED')
    .every(item => Boolean(item.transaction_hash));
  if (legs.some(item => item.status === 'CONFIRMED') && !allConfirmedHaveTxHash) {
    throw new Error('Terminal drain cannot be marked SWEPT without transaction hashes for every confirmed leg');
  }

  const { error } = await supabase.from('cryptocrawler_terminal_sweep_control').update({
    desired_state: 'SWEPT', swept_value_usd: confirmedValueUsd, sweep_completed_at: nowIso(),
    worker_lease_owner: null, worker_lease_until: null, last_error: null, updated_at: nowIso(),
  }).eq('system_key', SYSTEM_KEY).eq('terminal_epoch', epoch);
  if (error) throw error;
  await supabase.rpc('cryptocrawler_terminal_sweep_finalize_events', { p_epoch: epoch });
  return {
    epoch,
    action: 'terminal_eth_sweep_confirmed',
    confirmedLegs: legs.filter(item => item.status === 'CONFIRMED').length,
    allConfirmedLegsHaveTransactionHash: allConfirmedHaveTxHash,
  };
}
