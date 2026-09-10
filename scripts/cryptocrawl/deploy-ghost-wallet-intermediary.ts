import 'dotenv/config';
import { Contract, ContractFactory, Wallet, providers, utils } from 'ethers';
import { compileGhostWalletIntermediary } from './compile-flashloan-receiver.js';
import { normalizePrivateKey, resolvePrimaryProfitPayoutAddress } from '../../server/services/cryptocrawl/core/wallet-identity.js';

type DeploymentChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'bsc' | 'avalanche';

const CHAINS: Record<DeploymentChain, { chainId: number; rpcEnv: string; fallbackRpc: string }> = {
  ethereum: { chainId: 1, rpcEnv: 'ETHEREUM_RPC_URL', fallbackRpc: 'https://eth.llamarpc.com' },
  polygon: { chainId: 137, rpcEnv: 'POLYGON_RPC_URL', fallbackRpc: 'https://polygon.llamarpc.com' },
  arbitrum: { chainId: 42161, rpcEnv: 'ARBITRUM_RPC_URL', fallbackRpc: 'https://arbitrum.llamarpc.com' },
  optimism: { chainId: 10, rpcEnv: 'OPTIMISM_RPC_URL', fallbackRpc: 'https://optimism.llamarpc.com' },
  bsc: { chainId: 56, rpcEnv: 'BSC_RPC_URL', fallbackRpc: 'https://bsc-dataseed.binance.org' },
  avalanche: { chainId: 43114, rpcEnv: 'AVALANCHE_RPC_URL', fallbackRpc: 'https://api.avax.network/ext/bc/C/rpc' },
};

function parseChain(value: string | undefined): DeploymentChain {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized in CHAINS) return normalized as DeploymentChain;
  throw new Error('GHOST_WALLET_DEPLOY_CHAIN must be ethereum, polygon, arbitrum, optimism, bsc, or avalanche');
}

function address(name: string, value: string): string {
  if (!utils.isAddress(value)) throw new Error(`${name} must be a valid EVM address`);
  return utils.getAddress(value);
}

export async function deployGhostWalletIntermediary(): Promise<{
  chain: DeploymentChain;
  address: string;
  transactionHash: string;
  owner: string;
  profitRecipient: string;
  codeHash: string;
} | null> {
  const chain = parseChain(process.env.GHOST_WALLET_DEPLOY_CHAIN);
  const config = CHAINS[chain];
  const rpcUrl = process.env.GHOST_WALLET_DEPLOY_RPC_URL?.trim()
    || process.env[config.rpcEnv]?.trim()
    || config.fallbackRpc;
  const privateKey = normalizePrivateKey(process.env.WALLET_PRIVATE_KEY);
  if (!privateKey) throw new Error('WALLET_PRIVATE_KEY must contain a valid 32-byte EVM private key');

  const provider = new providers.JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const network = await provider.getNetwork();
  if (network.chainId !== config.chainId) {
    throw new Error(`Ghost Wallet deployment RPC returned chain ${network.chainId}; expected ${config.chainId} for ${chain}`);
  }

  const canonicalRecipient = resolvePrimaryProfitPayoutAddress();
  if (!canonicalRecipient) throw new Error('Canonical primary profit recipient cannot be derived from WALLET_PRIVATE_KEY');
  const owner = address('GHOST_WALLET_OWNER', process.env.GHOST_WALLET_OWNER?.trim() || wallet.address);
  const profitRecipient = address('canonical primary profit recipient', canonicalRecipient);
  const artifact = await compileGhostWalletIntermediary();
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployTransaction = factory.getDeployTransaction(owner, profitRecipient);
  const estimatedGas = await provider.estimateGas({ ...deployTransaction, from: wallet.address });
  const gasLimit = estimatedGas.mul(120).div(100);

  const broadcastAllowed = process.env.GHOST_WALLET_DEPLOY === 'true'
    && process.env.GHOST_WALLET_DEPLOY_CONFIRMATION === 'DEPLOY_GHOST_WALLET_INTERMEDIARY';
  if (!broadcastAllowed) {
    console.log(JSON.stringify({
      mode: 'dry_run',
      chain,
      chainId: network.chainId,
      deployer: wallet.address,
      owner,
      profitRecipient,
      estimatedGas: estimatedGas.toString(),
      compiler: artifact.compiler,
      nextStep: 'Set GHOST_WALLET_DEPLOY=true and GHOST_WALLET_DEPLOY_CONFIRMATION=DEPLOY_GHOST_WALLET_INTERMEDIARY to broadcast.',
    }, null, 2));
    return null;
  }

  const contract = await factory.deploy(owner, profitRecipient, { gasLimit });
  const receipt = await contract.deployTransaction.wait();
  if (receipt.status !== 1) throw new Error('Ghost Wallet deployment transaction reverted');
  const code = await provider.getCode(contract.address);
  if (!code || code === '0x') throw new Error('Ghost Wallet deployment mined but no runtime bytecode is present');

  const verified = new Contract(contract.address, [
    'function owner() view returns (address)',
    'function profitRecipient() view returns (address)',
    'function paused() view returns (bool)',
  ], provider);
  const [actualOwnerRaw, actualRecipientRaw, paused] = await Promise.all([
    verified.owner() as Promise<string>,
    verified.profitRecipient() as Promise<string>,
    verified.paused() as Promise<boolean>,
  ]);
  const actualOwner = address('deployed Ghost Wallet owner', actualOwnerRaw);
  const actualRecipient = address('deployed Ghost Wallet profit recipient', actualRecipientRaw);
  if (actualOwner.toLowerCase() !== owner.toLowerCase()) throw new Error('Ghost Wallet owner verification failed');
  if (actualRecipient.toLowerCase() !== profitRecipient.toLowerCase()) throw new Error('Ghost Wallet payout recipient verification failed');
  if (paused) throw new Error('Ghost Wallet deployed in an unexpected paused state');

  const codeHash = utils.keccak256(code);
  const result = {
    chain,
    address: contract.address,
    transactionHash: contract.deployTransaction.hash,
    owner,
    profitRecipient,
    codeHash,
  };
  console.log(JSON.stringify({
    mode: 'deployed_verified',
    ...result,
    environmentHint: `GHOST_WALLET_INTERMEDIARY_${chain.toUpperCase()}=${contract.address}`,
  }, null, 2));
  return result;
}

const direct = /(?:^|\/)deploy-ghost-wallet-intermediary\.(?:ts|js)$/.test(process.argv[1] || '');
if (direct) {
  deployGhostWalletIntermediary().catch(error => {
    console.error('[deploy-ghost-wallet-intermediary] failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
