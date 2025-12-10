// Testnet Chain Configurations for Monte Carlo Testing
// Includes Polygon Amoy and Arbitrum Sepolia testnets for comprehensive simulation
// These configurations enable realistic testnet-based Monte Carlo profitability analysis

export type TestnetChainId = 'polygon-amoy' | 'arbitrum-sepolia';

export interface TestnetChainConfig {
  chainId: number;
  name: string;
  currency: string;
  rpcUrl: string;
  publicRpcUrl: string;
  wsUrl?: string;
  explorer: string;
  faucetUrl: string;
  alchemyTemplate: string;
  // Gas and performance characteristics
  avgBlockTime: number;        // milliseconds
  avgGasPrice: number;         // gwei
  gasLimit: number;            // standard gas limit
  // Testnet-specific parameters
  isTestnet: boolean;
  maxTestTransactions: number; // Daily limit for test transactions
  // Market simulation parameters
  simulatedVolatility: number; // Base volatility for Monte Carlo
  simulatedLiquidity: number;  // Base liquidity score
  simulatedCompetition: number; // MEV bot competition level
}

// Polygon Amoy Testnet Configuration
export const POLYGON_AMOY_CONFIG: TestnetChainConfig = {
  chainId: 80002,
  name: 'Polygon Amoy Testnet',
  currency: 'MATIC',
  rpcUrl: 'https://polygon-amoy.g.alchemy.com/v2/${ALCHEMY_API_KEY}',
  publicRpcUrl: 'https://rpc-amoy.polygon.technology/',
  explorer: 'https://www.oklink.com/amoy',
  faucetUrl: 'https://www.alchemy.com/faucets/polygon-amoy',
  alchemyTemplate: 'https://polygon-amoy.g.alchemy.com/v2/',
  avgBlockTime: 2000,
  avgGasPrice: 30,
  gasLimit: 21000,
  isTestnet: true,
  maxTestTransactions: 1000,
  simulatedVolatility: 0.6,
  simulatedLiquidity: 0.7,
  simulatedCompetition: 0.3,
};

// Arbitrum Sepolia Testnet Configuration
export const ARBITRUM_SEPOLIA_CONFIG: TestnetChainConfig = {
  chainId: 421614,
  name: 'Arbitrum Sepolia Testnet',
  currency: 'ETH',
  rpcUrl: 'https://arb-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}',
  publicRpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
  explorer: 'https://sepolia.arbiscan.io/',
  faucetUrl: 'https://www.alchemy.com/faucets/arbitrum-sepolia',
  alchemyTemplate: 'https://arb-sepolia.g.alchemy.com/v2/',
  avgBlockTime: 250,
  avgGasPrice: 0.1,
  gasLimit: 21000,
  isTestnet: true,
  maxTestTransactions: 1000,
  simulatedVolatility: 0.5,
  simulatedLiquidity: 0.8,
  simulatedCompetition: 0.4,
};

// Combined testnet registry
export const TESTNET_CHAINS: Record<TestnetChainId, TestnetChainConfig> = {
  'polygon-amoy': POLYGON_AMOY_CONFIG,
  'arbitrum-sepolia': ARBITRUM_SEPOLIA_CONFIG,
};

// Market condition presets for testnet simulations
export interface TestnetMarketCondition {
  name: string;
  description: string;
  volatility: number;
  liquidityScore: number;
  gasVolatility: number;
  competitorDensity: number;
  networkCongestion: number;
  expectedWinRate: number;
  expectedSharpeRatio: number;
}

