import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { BigNumber, Wallet, providers, Contract, ContractFactory, utils } from 'ethers';
import {
  compileAaveV3FlashLoanReceiver,
  compileCompositeFlashLoanReceiver,
  compileFlashLoanReceiver,
  compileSushiV3FlashReceiver,
} from './compile-flashloan-receiver.js';
import { resolveAaveV3Pool } from '../../server/services/cryptocrawl/execution/adapters/flash-loan-provider-economics.js';
import { EUROPA_NETWORK } from '../../server/services/cryptocrawl/execution/adapters/europa-network.js';
import { EUROPA_SUSHI } from '../../server/services/cryptocrawl/execution/adapters/europa-sushi-registry.js';
import {
  calculateSkaleExternalGas,
  deriveSkalePowCandidate,
  resolveEuropaExternalGasDifficulty,
} from '../../server/services/cryptocrawl/execution/adapters/skale-pow-adapter.js';

type SupportedDeploymentChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'bsc' | 'avalanche' | 'europa';
export type FlashLoanReceiverKind = 'balancer' | 'balancer-composite-v2' | 'aave-v3' | 'sushi-v3';

export interface DeployFlashLoanReceiverOptions {
  chain?: SupportedDeploymentChain;
  receiverKind?: FlashLoanReceiverKind;
}

export interface FlashLoanReceiverDeploymentRecord {
  contract: string;
  chain: SupportedDeploymentChain;
  chainId: number;
  address: string;
  owner: string;
  infrastructure: string;
  receiverKind: FlashLoanReceiverKind;
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
  bsc: { chainId: 56, rpcEnv: 'BSC_RPC_URL' },
  avalanche: { chainId: 43114, rpcEnv: 'AVALANCHE_RPC_URL' },
  europa: { chainId: 2046399126, rpcEnv: 'EUROPA_RPC_URL' },
};

const SKALE_CONFIG_CONTROLLER = '0xD2002000000000000000000000000000000000d2';
const SKALE_CONFIG_CONTROLLER_ABI = [
  'function isFCDEnabled() view returns (bool)',
  'function isMTMEnabled() view returns (bool)',
  'function isAddressWhitelisted(address) view returns (bool)',
];
const EUROPA_GENERIC_FACTORY_CANDIDATES = [
  { name: 'CREATE2Factory', address: '0x4e59b44847b379578588920cA78FbF26c0B4956C' },
  { name: 'SingletonFactory', address: '0xce0042B868300000d44A59004Da54A005ffdcf9f' },
  { name: 'CreateX', address: '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed' },
] as const;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseChain(value: string | undefined): SupportedDeploymentChain {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ethereum' || normalized === 'polygon' || normalized === 'arbitrum' || normalized === 'optimism' || normalized === 'bsc' || normalized === 'avalanche' || normalized === 'europa') return normalized;
  throw new Error('ZERO_CAPITAL_DEPLOY_CHAIN must be ethereum, polygon, arbitrum, optimism, bsc, avalanche, or europa');
}

function parseReceiverKind(value: string | undefined): FlashLoanReceiverKind {
  const normalized = String(value || 'balancer').trim().toLowerCase();
  if (normalized === 'balancer' || normalized === 'balancer-composite-v2' || normalized === 'aave-v3' || normalized === 'sushi-v3') return normalized;
  throw new Error('ZERO_CAPITAL_DEPLOY_RECEIVER must be balancer, balancer-composite-v2, aave-v3, or sushi-v3');
}

function requireAddress(name: string, value: string): string {
  if (!utils.isAddress(value)) throw new Error(`${name} must be a valid EVM address`);
  return utils.getAddress(value);
}

function resolveDeploymentInfrastructure(chain: SupportedDeploymentChain, receiverKind: FlashLoanReceiverKind): string {
  const chainConfig = DEPLOYMENT_CHAINS[chain];
  if (receiverKind === 'sushi-v3') {
    if (chain !== 'europa') throw new Error('sushi-v3 receiver deployment is currently Europa-only');
    return requireAddress(
      'ZERO_CAPITAL_EUROPA_SUSHI_V3_FACTORY',
      process.env.ZERO_CAPITAL_EUROPA_SUSHI_V3_FACTORY?.trim() || EUROPA_SUSHI.v3Factory,
    );
  }
  if (receiverKind === 'aave-v3') {
    if (chain === 'europa') throw new Error('aave-v3 receiver deployment is not supported on Europa');
    const pool = resolveAaveV3Pool(chain);
    if (!pool) throw new Error(`Aave V3 pool is not configured for ${chain}`);
    return pool;
  }
  return requireAddress(
    'ZERO_CAPITAL_BALANCER_VAULT',
    process.env.ZERO_CAPITAL_BALANCER_VAULT?.trim() ||
      (chain === 'europa' ? process.env.ZERO_CAPITAL_EUROPA_BALANCER_VAULT?.trim() || '' : chainConfig.balancerVault || ''),
  );
}

