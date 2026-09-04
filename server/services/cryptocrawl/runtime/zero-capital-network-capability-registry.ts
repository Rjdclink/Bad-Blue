import logger from '../../../logger.js';

export type ZeroCapitalNetworkFamily = 'evm' | 'solana' | 'defichain' | 'other';
export type ZeroCapitalNetworkRole =
  | 'discovery'
  | 'atomic_principal'
  | 'output_paid_execution'
  | 'self_funded_execution'
  | 'retained_capital'
  | 'fixed_credit'
  | 'collateral_borrow'
  | 'yield_destination';

export interface ZeroCapitalNetworkCapability {
  id: string;
  family: ZeroCapitalNetworkFamily;
  network: string;
  chainId?: number;
  cluster?: string;
  rpcUrl?: string;
  roles: ZeroCapitalNetworkRole[];
  bootstrapEligible: boolean;
  operatorPrincipalRequired: boolean;
  operatorNativeFeeRequired: boolean;
  requiresSystemOwnedCapital: boolean;
  executionReady: boolean;
  executionAuthority: false;
  capitalMovementAuthority: false;
  source: 'repo_verified' | 'official_docs_verified' | 'measured_runtime';
  reason: string;
}

const capabilities = new Map<string, ZeroCapitalNetworkCapability>();

function upsert(capability: ZeroCapitalNetworkCapability): void {
  capabilities.set(capability.id, { ...capability, roles: [...capability.roles] });
}

// Already-supported EVM lanes: preserve existing runtime authority and merely
// expose their capability to the cross-network optimizer.
for (const [network, chainId] of [
  ['ethereum', 1],
  ['polygon', 137],
  ['arbitrum', 42161],
  ['optimism', 10],
  ['base', 8453],
  ['bsc', 56],
  ['avalanche', 43114],
] as const) {
  upsert({
    id: `evm:${network}`,
    family: 'evm',
    network,
    chainId,
    roles: ['discovery', 'atomic_principal', 'output_paid_execution', 'self_funded_execution', 'retained_capital'],
    bootstrapEligible: true,
    operatorPrincipalRequired: false,
    operatorNativeFeeRequired: false,
    requiresSystemOwnedCapital: false,
    executionReady: true,
    executionAuthority: false,
    capitalMovementAuthority: false,
    source: 'repo_verified',
    reason: 'Existing canonical EVM runtime supports this network; actual provider/receiver/funding capability remains measured per opportunity.',
  });
}

// Sei EVM uses standard EVM JSON-RPC, but no Aave deployment or zero-capital
// flash provider is assumed. Discovery can be admitted immediately; execution
// stays capability-gated until exact provider/receiver economics are proven.
upsert({
  id: 'evm:sei',
  family: 'evm',
  network: 'sei',
  chainId: 1329,
  rpcUrl: 'https://evm-rpc.sei-apis.com',
  roles: ['discovery'],
  bootstrapEligible: false,
  operatorPrincipalRequired: false,
  operatorNativeFeeRequired: false,
  requiresSystemOwnedCapital: false,
  executionReady: false,
  executionAuthority: false,
  capitalMovementAuthority: false,
  source: 'official_docs_verified',
  reason: 'Sei EVM RPC/chain identity is known, but zero-capital principal and fee-payment providers must be measured before execution is admitted.',
});

// Solana is deliberately NOT represented as chainId 0. Its cluster identity,
// recent blockhash, account model, fee payer, signatures and settlement evidence
// belong to a native adapter. Jupiter Lend flashloans make atomic-principal
// bootstrap interesting, but live execution remains fail-closed until a Solana
// signer plus non-operator fee-payer/output-paid fee path is proven.
upsert({
  id: 'solana:mainnet-beta',
  family: 'solana',
  network: 'solana',
  cluster: 'mainnet-beta',
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  roles: ['discovery', 'atomic_principal'],
  bootstrapEligible: true,
  operatorPrincipalRequired: false,
  operatorNativeFeeRequired: false,
  requiresSystemOwnedCapital: false,
  executionReady: false,
  executionAuthority: false,
  capitalMovementAuthority: false,
  source: 'official_docs_verified',
  reason: 'Jupiter Lend can supply atomic principal; native signing, fee-payer proof and terminal settlement adapter are required before live execution.',
});

// DeFiChain remains discovery-first because its native execution/settlement model
// is separate and should not consume resources unless measured opportunity value
// justifies the custom integration cost.
upsert({
  id: 'defichain:mainnet',
  family: 'defichain',
  network: 'defichain',
  roles: ['discovery'],
  bootstrapEligible: false,
  operatorPrincipalRequired: false,
  operatorNativeFeeRequired: false,
  requiresSystemOwnedCapital: false,
  executionReady: false,
  executionAuthority: false,
  capitalMovementAuthority: false,
  source: 'official_docs_verified',
  reason: 'Discovery-only until fresh liquidity, routing, signing, fee and terminal-settlement evidence justify a native execution adapter.',
});

export function listZeroCapitalNetworkCapabilities(): ZeroCapitalNetworkCapability[] {
  return [...capabilities.values()].map(value => ({ ...value, roles: [...value.roles] }));
}

export function getZeroCapitalNetworkCapability(id: string): ZeroCapitalNetworkCapability | null {
  const value = capabilities.get(id);
  return value ? { ...value, roles: [...value.roles] } : null;
}

export function recordMeasuredNetworkCapability(update: ZeroCapitalNetworkCapability): void {
  if (update.executionAuthority !== false || update.capitalMovementAuthority !== false) {
    throw new Error('Network capability registry is advisory only');
  }
  upsert({ ...update, source: 'measured_runtime' });
  logger.info('[ZeroInitialCapital] Measured network capability updated', {
    component: 'ZeroCapitalNetworkCapabilityRegistry',
    id: update.id,
    family: update.family,
    network: update.network,
    roles: update.roles,
    bootstrapEligible: update.bootstrapEligible,
    executionReady: update.executionReady,
    executionAuthority: false,
    capitalMovementAuthority: false,
  });
}
