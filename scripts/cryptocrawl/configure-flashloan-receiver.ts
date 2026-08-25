import 'dotenv/config';
import { Contract, Wallet, providers, utils } from 'ethers';
import { buildSwapCallFromLeg } from '../../server/services/cryptocrawl/execution/adapters/onchain-payload-builder.js';
import { loadConfiguredZeroCapitalRoutes } from '../../server/services/cryptocrawl/execution/adapters/onchain-route-quoter.js';
import { EUROPA_NETWORK } from '../../server/services/cryptocrawl/execution/adapters/europa-network.js';
import { EUROPA_SUSHI } from '../../server/services/cryptocrawl/execution/adapters/europa-sushi-registry.js';
import {
  getEuropaSushiV3ReceiverConfiguration,
  sendEuropaZeroGasProvisioningTransaction,
  type EuropaReceiverConfiguration,
} from './europa-zero-gas-provisioning.js';

type SupportedDeploymentChain = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'europa';

const DEPLOYMENT_CHAINS: Record<SupportedDeploymentChain, { chainId: number; rpcEnv: string }> = {
  ethereum: { chainId: 1, rpcEnv: 'ETHEREUM_RPC_URL' },
  polygon: { chainId: 137, rpcEnv: 'POLYGON_RPC_URL' },
  arbitrum: { chainId: 42161, rpcEnv: 'ARBITRUM_RPC_URL' },
  optimism: { chainId: 10, rpcEnv: 'OPTIMISM_RPC_URL' },
  europa: { chainId: EUROPA_NETWORK.chainId, rpcEnv: 'EUROPA_RPC_URL' },
};

const RECEIVER_ABI = [
  'function owner() view returns (address)',
  'function factory() view returns (address)',
  'function operators(address operator) view returns (bool)',
  'function allowedTargets(address target) view returns (bool)',
  'function allowedApprovalTokens(address token) view returns (bool)',
  'function setOperator(address operator, bool allowed)',
  'function setAllowedTarget(address target, bool allowed)',
  'function setAllowedApprovalToken(address token, bool allowed)',
];

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

function normalizeAddresses(label: string, values: unknown): string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new Error(`${label} must be an array of EVM addresses`);
  return Array.from(new Set(values.map(value => {
    const address = String(value || '').trim();
    if (!utils.isAddress(address)) throw new Error(`${label} contains an invalid EVM address`);
    return utils.getAddress(address);
  })));
}

