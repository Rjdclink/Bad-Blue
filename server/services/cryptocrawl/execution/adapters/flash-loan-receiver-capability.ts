import { Contract, ethers, providers } from 'ethers';
import {
  buildSwapCallFromLeg,
  type SupportedExecutionChain,
  type SupportedSwapProtocol,
} from './onchain-payload-builder.js';
import { resolveAaveV3Pool } from './flash-loan-provider-economics.js';
import { resolveSponsoredReceiverVault } from './sponsored-receiver-manager.js';
import type { SponsoredCall } from '../../strategies/gas-sponsorship.js';

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

export interface ReceiverPermissionRouteStep {
  protocol: string;
  tokenIn: string;
  tokenOut: string;
  fee: number;
}

const RECEIVER_ADMIN_ABI = [
  'function allowedTargets(address) view returns (bool)',
  'function allowedApprovalTokens(address) view returns (bool)',
  'function setAllowedTarget(address target,bool allowed)',
  'function setAllowedApprovalToken(address token,bool allowed)',
];

function requireAddress(label: string, value: string): string {
  if (!ethers.utils.isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(value);
}

function normalizeProtocol(protocol: string): SupportedSwapProtocol {
  const normalized = protocol.trim().toLowerCase();
  if (normalized === 'uniswapv3' || normalized === 'uniswap_v3' || normalized === 'uniswap-v3') return 'uniswapV3';
  if (normalized === 'sushiswap' || normalized === 'sushi') return 'sushiswap';
  if (normalized === 'sushiswapv3' || normalized === 'sushiswap_v3' || normalized === 'sushiswap-v3') return 'sushiswapV3';
  throw new Error(`Unsupported receiver permission protocol: ${protocol}`);
}

function feeTier(fee: number): 500 | 3000 | 10000 {
  if (!Number.isFinite(fee) || fee < 0 || fee > 0.1) throw new Error('Receiver permission route fee is invalid');
  if (fee <= 0.0005) return 500;
  if (fee <= 0.003) return 3000;
  return 10000;
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

export async function buildMissingReceiverPermissionCalls(input: {
  chain: SupportedExecutionChain;
  provider: providers.Provider;
  receiver: string;
  route: readonly ReceiverPermissionRouteStep[];
}): Promise<SponsoredCall[]> {
  const receiverAddress = requireAddress('receiver', input.receiver);
  if (input.route.length < 2) return [];
  const contract = new Contract(receiverAddress, RECEIVER_ADMIN_ABI, input.provider);
  const iface = new ethers.utils.Interface(RECEIVER_ADMIN_ABI);
  const targets = new Set<string>();
  const approvalTokens = new Set<string>();

  for (const step of input.route) {
    const built = buildSwapCallFromLeg(input.chain, receiverAddress, {
      protocol: normalizeProtocol(step.protocol),
      chain: input.chain,
      tokenIn: requireAddress('permission tokenIn', step.tokenIn),
      tokenOut: requireAddress('permission tokenOut', step.tokenOut),
      amountIn: '1',
      minAmountOut: '1',
      feeTier: feeTier(step.fee),
      recipient: receiverAddress,
      deadlineBufferSeconds: 90,
    });
    targets.add(requireAddress('permission target', built.target));
    approvalTokens.add(requireAddress('permission approval token', built.approvalToken));
  }

  const calls: SponsoredCall[] = [];
  for (const target of targets) {
    const allowed = await contract.allowedTargets(target) as boolean;
    if (!allowed) calls.push({ to: receiverAddress, data: iface.encodeFunctionData('setAllowedTarget', [target, true]) });
  }
  for (const token of approvalTokens) {
    const allowed = await contract.allowedApprovalTokens(token) as boolean;
    if (!allowed) calls.push({ to: receiverAddress, data: iface.encodeFunctionData('setAllowedApprovalToken', [token, true]) });
  }
  return calls;
}
