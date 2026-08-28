// CryptoCrawler wallet signer/provider wrapper.
import { Wallet, providers, utils } from 'ethers';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ChainId } from './lux-swarm';
import { multiProviderRpcManager, type SupportedChain as RpcSupportedChain } from '../api/blockchain-providers.js';
import { assertConfiguredWalletAddress, normalizePrivateKey, walletFromPrivateKey } from './wallet-identity.js';

const { formatEther } = utils;

interface ChainConfig {
  rpc?: string;
  rpcTemplate?: string;
  chainId: number;
  nativeToken: string;
  explorer: string;
  gasMultiplier: number;
  blockTime: number;
  flashLoan: { aave: string; fee: number };
}

export interface WalletData {
  address: string;
  chains: ChainId[];
}

export interface ChainBalance {
  chain: ChainId;
  token: string;
  balance: string;
  balanceWei: string;
}

export interface WithdrawParams {
  chain: ChainId;
  to: string;
  amount: string;
}

export type ConnectedWallet = Wallet;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const chainsPath = join(__dirname, '../config/chains.json');
const chainConfigs: Record<ChainId, ChainConfig> = JSON.parse(readFileSync(chainsPath, 'utf-8'));

const isManagedChain = (chain: string): chain is ChainId & RpcSupportedChain =>
  ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism', 'ethereum'].includes(chain);

/**
 * Holds the configured signer in memory and connects it only to chain-verified
 * providers. This class does not persist, return, or expose private-key material.
 */
export class WalletManager {
  private wallet?: Wallet;
  private providers = new Map<ChainId, providers.JsonRpcProvider>();

  async initialize(): Promise<WalletData> {
    const privateKey = normalizePrivateKey(process.env.WALLET_PRIVATE_KEY);
    if (!privateKey) throw new Error('WALLET_PRIVATE_KEY is required for WalletManager');
    assertConfiguredWalletAddress(privateKey);
    this.wallet = walletFromPrivateKey(privateKey);

    const managedChains = Object.keys(chainConfigs).filter(isManagedChain);
    await multiProviderRpcManager.initialize(managedChains);

    for (const chainId of managedChains) {
      const config = chainConfigs[chainId];
      let managedProvider;
      try {
        managedProvider = await multiProviderRpcManager.getProvider(chainId, 'json_rpc');
      } catch (discoveryError) {
        if (!config.rpc?.trim()) throw discoveryError;
        await multiProviderRpcManager.registerProvider({
          provider: 'WalletConfiguredRPC',
          chain: chainId,
          httpUrl: config.rpc,
          priority: 1,
        });
        managedProvider = await multiProviderRpcManager.getProvider(chainId, 'json_rpc');
      }
      this.providers.set(chainId, managedProvider.http);
    }

    return {
      address: this.wallet.address,
      chains: Array.from(this.providers.keys()),
    };
  }

  getWallet(chain: ChainId): ConnectedWallet {
    const provider = this.providers.get(chain);
    if (!provider || !this.wallet) throw new Error(`Chain ${chain} not initialized`);
    return this.wallet.connect(provider) as ConnectedWallet;
  }

  async getBalances(): Promise<ChainBalance[]> {
    if (!this.wallet) throw new Error('Wallet not initialized');
    return Promise.all(
      Array.from(this.providers.entries()).map(async ([chain, provider]) => {
        const balance = await provider.getBalance(this.wallet!.address);
        const config = chainConfigs[chain];
        return {
          chain,
          token: config.nativeToken,
          balance: formatEther(balance),
          balanceWei: balance.toString(),
        };
      }),
    );
  }

  /**
   * Historical dashboard withdrawal entry point. Keep the signature for compatibility
   * but fail closed; treasury withdrawal is not a CryptoCrawler execution responsibility.
   */
  async withdraw(_params: WithdrawParams): Promise<string> {
    throw new Error('CryptoCrawler direct wallet withdrawal is disabled pending dedicated authenticated governance');
  }
}
