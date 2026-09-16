import logger from '../../../logger.js';

export type ZeroCapitalNetworkFamily = 'evm' | 'solana' | 'other';
export type ZeroCapitalNetworkRole =
  | 'discovery'
  | 'atomic_principal'
  | 'output_paid_execution'
  | 'self_funded_execution'
  | 'retained_capital'
  | 'capital_transfer';

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
  providerEvidenceReady: boolean;
  feePaymentEvidenceReady: boolean;
  settlementEvidenceReady: boolean;
  executionReady: boolean;
  executionAuthority: false;
  capitalMovementAuthority: false;
  source: 'repo_configured' | 'official_docs_verified' | 'measured_runtime';
  observedAt: number;
  expiresAt: number;
  provenance: string[];
  reason: string;
}

const capabilities = new Map<string, ZeroCapitalNetworkCapability>();
const CONFIG_TTL_MS = 24 * 60 * 60_000;

function clone(value: ZeroCapitalNetworkCapability): ZeroCapitalNetworkCapability {
  return { ...value, roles: [...value.roles], provenance: [...value.provenance] };
}

function assertAdvisorySafety(value: ZeroCapitalNetworkCapability): void {
  if (value.executionAuthority !== false || value.capitalMovementAuthority !== false) {
    throw new Error('Zero-capital network capability registry is advisory only');
  }
  if (value.operatorPrincipalRequired || value.operatorNativeFeeRequired) {
    if (value.bootstrapEligible || value.executionReady) {
      throw new Error('A network requiring operator principal/native fees cannot be zero-capital execution ready');
    }
  }
  if (value.executionReady && (!value.providerEvidenceReady || !value.feePaymentEvidenceReady || !value.settlementEvidenceReady)) {
    throw new Error('executionReady requires provider, zero-personal-fee and terminal-settlement evidence');
  }
  if (!(value.expiresAt > value.observedAt)) throw new Error('Network capability evidence requires bounded freshness');
}

function upsert(value: ZeroCapitalNetworkCapability): void {
  assertAdvisorySafety(value);
  capabilities.set(value.id, clone(value));
}

function seed(input: Omit<ZeroCapitalNetworkCapability, 'observedAt' | 'expiresAt' | 'executionAuthority' | 'capitalMovementAuthority'>): void {
  const observedAt = Date.now();
  upsert({
    ...input,
    observedAt,
    expiresAt: observedAt + CONFIG_TTL_MS,
    executionAuthority: false,
    capitalMovementAuthority: false,
  });
}

for (const [network, chainId] of [
  ['ethereum', 1],
  ['polygon', 137],
  ['arbitrum', 42161],
  ['optimism', 10],
  ['base', 8453],
  ['bsc', 56],
  ['avalanche', 43114],
] as const) {
  seed({
    id: `evm:${network}`,
    family: 'evm',
    network,
    chainId,
    roles: ['discovery', 'atomic_principal', 'output_paid_execution', 'self_funded_execution', 'retained_capital', 'capital_transfer'],
    bootstrapEligible: false,
    operatorPrincipalRequired: false,
    operatorNativeFeeRequired: false,
    requiresSystemOwnedCapital: false,
    providerEvidenceReady: false,
    feePaymentEvidenceReady: false,
    settlementEvidenceReady: false,
    executionReady: false,
    source: 'repo_configured',
    provenance: ['historical_pr520_capability_preserved', 'canonical_runtime_must_supply_fresh_route_local_evidence'],
    reason: 'Configured canonical EVM family. Registry never infers live execution readiness from chain support alone.',
  });
}

for (const [network, chainId, rpcUrl, provenance] of [
  ['berachain', 80094, 'https://rpc.berachain.com', 'berachain_mainnet_chain_id_80094'],
  ['monad', 143, 'https://rpc.monad.xyz', 'monad_mainnet_chain_id_143'],
  ['hyperevm', 999, 'https://rpc.hyperliquid.xyz/evm', 'hyperevm_mainnet_chain_id_999'],
] as const) {
  seed({
    id: `evm:${network}`,
    family: 'evm',
    network,
    chainId,
    rpcUrl,
    roles: ['discovery'],
    bootstrapEligible: false,
    operatorPrincipalRequired: false,
    operatorNativeFeeRequired: false,
    requiresSystemOwnedCapital: false,
    providerEvidenceReady: false,
    feePaymentEvidenceReady: false,
    settlementEvidenceReady: false,
    executionReady: false,
    source: 'official_docs_verified',
    provenance: [provenance, 'official_public_rpc_discovery_fallback', 'execution_fail_closed_until_route_local_zero_capital_proof'],
    reason: `${network} is enabled for route-local discovery and measurement; execution remains disabled until provider, receiver/gas and terminal settlement evidence are measured.`,
  });
}

seed({
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
  providerEvidenceReady: false,
  feePaymentEvidenceReady: false,
  settlementEvidenceReady: false,
  executionReady: false,
  source: 'official_docs_verified',
  provenance: ['sei_mainnet_chain_id_1329', 'sei_official_evm_rpc', 'execution_fail_closed_until_route_local_zero_capital_proof'],
  reason: 'Sei identity is verified for advisory discovery/measurement only; no zero-capital execution provider is assumed.',
});

seed({
  id: 'solana:mainnet-beta',
  family: 'solana',
  network: 'solana',
  cluster: 'mainnet-beta',
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  roles: ['discovery'],
  bootstrapEligible: false,
  operatorPrincipalRequired: false,
  operatorNativeFeeRequired: false,
  requiresSystemOwnedCapital: false,
  providerEvidenceReady: false,
  feePaymentEvidenceReady: false,
  settlementEvidenceReady: false,
  executionReady: false,
  source: 'official_docs_verified',
  provenance: ['solana_native_cluster_not_fake_evm_chain_id_zero', 'native_fee_payer_and_terminal_adapter_required'],
  reason: 'Native Solana observation only until signer, non-operator fee payer, funding and terminal settlement are independently proven.',
});

export function listZeroCapitalNetworkCapabilities(now = Date.now()): ZeroCapitalNetworkCapability[] {
  return [...capabilities.values()].filter(value => value.expiresAt > now).map(clone);
}

export function getZeroCapitalNetworkCapability(id: string, now = Date.now()): ZeroCapitalNetworkCapability | null {
  const value = capabilities.get(id);
  return value && value.expiresAt > now ? clone(value) : null;
}

export function recordMeasuredNetworkCapability(update: ZeroCapitalNetworkCapability): void {
  const measured = { ...update, source: 'measured_runtime' as const, provenance: [...new Set(update.provenance || [])] };
  assertAdvisorySafety(measured);
  capabilities.set(measured.id, clone(measured));
  logger.info('[ZeroInitialCapital] Measured advisory network capability updated', {
    component: 'ZeroCapitalNetworkCapabilityRegistry',
    id: measured.id,
    network: measured.network,
    roles: measured.roles,
    bootstrapEligible: measured.bootstrapEligible,
    executionReady: measured.executionReady,
    providerEvidenceReady: measured.providerEvidenceReady,
    feePaymentEvidenceReady: measured.feePaymentEvidenceReady,
    settlementEvidenceReady: measured.settlementEvidenceReady,
    operatorPrincipalRequired: measured.operatorPrincipalRequired,
    operatorNativeFeeRequired: measured.operatorNativeFeeRequired,
    executionAuthority: false,
    capitalMovementAuthority: false,
  });
}
