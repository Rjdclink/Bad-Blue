import { Contract, providers, utils, Wallet } from 'ethers';
import logger from '../../../logger.js';
import {
  normalizePrivateKey,
  resolvePrimaryProfitPayoutAddress,
  walletFromPrivateKey,
} from '../core/wallet-identity.js';
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
import { ghostWalletProviderMesh } from './ghost-wallet-provider-mesh.js';

const MATCHED_INTENT_EVENT_INTERFACE = new utils.Interface([
  'event MatchedIntentPairSettled(address indexed ownerA,address indexed ownerB,address tokenA,address tokenB,uint256 feeA,uint256 feeB,address profitRecipient)',
]);

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
  providerChains: string[];
  alchemyDependency: false;
  serverTransactionSubmission: false;
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

/**
 * This switch controls Ghost server automation only. The core borrower-funded
 * on-chain bridge is permissionless and does not require a server transaction.
 * NO_EXECUTION remains the global emergency stop for server-originated actions.
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
  private lastRefreshAt: number | null = null;
  private lastExecutionAt: number | null = null;
  private executionsAttempted = 0;
  private executionsSettled = 0;
  private executionsFailed = 0;

  async start(): Promise<void> {
    if (this.running) return;
    await ghostWalletProviderMesh.initialize();
    this.config = loadGhostWalletSourceConfig();
    this.running = true;
    await this.refresh();

    logger.info('[GhostWallet] Independent atomic intermediation lane started', {
      component: 'GhostWalletEngine',
      configuredIntermediaryChains: this.config.intermediaries.map(entry => entry.chain),
      providerChains: ghostWalletProviderMesh.getReadyChains(),
      capitalPrimitives: [
        'permissionless_external_flash_intermediation',
        'aave_v3_flash_intermediation',
        'morpho_blue_flash_intermediation',
        'balancer_v2_flash_intermediation',
        'erc3156_flash_intermediation',
        'euler_debt_assumption_measurement',
        'aave_credit_delegation_measurement',
        'signed_intent_capital',
        'coincidence_of_wants',
        'permissionless_vault_capital',
      ],
      alchemyDependency: false,
      existingArbitrageSystemsAffected: false,
      manualRailwayConfigurationRequired: false,
      coreExecutionGasPayer: 'transaction_initiator',
      operatorInitialCapitalRequired: false,
      serverTransactionSubmission: false,
      repaymentPolicy: 'same_transaction_or_revert',
      profitRouting: '100_percent_realized_net_direct_to_canonical_wallet',
      profitLadderAuthority: false,
      arbitrageScheduleAuthority: false,
      periodicWorkPolling: false,
      eventDrivenWorker: true,
      liveExecutionAuthority: 'ghost_wallet_dedicated_switch_only_for_server_automation',
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
    for (const chain of ghostWalletProviderMesh.getReadyChains()) {
      const provider = ghostWalletProviderMesh.getReadyProvider(chain);
      if (provider) providersByChain.set(chain, provider);
    }
    const context = buildGhostWalletRuntimeContext({ providers: providersByChain, config: this.config });
    const measurement = await measureConfiguredGhostWalletSources({ context, config: this.config });
    this.quotes = measurement.quotes;
    this.sourceErrors = measurement.errors;
    this.lastRefreshAt = measurement.observedAt;
  }

  registerSignedIntent(input: GhostWalletSignedIntent): GhostWalletSignedIntent {
    return ghostWalletIntentBook.register(input);
  }

  /**
   * Signed pairs are intentionally not submitted by the server. Their signatures
   * authorize settlement; any external submitter may pay gas once the intermediary
   * exposes the permissionless settlement entrypoint.
   */
  async enqueueReadyIntentPairWork(): Promise<number> {
    return 0;
  }

  async executeReadyIntentPairs(): Promise<void> {
    // Caller-funded only. No server submission or provider sponsorship fallback.
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

  buildCallerFundedMatchedPair(pair: GhostWalletMatchedIntentPair): { to: string; data: string; value: string } {
    const profitRecipient = resolvePrimaryProfitPayoutAddress();
    if (!profitRecipient) throw new Error('GHOST_WALLET_PRIMARY_PAYOUT_UNAVAILABLE');
    const intermediary = this.getConfiguredIntermediary(pair.chain);
    if (!intermediary || !sameAddress(intermediary, pair.intermediary)) {
      throw new Error('GHOST_WALLET_INTERMEDIARY_BINDING_UNAVAILABLE');
    }
    return buildMatchedIntentPairTransaction({ intermediary, pair, profitRecipient });
  }

  getConfiguredIntermediary(chain: string): string | null {
    return this.config.intermediaries.find(entry => normalizeChain(entry.chain) === normalizeChain(chain))?.address || null;
  }

  getProvider(chain: string): providers.JsonRpcProvider | null {
    return ghostWalletProviderMesh.getReadyProvider(normalizeChain(chain));
  }

  getExecutionWallet(chain: string): Wallet | null {
    const provider = this.getProvider(chain);
    const key = normalizePrivateKey(process.env.WALLET_PRIVATE_KEY) || null;
    if (!provider || !key) return null;
    return walletFromPrivateKey(key).connect(provider);
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
      providerChains: ghostWalletProviderMesh.getReadyChains(),
      alchemyDependency: false,
      serverTransactionSubmission: false,
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

  /** Server submission is intentionally retired; external initiators pay gas. */
  async executePersistedMatchedPair(): Promise<GhostWalletMatchedSettlement> {
    this.executionsAttempted += 1;
    this.executionsFailed += 1;
    throw new Error('GHOST_WALLET_SERVER_SUBMISSION_DISABLED_CALLER_FUNDED_ONLY');
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
    const settlement = this.verifyMatchedIntentReceipt(pair, receipt, resolvePrimaryProfitPayoutAddress() || '');
    this.executionsSettled += 1;
    this.lastExecutionAt = Date.now();
    return settlement;
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
        // unrelated log
      }
    }
    if (!matched) throw new Error('GHOST_WALLET_SETTLEMENT_EVENT_MISMATCH');
    ghostWalletIntentBook.markSettled(pair);
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
