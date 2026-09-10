import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BigNumber, Contract, Wallet, ethers, providers } from 'ethers';
import { getGasSponsorManager } from '../strategies/gas-sponsorship.js';
import { requireZeroCapitalInfrastructureDeploymentAllowed } from '../governance/zero-capital-infrastructure-policy.js';

const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const CREATE2_DEPLOYER_CODE_HASH = '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989';
const INTERMEDIARY_SALT = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-ghost-wallet-intermediary:v1'),
);

const DEFAULT_ASSETS: Record<string, string[]> = {
  ethereum: [
    '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
  ],
  polygon: [
    '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // native USDC
    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC.e / legacy route asset
    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT
  ],
  arbitrum: [
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // native USDC
    '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // USDC.e / legacy route asset
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
  ],
  optimism: [
    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // native USDC
    '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', // USDT
  ],
};

const INTERMEDIARY_ADMIN_ABI = [
  'function owner() view returns (address)',
  'function profitRecipient() view returns (address)',
  'function allowedAssets(address) view returns (bool)',
  'function allowedApprovalTokens(address) view returns (bool)',
  'function allowedVaults(address) view returns (bool)',
  'function setAllowedAsset(address token,bool allowed)',
  'function setAllowedApprovalToken(address token,bool allowed)',
  'function setAllowedVault(address vault,bool allowed)',
];
const VAULT_IDENTITY_ABI = [
  'function asset() view returns (address)',
  'function intermediary() view returns (address)',
  'function owner() view returns (address)',
];

interface ContractArtifact {
  contractName: string;
  abi: unknown[];
  bytecode: string;
}

interface FundingDecision {
  mode: 'sponsored' | 'native' | 'unavailable';
  paymentSource?: string;
  strictZeroInitialCapitalEligible?: boolean;
  operatorMonetaryInputRequired?: boolean;
  sponsorOperatorMonetaryCostProvenZero?: boolean;
  reason?: string;
}

export interface GhostWalletBootstrapRuntime {
  providers: Map<any, providers.JsonRpcProvider>;
  executionWallets: Map<any, Wallet>;
  getGasFundingDecision: (chain: any) => Promise<FundingDecision>;
}

export interface GhostWalletInfrastructureRecord {
  chain: string;
  chainId: number;
  intermediary: string;
  vaults: Array<{ asset: string; vault: string }>;
  deploymentMode: 'existing' | 'provider_sponsored';
}

export interface GhostWalletInfrastructureBootstrapResult {
  records: GhostWalletInfrastructureRecord[];
  errors: Array<{ chain: string; error: string }>;
  manualRailwayConfigurationRequired: false;
  personalGasSpent: false;
  arbitrageSystemOwnedGasSpent: false;
}

let intermediaryArtifactPromise: Promise<ContractArtifact> | null = null;
let vaultArtifactPromise: Promise<ContractArtifact> | null = null;
const sponsor = getGasSponsorManager();

function requireAddress(label: string, value: string): string {
  if (!ethers.utils.isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return ethers.utils.getAddress(value);
}

function parseArray(raw: string | undefined): Array<Record<string, unknown>> {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(row => row && typeof row === 'object') as Array<Record<string, unknown>> : [];
  } catch {
    return [];
  }
}

async function loadArtifact(name: 'CryptocrawlGhostWalletIntermediary' | 'CryptocrawlGhostWalletCapitalVault'): Promise<ContractArtifact> {
  const promiseSlot = name === 'CryptocrawlGhostWalletIntermediary' ? intermediaryArtifactPromise : vaultArtifactPromise;
  if (promiseSlot) return promiseSlot;
  const loader = (async () => {
    const raw = await readFile(resolve(process.cwd(), `artifacts/cryptocrawl/${name}.json`), 'utf8');
    const artifact = JSON.parse(raw) as Partial<ContractArtifact>;
    if (artifact.contractName !== name || !Array.isArray(artifact.abi) || typeof artifact.bytecode !== 'string' || !ethers.utils.isHexString(artifact.bytecode)) {
      throw new Error(`${name} build artifact is missing or invalid`);
    }
    return artifact as ContractArtifact;
  })();
  if (name === 'CryptocrawlGhostWalletIntermediary') intermediaryArtifactPromise = loader;
  else vaultArtifactPromise = loader;
  return loader;
}

