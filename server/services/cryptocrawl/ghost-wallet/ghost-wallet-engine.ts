import { Contract, providers, utils, type Wallet } from 'ethers';
import logger from '../../../logger.js';
import { zeroCapitalEngine } from '../core/zero-capital-engine.js';
import { resolvePrimaryProfitPayoutAddress } from '../core/wallet-identity.js';
import { executeSystemOwnedNativeTransaction } from '../execution/system-owned-native-transaction.js';
import {
  composeGhostWalletCapital,
  selectLiabilityCapacity,
  type GhostWalletCapitalComposition,
  type GhostWalletCapitalQuote,
} from './capital-fabric.js';
import { buildMatchedIntentPairTransaction } from './ghost-wallet-builder.js';
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

const ERC20_BALANCE_ABI = ['function balanceOf(address account) view returns (uint256)'];
const INTERMEDIARY_IDENTITY_ABI = ['function profitRecipient() view returns (address)'];

export interface GhostWalletEngineStatus {
  running: boolean;
  liveExecutionEnabled: boolean;
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

function refreshIntervalMs(): number {
  const configured = Number(process.env.GHOST_WALLET_REFRESH_INTERVAL_MS || 5_000);
  return Number.isFinite(configured)
    ? Math.max(1_000, Math.min(60_000, Math.trunc(configured)))
    : 5_000;
}

function receiptConfirmations(): number {
  const configured = Number(process.env.GHOST_WALLET_RECEIPT_CONFIRMATIONS || 1);
  return Number.isFinite(configured)
    ? Math.max(1, Math.min(12, Math.trunc(configured)))
    : 1;
}

function liveExecutionEnabled(): boolean {
  return process.env.GHOST_WALLET_LIVE_EXECUTION?.trim().toLowerCase() === 'true'
    && process.env.NO_EXECUTION?.trim().toLowerCase() !== 'true';
}

function normalizeChain(value: string): string {
  return value.trim().toLowerCase();
}

function bigint(value: any): bigint {
  return BigInt(value.toString());
}

export class GhostWalletEngine {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private config: GhostWalletSourceConfig = {
    intermediaries: [],
    aaveDelegations: [],
    eulerDebtAssumptions: [],
    capitalVaults: [],
  };
  private quotes: GhostWalletCapitalQuote[] = [];
  private sourceErrors: Array<{ source: string; chain?: string; error: string }> = [];
  private lastRefreshAt: number | null = null;
  private lastExecutionAt: number | null = null;
  private executionsAttempted = 0;
  private executionsSettled = 0;
  private executionsFailed = 0;
  private readonly inFlightPairs = new Set<string>();

