import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Wallet, providers, ContractFactory, utils } from 'ethers';
import { compileFlashLoanReceiver } from './compile-flashloan-receiver.js';

type SupportedDeploymentChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism';

const DEPLOYMENT_CHAINS: Record<SupportedDeploymentChain, { chainId: number; rpcEnv: string; balancerVault: string }> = {
  ethereum: {
    chainId: 1,
    rpcEnv: 'ETHEREUM_RPC_URL',
    balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  },
  polygon: {
    chainId: 137,
    rpcEnv: 'POLYGON_RPC_URL',
    balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  },
  arbitrum: {
    chainId: 42161,
    rpcEnv: 'ARBITRUM_RPC_URL',
    balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  },
  optimism: {
    chainId: 10,
    rpcEnv: 'OPTIMISM_RPC_URL',
    balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  },
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseChain(value: string | undefined): SupportedDeploymentChain {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ethereum' || normalized === 'polygon' || normalized === 'arbitrum' || normalized === 'optimism') {
    return normalized;
  }
  throw new Error('ZERO_CAPITAL_DEPLOY_CHAIN must be ethereum, polygon, arbitrum, or optimism');
}

function requireAddress(name: string, value: string): string {
  if (!utils.isAddress(value)) {
    throw new Error(`${name} must be a valid EVM address`);
  }
  return utils.getAddress(value);
}

async function main(): Promise<void> {
  const chain = parseChain(process.env.ZERO_CAPITAL_DEPLOY_CHAIN);
  const chainConfig = DEPLOYMENT_CHAINS[chain];
  const rpcUrl = process.env.ZERO_CAPITAL_DEPLOY_RPC_URL?.trim() || requireEnv(chainConfig.rpcEnv);
  const privateKey = requireEnv('WALLET_PRIVATE_KEY');
  const provider = new providers.JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const network = await provider.getNetwork();

  if (network.chainId !== chainConfig.chainId) {
    throw new Error(`RPC chain id ${network.chainId} does not match ZERO_CAPITAL_DEPLOY_CHAIN=${chain} (${chainConfig.chainId})`);
  }

  const owner = requireAddress('ZERO_CAPITAL_DEPLOY_OWNER', process.env.ZERO_CAPITAL_DEPLOY_OWNER?.trim() || wallet.address);
  const vault = requireAddress('ZERO_CAPITAL_BALANCER_VAULT', process.env.ZERO_CAPITAL_BALANCER_VAULT?.trim() || chainConfig.balancerVault);
  const artifact = await compileFlashLoanReceiver();
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployTransaction = factory.getDeployTransaction(vault, owner);
  const estimatedGas = await provider.estimateGas(deployTransaction);
  const broadcastAllowed =
    process.env.ZERO_CAPITAL_DEPLOY === 'true' &&
    process.env.ZERO_CAPITAL_DEPLOY_CONFIRMATION === 'DEPLOY_FLASHLOAN_RECEIVER';

  if (!broadcastAllowed) {
    console.log(JSON.stringify({
      mode: 'dry_run',
      chain,
      chainId: network.chainId,
      deployer: wallet.address,
      owner,
      vault,
      estimatedGas: estimatedGas.toString(),
      compiler: artifact.compiler,
      nextStep: 'Set ZERO_CAPITAL_DEPLOY=true and ZERO_CAPITAL_DEPLOY_CONFIRMATION=DEPLOY_FLASHLOAN_RECEIVER to broadcast.',
    }, null, 2));
    return;
  }

  const contract = await factory.deploy(vault, owner, {
    gasLimit: estimatedGas.mul(120).div(100),
  });
  const receipt = await contract.deployTransaction.wait();
  const code = await provider.getCode(contract.address);
  if (code === '0x') {
    throw new Error('Deployment receipt succeeded but no contract bytecode exists at the deployed address');
  }

  const deploymentRecord = {
    contract: artifact.contractName,
    chain,
    chainId: network.chainId,
    address: contract.address,
    owner,
    vault,
    deployer: wallet.address,
    transactionHash: contract.deployTransaction.hash,
    blockNumber: receipt.blockNumber,
    compiler: artifact.compiler,
    deployedAt: new Date().toISOString(),
  };
  const outputPath = resolve(process.cwd(), `contracts/cryptocrawl/deployments/${chain}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(deploymentRecord, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    ...deploymentRecord,
    deploymentRecord: outputPath,
    nextStep: `Set ZERO_CAPITAL_FLASHLOAN_RECEIVER=${contract.address} only after independent contract review and testnet validation.`,
  }, null, 2));
}

main().catch(error => {
  console.error('[deploy-flashloan-receiver] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});