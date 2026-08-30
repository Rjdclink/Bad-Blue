import {
  PAYOUT_QUOTES, MAX_PAYOUT_JOBS_PER_RUN,
  type Control, type PayoutJob, type PayoutStatus, type Secrets,
  finite, positive, floorPrecision, round, nowIso, deterministicId,
  supabase, updateJob, loadControl,
} from './shared.ts';
import {
  OkxApiError, findOrder, findWithdrawal, getEthRoute, getFundingBalances,
  getTakerCostFraction, getTickerPrice, getTradingBalances, orderNetEth,
  orderQuoteSpent, placeMarketOrder, quotePreference, submitEthWithdrawal,
  ensureTransfer, waitOrderTerminal,
} from './okx.ts';

type ConversionPlan = {
  quote: typeof PAYOUT_QUOTES[number];
  priceUsd: number;
  takerCostFraction: number;
  requiredQuote: number;
  grossEthToBuy: number;
};

function classifyPayoutError(error: unknown): PayoutStatus {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof OkxApiError && error.code === '58237') return 'MANUAL_REVIEW';
  if (/permission|kyc|recipient information|compliance|trusted address|withdrawal.*disabled/i.test(message)) return 'MANUAL_REVIEW';
  return 'RETRYABLE';
}

async function markJobError(job: PayoutJob, error: unknown): Promise<PayoutJob> {
  return updateJob(job.event_id, {
    status: classifyPayoutError(error),
    attempt_count: Number(job.attempt_count || 0) + 1,
    last_attempt_at: nowIso(),
    last_error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
  });
}

async function chooseConversionPlan(secrets: Secrets, job: PayoutJob, ethShortage: number): Promise<ConversionPlan> {
  const balances = await getTradingBalances(secrets, [...PAYOUT_QUOTES]);
  const candidates: ConversionPlan[] = [];
  for (const quote of quotePreference(job.quote_asset)) {
    const instId = `ETH-${quote}`;
    try {
      const [priceUsd, takerCostFraction] = await Promise.all([
        getTickerPrice(instId), getTakerCostFraction(secrets, instId),
      ]);
      const grossEthToBuy = Math.max(ethShortage, ethShortage / Math.max(0.95, 1 - takerCostFraction));
      const requiredQuote = grossEthToBuy * priceUsd * 1.005;
      if ((balances[quote] || 0) + 1e-9 >= requiredQuote) {
        candidates.push({ quote, priceUsd, takerCostFraction, requiredQuote, grossEthToBuy });
      }
    } catch { /* try another authenticated quote */ }
  }
  if (candidates.length === 0) {
    throw new Error('OKX does not currently have enough authenticated payout inventory for this 60% payout without consuming protected capital');
  }
  candidates.sort((a, b) => a.requiredQuote - b.requiredQuote);
  return candidates[0];
}

async function recoverOrPlaceConversion(secrets: Secrets, input: PayoutJob, plan: ConversionPlan): Promise<PayoutJob> {
  let job = input;
  const instId = `ETH-${plan.quote}`;
  const clientId = job.conversion_client_id || await deterministicId(`payout:${job.event_id}:convert:${plan.quote}`);
  let order = await findOrder(secrets, instId, job.conversion_trade_id, clientId);
  let orderId = String(order?.ordId || job.conversion_trade_id || '');

  if (!orderId) {
    orderId = await placeMarketOrder(secrets, instId, 'buy', plan.grossEthToBuy, 'base_ccy', clientId);
    job = await updateJob(job.event_id, {
      status: 'CONVERTING', quote_asset: plan.quote,
      conversion_client_id: clientId, conversion_trade_id: orderId,
      last_attempt_at: nowIso(), attempt_count: Number(job.attempt_count || 0) + 1,
      last_error: null,
    });
  }

  order = await waitOrderTerminal(secrets, instId, orderId);
  if (!order) return job;
  const state = String(order.state || '').toLowerCase();
  const netEth = orderNetEth(order);
  if (state !== 'filled' || !(netEth > 0)) {
    return updateJob(job.event_id, { status: 'RETRYABLE', last_error: `ETH conversion order ended ${state || 'unknown'} without a complete fill` });
  }

  return updateJob(job.event_id, {
    status: 'WITHDRAWING', quote_asset: plan.quote,
    conversion_client_id: clientId, conversion_trade_id: orderId,
    conversion_quote_spent: orderQuoteSpent(order, plan.quote),
    conversion_eth_acquired: netEth,
    conversion_price_usd: positive(order.avgPx) ?? plan.priceUsd,
    last_error: null,
  });
}

