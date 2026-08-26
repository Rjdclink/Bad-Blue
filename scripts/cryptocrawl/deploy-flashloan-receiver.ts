import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { BigNumber, Wallet, providers, Contract, ContractFactory, utils } from 'ethers';
import { compileFlashLoanReceiver, compileSushiV3FlashReceiver } from './compile-flashloan-receiver.js';
import { EUROPA_NETWORK } from '../../server/services/cryptocrawl/execution/adapters/europa-network.js';
import { EUROPA_SUSHI } from '../../server/services/cryptocrawl/execution/adapters/europa-sushi-registry.js';
import {
  calculateSkaleExternalGas,
  deriveSkalePowCandidate,
  resolveEuropaExternalGasDifficulty,
} from '../../server/services/cryptocrawl/execution/adapters/skale-pow-adapter.js';

type SupportedDeploymentChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'europa';

export interface DeployFlashLoanReceiverOptions {
  chain?: SupportedDeploymentChain;
  receiverKind?: 'balancer' | 'sushi-v3';
}

export interface FlashLoanReceiverDeploymentRecord {
  contract: string;
  chain: SupportedDeploymentChain;
  chainId: number;
  address: string;
  owner: string;
  infrastructure: string;
  receiverKind: string;
  deployer: string;
  transactionHash: string;
  blockNumber: number;
  compiler: string;
  codeHash: string;
  deployedAt: string;
}