function deploymentData(salt: string, initCode: string): string {
  return ethers.utils.hexConcat([salt, initCode]);
}

function predictedCreate2Address(salt: string, initCode: string): string {
  return ethers.utils.getCreate2Address(CREATE2_DEPLOYER, salt, ethers.utils.keccak256(initCode));
}

function vaultSalt(chainId: number, asset: string): string {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['string', 'uint256', 'address'],
      ['bad-blue:cryptocrawl-ghost-wallet-vault:v1', chainId, asset],
    ),
  );
}

async function verifyFactory(provider: providers.JsonRpcProvider): Promise<void> {
  const code = await provider.getCode(CREATE2_DEPLOYER);
  if (code === '0x') throw new Error(`verified CREATE2 deployer is unavailable at ${CREATE2_DEPLOYER}`);
  const codeHash = ethers.utils.keccak256(code);
  if (codeHash.toLowerCase() !== CREATE2_DEPLOYER_CODE_HASH.toLowerCase()) {
    throw new Error(`CREATE2 deployer code hash mismatch at ${CREATE2_DEPLOYER}`);
  }
}

async function sponsoredInfrastructureCall(input: {
  chain: string;
  chainId: number;
  wallet: Wallet;
  runtime: GhostWalletBootstrapRuntime;
  calls: Array<{ to: string; data: string; value?: BigNumber }>;
  operation: 'ghost_wallet_deployment' | 'ghost_wallet_permissions';
}): Promise<string> {
  const funding = await input.runtime.getGasFundingDecision(input.chain as any);
  const sponsoredFree = funding.mode === 'sponsored'
    && funding.paymentSource === 'provider_sponsored'
    && funding.strictZeroInitialCapitalEligible === true
    && funding.operatorMonetaryInputRequired === false
    && funding.sponsorOperatorMonetaryCostProvenZero === true;
  if (!sponsoredFree) {
    throw new Error(`zero-operator-cost sponsorship unavailable: ${funding.reason || funding.mode}`);
  }
  requireZeroCapitalInfrastructureDeploymentAllowed({ chain: input.chain, operation: input.operation });
  const readiness = sponsor.getReadiness();
  if (!readiness.ready) throw new Error(readiness.reason || 'Ghost Wallet sponsorship is unavailable');
  const result = await sponsor.execute({
    wallet: input.wallet,
    chainId: input.chainId,
    calls: input.calls,
    timeoutMs: Math.max(10_000, Number(process.env.GHOST_WALLET_BOOTSTRAP_TIMEOUT_MS || 90_000)),
  });
  return result.transactionHash;
}

async function ensureIntermediary(input: {
  chain: string;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  runtime: GhostWalletBootstrapRuntime;
  profitRecipient: string;
}): Promise<{ chainId: number; intermediary: string; deployed: boolean }> {
  const network = await input.provider.getNetwork();
  const artifact = await loadArtifact('CryptocrawlGhostWalletIntermediary');
  const owner = requireAddress('Ghost Wallet owner', input.wallet.address);
  const profitRecipient = requireAddress('Ghost Wallet profit recipient', input.profitRecipient);
  const initCode = ethers.utils.hexConcat([
    artifact.bytecode,
    ethers.utils.defaultAbiCoder.encode(['address', 'address'], [owner, profitRecipient]),
  ]);
  const intermediary = predictedCreate2Address(INTERMEDIARY_SALT, initCode);
  let code = await input.provider.getCode(intermediary);
  let deployed = false;
  if (code === '0x') {
    await verifyFactory(input.provider);
    const data = deploymentData(INTERMEDIARY_SALT, initCode);
    await input.provider.call({ from: owner, to: CREATE2_DEPLOYER, data, value: 0 });
    await sponsoredInfrastructureCall({
      chain: input.chain,
      chainId: network.chainId,
      wallet: input.wallet,
      runtime: input.runtime,
      calls: [{ to: CREATE2_DEPLOYER, data, value: BigNumber.from(0) }],
      operation: 'ghost_wallet_deployment',
    });
    code = await input.provider.getCode(intermediary);
    deployed = true;
  }
  if (code === '0x') throw new Error(`Ghost Wallet intermediary bytecode missing at ${intermediary}`);
  const contract = new Contract(intermediary, INTERMEDIARY_ADMIN_ABI, input.provider);
  const [actualOwner, actualRecipient] = await Promise.all([contract.owner(), contract.profitRecipient()]);
  if (String(actualOwner).toLowerCase() !== owner.toLowerCase()) throw new Error('Ghost Wallet intermediary owner mismatch');
  if (String(actualRecipient).toLowerCase() !== profitRecipient.toLowerCase()) throw new Error('Ghost Wallet intermediary profit-recipient mismatch');
  return { chainId: network.chainId, intermediary, deployed };
}