async function ensureEthInFunding(secrets: Secrets, input: PayoutJob, requiredFundingEth: number): Promise<PayoutJob> {
  let job = input;
  const funding = await getFundingBalances(secrets, ['ETH']);
  const shortage = requiredFundingEth - (funding.ETH || 0);
  if (shortage <= 1e-12) return job;

  const trading = await getTradingBalances(secrets, ['ETH']);
  if ((trading.ETH || 0) + 1e-12 < shortage) throw new Error('Converted ETH is not yet available in the OKX trading account');

  const transfer = await ensureTransfer(
    secrets, `payout:${job.event_id}:transfer:eth:18:6`, 'ETH', shortage, '18', '6', job.transfer_id,
  );
  job = await updateJob(job.event_id, {
    status: 'WITHDRAWING', transfer_client_id: transfer.clientId,
    transfer_id: transfer.transferId, last_attempt_at: nowIso(), last_error: null,
  });
  return job;
}

export async function reconcilePayoutWithdrawal(secrets: Secrets, input: PayoutJob): Promise<PayoutJob> {
  let job = input;
  if (!job.withdrawal_id && !job.withdrawal_client_id) return job;
  const record = await findWithdrawal(secrets, job.withdrawal_id, job.withdrawal_client_id);
  if (!record) return job;
  const withdrawalId = String(record.wdId || job.withdrawal_id || '');
  const state = String(record.state ?? '');
  const txId = String(record.txId || '').trim();
  if (state === '2' && txId) {
    return updateJob(job.event_id, {
      status: 'CONFIRMED', withdrawal_id: withdrawalId, transaction_hash: txId,
      confirmed_at: nowIso(), last_error: null,
    });
  }
  if (state.startsWith('-')) {
    return updateJob(job.event_id, {
      status: 'RETRYABLE', withdrawal_id: withdrawalId || null,
      last_error: `OKX ETH withdrawal terminal failure state ${state}`,
    });
  }
  return updateJob(job.event_id, {
    status: 'SUBMITTED', withdrawal_id: withdrawalId || job.withdrawal_id, last_error: null,
  });
}

async function submitPayoutWithdrawal(secrets: Secrets, input: PayoutJob, amountEth: number): Promise<PayoutJob> {
  let job = input;
  const route = await getEthRoute(secrets);
  const clientId = job.withdrawal_client_id || await deterministicId(`payout:${job.event_id}:withdraw:ETH:${route.chain}`);
  const recovered = await findWithdrawal(secrets, job.withdrawal_id, clientId);
  if (recovered?.wdId) {
    job = await updateJob(job.event_id, {
      withdrawal_client_id: clientId, withdrawal_id: String(recovered.wdId), status: 'SUBMITTED',
    });
    return reconcilePayoutWithdrawal(secrets, job);
  }

  job = await updateJob(job.event_id, {
    status: 'WITHDRAWING', withdrawal_client_id: clientId,
    payout_amount_eth: amountEth, payout_fee_eth: route.feeEth,
    submitted_at: nowIso(), last_attempt_at: nowIso(),
    attempt_count: Number(job.attempt_count || 0) + 1, last_error: null,
  });

  try {
    const withdrawalId = await submitEthWithdrawal(secrets, route, amountEth, clientId);
    return updateJob(job.event_id, { status: 'SUBMITTED', withdrawal_id: withdrawalId, last_error: null });
  } catch (error) {
    const ambiguous = await findWithdrawal(secrets, null, clientId);
    if (ambiguous?.wdId) {
      return updateJob(job.event_id, { status: 'SUBMITTED', withdrawal_id: String(ambiguous.wdId), last_error: null });
    }
    throw error;
  }
}

