import { BigNumber, ethers } from 'ethers';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { getAcrossTerminalAmountEvidence } from '../bridge/across-terminal-amount-evidence.js';
import { SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import { getPreparedCrossChainRoute } from '../discovery/cross-chain-opportunity-generator.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { recordCryptaraExecutionEvidence } from '../governance/automatic-stage-progression.js';
import { stageManager } from '../governance/stage-management.js';
import { executeAcrossBridgeQuote } from './across-bridge-executor.js';
import { fundingPositionLifecycle, type FundingExecutionPlan, type FundingLifecycleResult } from './funding-position-lifecycle.js';
import { getPreparedOkxFundingPlan } from './okx-funding-lifecycle-adapter.js';
import {
  applyCrossChainSystemCapitalSettlement,
  reserveOnchainSystemCapital,
  type OnchainSystemCapitalReservation,
} from './onchain-system-capital-ledger.js';
import type { UnifiedExecutionDecision } from './unified-execution-router.js';

export interface FundingCrossChainDispatchResult {
  opportunityId: string;
  topology: 'CROSS_CHAIN' | 'FUNDING_ARBITRAGE';
  path: 'BRIDGE_FLASH_LOAN' | 'SPOT_PERP_FUNDING';
  dispatched: boolean;
  submitted: boolean;
  success: boolean;
  settlementConfirmed: boolean;
  transactionHash?: string;
  lifecycleId?: string;
  submissionReference?: string;
  realizedNetProfitUsd?: number | null;
  error?: string;
}

type FundingLifecycleContext = {
  plan: FundingExecutionPlan;
  openedAt: number | null;
};

function liveExecutionEnabled(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';
}

async function fundingContext(lifecycleId: string): Promise<FundingLifecycleContext | null> {
  const result = await pool.query(
    `SELECT plan, open_receipt FROM private.cryptocrawler_funding_lifecycles WHERE lifecycle_id=$1 LIMIT 1`,
    [lifecycleId],
  ).catch(() => null);
  const row = result?.rows?.[0];
  if (!row?.plan) return null;
  const plan = typeof row.plan === 'string' ? JSON.parse(row.plan) as FundingExecutionPlan : row.plan as FundingExecutionPlan;
  const receipt = typeof row.open_receipt === 'string' ? JSON.parse(row.open_receipt) : row.open_receipt;
  return { plan, openedAt: Number.isFinite(Number(receipt?.openedAt)) ? Number(receipt.openedAt) : null };
}

async function recordFundingTerminal(result: FundingLifecycleResult): Promise<void> {
  if (!result.lifecycleId || !result.settlementConfirmed || !result.settlement?.terminal) return;
  const context = await fundingContext(result.lifecycleId);
  if (!context) return;
  const settlement = result.settlement;
  const realized = settlement.realizedNetProfitUsd;
  const settledAt = settlement.settledAt ?? Date.now();
  const latencyMs = context.openedAt !== null ? Math.max(0, settledAt - context.openedAt) : 0;
  await recordCryptaraExecutionEvidence({
    source: 'master_pipeline',
    opportunityId: context.plan.opportunityId,
    chain: 'cex:okx',
    symbol: context.plan.symbol,
    strategy: 'okx_spot_perp_funding',
    success: realized !== null && Number.isFinite(realized) && realized > 0,
    expectedProfitUsd: context.plan.expectedNetProfitUsd,
    realizedProfitUsd: realized,
    feeUsd: settlement.realizedFeesUsd,
    slippageBps: null,
    latencyMs,
    usedZeroCapital: false,
    timestamp: settledAt,
    notes: realized === null ? 'Funding lifecycle terminal economics incomplete' : undefined,
    settlementStatus: settlement.settlementConfirmed ? 'filled' : 'settlement_unknown',
    settlementConfirmed: settlement.settlementConfirmed,
    provenance: [
      ...context.plan.provenance,
      ...settlement.provenance,
      'funding_projected_entry_vs_realized_terminal_separated',
      'system_owned_capital_provenance_required',
    ],
    settlement: {
      status: settlement.settlementConfirmed ? 'filled' : 'settlement_unknown',
      terminal: settlement.terminal,
      settlementConfirmed: settlement.settlementConfirmed,
      submittedAt: context.openedAt ?? settledAt,
      settledAt,
      venueOrRoute: 'okx_spot_perp_funding',
      chain: 'cex:okx',
      predicted: { profitUsd: context.plan.expectedNetProfitUsd, feeUsd: context.plan.expectedEntryCostUsd + context.plan.expectedExitCostUsd, slippageBps: null },
      realized: {
        acquisitionCostUsd: null,
        proceedsUsd: null,
        exchangeFeeUsd: settlement.realizedFeesUsd,
        gasUsd: 0,
        gasUsed: null,
        effectiveGasPriceWei: null,
        slippageBps: null,
        netProfitUsd: realized,
      },
      provenance: [...settlement.provenance, 'funding_terminal_bill_and_close_authority'],
      error: settlement.error,
    },
  });
}

async function crossChainGasUsd(chain: keyof typeof SUPPORTED_CHAINS, originNativeFeeWei: string | undefined): Promise<number | null> {
  if (!originNativeFeeWei || !/^\d+$/.test(originNativeFeeWei)) return null;
  const currency = SUPPORTED_CHAINS[chain].currency.toUpperCase();
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices([currency]).catch(() => new Map<string, number>());
  const price = prices.get(currency);
  if (!Number.isFinite(price) || Number(price) <= 0) return null;
  const nativeFee = Number(ethers.utils.formatEther(BigNumber.from(originNativeFeeWei)));
  return Number.isFinite(nativeFee) ? nativeFee * Number(price) : null;
}

async function dispatchCrossChain(decision: UnifiedExecutionDecision): Promise<FundingCrossChainDispatchResult> {
  const candidate = measuredCandidateRegistry.get(decision.opportunityId);
  const prepared = getPreparedCrossChainRoute(decision.opportunityId);
  if (!candidate || !prepared || !decision.admitted || candidate.status !== 'eligible' || !candidate.executableCapability) {
    return { opportunityId: decision.opportunityId, topology: 'CROSS_CHAIN', path: 'BRIDGE_FLASH_LOAN', dispatched: false, submitted: false, success: false, settlementConfirmed: false, error: 'CROSS_CHAIN_PREPARED_ROUTE_UNAVAILABLE' };
  }
  const quote = prepared.quote;
  const reservationExpiry = Date.now() + Math.max(5 * 60_000, Math.min(3 * 60 * 60_000, Number(process.env.ACROSS_TERMINAL_SETTLEMENT_TIMEOUT_MS || 20 * 60_000) + 5 * 60_000));
  let reservation: OnchainSystemCapitalReservation | null = await reserveOnchainSystemCapital({
    opportunityId: candidate.opportunityId,
    chain: quote.originChain,
    asset: quote.token,
    tokenAddress: quote.inputToken,
    amountBaseUnits: quote.inputAmount,
    expiresAt: reservationExpiry,
  });
  if (!reservation) {
    return { opportunityId: decision.opportunityId, topology: 'CROSS_CHAIN', path: 'BRIDGE_FLASH_LOAN', dispatched: false, submitted: false, success: false, settlementConfirmed: false, error: 'CROSS_CHAIN_SYSTEM_OWNED_CAPITAL_UNAVAILABLE' };
  }

  const startedAt = Date.now();
  try {
    const execution = await executeAcrossBridgeQuote(quote);
    const submitted = Boolean(execution.depositTxnRef);
    if (!execution.settlementConfirmed || execution.status !== 'filled' || !execution.settlement || !execution.depositTxnRef) {
      if (execution.status !== 'settlement_unknown') await reservation.release().catch(() => undefined);
      return {
        opportunityId: decision.opportunityId,
        topology: 'CROSS_CHAIN',
        path: 'BRIDGE_FLASH_LOAN',
        dispatched: submitted,
        submitted,
        success: false,
        settlementConfirmed: execution.settlementConfirmed,
        transactionHash: execution.depositTxnRef,
        submissionReference: execution.depositTxnRef,
        realizedNetProfitUsd: null,
        error: execution.error,
      };
    }

    const terminal = await getAcrossTerminalAmountEvidence({ quote, settlement: execution.settlement });
    if (!terminal) throw new Error('CROSS_CHAIN_TERMINAL_AMOUNT_EVIDENCE_UNAVAILABLE');
    const [prices, gasUsd] = await Promise.all([
      coinGeckoPriceClient.getLiveSymbolPrices([quote.token]),
      crossChainGasUsd(quote.originChain, execution.originNativeFeeWei),
    ]);
    const assetUsd = prices.get(quote.token);
    if (!Number.isFinite(assetUsd) || Number(assetUsd) <= 0 || gasUsd === null) throw new Error('CROSS_CHAIN_TERMINAL_USD_ECONOMICS_INCOMPLETE');
    const inputHuman = Number(ethers.utils.formatUnits(terminal.inputAmount, quote.inputTokenDecimals));
    const outputHuman = Number(ethers.utils.formatUnits(terminal.outputAmount, quote.outputTokenDecimals));
    if (!Number.isFinite(inputHuman) || !Number.isFinite(outputHuman) || inputHuman <= 0) throw new Error('CROSS_CHAIN_TERMINAL_AMOUNTS_INVALID');
    const realizedNetProfitUsd = (outputHuman - inputHuman) * Number(assetUsd) - gasUsd;

    await applyCrossChainSystemCapitalSettlement({
      reservationId: reservation.reservationId,
      opportunityId: candidate.opportunityId,
      originChain: quote.originChain,
      destinationChain: quote.destinationChain,
      inputAsset: quote.token,
      outputAsset: quote.token,
      inputTokenAddress: quote.inputToken,
      outputTokenAddress: quote.outputToken,
      inputDecimals: quote.inputTokenDecimals,
      outputDecimals: quote.outputTokenDecimals,
      inputAmountBaseUnits: terminal.inputAmount,
      outputAmountBaseUnits: terminal.outputAmount,
      settlementReference: execution.depositTxnRef,
      settlementEvidence: {
        provider: 'across',
        depositTxnRef: execution.depositTxnRef,
        destinationReceiptVerified: execution.settlement.destinationReceiptVerified,
        authenticatedAmountEvidence: terminal.authority,
        originNativeFeeWei: execution.originNativeFeeWei ?? null,
      },
    });
    await reservation.release().catch(() => undefined);
    reservation = null;
    const economicallySuccessful = realizedNetProfitUsd > 0;
    const notionalUsd = Number(candidate.economics.notionalUsd);
    measuredCandidateRegistry.updateStatus(candidate.opportunityId, economicallySuccessful ? candidate.status : 'blocked', {
      economics: {
        ...candidate.economics,
        realizedNetProfitBps: Number.isFinite(notionalUsd) && notionalUsd > 0 ? realizedNetProfitUsd / notionalUsd * 10_000 : null,
      },
      executionCapabilityReason: economicallySuccessful ? candidate.executionCapabilityReason : 'Terminal Across same-asset result was not profitable after actual origin gas',
      provenance: [...candidate.provenance, 'cross_chain:terminal_authenticated_amounts', 'cross_chain:system_capital_settlement_applied'],
    });

    const settledAt = Date.now();
    await recordCryptaraExecutionEvidence({
      source: 'master_pipeline',
      opportunityId: candidate.opportunityId,
      chain: `${quote.originChain}->${quote.destinationChain}`,
      symbol: quote.token,
      strategy: 'across_same_asset_cross_chain',
      success: economicallySuccessful,
      expectedProfitUsd: Number(candidate.economics.deterministicNetProfitUsd),
      realizedProfitUsd: realizedNetProfitUsd,
      feeUsd: gasUsd,
      slippageBps: null,
      latencyMs: settledAt - startedAt,
      usedZeroCapital: false,
      timestamp: settledAt,
      settlementStatus: 'filled',
      settlementConfirmed: true,
      provenance: [...candidate.provenance, ...terminal.provenance, 'cross_chain:actual_origin_gas', 'synthetic_evidence:false'],
      settlement: {
        status: 'filled',
        terminal: true,
        settlementConfirmed: true,
        submittedAt: startedAt,
        settledAt,
        venueOrRoute: `across:${quote.originChain}->${quote.destinationChain}:${quote.token}`,
        chain: quote.destinationChain,
        predicted: { profitUsd: Number(candidate.economics.deterministicNetProfitUsd), feeUsd: candidate.economics.gasUsd, slippageBps: candidate.economics.expectedSlippageBps },
        realized: {
          acquisitionCostUsd: inputHuman * Number(assetUsd),
          proceedsUsd: outputHuman * Number(assetUsd),
          exchangeFeeUsd: null,
          gasUsd,
          gasUsed: null,
          effectiveGasPriceWei: null,
          slippageBps: null,
          netProfitUsd: realizedNetProfitUsd,
        },
        provenance: [...terminal.provenance, 'across_destination_receipt_verified', 'system_owned_origin_consumed_destination_lot_created'],
        transactionHash: execution.depositTxnRef,
        error: economicallySuccessful ? undefined : 'CROSS_CHAIN_TERMINAL_NONPOSITIVE_NET',
      },
    });
    return {
      opportunityId: decision.opportunityId,
      topology: 'CROSS_CHAIN',
      path: 'BRIDGE_FLASH_LOAN',
      dispatched: true,
      submitted: true,
      success: economicallySuccessful,
      settlementConfirmed: true,
      transactionHash: execution.depositTxnRef,
      submissionReference: execution.depositTxnRef,
      realizedNetProfitUsd,
      error: economicallySuccessful ? undefined : 'CROSS_CHAIN_TERMINAL_NONPOSITIVE_NET',
    };
  } catch (error) {
    if (reservation) await reservation.release().catch(() => undefined);
    return {
      opportunityId: decision.opportunityId,
      topology: 'CROSS_CHAIN',
      path: 'BRIDGE_FLASH_LOAN',
      dispatched: false,
      submitted: false,
      success: false,
      settlementConfirmed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function dispatchFunding(decision: UnifiedExecutionDecision): Promise<FundingCrossChainDispatchResult> {
  const candidate = measuredCandidateRegistry.get(decision.opportunityId);
  const plan = getPreparedOkxFundingPlan(decision.opportunityId);
  if (!candidate || !plan || !decision.admitted || candidate.status !== 'eligible' || !candidate.executableCapability) {
    return { opportunityId: decision.opportunityId, topology: 'FUNDING_ARBITRAGE', path: 'SPOT_PERP_FUNDING', dispatched: false, submitted: false, success: false, settlementConfirmed: false, error: 'FUNDING_PREPARED_PLAN_UNAVAILABLE' };
  }
  const result = await fundingPositionLifecycle.execute(plan);
  const submitted = result.status === 'opened' && Boolean(result.lifecycleId);
  return {
    opportunityId: decision.opportunityId,
    topology: 'FUNDING_ARBITRAGE',
    path: 'SPOT_PERP_FUNDING',
    dispatched: submitted,
    submitted,
    success: result.success,
    settlementConfirmed: result.settlementConfirmed,
    lifecycleId: result.lifecycleId,
    submissionReference: result.lifecycleId,
    realizedNetProfitUsd: result.settlement?.realizedNetProfitUsd,
    error: result.error,
  };
}

class FundingCrossChainExecutionAdapter {
  private readonly inFlight = new Set<string>();

  async advanceOpenFundingLifecycles(limit = 4): Promise<FundingLifecycleResult[]> {
    const results = await fundingPositionLifecycle.advanceOpenLifecycles(limit);
    for (const result of results) {
      try { await recordFundingTerminal(result); }
      catch (error) {
        logger.error('[FundingCrossChainAdapter] Funding terminal feedback failed without changing settlement truth', {
          component: 'FundingCrossChainExecutionAdapter',
          lifecycleId: result.lifecycleId,
          error: error instanceof Error ? error.message : String(error),
          settlementAuthorityChanged: false,
        });
      }
    }
    return results;
  }

  async dispatch(decisions: readonly UnifiedExecutionDecision[]): Promise<FundingCrossChainDispatchResult[]> {
    if (!liveExecutionEnabled() || !stageManager.isMarketOperationsAllowed() || !stageManager.canExecuteTrades()) return [];
    const results: FundingCrossChainDispatchResult[] = [];
    for (const decision of decisions) {
      if (!decision.admitted || this.inFlight.has(decision.opportunityId)) continue;
      const supported = (decision.topology === 'CROSS_CHAIN' && decision.path === 'BRIDGE_FLASH_LOAN')
        || (decision.topology === 'FUNDING_ARBITRAGE' && decision.path === 'SPOT_PERP_FUNDING');
      if (!supported) continue;
      this.inFlight.add(decision.opportunityId);
      try {
        results.push(decision.topology === 'CROSS_CHAIN'
          ? await dispatchCrossChain(decision)
          : await dispatchFunding(decision));
      } finally {
        this.inFlight.delete(decision.opportunityId);
      }
    }
    return results;
  }
}

export const fundingCrossChainExecutionAdapter = new FundingCrossChainExecutionAdapter();
