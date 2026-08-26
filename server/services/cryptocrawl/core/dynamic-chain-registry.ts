import logger from '../../../logger.js';

export type ChainFamily = 'evm' | 'solana' | 'tron';
export type DynamicChainId =
  | 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'bsc' | 'avalanche'
  | 'solana' | 'tron';

export interface DynamicChainConfig {
  id: DynamicChainId;
  family: ChainFamily;
  rpcUrl: string;
  nativeAsset: string;
  sponsoredBootstrap: boolean;
  executionMode: 'sponsored_or_native' | 'native_only';
}

const DEFINITIONS: ReadonlyArray<Omit<DynamicChainConfig, 'rpcUrl'>> = [
  { id: 'ethereum', family: 'evm', nativeAsset: 'ETH', sponsoredBootstrap: true, executionMode: 'sponsored_or_native' },
  { id: 'polygon', family: 'evm', nativeAsset: 'POL', sponsoredBootstrap: true, executionMode: 'sponsored_or_native' },
  { id: 'arbitrum', family: 'evm', nativeAsset: 'ETH', sponsoredBootstrap: true, executionMode: 'sponsored_or_native' },
  { id: 'optimism', family: 'evm', nativeAsset: 'ETH', sponsoredBootstrap: true, executionMode: 'sponsored_or_native' },
  { id: 'bsc', family: 'evm', nativeAsset: 'BNB', sponsoredBootstrap: false, executionMode: 'native_only' },
  { id: 'avalanche', family: 'evm', nativeAsset: 'AVAX', sponsoredBootstrap: false, executionMode: 'native_only' },
  { id: 'solana', family: 'solana', nativeAsset: 'SOL', sponsoredBootstrap: false, executionMode: 'native_only' },
  { id: 'tron', family: 'tron', nativeAsset: 'TRX', sponsoredBootstrap: false, executionMode: 'native_only' },
];

const ENV: Record<DynamicChainId, string[]> = {
  ethereum: ['ETHEREUM_RPC_URL'], polygon: ['POLYGON_RPC_URL'], arbitrum: ['ARBITRUM_RPC_URL'],
  optimism: ['OPTIMISM_RPC_URL'], bsc: ['BSC_RPC_URL', 'BNB_SMART_CHAIN_RPC_URL'],
  avalanche: ['AVALANCHE_RPC_URL'], solana: ['SOLANA_RPC_URL'], tron: ['TRON_RPC_URL'],
};

export function loadDynamicChainRegistry(): DynamicChainConfig[] {
  const configured: DynamicChainConfig[] = [];
  for (const definition of DEFINITIONS) {
    const rpcUrl = ENV[definition.id].map(name => process.env[name]?.trim()).find(Boolean);
    if (!rpcUrl) continue;
    configured.push({ ...definition, rpcUrl });
  }
  logger.info('[DynamicChainRegistry] Configured RPC networks discovered', {
    component: 'DynamicChainRegistry',
    chains: configured.map(chain => `${chain.id}:${chain.family}`),
  });
  return configured;
}

export function configuredNonEvmChains(): DynamicChainConfig[] {
  return loadDynamicChainRegistry().filter(chain => chain.family !== 'evm');
}
