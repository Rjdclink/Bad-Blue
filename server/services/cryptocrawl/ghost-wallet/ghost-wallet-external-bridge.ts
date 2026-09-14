import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Contract, ethers, providers } from 'ethers';
import { resolvePrimaryProfitPayoutAddress } from '../core/wallet-identity.js';
import { ghostWalletProviderMesh, type GhostWalletChain } from './ghost-wallet-provider-mesh.js';

const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const CREATE2_DEPLOYER_CODE_HASH = '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989';
const BRIDGE_SALT = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes('bad-blue:cryptocrawl-ghost-wallet-external-credit-bridge:v1'),
);
const BRIDGE_ABI = [
  'function owner() view returns (address)',
  'function profitRecipient() view returns (address)',
  'function minimumBrokerSpreadBps() view returns (uint16)',
];
const BRIDGE_READ_TIMEOUT_MS = 8_000;

interface BridgeArtifact {
  contractName: string;
  bytecode: string;
}

export interface GhostWalletExternalBridgeDescriptor {
  chain: GhostWalletChain;
  chainId: number;
  address: string;
  deployed: boolean;
  owner: string;
  profitRecipient: string;
  minimumBrokerSpreadBps: number;
  deployment: null | {
    to: string;
    data: string;
    value: '0';
    payer: 'transaction_initiator';
    operatorCost: 0;
  };
}

let artifactPromise: Promise<BridgeArtifact> | null = null;

function timeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
    promise.then(
      value => { clearTimeout(timer); resolvePromise(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function firstSuccessful<T>(attempts: Array<Promise<T>>, label: string): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    if (attempts.length === 0) {
      reject(new Error(label));
      return;
    }
    let remaining = attempts.length;
    let lastError: unknown;
    for (const attempt of attempts) {
      attempt.then(resolvePromise, error => {
        lastError = error;
        remaining -= 1;
        if (remaining === 0) reject(lastError instanceof Error ? lastError : new Error(label));
      });
    }
  });
}

async function artifact(): Promise<BridgeArtifact> {
  if (!artifactPromise) {
    artifactPromise = (async () => {
      const raw = await readFile(
        resolve(process.cwd(), 'artifacts/cryptocrawl/CryptocrawlGhostWalletErc3156Bridge.json'),
        'utf8',
      );
      const parsed = JSON.parse(raw) as Partial<BridgeArtifact>;
      if (parsed.contractName !== 'CryptocrawlGhostWalletErc3156Bridge'
        || typeof parsed.bytecode !== 'string'
        || !ethers.utils.isHexString(parsed.bytecode)
        || parsed.bytecode === '0x') {
        throw new Error('GHOST_WALLET_EXTERNAL_BRIDGE_ARTIFACT_INVALID');
      }
      return parsed as BridgeArtifact;
    })();
  }
  return artifactPromise;
}

function canonicalRecipient(): string {
  const recipient = resolvePrimaryProfitPayoutAddress();
  if (!recipient) throw new Error('GHOST_WALLET_PRIMARY_PAYOUT_UNAVAILABLE');
  return ethers.utils.getAddress(recipient);
}

async function verifyFactory(provider: providers.JsonRpcProvider): Promise<void> {
  const code = await provider.getCode(CREATE2_DEPLOYER);
  if (code === '0x' || ethers.utils.keccak256(code).toLowerCase() !== CREATE2_DEPLOYER_CODE_HASH.toLowerCase()) {
    throw new Error('GHOST_WALLET_CREATE2_FACTORY_NOT_VERIFIED');
  }
}

export async function getGhostWalletExternalBridgeDescriptor(
  chain: GhostWalletChain,
): Promise<GhostWalletExternalBridgeDescriptor> {
  const availableProviders = await ghostWalletProviderMesh.getProviders(chain);
  if (availableProviders.length === 0) throw new Error(`GHOST_WALLET_RPC_UNAVAILABLE:${chain}`);
  const built = await artifact();
  const recipient = canonicalRecipient();
  const initCode = ethers.utils.hexConcat([
    built.bytecode,
    ethers.utils.defaultAbiCoder.encode(['address', 'address'], [recipient, recipient]),
  ]);
  const bridgeAddress = ethers.utils.getCreate2Address(
    CREATE2_DEPLOYER,
    BRIDGE_SALT,
    ethers.utils.keccak256(initCode),
  );
  return firstSuccessful(availableProviders.map(provider => timeout((async () => {
    const network = await provider.getNetwork();
    const code = await provider.getCode(bridgeAddress);
    if (code !== '0x') {
      const bridge = new Contract(bridgeAddress, BRIDGE_ABI, provider);
      const [owner, profitRecipient, minimumBrokerSpreadBps] = await Promise.all([
        bridge.owner(), bridge.profitRecipient(), bridge.minimumBrokerSpreadBps(),
      ]);
      if (String(owner).toLowerCase() !== recipient.toLowerCase()
        || String(profitRecipient).toLowerCase() !== recipient.toLowerCase()) {
        throw new Error('GHOST_WALLET_EXTERNAL_BRIDGE_IDENTITY_MISMATCH');
      }
      return {
        chain,
        chainId: network.chainId,
        address: bridgeAddress,
        deployed: true,
        owner: recipient,
        profitRecipient: recipient,
        minimumBrokerSpreadBps: Number(minimumBrokerSpreadBps),
        deployment: null,
      } satisfies GhostWalletExternalBridgeDescriptor;
    }

    // Deployment is deliberately not submitted by the Ghost server. Any borrower,
    // integrator, builder or other third party may permissionlessly deploy the exact
    // deterministic bridge through the verified singleton factory and pay that one
    // transaction's gas. The user's/operator's monetary input remains exactly zero.
    await verifyFactory(provider);
    return {
      chain,
      chainId: network.chainId,
      address: bridgeAddress,
      deployed: false,
      owner: recipient,
      profitRecipient: recipient,
      minimumBrokerSpreadBps: 0,
      deployment: {
        to: CREATE2_DEPLOYER,
        data: ethers.utils.hexConcat([BRIDGE_SALT, initCode]),
        value: '0',
        payer: 'transaction_initiator',
        operatorCost: 0,
      },
    } satisfies GhostWalletExternalBridgeDescriptor;
  })(), BRIDGE_READ_TIMEOUT_MS, `Ghost external bridge descriptor ${chain}`)), `GHOST_WALLET_EXTERNAL_BRIDGE_UNAVAILABLE:${chain}`);
}

export async function getReadyGhostWalletExternalBridges(): Promise<GhostWalletExternalBridgeDescriptor[]> {
  const chains = ghostWalletProviderMesh.getReadyChains();
  const settled = await Promise.allSettled(chains.map(chain => getGhostWalletExternalBridgeDescriptor(chain)));
  return settled
    .filter((row): row is PromiseFulfilledResult<GhostWalletExternalBridgeDescriptor> => row.status === 'fulfilled')
    .map(row => row.value);
}

export const GHOST_WALLET_EXTERNAL_BRIDGE_POLICY = {
  serverSubmitsDeployment: false,
  deploymentPayer: 'transaction_initiator',
  operatorInitialCapitalRequired: false,
  lenderAllowlistRequired: false,
  supportedUpstreamAdapters: ['erc3156', 'aave_v3', 'morpho_blue', 'balancer_v2'] as const,
  fixedBpsSpreadFloor: false,
  providerReadFailover: true,
  providerReadTimeoutMs: BRIDGE_READ_TIMEOUT_MS,
} as const;
