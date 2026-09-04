import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Contract, ethers, providers } from 'ethers';
import type { SponsoredCall } from '../../strategies/gas-sponsorship.js';
import { BUILDER_SPONSORED_ETHEREUM } from './builder-sponsored-ethereum-config.js';

const ARTIFACT_PATH = 'artifacts/cryptocrawl/CryptocrawlBalancerBuilderSponsoredFlashLoanReceiver.json';
const RECEIVER_SALT = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-balancer-builder-sponsored-receiver:v1'),
);
const ADMIN_ABI = [
  'function owner() view returns (address)',
  'function vault() view returns (address)',
  'function weth() view returns (address)',
  'function allowedTargets(address) view returns (bool)',
  'function allowedApprovalTokens(address) view returns (bool)',
  'function setAllowedTarget(address target,bool allowed)',
  'function setAllowedApprovalToken(address token,bool allowed)',
];

interface ReceiverArtifact {
  contractName: string;
  abi: unknown[];
  bytecode: string;
  compiler?: string;
}

export interface BuilderSponsoredReceiverIdentity {
  chainId: 1;
  owner: string;
  vault: string;
  weth: string;
  address: string;
  factory: string;
  salt: string;
  initCode: string;
  artifactCompiler?: string;
}

export interface BuilderSponsoredInfrastructureCall extends SponsoredCall {
  purpose: 'deploy_receiver' | 'allow_target' | 'allow_approval_token';
}

export interface BuilderSponsoredInfrastructurePlan {
  identity: BuilderSponsoredReceiverIdentity;
  alreadyDeployed: boolean;
  calls: BuilderSponsoredInfrastructureCall[];
}

let artifactPromise: Promise<ReceiverArtifact> | null = null;

function requireAddress(label: string, value: string): string {
  if (!ethers.utils.isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(value);
}

async function loadArtifact(): Promise<ReceiverArtifact> {
  if (!artifactPromise) {
    artifactPromise = (async () => {
      let raw: string;
      try {
        raw = await readFile(resolve(process.cwd(), ARTIFACT_PATH), 'utf8');
      } catch {
        throw new Error(`Builder-sponsored receiver artifact is missing; run scripts/cryptocrawl/compile-builder-sponsored-receiver.ts first`);
      }
      const artifact = JSON.parse(raw) as Partial<ReceiverArtifact>;
      if (artifact.contractName !== 'CryptocrawlBalancerBuilderSponsoredFlashLoanReceiver') {
        throw new Error('Unexpected builder-sponsored receiver artifact identity');
      }
      if (!Array.isArray(artifact.abi) || typeof artifact.bytecode !== 'string' || !ethers.utils.isHexString(artifact.bytecode)) {
        throw new Error('Builder-sponsored receiver artifact is incomplete');
      }
      return artifact as ReceiverArtifact;
    })();
  }
  return artifactPromise;
}

export async function getBuilderSponsoredReceiverIdentity(ownerAddress: string): Promise<BuilderSponsoredReceiverIdentity> {
  const owner = requireAddress('builder-sponsored receiver owner', ownerAddress);
  const config = BUILDER_SPONSORED_ETHEREUM;
  const artifact = await loadArtifact();
  const constructorArgs = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'address'],
    [config.balancerV2Vault, owner, config.weth],
  );
  const initCode = ethers.utils.hexConcat([artifact.bytecode, constructorArgs]);
  const address = ethers.utils.getCreate2Address(
    config.foundryCreate2Deployer,
    RECEIVER_SALT,
    ethers.utils.keccak256(initCode),
  );
  return {
    chainId: 1,
    owner,
    vault: config.balancerV2Vault,
    weth: config.weth,
    address,
    factory: config.foundryCreate2Deployer,
    salt: RECEIVER_SALT,
    initCode,
    artifactCompiler: artifact.compiler,
  };
}

async function verifyDeployer(provider: providers.JsonRpcProvider): Promise<void> {
  const config = BUILDER_SPONSORED_ETHEREUM;
  const code = await provider.getCode(config.foundryCreate2Deployer);
  if (code === '0x') throw new Error('Verified Foundry CREATE2 deployer is missing on Ethereum');
  const hash = ethers.utils.keccak256(code);
  if (hash.toLowerCase() !== config.foundryCreate2DeployerCodeHash.toLowerCase()) {
    throw new Error('Ethereum CREATE2 deployer code hash differs from the reviewed Foundry implementation');
  }
}

