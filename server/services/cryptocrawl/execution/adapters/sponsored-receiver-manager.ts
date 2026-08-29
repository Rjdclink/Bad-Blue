import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BigNumber, Contract, Wallet, ethers, providers } from 'ethers';
import type { ConfiguredZeroCapitalRoute } from './onchain-route-quoter.js';
import { buildSwapCallFromLeg, type SupportedExecutionChain } from './onchain-payload-builder.js';
import { getGasSponsorManager, type SponsoredCall } from '../../strategies/gas-sponsorship.js';
import { requireZeroCapitalInfrastructureDeploymentAllowed } from '../../governance/zero-capital-infrastructure-policy.js';
import { withEvmSignerLane } from '../evm-signer-lane.js';

const DEFAULT_CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const DEFAULT_CREATE2_DEPLOYER_CODE_HASH = '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989';
const RECEIVER_SALT = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-balancer-receiver:v1'));
const DEFAULT_BALANCER_VAULT = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';

const DEFAULT_BALANCER_VAULTS: Partial<Record<SupportedExecutionChain, string>> = {
  ethereum: DEFAULT_BALANCER_VAULT,
  polygon: DEFAULT_BALANCER_VAULT,
  arbitrum: DEFAULT_BALANCER_VAULT,
  optimism: DEFAULT_BALANCER_VAULT,
};

const RECEIVER_ADMIN_ABI = [
  'function owner() view returns (address)',
  'function vault() view returns (address)',
  'function allowedTargets(address) view returns (bool)',
  'function allowedApprovalTokens(address) view returns (bool)',
  'function setAllowedTarget(address target, bool allowed)',
  'function setAllowedApprovalToken(address token, bool allowed)',
];

interface ReceiverArtifact {
  contractName: string;
  abi: unknown[];
  bytecode: string;
  compiler?: string;
}

export type ReceiverFundingMode = 'sponsored' | 'native';

export interface SponsoredReceiverRecord {
  chain: SupportedExecutionChain;
  chainId: number;
  address: string;
  vault: string;
  owner: string;
  factory: string;
  deploymentTransactionHash?: string;
  createdAt: number;
}

