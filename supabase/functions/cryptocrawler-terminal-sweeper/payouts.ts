import {
  PAYOUT_QUOTES, MAX_PAYOUT_JOBS_PER_RUN,
  type Control, type PayoutAllocation, type PayoutBatch, type PayoutBatchStatus, type PayoutJob, type Secrets,
  finite, positive, floorPrecision, round, nowIso, deterministicId,
  supabase, updateBatch,
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

type PayoutProcessingSummary = {
  dueJobs: number;
  processedBatches: number;
  confirmedJobs: number;
  inFlightBatches: number;
  manualBatches: number;
  waitingForMinimum: boolean;
};

function classifyBatchError(error: unknown): PayoutBatchStatus {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof OkxApiError && error.code === '58237') return 'MANUAL_REVIEW';
  if (/permission|kyc|recipient information|compliance|trusted address|withdrawal.*disabled/i.test(message)) return 'MANUAL_REVIEW';
  return 'RETRYABLE';
}

async function markBatchError(batch: PayoutBatch, error: unknown): Promise<PayoutBatch> {
  return updateBatch(batch.batch_id, {
    status: classifyBatchError(error),
    attempt_count: Number(batch.attempt_count || 0) + 1,
    last_attempt_at: nowIso(),
    last_error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
  });
}

function outstandingUsd(job: PayoutJob): number {
  return Math.max(0, finite(job.payout_target_usd) - finite(job.payout_paid_usd));
}

function jobIsDue(job: PayoutJob, now = Date.now()): boolean {
  if (!job.scheduled_not_before) return true;
  const scheduled = new Date(job.scheduled_not_before).getTime();
  return Number.isFinite(scheduled) && scheduled <= now;
}

async function treasuryTradingSpendable(asset: string, liveAvailable: number): Promise<number> {
  const { data, error } = await supabase.rpc('cryptocrawler_okx_treasury_spendable', { p_asset: asset });
  if (error) throw new Error(`OKX trade-safe treasury liquidity unavailable for ${asset}: ${error.message}`);
  const measured = Number(data);
  if (!Number.isFinite(measured) || measured < 0) {
    throw new Error(`OKX trade-safe treasury liquidity is not currently measured for ${asset}`);
  }
  return Math.max(0, Math.min(liveAvailable, measured));
}

async function claimTreasuryLiquidity(batchId: string, asset: string, amount: number, liveAvailable: number): Promise<boolean> {
  if (!(amount > 0) || liveAvailable + 1e-12 < amount) return false;
  const { data, error } = await supabase.rpc('cryptocrawler_treasury_claim_okx_liquidity', {
    p_batch_id: batchId,
    p_asset: asset,
    p_amount: amount,
  });
  if (error) throw new Error(`OKX payout-liquidity claim failed for ${asset}: ${error.message}`);
  return data === true;
}