  async start(): Promise<void> {
    if (this.running) return;
    this.config = loadGhostWalletSourceConfig();
    await zeroCapitalEngine.initialize();
    this.running = true;
    await this.refresh();
    await this.executeReadyIntentPairs();

    if (process.env.NO_INTERVALS?.trim().toLowerCase() !== 'true') {
      const intervalMs = refreshIntervalMs();
      this.timer = setInterval(() => {
        void this.refresh()
          .then(() => this.executeReadyIntentPairs())
          .catch(error => {
            logger.warn('[GhostWallet] Refresh cycle degraded without affecting CryptoCrawler arbitrage', {
              component: 'GhostWalletEngine',
              error: error instanceof Error ? error.message : String(error),
              arbitrageExecutionAffected: false,
              profitLadderAuthority: false,
            });
          });
      }, intervalMs);
      this.timer.unref?.();
    }

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
      apiKeyRequired: false,
      signupRequired: false,
      repaymentPolicy: 'same_transaction_or_revert',
      profitRouting: '100_percent_realized_net_direct_to_canonical_wallet',
      profitLadderAuthority: false,
      arbitrageScheduleAuthority: false,
      personalGasFallbackAllowed: false,
      publicVaultBrokerCallerPaysGas: true,
      liveExecutionEnabled: liveExecutionEnabled(),
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
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
    if (this.running) queueMicrotask(() => void this.executeReadyIntentPairs());
    return registered;
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

  getStatus(): GhostWalletEngineStatus {
    const matches = ghostWalletIntentBook.match();
    return {
      running: this.running,
      liveExecutionEnabled: liveExecutionEnabled(),
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
      sourceErrors: this.sourceErrors.map(error => ({ ...error })),
    };
  }

  async executeReadyIntentPairs(): Promise<void> {
    if (!this.running || !liveExecutionEnabled()) return;
    const profitRecipient = resolvePrimaryProfitPayoutAddress();
    if (!profitRecipient) {
      logger.warn('[GhostWallet] Live intent settlement withheld because canonical payout wallet is unavailable', {
        component: 'GhostWalletEngine',
        profitLadderAuthority: false,
        executionAuthorityGranted: false,
      });
      return;
    }

    const pairs = ghostWalletIntentBook.match();
    for (const pair of pairs) {
      if (this.inFlightPairs.has(pair.pairId)) continue;
      const intermediary = this.config.intermediaries.find(entry => normalizeChain(entry.chain) === normalizeChain(pair.chain));
      if (!intermediary || intermediary.address.toLowerCase() !== pair.intermediary.toLowerCase()) continue;
      const provider = zeroCapitalEngine.providers.get(pair.chain as any);
      const wallet = zeroCapitalEngine.executionWallets.get(pair.chain as any);
      if (!provider || !wallet) continue;
      this.inFlightPairs.add(pair.pairId);
      try {
        await this.executeMatchedPair({ pair, intermediary: intermediary.address, provider, wallet, profitRecipient });
      } finally {
        this.inFlightPairs.delete(pair.pairId);
      }
    }
  }

  private async executeMatchedPair(input: {
    pair: GhostWalletMatchedIntentPair;
    intermediary: string;
    provider: providers.JsonRpcProvider;
    wallet: Wallet;
    profitRecipient: string;
  }): Promise<void> {
    const { pair, intermediary, provider, wallet, profitRecipient } = input;
    if (pair.expiresAt <= Date.now()) return;
    this.executionsAttempted += 1;

    const intermediaryContract = new Contract(intermediary, INTERMEDIARY_IDENTITY_ABI, provider);
    const boundProfitRecipient = utils.getAddress(String(await intermediaryContract.profitRecipient()));
    if (boundProfitRecipient.toLowerCase() !== profitRecipient.toLowerCase()) {
      this.executionsFailed += 1;
      logger.error('[GhostWallet] Intermediary payout binding disagrees with canonical wallet; execution withheld', {
        component: 'GhostWalletEngine',
        chain: pair.chain,
        intermediary,
        configuredPayout: boundProfitRecipient,
        canonicalPayout: profitRecipient,
        executionAuthorityGranted: false,
      });
      return;
    }

    const tokenA = new Contract(pair.intentA.buyToken, ERC20_BALANCE_ABI, provider);
    const tokenB = new Contract(pair.intentB.buyToken, ERC20_BALANCE_ABI, provider);
    const [beforeA, beforeB] = await Promise.all([
      tokenA.balanceOf(profitRecipient),
      tokenB.balanceOf(profitRecipient),
    ]);

    const prepared = buildMatchedIntentPairTransaction({ intermediary, pair, profitRecipient });
    try {
      await provider.call({ from: wallet.address, to: prepared.to, data: prepared.data, value: prepared.value });
      const gas = await provider.estimateGas({ from: wallet.address, to: prepared.to, data: prepared.data, value: prepared.value });
      const executed = await executeSystemOwnedNativeTransaction({
        chain: pair.chain,
        wallet,
        provider,
        idempotencyKey: `ghost-wallet:intent:${pair.pairId}`,
        purpose: 'ghost_wallet_matched_intent_settlement',
        transaction: {
          to: prepared.to,
          data: prepared.data,
          value: prepared.value,
          gasLimit: gas.mul(120).div(100),
        },
        confirmations: receiptConfirmations(),
      });
      const receipt = executed.receipt;
      if (!receipt || receipt.status !== 1) throw new Error('Ghost Wallet matched-intent transaction did not settle successfully');

      const [afterA, afterB] = await Promise.all([
        tokenA.balanceOf(profitRecipient),
        tokenB.balanceOf(profitRecipient),
      ]);
      const realizedA = bigint(afterA) - bigint(beforeA);
      const realizedB = bigint(afterB) - bigint(beforeB);
      if (realizedA < pair.feeAmountA || realizedB < pair.feeAmountB) {
        throw new Error(`Ghost Wallet payout verification failed: realized ${realizedA}/${realizedB}, expected at least ${pair.feeAmountA}/${pair.feeAmountB}`);
      }

      ghostWalletIntentBook.markSettled(pair);
      this.executionsSettled += 1;
      this.lastExecutionAt = Date.now();
      logger.info('[GhostWallet] Atomic matched-intent settlement terminally verified', {
        component: 'GhostWalletEngine',
        pairId: pair.pairId,
        chain: pair.chain,
        txHash: receipt.transactionHash,
        realizedProfitTokenA: realizedA.toString(),
        realizedProfitTokenB: realizedB.toString(),
        profitRecipient,
        repaymentPolicy: 'same_transaction_or_revert',
        profitRouting: '100_percent_direct_to_wallet',
        profitLadderAuthority: false,
        personalGasFallbackAllowed: false,
        systemOwnedNativeGasSpentWei: executed.actualSpentWei.toString(),
        arbitrageExecutionAffected: false,
      });
    } catch (error) {
      this.executionsFailed += 1;
      logger.warn('[GhostWallet] Atomic matched-intent settlement rejected or failed', {
        component: 'GhostWalletEngine',
        pairId: pair.pairId,
        chain: pair.chain,
        error: error instanceof Error ? error.message : String(error),
        intentStateConsumed: false,
        arbitrageExecutionAffected: false,
        personalGasFallbackAllowed: false,
        profitLadderAuthority: false,
      });
    }
  }
}

export const ghostWalletEngine = new GhostWalletEngine();