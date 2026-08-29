import { Contract, ethers, providers } from 'ethers';
import type { SupportedExecutionChain } from './onchain-payload-builder.js';
import { resolveAaveV3Pool } from './flash-loan-provider-economics.js';
import { resolveSponsoredReceiverVault } from './sponsored-receiver-manager.js';

export type FlashLoanReceiverCapabilityKind = 'balancer_v1' | 'balancer_composite_v2' | 'aave_v3';

export interface VerifiedFlashLoanReceiverCapability {
  kind: FlashLoanReceiverCapabilityKind;
  chain: SupportedExecutionChain;
  address: string;
  owner: string;
  infrastructure: string;
  codeHash: string;
  verifiedAt: number;
  provenance: string[];
}

function requireAddress(label: string, value: string): string {
  if (!ethers.utils.isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(value);
}

function parseAddressMap(raw: string | undefined, label: string): Partial<Record<SupportedExecutionChain, string>> {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object keyed by chain`);
  const output: Partial<Record<SupportedExecutionChain, string>> = {};
  for (const [chain, rawAddress] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof rawAddress !== 'string' || !rawAddress.trim()) continue;
    output[chain as SupportedExecutionChain] = requireAddress(`${label}.${chain}`, rawAddress);
  }
  return output;
}

export function resolveConfiguredFlashLoanReceiver(
  kind: FlashLoanReceiverCapabilityKind,
  chain: SupportedExecutionChain,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const chainKey = chain.toUpperCase();
  if (kind === 'aave_v3') {
    const map = parseAddressMap(environment.ZERO_CAPITAL_AAVE_V3_RECEIVERS, 'ZERO_CAPITAL_AAVE_V3_RECEIVERS');
    const candidate = environment[`ZERO_CAPITAL_AAVE_V3_RECEIVER_${chainKey}`]?.trim() || map[chain];
    return candidate ? requireAddress(`Aave V3 receiver for ${chain}`, candidate) : null;
  }
  if (kind === 'balancer_composite_v2') {
    const map = parseAddressMap(environment.ZERO_CAPITAL_BALANCER_COMPOSITE_RECEIVERS, 'ZERO_CAPITAL_BALANCER_COMPOSITE_RECEIVERS');
    const candidate = environment[`ZERO_CAPITAL_BALANCER_COMPOSITE_RECEIVER_${chainKey}`]?.trim() || map[chain];
    return candidate ? requireAddress(`Balancer Composite V2 receiver for ${chain}`, candidate) : null;
  }

  const map = parseAddressMap(environment.ZERO_CAPITAL_FLASHLOAN_RECEIVERS, 'ZERO_CAPITAL_FLASHLOAN_RECEIVERS');
  const candidate = environment[`ZERO_CAPITAL_FLASHLOAN_RECEIVER_${chainKey}`]?.trim() || map[chain] || environment.ZERO_CAPITAL_FLASHLOAN_RECEIVER?.trim();
  return candidate ? requireAddress(`Balancer V1 receiver for ${chain}`, candidate) : null;
}

function expectedInfrastructure(kind: FlashLoanReceiverCapabilityKind, chain: SupportedExecutionChain): string | null {
  if (kind === 'aave_v3') return resolveAaveV3Pool(chain);
  return resolveSponsoredReceiverVault(chain);
}

export async function verifyFlashLoanReceiverCapability(input: {
  kind: FlashLoanReceiverCapabilityKind;
  chain: SupportedExecutionChain;
  provider: providers.Provider;
  expectedOwner: string;
  address?: string | null;
}): Promise<VerifiedFlashLoanReceiverCapability | null> {
  const configuredAddress = input.address || resolveConfiguredFlashLoanReceiver(input.kind, input.chain);
  if (!configuredAddress) return null;
  const address = requireAddress('flash-loan receiver', configuredAddress);
  const owner = requireAddress('expected receiver owner', input.expectedOwner);
  const infrastructure = expectedInfrastructure(input.kind, input.chain);
  if (!infrastructure) return null;

  const code = await input.provider.getCode(address);
  if (code === '0x') return null;
  const infrastructureGetter = input.kind === 'aave_v3' ? 'pool' : 'vault';
  const receiver = new Contract(address, [
    'function owner() view returns (address)',
    `function ${infrastructureGetter}() view returns (address)`,
  ], input.provider);
  const [actualOwnerRaw, actualInfrastructureRaw] = await Promise.all([
    receiver.owner() as Promise<string>,
    receiver[infrastructureGetter]() as Promise<string>,
  ]);
  const actualOwner = requireAddress('receiver owner', actualOwnerRaw);
  const actualInfrastructure = requireAddress(`receiver ${infrastructureGetter}`, actualInfrastructureRaw);
  if (actualOwner.toLowerCase() !== owner.toLowerCase()) return null;
  if (actualInfrastructure.toLowerCase() !== infrastructure.toLowerCase()) return null;

  return {
    kind: input.kind,
    chain: input.chain,
    address,
    owner: actualOwner,
    infrastructure: actualInfrastructure,
    codeHash: ethers.utils.keccak256(code),
    verifiedAt: Date.now(),
    provenance: [
      'receiver_bytecode_present',
      'receiver_owner_verified',
      `${infrastructureGetter}_binding_verified`,
      'configured_receiver_address',
      'synthetic_evidence:false',
    ],
  };
}