const DEPLOYMENT_CHAINS: Record<SupportedDeploymentChain, { chainId: number; rpcEnv: string; balancerVault?: string }> = {
  ethereum: { chainId: 1, rpcEnv: 'ETHEREUM_RPC_URL', balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8' },
  polygon: { chainId: 137, rpcEnv: 'POLYGON_RPC_URL', balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8' },
  arbitrum: { chainId: 42161, rpcEnv: 'ARBITRUM_RPC_URL', balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8' },
  optimism: { chainId: 10, rpcEnv: 'OPTIMISM_RPC_URL', balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8' },
  europa: { chainId: 2046399126, rpcEnv: 'EUROPA_RPC_URL' },
};

const SKALE_CONFIG_CONTROLLER = '0xD2002000000000000000000000000000000000d2';
const SKALE_CONFIG_CONTROLLER_ABI = [
  'function isFCDEnabled() view returns (bool)',
  'function isMTMEnabled() view returns (bool)',
  'function isAddressWhitelisted(address) view returns (bool)',
];

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseChain(value: string | undefined): SupportedDeploymentChain {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ethereum' || normalized === 'polygon' || normalized === 'arbitrum' || normalized === 'optimism' || normalized === 'europa') return normalized;
  throw new Error('ZERO_CAPITAL_DEPLOY_CHAIN must be ethereum, polygon, arbitrum, optimism, or europa');
}

function requireAddress(name: string, value: string): string {
  if (!utils.isAddress(value)) throw new Error(`${name} must be a valid EVM address`);
  return utils.getAddress(value);
}

export async function deployFlashLoanReceiver(options: DeployFlashLoanReceiverOptions = {}): Promise<FlashLoanReceiverDeploymentRecord | null> {
  const chain = options.chain || parseChain(process.env.ZERO_CAPITAL_DEPLOY_CHAIN);
  const chainConfig = DEPLOYMENT_CHAINS[chain];
  const rpcUrl = process.env.ZERO_CAPITAL_DEPLOY_RPC_URL?.trim() || (chain === 'europa' ? EUROPA_NETWORK.rpcUrl : requireEnv(chainConfig.rpcEnv));
  const privateKey = requireEnv('WALLET_PRIVATE_KEY');
  const provider = new providers.JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const network = await provider.getNetwork();

  if (network.chainId !== chainConfig.chainId) throw new Error(`RPC chain id ${network.chainId} does not match ZERO_CAPITAL_DEPLOY_CHAIN=${chain} (${chainConfig.chainId})`);

  const owner = requireAddress('ZERO_CAPITAL_DEPLOY_OWNER', process.env.ZERO_CAPITAL_DEPLOY_OWNER?.trim() || wallet.address);
  const receiverKind = options.receiverKind || process.env.ZERO_CAPITAL_DEPLOY_RECEIVER?.trim() || 'balancer';
  const isSushiV3 = receiverKind === 'sushi-v3';
  if (receiverKind !== 'balancer' && !isSushiV3) throw new Error('ZERO_CAPITAL_DEPLOY_RECEIVER must be balancer or sushi-v3');
  const infrastructure = isSushiV3
    ? requireAddress('ZERO_CAPITAL_EUROPA_SUSHI_V3_FACTORY', process.env.ZERO_CAPITAL_EUROPA_SUSHI_V3_FACTORY?.trim() || EUROPA_SUSHI.v3Factory)
    : requireAddress('ZERO_CAPITAL_BALANCER_VAULT', process.env.ZERO_CAPITAL_BALANCER_VAULT?.trim() || (chain === 'europa' ? process.env.ZERO_CAPITAL_EUROPA_BALANCER_VAULT?.trim() || '' : chainConfig.balancerVault || ''));
  const artifact = isSushiV3 ? await compileSushiV3FlashReceiver() : await compileFlashLoanReceiver();
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployTransaction = factory.getDeployTransaction(infrastructure, owner);
  const estimatedGas = await provider.estimateGas({ ...deployTransaction, from: wallet.address });
  const gasLimit = estimatedGas.mul(120).div(100);
  const broadcastAllowed = process.env.ZERO_CAPITAL_DEPLOY === 'true' && process.env.ZERO_CAPITAL_DEPLOY_CONFIRMATION === 'DEPLOY_FLASHLOAN_RECEIVER';

  if (!broadcastAllowed) {
    console.log(JSON.stringify({ mode: 'dry_run', chain, chainId: network.chainId, deployer: wallet.address, owner, infrastructure, receiverKind, estimatedGas: estimatedGas.toString(), compiler: artifact.compiler, nextStep: 'Set ZERO_CAPITAL_DEPLOY=true and ZERO_CAPITAL_DEPLOY_CONFIRMATION=DEPLOY_FLASHLOAN_RECEIVER to broadcast.' }, null, 2));
    return null;
  }

  let contractAddress: string;
  let transactionHash: string;
  let receipt: providers.TransactionReceipt;

  if (chain === 'europa') {
    const configController = new Contract(SKALE_CONFIG_CONTROLLER, SKALE_CONFIG_CONTROLLER_ABI, provider);
    const [fcdEnabled, mtmEnabled, deployerWhitelisted] = await Promise.all([
      configController.isFCDEnabled() as Promise<boolean>,
      configController.isMTMEnabled() as Promise<boolean>,
      configController.isAddressWhitelisted(wallet.address) as Promise<boolean>,
    ]);
    if (!fcdEnabled && !deployerWhitelisted) {
      throw new Error(`EUROPA_DEPLOYMENT_ACCESS_DENIED: FCD is disabled and deployer ${wallet.address} is not whitelisted`);
    }
    console.log(`[deploy-flashloan-receiver] Europa capabilities: FCD=${fcdEnabled}, MTM=${mtmEnabled}, whitelisted=${deployerWhitelisted}`);

    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    const { difficulty, source } = await resolveEuropaExternalGasDifficulty(provider);
    const maxAttempts = Math.max(1, Number(process.env.ZERO_CAPITAL_EUROPA_DEPLOY_POW_MAX_ATTEMPTS || 1_000_000));
    const workloadId = `deploy:${artifact.contractName}:${wallet.address}:${nonce}`;
    const deploymentData = utils.arrayify(deployTransaction.data || '0x');
    let requiredExternalGas = 53_000n;
    for (const byte of deploymentData) requiredExternalGas += byte === 0 ? 4n : 16n;
    let gasPrice: BigNumber | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = deriveSkalePowCandidate(workloadId, 0, 1, attempt);
      const externalGas = calculateSkaleExternalGas(wallet.address, nonce, candidate, difficulty);
      if (externalGas < requiredExternalGas) continue;
      const candidateGasPrice = BigNumber.from(candidate.toString());
      try {
        const verifiedEstimate = await provider.estimateGas({ ...deployTransaction, from: wallet.address, gasPrice: candidateGasPrice });
        if (verifiedEstimate.gt(gasLimit)) throw new Error(`Europa deployment estimate ${verifiedEstimate.toString()} exceeds bounded gas limit ${gasLimit.toString()}`);
        gasPrice = candidateGasPrice;
        break;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Europa deployment estimate ')) throw error;
      }
    }

    if (!gasPrice) throw new Error(`EUROPA_POW_NOT_FOUND: SKALE external-gas proof not found in ${maxAttempts} attempts for Europa receiver deployment`);

    const finalTransaction = {
      ...deployTransaction,
      from: wallet.address,
      chainId: network.chainId,
      nonce,
      gasLimit,
      gasPrice,
    };

    try {
      await provider.call(finalTransaction, 'latest');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`EUROPA_DEPLOYMENT_PREFLIGHT_REVERTED: ${message}`);
    }

    const { from: _from, ...signableTransaction } = finalTransaction;
    const signedTransaction = await wallet.signTransaction(signableTransaction);
    const response = await provider.sendTransaction(signedTransaction);
    receipt = await response.wait();
    if (receipt.status !== 1) throw new Error(`EUROPA_DEPLOYMENT_RECEIPT_REVERTED: transaction ${response.hash} was mined with status 0`);
    contractAddress = utils.getContractAddress({ from: wallet.address, nonce });
    transactionHash = response.hash;
    console.log(`[deploy-flashloan-receiver] Europa external-gas PoW accepted (${source})`);
  } else {
    const contract = await factory.deploy(infrastructure, owner, { gasLimit });
    receipt = await contract.deployTransaction.wait();
    if (receipt.status !== 1) throw new Error(`${chain} receiver deployment transaction reverted`);
    contractAddress = contract.address;
    transactionHash = contract.deployTransaction.hash;
  }

  const code = await provider.getCode(contractAddress);
  if (code === '0x') throw new Error('DEPLOYMENT_CODE_MISSING: receipt succeeded but no contract bytecode exists at the deployed address');

  const deploymentRecord: FlashLoanReceiverDeploymentRecord = { contract: artifact.contractName, chain, chainId: network.chainId, address: contractAddress, owner, infrastructure, receiverKind, deployer: wallet.address, transactionHash, blockNumber: receipt.blockNumber, compiler: artifact.compiler, codeHash: utils.keccak256(code), deployedAt: new Date().toISOString() };
  const outputPath = resolve(process.cwd(), `contracts/cryptocrawl/deployments/${chain}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(deploymentRecord, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({ ...deploymentRecord, deploymentRecord: outputPath, nextStep: chain === 'europa' ? `Set ZERO_CAPITAL_EUROPA_RECEIVER=${contractAddress} and ZERO_CAPITAL_EUROPA_RECEIVER_CODE_HASH=${utils.keccak256(code)} only after independent contract review and zero-balance receipt validation.` : `Set ZERO_CAPITAL_FLASHLOAN_RECEIVER=${contractAddress} only after independent contract review and testnet validation.` }, null, 2));
  return deploymentRecord;
}

const isDirectInvocation = /(?:^|\/)deploy-flashloan-receiver\.(?:ts|js)$/.test(process.argv[1] || '');
if (isDirectInvocation) {
  deployFlashLoanReceiver().catch(error => {
    console.error('[deploy-flashloan-receiver] failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