function requireAddress(label: string, value: string): string {
  if (!ethers.utils.isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(value);
}

function parseVaultOverrides(raw: string | undefined): Partial<Record<SupportedExecutionChain, string>> {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('ZERO_CAPITAL_BALANCER_VAULTS must be valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ZERO_CAPITAL_BALANCER_VAULTS must be a JSON object keyed by chain');
  }
  const result: Partial<Record<SupportedExecutionChain, string>> = {};
  for (const [chain, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    result[chain as SupportedExecutionChain] = requireAddress(`ZERO_CAPITAL_BALANCER_VAULTS.${chain}`, value);
  }
  return result;
}

export function resolveSponsoredReceiverVault(
  chain: SupportedExecutionChain,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const overrides = parseVaultOverrides(environment.ZERO_CAPITAL_BALANCER_VAULTS);
  const chainSpecific = environment[`ZERO_CAPITAL_BALANCER_VAULT_${chain.toUpperCase()}`]?.trim();
  const candidate = chainSpecific || overrides[chain] || DEFAULT_BALANCER_VAULTS[chain];
  return candidate ? requireAddress(`Balancer vault for ${chain}`, candidate) : null;
}

export function supportsSponsoredReceiverChain(
  chain: SupportedExecutionChain,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return chain !== 'europa' && resolveSponsoredReceiverVault(chain, environment) !== null;
}

export class SponsoredReceiverManager {
  private readonly sponsor = getGasSponsorManager();
  private readonly records = new Map<SupportedExecutionChain, SponsoredReceiverRecord>();
  private artifactPromise: Promise<ReceiverArtifact> | null = null;

  private async loadArtifact(): Promise<ReceiverArtifact> {
    if (!this.artifactPromise) {
      this.artifactPromise = (async () => {
        const path = resolve(process.cwd(), 'artifacts/cryptocrawl/CryptocrawlBalancerFlashLoanReceiver.json');
        const raw = await readFile(path, 'utf8');
        const artifact = JSON.parse(raw) as Partial<ReceiverArtifact>;
        if (artifact.contractName !== 'CryptocrawlBalancerFlashLoanReceiver') {
          throw new Error('Unexpected flash-loan receiver artifact');
        }
        if (!Array.isArray(artifact.abi) || typeof artifact.bytecode !== 'string' || !ethers.utils.isHexString(artifact.bytecode)) {
          throw new Error('Flash-loan receiver artifact is incomplete');
        }
        return artifact as ReceiverArtifact;
      })();
    }
    return this.artifactPromise;
  }

  getReceiver(chain: SupportedExecutionChain): string | undefined {
    return this.records.get(chain)?.address;
  }

  getRecords(): SponsoredReceiverRecord[] {
    return Array.from(this.records.values()).map(record => ({ ...record }));
  }

  private publishRegistry(): void {
    const byChain = Object.fromEntries(Array.from(this.records.entries()).map(([chain, record]) => [chain, record.address]));
    process.env.ZERO_CAPITAL_FLASHLOAN_RECEIVERS = JSON.stringify(byChain);
    const uniqueAddresses = new Set(Object.values(byChain).map(address => address.toLowerCase()));
    if (uniqueAddresses.size === 1) process.env.ZERO_CAPITAL_FLASHLOAN_RECEIVER = Object.values(byChain)[0];
  }

  private async verifyReceiver(provider: providers.JsonRpcProvider, address: string, owner: string, vault: string): Promise<void> {
    const code = await provider.getCode(address);
    if (code === '0x') throw new Error(`Receiver bytecode is missing at ${address}`);
    const receiver = new Contract(address, RECEIVER_ADMIN_ABI, provider);
    const [actualOwner, actualVault] = await Promise.all([
      receiver.owner() as Promise<string>,
      receiver.vault() as Promise<string>,
    ]);
    if (actualOwner.toLowerCase() !== owner.toLowerCase()) throw new Error(`Receiver owner mismatch at ${address}`);
    if (actualVault.toLowerCase() !== vault.toLowerCase()) throw new Error(`Receiver Balancer vault mismatch at ${address}`);
  }

  async ensureReceiver(input: {
    chain: SupportedExecutionChain;
    provider: providers.JsonRpcProvider;
    wallet: Wallet;
    fundingMode: ReceiverFundingMode;
  }): Promise<SponsoredReceiverRecord> {
    const existing = this.records.get(input.chain);
    if (existing) return existing;

    const vault = resolveSponsoredReceiverVault(input.chain);
    if (!vault) throw new Error(`${input.chain} has no configured Balancer-compatible flash-loan vault`);
    const network = await input.provider.getNetwork();
    const owner = requireAddress('receiver owner', input.wallet.address);
    const artifact = await this.loadArtifact();
    const constructorArgs = ethers.utils.defaultAbiCoder.encode(['address', 'address'], [vault, owner]);
    const initCode = ethers.utils.hexConcat([artifact.bytecode, constructorArgs]);
    const predictedAddress = ethers.utils.getCreate2Address(DEFAULT_CREATE2_DEPLOYER, RECEIVER_SALT, ethers.utils.keccak256(initCode));

    const existingCode = await input.provider.getCode(predictedAddress);
    let deploymentTransactionHash: string | undefined;
    if (existingCode === '0x') {
      const factoryCode = await input.provider.getCode(DEFAULT_CREATE2_DEPLOYER);
      if (factoryCode === '0x') throw new Error(`${input.chain} does not have the verified Foundry CREATE2 deployer at ${DEFAULT_CREATE2_DEPLOYER}`);
      const factoryCodeHash = ethers.utils.keccak256(factoryCode);
      if (factoryCodeHash.toLowerCase() !== DEFAULT_CREATE2_DEPLOYER_CODE_HASH.toLowerCase()) {
        throw new Error(`${input.chain} CREATE2 deployer code hash is not the verified Foundry implementation`);
      }

      const deploymentData = ethers.utils.hexConcat([RECEIVER_SALT, initCode]);
      await input.provider.call({ from: owner, to: DEFAULT_CREATE2_DEPLOYER, data: deploymentData, value: 0 });
      requireZeroCapitalInfrastructureDeploymentAllowed({
        chain: input.chain,
        operation: 'receiver_deployment',
      });

      if (input.fundingMode === 'sponsored') {
        const sponsorReadiness = this.sponsor.getReadiness();
        if (!sponsorReadiness.ready) throw new Error(sponsorReadiness.reason || 'Alchemy Gas Manager is not ready');
        const sponsored = await this.sponsor.execute({
          wallet: input.wallet,
          chainId: network.chainId,
          calls: [{ to: DEFAULT_CREATE2_DEPLOYER, data: deploymentData, value: BigNumber.from(0) }],
          timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_DEPLOY_TIMEOUT_MS || 90_000)),
        });
        deploymentTransactionHash = sponsored.transactionHash;
      } else {
        deploymentTransactionHash = await withEvmSignerLane({
          chainId: network.chainId,
          walletAddress: owner,
          operation: async () => {
            const transaction = await input.wallet.sendTransaction({
              to: DEFAULT_CREATE2_DEPLOYER,
              data: deploymentData,
              value: BigNumber.from(0),
            });
            const receipt = await transaction.wait(1);
            if (!receipt || receipt.status !== 1) throw new Error(`Native receiver deployment reverted on ${input.chain}`);
            return transaction.hash;
          },
        });
      }
    }

    await this.verifyReceiver(input.provider, predictedAddress, owner, vault);
    const record: SponsoredReceiverRecord = {
      chain: input.chain,
      chainId: network.chainId,
      address: predictedAddress,
      vault,
      owner,
      factory: DEFAULT_CREATE2_DEPLOYER,
      deploymentTransactionHash,
      createdAt: Date.now(),
    };
    this.records.set(input.chain, record);
    this.publishRegistry();
    return record;
  }

  async buildMissingPermissionCalls(input: {
    chain: SupportedExecutionChain;
    receiver: string;
    provider: providers.JsonRpcProvider;
    routes: ConfiguredZeroCapitalRoute[];
  }): Promise<SponsoredCall[]> {
    const receiver = requireAddress('receiver', input.receiver);
    const admin = new Contract(receiver, RECEIVER_ADMIN_ABI, input.provider);
    const iface = new ethers.utils.Interface(RECEIVER_ADMIN_ABI);
    const targets = new Set<string>();
    const approvalTokens = new Set<string>();

    for (const route of input.routes) {
      if (route.chain !== input.chain) continue;
      for (const leg of route.legs) {
        const built = buildSwapCallFromLeg(input.chain, receiver, {
          protocol: leg.protocol,
          chain: input.chain,
          tokenIn: leg.tokenIn,
          tokenOut: leg.tokenOut,
          amountIn: '1',
          minAmountOut: '1',
          feeTier: leg.feeTier,
          recipient: receiver,
          deadlineBufferSeconds: 90,
        });
        targets.add(ethers.utils.getAddress(built.target));
        approvalTokens.add(ethers.utils.getAddress(built.approvalToken));
      }
    }

    const calls: SponsoredCall[] = [];
    for (const target of targets) {
      const allowed = await admin.allowedTargets(target) as boolean;
      if (!allowed) calls.push({ to: receiver, data: iface.encodeFunctionData('setAllowedTarget', [target, true]) });
    }
    for (const token of approvalTokens) {
      const allowed = await admin.allowedApprovalTokens(token) as boolean;
      if (!allowed) calls.push({ to: receiver, data: iface.encodeFunctionData('setAllowedApprovalToken', [token, true]) });
    }
    return calls;
  }
}

let singleton: SponsoredReceiverManager | null = null;
export function getSponsoredReceiverManager(): SponsoredReceiverManager {
  if (!singleton) singleton = new SponsoredReceiverManager();
  return singleton;
}
