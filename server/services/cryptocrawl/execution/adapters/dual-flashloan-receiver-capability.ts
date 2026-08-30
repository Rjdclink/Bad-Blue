import { Contract, ethers, providers } from 'ethers';
import type { SupportedExecutionChain } from './onchain-payload-builder.js';
import { resolveAaveV3Pool } from './flash-loan-provider-economics.js';
import { resolveSponsoredReceiverVault } from './sponsored-receiver-manager.js';

export interface VerifiedDualFlashLoanReceiverCapability {
  kind: 'aave_balancer_dual_v1';
  chain: SupportedExecutionChain;
  address: string;
  owner: string;
  vault: string;
  pool: string;
  codeHash: string;
  verifiedAt: number;
  provenance: string[];
}

function requireAddress(label: string, value: string): string {
  if (!ethers.utils.isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(value);
}

function parseAddressMap(raw: string | undefined): Partial<Record<SupportedExecutionChain, string>> {
  if (!raw?.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ZERO_CAPITAL_AAVE_BALANCER_DUAL_RECEIVERS must be a JSON object keyed by chain');
  }
  const output: Partial<Record<SupportedExecutionChain, string>> = {};
  for (const [chain, rawAddress] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof rawAddress === 'string' && rawAddress.trim()) {
      output[chain as SupportedExecutionChain] = requireAddress(`dual receiver ${chain}`, rawAddress);
    }
  }
  return output;
}

export function resolveConfiguredDualFlashLoanReceiver(
  chain: SupportedExecutionChain,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const map = parseAddressMap(environment.ZERO_CAPITAL_AAVE_BALANCER_DUAL_RECEIVERS);
  const chainSpecific = environment[`ZERO_CAPITAL_AAVE_BALANCER_DUAL_RECEIVER_${chain.toUpperCase()}`]?.trim();
  const candidate = chainSpecific || map[chain];
  return candidate ? requireAddress(`Aave+Balancer dual receiver for ${chain}`, candidate) : null;
}

export async function verifyDualFlashLoanReceiverCapability(input: {
  chain: SupportedExecutionChain;
  provider: providers.Provider;
  expectedOwner: string;
  address?: string | null;
}): Promise<VerifiedDualFlashLoanReceiverCapability | null> {
  const address = input.address || resolveConfiguredDualFlashLoanReceiver(input.chain);
  if (!address) return null;
  const receiverAddress = requireAddress('dual flash-loan receiver', address);
  const expectedOwner = requireAddress('expected dual receiver owner', input.expectedOwner);
  const expectedVault = resolveSponsoredReceiverVault(input.chain);
  const expectedPool = resolveAaveV3Pool(input.chain);
  if (!expectedVault || !expectedPool) return null;

  const code = await input.provider.getCode(receiverAddress);
  if (code === '0x') return null;
  const contract = new Contract(receiverAddress, [
    'function owner() view returns (address)',
    'function vault() view returns (address)',
    'function pool() view returns (address)',
  ], input.provider);
  const [ownerRaw, vaultRaw, poolRaw] = await Promise.all([
    contract.owner() as Promise<string>,
    contract.vault() as Promise<string>,
    contract.pool() as Promise<string>,
  ]);
  const owner = requireAddress('dual receiver owner', ownerRaw);
  const vault = requireAddress('dual receiver vault', vaultRaw);
  const pool = requireAddress('dual receiver pool', poolRaw);
  if (owner.toLowerCase() !== expectedOwner.toLowerCase()) return null;
  if (vault.toLowerCase() !== expectedVault.toLowerCase()) return null;
  if (pool.toLowerCase() !== expectedPool.toLowerCase()) return null;

  return {
    kind: 'aave_balancer_dual_v1',
    chain: input.chain,
    address: receiverAddress,
    owner,
    vault,
    pool,
    codeHash: ethers.utils.keccak256(code),
    verifiedAt: Date.now(),
    provenance: [
      'dual_receiver_bytecode_present',
      'dual_receiver_owner_verified',
      'balancer_vault_binding_verified',
      'aave_pool_binding_verified',
      'same_asset_nested_atomicity_required',
      'synthetic_evidence:false',
    ],
  };
}
