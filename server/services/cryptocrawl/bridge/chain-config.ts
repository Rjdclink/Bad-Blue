import { ChainConfig, ChainId } from './types';

export const SUPPORTED_CHAINS: Record<ChainId, ChainConfig> = {
  polygon: {
    chainId: 137,
    name: 'Polygon Mainnet',
    currency: 'POL',
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    wsUrl: process.env.POLYGON_WS_URL,
    explorer: 'https://polygonscan.com',
    usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
  },
  arbitrum: {
    chainId: 42161,
    name: 'Arbitrum One',
    currency: 'ETH',
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    wsUrl: process.env.ARBITRUM_WS_URL,
    explorer: 'https://arbiscan.io',
    usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    usdc: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'
  },
  avalanche: {
    chainId: 43114,
    name: 'Avalanche C-Chain',
    currency: 'AVAX',
    rpcUrl: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
    wsUrl: process.env.AVALANCHE_WS_URL,
    explorer: 'https://snowtrace.io',
    usdt: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
  },
  bsc: {
    chainId: 56,
    name: 'BNB Smart Chain',
    currency: 'BNB',
    rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
    wsUrl: process.env.BSC_WS_URL,
    explorer: 'https://bscscan.com',
    usdt: '0x55d398326f99059fF775485246999027B3197955',
    usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
  }
};

export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)'
];

export const USER_WALLET = '0x3d9bf00bB691793Cd256563fd14819B395306f62';
