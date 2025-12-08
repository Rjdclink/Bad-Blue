import { ethers } from 'ethers';
import { ChainId } from './types';
import { SUPPORTED_CHAINS, ERC20_ABI } from './chain-config';

const USER_WALLET = '0x3d9bf00bB691793Cd256563fd14819B395306f62';

export interface WithdrawRequest {
  chain: ChainId;
  token: 'native' | 'USDT' | 'USDC';
  amount: number;
  toAddress: string;
}

export interface DepositInfo {
  chain: ChainId;
  walletAddress: string;
  chainName: string;
  explorer: string;
}

export interface WithdrawResult {
  success: boolean;
  txHash?: string;
  error?: string;
  explorerLink?: string;
}

export class WithdrawDepositManager {
  private wallets: Map<ChainId, ethers.Wallet> = new Map();
  private initialized = false;

  constructor() {
    console.log('[WithdrawDepositManager] Created (inactive)');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!privateKey) {
      console.warn('[WithdrawDepositManager] ⚠️ WALLET_PRIVATE_KEY not set - withdraw disabled');
      return;
    }

    for (const [chainId, config] of Object.entries(SUPPORTED_CHAINS)) {
      try {
        const provider = new ethers.JsonRpcProvider(config.rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);
        this.wallets.set(chainId as ChainId, wallet);
        console.log(`[WithdrawDepositManager] ✓ Wallet ready for ${config.name}`);
      } catch (error) {
        console.error(`[WithdrawDepositManager] ❌ Failed for ${chainId}:`, error);
      }
    }
    this.initialized = true;
    console.log('[WithdrawDepositManager] ✓ Initialized');
  }

  getDepositInfo(chain: ChainId): DepositInfo {
    const config = SUPPORTED_CHAINS[chain];
    return {
      chain,
      walletAddress: USER_WALLET,
      chainName: config.name,
      explorer: config.explorer
    };
  }

  getAllDepositAddresses(): DepositInfo[] {
    return (['polygon', 'arbitrum', 'avalanche', 'bsc'] as ChainId[]).map(c => this.getDepositInfo(c));
  }

  async withdrawNative(chain: ChainId, amount: number, toAddress: string): Promise<WithdrawResult> {
    const wallet = this.wallets.get(chain);
    if (!wallet) return { success: false, error: 'Wallet not initialized. Set WALLET_PRIVATE_KEY.' };
    if (!ethers.isAddress(toAddress)) return { success: false, error: 'Invalid address' };
    if (amount <= 0) return { success: false, error: 'Amount must be > 0' };

    try {
      const tx = await wallet.sendTransaction({
        to: toAddress,
        value: ethers.parseEther(amount.toString())
      });
      const receipt = await tx.wait();
      const txHash = receipt?.hash || tx.hash;
      return { success: true, txHash, explorerLink: this.getExplorerLink(chain, txHash) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async withdrawToken(chain: ChainId, token: 'USDT' | 'USDC', amount: number, toAddress: string): Promise<WithdrawResult> {
    const wallet = this.wallets.get(chain);
    if (!wallet) return { success: false, error: 'Wallet not initialized' };
    if (!ethers.isAddress(toAddress)) return { success: false, error: 'Invalid address' };
    if (amount <= 0) return { success: false, error: 'Amount must be > 0' };

    const config = SUPPORTED_CHAINS[chain];
    const tokenAddress = token === 'USDT' ? config.usdt : config.usdc;

    try {
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
      const decimals = await contract.decimals();
      const amountWei = ethers.parseUnits(amount.toString(), decimals);
      const tx = await contract.transfer(toAddress, amountWei);
      const receipt = await tx.wait();
      const txHash = receipt?.hash || tx.hash;
      return { success: true, txHash, explorerLink: this.getExplorerLink(chain, txHash) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async withdraw(request: WithdrawRequest): Promise<WithdrawResult> {
    if (!this.initialized) return { success: false, error: 'Not initialized. Start system first.' };
    if (request.token === 'native') {
      return this.withdrawNative(request.chain, request.amount, request.toAddress);
    }
    return this.withdrawToken(request.chain, request.token, request.amount, request.toAddress);
  }

  getExplorerLink(chain: ChainId, txHash: string): string {
    return `${SUPPORTED_CHAINS[chain].explorer}/tx/${txHash}`;
  }

  async estimateWithdrawGas(chain: ChainId, token: 'native' | 'USDT' | 'USDC'): Promise<{ gasLimit: number; gasCostUsd: number }> {
    const gasLimits = { native: 21000, USDT: 65000, USDC: 65000 };
    const gasLimit = gasLimits[token];
    const wallet = this.wallets.get(chain);
    if (!wallet?.provider) return { gasLimit, gasCostUsd: 0 };

    try {
      const feeData = await wallet.provider.getFeeData();
      const gasPrice = feeData.gasPrice || BigInt(0);
      const gasCost = parseFloat(ethers.formatEther(gasPrice * BigInt(gasLimit)));
      const prices: Record<ChainId, number> = { polygon: 0.5, arbitrum: 2500, avalanche: 25, bsc: 300 };
      return { gasLimit, gasCostUsd: gasCost * (prices[chain] || 1) };
    } catch {
      return { gasLimit, gasCostUsd: 0 };
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export const withdrawDepositManager = new WithdrawDepositManager();
