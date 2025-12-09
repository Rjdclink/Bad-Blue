// Wallet Manager - Multi-chain wallet with AES-256 encryption
import { Wallet, providers, utils } from 'ethers';
import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ChainId } from './lux-swarm';

const { JsonRpcProvider } = providers;
const { formatEther, parseEther } = utils;

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

// Load chain configs
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const chainsPath = join(__dirname, '../config/chains.json');
const chainConfigs: Record<ChainId, ChainConfig> = JSON.parse(readFileSync(chainsPath, 'utf-8'));

// Substitute environment variables in RPC URLs
const getRpcUrl = (config: ChainConfig): string => {
  if (config.rpc) return config.rpc;
  if (config.rpcTemplate) {
    return config.rpcTemplate.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] || '');
  }
  throw new Error('No RPC URL configured');
};

class WalletManager {
  private wallet?: Wallet;
  private providers = new Map<ChainId, providers.JsonRpcProvider>();
  private encryptionKey: Buffer;

  constructor() {
    // Derive encryption key from password "CRYPTOCRAWL" (as specified in requirements)
    // NOTE: In production, use environment variable and secure salt from key management system
    const password = process.env.WALLET_ENCRYPTION_PASSWORD || 'CRYPTOCRAWL';
    const salt = process.env.WALLET_ENCRYPTION_SALT || randomBytes(16).toString('hex');
    this.encryptionKey = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  }

  // Initialize wallet from DB or create new
  async initialize(): Promise<WalletData> {
    // Try to load from DB (simplified - in production would query database)
    const stored = this.loadFromDB();
    
    if (stored) {
      const privateKey = this.decrypt(stored.encryptedKey);
      this.wallet = new Wallet(privateKey);
    } else {
      // Create new wallet with random mnemonic
      this.wallet = Wallet.createRandom();
      const encryptedKey = this.encrypt(this.wallet.privateKey);
      const data: WalletData = {
        address: this.wallet.address,
        encryptedKey,
        mnemonic: this.wallet.mnemonic?.phrase,
        chains: Object.keys(chainConfigs) as ChainId[]
      };
      this.saveToDB(data);
    }

    // Connect providers for all chains
    for (const [chainId, config] of Object.entries(chainConfigs)) {
      const rpcUrl = getRpcUrl(config);
      const provider = new JsonRpcProvider(rpcUrl);
      this.providers.set(chainId as ChainId, provider);
    }

    return {
      address: this.wallet.address,
      encryptedKey: this.encrypt(this.wallet.privateKey),
      chains: Array.from(this.providers.keys())
    };
  }

  // Get wallet connected to specific chain
  getWallet(chain: ChainId): ConnectedWallet {
    const provider = this.providers.get(chain);
    if (!provider || !this.wallet) throw new Error(`Chain ${chain} not initialized`);
    return this.wallet.connect(provider) as ConnectedWallet;
  }

  // Fetch balances across all chains
  async getBalances(): Promise<ChainBalance[]> {
    if (!this.wallet) throw new Error('Wallet not initialized');
    
    const balances = await Promise.all(
      Array.from(this.providers.entries()).map(async ([chain, provider]) => {
        const balance = await provider.getBalance(this.wallet!.address);
        const config = chainConfigs[chain];
        return {
          chain,
          token: config.nativeToken,
          balance: formatEther(balance),
          balanceWei: balance.toString()
        };
      })
    );
    
    return balances;
  }

  // Withdraw native tokens
  async withdraw({ chain, to, amount }: WithdrawParams): Promise<string> {
    const wallet = this.getWallet(chain);
    const config = chainConfigs[chain];
    
    const tx = await wallet.sendTransaction({
      to,
      value: parseEther(amount),
      gasLimit: 21000
    });
    
    console.log(`[WALLET] Withdraw on ${chain}: ${amount} ${config.nativeToken} to ${to}`);
    return tx.hash;
  }

  // AES-256-CBC encryption
  private encrypt(text: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  // AES-256-CBC decryption
  private decrypt(encrypted: string): string {
    const [ivHex, encryptedHex] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encryptedBuffer = Buffer.from(encryptedHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
    return decrypted.toString('utf8');
  }

  // DB operations (simplified - would use actual database in production)
  private loadFromDB(): WalletData | null {
    // In production: SELECT * FROM crypto_wallets WHERE id = 'main'
    return null;
  }

  private saveToDB(data: WalletData): void {
    // In production: INSERT INTO crypto_wallets VALUES (...)
    console.log('[WALLET] Created new wallet:', data.address);
  }
}

export { WalletManager, type WalletData, type ChainBalance, type WithdrawParams, type ConnectedWallet };
