import { Contract, ethers, type providers } from 'ethers';
import logger from '../../../logger.js';
import { zeroCapitalEngine, type SupportedChain } from '../core/zero-capital-engine.js';
import { resolvePrimaryProfitPayoutAddress } from '../core/wallet-identity.js';

const GHOST_WALLET_ABI = [
  'function profitRecipient() view returns (address)',
  'function paused() view returns (bool)',
  'function maxFlashLoan(address token) view returns (uint256)',
  'function flashFee(address token,uint256 amount) view returns (uint256)',
  'event GhostWalletIntermediationSettled(address indexed initiator,address indexed receiver,address indexed token,uint256 principal,uint256 quotedFee,uint256 realizedSurplus,address profitRecipient,uint8 sourceKind)',
];

const CHAINS: readonly SupportedChain[] = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'bsc', 'avalanche'];

export interface GhostWalletAssetSnapshot {
  token: string;
  availableBalanceLiquidity: string;
  quotedFeeBps: number | null;
  observedAt: number;
}

export interface GhostWalletContractSnapshot {
  chain: SupportedChain;
  contractAddress: string;
  codePresent: boolean;
  paused: boolean | null;
  profitRecipient: string | null;
  payoutMatchesPrimary: boolean;
  ready: boolean;
  assets: GhostWalletAssetSnapshot[];
  reason: string;
  observedAt: number;
}

export interface GhostWalletEngineState {
  running: boolean;
  configuredContracts: number;
  readyContracts: number;
  lastRefreshAt: number | null;
  lastError: string | null;
  contracts: GhostWalletContractSnapshot[];
  profitLadderAuthority: false;
  exchangeScheduleAuthority: false;
  exchangeDailyLimitsApplicableToPureOnchainLane: false;
  payoutMode: 'same_transaction_realized_surplus_to_primary_wallet';
  executionAuthority: false;
}

function intervalMs(): number {
  const parsed = Number(process.env.GHOST_WALLET_REFRESH_MS || 15_000);
  return Number.isFinite(parsed) ? Math.max(5_000, Math.min(120_000, Math.trunc(parsed))) : 15_000;
}

function configuredAddress(chain: SupportedChain): string | null {
  const raw = process.env[`GHOST_WALLET_INTERMEDIARY_${chain.toUpperCase()}`]?.trim();
  if (!raw) return null;
  try {
    return ethers.utils.getAddress(raw);
  } catch {
    return null;
  }
}

function configuredAssets(chain: SupportedChain): string[] {
  const raw = process.env[`GHOST_WALLET_ASSETS_${chain.toUpperCase()}`] || '';
  const assets: string[] = [];
  for (const token of raw.split(',').map(value => value.trim()).filter(Boolean)) {
    try {
      const normalized = ethers.utils.getAddress(token);
      if (!assets.some(value => value.toLowerCase() === normalized.toLowerCase())) assets.push(normalized);
    } catch {
      // Invalid asset configuration is reflected by absence from the measured snapshot.
    }
  }
  return assets;
}

function feeBps(amount: ethers.BigNumber, fee: ethers.BigNumber): number | null {
  if (amount.lte(0)) return null;
  try {
    return Number(fee.mul(10_000_000).div(amount).toString()) / 1_000;
  } catch {
    return null;
  }
}

async function inspectAssets(
  contract: Contract,
  chain: SupportedChain,
): Promise<GhostWalletAssetSnapshot[]> {
  const snapshots: GhostWalletAssetSnapshot[] = [];
  for (const token of configuredAssets(chain)) {
    try {
      const available = await contract.maxFlashLoan(token) as ethers.BigNumber;
      const sample = available.gt(0) ? available : ethers.BigNumber.from(1_000_000);
      const fee = await contract.flashFee(token, sample) as ethers.BigNumber;
      snapshots.push({
        token,
        availableBalanceLiquidity: available.toString(),
        quotedFeeBps: feeBps(sample, fee),
        observedAt: Date.now(),
      });
    } catch (error) {
      logger.debug('[GhostWallet] Asset policy could not be measured', {
        component: 'GhostWalletEngine',
        chain,
        token,
        error: error instanceof Error ? error.message : String(error),
        executionAuthority: false,
      });
    }
  }
  return snapshots;
}

