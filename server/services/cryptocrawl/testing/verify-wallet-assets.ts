/**
 * CRYPTOCRAWL Wallet Asset Verification
 * 
 * Verifies assets across all supported chains:
 * - Polygon (POL + USDT + USDC)
 * - Arbitrum (ETH + USDT + USDC)
 * - Avalanche (AVAX + USDT + USDC)
 * - BSC (BNB + USDT + USDC)
 * 
 * Run: npx tsx server/services/cryptocrawl/testing/verify-wallet-assets.ts
 */

import { ethers, providers, Contract } from 'ethers';
import { SUPPORTED_CHAINS, ERC20_ABI, USER_WALLET, FALLBACK_PRICES } from '../bridge/chain-config.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import type { ChainId } from '../bridge/types.js';

const { JsonRpcProvider } = providers;
const { formatEther, formatUnits } = ethers.utils;

interface ChainBalance {
  chain: string;
  chainId: number;
  native: {
    symbol: string;
    balance: string;
    usdValue: number;
  };
  usdt: {
    balance: string;
    usdValue: number;
  };
  usdc: {
    balance: string;
    usdValue: number;
  };
  totalUsd: number;
  explorer: string;
  status: 'success' | 'error';
  error?: string;
}

interface WalletSummary {
  walletAddress: string;
  timestamp: string;
  chains: ChainBalance[];
  totalPortfolioUsd: number;
  assetBreakdown: {
    nativeTokensUsd: number;
    stablecoinsUsd: number;
  };
}

// Fetch real-time prices from CoinGecko
async function fetchPrices(): Promise<Map<string, number>> {
  try {
    const prices = await coinGeckoPriceClient.getSymbolPrices(
      ['POL', 'ETH', 'AVAX', 'BNB', 'USDT', 'USDC'],
      FALLBACK_PRICES,
    );
    console.log('✅ Real-time prices fetched from CoinGecko (cached + rate-limited)');
    return prices;
  } catch (error) {
    console.log('⚠️ Using fallback prices (CoinGecko unavailable)');
    return new Map<string, number>(Object.entries(FALLBACK_PRICES));
  }
}

async function getChainBalance(
  chainId: ChainId,
  walletAddress: string,
  prices: Map<string, number>
): Promise<ChainBalance> {
  const config = SUPPORTED_CHAINS[chainId];
  
  const result: ChainBalance = {
    chain: config.name,
    chainId: config.chainId,
    native: { symbol: config.currency, balance: '0', usdValue: 0 },
    usdt: { balance: '0', usdValue: 0 },
    usdc: { balance: '0', usdValue: 0 },
    totalUsd: 0,
    explorer: `${config.explorer}/address/${walletAddress}`,
    status: 'success'
  };
  
  try {
    const provider = new JsonRpcProvider(config.rpcUrl);
    
    // Get native balance
    const nativeBalanceWei = await provider.getBalance(walletAddress);
    const nativeBalance = parseFloat(formatEther(nativeBalanceWei));
    const nativePrice = prices.get(config.currency) || 0;
    result.native.balance = nativeBalance.toFixed(6);
    result.native.usdValue = nativeBalance * nativePrice;
    
    // Get USDT balance
    try {
      const usdtContract = new Contract(config.usdt, ERC20_ABI, provider);
      const usdtBalanceRaw = await usdtContract.balanceOf(walletAddress);
      const usdtDecimals = await usdtContract.decimals();
      const usdtBalance = parseFloat(formatUnits(usdtBalanceRaw, usdtDecimals));
      result.usdt.balance = usdtBalance.toFixed(2);
      result.usdt.usdValue = usdtBalance;
    } catch {
      result.usdt.balance = '0';
      result.usdt.usdValue = 0;
    }
    
    // Get USDC balance
    try {
      const usdcContract = new Contract(config.usdc, ERC20_ABI, provider);
      const usdcBalanceRaw = await usdcContract.balanceOf(walletAddress);
      const usdcDecimals = await usdcContract.decimals();
      const usdcBalance = parseFloat(formatUnits(usdcBalanceRaw, usdcDecimals));
      result.usdc.balance = usdcBalance.toFixed(2);
      result.usdc.usdValue = usdcBalance;
    } catch {
      result.usdc.balance = '0';
      result.usdc.usdValue = 0;
    }
    
    result.totalUsd = result.native.usdValue + result.usdt.usdValue + result.usdc.usdValue;
    
  } catch (error: any) {
    result.status = 'error';
    result.error = error.message;
  }
  
  return result;
}

