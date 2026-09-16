import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BigNumber, Wallet, ethers, providers } from 'ethers';
import { requireZeroCapitalInfrastructureDeploymentAllowed } from '../../governance/zero-capital-infrastructure-policy.js';
import { resolveAaveV3Pool } from './flash-loan-provider-economics.js';
import type { SupportedExecutionChain } from './onchain-payload-builder.js';
import {
  verifyDualFlashLoanReceiverCapability,
  type VerifiedDualFlashLoanReceiverCapability,
} from './dual-flashloan-receiver-capability.js';

const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const CREATE2_DEPLOYER_CODE_HASH = '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989';
const DUAL_ARTIFACT_PATH = 'artifacts/cryptocrawl/CryptocrawlAaveBalancerDualFlashLoanReceiver.json';
const DUAL_CONTRACT_NAME = 'CryptocrawlAaveBalancerDualFlashLoanReceiver';
const DUAL_SALT = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-aave-balancer-dual-receiver:v1'));

interface ReceiverArtifact {
  contractName: string;
  abi: unknown[];
  bytecode: string;
}

async function loadArtifact(): Promise<ReceiverArtifact> {
  const raw = await readFile(resolve(process.cwd(), DUAL_ARTIFACT_PATH), 'utf8');
  const artifact = JSON.parse(raw) as Partial<ReceiverArtifact>;
  if (artifact.contractName !== DUAL_CONTRACT_NAME) throw new Error(`Unexpected dual receiver artifact at ${DUAL_ARTIFACT_PATH}`);
  if (!Array.isArray(artifact.abi) || typeof artifact.bytecode !== 'string' || !ethers.utils.isHexString(artifact.bytecode) || artifact.bytecode === '0x') {
    throw new Error(`Dual receiver artifact is incomplete at ${DUAL_ARTIFACT_PATH}`);
  }
  return artifact as ReceiverArtifact;
}

function publishRuntimeReceiver(chain: SupportedExecutionChain, address: string): void {
  process.env[`ZERO_CAPITAL_AAVE_BALANCER_DUAL_RECEIVER_${chain.toUpperCase()}`] = ethers.utils.getAddress(address);
}

/**
 * Route-local, zero-personal-cost cold start for the already-supported nested
 * Aave+Balancer receiver. The caller supplies the chain's already-verified vault
 * and zero-personal-cost setup executor, avoiding any new funding authority here.
 */
export async function ensureDualFlashLoanReceiverCapability(input: {
  chain: SupportedExecutionChain;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  vault: string;
  fundingMode: 'sponsored' | 'native';
  executeSetupCalls: (calls: Array<{ to: string; data: string; value?: BigNumber }>) => Promise<void>;
}): Promise<VerifiedDualFlashLoanReceiverCapability | null> {
  const configured = await verifyDualFlashLoanReceiverCapability({
    chain: input.chain,
    provider: input.provider,
    expectedOwner: input.wallet.address,
  });
  if (configured) return configured;

  const vault = ethers.utils.getAddress(input.vault);
  const pool = resolveAaveV3Pool(input.chain);
  if (!pool) return null;

  const artifact = await loadArtifact();
  const owner = ethers.utils.getAddress(input.wallet.address);
  const constructorArgs = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'address'],
    [vault, ethers.utils.getAddress(pool), owner],
  );
  const initCode = ethers.utils.hexConcat([artifact.bytecode, constructorArgs]);
  const predictedAddress = ethers.utils.getCreate2Address(
    CREATE2_DEPLOYER,
    DUAL_SALT,
    ethers.utils.keccak256(initCode),
  );

  const deterministicExisting = await verifyDualFlashLoanReceiverCapability({
    chain: input.chain,
    provider: input.provider,
    expectedOwner: owner,
    address: predictedAddress,
  });
  if (deterministicExisting) {
    publishRuntimeReceiver(input.chain, predictedAddress);
    return deterministicExisting;
  }

  const factoryCode = await input.provider.getCode(CREATE2_DEPLOYER);
  if (factoryCode === '0x') throw new Error(`${input.chain} does not have the verified Foundry CREATE2 deployer`);
  if (ethers.utils.keccak256(factoryCode).toLowerCase() !== CREATE2_DEPLOYER_CODE_HASH.toLowerCase()) {
    throw new Error(`${input.chain} CREATE2 deployer code hash is not the verified Foundry implementation`);
  }

  const deploymentData = ethers.utils.hexConcat([DUAL_SALT, initCode]);
  await input.provider.call({ from: owner, to: CREATE2_DEPLOYER, data: deploymentData, value: 0 });
  requireZeroCapitalInfrastructureDeploymentAllowed({
    chain: input.chain,
    operation: 'receiver_deployment',
  });
  await input.executeSetupCalls([{ to: CREATE2_DEPLOYER, data: deploymentData, value: BigNumber.from(0) }]);

  const verified = await verifyDualFlashLoanReceiverCapability({
    chain: input.chain,
    provider: input.provider,
    expectedOwner: owner,
    address: predictedAddress,
  });
  if (!verified) throw new Error(`Aave+Balancer dual receiver deployment did not produce a verified capability on ${input.chain}`);

  publishRuntimeReceiver(input.chain, predictedAddress);
  return {
    ...verified,
    provenance: [
      ...verified.provenance,
      'deterministic_create2_dual_receiver',
      `zero_capital_receiver_funding:${input.fundingMode}`,
      'operator_monetary_input_required:false',
      'dual_provider_receiver_cold_start_route_local:true',
    ],
  };
}