export const TESTNET_MARKET_CONDITIONS: Record<string, TestnetMarketCondition> = {
  // Polygon Amoy scenarios
  polygonAmoyNormal: {
    name: 'Polygon Amoy - Normal Conditions',
    description: 'Standard testnet conditions with moderate activity',
    volatility: 0.6,
    liquidityScore: 0.7,
    gasVolatility: 0.3,
    competitorDensity: 0.3,
    networkCongestion: 0.2,
    expectedWinRate: 0.65,
    expectedSharpeRatio: 1.5,
  },
  polygonAmoyHighVolatility: {
    name: 'Polygon Amoy - High Volatility',
    description: 'Volatile testnet conditions simulating market stress',
    volatility: 1.2,
    liquidityScore: 0.5,
    gasVolatility: 0.8,
    competitorDensity: 0.4,
    networkCongestion: 0.4,
    expectedWinRate: 0.55,
    expectedSharpeRatio: 0.8,
  },
  polygonAmoyLowActivity: {
    name: 'Polygon Amoy - Low Activity',
    description: 'Low activity testnet with reduced competition',
    volatility: 0.3,
    liquidityScore: 0.9,
    gasVolatility: 0.1,
    competitorDensity: 0.1,
    networkCongestion: 0.1,
    expectedWinRate: 0.75,
    expectedSharpeRatio: 2.0,
  },
  
  // Arbitrum Sepolia scenarios
  arbitrumSepoliaNormal: {
    name: 'Arbitrum Sepolia - Normal Conditions',
    description: 'Standard L2 testnet conditions with fast blocks',
    volatility: 0.5,
    liquidityScore: 0.8,
    gasVolatility: 0.2,
    competitorDensity: 0.4,
    networkCongestion: 0.15,
    expectedWinRate: 0.70,
    expectedSharpeRatio: 1.8,
  },
  arbitrumSepoliaHighSpeed: {
    name: 'Arbitrum Sepolia - High Speed',
    description: 'Fast L2 conditions for latency-sensitive strategies',
    volatility: 0.4,
    liquidityScore: 0.85,
    gasVolatility: 0.1,
    competitorDensity: 0.5,
    networkCongestion: 0.1,
    expectedWinRate: 0.72,
    expectedSharpeRatio: 2.2,
  },
  arbitrumSepoliaStress: {
    name: 'Arbitrum Sepolia - Stress Test',
    description: 'High load conditions for resilience testing',
    volatility: 0.9,
    liquidityScore: 0.6,
    gasVolatility: 0.6,
    competitorDensity: 0.6,
    networkCongestion: 0.5,
    expectedWinRate: 0.58,
    expectedSharpeRatio: 1.0,
  },
  
  // Cross-testnet scenarios
  crossTestnetArbitrage: {
    name: 'Cross-Testnet Arbitrage',
    description: 'Simulated cross-chain opportunities between testnets',
    volatility: 0.55,
    liquidityScore: 0.75,
    gasVolatility: 0.35,
    competitorDensity: 0.35,
    networkCongestion: 0.25,
    expectedWinRate: 0.68,
    expectedSharpeRatio: 1.6,
  },
};

// Enhanced strategy profiles for testnet testing
export interface TestnetStrategyProfile {
  name: string;
  baseSuccessRate: number;
  avgProfitPerTrade: number;
  avgLossPerTrade: number;
  tradesPerDay: number;
  gasPerTrade: number;
  slippageTolerance: number;
  executionLatency: number;
  strategyType: 'arbitrage' | 'mev' | 'liquidity' | 'market_making' | 'black_swan' | 'hybrid';
  mlFilterEnabled: boolean;
  multiChainEnabled: boolean;
  mempoolMonitoring: boolean;
  supportedTestnets: TestnetChainId[];
}