function parseConfiguration(): EuropaReceiverConfiguration {
  const raw = process.env.ZERO_CAPITAL_RECEIVER_CONFIG?.trim();
  if (!raw) {
    throw new Error('ZERO_CAPITAL_RECEIVER_CONFIG is required and must contain operators, targets, and approvalTokens arrays');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('ZERO_CAPITAL_RECEIVER_CONFIG must be valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('ZERO_CAPITAL_RECEIVER_CONFIG must be a JSON object');

  const config = parsed as Record<string, unknown>;
  return {
    operators: normalizeAddresses('operators', config.operators),
    targets: normalizeAddresses('targets', config.targets),
    approvalTokens: normalizeAddresses('approvalTokens', config.approvalTokens),
  };
}

function validateRouteAllowLists(receiverAddress: string, configuration: EuropaReceiverConfiguration): void {
  const routes = loadConfiguredZeroCapitalRoutes();
  if (routes.length === 0) {
    throw new Error('ZERO_CAPITAL_ROUTE_CONFIG must contain approved cyclic routes before receiver allowlists can be configured');
  }

  const expectedTargets = new Set<string>();
  const expectedApprovalTokens = new Set<string>();
  for (const route of routes) {
    for (const leg of route.legs) {
      const swapCall = buildSwapCallFromLeg(route.chain, receiverAddress, {
        protocol: leg.protocol,
        chain: route.chain,
        tokenIn: leg.tokenIn,
        tokenOut: leg.tokenOut,
        amountIn: '1',
        minAmountOut: '1',
        ...(leg.feeTier !== undefined ? { feeTier: leg.feeTier } : {}),
        recipient: receiverAddress,
      });
      expectedTargets.add(utils.getAddress(swapCall.target));
      expectedApprovalTokens.add(utils.getAddress(swapCall.approvalToken));
    }
  }

  const configuredTargets = new Set(configuration.targets.map(utils.getAddress));
  const configuredApprovalTokens = new Set(configuration.approvalTokens.map(utils.getAddress));
  const missingTargets = [...expectedTargets].filter(address => !configuredTargets.has(address));
  const missingTokens = [...expectedApprovalTokens].filter(address => !configuredApprovalTokens.has(address));
  const unexpectedTargets = [...configuredTargets].filter(address => !expectedTargets.has(address));
  const unexpectedTokens = [...configuredApprovalTokens].filter(address => !expectedApprovalTokens.has(address));

  if (missingTargets.length || missingTokens.length || unexpectedTargets.length || unexpectedTokens.length) {
    throw new Error(JSON.stringify({
      message: 'Receiver allowlists must exactly match the approved ZERO_CAPITAL_ROUTE_CONFIG routers and input tokens',
      missingTargets,
      missingApprovalTokens: missingTokens,
      unexpectedTargets,
      unexpectedApprovalTokens: unexpectedTokens,
    }));
  }
}

async function main(): Promise<void> {
  const chain = parseChain(process.env.ZERO_CAPITAL_DEPLOY_CHAIN);
  const chainConfig = DEPLOYMENT_CHAINS[chain];
  const rpcUrl = process.env.ZERO_CAPITAL_DEPLOY_RPC_URL?.trim() ||
    (chain === 'europa' ? EUROPA_NETWORK.rpcUrl : requireEnv(chainConfig.rpcEnv));
  const receiverAddressRaw = chain === 'europa'
    ? requireEnv('ZERO_CAPITAL_EUROPA_RECEIVER')
    : requireEnv('ZERO_CAPITAL_FLASHLOAN_RECEIVER');
  if (!utils.isAddress(receiverAddressRaw)) {
    throw new Error(`${chain === 'europa' ? 'ZERO_CAPITAL_EUROPA_RECEIVER' : 'ZERO_CAPITAL_FLASHLOAN_RECEIVER'} must be a valid EVM address`);
  }
  const receiverAddress = utils.getAddress(receiverAddressRaw);

  const provider = new providers.JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(requireEnv('WALLET_PRIVATE_KEY'), provider);
  const network = await provider.getNetwork();
  if (network.chainId !== chainConfig.chainId) {
    throw new Error(`RPC chain id ${network.chainId} does not match ZERO_CAPITAL_DEPLOY_CHAIN=${chain} (${chainConfig.chainId})`);
  }

  const code = await provider.getCode(receiverAddress);
  if (code === '0x') throw new Error(`${chain === 'europa' ? 'ZERO_CAPITAL_EUROPA_RECEIVER' : 'ZERO_CAPITAL_FLASHLOAN_RECEIVER'} has no deployed bytecode on the configured chain`);
  if (chain === 'europa') {
    const expectedCodeHash = requireEnv('ZERO_CAPITAL_EUROPA_RECEIVER_CODE_HASH').toLowerCase();
    if (!/^0x[a-f0-9]{64}$/.test(expectedCodeHash)) {
      throw new Error('ZERO_CAPITAL_EUROPA_RECEIVER_CODE_HASH must be a 32-byte keccak256 hash');
    }
    const actualCodeHash = utils.keccak256(code).toLowerCase();
    if (actualCodeHash !== expectedCodeHash) {
      throw new Error(`Europa receiver bytecode hash mismatch: expected ${expectedCodeHash}, received ${actualCodeHash}`);
    }
  }

  const configuration = chain === 'europa'
    ? getEuropaSushiV3ReceiverConfiguration()
    : parseConfiguration();
  if (chain !== 'europa') validateRouteAllowLists(receiverAddress, configuration);

  const receiver = new Contract(receiverAddress, RECEIVER_ABI, wallet);
  const receiverOwner = utils.getAddress(await receiver.owner());
  if (receiverOwner !== utils.getAddress(wallet.address)) {
    throw new Error(`WALLET_PRIVATE_KEY address ${wallet.address} is not the receiver owner ${receiverOwner}; configure through the owner wallet or multisig`);
  }
  if (chain === 'europa') {
    const receiverKind = process.env.ZERO_CAPITAL_EUROPA_RECEIVER_KIND?.trim() || 'sushi-v3';
    if (receiverKind !== 'sushi-v3') {
      throw new Error('Automatic Europa provisioning currently supports ZERO_CAPITAL_EUROPA_RECEIVER_KIND=sushi-v3 only');
    }
    const receiverFactory = utils.getAddress(await receiver.factory());
    if (receiverFactory.toLowerCase() !== EUROPA_SUSHI.v3Factory.toLowerCase()) {
      throw new Error(`Europa receiver factory mismatch: expected ${EUROPA_SUSHI.v3Factory}, received ${receiverFactory}`);
    }
  }

  const operations: Array<{ method: 'setOperator' | 'setAllowedTarget' | 'setAllowedApprovalToken'; address: string }> = [];
  for (const address of configuration.operators) {
    if (!await receiver.operators(address)) operations.push({ method: 'setOperator', address });
  }
  for (const address of configuration.targets) {
    if (!await receiver.allowedTargets(address)) operations.push({ method: 'setAllowedTarget', address });
  }
  for (const address of configuration.approvalTokens) {
    if (!await receiver.allowedApprovalTokens(address)) operations.push({ method: 'setAllowedApprovalToken', address });
  }

  const broadcastAllowed =
    process.env.ZERO_CAPITAL_CONFIGURE_RECEIVER === 'true' &&
    process.env.ZERO_CAPITAL_CONFIGURE_RECEIVER_CONFIRMATION === 'CONFIGURE_FLASHLOAN_RECEIVER';
  const preview: Array<Record<string, unknown>> = [];

  for (const operation of operations) {
    const populated = await receiver.populateTransaction[operation.method](operation.address, true);
    if (!populated.to || !populated.data) throw new Error(`${operation.method} did not produce an executable transaction`);
    const estimatedGas = await provider.estimateGas({ ...populated, from: wallet.address });
    preview.push({
      method: operation.method,
      args: [operation.address, true],
      estimatedGas: estimatedGas.toString(),
      zeroGasProvisioning: chain === 'europa',
    });
  }

  if (operations.length === 0) {
    console.log(JSON.stringify({
      mode: 'already_configured',
      chain,
      chainId: network.chainId,
      receiver: receiverAddress,
      signer: wallet.address,
      owner: receiverOwner,
      configuration,
    }, null, 2));
    return;
  }

  if (!broadcastAllowed) {
    console.log(JSON.stringify({
      mode: 'dry_run',
      chain,
      chainId: network.chainId,
      receiver: receiverAddress,
      signer: wallet.address,
      owner: receiverOwner,
      configuration,
      operations: preview,
      nextStep: 'Set ZERO_CAPITAL_CONFIGURE_RECEIVER=true and ZERO_CAPITAL_CONFIGURE_RECEIVER_CONFIRMATION=CONFIGURE_FLASHLOAN_RECEIVER to broadcast.',
    }, null, 2));
    return;
  }

  const transactions: string[] = [];
  const computeSources: string[] = [];
  for (const operation of operations) {
    if (chain === 'europa') {
      const populated = await receiver.populateTransaction[operation.method](operation.address, true);
      if (!populated.to || !populated.data) throw new Error(`${operation.method} did not produce an executable Europa transaction`);
      const provisioning = await sendEuropaZeroGasProvisioningTransaction({
        provider,
        wallet,
        workloadId: `europa-receiver-config:${operation.method}:${operation.address}`,
        transaction: {
          to: String(populated.to),
          data: String(populated.data),
          value: populated.value || 0,
        },
      });
      transactions.push(provisioning.transactionHash);
      computeSources.push(provisioning.computeSource);
    } else {
      const transaction = await receiver[operation.method](operation.address, true);
      const receipt = await transaction.wait();
      if (!receipt || receipt.status !== 1) throw new Error(`${operation.method} transaction reverted`);
      transactions.push(transaction.hash);
    }
  }

  for (const address of configuration.operators) {
    if (!await receiver.operators(address)) throw new Error(`Receiver operator ${address} was not enabled`);
  }
  for (const address of configuration.targets) {
    if (!await receiver.allowedTargets(address)) throw new Error(`Receiver target ${address} was not enabled`);
  }
  for (const address of configuration.approvalTokens) {
    if (!await receiver.allowedApprovalTokens(address)) throw new Error(`Receiver approval token ${address} was not enabled`);
  }

  console.log(JSON.stringify({
    mode: 'configured',
    chain,
    chainId: network.chainId,
    receiver: receiverAddress,
    signer: wallet.address,
    owner: receiverOwner,
    configuration,
    transactions,
    ...(computeSources.length > 0 ? { computeSources, zeroMonetaryGasVerified: true } : {}),
  }, null, 2));
}

main().catch(error => {
  console.error('[configure-flashloan-receiver] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
