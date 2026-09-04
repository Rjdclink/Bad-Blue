import { BigNumber, Contract, ethers, providers } from 'ethers';
import { marketDataProviders, type DexQuoteObservation } from '../../intelligence/market-data-providers.js';
import {
  buildBuilderSponsoredBundleGasPlan,
  type BuilderSponsoredBundleGasPlan,
} from '../builder-sponsored-bundle-policy.js';
import { BUILDER_SPONSORED_ETHEREUM } from './builder-sponsored-ethereum-config.js';
import {
  buildBuilderSponsoredInfrastructurePlan,
  type BuilderSponsoredInfrastructureCall,
  type BuilderSponsoredReceiverIdentity,
} from './builder-sponsored-receiver-planner.js';

const BALANCER_VAULT_ABI = ['function getProtocolFeesCollector() view returns (address)'];
const BALANCER_FEE_COLLECTOR_ABI = ['function getFlashLoanFeePercentage() view returns (uint256)'];
const ONE_18 = BigNumber.from('1000000000000000000');
const RECEIVER_ABI = [
  'function executeBuilderSponsoredBalancerFlashLoan(address loanToken,uint256 loanAmount,(address target,uint256 value,bytes callData,address approvalToken,uint256 approvalAmount)[] steps,uint256 minResidualProfit,uint256 builderPaymentWei,address profitRecipient) external',
];

interface QuoteTransaction {
  target: string;
  data: string;
  value: BigNumber;
  gas: BigNumber;
  allowanceSpender: string;
}

export interface BuilderSponsoredUnsignedTransaction {
  purpose: 'deploy_receiver' | 'allow_target' | 'allow_approval_token' | 'atomic_bootstrap_execution';
  to: string;
  data: string;
  value: BigNumber;
  gasLimit: BigNumber;
}

export interface BuilderSponsoredDexBootstrapPlan {
  chain: 'ethereum';
  chainId: 1;
  targetBlock: number;
  receiver: BuilderSponsoredReceiverIdentity;
  receiverAlreadyDeployed: boolean;
  loanToken: string;
  loanAmount: BigNumber;
  flashLoanFeeAmount: BigNumber;
  roundTripGrossProfit: BigNumber;
  minimumResidualUsdc: BigNumber;
  builderWethBudgetBought: BigNumber;
  builderWethSpendUsdc: BigNumber;
  builderGasPlan: BuilderSponsoredBundleGasPlan;
  unsignedTransactions: BuilderSponsoredUnsignedTransaction[];
  executionPayload: string;
  expiresAt: number;
  provenance: string[];
}

function address(label: string, value: string | undefined | null): string {
  if (!value || !ethers.utils.isAddress(value)) throw new Error(`${label} is not a valid EVM address`);
  return ethers.utils.getAddress(value);
}