async function inspectContract(
  chain: SupportedChain,
  provider: providers.JsonRpcProvider,
  address: string,
  primaryRecipient: string | null,
): Promise<GhostWalletContractSnapshot> {
  const observedAt = Date.now();
  const code = await provider.getCode(address);
  if (!code || code === '0x') {
    return {
      chain,
      contractAddress: address,
      codePresent: false,
      paused: null,
      profitRecipient: null,
      payoutMatchesPrimary: false,
      ready: false,
      assets: [],
      reason: 'configured Ghost Wallet address has no deployed bytecode',
      observedAt,
    };
  }

  const contract = new Contract(address, GHOST_WALLET_ABI, provider);
  const [recipientRaw, pausedRaw] = await Promise.all([
    contract.profitRecipient() as Promise<string>,
    contract.paused() as Promise<boolean>,
  ]);
  const recipient = ethers.utils.getAddress(recipientRaw);
  const payoutMatchesPrimary = Boolean(primaryRecipient)
    && recipient.toLowerCase() === primaryRecipient!.toLowerCase();
  const assets = await inspectAssets(contract, chain);
  const ready = !pausedRaw && payoutMatchesPrimary;

  return {
    chain,
    contractAddress: address,
    codePresent: true,
    paused: pausedRaw,
    profitRecipient: recipient,
    payoutMatchesPrimary,
    ready,
    assets,
    reason: ready
      ? 'deployed contract is unpaused and same-transaction surplus recipient matches the canonical primary wallet'
      : pausedRaw
        ? 'Ghost Wallet contract is paused'
        : 'Ghost Wallet profit recipient does not match the canonical primary wallet',
    observedAt,
  };
}

class GhostWalletEngine {
  private timer: NodeJS.Timeout | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private state: GhostWalletEngineState = {
    running: false,
    configuredContracts: 0,
    readyContracts: 0,
    lastRefreshAt: null,
    lastError: null,
    contracts: [],
    profitLadderAuthority: false,
    exchangeScheduleAuthority: false,
    exchangeDailyLimitsApplicableToPureOnchainLane: false,
    payoutMode: 'same_transaction_realized_surplus_to_primary_wallet',
    executionAuthority: false,
  };

  async start(): Promise<void> {
    if (this.state.running) return;
    this.state.running = true;
    await this.refresh();
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.refresh().catch(error => {
          this.state.lastError = error instanceof Error ? error.message : String(error);
        });
      }, intervalMs());
      this.timer.unref?.();
    }
    logger.info('[GhostWallet] Independent atomic credit-intermediation observer started', {
      component: 'GhostWalletEngine',
      profitLadderAuthority: false,
      exchangeScheduleAuthority: false,
      payoutMode: this.state.payoutMode,
      runtimeTransactionSubmission: false,
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state.running = false;
  }

  async refresh(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.refreshOnce().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async refreshOnce(): Promise<void> {
    const primaryRecipient = resolvePrimaryProfitPayoutAddress();
    const configured = CHAINS
      .map(chain => ({ chain, address: configuredAddress(chain) }))
      .filter((item): item is { chain: SupportedChain; address: string } => Boolean(item.address));
    const snapshots: GhostWalletContractSnapshot[] = [];
    const failures: string[] = [];

    for (const item of configured) {
      const provider = zeroCapitalEngine.providers.get(item.chain);
      if (!provider) {
        snapshots.push({
          chain: item.chain,
          contractAddress: item.address,
          codePresent: false,
          paused: null,
          profitRecipient: null,
          payoutMatchesPrimary: false,
          ready: false,
          assets: [],
          reason: 'canonical chain provider is not initialized yet',
          observedAt: Date.now(),
        });
        continue;
      }
      try {
        snapshots.push(await inspectContract(item.chain, provider, item.address, primaryRecipient));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${item.chain}:${message}`);
        snapshots.push({
          chain: item.chain,
          contractAddress: item.address,
          codePresent: false,
          paused: null,
          profitRecipient: null,
          payoutMatchesPrimary: false,
          ready: false,
          assets: [],
          reason: message,
          observedAt: Date.now(),
        });
      }
    }

    this.state.contracts = snapshots;
    this.state.configuredContracts = configured.length;
    this.state.readyContracts = snapshots.filter(snapshot => snapshot.ready).length;
    this.state.lastRefreshAt = Date.now();
    this.state.lastError = failures.length > 0 ? failures.join('; ') : null;
  }

  getState(): GhostWalletEngineState {
    return {
      ...this.state,
      contracts: this.state.contracts.map(contract => ({
        ...contract,
        assets: contract.assets.map(asset => ({ ...asset })),
      })),
    };
  }
}

export const ghostWalletEngine = new GhostWalletEngine();

/**
 * Canonical runtime installation hook. This observer grants no off-chain execution
 * authority; borrowers invoke the deployed contract directly and failed repayment
 * reverts inside that transaction.
 */
export async function ensureGhostWalletEngineWiring(): Promise<void> {
  await ghostWalletEngine.start();
}