export async function processPayoutJob(secrets: Secrets, control: Control, input: PayoutJob): Promise<PayoutJob> {
  let job = input;
  if (['CONFIRMED', 'TERMINAL_SWEPT', 'MANUAL_REVIEW'].includes(job.status)) return job;
  if (job.status === 'SUBMITTED') return reconcilePayoutWithdrawal(secrets, job);

  try {
    const route = await getEthRoute(secrets);
    const referencePrice = positive(job.conversion_price_usd) ?? await getTickerPrice('ETH-USDT');
    const payoutTargetUsd = finite(job.payout_target_usd);
    if (!(payoutTargetUsd > 0)) throw new Error('Payout job has no positive 60% target');

    const payoutAmountEth = positive(job.payout_amount_eth) ?? floorPrecision(payoutTargetUsd / referencePrice, route.precision);
    if (!(payoutAmountEth > 0) || payoutAmountEth < route.minWithdrawalEth) {
      throw new Error(`Per-trade 60% ETH payout is below current OKX Ethereum minimum withdrawal (${route.minWithdrawalEth} ETH)`);
    }
    if (route.maxWithdrawalEth > 0 && payoutAmountEth > route.maxWithdrawalEth) {
      throw new Error(`Per-trade 60% ETH payout exceeds current OKX single-withdrawal maximum (${route.maxWithdrawalEth} ETH)`);
    }

    const networkCostUsd = route.feeEth * referencePrice;
    const retainedPoolUsd = Math.max(0, finite(control.retained_profit_usd));
    if (networkCostUsd > retainedPoolUsd + 1e-8) {
      throw new Error('Retained 40% operating pool is insufficient to pay the authenticated Ethereum withdrawal fee');
    }

    job = await updateJob(job.event_id, {
      status: ['QUEUED', 'RETRYABLE'].includes(job.status) ? 'WITHDRAWING' : job.status,
      payout_amount_eth: payoutAmountEth, payout_fee_eth: route.feeEth,
      payout_operating_cost_usd: Math.max(finite(job.payout_operating_cost_usd), networkCostUsd),
      last_error: null,
    });

    let funding = await getFundingBalances(secrets, ['ETH']);
    let trading = await getTradingBalances(secrets, ['ETH']);
    const requiredFundingEth = payoutAmountEth + route.feeEth;
    const totalEth = (funding.ETH || 0) + (trading.ETH || 0);

    if (totalEth + 1e-12 < requiredFundingEth) {
      const shortage = requiredFundingEth - totalEth;
      const plan = await chooseConversionPlan(secrets, job, shortage);
      const estimatedConversionCostUsd = Math.max(0, plan.requiredQuote - shortage * plan.priceUsd);
      if (networkCostUsd + estimatedConversionCostUsd > retainedPoolUsd + 1e-8) {
        throw new Error('Retained 40% operating pool is insufficient for conversion plus Ethereum withdrawal costs');
      }
      job = await recoverOrPlaceConversion(secrets, job, plan);
      if (['CONVERTING', 'RETRYABLE'].includes(job.status)) return job;
      const actualConversionCost = Math.max(0, finite(job.conversion_quote_spent) - finite(job.conversion_eth_acquired) * plan.priceUsd);
      job = await updateJob(job.event_id, {
        payout_operating_cost_usd: round(networkCostUsd + actualConversionCost, 8), last_error: null,
      });
      funding = await getFundingBalances(secrets, ['ETH']);
      trading = await getTradingBalances(secrets, ['ETH']);
    }

    job = await ensureEthInFunding(secrets, job, requiredFundingEth);
    funding = await getFundingBalances(secrets, ['ETH']);
    if ((funding.ETH || 0) + 1e-12 < requiredFundingEth) return job;

    job = await submitPayoutWithdrawal(secrets, job, payoutAmountEth);
    if (job.status === 'SUBMITTED') job = await reconcilePayoutWithdrawal(secrets, job);
    return job;
  } catch (error) {
    return markJobError(job, error);
  }
}

export async function processPerTradePayouts(secrets: Secrets, _control: Control): Promise<{ processed: number; confirmed: number; inFlight: number; manual: number }> {
  const { data, error } = await supabase.from('cryptocrawler_profit_payout_jobs')
    .select('*').in('status', ['QUEUED', 'RETRYABLE', 'CONVERTING', 'WITHDRAWING', 'SUBMITTED'])
    .order('created_at', { ascending: true }).limit(MAX_PAYOUT_JOBS_PER_RUN);
  if (error) throw error;

  let processed = 0;
  let confirmed = 0;
  let manual = 0;
  for (const row of (data || []) as PayoutJob[]) {
    const currentControl = await loadControl();
    const result = await processPayoutJob(secrets, currentControl, row);
    processed += 1;
    if (result.status === 'CONFIRMED') confirmed += 1;
    if (result.status === 'MANUAL_REVIEW') manual += 1;
  }

  const { count, error: countError } = await supabase.from('cryptocrawler_profit_payout_jobs')
    .select('event_id', { head: true, count: 'exact' }).in('status', ['CONVERTING', 'WITHDRAWING', 'SUBMITTED']);
  if (countError) throw countError;
  return { processed, confirmed, manual, inFlight: count || 0 };
}
