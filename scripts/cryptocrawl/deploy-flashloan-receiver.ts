import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Wallet, providers, ContractFactory, utils } from 'ethers';
import { compileFlashLoanReceiver, compileSushiV3FlashReceiver } from './compile-flashloan-receiver.js';
import { sendEuropaZeroGasProvisioningTransaction } from './europa-zero-gas-provisioning.js';
import { EUROPA_NETWORK } from '../../server/services/cryptocrawl/execution/adapters/europa-network.js';
import { EUROPA_SUSHI } from '../../server/services/cryptocrawl/execution/adapters/europa-sushi-registry.js';

type SupportedDeploymentChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'europa';

const DEPLOYMENT_CHAINS: Record<SupportedDeploymentChain, { chainId: number; rpcEnv: string; balancerVault?: string }> = {
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
  europa: {
    chainId: EUROPA_NETWORK.chainId,
    rpcEnv: 'EUROPA_RPC_URL',
  },
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseChain(value: string | undefined): SupportedDeploymentChain {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ethereum' || normalized === 'polygon' || normalized === 'arbitrum' || normalized === 'optimism' || normalized === 'europa') {
    return normalized;
  }
  throw new Error('ZERO_CAPITAL_DEPLOY_CHAIN must be ethereum, polygon, arbitrum, optimism, or europa');
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
  const rpcUrl = process.env.ZERO_CAPITAL_DEPLOY_RPC_URL?.trim() ||
    (chain === 'europa' ? EUROPA_NETWORK.rpcUrl : requireEnv(chainConfig.rpcEnv));
  const privateKey = requireEnv('WALLET_PRIVATE_KEY');
  const provider = new providers.JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const network = await provider.getNetwork();

  if (network.chainId !== chainConfig.chainId) {
    throw new Error(`RPC chain id ${network.chainId} does not match ZERO_CAPITAL_DEPLOY_CHAIN=${chain} (${chainConfig.chainId})`);
  }

  const owner = requireAddress('ZERO_CAPITAL_DEPLOY_OWNER', process.env.ZERO_CAPITAL_DEPLOY_OWNER?.trim() || wallet.address);
  if (chain === 'europa' && owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error('Europa zero-capital provisioning requires ZERO_CAPITAL_DEPLOY_OWNER to be the canonical WALLET_PRIVATE_KEY address');
  }

  const receiverKind = process.env.ZERO_CAPITAL_DEPLOY_RECEIVER?.trim() || (chain === 'europa' ? 'sushi-v3' : 'balancer');
  const isSushiV3 = receiverKind === 'sushi-v3';
  if (receiverKind !== 'balancer' && !isSushiV3) {
    throw new Error('ZERO_CAPITAL_DEPLOY_RECEIVER must be balancer or sushi-v3');
  }
  if (chain !== 'europa' && isSushiV3) {
    throw new Error('The reviewed Sushi V3 receiver deployment path is currently restricted to SKALE Europa');
  }

  const infrastructure = isSushiV3
    ? requireAddress('ZERO_CAPITAL_EUROPA_SUSHI_V3_FACTORY', process.env.ZERO_CAPITAL_EUROPA_SUSHI_V3_FACTORY?.trim() || EUROPA_SUSHI.v3Factory)
    : requireAddress(
      'ZERO_CAPITAL_BALANCER_VAULT',
      process.env.ZERO_CAPITAL_BALANCER_VAULT?.trim() ||
        (chain === 'europa' ? process.env.ZERO_CAPITAL_EUROPA_BALANCER_VAULT?.trim() || '' : chainConfig.balancerVault || ''),
    );
  if (isSushiV3 && infrastructure.toLowerCase() !== EUROPA_SUSHI.v3Factory.toLowerCase()) {
    throw new Error(`Europa Sushi V3 receiver must use the verified factory ${EUROPA_SUSHI.v3Factory}`);
  }

  const artifact = isSushiV3 ? await compileSushiV3FlashReceiver() : await compileFlashLoanReceiver();
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployTransaction = factory.getDeployTransaction(infrastructure, owner);
  const deployData = String(deployTransaction.data || '');
  if (!utils.isHexString(deployData) || deployData === '0x') throw new Error('Compiled receiver deployment transaction has no bytecode');
  const estimatedGas = await provider.estimateGas({ ...deployTransaction, from: wallet.address });
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
      infrastructure,
      receiverKind,
      estimatedGas: estimatedGas.toString(),
      compiler: artifact.compiler,
      zeroGasProvisioning: chain === 'europa',
      nextStep: 'Set ZERO_CAPITAL_DEPLOY=true and ZERO_CAPITAL_DEPLOY_CONFIRMATION=DEPLOY_FLASHLOAN_RECEIVER to broadcast.',
    }, null, 2));
    return;
  }

  let contractAddress: string;
  let transactionHash: string;
  let blockNumber: number;
  let computeSource: string | undefined;
  let zeroMonetaryGasVerified = false;

  if (chain === 'europa') {
    const gasLimit = estimatedGas.mul(125).div(100);
    const provisioning = await sendEuropaZeroGasProvisioningTransaction({
      provider,
      wallet,
      workloadId: `europa-receiver-deploy:${artifact.contractName}:${wallet.address}`,
      transaction: {
        data: deployData,
        value: deployTransaction.value || 0,
        gasLimit,
      },
    });
    const expectedContractAddress = utils.getContractAddress({ from: wallet.address, nonce: provisioning.nonce });
    contractAddress = provisioning.receipt.contractAddress
      ? requireAddress('Europa deployment receipt contract address', provisioning.receipt.contractAddress)
      : expectedContractAddress;
    if (contractAddress.toLowerCase() !== expectedContractAddress.toLowerCase()) {
      throw new Error(`Europa deployment address mismatch: expected ${expectedContractAddress}, received ${contractAddress}`);
    }
    transactionHash = provisioning.transactionHash;
    blockNumber = provisioning.receipt.blockNumber;
    computeSource = provisioning.computeSource;
    zeroMonetaryGasVerified = provisioning.zeroMonetaryGasVerified;
  } else {
    const contract = await factory.deploy(infrastructure, owner, {
      gasLimit: estimatedGas.mul(120).div(100),
    });
    const receipt = await contract.deployTransaction.wait();
    if (!receipt || receipt.status !== 1) throw new Error('Receiver deployment reverted');
    contractAddress = contract.address;
    transactionHash = contract.deployTransaction.hash;
    blockNumber = receipt.blockNumber;
  }

  const code = await provider.getCode(contractAddress);
  if (code === '0x') {
    throw new Error('Deployment receipt succeeded but no contract bytecode exists at the deployed address');
  }

  const deploymentRecord = {
    contract: artifact.contractName,
    chain,
    chainId: network.chainId,
    address: contractAddress,
    owner,
    infrastructure,
    receiverKind,
    deployer: wallet.address,
    transactionHash,
    blockNumber,
    compiler: artifact.compiler,
    codeHash: utils.keccak256(code),
    zeroMonetaryGasVerified,
    ...(computeSource ? { computeSource } : {}),
    deployedAt: new Date().toISOString(),
  };
  const outputPath = resolve(process.cwd(), `contracts/cryptocrawl/deployments/${chain}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(deploymentRecord, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    ...deploymentRecord,
    deploymentRecord: outputPath,
    nextStep: chain === 'europa'
      ? `Set ZERO_CAPITAL_EUROPA_RECEIVER=${contractAddress} and ZERO_CAPITAL_EUROPA_RECEIVER_CODE_HASH=${utils.keccak256(code)}, then run the receiver configuration command for Europa.`
      : `Set ZERO_CAPITAL_FLASHLOAN_RECEIVER=${contractAddress} only after independent contract review and testnet validation.`,
  }, null, 2));
}

main().catch(error => {
  console.error('[deploy-flashloan-receiver] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
