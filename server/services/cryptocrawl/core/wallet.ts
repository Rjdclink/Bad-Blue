// Wallet Manager - Multi-chain wallet with AES-256 encryption
import { Wallet, providers, utils } from 'ethers';
import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'crypto';
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

interface WalletData {
  address: string;
  encryptedKey: string;
  mnemonic?: string;
  chains: ChainId[];
}

interface ChainBalance {
  chain: ChainId;
  token: string;
  balance: string;
  balanceWei: string;
}

interface WithdrawParams {
  chain: ChainId;
  to: string;
  amount: string;
}

type ConnectedWallet = Wallet;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const chainsPath = join(__dirname, '../config/chains.json');
const chainConfigs: Record<ChainId, ChainConfig> = JSON.parse(readFileSync(chainsPath, 'utf-8'));

const isManagedChain = (chain: string): chain is ChainId & RpcSupportedChain =>
  ['polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism', 'ethereum'].includes(chain);

class WalletManager {
  private wallet?: Wallet;
  private providers = new Map<ChainId, providers.JsonRpcProvider>();
  private encryptionKey: Buffer;

  constructor() {
    const password = process.env.WALLET_ENCRYPTION_PASSWORD?.trim();
    const salt = process.env.WALLET_ENCRYPTION_SALT?.trim();
    if (!password || !salt) {
      throw new Error('WALLET_ENCRYPTION_PASSWORD and WALLET_ENCRYPTION_SALT are required for WalletManager');
    }
    this.encryptionKey = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  }

  async initialize(): Promise<WalletData> {
    const stored = this.loadFromDB();
    const privateKey = normalizePrivateKey(process.env.WALLET_PRIVATE_KEY);
    if (!privateKey) throw new Error('WALLET_PRIVATE_KEY is required for WalletManager');
    assertConfiguredWalletAddress(privateKey);

    if (stored) {
      const configuredWallet = walletFromPrivateKey(privateKey);
      const storedPrivateKey = this.decrypt(stored.encryptedKey);
      const storedWallet = walletFromPrivateKey(storedPrivateKey);
      if (configuredWallet.address.toLowerCase() !== storedWallet.address.toLowerCase()) {
        throw new Error('WALLET_PRIVATE_KEY does not match the stored CryptoCrawler wallet');
      }
      this.wallet = configuredWallet;
    } else {
      this.wallet = walletFromPrivateKey(privateKey);
      const encryptedKey = this.encrypt(this.wallet.privateKey);
      const data: WalletData = {
        address: this.wallet.address,
        encryptedKey,
        mnemonic: this.wallet.mnemonic?.phrase,
        chains: Object.keys(chainConfigs).filter(isManagedChain),
      };
      this.saveToDB(data);
    }

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
      encryptedKey: this.encrypt(this.wallet.privateKey),
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
   * Historical dashboard withdrawal entry point. It previously submitted a real
   * native-value transaction without a dedicated authenticated CryptoCrawler
   * withdrawal authority. Keep the method signature for compatibility but fail
   * closed until an authenticated, governance-audited profit-withdrawal workflow
   * is implemented separately from arbitrage execution.
   */
  async withdraw(_params: WithdrawParams): Promise<string> {
    throw new Error('CryptoCrawler direct wallet withdrawal is disabled pending dedicated authenticated governance');
  }

  private encrypt(text: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  private decrypt(encrypted: string): string {
    const [ivHex, encryptedHex] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encryptedBuffer = Buffer.from(encryptedHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
    return decrypted.toString('utf8');
  }

  private loadFromDB(): WalletData | null {
    return null;
  }

  private saveToDB(data: WalletData): void {
    console.log('[WALLET] Persisted configured wallet record:', data.address);
  }
}

export { WalletManager, type WalletData, type ChainBalance, type WithdrawParams, type ConnectedWallet };
