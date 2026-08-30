import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Contract, ContractFactory, Wallet, providers, utils } from 'ethers';
import { compileAaveBalancerDualFlashLoanReceiver } from './compile-flashloan-receiver.js';
import { resolveAaveV3Pool } from '../../server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.js';
import { resolveSponsoredReceiverVault } from '../../server/services/cryptocrawl/execution/adapters/sponsored-receiver-manager.js';

type DualDeploymentChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'bsc' | 'avalanche';

const CHAINS: Record<DualDeploymentChain, { chainId: number; rpcEnv: string }> = {
  ethereum: { chainId: 1, rpcEnv: 'ETHEREUM_RPC_URL' },
  polygon: { chainId: 137, rpcEnv: 'POLYGON_RPC_URL' },
  arbitrum: { chainId: 42161, rpcEnv: 'ARBITRUM_RPC_URL' },
  optimism: { chainId: 10, rpcEnv: 'OPTIMISM_RPC_URL' },
  bsc: { chainId: 56, rpcEnv: 'BSC_RPC_URL' },
  avalanche: { chainId: 43114, rpcEnv: 'AVALANCHE_RPC_URL' },
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseChain(raw: string | undefined): DualDeploymentChain {
  const value = String(raw || '').trim().toLowerCase();
  if (value in CHAINS) return value as DualDeploymentChain;
  throw new Error(`ZERO_CAPITAL_DEPLOY_CHAIN must be one of: ${Object.keys(CHAINS).join(', ')}`);
}

function requireAddress(label: string, value: string): string {
  if (!utils.isAddress(value)) throw new Error(`${label} must be a valid EVM address`);
  return utils.getAddress(value);
}

export async function deployDualFlashLoanReceiver(): Promise<null | {
  chain: DualDeploymentChain;
  address: string;
  owner: string;
  vault: string;
  pool: string;
  transactionHash: string;
  blockNumber: number;
  codeHash: string;
  compiler: string;
}> {
  const chain = parseChain(process.env.ZERO_CAPITAL_DEPLOY_CHAIN);
  const config = CHAINS[chain];
  const rpcUrl = process.env.ZERO_CAPITAL_DEPLOY_RPC_URL?.trim() || requireEnv(config.rpcEnv);
  const provider = new providers.JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(requireEnv('WALLET_PRIVATE_KEY'), provider);
  const network = await provider.getNetwork();
  if (network.chainId !== config.chainId) throw new Error(`RPC chain id ${network.chainId} does not match ${chain} (${config.chainId})`);

  const owner = requireAddress('ZERO_CAPITAL_DEPLOY_OWNER', process.env.ZERO_CAPITAL_DEPLOY_OWNER?.trim() || wallet.address);
  const vault = resolveSponsoredReceiverVault(chain);
  const pool = resolveAaveV3Pool(chain);
  if (!vault || !pool) throw new Error(`${chain} must have both Balancer vault and Aave V3 pool configured before dual receiver deployment`);

  const artifact = await compileAaveBalancerDualFlashLoanReceiver();
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployTx = factory.getDeployTransaction(vault, pool, owner);
  const estimatedGas = await provider.estimateGas({ ...deployTx, from: wallet.address });
  const gasLimit = estimatedGas.mul(125).div(100);
  const broadcastAllowed = process.env.ZERO_CAPITAL_DEPLOY === 'true'
    && process.env.ZERO_CAPITAL_DEPLOY_CONFIRMATION === 'DEPLOY_AAVE_BALANCER_DUAL_RECEIVER';

  if (!broadcastAllowed) {
    console.log(JSON.stringify({
      mode: 'dry_run',
      chain,
      chainId: network.chainId,
      deployer: wallet.address,
      owner,
      vault,
      pool,
      estimatedGas: estimatedGas.toString(),
      compiler: artifact.compiler,
      nextStep: 'Set ZERO_CAPITAL_DEPLOY=true and ZERO_CAPITAL_DEPLOY_CONFIRMATION=DEPLOY_AAVE_BALANCER_DUAL_RECEIVER to broadcast.',
    }, null, 2));
    return null;
  }

  const contract = await factory.deploy(vault, pool, owner, { gasLimit });
  const receipt = await contract.deployTransaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error('Dual receiver deployment transaction reverted');
  const code = await provider.getCode(contract.address);
  if (code === '0x') throw new Error('Dual receiver deployment receipt succeeded but bytecode is missing');

  const verification = new Contract(contract.address, [
    'function owner() view returns (address)',
    'function vault() view returns (address)',
    'function pool() view returns (address)',
  ], provider);
  const [actualOwnerRaw, actualVaultRaw, actualPoolRaw] = await Promise.all([
    verification.owner() as Promise<string>,
    verification.vault() as Promise<string>,
    verification.pool() as Promise<string>,
  ]);
  const actualOwner = requireAddress('deployed owner', actualOwnerRaw);
  const actualVault = requireAddress('deployed vault', actualVaultRaw);
  const actualPool = requireAddress('deployed pool', actualPoolRaw);
  if (actualOwner.toLowerCase() !== owner.toLowerCase()) throw new Error('Dual receiver owner verification failed');
  if (actualVault.toLowerCase() !== vault.toLowerCase()) throw new Error('Dual receiver Balancer vault verification failed');
  if (actualPool.toLowerCase() !== pool.toLowerCase()) throw new Error('Dual receiver Aave pool verification failed');

  const record = {
    chain,
    address: contract.address,
    owner,
    vault,
    pool,
    transactionHash: contract.deployTransaction.hash,
    blockNumber: receipt.blockNumber,
    codeHash: utils.keccak256(code),
    compiler: artifact.compiler,
  };
  const output = resolve(process.cwd(), `contracts/cryptocrawl/deployments/${chain}-aave-balancer-dual.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ ...record, deployedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ...record,
    environmentHint: `ZERO_CAPITAL_AAVE_BALANCER_DUAL_RECEIVER_${chain.toUpperCase()}=${contract.address}`,
    deploymentRecord: output,
  }, null, 2));
  return record;
}

const isDirect = /(?:^|\/)deploy-dual-flashloan-receiver\.(?:ts|js)$/.test(process.argv[1] || '');
if (isDirect) {
  deployDualFlashLoanReceiver().catch(error => {
    console.error('[deploy-dual-flashloan-receiver] failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