function positive(label: string, value: string | undefined): BigNumber {
  if (!value || !/^\d+$/.test(value)) throw new Error(`${label} must be a positive integer string`);
  const parsed = BigNumber.from(value);
  if (parsed.lte(0)) throw new Error(`${label} must be greater than zero`);
  return parsed;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function quoteTransaction(quote: DexQuoteObservation, expectedSellAmount: BigNumber): QuoteTransaction {
  if (!quote.executable || quote.quoteKind !== 'quote' || !quote.transaction) {
    throw new Error('Builder-sponsored bootstrap requires an executable 0x firm quote');
  }
  if (quote.simulationIncomplete) throw new Error('0x reports incomplete simulation for builder-sponsored bootstrap');
  const target = address('0x transaction target', quote.transaction.to);
  const data = String(quote.transaction.data || '');
  if (!ethers.utils.isHexString(data) || data === '0x') throw new Error('0x firm quote calldata is missing');
  const value = BigNumber.from(quote.transaction.value || '0');
  if (!value.isZero()) throw new Error('Builder-sponsored stablecoin route unexpectedly requires native call value');
  const gas = positive('0x firm quote gas', quote.transaction.gas || quote.estimatedGas);
  const explicitSpender = quote.allowanceSpender || quote.allowanceTarget;
  const spender = explicitSpender ? address('0x allowance spender', explicitSpender) : target;
  if (!sameAddress(spender, target)) throw new Error('0x allowance spender differs from transaction target');
  if (!positive('0x firm quote sellAmount', quote.sellAmount).eq(expectedSellAmount)) {
    throw new Error('0x firm quote sell amount drifted from requested bootstrap amount');
  }
  return { target, data, value, gas, allowanceSpender: spender };
}

async function firmQuote(input: {
  sellToken: string;
  buyToken: string;
  sellAmount: BigNumber;
  receiver: string;
}): Promise<{ quote: DexQuoteObservation; transaction: QuoteTransaction; buyAmount: BigNumber }> {
  const quote = await marketDataProviders.getDexQuote({
    chainId: 1,
    sellToken: input.sellToken,
    buyToken: input.buyToken,
    sellAmount: input.sellAmount.toString(),
    takerAddress: input.receiver,
    purpose: 'execution',
  });
  if (!quote?.liquidityAvailable || !quote.buyAmount) throw new Error('0x firm bootstrap quote unavailable');
  const buyAmount = positive('0x firm quote buyAmount', quote.buyAmount);
  return { quote, transaction: quoteTransaction(quote, input.sellAmount), buyAmount };
}

async function measureBalancerFlashFeeAmount(
  provider: providers.JsonRpcProvider,
  loanAmount: BigNumber,
): Promise<BigNumber> {
  const vault = new Contract(BUILDER_SPONSORED_ETHEREUM.balancerV2Vault, BALANCER_VAULT_ABI, provider);
  const collectorAddress = address('Balancer protocol fee collector', await vault.getProtocolFeesCollector());
  const collector = new Contract(collectorAddress, BALANCER_FEE_COLLECTOR_ABI, provider);
  const raw = BigNumber.from(await collector.getFlashLoanFeePercentage());
  if (raw.lt(0) || raw.gt(ONE_18)) throw new Error('Balancer flash-loan fee percentage is outside valid fixed-point range');
  // Round up. Under-budgeting the lender fee is forbidden even by one base unit.
  return loanAmount.mul(raw).add(ONE_18.sub(1)).div(ONE_18);
}

function infrastructureGasLimit(call: BuilderSponsoredInfrastructureCall): BigNumber {
  if (call.purpose === 'deploy_receiver') return BigNumber.from(2_500_000);
  return BigNumber.from(120_000);
}

function stableUnits(usd: number): BigNumber {
  if (!Number.isFinite(usd) || usd <= 0) throw new Error('Bootstrap notionalUsd must be positive');
  return BigNumber.from(Math.max(1, Math.floor(usd * 1_000_000)));
}

/**
 * Builds a complete unsigned Ethereum cold-start bundle. It deliberately uses the
 * existing 0x firm-quote authority and reserves a strict USDC residual before the
 * WETH builder-payment leg. The WETH leg may consume only the remaining verified
 * surplus. If that bounded amount cannot buy enough WETH to cover the conservative
 * builder payment, the opportunity is ineligible and nothing is signed.
 */
export async function prepareBuilderSponsoredDexBootstrap(input: {
  provider: providers.JsonRpcProvider;
  owner: string;
  profitRecipient: string;
  notionalUsd: number;
  minimumResidualBps?: number;
}): Promise<BuilderSponsoredDexBootstrapPlan> {
  const config = BUILDER_SPONSORED_ETHEREUM;
  const network = await input.provider.getNetwork();
  if (network.chainId !== 1) throw new Error(`Builder-sponsored DEX bootstrap requires Ethereum chainId 1, received ${network.chainId}`);
  const profitRecipient = address('builder-sponsored profit recipient', input.profitRecipient);
  const loanAmount = stableUnits(input.notionalUsd);

  // The receiver address is deterministic from CREATE2 bytecode + constructor args,
  // so it is usable as the 0x taker before a greenfield deployment lands.
  const provisionalInfra = await buildBuilderSponsoredInfrastructurePlan({
    provider: input.provider,
    owner: input.owner,
    targets: [config.balancerV2Vault], // replaced below after live 0x targets are known
    approvalTokens: [config.usdc],
  });
  const receiver = provisionalInfra.identity.address;

  const first = await firmQuote({ sellToken: config.usdc, buyToken: config.usdt, sellAmount: loanAmount, receiver });
  const second = await firmQuote({ sellToken: config.usdt, buyToken: config.usdc, sellAmount: first.buyAmount, receiver });
  if (second.buyAmount.lte(loanAmount)) throw new Error('Builder-sponsored round trip has no gross USDC profit');
  const roundTripGrossProfit = second.buyAmount.sub(loanAmount);
  const flashLoanFeeAmount = await measureBalancerFlashFeeAmount(input.provider, loanAmount);
  if (roundTripGrossProfit.lte(flashLoanFeeAmount)) throw new Error('Builder-sponsored round trip cannot cover measured Balancer flash fee');
  const afterFlashFee = roundTripGrossProfit.sub(flashLoanFeeAmount);

  const residualBps = input.minimumResidualBps ?? 2_500;
  if (!Number.isSafeInteger(residualBps) || residualBps < 1 || residualBps >= 10_000) {
    throw new Error('minimumResidualBps must be an integer from 1 to 9999');
  }
  let minimumResidualUsdc = afterFlashFee.mul(residualBps).div(10_000);
  if (minimumResidualUsdc.isZero()) minimumResidualUsdc = BigNumber.from(1);
  const builderWethSpendUsdc = afterFlashFee.sub(minimumResidualUsdc);
  if (builderWethSpendUsdc.lte(0)) throw new Error('No verified USDC surplus remains for builder payment');

  const third = await firmQuote({ sellToken: config.usdc, buyToken: config.weth, sellAmount: builderWethSpendUsdc, receiver });
  const infrastructure = await buildBuilderSponsoredInfrastructurePlan({
    provider: input.provider,
    owner: input.owner,
    targets: [first.transaction.target, second.transaction.target, third.transaction.target],
    approvalTokens: [config.usdc, config.usdt],
  });
  if (!sameAddress(infrastructure.identity.address, receiver)) throw new Error('Deterministic receiver identity changed during preparation');

  const latestBlock = await input.provider.getBlock('latest');
  if (!latestBlock?.baseFeePerGas) throw new Error('Ethereum latest block has no EIP-1559 base fee');
  const executionGasLimit = BigNumber.from(
    Math.max(1_500_000, Math.min(3_500_000, Number(first.transaction.gas.add(second.transaction.gas).add(third.transaction.gas).toString()) + 650_000)),
  );
  const infraUnsigned: BuilderSponsoredUnsignedTransaction[] = infrastructure.calls.map(call => ({
    purpose: call.purpose,
    to: address('builder-sponsored infrastructure target', call.to),
    data: ethers.utils.hexlify(call.data || '0x'),
    value: BigNumber.from(call.value || 0),
    gasLimit: infrastructureGasLimit(call),
  }));
  const builderGasPlan = buildBuilderSponsoredBundleGasPlan({
    currentBlockNumber: latestBlock.number,
    baseFeePerGasWei: latestBlock.baseFeePerGas,
    blockGasUsed: latestBlock.gasUsed,
    blockGasLimit: latestBlock.gasLimit,
    transactions: [
      ...infraUnsigned.map(transaction => ({ gasLimit: transaction.gasLimit, valueWei: transaction.value })),
      { gasLimit: executionGasLimit, valueWei: 0 },
    ],
    builderMarginBps: Math.max(1, Math.min(10_000, Number(process.env.CRYPTOCRAWL_BUILDER_SPONSOR_MARGIN_BPS || 2_000))),
  });
  if (third.buyAmount.lt(builderGasPlan.builderPaymentWei)) {
    throw new Error('Bounded opportunity surplus cannot buy enough WETH to repay the sponsoring builder');
  }

  const steps = [
    {
      target: first.transaction.target,
      value: first.transaction.value,
      callData: first.transaction.data,
      approvalToken: config.usdc,
      approvalAmount: loanAmount,
    },
    {
      target: second.transaction.target,
      value: second.transaction.value,
      callData: second.transaction.data,
      approvalToken: config.usdt,
      approvalAmount: first.buyAmount,
    },
    {
      target: third.transaction.target,
      value: third.transaction.value,
      callData: third.transaction.data,
      approvalToken: config.usdc,
      approvalAmount: builderWethSpendUsdc,
    },
  ];
  const executionPayload = new ethers.utils.Interface(RECEIVER_ABI).encodeFunctionData(
    'executeBuilderSponsoredBalancerFlashLoan',
    [config.usdc, loanAmount, steps, minimumResidualUsdc, builderGasPlan.builderPaymentWei, profitRecipient],
  );
  const execution: BuilderSponsoredUnsignedTransaction = {
    purpose: 'atomic_bootstrap_execution',
    to: receiver,
    data: executionPayload,
    value: BigNumber.from(0),
    gasLimit: executionGasLimit,
  };

  const quoteTtlMs = Math.max(500, Number(process.env.ZEROX_QUOTE_TTL_MS || 2_000));
  const expiresAt = Math.min(
    first.quote.observedAt + quoteTtlMs,
    second.quote.observedAt + quoteTtlMs,
    third.quote.observedAt + quoteTtlMs,
  );
  if (expiresAt <= Date.now()) throw new Error('Builder-sponsored firm quotes expired during preparation');

  return {
    chain: 'ethereum',
    chainId: 1,
    targetBlock: builderGasPlan.targetBlock,
    receiver: infrastructure.identity,
    receiverAlreadyDeployed: infrastructure.alreadyDeployed,
    loanToken: config.usdc,
    loanAmount,
    flashLoanFeeAmount,
    roundTripGrossProfit,
    minimumResidualUsdc,
    builderWethBudgetBought: third.buyAmount,
    builderWethSpendUsdc,
    builderGasPlan,
    unsignedTransactions: [...infraUnsigned, execution],
    executionPayload,
    expiresAt,
    provenance: [
      'ethereum_l1:chain_id_1_verified',
      'foundry_create2:factory_code_hash_verified_when_deployment_required',
      'receiver:create2_address_known_predeployment',
      '0x:v2_allowance_holder_three_firm_quotes',
      'balancer_v2:flash_fee_measured_onchain',
      'usdc_residual:reserved_before_builder_weth_leg',
      'builder_payment:covered_by_bounded_weth_output',
      'builder_gas:all_bundle_transactions_capped',
      'public_mempool_fallback:false',
    ],
  };
}