async function compileForKind(receiverKind: FlashLoanReceiverKind) {
  if (receiverKind === 'sushi-v3') return compileSushiV3FlashReceiver();
  if (receiverKind === 'balancer-composite-v2') return compileCompositeFlashLoanReceiver();
  if (receiverKind === 'aave-v3') return compileAaveV3FlashLoanReceiver();
  return compileFlashLoanReceiver();
}

async function verifyDeployedReceiver(input: {
  provider: providers.Provider;
  address: string;
  owner: string;
  infrastructure: string;
  receiverKind: FlashLoanReceiverKind;
}): Promise<void> {
  const infrastructureGetter = input.receiverKind === 'aave-v3' ? 'pool' : input.receiverKind === 'sushi-v3' ? null : 'vault';
  const abi = ['function owner() view returns (address)'];
  if (infrastructureGetter) abi.push(`function ${infrastructureGetter}() view returns (address)`);
  const receiver = new Contract(input.address, abi, input.provider);
  const actualOwner = requireAddress('deployed receiver owner', await receiver.owner() as string);
  if (actualOwner.toLowerCase() !== input.owner.toLowerCase()) throw new Error(`DEPLOYMENT_OWNER_MISMATCH: expected ${input.owner}, received ${actualOwner}`);
  if (infrastructureGetter) {
    const actualInfrastructure = requireAddress(
      `deployed receiver ${infrastructureGetter}`,
      await receiver[infrastructureGetter]() as string,
    );
    if (actualInfrastructure.toLowerCase() !== input.infrastructure.toLowerCase()) {
      throw new Error(`DEPLOYMENT_INFRASTRUCTURE_MISMATCH: expected ${input.infrastructure}, received ${actualInfrastructure}`);
    }
  }
}

function deploymentEnvironmentHint(record: FlashLoanReceiverDeploymentRecord): string {
  const chainKey = record.chain.toUpperCase();
  if (record.receiverKind === 'aave-v3') return `ZERO_CAPITAL_AAVE_V3_RECEIVER_${chainKey}=${record.address}`;
  if (record.receiverKind === 'balancer-composite-v2') return `ZERO_CAPITAL_BALANCER_COMPOSITE_RECEIVER_${chainKey}=${record.address}`;
  if (record.receiverKind === 'sushi-v3') return `ZERO_CAPITAL_EUROPA_RECEIVER=${record.address}`;
  return `ZERO_CAPITAL_FLASHLOAN_RECEIVER_${chainKey}=${record.address}`;
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
  const receiverKind = options.receiverKind || parseReceiverKind(process.env.ZERO_CAPITAL_DEPLOY_RECEIVER);
  const infrastructure = resolveDeploymentInfrastructure(chain, receiverKind);
  const artifact = await compileForKind(receiverKind);
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

    const factoryProbe = await Promise.all(EUROPA_GENERIC_FACTORY_CANDIDATES.map(async candidate => {
      const [code, whitelisted] = await Promise.all([
        provider.getCode(candidate.address),
        configController.isAddressWhitelisted(candidate.address) as Promise<boolean>,
      ]);
      return { ...candidate, deployed: code !== '0x', whitelisted };
    }));
    console.log(`[deploy-flashloan-receiver] Europa generic factory probe: ${JSON.stringify(factoryProbe)}`);

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
  await verifyDeployedReceiver({ provider, address: contractAddress, owner, infrastructure, receiverKind });

  const deploymentRecord: FlashLoanReceiverDeploymentRecord = {
    contract: artifact.contractName,
    chain,
    chainId: network.chainId,
    address: contractAddress,
    owner,
    infrastructure,
    receiverKind,
    deployer: wallet.address,
    transactionHash,
    blockNumber: receipt.blockNumber,
    compiler: artifact.compiler,
    codeHash: utils.keccak256(code),
    deployedAt: new Date().toISOString(),
  };
  const outputPath = resolve(process.cwd(), `contracts/cryptocrawl/deployments/${chain}-${receiverKind}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(deploymentRecord, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    ...deploymentRecord,
    deploymentRecord: outputPath,
    verified: true,
    nextStep: `Set ${deploymentEnvironmentHint(deploymentRecord)} only after independent contract review and network-specific execution validation.`,
  }, null, 2));
  return deploymentRecord;
}

const isDirectInvocation = /(?:^|\/)deploy-flashloan-receiver\.(?:ts|js)$/.test(process.argv[1] || '');
if (isDirectInvocation) {
  deployFlashLoanReceiver().catch(error => {
    console.error('[deploy-flashloan-receiver] failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
