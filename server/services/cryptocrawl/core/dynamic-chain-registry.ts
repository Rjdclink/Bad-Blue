import logger from '../../../logger.js';

export type ChainFamily = 'evm' | 'solana' | 'tron';
export type DynamicChainId =
  | 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'base' | 'bsc' | 'avalanche'
  | 'berachain' | 'monad' | 'hyperevm'
  | 'solana' | 'tron';

export interface DynamicChainConfig {
  id: DynamicChainId;
  family: ChainFamily;
  rpcUrl: string;
  nativeAsset: string;
  /** True when this chain has a configured hosted-sponsorship execution capability. */
  sponsoredBootstrap: boolean;
  executionMode: 'sponsored_or_native' | 'native_only';
}

/**
 * Hosted sponsorship is the primary zero-initial-capital gas lane where supported,
 * never a zero-cost assumption. Provider-fronted/billed gas remains a canonical
 * economic cost unless independent evidence proves the operator cost is zero.
 * System-owned native gas remains a route-local fallback rather than a prerequisite.
 */
const DEFINITIONS: ReadonlyArray<Omit<DynamicChainConfig, 'rpcUrl'>> = [
  { id: 'ethereum', family: 'evm', nativeAsset: 'ETH', sponsoredBootstrap: true, executionMode: 'sponsored_or_native' },
  { id: 'polygon', family: 'evm', nativeAsset: 'POL', sponsoredBootstrap: true, executionMode: 'sponsored_or_native' },
  { id: 'arbitrum', family: 'evm', nativeAsset: 'ETH', sponsoredBootstrap: true, executionMode: 'sponsored_or_native' },
  { id: 'optimism', family: 'evm', nativeAsset: 'ETH', sponsoredBootstrap: true, executionMode: 'sponsored_or_native' },
  { id: 'base', family: 'evm', nativeAsset: 'ETH', sponsoredBootstrap: true, executionMode: 'sponsored_or_native' },
  { id: 'bsc', family: 'evm', nativeAsset: 'BNB', sponsoredBootstrap: true, executionMode: 'sponsored_or_native' },
  { id: 'avalanche', family: 'evm', nativeAsset: 'AVAX', sponsoredBootstrap: false, executionMode: 'native_only' },
  { id: 'berachain', family: 'evm', nativeAsset: 'BERA', sponsoredBootstrap: false, executionMode: 'native_only' },
  { id: 'monad', family: 'evm', nativeAsset: 'MON', sponsoredBootstrap: false, executionMode: 'native_only' },
  { id: 'hyperevm', family: 'evm', nativeAsset: 'HYPE', sponsoredBootstrap: false, executionMode: 'native_only' },
  { id: 'solana', family: 'solana', nativeAsset: 'SOL', sponsoredBootstrap: false, executionMode: 'native_only' },
  { id: 'tron', family: 'tron', nativeAsset: 'TRX', sponsoredBootstrap: false, executionMode: 'native_only' },
];

const ENV: Record<DynamicChainId, string[]> = {
  ethereum: ['ETHEREUM_RPC_URL', 'ETHEREM_RPC_URL'],
  polygon: ['POLYGON_RPC_URL'],
  arbitrum: ['ARBITRUM_RPC_URL'],
  optimism: ['OPTIMISM_RPC_URL'],
  base: ['BASE_RPC_URL'],
  bsc: ['BSC_RPC_URL', 'BNB_SMART_CHAIN_RPC_URL'],
  avalanche: ['AVALANCHE_RPC_URL'],
  berachain: ['BERACHAIN_RPC_URL'],
  monad: ['MONAD_RPC_URL'],
  hyperevm: ['HYPEREVM_RPC_URL', 'HYPERLIQUID_EVM_RPC_URL'],
  solana: ['SOLANA_RPC_URL'],
  tron: ['TRON_RPC_URL'],
};

/**
 * Official/public endpoints are route-local fallbacks only. They establish chain
 * identity/discovery capability, never execution readiness or sponsored gas.
 */
const PUBLIC_DISCOVERY_FALLBACK: Partial<Record<DynamicChainId, string>> = {
  base: 'https://mainnet.base.org',
  berachain: 'https://rpc.berachain.com',
  monad: 'https://rpc.monad.xyz',
  hyperevm: 'https://rpc.hyperliquid.xyz/evm',
};

export function loadDynamicChainRegistry(): DynamicChainConfig[] {
  const configured: DynamicChainConfig[] = [];
  for (const definition of DEFINITIONS) {
    const configuredRpc = ENV[definition.id].map(name => process.env[name]?.trim()).find(Boolean);
    const rpcUrl = configuredRpc || PUBLIC_DISCOVERY_FALLBACK[definition.id];
    if (!rpcUrl) continue;
    configured.push({ ...definition, rpcUrl });
  }
  logger.info('[DynamicChainRegistry] Configured RPC networks discovered', {
    component: 'DynamicChainRegistry',
    chains: configured.map(chain => `${chain.id}:${chain.family}`),
    hostedSponsorshipPrimaryEligibleChains: configured.filter(chain => chain.sponsoredBootstrap).map(chain => chain.id),
    publicDiscoveryFallbackChains: configured.filter(chain => !ENV[chain.id].some(name => Boolean(process.env[name]?.trim()))).map(chain => chain.id),
    hostedSponsorshipZeroCostAssumed: false,
    providerBillingRetainedInCanonicalEconomics: true,
    systemOwnedNativeGasIsFallback: true,
    receiverCapabilityImpliedGasSponsorship: false,
    executionReadinessImpliedByRpcPresence: false,
  });
  return configured;
}

export function configuredNonEvmChains(): DynamicChainConfig[] {
  return loadDynamicChainRegistry().filter(chain => chain.family !== 'evm');
}
