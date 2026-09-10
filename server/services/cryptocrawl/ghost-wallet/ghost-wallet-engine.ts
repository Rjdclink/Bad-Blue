import { BigNumber, Contract, providers, utils, type Wallet } from 'ethers';
import logger from '../../../logger.js';
import { zeroCapitalEngine } from '../core/zero-capital-engine.js';
import { resolvePrimaryProfitPayoutAddress } from '../core/wallet-identity.js';
import {
  composeGhostWalletCapital,
  selectLiabilityCapacity,
  type GhostWalletCapitalComposition,
  type GhostWalletCapitalQuote,
} from './capital-fabric.js';
import { buildMatchedIntentPairTransaction } from './ghost-wallet-builder.js';
import { ensureGhostWalletInfrastructure } from './ghost-wallet-infrastructure-manager.js';
import {
  ghostWalletIntentBook,
  type GhostWalletMatchedIntentPair,
  type GhostWalletSignedIntent,
} from './intent-book.js';
import {
  buildGhostWalletRuntimeContext,
  loadGhostWalletSourceConfig,
  measureConfiguredGhostWalletSources,
  type GhostWalletSourceConfig,
} from './onchain-capital-sources.js';
import { serializeMatchedIntentPair } from './ghost-wallet-work-codec.js';
import { enqueueGhostWalletWork } from './ghost-wallet-work-ledger.js';
import { ghostWalletWorkSignal } from './ghost-wallet-work-signal.js';

const ERC20_BALANCE_ABI = ['function balanceOf(address account) view returns (uint256)'];
const INTERMEDIARY_IDENTITY_ABI = ['function profitRecipient() view returns (address)'];
const MATCHED_INTENT_EVENT_INTERFACE = new utils.Interface([
  'event MatchedIntentPairSettled(address indexed ownerA,address indexed ownerB,address tokenA,address tokenB,uint256 feeA,uint256 feeB,address profitRecipient)',
]);

type GhostWalletSponsoredRuntime = {
  getGasFundingDecision: (chain: any) => Promise<{
    mode: 'sponsored' | 'native' | 'unavailable';
    paymentSource?: string;
    strictZeroInitialCapitalEligible?: boolean;
    operatorMonetaryInputRequired?: boolean;
    sponsorOperatorMonetaryCostProvenZero?: boolean;
    reason?: string;
  }>;
  gasSponsor: {
    execute: (input: {
      wallet: Wallet;
      chainId: number;
      calls: Array<{ to: string; data: string; value?: BigNumber }>;
      timeoutMs: number;
    }) => Promise<{ transactionHash: string }>;
  };
};

export interface GhostWalletMatchedSettlement {
  pairId: string;
  chain: string;
  transactionHash: string;
  blockNumber: number | null;
  profits: Array<{ asset: string; amount: bigint }>;
  profitRecipient: string;
}

export interface GhostWalletEngineStatus {
  running: boolean;
  liveExecutionEnabled: boolean;
  eventDriven: true;
  periodicWorkPolling: false;
  profitLadderAuthority: false;
  profitRouting: '100_percent_realized_net_direct_to_canonical_wallet';
  configuredIntermediaryChains: string[];
  measuredCapitalQuotes: number;
  openSignedIntents: number;
  matchedIntentPairs: number;
  executionsAttempted: number;
  executionsSettled: number;
  executionsFailed: number;
  lastRefreshAt: number | null;
  lastExecutionAt: number | null;
  sourceErrors: Array<{ source: string; chain?: string; error: string }>;
}

function receiptConfirmations(): number {
  const configured = Number(process.env.GHOST_WALLET_RECEIPT_CONFIRMATIONS || 1);
  return Number.isFinite(configured)
    ? Math.max(1, Math.min(12, Math.trunc(configured)))
    : 1;
}

/**
 * Ghost Wallet is a separate business/execution lane. It never inherits the
 * arbitrage live switch. Production activation requires its own explicit switch
 * and confirmation, which can be set by deployment automation without manual UI
 * work. NO_EXECUTION remains a global emergency stop.
 */
function liveExecutionEnabled(): boolean {
  return process.env.GHOST_WALLET_LIVE_EXECUTION?.trim().toLowerCase() === 'true'
    && process.env.GHOST_WALLET_LIVE_CONFIRMATION === 'I_ACCEPT_GHOST_WALLET_ATOMIC_CREDIT_RISK'
    && process.env.NO_EXECUTION?.trim().toLowerCase() !== 'true';
}

