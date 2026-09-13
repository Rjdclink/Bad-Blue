import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BigNumber, Contract, Wallet, ethers, providers } from 'ethers';
import { getGasSponsorManager } from '../../strategies/gas-sponsorship.js';
import { requireZeroCapitalInfrastructureDeploymentAllowed } from '../../governance/zero-capital-infrastructure-policy.js';
import { executeSystemOwnedNativeTransaction } from '../system-owned-native-transaction.js';
import { resolveAaveV3Pool } from './flash-loan-provider-economics.js';
import type { SupportedExecutionChain } from './onchain-payload-builder.js';

const DEFAULT_CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const DEFAULT_CREATE2_DEPLOYER_CODE_HASH = '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989';
const AAVE_RECEIVER_SALT = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-aave-v3-receiver:v1'));

const AAVE_RECEIVER_ABI = [
  'function owner() view returns (address)',
  'function pool() view returns (address)',
];

interface ReceiverArtifact {
  contractName: string;
  abi: unknown[];
  bytecode: string;
  compiler?: string;
}

export type AaveReceiverFundingMode = 'sponsored' | 'native';

export interface AaveV3ReceiverRecord {
  chain: SupportedExecutionChain;
  chainId: number;
  address: string;
  pool: string;
  owner: string;
  factory: string;
  deploymentTransactionHash?: string;
  createdAt: number;
}