async function ensureVault(input: {
  chain: string;
  chainId: number;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  runtime: GhostWalletBootstrapRuntime;
  intermediary: string;
  asset: string;
}): Promise<{ vault: string; deployed: boolean }> {
  const artifact = await loadArtifact('CryptocrawlGhostWalletCapitalVault');
  const asset = requireAddress('Ghost Wallet vault asset', input.asset);
  const owner = requireAddress('Ghost Wallet vault owner', input.wallet.address);
  const salt = vaultSalt(input.chainId, asset);
  const initCode = ethers.utils.hexConcat([
    artifact.bytecode,
    ethers.utils.defaultAbiCoder.encode(['address', 'address', 'address'], [asset, input.intermediary, owner]),
  ]);
  const vault = predictedCreate2Address(salt, initCode);
  let code = await input.provider.getCode(vault);
  let deployed = false;
  if (code === '0x') {
    await verifyFactory(input.provider);
    const data = deploymentData(salt, initCode);
    await input.provider.call({ from: owner, to: CREATE2_DEPLOYER, data, value: 0 });
    await sponsoredInfrastructureCall({
      chain: input.chain,
      chainId: input.chainId,
      wallet: input.wallet,
      runtime: input.runtime,
      calls: [{ to: CREATE2_DEPLOYER, data, value: BigNumber.from(0) }],
      operation: 'ghost_wallet_deployment',
    });
    code = await input.provider.getCode(vault);
    deployed = true;
  }
  if (code === '0x') throw new Error(`Ghost Wallet vault bytecode missing at ${vault}`);
  const contract = new Contract(vault, VAULT_IDENTITY_ABI, input.provider);
  const [actualAsset, actualIntermediary, actualOwner] = await Promise.all([
    contract.asset(),
    contract.intermediary(),
    contract.owner(),
  ]);
  if (String(actualAsset).toLowerCase() !== asset.toLowerCase()) throw new Error('Ghost Wallet vault asset mismatch');
  if (String(actualIntermediary).toLowerCase() !== input.intermediary.toLowerCase()) throw new Error('Ghost Wallet vault intermediary mismatch');
  if (String(actualOwner).toLowerCase() !== owner.toLowerCase()) throw new Error('Ghost Wallet vault owner mismatch');
  return { vault, deployed };
}

async function ensurePermissions(input: {
  chain: string;
  chainId: number;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  runtime: GhostWalletBootstrapRuntime;
  intermediary: string;
  vaults: Array<{ asset: string; vault: string }>;
}): Promise<void> {
  const contract = new Contract(input.intermediary, INTERMEDIARY_ADMIN_ABI, input.provider);
  const iface = new ethers.utils.Interface(INTERMEDIARY_ADMIN_ABI);
  const calls: Array<{ to: string; data: string; value?: BigNumber }> = [];
  for (const row of input.vaults) {
    const [assetAllowed, approvalAllowed, vaultAllowed] = await Promise.all([
      contract.allowedAssets(row.asset),
      contract.allowedApprovalTokens(row.asset),
      contract.allowedVaults(row.vault),
    ]);
    if (!assetAllowed) calls.push({ to: input.intermediary, data: iface.encodeFunctionData('setAllowedAsset', [row.asset, true]) });
    if (!approvalAllowed) calls.push({ to: input.intermediary, data: iface.encodeFunctionData('setAllowedApprovalToken', [row.asset, true]) });
    if (!vaultAllowed) calls.push({ to: input.intermediary, data: iface.encodeFunctionData('setAllowedVault', [row.vault, true]) });
  }
  if (calls.length === 0) return;
  await sponsoredInfrastructureCall({
    chain: input.chain,
    chainId: input.chainId,
    wallet: input.wallet,
    runtime: input.runtime,
    calls,
    operation: 'ghost_wallet_permissions',
  });
  for (const row of input.vaults) {
    const [assetAllowed, approvalAllowed, vaultAllowed] = await Promise.all([
      contract.allowedAssets(row.asset),
      contract.allowedApprovalTokens(row.asset),
      contract.allowedVaults(row.vault),
    ]);
    if (!assetAllowed || !approvalAllowed || !vaultAllowed) throw new Error('Ghost Wallet permission bootstrap did not verify terminally');
  }
}

