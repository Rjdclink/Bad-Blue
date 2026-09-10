import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Contract, ethers, type providers } from 'ethers';

const INTERMEDIARY_SALT = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-ghost-wallet-intermediary:v1'),
);
const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const INTERMEDIARY_ABI = [
  'function owner() view returns (address)',
  'function profitRecipient() view returns (address)',
];
const VAULT_ABI = [
  'function asset() view returns (address)',
  'function intermediary() view returns (address)',
  'function owner() view returns (address)',
];

type Artifact = { contractName: string; bytecode: string };

export interface ExistingGhostArbitrageInfrastructure {
  intermediary: string | null;
  vaults: Array<{ chain: string; vault: string; asset: string; label: string }>;
  provenance: string[];
}

let intermediaryArtifactPromise: Promise<Artifact> | null = null;
let vaultArtifactPromise: Promise<Artifact> | null = null;

async function loadArtifact(name: 'CryptocrawlGhostWalletIntermediary' | 'CryptocrawlGhostWalletCapitalVault'): Promise<Artifact> {
  const existing = name === 'CryptocrawlGhostWalletIntermediary'
    ? intermediaryArtifactPromise
    : vaultArtifactPromise;
  if (existing) return existing;
  const work = readFile(resolve(process.cwd(), `artifacts/cryptocrawl/${name}.json`), 'utf8')
    .then(raw => JSON.parse(raw) as Partial<Artifact>)
    .then(artifact => {
      if (artifact.contractName !== name || typeof artifact.bytecode !== 'string' || !ethers.utils.isHexString(artifact.bytecode)) {
        throw new Error(`${name} artifact is missing or invalid`);
      }
      return artifact as Artifact;
    });
  if (name === 'CryptocrawlGhostWalletIntermediary') intermediaryArtifactPromise = work;
  else vaultArtifactPromise = work;
  return work;
}

function vaultSalt(chainId: number, asset: string): string {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['string', 'uint256', 'address'],
      ['bad-blue:cryptocrawl-ghost-wallet-vault:v1', chainId, asset],
    ),
  );
}

function predictedAddress(salt: string, bytecode: string, constructorTypes: string[], constructorValues: unknown[]): string {
  const initCode = ethers.utils.hexConcat([
    bytecode,
    ethers.utils.defaultAbiCoder.encode(constructorTypes, constructorValues),
  ]);
  return ethers.utils.getCreate2Address(CREATE2_DEPLOYER, salt, ethers.utils.keccak256(initCode));
}

function uniqueAssets(values: readonly string[]): string[] {
  const normalized = new Map<string, string>();
  for (const value of values) {
    try {
      const asset = ethers.utils.getAddress(value);
      normalized.set(asset.toLowerCase(), asset);
    } catch {
      // An invalid candidate asset is local to that opportunity and is ignored here.
    }
  }
  return [...normalized.values()];
}

/**
 * Read-only compatibility discovery for Ghost arbitrage infrastructure that may
 * already exist from the retired deterministic CREATE2 bootstrap. This function
 * never deploys, grants permissions, changes an environment variable, or spends
 * gas. Absence/failure is route-local and simply yields no alternative source.
 */
export async function discoverExistingGhostArbitrageInfrastructure(input: {
  chain: string;
  provider: providers.JsonRpcProvider;
  owner: string;
  profitRecipient: string;
  assets: readonly string[];
}): Promise<ExistingGhostArbitrageInfrastructure> {
  const owner = ethers.utils.getAddress(input.owner);
  const profitRecipient = ethers.utils.getAddress(input.profitRecipient);
  const [network, intermediaryArtifact, vaultArtifact] = await Promise.all([
    input.provider.getNetwork(),
    loadArtifact('CryptocrawlGhostWalletIntermediary'),
    loadArtifact('CryptocrawlGhostWalletCapitalVault'),
  ]);
  const intermediary = predictedAddress(
    INTERMEDIARY_SALT,
    intermediaryArtifact.bytecode,
    ['address', 'address'],
    [owner, profitRecipient],
  );
  if (await input.provider.getCode(intermediary) === '0x') {
    return {
      intermediary: null,
      vaults: [],
      provenance: ['legacy_deterministic_intermediary_not_deployed', 'server_deployment_attempted:false'],
    };
  }
  const intermediaryContract = new Contract(intermediary, INTERMEDIARY_ABI, input.provider);
  const [actualOwnerRaw, actualRecipientRaw] = await Promise.all([
    intermediaryContract.owner(),
    intermediaryContract.profitRecipient(),
  ]);
  const actualOwner = ethers.utils.getAddress(String(actualOwnerRaw));
  const actualRecipient = ethers.utils.getAddress(String(actualRecipientRaw));
  if (actualOwner.toLowerCase() !== owner.toLowerCase() || actualRecipient.toLowerCase() !== profitRecipient.toLowerCase()) {
    return {
      intermediary: null,
      vaults: [],
      provenance: ['legacy_deterministic_intermediary_identity_mismatch', 'server_deployment_attempted:false'],
    };
  }

  const vaults: ExistingGhostArbitrageInfrastructure['vaults'] = [];
  for (const asset of uniqueAssets(input.assets)) {
    const vault = predictedAddress(
      vaultSalt(network.chainId, asset),
      vaultArtifact.bytecode,
      ['address', 'address', 'address'],
      [asset, intermediary, owner],
    );
    if (await input.provider.getCode(vault) === '0x') continue;
    try {
      const contract = new Contract(vault, VAULT_ABI, input.provider);
      const [actualAssetRaw, actualIntermediaryRaw, actualVaultOwnerRaw] = await Promise.all([
        contract.asset(),
        contract.intermediary(),
        contract.owner(),
      ]);
      if (ethers.utils.getAddress(String(actualAssetRaw)).toLowerCase() !== asset.toLowerCase()) continue;
      if (ethers.utils.getAddress(String(actualIntermediaryRaw)).toLowerCase() !== intermediary.toLowerCase()) continue;
      if (ethers.utils.getAddress(String(actualVaultOwnerRaw)).toLowerCase() !== owner.toLowerCase()) continue;
      vaults.push({
        chain: input.chain.trim().toLowerCase(),
        vault,
        asset,
        label: 'existing_create2_verified_read_only',
      });
    } catch {
      // A single stale/incompatible vault never removes another valid source.
    }
  }

  return {
    intermediary,
    vaults,
    provenance: [
      'legacy_deterministic_intermediary_existing_bytecode_verified',
      'legacy_deterministic_intermediary_owner_verified',
      'legacy_deterministic_intermediary_profit_recipient_verified',
      'server_deployment_attempted:false',
      'server_permission_mutation_attempted:false',
    ],
  };
}