function requireAddress(label: string, value: string): string {
  if (!ethers.utils.isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(value);
}

export class AaveV3ReceiverManager {
  private readonly sponsor = getGasSponsorManager();
  private readonly records = new Map<SupportedExecutionChain, AaveV3ReceiverRecord>();
  private artifactPromise: Promise<ReceiverArtifact> | null = null;

  private async loadArtifact(): Promise<ReceiverArtifact> {
    if (!this.artifactPromise) {
      this.artifactPromise = (async () => {
        const path = resolve(process.cwd(), 'artifacts/cryptocrawl/CryptocrawlAaveV3FlashLoanReceiver.json');
        const raw = await readFile(path, 'utf8');
        const artifact = JSON.parse(raw) as Partial<ReceiverArtifact>;
        if (artifact.contractName !== 'CryptocrawlAaveV3FlashLoanReceiver') {
          throw new Error('Unexpected Aave V3 flash-loan receiver artifact');
        }
        if (!Array.isArray(artifact.abi) || typeof artifact.bytecode !== 'string' || !ethers.utils.isHexString(artifact.bytecode)) {
          throw new Error('Aave V3 flash-loan receiver artifact is incomplete');
        }
        return artifact as ReceiverArtifact;
      })();
    }
    return this.artifactPromise;
  }

  private publishRegistry(): void {
    const configured = (() => {
      try {
        const parsed = JSON.parse(process.env.ZERO_CAPITAL_AAVE_V3_RECEIVERS || '{}') as Record<string, unknown>;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    })();
    for (const [chain, record] of this.records.entries()) configured[chain] = record.address;
    process.env.ZERO_CAPITAL_AAVE_V3_RECEIVERS = JSON.stringify(configured);
  }

  private async receiverIdentity(input: {
    chain: SupportedExecutionChain;
    provider: providers.JsonRpcProvider;
    owner: string;
  }): Promise<{ chainId: number; pool: string; owner: string; predictedAddress: string; initCode: string }> {
    const pool = resolveAaveV3Pool(input.chain);
    if (!pool) throw new Error(`${input.chain} has no configured Aave V3 pool`);
    const network = await input.provider.getNetwork();
    const owner = requireAddress('Aave receiver owner', input.owner);
    const artifact = await this.loadArtifact();
    const constructorArgs = ethers.utils.defaultAbiCoder.encode(['address', 'address'], [pool, owner]);
    const initCode = ethers.utils.hexConcat([artifact.bytecode, constructorArgs]);
    const predictedAddress = ethers.utils.getCreate2Address(
      DEFAULT_CREATE2_DEPLOYER,
      AAVE_RECEIVER_SALT,
      ethers.utils.keccak256(initCode),
    );
    return { chainId: network.chainId, pool, owner, predictedAddress, initCode };
  }

  private async verifyReceiver(
    provider: providers.JsonRpcProvider,
    address: string,
    owner: string,
    pool: string,
  ): Promise<void> {
    const code = await provider.getCode(address);
    if (code === '0x') throw new Error(`Aave receiver bytecode is missing at ${address}`);
    const receiver = new Contract(address, AAVE_RECEIVER_ABI, provider);
    const [actualOwner, actualPool] = await Promise.all([
      receiver.owner() as Promise<string>,
      receiver.pool() as Promise<string>,
    ]);
    if (actualOwner.toLowerCase() !== owner.toLowerCase()) throw new Error(`Aave receiver owner mismatch at ${address}`);
    if (actualPool.toLowerCase() !== pool.toLowerCase()) throw new Error(`Aave receiver pool mismatch at ${address}`);
  }

  async inspectExistingReceiver(input: {
    chain: SupportedExecutionChain;
    provider: providers.JsonRpcProvider;
    owner: string;
  }): Promise<AaveV3ReceiverRecord | null> {
    const cached = this.records.get(input.chain);
    if (cached) {
      await this.verifyReceiver(input.provider, cached.address, cached.owner, cached.pool);
      return { ...cached };
    }
    const identity = await this.receiverIdentity(input);
    const code = await input.provider.getCode(identity.predictedAddress);
    if (code === '0x') return null;
    await this.verifyReceiver(input.provider, identity.predictedAddress, identity.owner, identity.pool);
    const record: AaveV3ReceiverRecord = {
      chain: input.chain,
      chainId: identity.chainId,
      address: identity.predictedAddress,
      pool: identity.pool,
      owner: identity.owner,
      factory: DEFAULT_CREATE2_DEPLOYER,
      createdAt: Date.now(),
    };
    this.records.set(input.chain, record);
    this.publishRegistry();
    return { ...record };
  }

  async ensureReceiver(input: {
    chain: SupportedExecutionChain;
    provider: providers.JsonRpcProvider;
    wallet: Wallet;
    fundingMode: AaveReceiverFundingMode;
  }): Promise<AaveV3ReceiverRecord> {
    const inspected = await this.inspectExistingReceiver({
      chain: input.chain,
      provider: input.provider,
      owner: input.wallet.address,
    });
    if (inspected) return inspected;

    const identity = await this.receiverIdentity({
      chain: input.chain,
      provider: input.provider,
      owner: input.wallet.address,
    });
    const factoryCode = await input.provider.getCode(DEFAULT_CREATE2_DEPLOYER);
    if (factoryCode === '0x') throw new Error(`${input.chain} does not have the verified Foundry CREATE2 deployer at ${DEFAULT_CREATE2_DEPLOYER}`);
    const factoryCodeHash = ethers.utils.keccak256(factoryCode);
    if (factoryCodeHash.toLowerCase() !== DEFAULT_CREATE2_DEPLOYER_CODE_HASH.toLowerCase()) {
      throw new Error(`${input.chain} CREATE2 deployer code hash is not the verified Foundry implementation`);
    }

    const deploymentData = ethers.utils.hexConcat([AAVE_RECEIVER_SALT, identity.initCode]);
    await input.provider.call({ from: identity.owner, to: DEFAULT_CREATE2_DEPLOYER, data: deploymentData, value: 0 });
    requireZeroCapitalInfrastructureDeploymentAllowed({
      chain: input.chain,
      operation: 'receiver_deployment',
    });

    let deploymentTransactionHash: string | undefined;
    if (input.fundingMode === 'sponsored') {
      const readiness = this.sponsor.getReadiness();
      if (!readiness.ready) throw new Error(readiness.reason || 'Aave receiver deployment sponsorship is unavailable');
      const sponsored = await this.sponsor.execute({
        wallet: input.wallet,
        chainId: identity.chainId,
        calls: [{ to: DEFAULT_CREATE2_DEPLOYER, data: deploymentData, value: BigNumber.from(0) }],
        timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_RECEIVER_DEPLOY_TIMEOUT_MS || 90_000)),
      });
      deploymentTransactionHash = sponsored.transactionHash;
    } else {
      const result = await executeSystemOwnedNativeTransaction({
        chain: input.chain,
        wallet: input.wallet,
        provider: input.provider,
        idempotencyKey: `aave-v3-receiver-deploy:${input.chain}:${identity.predictedAddress.toLowerCase()}`,
        purpose: 'zero_capital_receiver_deployment',
        transaction: { to: DEFAULT_CREATE2_DEPLOYER, data: deploymentData, value: BigNumber.from(0) },
        confirmations: 1,
      });
      if (result.receipt.status !== 1) throw new Error(`System-owned Aave receiver deployment reverted on ${input.chain}`);
      deploymentTransactionHash = result.transactionHash;
    }

    await this.verifyReceiver(input.provider, identity.predictedAddress, identity.owner, identity.pool);
    const record: AaveV3ReceiverRecord = {
      chain: input.chain,
      chainId: identity.chainId,
      address: identity.predictedAddress,
      pool: identity.pool,
      owner: identity.owner,
      factory: DEFAULT_CREATE2_DEPLOYER,
      deploymentTransactionHash,
      createdAt: Date.now(),
    };
    this.records.set(input.chain, record);
    this.publishRegistry();
    return { ...record };
  }
}

let singleton: AaveV3ReceiverManager | null = null;
export function getAaveV3ReceiverManager(): AaveV3ReceiverManager {
  if (!singleton) singleton = new AaveV3ReceiverManager();
  return singleton;
}