async function verifyWalletAssets(): Promise<void> {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║       CRYPTOCRAWL WALLET ASSET VERIFICATION                   ║');
  console.log('║       Real-Time Multi-Chain Balance Check                     ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  
  // Check wallet address
  const walletAddress = USER_WALLET || process.env.BRIDGE_WALLET_ADDRESS;
  
  if (!walletAddress) {
    console.log('❌ NO WALLET ADDRESS CONFIGURED\n');
    console.log('To verify wallet assets, set one of the following environment variables:');
    console.log('  • BRIDGE_WALLET_ADDRESS=0xYourWalletAddress');
    console.log('\nExample:');
    console.log('  BRIDGE_WALLET_ADDRESS=0x742d35Cc6634C0532925a3b844Bc9e7595f... npx tsx server/services/cryptocrawl/testing/verify-wallet-assets.ts\n');
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   SUPPORTED CHAINS FOR ASSET VERIFICATION:');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    for (const [chainId, config] of Object.entries(SUPPORTED_CHAINS)) {
      console.log(`   📍 ${config.name} (Chain ID: ${config.chainId})`);
      console.log(`      Native: ${config.currency}`);
      console.log(`      USDT: ${config.usdt}`);
      console.log(`      USDC: ${config.usdc}`);
      console.log(`      Explorer: ${config.explorer}\n`);
    }
    
    process.exit(1);
  }
  
  console.log(`🔍 Wallet Address: ${walletAddress}\n`);
  console.log('Fetching balances across all chains...\n');
  
  // Fetch prices
  const prices = await fetchPrices();
  
  // Get balances for all chains
  const chains: ChainId[] = ['polygon', 'arbitrum', 'avalanche', 'bsc'];
  const balances: ChainBalance[] = [];
  
  for (const chainId of chains) {
    process.stdout.write(`   Checking ${SUPPORTED_CHAINS[chainId].name}... `);
    const balance = await getChainBalance(chainId, walletAddress, prices);
    balances.push(balance);
    
    if (balance.status === 'success') {
      console.log(`✅ $${balance.totalUsd.toFixed(2)}`);
    } else {
      console.log(`❌ Error: ${balance.error}`);
    }
  }
  
  // Calculate totals
  const totalPortfolioUsd = balances.reduce((sum, b) => sum + b.totalUsd, 0);
  const nativeTokensUsd = balances.reduce((sum, b) => sum + b.native.usdValue, 0);
  const stablecoinsUsd = balances.reduce((sum, b) => sum + b.usdt.usdValue + b.usdc.usdValue, 0);
  
  // Display detailed results
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    DETAILED BALANCES');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  for (const balance of balances) {
    const statusIcon = balance.status === 'success' ? '✅' : '❌';
    console.log(`${statusIcon} ${balance.chain}`);
    
    if (balance.status === 'success') {
      console.log(`   ${balance.native.symbol}: ${balance.native.balance} ($${balance.native.usdValue.toFixed(2)})`);
      console.log(`   USDT: ${balance.usdt.balance} ($${balance.usdt.usdValue.toFixed(2)})`);
      console.log(`   USDC: ${balance.usdc.balance} ($${balance.usdc.usdValue.toFixed(2)})`);
      console.log(`   📊 Chain Total: $${balance.totalUsd.toFixed(2)}`);
      console.log(`   🔗 ${balance.explorer}`);
    } else {
      console.log(`   Error: ${balance.error}`);
    }
    console.log('');
  }
  
  // Portfolio summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    PORTFOLIO SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  console.log(`   💰 Total Portfolio Value: $${totalPortfolioUsd.toFixed(2)}`);
  console.log(`   🪙 Native Tokens: $${nativeTokensUsd.toFixed(2)} (${((nativeTokensUsd/totalPortfolioUsd)*100 || 0).toFixed(1)}%)`);
  console.log(`   💵 Stablecoins: $${stablecoinsUsd.toFixed(2)} (${((stablecoinsUsd/totalPortfolioUsd)*100 || 0).toFixed(1)}%)`);
  
  // Asset distribution
  console.log('\n   📈 Distribution by Chain:');
  for (const balance of balances.filter(b => b.status === 'success' && b.totalUsd > 0)) {
    const percent = ((balance.totalUsd / totalPortfolioUsd) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(parseFloat(percent) / 5));
    console.log(`      ${balance.chain.padEnd(20)} ${bar} ${percent}%`);
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  
  if (totalPortfolioUsd > 0) {
    console.log('   ✅ ASSETS CONFIRMED IN WALLET');
  } else {
    console.log('   ⚠️  NO ASSETS DETECTED - Wallet may be empty or addresses incorrect');
  }
  
  console.log('═══════════════════════════════════════════════════════════════\n');
}

// Run verification
verifyWalletAssets().catch(error => {
  console.error('Verification failed:', error);
  process.exit(1);
});