async function verifyExistingReceiver(
  provider: providers.JsonRpcProvider,
  identity: BuilderSponsoredReceiverIdentity,
): Promise<void> {
  const receiver = new Contract(identity.address, ADMIN_ABI, provider);
  const [owner, vault, weth] = await Promise.all([
    receiver.owner() as Promise<string>,
    receiver.vault() as Promise<string>,
    receiver.weth() as Promise<string>,
  ]);
  if (owner.toLowerCase() !== identity.owner.toLowerCase()) throw new Error('Builder-sponsored receiver owner mismatch');
  if (vault.toLowerCase() !== identity.vault.toLowerCase()) throw new Error('Builder-sponsored receiver vault mismatch');
  if (weth.toLowerCase() !== identity.weth.toLowerCase()) throw new Error('Builder-sponsored receiver WETH mismatch');
}

/**
 * Produces, but never signs or submits, the deterministic infrastructure prefix
 * for an atomic sponsored bundle. If the receiver is absent the first call is the
 * CREATE2 deployment. Permission calls follow it and can therefore execute in the
 * same block against the precomputed receiver address. If already deployed, only
 * genuinely missing permissions are returned.
 */
export async function buildBuilderSponsoredInfrastructurePlan(input: {
  provider: providers.JsonRpcProvider;
  owner: string;
  targets: readonly string[];
  approvalTokens: readonly string[];
}): Promise<BuilderSponsoredInfrastructurePlan> {
  const network = await input.provider.getNetwork();
  if (network.chainId !== 1) throw new Error(`Builder-sponsored bootstrap requires Ethereum chainId 1, received ${network.chainId}`);
  const identity = await getBuilderSponsoredReceiverIdentity(input.owner);
  const code = await input.provider.getCode(identity.address);
  const alreadyDeployed = code !== '0x';
  const iface = new ethers.utils.Interface(ADMIN_ABI);
  const targets = [...new Set(input.targets.map(target => requireAddress('builder-sponsored allowed target', target)))];
  const approvalTokens = [...new Set(input.approvalTokens.map(token => requireAddress('builder-sponsored approval token', token)))];
  if (targets.length === 0) throw new Error('Builder-sponsored bootstrap requires at least one allowed execution target');
  if (approvalTokens.length === 0) throw new Error('Builder-sponsored bootstrap requires at least one allowed approval token');

  const calls: BuilderSponsoredInfrastructureCall[] = [];
  if (!alreadyDeployed) {
    await verifyDeployer(input.provider);
    calls.push({
      purpose: 'deploy_receiver',
      to: identity.factory,
      data: ethers.utils.hexConcat([identity.salt, identity.initCode]),
      value: 0,
    });
    for (const target of targets) {
      calls.push({ purpose: 'allow_target', to: identity.address, data: iface.encodeFunctionData('setAllowedTarget', [target, true]), value: 0 });
    }
    for (const token of approvalTokens) {
      calls.push({ purpose: 'allow_approval_token', to: identity.address, data: iface.encodeFunctionData('setAllowedApprovalToken', [token, true]), value: 0 });
    }
    return { identity, alreadyDeployed: false, calls };
  }

  await verifyExistingReceiver(input.provider, identity);
  const receiver = new Contract(identity.address, ADMIN_ABI, input.provider);
  for (const target of targets) {
    const allowed = await receiver.allowedTargets(target) as boolean;
    if (!allowed) calls.push({ purpose: 'allow_target', to: identity.address, data: iface.encodeFunctionData('setAllowedTarget', [target, true]), value: 0 });
  }
  for (const token of approvalTokens) {
    const allowed = await receiver.allowedApprovalTokens(token) as boolean;
    if (!allowed) calls.push({ purpose: 'allow_approval_token', to: identity.address, data: iface.encodeFunctionData('setAllowedApprovalToken', [token, true]), value: 0 });
  }
  return { identity, alreadyDeployed: true, calls };
}
