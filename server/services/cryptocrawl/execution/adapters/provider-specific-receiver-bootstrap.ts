import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BigNumber, Wallet, ethers, providers } from 'ethers';
import { requireZeroCapitalInfrastructureDeploymentAllowed } from '../../governance/zero-capital-infrastructure-policy.js';
import { resolveAaveV3Pool, resolveMorphoBlue } from './flash-loan-provider-economics.js';
import {
  verifyFlashLoanReceiverCapability,
  type VerifiedFlashLoanReceiverCapability,
} from './flash-loan-receiver-capability.js';
import type { ReceiverFundingMode } from './sponsored-receiver-manager.js';
import type { SupportedExecutionChain } from './onchain-payload-builder.js';

const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const CREATE2_DEPLOYER_CODE_HASH = '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989';

export type ProviderSpecificReceiverKind = 'aave_v3' | 'morpho_blue';

interface ReceiverArtifact {
  contractName: string;
  abi: unknown[];
  bytecode: string;
}

interface ProviderReceiverDescriptor {
  artifactPath: string;
  contractName: string;
  salt: string;
  infrastructure: (chain: SupportedExecutionChain) => string | null;
  environmentKey: (chain: SupportedExecutionChain) => string;
}

const DESCRIPTORS: Record<ProviderSpecificReceiverKind, ProviderReceiverDescriptor> = {
  aave_v3: {
    artifactPath: 'artifacts/cryptocrawl/CryptocrawlAaveV3FlashLoanReceiver.json',
    contractName: 'CryptocrawlAaveV3FlashLoanReceiver',
    salt: ethers.utils.keccak256(ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-aave-v3-receiver:v1')),
    infrastructure: chain => resolveAaveV3Pool(chain),
    environmentKey: chain => `ZERO_CAPITAL_AAVE_V3_RECEIVER_${chain.toUpperCase()}`,
  },
  morpho_blue: {
    artifactPath: 'artifacts/cryptocrawl/CryptocrawlMorphoFlashLoanReceiver.json',
    contractName: 'CryptocrawlMorphoFlashLoanReceiver',
    salt: ethers.utils.keccak256(ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-morpho-receiver:v1')),
    infrastructure: chain => resolveMorphoBlue(chain),
    environmentKey: chain => `ZERO_CAPITAL_MORPHO_RECEIVER_${chain.toUpperCase()}`,
  },
};

async function loadArtifact(descriptor: ProviderReceiverDescriptor): Promise<ReceiverArtifact> {
  const raw = await readFile(resolve(process.cwd(), descriptor.artifactPath), 'utf8');
  const artifact = JSON.parse(raw) as Partial<ReceiverArtifact>;
  if (artifact.contractName !== descriptor.contractName) {
    throw new Error(`Unexpected receiver artifact at ${descriptor.artifactPath}`);
  }
  if (!Array.isArray(artifact.abi) || typeof artifact.bytecode !== 'string' || !ethers.utils.isHexString(artifact.bytecode) || artifact.bytecode === '0x') {
    throw new Error(`Receiver artifact is incomplete at ${descriptor.artifactPath}`);
  }
  return artifact as ReceiverArtifact;
}

function publishRuntimeReceiver(kind: ProviderSpecificReceiverKind, chain: SupportedExecutionChain, address: string): void {
  process.env[DESCRIPTORS[kind].environmentKey(chain)] = ethers.utils.getAddress(address);
}

/**
 * Ensures only the provider receiver requested by the current measured route.
 * A failure is local to that provider; callers must continue evaluating other
 * measured providers rather than treating this helper as a global prerequisite.
 */
export async function ensureProviderSpecificReceiverCapability(input: {
  kind: ProviderSpecificReceiverKind;
  chain: SupportedExecutionChain;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  fundingMode: ReceiverFundingMode;
  executeSetupCalls: (calls: Array<{ to: string; data: string; value?: BigNumber }>) => Promise<void>;
}): Promise<VerifiedFlashLoanReceiverCapability | null> {
  const configured = await verifyFlashLoanReceiverCapability({
    kind: input.kind,
    chain: input.chain,
    provider: input.provider,
    expectedOwner: input.wallet.address,
  });
  if (configured) return configured;

  const descriptor = DESCRIPTORS[input.kind];
  const infrastructure = descriptor.infrastructure(input.chain);
  if (!infrastructure) return null;

  const artifact = await loadArtifact(descriptor);
  const owner = ethers.utils.getAddress(input.wallet.address);
  const constructorArgs = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address'],
    [ethers.utils.getAddress(infrastructure), owner],
  );
  const initCode = ethers.utils.hexConcat([artifact.bytecode, constructorArgs]);
  const predictedAddress = ethers.utils.getCreate2Address(
    CREATE2_DEPLOYER,
    descriptor.salt,
    ethers.utils.keccak256(initCode),
  );

  const deterministicExisting = await verifyFlashLoanReceiverCapability({
    kind: input.kind,
    chain: input.chain,
    provider: input.provider,
    expectedOwner: owner,
    address: predictedAddress,
  });
  if (deterministicExisting) {
    publishRuntimeReceiver(input.kind, input.chain, predictedAddress);
    return deterministicExisting;
  }

  const factoryCode = await input.provider.getCode(CREATE2_DEPLOYER);
  if (factoryCode === '0x') {
    throw new Error(`${input.chain} does not have the verified Foundry CREATE2 deployer`);
  }
  if (ethers.utils.keccak256(factoryCode).toLowerCase() !== CREATE2_DEPLOYER_CODE_HASH.toLowerCase()) {
    throw new Error(`${input.chain} CREATE2 deployer code hash is not the verified Foundry implementation`);
  }

  const deploymentData = ethers.utils.hexConcat([descriptor.salt, initCode]);
  await input.provider.call({ from: owner, to: CREATE2_DEPLOYER, data: deploymentData, value: 0 });
  requireZeroCapitalInfrastructureDeploymentAllowed({
    chain: input.chain,
    operation: 'receiver_deployment',
  });

  await input.executeSetupCalls([{ to: CREATE2_DEPLOYER, data: deploymentData, value: BigNumber.from(0) }]);

  const verified = await verifyFlashLoanReceiverCapability({
    kind: input.kind,
    chain: input.chain,
    provider: input.provider,
    expectedOwner: owner,
    address: predictedAddress,
  });
  if (!verified) throw new Error(`${input.kind} receiver deployment did not produce a verified capability on ${input.chain}`);

  publishRuntimeReceiver(input.kind, input.chain, predictedAddress);
  return {
    ...verified,
    provenance: [
      ...verified.provenance,
      'deterministic_create2_receiver',
      `zero_capital_receiver_funding:${input.fundingMode}`,
      'operator_monetary_input_required:false',
      'provider_receiver_cold_start_route_local:true',
    ],
  };
}