export const TESTNET_STRATEGIES: Record<string, TestnetStrategyProfile> = {
  // Polygon Amoy optimized strategies
  polygonAmoyFlashArb: {
    name: 'Polygon Amoy Flash Arbitrage',
    baseSuccessRate: 0.78,
    avgProfitPerTrade: 0.035,
    avgLossPerTrade: 0.008,
    tradesPerDay: 150,
    gasPerTrade: 0.001,
    slippageTolerance: 0.003,
    executionLatency: 20,
    strategyType: 'arbitrage',
    mlFilterEnabled: true,
    multiChainEnabled: false,
    mempoolMonitoring: true,
    supportedTestnets: ['polygon-amoy'],
  },
  
  // Arbitrum Sepolia optimized strategies
  arbitrumSepoliaL2Speed: {
    name: 'Arbitrum Sepolia L2 Speed',
    baseSuccessRate: 0.82,
    avgProfitPerTrade: 0.042,
    avgLossPerTrade: 0.007,
    tradesPerDay: 200,
    gasPerTrade: 0.0005,
    slippageTolerance: 0.002,
    executionLatency: 10,
    strategyType: 'arbitrage',
    mlFilterEnabled: true,
    multiChainEnabled: false,
    mempoolMonitoring: true,
    supportedTestnets: ['arbitrum-sepolia'],
  },
  
  // Cross-testnet strategies
  crossTestnetBridge: {
    name: 'Cross-Testnet Bridge Arbitrage',
    baseSuccessRate: 0.68,
    avgProfitPerTrade: 0.08,
    avgLossPerTrade: 0.02,
    tradesPerDay: 50,
    gasPerTrade: 0.005,
    slippageTolerance: 0.006,
    executionLatency: 150,
    strategyType: 'arbitrage',
    mlFilterEnabled: true,
    multiChainEnabled: true,
    mempoolMonitoring: true,
    supportedTestnets: ['polygon-amoy', 'arbitrum-sepolia'],
  },
  
  // MEV strategies for testnet
  testnetMEVHunter: {
    name: 'Testnet MEV Hunter',
    baseSuccessRate: 0.72,
    avgProfitPerTrade: 0.055,
    avgLossPerTrade: 0.012,
    tradesPerDay: 100,
    gasPerTrade: 0.003,
    slippageTolerance: 0.004,
    executionLatency: 15,
    strategyType: 'mev',
    mlFilterEnabled: true,
    multiChainEnabled: false,
    mempoolMonitoring: true,
    supportedTestnets: ['polygon-amoy', 'arbitrum-sepolia'],
  },
  
  // Market making on testnets
  testnetMarketMaker: {
    name: 'Testnet Market Maker',
    baseSuccessRate: 0.85,
    avgProfitPerTrade: 0.02,
    avgLossPerTrade: 0.004,
    tradesPerDay: 400,
    gasPerTrade: 0.0008,
    slippageTolerance: 0.002,
    executionLatency: 8,
    strategyType: 'market_making',
    mlFilterEnabled: true,
    multiChainEnabled: false,
    mempoolMonitoring: true,
    supportedTestnets: ['polygon-amoy', 'arbitrum-sepolia'],
  },
};

// Utility functions for testnet configuration
export function getTestnetConfig(chainId: TestnetChainId): TestnetChainConfig {
  return TESTNET_CHAINS[chainId];
}

export function getRpcUrl(chainId: TestnetChainId, alchemyApiKey?: string): string {
  const config = TESTNET_CHAINS[chainId];
  if (alchemyApiKey) {
    return config.rpcUrl.replace('${ALCHEMY_API_KEY}', alchemyApiKey);
  }
  return config.publicRpcUrl;
}

export function getMarketCondition(conditionName: string): TestnetMarketCondition | undefined {
  return TESTNET_MARKET_CONDITIONS[conditionName];
}

export function getStrategiesForTestnet(chainId: TestnetChainId): TestnetStrategyProfile[] {
  return Object.values(TESTNET_STRATEGIES).filter(
    strategy => strategy.supportedTestnets.includes(chainId)
  );
}

export function getAllTestnetMarketConditions(): TestnetMarketCondition[] {
  return Object.values(TESTNET_MARKET_CONDITIONS);
}

// Testnet Monte Carlo simulation helper
export interface TestnetSimulationConfig {
  testnet: TestnetChainId;
  marketCondition: string;
  strategy: string;
  iterations: number;
  timeHorizonDays: number;
}

export function createTestnetSimulationConfig(
  testnet: TestnetChainId,
  marketCondition: string = 'normal',
  strategy?: string,
  iterations: number = 10000,
  timeHorizonDays: number = 30
): TestnetSimulationConfig {
  // Auto-select market condition based on testnet
  const conditionKey = testnet === 'polygon-amoy' 
    ? `polygonAmoy${marketCondition.charAt(0).toUpperCase() + marketCondition.slice(1)}`
    : `arbitrumSepolia${marketCondition.charAt(0).toUpperCase() + marketCondition.slice(1)}`;
  
  // Auto-select strategy if not provided
  const strategyKey = strategy || (testnet === 'polygon-amoy' 
    ? 'polygonAmoyFlashArb'
    : 'arbitrumSepoliaL2Speed');
  
  return {
    testnet,
    marketCondition: conditionKey,
    strategy: strategyKey,
    iterations,
    timeHorizonDays,
  };
}

// Export all for easy import
export {
  POLYGON_AMOY_CONFIG as PolygonAmoy,
  ARBITRUM_SEPOLIA_CONFIG as ArbitrumSepolia,
};