function publishRuntimeConfig(records: GhostWalletInfrastructureRecord[]): void {
  const existingIntermediaries = parseArray(process.env.GHOST_WALLET_INTERMEDIARIES_JSON);
  const existingVaults = parseArray(process.env.GHOST_WALLET_CAPITAL_VAULTS_JSON);
  const intermediaryMap = new Map<string, Record<string, unknown>>();
  for (const row of existingIntermediaries) {
    const chain = typeof row.chain === 'string' ? row.chain.trim().toLowerCase() : '';
    if (chain) intermediaryMap.set(chain, row);
  }
  const vaultMap = new Map<string, Record<string, unknown>>();
  for (const row of existingVaults) {
    const chain = typeof row.chain === 'string' ? row.chain.trim().toLowerCase() : '';
    const vault = typeof row.vault === 'string' ? row.vault.trim().toLowerCase() : '';
    if (chain && vault) vaultMap.set(`${chain}:${vault}`, row);
  }
  for (const record of records) {
    intermediaryMap.set(record.chain, { chain: record.chain, address: record.intermediary, label: 'auto_create2_verified' });
    for (const row of record.vaults) {
      vaultMap.set(`${record.chain}:${row.vault.toLowerCase()}`, {
        chain: record.chain,
        vault: row.vault,
        label: 'auto_create2_verified',
      });
    }
  }
  process.env.GHOST_WALLET_INTERMEDIARIES_JSON = JSON.stringify([...intermediaryMap.values()]);
  process.env.GHOST_WALLET_CAPITAL_VAULTS_JSON = JSON.stringify([...vaultMap.values()]);
}

export async function ensureGhostWalletInfrastructure(input: {
  runtime: GhostWalletBootstrapRuntime;
  profitRecipient: string;
}): Promise<GhostWalletInfrastructureBootstrapResult> {
  const records: GhostWalletInfrastructureRecord[] = [];
  const errors: Array<{ chain: string; error: string }> = [];

  for (const chain of Object.keys(DEFAULT_ASSETS)) {
    const provider = input.runtime.providers.get(chain as any);
    const wallet = input.runtime.executionWallets.get(chain as any);
    if (!provider || !wallet) continue;
    try {
      const intermediary = await ensureIntermediary({
        chain,
        provider,
        wallet,
        runtime: input.runtime,
        profitRecipient: input.profitRecipient,
      });
      const vaults: Array<{ asset: string; vault: string }> = [];
      let deployedAny = intermediary.deployed;
      for (const asset of DEFAULT_ASSETS[chain]) {
        const tokenCode = await provider.getCode(asset);
        if (tokenCode === '0x') continue;
        const ensured = await ensureVault({
          chain,
          chainId: intermediary.chainId,
          provider,
          wallet,
          runtime: input.runtime,
          intermediary: intermediary.intermediary,
          asset,
        });
        deployedAny ||= ensured.deployed;
        vaults.push({ asset: requireAddress('Ghost Wallet asset', asset), vault: ensured.vault });
      }
      await ensurePermissions({
        chain,
        chainId: intermediary.chainId,
        provider,
        wallet,
        runtime: input.runtime,
        intermediary: intermediary.intermediary,
        vaults,
      });
      records.push({
        chain,
        chainId: intermediary.chainId,
        intermediary: intermediary.intermediary,
        vaults,
        deploymentMode: deployedAny ? 'provider_sponsored' : 'existing',
      });
    } catch (error) {
      errors.push({ chain, error: error instanceof Error ? error.message : String(error) });
    }
  }

  publishRuntimeConfig(records);
  return {
    records,
    errors,
    manualRailwayConfigurationRequired: false,
    personalGasSpent: false,
    arbitrageSystemOwnedGasSpent: false,
  };
}
