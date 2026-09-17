import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BigNumber, Contract, Wallet, ethers, providers } from 'ethers';
import logger from '../../../logger.js';
import type { ConfiguredZeroCapitalRoute } from './onchain-route-quoter.js';
import { buildSwapCallFromLeg, type SupportedExecutionChain } from './onchain-payload-builder.js';
import { getGasSponsorManager, type SponsoredCall } from '../../strategies/gas-sponsorship.js';
import { requireZeroCapitalInfrastructureDeploymentAllowed } from '../../governance/zero-capital-infrastructure-policy.js';
import { executeSystemOwnedNativeTransaction } from '../system-owned-native-transaction.js';

const DEFAULT_CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const DEFAULT_CREATE2_DEPLOYER_CODE_HASH = '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989';
const RECEIVER_SALT = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-balancer-receiver:v1'));
const COMPOSITE_RECEIVER_SALT = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-balancer-composite-receiver:v2'));
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

type ReceiverKind = 'standalone_v1' | 'composite_v2';

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
  const label = 'ZERO_CAPITAL_BALANCER_VAULTS';
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object keyed by chain`);
  }
  const result: Partial<Record<SupportedExecutionChain, string>> = {};
  for (const [chain, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    result[chain as SupportedExecutionChain] = requireAddress(`${label}.${chain}`, value);
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
  private readonly compositeRecords = new Map<SupportedExecutionChain, SponsoredReceiverRecord>();
  private artifactPromise: Promise<ReceiverArtifact> | null = null;
  private compositeArtifactPromise: Promise<ReceiverArtifact> | null = null;

  private async loadArtifact(kind: ReceiverKind): Promise<ReceiverArtifact> {
    if (kind === 'composite_v2') {
      if (!this.compositeArtifactPromise) {
        this.compositeArtifactPromise = (async () => {
          const path = resolve(process.cwd(), 'artifacts/cryptocrawl/CryptocrawlBalancerCompositeFlashLoanReceiver.json');
          const raw = await readFile(path, 'utf8');
          const artifact = JSON.parse(raw) as Partial<ReceiverArtifact>;
          if (artifact.contractName !== 'CryptocrawlBalancerCompositeFlashLoanReceiver') {
            throw new Error('Unexpected composite flash-loan receiver artifact');
          }
          if (!Array.isArray(artifact.abi) || typeof artifact.bytecode !== 'string' || !ethers.utils.isHexString(artifact.bytecode) || artifact.bytecode === '0x') {
            throw new Error('Composite flash-loan receiver artifact is incomplete');
          }
          return artifact as ReceiverArtifact;
        })();
      }
      return this.compositeArtifactPromise;
    }

    if (!this.artifactPromise) {
      this.artifactPromise = (async () => {
        const path = resolve(process.cwd(), 'artifacts/cryptocrawl/CryptocrawlBalancerFlashLoanReceiver.json');
        const raw = await readFile(path, 'utf8');
        const artifact = JSON.parse(raw) as Partial<ReceiverArtifact>;
        if (artifact.contractName !== 'CryptocrawlBalancerFlashLoanReceiver') {
          throw new Error('Unexpected flash-loan receiver artifact');
        }
        if (!Array.isArray(artifact.abi) || typeof artifact.bytecode !== 'string' || !ethers.utils.isHexString(artifact.bytecode) || artifact.bytecode === '0x') {
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

  getCompositeReceiver(chain: SupportedExecutionChain): string | undefined {
    return this.compositeRecords.get(chain)?.address;
  }

  getRecords(): SponsoredReceiverRecord[] {
    return Array.from(this.records.values()).map(record => ({ ...record }));
  }

  getCompositeRecords(): SponsoredReceiverRecord[] {
    return Array.from(this.compositeRecords.values()).map(record => ({ ...record }));
  }

  private publishRegistry(): void {
    const byChain = Object.fromEntries(Array.from(this.records.entries()).map(([chain, record]) => [chain, record.address]));
    process.env.ZERO_CAPITAL_FLASHLOAN_RECEIVERS = JSON.stringify(byChain);
    const uniqueAddresses = new Set(Object.values(byChain).map(address => address.toLowerCase()));
    if (uniqueAddresses.size === 1) process.env.ZERO_CAPITAL_FLASHLOAN_RECEIVER = Object.values(byChain)[0];

    const compositeByChain = Object.fromEntries(Array.from(this.compositeRecords.entries()).map(([chain, record]) => [chain, record.address]));
    process.env.ZERO_CAPITAL_BALANCER_COMPOSITE_RECEIVERS = JSON.stringify(compositeByChain);
    for (const [chain, address] of Object.entries(compositeByChain)) {
      process.env[`ZERO_CAPITAL_BALANCER_COMPOSITE_RECEIVER_${chain.toUpperCase()}`] = address;
    }
  }

  private async receiverIdentity(input: {
    chain: SupportedExecutionChain;
    provider: providers.JsonRpcProvider;
    owner: string;
    kind: ReceiverKind;
  }): Promise<{ chainId: number; vault: string; owner: string; predictedAddress: string; initCode: string }> {
    const vault = resolveSponsoredReceiverVault(input.chain);
    if (!vault) throw new Error(`${input.chain} has no configured Balancer-compatible flash-loan vault`);
    const network = await input.provider.getNetwork();
    const owner = requireAddress('receiver owner', input.owner);
    const artifact = await this.loadArtifact(input.kind);
    const constructorArgs = ethers.utils.defaultAbiCoder.encode(['address', 'address'], [vault, owner]);
    const initCode = ethers.utils.hexConcat([artifact.bytecode, constructorArgs]);
    const salt = input.kind === 'composite_v2' ? COMPOSITE_RECEIVER_SALT : RECEIVER_SALT;
    const predictedAddress = ethers.utils.getCreate2Address(
      DEFAULT_CREATE2_DEPLOYER,
      salt,
      ethers.utils.keccak256(initCode),
    );
    return { chainId: network.chainId, vault, owner, predictedAddress, initCode };
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

  private async inspectExistingKind(input: {
    chain: SupportedExecutionChain;
    provider: providers.JsonRpcProvider;
    owner: string;
    kind: ReceiverKind;
  }): Promise<SponsoredReceiverRecord | null> {
    const records = input.kind === 'composite_v2' ? this.compositeRecords : this.records;
    const cached = records.get(input.chain);
    if (cached) {
      await this.verifyReceiver(input.provider, cached.address, cached.owner, cached.vault);
      return { ...cached };
    }

    const identity = await this.receiverIdentity(input);
    const code = await input.provider.getCode(identity.predictedAddress);
    if (code === '0x') return null;
    await this.verifyReceiver(input.provider, identity.predictedAddress, identity.owner, identity.vault);
    const record: SponsoredReceiverRecord = {
      chain: input.chain,
      chainId: identity.chainId,
      address: identity.predictedAddress,
      vault: identity.vault,
      owner: identity.owner,
      factory: DEFAULT_CREATE2_DEPLOYER,
      createdAt: Date.now(),
    };
    records.set(input.chain, record);
    this.publishRegistry();
    return { ...record };
  }

  async inspectExistingReceiver(input: {
    chain: SupportedExecutionChain;
    provider: providers.JsonRpcProvider;
    owner: string;
  }): Promise<SponsoredReceiverRecord | null> {
    return this.inspectExistingKind({ ...input, kind: 'standalone_v1' });
  }

  async inspectExistingCompositeReceiver(input: {
    chain: SupportedExecutionChain;
    provider: providers.JsonRpcProvider;
    owner: string;
  }): Promise<SponsoredReceiverRecord | null> {
    return this.inspectExistingKind({ ...input, kind: 'composite_v2' });
  }

  private async ensureReceiverKind(input: {
    chain: SupportedExecutionChain;
    provider: providers.JsonRpcProvider;
    wallet: Wallet;
    fundingMode: ReceiverFundingMode;
    kind: ReceiverKind;
  }): Promise<SponsoredReceiverRecord> {
    const inspected = await this.inspectExistingKind({
      chain: input.chain,
      provider: input.provider,
      owner: input.wallet.address,
      kind: input.kind,
    });
    if (inspected) return inspected;

    const identity = await this.receiverIdentity({
      chain: input.chain,
      provider: input.provider,
      owner: input.wallet.address,
      kind: input.kind,
    });
    const factoryCode = await input.provider.getCode(DEFAULT_CREATE2_DEPLOYER);
    if (factoryCode === '0x') throw new Error(`${input.chain} does not have the verified Foundry CREATE2 deployer at ${DEFAULT_CREATE2_DEPLOYER}`);
    const factoryCodeHash = ethers.utils.keccak256(factoryCode);
    if (factoryCodeHash.toLowerCase() !== DEFAULT_CREATE2_DEPLOYER_CODE_HASH.toLowerCase()) {
      throw new Error(`${input.chain} CREATE2 deployer code hash is not the verified Foundry implementation`);
    }

    const salt = input.kind === 'composite_v2' ? COMPOSITE_RECEIVER_SALT : RECEIVER_SALT;
    const deploymentData = ethers.utils.hexConcat([salt, identity.initCode]);
    await input.provider.call({ from: identity.owner, to: DEFAULT_CREATE2_DEPLOYER, data: deploymentData, value: 0 });
    requireZeroCapitalInfrastructureDeploymentAllowed({
      chain: input.chain,
      operation: 'receiver_deployment',
    });

    let deploymentTransactionHash: string | undefined;
    if (input.fundingMode === 'sponsored') {
      const sponsorReadiness = this.sponsor.getReadiness();
      if (!sponsorReadiness.ready) throw new Error(sponsorReadiness.reason || 'Receiver deployment sponsorship is unavailable');
      const sponsored = await this.sponsor.execute({
        wallet: input.wallet,
        chainId: identity.chainId,
        calls: [{
          to: DEFAULT_CREATE2_DEPLOYER,
          data: deploymentData,
          value: BigNumber.from(0),
        }],
        timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_RECEIVER_DEPLOY_TIMEOUT_MS || 90_000)),
      });
      deploymentTransactionHash = sponsored.transactionHash;
    } else {
      const result = await executeSystemOwnedNativeTransaction({
        chain: input.chain,
        wallet: input.wallet,
        provider: input.provider,
        idempotencyKey: `zero-receiver-deploy:${input.kind}:${input.chain}:${identity.predictedAddress.toLowerCase()}`,
        purpose: 'zero_capital_receiver_deployment',
        transaction: {
          to: DEFAULT_CREATE2_DEPLOYER,
          data: deploymentData,
          value: BigNumber.from(0),
        },
        confirmations: 1,
      });
      if (result.receipt.status !== 1) throw new Error(`System-owned ${input.kind} receiver deployment reverted on ${input.chain}`);
      deploymentTransactionHash = result.transactionHash;
    }

    await this.verifyReceiver(input.provider, identity.predictedAddress, identity.owner, identity.vault);
    const record: SponsoredReceiverRecord = {
      chain: input.chain,
      chainId: identity.chainId,
      address: identity.predictedAddress,
      vault: identity.vault,
      owner: identity.owner,
      factory: DEFAULT_CREATE2_DEPLOYER,
      deploymentTransactionHash,
      createdAt: Date.now(),
    };
    const records = input.kind === 'composite_v2' ? this.compositeRecords : this.records;
    records.set(input.chain, record);
    this.publishRegistry();
    return { ...record };
  }

  async ensureCompositeReceiver(input: {
    chain: SupportedExecutionChain;
    provider: providers.JsonRpcProvider;
    wallet: Wallet;
    fundingMode: ReceiverFundingMode;
  }): Promise<SponsoredReceiverRecord> {
    return this.ensureReceiverKind({ ...input, kind: 'composite_v2' });
  }

  async ensureReceiver(input: {
    chain: SupportedExecutionChain;
    provider: providers.JsonRpcProvider;
    wallet: Wallet;
    fundingMode: ReceiverFundingMode;
  }): Promise<SponsoredReceiverRecord> {
    const standalone = await this.ensureReceiverKind({ ...input, kind: 'standalone_v1' });

    // Composite capability is additive. Deployment failure must stay local and can
    // never revoke the already-ready standalone route.
    try {
      await this.ensureCompositeReceiver(input);
    } catch (error) {
      logger.debug('[SponsoredReceiverManager] Composite V2 receiver preparation degraded locally', {
        component: 'SponsoredReceiverManager',
        chain: input.chain,
        error: error instanceof Error ? error.message : String(error),
        standaloneReceiverReady: true,
        compositeOnlyFailure: true,
      });
    }
    return standalone;
  }

  async buildMissingExplicitPermissionCalls(input: {
    receiver: string;
    provider: providers.JsonRpcProvider;
    targets: readonly string[];
    approvalTokens: readonly string[];
  }): Promise<SponsoredCall[]> {
    const receiver = requireAddress('receiver', input.receiver);
    const admin = new Contract(receiver, RECEIVER_ADMIN_ABI, input.provider);
    const iface = new ethers.utils.Interface(RECEIVER_ADMIN_ABI);
    const targets = [...new Set(input.targets.map(target => requireAddress('allowed target', target)))];
    const approvalTokens = [...new Set(input.approvalTokens.map(token => requireAddress('allowed approval token', token)))];

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

  private routePermissionTargets(input: {
    chain: SupportedExecutionChain;
    receiver: string;
    routes: ConfiguredZeroCapitalRoute[];
  }): { targets: string[]; approvalTokens: string[] } {
    const targets = new Set<string>();
    const approvalTokens = new Set<string>();
    for (const route of input.routes) {
      if (route.chain !== input.chain) continue;
      for (const leg of route.legs) {
        const built = buildSwapCallFromLeg(input.chain, input.receiver, {
          protocol: leg.protocol,
          chain: input.chain,
          tokenIn: leg.tokenIn,
          tokenOut: leg.tokenOut,
          amountIn: '1',
          minAmountOut: '1',
          feeTier: leg.feeTier,
          recipient: input.receiver,
          deadlineBufferSeconds: 90,
        });
        targets.add(ethers.utils.getAddress(built.target));
        approvalTokens.add(ethers.utils.getAddress(built.approvalToken));
      }
    }
    return { targets: [...targets], approvalTokens: [...approvalTokens] };
  }

  /** Standalone permission work stays isolated from optional composite capability. */
  async buildMissingPermissionCalls(input: {
    chain: SupportedExecutionChain;
    receiver: string;
    provider: providers.JsonRpcProvider;
    routes: ConfiguredZeroCapitalRoute[];
  }): Promise<SponsoredCall[]> {
    const permissions = this.routePermissionTargets({
      chain: input.chain,
      receiver: input.receiver,
      routes: input.routes,
    });
    return this.buildMissingExplicitPermissionCalls({
      receiver: input.receiver,
      provider: input.provider,
      ...permissions,
    });
  }

  /**
   * Composite V2 permissions are prepared independently so a composite-only
   * configuration/RPC/setup failure can never poison the standalone receiver lane.
   */
  async buildMissingCompositePermissionCalls(input: {
    chain: SupportedExecutionChain;
    provider: providers.JsonRpcProvider;
    routes: ConfiguredZeroCapitalRoute[];
  }): Promise<SponsoredCall[]> {
    const composite = this.compositeRecords.get(input.chain);
    if (!composite) return [];
    const permissions = this.routePermissionTargets({
      chain: input.chain,
      receiver: composite.address,
      routes: input.routes,
    });
    if (permissions.targets.length === 0 && permissions.approvalTokens.length === 0) return [];
    return this.buildMissingExplicitPermissionCalls({
      receiver: composite.address,
      provider: input.provider,
      ...permissions,
    });
  }
}

let singleton: SponsoredReceiverManager | null = null;
export function getSponsoredReceiverManager(): SponsoredReceiverManager {
  if (!singleton) singleton = new SponsoredReceiverManager();
  return singleton;
}