function normalizeChain(value: string): string {
  return value.trim().toLowerCase();
}

function bigint(value: any): bigint {
  return BigInt(value.toString());
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export class GhostWalletEngine {
  private running = false;
  private config: GhostWalletSourceConfig = {
    intermediaries: [],
    aaveDelegations: [],
    eulerDebtAssumptions: [],
    capitalVaults: [],
  };
  private quotes: GhostWalletCapitalQuote[] = [];
  private sourceErrors: Array<{ source: string; chain?: string; error: string }> = [];
  private infrastructureErrors: Array<{ source: string; chain?: string; error: string }> = [];
  private lastRefreshAt: number | null = null;
  private lastExecutionAt: number | null = null;
  private executionsAttempted = 0;
  private executionsSettled = 0;
  private executionsFailed = 0;
  private readonly inFlightPairs = new Set<string>();

  async start(): Promise<void> {
    if (this.running) return;
    await zeroCapitalEngine.initialize();

    const profitRecipient = resolvePrimaryProfitPayoutAddress();
    if (liveExecutionEnabled() && profitRecipient) {
      const bootstrap = await ensureGhostWalletInfrastructure({
        runtime: zeroCapitalEngine as unknown as Parameters<typeof ensureGhostWalletInfrastructure>[0]['runtime'],
        profitRecipient,
      });
      this.infrastructureErrors = bootstrap.errors.map(error => ({
        source: 'ghost_wallet_auto_bootstrap',
        chain: error.chain,
        error: error.error,
      }));
      logger.info('[GhostWallet] Automatic infrastructure bootstrap completed', {
        component: 'GhostWalletEngine',
        configuredChains: bootstrap.records.map(record => record.chain),
        verifiedIntermediaries: bootstrap.records.map(record => record.intermediary),
        verifiedVaultCount: bootstrap.records.reduce((sum, record) => sum + record.vaults.length, 0),
        manualRailwayConfigurationRequired: false,
        personalGasSpent: false,
        arbitrageSystemOwnedGasSpent: false,
        providerSponsoredBootstrapOnly: true,
        errors: bootstrap.errors,
      });
    } else {
      this.infrastructureErrors = [];
    }

    this.config = loadGhostWalletSourceConfig();
    this.running = true;
    await this.refresh();
    await this.enqueueReadyIntentPairWork();

    logger.info('[GhostWallet] Independent atomic intermediation lane started', {
      component: 'GhostWalletEngine',
      configuredIntermediaryChains: this.config.intermediaries.map(entry => entry.chain),
      capitalPrimitives: [
        'euler_debt_assumption',
        'aave_credit_delegation',
        'signed_intent_capital',
        'coincidence_of_wants',
        'permissionless_vault_capital',
      ],
      existingArbitrageCapitalSourcesPreserved: true,
      manualRailwayConfigurationRequired: false,
      publicAddressConfigurationAuthority: 'deterministic_create2_runtime_bootstrap',
      repaymentPolicy: 'same_transaction_or_revert',
      profitRouting: '100_percent_realized_net_direct_to_canonical_wallet',
      profitLadderAuthority: false,
      arbitrageScheduleAuthority: false,
      periodicWorkPolling: false,
      eventDrivenWorker: true,
      personalGasFallbackAllowed: false,
      arbitrageSystemOwnedGasFallbackAllowed: false,
      matchedIntentExecutionGasAuthority: 'provider_sponsored_zero_operator_cost_only',
      infrastructureGasAuthority: 'provider_sponsored_zero_operator_cost_only',
      publicVaultBrokerCallerPaysGas: true,
      liveExecutionAuthority: 'ghost_wallet_dedicated_switch_only',
      liveExecutionEnabled: liveExecutionEnabled(),
    });
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  isLiveExecutionEnabled(): boolean {
    return liveExecutionEnabled();
  }

  async refresh(): Promise<void> {
    this.config = loadGhostWalletSourceConfig();
    const providersByChain = new Map<string, providers.JsonRpcProvider>();
    for (const [chain, provider] of zeroCapitalEngine.providers) {
      providersByChain.set(normalizeChain(chain), provider);
    }
    const context = buildGhostWalletRuntimeContext({ providers: providersByChain, config: this.config });
    const measurement = await measureConfiguredGhostWalletSources({ context, config: this.config });
    this.quotes = measurement.quotes;
    this.sourceErrors = measurement.errors;
    this.lastRefreshAt = measurement.observedAt;
  }

  registerSignedIntent(input: GhostWalletSignedIntent): GhostWalletSignedIntent {
    const registered = ghostWalletIntentBook.register(input);
    if (this.running) {
      queueMicrotask(() => {
        void this.enqueueReadyIntentPairWork().catch(error => {
          logger.warn('[GhostWallet] Durable intent-pair enqueue deferred', {
            component: 'GhostWalletEngine',
            error: error instanceof Error ? error.message : String(error),
            directExecutionFallbackUsed: false,
          });
        });
      });
    }
    return registered;
  }

  async enqueueReadyIntentPairWork(): Promise<number> {
    if (!this.running) return 0;
    const pairs = ghostWalletIntentBook.match();
    if (pairs.length === 0) return 0;
    await Promise.all(pairs.map(pair => enqueueGhostWalletWork({
      dedupeKey: `matched-intent:${pair.pairId}`,
      kind: 'matched_intent_settlement',
      chain: pair.chain,
      priority: 1_000,
      notBefore: Date.now(),
      maxAttempts: 24,
      payload: { pair: serializeMatchedIntentPair(pair) as unknown as Record<string, unknown> },
    })));
    ghostWalletWorkSignal.emitWake('local_work_enqueued');
    return pairs.length;
  }

  /** Compatibility name retained; execution is now delegated to durable Ultra Worker work. */
  async executeReadyIntentPairs(): Promise<void> {
    await this.enqueueReadyIntentPairWork();
  }

  getMeasuredCapitalQuotes(): GhostWalletCapitalQuote[] {
    return this.quotes.map(quote => ({
      ...quote,
      provenance: [...quote.provenance],
      metadata: quote.metadata ? { ...quote.metadata } : undefined,
    }));
  }

  composeLiquidCapital(input: {
    chain: string;
    asset: string;
    requiredPrincipal: bigint;
  }): GhostWalletCapitalComposition | null {
    return composeGhostWalletCapital({ ...input, quotes: this.quotes });
  }

  selectDebtAssumption(input: { chain: string; asset: string; requiredCapacity: bigint }): GhostWalletCapitalQuote | null {
    return selectLiabilityCapacity({ ...input, primitive: 'euler_debt_assumption', quotes: this.quotes });
  }

  selectDelegatedCredit(input: { chain: string; asset: string; requiredCapacity: bigint }): GhostWalletCapitalQuote | null {
    return selectLiabilityCapacity({ ...input, primitive: 'aave_credit_delegation', quotes: this.quotes });
  }

  getMatchedIntentPairs(): GhostWalletMatchedIntentPair[] {
    return ghostWalletIntentBook.match();
  }

  getConfiguredIntermediary(chain: string): string | null {
    return this.config.intermediaries.find(entry => normalizeChain(entry.chain) === normalizeChain(chain))?.address || null;
  }

  getProvider(chain: string): providers.JsonRpcProvider | null {
    return zeroCapitalEngine.providers.get(normalizeChain(chain) as any) || null;
  }

  getExecutionWallet(chain: string): Wallet | null {
    return zeroCapitalEngine.executionWallets.get(normalizeChain(chain) as any) || null;
  }

  getStatus(): GhostWalletEngineStatus {
    const matches = ghostWalletIntentBook.match();
    return {
      running: this.running,
      liveExecutionEnabled: liveExecutionEnabled(),
      eventDriven: true,
      periodicWorkPolling: false,
      profitLadderAuthority: false,
      profitRouting: '100_percent_realized_net_direct_to_canonical_wallet',
      configuredIntermediaryChains: this.config.intermediaries.map(entry => entry.chain),
      measuredCapitalQuotes: this.quotes.length,
      openSignedIntents: ghostWalletIntentBook.getOpen().length,
      matchedIntentPairs: matches.length,
      executionsAttempted: this.executionsAttempted,
      executionsSettled: this.executionsSettled,
      executionsFailed: this.executionsFailed,
      lastRefreshAt: this.lastRefreshAt,
      lastExecutionAt: this.lastExecutionAt,
      sourceErrors: [...this.infrastructureErrors, ...this.sourceErrors].map(error => ({ ...error })),
    };
  }

  async executePersistedMatchedPair(
    pair: GhostWalletMatchedIntentPair,
    hooks: { onSubmitted?: (transactionHash: string) => Promise<void> } = {},
  ): Promise<GhostWalletMatchedSettlement> {
    if (!this.running || !liveExecutionEnabled()) throw new Error('GHOST_WALLET_EXECUTION_NOT_ENABLED');
    if (this.inFlightPairs.has(pair.pairId)) throw new Error('GHOST_WALLET_PAIR_ALREADY_IN_FLIGHT');
    this.inFlightPairs.add(pair.pairId);
    try {
      const result = await this.executeMatchedPair(pair, hooks);
      this.executionsSettled += 1;
      this.lastExecutionAt = Date.now();
      return result;
    } catch (error) {
      this.executionsFailed += 1;
      throw error;
    } finally {
      this.inFlightPairs.delete(pair.pairId);
    }
  }

  async reconcileSubmittedMatchedPair(
    pair: GhostWalletMatchedIntentPair,
    transactionHash: string,
  ): Promise<GhostWalletMatchedSettlement | null> {
    const provider = this.getProvider(pair.chain);
    if (!provider) throw new Error(`GHOST_WALLET_PROVIDER_UNAVAILABLE:${pair.chain}`);
    const receipt = await provider.getTransactionReceipt(transactionHash);
    if (!receipt) return null;
    if (receipt.status !== 1) throw new Error('GHOST_WALLET_SUBMITTED_TRANSACTION_REVERTED');
    return this.verifyMatchedIntentReceipt(pair, receipt, resolvePrimaryProfitPayoutAddress() || '');
  }

  private async executeMatchedPair(
    pair: GhostWalletMatchedIntentPair,
    hooks: { onSubmitted?: (transactionHash: string) => Promise<void> },
  ): Promise<GhostWalletMatchedSettlement> {
    if (pair.expiresAt <= Date.now()) throw new Error('GHOST_WALLET_PAIR_EXPIRED');
    const profitRecipient = resolvePrimaryProfitPayoutAddress();
    if (!profitRecipient) throw new Error('GHOST_WALLET_PRIMARY_PAYOUT_UNAVAILABLE');

    const intermediary = this.getConfiguredIntermediary(pair.chain);
    if (!intermediary || !sameAddress(intermediary, pair.intermediary)) {
      throw new Error('GHOST_WALLET_INTERMEDIARY_BINDING_UNAVAILABLE');
    }
    const provider = this.getProvider(pair.chain);
    const wallet = this.getExecutionWallet(pair.chain);
    if (!provider || !wallet) throw new Error(`GHOST_WALLET_RUNTIME_CHAIN_UNAVAILABLE:${pair.chain}`);

    const runtime = zeroCapitalEngine as unknown as GhostWalletSponsoredRuntime;
    const funding = await runtime.getGasFundingDecision(pair.chain as any);
    const sponsoredFree = funding.mode === 'sponsored'
      && funding.paymentSource === 'provider_sponsored'
      && funding.strictZeroInitialCapitalEligible === true
      && funding.operatorMonetaryInputRequired === false
      && funding.sponsorOperatorMonetaryCostProvenZero === true;
    if (!sponsoredFree) {
      throw new Error(`GHOST_WALLET_SPONSORED_GAS_UNAVAILABLE:${funding.reason || funding.mode}`);
    }

    this.executionsAttempted += 1;
    const intermediaryContract = new Contract(intermediary, INTERMEDIARY_IDENTITY_ABI, provider);
    const boundProfitRecipient = utils.getAddress(String(await intermediaryContract.profitRecipient()));
    if (!sameAddress(boundProfitRecipient, profitRecipient)) {
      throw new Error('GHOST_WALLET_INTERMEDIARY_PAYOUT_BINDING_MISMATCH');
    }

    const feeAssetA = pair.intentA.buyToken;
    const feeAssetB = pair.intentB.buyToken;
    const tokenA = new Contract(feeAssetA, ERC20_BALANCE_ABI, provider);
    const tokenB = new Contract(feeAssetB, ERC20_BALANCE_ABI, provider);
    const [beforeA, beforeB] = await Promise.all([
      tokenA.balanceOf(profitRecipient),
      tokenB.balanceOf(profitRecipient),
    ]);

    const prepared = buildMatchedIntentPairTransaction({ intermediary, pair, profitRecipient });
    const envelope = { from: wallet.address, to: prepared.to, data: prepared.data, value: prepared.value };
    await provider.call(envelope);
    const gas = await provider.estimateGas(envelope);
    if (gas.lte(0)) throw new Error('GHOST_WALLET_MATCHED_INTENT_GAS_ESTIMATE_ZERO');

    const network = await provider.getNetwork();
    const sponsored = await runtime.gasSponsor.execute({
      wallet,
      chainId: network.chainId,
      calls: [{ to: prepared.to, data: prepared.data, value: BigNumber.from(prepared.value) }],
      timeoutMs: Math.max(10_000, Number(process.env.GHOST_WALLET_SPONSORED_TX_TIMEOUT_MS || 60_000)),
    });
    if (hooks.onSubmitted) await hooks.onSubmitted(sponsored.transactionHash);

    let receipt = await provider.getTransactionReceipt(sponsored.transactionHash);
    if (!receipt) {
      receipt = await provider.waitForTransaction(
        sponsored.transactionHash,
        receiptConfirmations(),
        Math.max(10_000, Number(process.env.GHOST_WALLET_RECEIPT_TIMEOUT_MS || 60_000)),
      );
    }
    if (!receipt || receipt.status !== 1) throw new Error('GHOST_WALLET_MATCHED_INTENT_NOT_SETTLED');

    const [afterA, afterB] = await Promise.all([
      tokenA.balanceOf(profitRecipient),
      tokenB.balanceOf(profitRecipient),
    ]);
    const realizedA = bigint(afterA) - bigint(beforeA);
    const realizedB = bigint(afterB) - bigint(beforeB);
    if (realizedA !== pair.feeAmountA || realizedB !== pair.feeAmountB) {
      throw new Error(`GHOST_WALLET_PAYOUT_DELTA_MISMATCH:${realizedA}/${realizedB}:${pair.feeAmountA}/${pair.feeAmountB}`);
    }

    const verified = this.verifyMatchedIntentReceipt(pair, receipt, profitRecipient);
    ghostWalletIntentBook.markSettled(pair);
    logger.info('[GhostWallet] Atomic matched-intent settlement terminally verified', {
      component: 'GhostWalletEngine',
      pairId: pair.pairId,
      chain: pair.chain,
      txHash: receipt.transactionHash,
      realizedProfitTokenA: realizedA.toString(),
      realizedProfitTokenB: realizedB.toString(),
      profitRecipient,
      repaymentPolicy: 'same_transaction_or_revert',
      profitRouting: '100_percent_direct_to_primary_before_isolated_eth_conversion',
      profitLadderAuthority: false,
      providerSponsoredOperatorCostProvenZero: true,
      arbitrageExecutionAffected: false,
    });
    return verified;
  }

  private verifyMatchedIntentReceipt(
    pair: GhostWalletMatchedIntentPair,
    receipt: providers.TransactionReceipt,
    expectedProfitRecipient: string,
  ): GhostWalletMatchedSettlement {
    if (!expectedProfitRecipient) throw new Error('GHOST_WALLET_PRIMARY_PAYOUT_UNAVAILABLE');
    let matched = false;
    for (const log of receipt.logs) {
      if (!sameAddress(log.address, pair.intermediary)) continue;
      try {
        const parsed = MATCHED_INTENT_EVENT_INTERFACE.parseLog(log);
        if (parsed.name !== 'MatchedIntentPairSettled') continue;
        const args = parsed.args;
        if (!sameAddress(String(args.ownerA), pair.intentA.owner)) continue;
        if (!sameAddress(String(args.ownerB), pair.intentB.owner)) continue;
        if (!sameAddress(String(args.tokenA), pair.intentA.sellToken)) continue;
        if (!sameAddress(String(args.tokenB), pair.intentA.buyToken)) continue;
        if (bigint(args.feeA) !== pair.feeAmountA || bigint(args.feeB) !== pair.feeAmountB) continue;
        if (!sameAddress(String(args.profitRecipient), expectedProfitRecipient)) continue;
        matched = true;
        break;
      } catch {
        // Ignore unrelated intermediary logs; the exact settlement event is required below.
      }
    }
    if (!matched) throw new Error('GHOST_WALLET_SETTLEMENT_EVENT_MISMATCH');

    return {
      pairId: pair.pairId,
      chain: pair.chain,
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber ?? null,
      profits: [
        ...(pair.feeAmountA > 0n ? [{ asset: pair.intentA.buyToken, amount: pair.feeAmountA }] : []),
        ...(pair.feeAmountB > 0n ? [{ asset: pair.intentB.buyToken, amount: pair.feeAmountB }] : []),
      ],
      profitRecipient: expectedProfitRecipient,
    };
  }
}

export const ghostWalletEngine = new GhostWalletEngine();
