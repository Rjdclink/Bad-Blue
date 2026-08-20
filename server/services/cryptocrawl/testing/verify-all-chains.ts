/**
 * CRYPTOCRAWL Extended Wallet Verification
 * 
 * Checks balances on ALL major EVM chains including Ethereum mainnet
 */

import { ethers, providers, Contract } from 'ethers';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';

const { JsonRpcProvider } = providers;
const { formatEther, formatUnits } = ethers.utils;

const WALLET = process.env.BRIDGE_WALLET_ADDRESS || '0x3d9bf00bB691793Cd256563fd14819B395306f62';

const CHAINS = [
  {
    name: 'Ethereum Mainnet',
    rpc: 'https://eth.llamarpc.com',
    currency: 'ETH',
    explorer: 'https://etherscan.io',
    usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  },
  {
    name: 'Polygon',
    rpc: 'https://polygon-rpc.com',
    currency: 'POL',
    explorer: 'https://polygonscan.com',
    usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
  },
  {
    name: 'Arbitrum',
    rpc: 'https://arb1.arbitrum.io/rpc',
    currency: 'ETH',
    explorer: 'https://arbiscan.io',
    usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    usdc: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'
  },
  {
    name: 'Optimism',
    rpc: 'https://mainnet.optimism.io',
    currency: 'ETH',
    explorer: 'https://optimistic.etherscan.io',
    usdt: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    usdc: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607'
  },
  {
    name: 'Avalanche',
    rpc: 'https://api.avax.network/ext/bc/C/rpc',
    currency: 'AVAX',
    explorer: 'https://snowtrace.io',
    usdt: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
  },
  {
    name: 'BSC',
    rpc: 'https://bsc-dataseed.binance.org',
    currency: 'BNB',
    explorer: 'https://bscscan.com',
    usdt: '0x55d398326f99059fF775485246999027B3197955',
    usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
  },
  {
    name: 'Base',
    rpc: 'https://mainnet.base.org',
    currency: 'ETH',
    explorer: 'https://basescan.org',
    usdt: '0x0000000000000000000000000000000000000000', // No native USDT
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
  }
];

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

const FALLBACK_PRICES: Record<string, number> = {
  'ETH': 3900,
  'POL': 0.50,
  'AVAX': 40,
  'BNB': 700,
  'USDT': 1,
  'USDC': 1
};

async function loadPrices(): Promise<Record<string, number>> {
  const prices = await coinGeckoPriceClient.getSymbolPrices(
    ['ETH', 'POL', 'AVAX', 'BNB', 'USDT', 'USDC'],
    FALLBACK_PRICES,
  );

  return {
    ETH: prices.get('ETH') || FALLBACK_PRICES.ETH,
    POL: prices.get('POL') || FALLBACK_PRICES.POL,
    AVAX: prices.get('AVAX') || FALLBACK_PRICES.AVAX,
    BNB: prices.get('BNB') || FALLBACK_PRICES.BNB,
    USDT: prices.get('USDT') || FALLBACK_PRICES.USDT,
    USDC: prices.get('USDC') || FALLBACK_PRICES.USDC,
  };
}

async function checkChain(chain: typeof CHAINS[0]): Promise<{
  chain: string;
  native: number;
  nativeUsd: number;
  usdt: number;
  usdc: number;
  total: number;
  explorer: string;
}>
{
  return checkChainWithPrices(chain, await loadPrices());
}

async function checkChainWithPrices(chain: typeof CHAINS[0], prices: Record<string, number>): Promise<{
  chain: string;
  native: number;
  nativeUsd: number;
  usdt: number;
  usdc: number;
  total: number;
  explorer: string;
}> {
  const result = {
    chain: chain.name,
    native: 0,
    nativeUsd: 0,
    usdt: 0,
    usdc: 0,
    total: 0,
    explorer: `${chain.explorer}/address/${WALLET}`
  };

  try {
    const provider = new JsonRpcProvider(chain.rpc);
    
    // Native balance
    const nativeBal = await provider.getBalance(WALLET);
    result.native = parseFloat(formatEther(nativeBal));
    result.nativeUsd = result.native * (prices[chain.currency] || 0);
    
    // USDT
    if (chain.usdt !== '0x0000000000000000000000000000000000000000') {
      try {
        const usdtContract = new Contract(chain.usdt, ERC20_ABI, provider);
        const usdtBal = await usdtContract.balanceOf(WALLET);
        const decimals = await usdtContract.decimals();
        result.usdt = parseFloat(formatUnits(usdtBal, decimals));
      } catch {}
    }
    
    // USDC
    try {
      const usdcContract = new Contract(chain.usdc, ERC20_ABI, provider);
      const usdcBal = await usdcContract.balanceOf(WALLET);
      const decimals = await usdcContract.decimals();
      result.usdc = parseFloat(formatUnits(usdcBal, decimals));
    } catch {}
    
    result.total = result.nativeUsd + result.usdt + result.usdc;
    
  } catch (e: any) {
    console.log(`   ⚠️ ${chain.name}: ${e.message?.slice(0, 50)}`);
  }
  
  return result;
}

async function main() {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║       CRYPTOCRAWL FULL CHAIN WALLET SCAN                      ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  console.log(`🔍 Wallet: ${WALLET}\n`);
  console.log('Scanning all EVM chains...\n');

  const prices = await loadPrices();

  let grandTotal = 0;
  const results: Awaited<ReturnType<typeof checkChain>>[] = [];

  for (const chain of CHAINS) {
    process.stdout.write(`   ${chain.name.padEnd(20)}`);
    const result = await checkChainWithPrices(chain, prices);
    results.push(result);
    grandTotal += result.total;
    
    if (result.total > 0) {
      console.log(`✅ $${result.total.toFixed(2)}`);
    } else {
      console.log(`   $0.00`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    ASSETS FOUND');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const chainsWithAssets = results.filter(r => r.total > 0.01);
  
  if (chainsWithAssets.length === 0) {
    console.log('   ⚠️  NO ASSETS DETECTED ON ANY CHAIN');
    console.log('\n   Wallet appears to be empty or unfunded.');
  } else {
    for (const r of chainsWithAssets) {
      console.log(`   ✅ ${r.chain}`);
      if (r.native > 0.0001) console.log(`      Native: ${r.native.toFixed(6)} ($${r.nativeUsd.toFixed(2)})`);
      if (r.usdt > 0.01) console.log(`      USDT: ${r.usdt.toFixed(2)}`);
      if (r.usdc > 0.01) console.log(`      USDC: ${r.usdc.toFixed(2)}`);
      console.log(`      🔗 ${r.explorer}`);
      console.log('');
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`   💰 TOTAL PORTFOLIO VALUE: $${grandTotal.toFixed(2)}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (grandTotal > 0) {
    console.log('   ✅ ASSETS CONFIRMED IN WALLET');
  } else {
    console.log('   ❌ NO ASSETS IN WALLET - FUNDING REQUIRED');
  }
}

main().catch(console.error);