async function loadDueJobs(): Promise<PayoutJob[]> {
  const { data, error } = await supabase.from('cryptocrawler_profit_payout_jobs')
    .select('*')
    .in('status', ['QUEUED', 'RETRYABLE'])
    .order('scheduled_not_before', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(MAX_PAYOUT_JOBS_PER_RUN);
  if (error) throw error;
  return ((data || []) as PayoutJob[])
    .filter(job => jobIsDue(job) && outstandingUsd(job) > 0);
}

async function loadActiveBatch(): Promise<PayoutBatch | null> {
  const { data, error } = await supabase.from('cryptocrawler_profit_payout_batches')
    .select('*')
    .in('status', ['PREPARED', 'CONVERTING', 'WITHDRAWING', 'SUBMITTED', 'RETRYABLE'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as PayoutBatch | null;
}

async function loadBatchAllocations(batchId: string): Promise<PayoutAllocation[]> {
  const { data, error } = await supabase.from('cryptocrawler_profit_payout_batch_allocations')
    .select('*').eq('batch_id', batchId).order('event_id', { ascending: true });
  if (error) throw error;
  return (data || []) as PayoutAllocation[];
}

async function createOrLoadPreparedBatch(secrets: Secrets, dueJobs: PayoutJob[]): Promise<{ batch: PayoutBatch | null; waitingForMinimum: boolean }> {
  if (dueJobs.length === 0) return { batch: null, waitingForMinimum: false };

  const [route, referencePrice] = await Promise.all([
    getEthRoute(secrets),
    getTickerPrice('ETH-USDT'),
  ]);
  const totalOutstandingUsd = dueJobs.reduce((sum, job) => sum + outstandingUsd(job), 0);
  if (!(totalOutstandingUsd > 0) || !(referencePrice > 0)) return { batch: null, waitingForMinimum: false };

  const minEth = Math.max(0, route.minWithdrawalEth);
  const maxEth = route.maxWithdrawalEth > 0 ? route.maxWithdrawalEth : Number.POSITIVE_INFINITY;
  const availableEthFromObligations = totalOutstandingUsd / referencePrice;
  const payoutAmountEth = floorPrecision(Math.min(availableEthFromObligations, maxEth), route.precision);
  if (!(payoutAmountEth > 0) || payoutAmountEth + 1e-12 < minEth) {
    return { batch: null, waitingForMinimum: true };
  }

  const targetUsd = Math.min(totalOutstandingUsd, payoutAmountEth * referencePrice);
  const identity = dueJobs
    .map(job => `${job.event_id}:${outstandingUsd(job).toFixed(8)}`)
    .join('|');
  const batchId = await deterministicId(`payout-batch:${route.chain}:${targetUsd.toFixed(8)}:${payoutAmountEth.toFixed(12)}:${identity}`);
  const destinationHash = dueJobs[0]?.destination_hash;
  if (!destinationHash) throw new Error('Due payout jobs do not contain a destination fingerprint');

  const { error: insertError } = await supabase.from('cryptocrawler_profit_payout_batches').upsert({
    batch_id: batchId,
    status: 'PREPARED',
    target_usd: targetUsd,
    payout_amount_eth: payoutAmountEth,
    reference_price_usd: referencePrice,
    payout_fee_eth: route.feeEth,
    operating_cost_usd: route.feeEth * referencePrice,
    destination_hash: destinationHash,
    updated_at: nowIso(),
  }, { onConflict: 'batch_id', ignoreDuplicates: true });
  if (insertError) throw insertError;

  const { data: batchData, error: batchError } = await supabase.from('cryptocrawler_profit_payout_batches')
    .select('*').eq('batch_id', batchId).single();
  if (batchError) throw batchError;
  const batch = batchData as PayoutBatch;

  const existingAllocations = await loadBatchAllocations(batchId);
  const existingByEvent = new Set(existingAllocations.map(item => item.event_id));
  let allocatedUsd = existingAllocations.reduce((sum, item) => sum + finite(item.allocated_usd), 0);
  let allocatedEth = existingAllocations.reduce((sum, item) => sum + finite(item.allocated_eth), 0);

  for (const job of dueJobs) {
    if (existingByEvent.has(job.event_id)) continue;
    const remainingBatchUsd = Math.max(0, targetUsd - allocatedUsd);
    if (remainingBatchUsd <= 1e-8) break;
    const allocationUsd = Math.min(outstandingUsd(job), remainingBatchUsd);
    if (!(allocationUsd > 0)) continue;
    const isFinal = targetUsd - (allocatedUsd + allocationUsd) <= 1e-8;
    const allocationEth = isFinal
      ? Math.max(0, payoutAmountEth - allocatedEth)
      : payoutAmountEth * allocationUsd / targetUsd;
    const { error: allocationError } = await supabase.from('cryptocrawler_profit_payout_batch_allocations').insert({
      batch_id: batchId,
      event_id: job.event_id,
      allocated_usd: allocationUsd,
      allocated_eth: allocationEth,
    });
    if (allocationError) throw allocationError;
    allocatedUsd += allocationUsd;
    allocatedEth += allocationEth;
  }

  if (Math.abs(allocatedUsd - targetUsd) > 0.0001) {
    throw new Error(`Prepared payout batch allocation is incomplete: allocated=${allocatedUsd} target=${targetUsd}`);
  }

  const allocations = await loadBatchAllocations(batchId);
  const eventIds = allocations.map(item => item.event_id);
  if (eventIds.length > 0) {
    await supabase.from('cryptocrawler_profit_payout_jobs')
      .update({ status: 'WITHDRAWING', last_error: null, updated_at: nowIso() })
      .in('event_id', eventIds)
      .in('status', ['QUEUED', 'RETRYABLE']);
    await supabase.from('cryptocrawler_payout_asset_reservations')
      .update({ status: 'IN_FLIGHT', updated_at: nowIso() })
      .in('event_id', eventIds)
      .eq('status', 'HELD');
  }

  return { batch, waitingForMinimum: false };
}

async function chooseConversionPlan(secrets: Secrets, batchId: string, currentQuote: string | null, ethShortage: number): Promise<ConversionPlan> {
  const liveBalances = await getTradingBalances(secrets, [...PAYOUT_QUOTES]);
  const candidates: ConversionPlan[] = [];
  for (const quote of quotePreference(currentQuote)) {
    const instId = `ETH-${quote}`;
    try {
      const [priceUsd, takerCostFraction, spendableQuote] = await Promise.all([
        getTickerPrice(instId),
        getTakerCostFraction(secrets, instId),
        treasuryTradingSpendable(quote, liveBalances[quote] || 0),
      ]);
      const grossEthToBuy = Math.max(ethShortage, ethShortage / Math.max(0.95, 1 - takerCostFraction));
      const requiredQuote = grossEthToBuy * priceUsd * 1.005;
      if (spendableQuote + 1e-9 >= requiredQuote) {
        candidates.push({ quote, priceUsd, takerCostFraction, requiredQuote, grossEthToBuy });
      }
    } catch { /* another authenticated quote may be usable */ }
  }
  candidates.sort((a, b) => a.requiredQuote - b.requiredQuote);
  for (const candidate of candidates) {
    if (await claimTreasuryLiquidity(batchId, candidate.quote, candidate.requiredQuote, liveBalances[candidate.quote] || 0)) {
      return candidate;
    }
  }
  throw new Error('OKX has no currently claimable unreserved quote liquidity for the due payout batch');
}

async function recoverOrPlaceBatchConversion(secrets: Secrets, input: PayoutBatch, plan: ConversionPlan): Promise<PayoutBatch> {
  let batch = input;
  const instId = `ETH-${plan.quote}`;
  const clientId = batch.conversion_client_id || await deterministicId(`payout-batch:${batch.batch_id}:convert:${plan.quote}:${plan.requiredQuote.toFixed(8)}`);
  let order = await findOrder(secrets, instId, batch.conversion_trade_id, clientId);
  let orderId = String(order?.ordId || batch.conversion_trade_id || '');

  if (!orderId) {
    orderId = await placeMarketOrder(secrets, instId, 'buy', plan.grossEthToBuy, 'base_ccy', clientId);
    batch = await updateBatch(batch.batch_id, {
      status: 'CONVERTING', quote_asset: plan.quote,
      conversion_client_id: clientId, conversion_trade_id: orderId,
      last_attempt_at: nowIso(), attempt_count: Number(batch.attempt_count || 0) + 1,
      last_error: null,
    });
  }

  order = await waitOrderTerminal(secrets, instId, orderId);
  if (!order) return batch;
  const state = String(order.state || '').toLowerCase();
  const netEth = orderNetEth(order);
  if (state !== 'filled' || !(netEth > 0)) {
    return updateBatch(batch.batch_id, { status: 'RETRYABLE', last_error: `ETH conversion order ended ${state || 'unknown'} without a complete fill` });
  }

  return updateBatch(batch.batch_id, {
    status: 'WITHDRAWING', quote_asset: plan.quote,
    conversion_client_id: clientId, conversion_trade_id: orderId,
    conversion_quote_spent: orderQuoteSpent(order, plan.quote),
    conversion_eth_acquired: netEth,
    last_error: null,
  });
}

async function ensureBatchEthInFunding(secrets: Secrets, input: PayoutBatch, requiredFundingEth: number): Promise<PayoutBatch> {
  let batch = input;
  const funding = await getFundingBalances(secrets, ['ETH']);
  const shortage = requiredFundingEth - (funding.ETH || 0);
  if (shortage <= 1e-12) return batch;

  const liveTrading = await getTradingBalances(secrets, ['ETH']);
  const spendableTradingEth = await treasuryTradingSpendable('ETH', liveTrading.ETH || 0);
  if (spendableTradingEth + 1e-12 < shortage) throw new Error('Trade-safe converted ETH is not yet available in the OKX trading account');
  if (!await claimTreasuryLiquidity(batch.batch_id, 'ETH', shortage, liveTrading.ETH || 0)) {
    throw new Error('OKX ETH liquidity changed before the treasury could claim it; payout will retry without preempting the live trade');
  }

  const transfer = await ensureTransfer(
    secrets, `payout-batch:${batch.batch_id}:transfer:eth:18:6:${shortage.toFixed(12)}`, 'ETH', shortage, '18', '6', batch.transfer_id,
  );
  batch = await updateBatch(batch.batch_id, {
    status: 'WITHDRAWING', transfer_client_id: transfer.clientId,
    transfer_id: transfer.transferId, last_attempt_at: nowIso(), last_error: null,
  });
  return batch;
}

async function markAllocatedJobsStatus(batchId: string, status: 'WITHDRAWING' | 'SUBMITTED'): Promise<void> {
  const allocations = await loadBatchAllocations(batchId);
  const eventIds = allocations.map(item => item.event_id);
  if (eventIds.length === 0) return;
  await supabase.from('cryptocrawler_profit_payout_jobs')
    .update({ status, last_error: null, updated_at: nowIso() })
    .in('event_id', eventIds)
    .not('status', 'in', '(CONFIRMED,TERMINAL_SWEPT,MANUAL_REVIEW)');
}

async function reconcileBatchWithdrawal(secrets: Secrets, input: PayoutBatch): Promise<PayoutBatch> {
  let batch = input;
  if (!batch.withdrawal_id && !batch.withdrawal_client_id) return batch;
  const record = await findWithdrawal(secrets, batch.withdrawal_id, batch.withdrawal_client_id);
  if (!record) return batch;
  const withdrawalId = String(record.wdId || batch.withdrawal_id || '');
  const state = String(record.state ?? '');
  const txId = String(record.txId || '').trim();

  if (state === '2' && txId) {
    const { error } = await supabase.rpc('cryptocrawler_profit_payout_batch_confirm', {
      p_batch_id: batch.batch_id,
      p_withdrawal_id: withdrawalId,
      p_transaction_hash: txId,
    });
    if (error) throw new Error(`Atomic payout-batch confirmation failed: ${error.message}`);
    const { data, error: readError } = await supabase.from('cryptocrawler_profit_payout_batches')
      .select('*').eq('batch_id', batch.batch_id).single();
    if (readError) throw readError;
    return data as PayoutBatch;
  }
  if (state.startsWith('-')) {
    return updateBatch(batch.batch_id, {
      status: 'RETRYABLE', withdrawal_id: withdrawalId || null,
      last_error: `OKX ETH withdrawal terminal failure state ${state}`,
    });
  }
  batch = await updateBatch(batch.batch_id, {
    status: 'SUBMITTED', withdrawal_id: withdrawalId || batch.withdrawal_id, last_error: null,
  });
  await markAllocatedJobsStatus(batch.batch_id, 'SUBMITTED');
  return batch;
}

async function submitBatchWithdrawal(secrets: Secrets, input: PayoutBatch): Promise<PayoutBatch> {
  let batch = input;
  const route = await getEthRoute(secrets);
  const amountEth = finite(batch.payout_amount_eth);
  if (!(amountEth > 0) || amountEth + 1e-12 < route.minWithdrawalEth) {
    throw new Error('Prepared payout batch no longer satisfies the authenticated OKX Ethereum minimum');
  }
  if (route.maxWithdrawalEth > 0 && amountEth > route.maxWithdrawalEth + 1e-12) {
    throw new Error('Prepared payout batch exceeds the current authenticated OKX Ethereum maximum');
  }

  const clientId = batch.withdrawal_client_id || await deterministicId(`payout-batch:${batch.batch_id}:withdraw:ETH:${route.chain}:${amountEth.toFixed(12)}`);
  const recovered = await findWithdrawal(secrets, batch.withdrawal_id, clientId);
  if (recovered?.wdId) {
    batch = await updateBatch(batch.batch_id, {
      withdrawal_client_id: clientId, withdrawal_id: String(recovered.wdId), status: 'SUBMITTED',
    });
    await markAllocatedJobsStatus(batch.batch_id, 'SUBMITTED');
    return reconcileBatchWithdrawal(secrets, batch);
  }

  batch = await updateBatch(batch.batch_id, {
    status: 'WITHDRAWING', withdrawal_client_id: clientId,
    payout_fee_eth: route.feeEth,
    submitted_at: nowIso(), last_attempt_at: nowIso(),
    attempt_count: Number(batch.attempt_count || 0) + 1, last_error: null,
  });
  await markAllocatedJobsStatus(batch.batch_id, 'WITHDRAWING');

  try {
    const withdrawalId = await submitEthWithdrawal(secrets, route, amountEth, clientId);
    batch = await updateBatch(batch.batch_id, { status: 'SUBMITTED', withdrawal_id: withdrawalId, last_error: null });
  } catch (error) {
    const ambiguous = await findWithdrawal(secrets, null, clientId);
    if (!ambiguous?.wdId) throw error;
    batch = await updateBatch(batch.batch_id, { status: 'SUBMITTED', withdrawal_id: String(ambiguous.wdId), last_error: null });
  }
  await markAllocatedJobsStatus(batch.batch_id, 'SUBMITTED');
  return batch;
}

async function processBatch(secrets: Secrets, control: Control, input: PayoutBatch): Promise<PayoutBatch> {
  let batch = input;
  if (['CONFIRMED', 'TERMINAL_SWEPT', 'MANUAL_REVIEW'].includes(batch.status)) return batch;
  if (batch.status === 'SUBMITTED') return reconcileBatchWithdrawal(secrets, batch);

  try {
    const route = await getEthRoute(secrets);
    const referencePrice = positive(batch.reference_price_usd) ?? await getTickerPrice('ETH-USDT');
    const payoutAmountEth = finite(batch.payout_amount_eth);
    if (!(payoutAmountEth > 0)) throw new Error('Payout batch has no positive ETH target');
    if (payoutAmountEth + 1e-12 < route.minWithdrawalEth) throw new Error('Payout batch has fallen below the current OKX Ethereum minimum');
    if (route.maxWithdrawalEth > 0 && payoutAmountEth > route.maxWithdrawalEth + 1e-12) throw new Error('Payout batch exceeds the current OKX Ethereum maximum');

    const networkCostUsd = route.feeEth * referencePrice;
    const retainedPoolUsd = Math.max(0, finite(control.retained_profit_usd));
    if (networkCostUsd > retainedPoolUsd + 1e-8) {
      throw new Error('Retained operating pool is insufficient to pay the authenticated Ethereum withdrawal fee');
    }

    const requiredFundingEth = payoutAmountEth + route.feeEth;
    let funding = await getFundingBalances(secrets, ['ETH']);
    let liveTrading = await getTradingBalances(secrets, ['ETH']);
    let safeTradingEth = await treasuryTradingSpendable('ETH', liveTrading.ETH || 0);
    const neededFromTradingNow = Math.min(safeTradingEth, Math.max(0, requiredFundingEth - (funding.ETH || 0)));
    if (neededFromTradingNow > 0 && !await claimTreasuryLiquidity(batch.batch_id, 'ETH', neededFromTradingNow, liveTrading.ETH || 0)) {
      throw new Error('OKX ETH liquidity changed before payout reservation; retrying without interrupting the live trade');
    }
    safeTradingEth = neededFromTradingNow;
    const totalTradeSafeEth = (funding.ETH || 0) + safeTradingEth;

    if (totalTradeSafeEth + 1e-12 < requiredFundingEth) {
      const shortage = requiredFundingEth - totalTradeSafeEth;
      const plan = await chooseConversionPlan(secrets, batch.batch_id, batch.quote_asset, shortage);
      const estimatedConversionCostUsd = Math.max(0, plan.requiredQuote - shortage * plan.priceUsd);
      if (networkCostUsd + estimatedConversionCostUsd > retainedPoolUsd + 1e-8) {
        throw new Error('Retained operating pool is insufficient for conversion plus Ethereum withdrawal costs');
      }
      batch = await recoverOrPlaceBatchConversion(secrets, batch, plan);
      if (['CONVERTING', 'RETRYABLE'].includes(batch.status)) return batch;
      const actualConversionCost = Math.max(0, finite(batch.conversion_quote_spent) - finite(batch.conversion_eth_acquired) * plan.priceUsd);
      batch = await updateBatch(batch.batch_id, {
        operating_cost_usd: round(networkCostUsd + actualConversionCost, 8), last_error: null,
      });
      funding = await getFundingBalances(secrets, ['ETH']);
      liveTrading = await getTradingBalances(secrets, ['ETH']);
      safeTradingEth = await treasuryTradingSpendable('ETH', liveTrading.ETH || 0);
    }

    if ((funding.ETH || 0) + safeTradingEth + 1e-12 < requiredFundingEth) return batch;
    batch = await ensureBatchEthInFunding(secrets, batch, requiredFundingEth);
    funding = await getFundingBalances(secrets, ['ETH']);
    if ((funding.ETH || 0) + 1e-12 < requiredFundingEth) return batch;

    batch = await submitBatchWithdrawal(secrets, batch);
    if (batch.status === 'SUBMITTED') batch = await reconcileBatchWithdrawal(secrets, batch);
    return batch;
  } catch (error) {
    return markBatchError(batch, error);
  }
}

export async function processPerTradePayouts(secrets: Secrets, control: Control): Promise<PayoutProcessingSummary> {
  let active = await loadActiveBatch();
  let waitingForMinimum = false;
  let dueJobs = await loadDueJobs();

  if (!active) {
    const prepared = await createOrLoadPreparedBatch(secrets, dueJobs);
    active = prepared.batch;
    waitingForMinimum = prepared.waitingForMinimum;
  }

  let processedBatches = 0;
  let manualBatches = 0;
  if (active) {
    const result = await processBatch(secrets, control, active);
    processedBatches = 1;
    if (result.status === 'MANUAL_REVIEW') manualBatches = 1;
  }

  dueJobs = await loadDueJobs();
  const { count: confirmedJobs, error: confirmedError } = await supabase.from('cryptocrawler_profit_payout_jobs')
    .select('event_id', { head: true, count: 'exact' }).eq('status', 'CONFIRMED');
  if (confirmedError) throw confirmedError;
  const { count: inFlightBatches, error: countError } = await supabase.from('cryptocrawler_profit_payout_batches')
    .select('batch_id', { head: true, count: 'exact' }).in('status', ['PREPARED', 'CONVERTING', 'WITHDRAWING', 'SUBMITTED', 'RETRYABLE']);
  if (countError) throw countError;

  return {
    dueJobs: dueJobs.length,
    processedBatches,
    confirmedJobs: confirmedJobs || 0,
    inFlightBatches: inFlightBatches || 0,
    manualBatches,
    waitingForMinimum,
  };
}
