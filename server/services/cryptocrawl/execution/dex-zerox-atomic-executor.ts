import { BigNumber, Contract, Wallet, ethers } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import { DEFAULT_GAS_LIMIT, SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import { gasOracle } from '../bridge/gas-oracle.js';
import type { ChainId } from '../bridge/types.js';
import { resolveOperationalProfitRecipient } from '../core/wallet-identity.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import { requireZeroCapitalInfrastructureDeploymentAllowed } from '../governance/zero-capital-infrastructure-policy.js';
import { stageManager } from '../governance/stage-management.js';
import { marketDataProviders, type DexQuoteObservation } from '../intelligence/market-data-providers.js';
import { getGasSponsorManager, type SponsoredCall } from '../strategies/gas-sponsorship.js';
import { withEvmSignerLane } from './evm-signer-lane.js';
import {
  getSponsoredReceiverManager,
  resolveSponsoredReceiverVault,
  supportsSponsoredReceiverChain,
  type ReceiverFundingMode,
} from './adapters/sponsored-receiver-manager.js';

const RECEIVER_ABI = [
  'function executeBalancerFlashLoan(address loanToken,uint256 loanAmount,(address target,uint256 value,bytes callData,address approvalToken,uint256 approvalAmount)[] steps,uint256 minProfit,address profitRecipient) external',
  'event FlashLoanExecuted(address indexed initiator,address indexed loanToken,uint256 loanAmount,uint256 profit)',
];
const BALANCER_VAULT_ABI = ['function getProtocolFeesCollector() view returns (address)'];
const BALANCER_FEE_COLLECTOR_ABI = ['function getFlashLoanFeePercentage() view returns (uint256)'];
const ONE_18 = BigNumber.from('1000000000000000000');

export interface ZeroXAtomicRoundTripPreparation {
  opportunityId: string;
  chain: ChainId;
  receiver: string;
  inputToken: string;
  intermediateToken: string;
  loanAmount: string;
  finalAmount: string;
  flashLoanFeeAmount: string;
  grossProfitUsd: number;
  flashLoanFeeUsd: number;
  gasUsd: number;
  deterministicNetProfitUsd: number;
  grossProfitBps: number;
  flashLoanFeeBps: number;
  gasCostBps: number;
  allInCostBps: number;
  netProfitBps: number;
  minProfit: string;
  payload: { to: string; data: string; value: string; gasLimit: number };
  firstQuote: DexQuoteObservation;
  secondQuote: DexQuoteObservation;
  expiresAt: number;
  simulated: true;
  provenance: string[];
}

export interface ZeroXAtomicExecutionResult {
  success: boolean;
  status: 'rejected' | 'failed' | 'filled' | 'settlement_unknown';
  terminal: boolean;
  settlementConfirmed: boolean;
  transactionHash?: string;
  fundingModeUsed?: 'sponsored' | 'native';
  receiptStatus?: 0 | 1;
  gasUsed?: string;
  effectiveGasPriceWei?: string;
  /** Receiver profit after flash-loan repayment/fee, before wallet-paid native gas. */
  realizedProfitUsd?: number;
  /** Receiver profit BPS before wallet-paid native gas. Not terminal all-in net BPS. */
  realizedProfitBps?: number;
  /** Pretrade gas estimate only. Terminal gas reconciliation must use receipt fields above. */
  gasUsd?: number;
  error?: string;
}

interface AtomicRequest {
  opportunityId: string;
  chain: ChainId;
  notionalUsd: number;
}

export interface ZeroXAtomicInfrastructureResult {
  attempted: number;
  prepared: number;
  failed: number;
  remaining: number;
  details: Array<{ opportunityId: string; chain: ChainId; ready: boolean; reason?: string }>;
}

const preparedPlans = new Map<string, ZeroXAtomicRoundTripPreparation>();
const requestInputs = new Map<string, AtomicRequest>();
const pendingInfrastructure = new Map<string, AtomicRequest & { queuedAt: number }>();

function rejected(error: string): ZeroXAtomicExecutionResult {
  return { success: false, status: 'rejected', terminal: true, settlementConfirmed: false, error };
}

function configuredWallet(): Wallet | null {
  const raw = process.env.WALLET_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const normalized = raw.startsWith('0x') ? raw : `0x${raw}`;
  try { return new Wallet(normalized); } catch { return null; }
}

function asAddress(label: string, value: string | undefined | null): string {
  if (!value || !ethers.utils.isAddress(value)) throw new Error(`${label} is not a valid EVM address`);
  return ethers.utils.getAddress(value);
}

function asPositiveInteger(label: string, value: string | undefined): BigNumber {
  if (!value || !/^\d+$/.test(value)) throw new Error(`${label} must be a positive integer string`);
  const parsed = BigNumber.from(value);
  if (parsed.lte(0)) throw new Error(`${label} must be greater than zero`);
  return parsed;
}

function stableUnits(usd: number): string {
  return BigNumber.from(Math.max(1, Math.floor(usd * 1_000_000))).toString();
}

function baseUnitsToUsd(value: BigNumber): number {
  const result = Number(value.toString()) / 1_000_000;
  if (!Number.isFinite(result)) throw new Error('Stablecoin base-unit value exceeds safe USD conversion range');
  return result;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function rememberInfrastructureNeed(input: AtomicRequest): void {
  pendingInfrastructure.set(input.opportunityId, { ...input, queuedAt: Date.now() });
}

function quoteTransaction(quote: DexQuoteObservation, expectedSellAmount: BigNumber): {
  target: string;
  data: string;
  value: BigNumber;
  gas: BigNumber;
  allowanceSpender: string;
} {
  if (!quote.executable || quote.quoteKind !== 'quote' || !quote.transaction) throw new Error('0x firm quote did not return executable transaction evidence');
  const target = asAddress('0x transaction target', quote.transaction.to);
  const data = String(quote.transaction.data || '');
  if (!ethers.utils.isHexString(data) || data === '0x') throw new Error('0x firm quote transaction calldata is missing');
  const value = BigNumber.from(quote.transaction.value || '0');
  if (!value.isZero()) throw new Error('Stablecoin atomic DEX route unexpectedly requires native transaction value');
  const gas = asPositiveInteger('0x firm quote gas', quote.transaction.gas || quote.estimatedGas);

  // 0x v2 says the allowance target is authoritative in issues.allowance.spender
  // or allowanceTarget. For the AllowanceHolder ERC-20 flow, transaction.to is
  // also AllowanceHolder; if an explicit spender is present it must agree.
  const explicitSpender = quote.allowanceSpender || quote.allowanceTarget;
  const spender = explicitSpender ? asAddress('0x allowance spender', explicitSpender) : target;
  if (!sameAddress(spender, target)) throw new Error('0x allowance spender differs from transaction target; unsupported AllowanceHolder route fails closed');

  const quotedSellAmount = asPositiveInteger('0x firm quote sellAmount', quote.sellAmount);
  if (!quotedSellAmount.eq(expectedSellAmount)) throw new Error('0x firm quote sell amount drifted from the requested atomic amount');
  return { target, data, value, gas, allowanceSpender: spender };
}

async function measureBalancerFlashFeeBps(chain: ChainId, provider: ethers.providers.JsonRpcProvider): Promise<number> {
  const vaultAddress = resolveSponsoredReceiverVault(chain);
  if (!vaultAddress) throw new Error(`No reviewed Balancer V2 vault is configured for ${chain}`);
  const vault = new Contract(vaultAddress, BALANCER_VAULT_ABI, provider);
  const collectorAddress = asAddress('Balancer protocol fee collector', await vault.getProtocolFeesCollector());
  const collector = new Contract(collectorAddress, BALANCER_FEE_COLLECTOR_ABI, provider);
  const raw = BigNumber.from(await collector.getFlashLoanFeePercentage());
  if (raw.lt(0) || raw.gt(ONE_18)) throw new Error('Balancer flash-loan fee percentage is outside the valid fixed-point range');
  const bps = Number(raw.mul(10_000).div(ONE_18).toString());
  if (!Number.isFinite(bps) || bps < 0 || bps > 10_000) throw new Error('Balancer flash-loan fee BPS could not be measured');
  return bps;
}

function infrastructureFundingMode(): ReceiverFundingMode {
  return getGasSponsorManager().getReadiness().ready ? 'sponsored' : 'native';
}

async function executeInfrastructureCalls(input: {
  chain: ChainId;
  chainId: number;
  wallet: Wallet;
  provider: ethers.providers.JsonRpcProvider;
  fundingMode: ReceiverFundingMode;
  calls: SponsoredCall[];
}): Promise<void> {
  if (input.calls.length === 0) return;
  requireZeroCapitalInfrastructureDeploymentAllowed({ chain: input.chain, operation: 'receiver_permissions' });
  if (input.fundingMode === 'sponsored') {
    const result = await getGasSponsorManager().execute({
      wallet: input.wallet,
      chainId: input.chainId,
      calls: input.calls,
      timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_DEPLOY_TIMEOUT_MS || 90_000)),
    });
    if (!result.transactionHash) throw new Error('Sponsored 0x receiver permission transaction returned no hash');
    return;
  }

  const connected = input.wallet.connect(input.provider);
  await withEvmSignerLane({
    chainId: input.chainId,
    walletAddress: connected.address,
    operation: async () => {
      for (const call of input.calls) {
        const transaction = await connected.sendTransaction({
          to: call.to,
          data: call.data,
          value: BigNumber.from(call.value || 0),
        });
        const receipt = await transaction.wait(1);
        if (!receipt || receipt.status !== 1) throw new Error('0x receiver permission transaction reverted');
      }
    },
  });
}

function encodeReceiverPayload(input: {
  receiver: string;
  loanToken: string;
  loanAmount: BigNumber;
  minProfit: BigNumber;
  profitRecipient: string;
  first: ReturnType<typeof quoteTransaction>;
  second: ReturnType<typeof quoteTransaction>;
  intermediateAmount: BigNumber;
  intermediateToken: string;
}): string {
  return new ethers.utils.Interface(RECEIVER_ABI).encodeFunctionData('executeBalancerFlashLoan', [
    input.loanToken,
    input.loanAmount,
    [
      { target: input.first.target, value: input.first.value, callData: input.first.data, approvalToken: input.loanToken, approvalAmount: input.loanAmount },
      { target: input.second.target, value: input.second.value, callData: input.second.data, approvalToken: input.intermediateToken, approvalAmount: input.intermediateAmount },
    ],
    input.minProfit,
    input.profitRecipient,
  ]);
}

async function firmRoundTripQuotes(input: {
  request: AtomicRequest;
  receiver: string;
}): Promise<{
  loanAmount: BigNumber;
  firstQuote: DexQuoteObservation;
  secondQuote: DexQuoteObservation;
  intermediateAmount: BigNumber;
  finalAmount: BigNumber;
  first: ReturnType<typeof quoteTransaction>;
  second: ReturnType<typeof quoteTransaction>;
}> {
  const config = SUPPORTED_CHAINS[input.request.chain];
  const loanAmount = BigNumber.from(stableUnits(input.request.notionalUsd));
  const firstQuote = await marketDataProviders.getDexQuote({
    chainId: config.chainId,
    sellToken: config.usdc,
    buyToken: config.usdt,
    sellAmount: loanAmount.toString(),
    takerAddress: input.receiver,
    purpose: 'execution',
  });
  if (!firstQuote?.buyAmount || !firstQuote.liquidityAvailable) throw new Error('0x first firm quote unavailable');
  const intermediateAmount = asPositiveInteger('0x first buyAmount', firstQuote.buyAmount);
  const first = quoteTransaction(firstQuote, loanAmount);

  const secondQuote = await marketDataProviders.getDexQuote({
    chainId: config.chainId,
    sellToken: config.usdt,
    buyToken: config.usdc,
    sellAmount: intermediateAmount.toString(),
    takerAddress: input.receiver,
    purpose: 'execution',
  });
  if (!secondQuote?.buyAmount || !secondQuote.liquidityAvailable) throw new Error('0x second firm quote unavailable');
  const finalAmount = asPositiveInteger('0x second buyAmount', secondQuote.buyAmount);
  const second = quoteTransaction(secondQuote, intermediateAmount);
  return { loanAmount, firstQuote, secondQuote, intermediateAmount, finalAmount, first, second };
}

async function ensureInfrastructureForRequest(request: AtomicRequest): Promise<void> {
  if (!supportsSponsoredReceiverChain(request.chain)) throw new Error(`${request.chain} has no reviewed receiver-backed Balancer execution surface`);
  const config = SUPPORTED_CHAINS[request.chain];
  if (!config?.usdc || !config?.usdt) throw new Error(`${request.chain} stablecoin contract identities are incomplete`);
  await multiProviderRpcManager.initialize([request.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(request.chain, 'json_rpc');
  const wallet = configuredWallet();
  if (!wallet) throw new Error('DEX atomic infrastructure requires the configured execution signer');
  const connectedWallet = wallet.connect(provider);
  const network = await provider.getNetwork();
  if (network.chainId !== config.chainId) throw new Error(`DEX atomic provider chain mismatch for ${request.chain}`);
  const fundingMode = infrastructureFundingMode();
  const manager = getSponsoredReceiverManager();
  const receiverRecord = await manager.ensureReceiver({
    chain: request.chain,
    provider,
    wallet: connectedWallet,
    fundingMode,
  });
  const firm = await firmRoundTripQuotes({ request, receiver: receiverRecord.address });
  const calls = await manager.buildMissingExplicitPermissionCalls({
    receiver: receiverRecord.address,
    provider,
    targets: [firm.first.target, firm.second.target],
    approvalTokens: [config.usdc, config.usdt],
  });
  await executeInfrastructureCalls({
    chain: request.chain,
    chainId: config.chainId,
    wallet: connectedWallet,
    provider,
    fundingMode,
    calls,
  });
}

/**
 * Called only beneath the canonical execution scheduler through the measured
 * topology adapter. It performs bounded infrastructure readiness work queued by
 * read-only discovery preparation; it never submits a swap transaction.
 */
export async function reconcilePendingZeroXAtomicInfrastructure(
  maxRequests = 1,
): Promise<ZeroXAtomicInfrastructureResult> {
  const ttlMs = Math.max(5_000, Math.min(120_000, Number(process.env.CRYPTOCRAWL_DEX_INFRA_REQUEST_TTL_MS || 30_000)));
  const now = Date.now();
  for (const [id, request] of pendingInfrastructure.entries()) {
    if (now - request.queuedAt > ttlMs) pendingInfrastructure.delete(id);
  }

  const pending = [...pendingInfrastructure.values()]
    .sort((left, right) => left.queuedAt - right.queuedAt)
    .slice(0, Math.max(0, Math.min(4, Math.floor(maxRequests))));
  const details: ZeroXAtomicInfrastructureResult['details'] = [];
  let prepared = 0;
  let failed = 0;

  for (const request of pending) {
    try {
      await ensureInfrastructureForRequest(request);
      pendingInfrastructure.delete(request.opportunityId);
      prepared += 1;
      details.push({ opportunityId: request.opportunityId, chain: request.chain, ready: true });
      logger.info('[DexAtomic] Receiver/AllowanceHolder infrastructure reconciled beneath canonical scheduler', {
        component: 'DexZeroXAtomicExecutor',
        opportunityId: request.opportunityId,
        chain: request.chain,
        tradeSubmitted: false,
        discoveryMutationAuthority: false,
      });
    } catch (error) {
      failed += 1;
      details.push({
        opportunityId: request.opportunityId,
        chain: request.chain,
        ready: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    attempted: pending.length,
    prepared,
    failed,
    remaining: pendingInfrastructure.size,
    details,
  };
}

export function getPreparedZeroXAtomicPlan(opportunityId: string): ZeroXAtomicRoundTripPreparation | null {
  const plan = preparedPlans.get(opportunityId);
  if (!plan || plan.expiresAt <= Date.now()) {
    preparedPlans.delete(opportunityId);
    return null;
  }
  return { ...plan, payload: { ...plan.payload }, firstQuote: { ...plan.firstQuote }, secondQuote: { ...plan.secondQuote }, provenance: [...plan.provenance] };
}

/**
 * Read-only firm preparation: network reads, 0x quote reads, on-chain permission
 * reads, eth_call and gas estimation only. Missing receiver/permissions are queued
 * for the canonical scheduler's infrastructure reconciler and fail closed here.
 */
export async function prepareZeroXAtomicRoundTrip(input: AtomicRequest): Promise<ZeroXAtomicRoundTripPreparation> {
  requestInputs.set(input.opportunityId, { ...input });
  if (!supportsSponsoredReceiverChain(input.chain)) throw new Error(`${input.chain} has no reviewed receiver-backed Balancer execution surface`);
  const config = SUPPORTED_CHAINS[input.chain];
  if (!config?.usdc || !config?.usdt) throw new Error(`${input.chain} stablecoin contract identities are incomplete`);
  if (!Number.isFinite(input.notionalUsd) || input.notionalUsd <= 0) throw new Error('DEX atomic notional must be positive');

  await multiProviderRpcManager.initialize([input.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(input.chain, 'json_rpc');
  const wallet = configuredWallet();
  if (!wallet) throw new Error('DEX atomic preparation requires the configured execution signer');
  const connectedWallet = wallet.connect(provider);
  const network = await provider.getNetwork();
  if (network.chainId !== config.chainId) throw new Error(`DEX atomic provider chain mismatch for ${input.chain}`);

  const manager = getSponsoredReceiverManager();
  const receiverRecord = await manager.inspectExistingReceiver({
    chain: input.chain,
    provider,
    owner: connectedWallet.address,
  });
  if (!receiverRecord) {
    rememberInfrastructureNeed(input);
    throw new Error('DEX_ATOMIC_RECEIVER_NOT_READY');
  }
  const receiver = receiverRecord.address;
  const firm = await firmRoundTripQuotes({ request: input, receiver });

  const missingPermissionCalls = await manager.buildMissingExplicitPermissionCalls({
    receiver,
    provider,
    targets: [firm.first.target, firm.second.target],
    approvalTokens: [config.usdc, config.usdt],
  });
  if (missingPermissionCalls.length > 0) {
    rememberInfrastructureNeed(input);
    throw new Error('DEX_ATOMIC_RECEIVER_PERMISSIONS_NOT_READY');
  }
  pendingInfrastructure.delete(input.opportunityId);

  const flashLoanFeeBps = await measureBalancerFlashFeeBps(input.chain, provider);
  const flashLoanFeeAmount = firm.loanAmount.mul(Math.round(flashLoanFeeBps * 1000)).div(10_000_000);
  const grossBaseUnits = firm.finalAmount.sub(firm.loanAmount);
  if (grossBaseUnits.lte(0)) throw new Error('0x firm round-trip gross economics are not positive');
  const profitRecipient = asAddress('operational profit recipient', resolveOperationalProfitRecipient());
  const preliminaryData = encodeReceiverPayload({
    receiver,
    loanToken: config.usdc,
    loanAmount: firm.loanAmount,
    minProfit: BigNumber.from(1),
    profitRecipient,
    first: firm.first,
    second: firm.second,
    intermediateAmount: firm.intermediateAmount,
    intermediateToken: config.usdt,
  });
  await provider.call({ from: connectedWallet.address, to: receiver, data: preliminaryData, value: 0 });
  const estimatedGas = await provider.estimateGas({ from: connectedWallet.address, to: receiver, data: preliminaryData, value: 0 });
  const gas = await gasOracle.getGasPrice(input.chain);
  const gasUsd = gas.usdCost * Number(estimatedGas.toString()) / DEFAULT_GAS_LIMIT;
  if (!Number.isFinite(gasUsd) || gasUsd < 0) throw new Error('Exact DEX atomic gas cost could not be measured');
  const gasBaseUnits = BigNumber.from(Math.ceil(gasUsd * 1_000_000));
  const deterministicNetBaseUnits = grossBaseUnits.sub(flashLoanFeeAmount).sub(gasBaseUnits);
  if (deterministicNetBaseUnits.lte(0)) throw new Error('0x firm atomic round-trip is not positive after measured flash fee and gas');

  const minProfitBps = Math.max(1, Math.min(10_000, Math.trunc(Number(process.env.ZERO_CAPITAL_MIN_PROFIT_BPS || 9000))));
  const minProfit = deterministicNetBaseUnits.mul(minProfitBps).div(10_000);
  const finalData = encodeReceiverPayload({
    receiver,
    loanToken: config.usdc,
    loanAmount: firm.loanAmount,
    minProfit: minProfit.gt(0) ? minProfit : BigNumber.from(1),
    profitRecipient,
    first: firm.first,
    second: firm.second,
    intermediateAmount: firm.intermediateAmount,
    intermediateToken: config.usdt,
  });
  await provider.call({ from: connectedWallet.address, to: receiver, data: finalData, value: 0 });

  const grossProfitUsd = baseUnitsToUsd(grossBaseUnits);
  const flashLoanFeeUsd = baseUnitsToUsd(flashLoanFeeAmount);
  const deterministicNetProfitUsd = baseUnitsToUsd(deterministicNetBaseUnits);
  const grossProfitBps = grossProfitUsd / input.notionalUsd * 10_000;
  const gasCostBps = gasUsd / input.notionalUsd * 10_000;
  const allInCostBps = flashLoanFeeBps + gasCostBps;
  const netProfitBps = deterministicNetProfitUsd / input.notionalUsd * 10_000;
  const quoteTtlMs = Math.max(500, Number(process.env.ZEROX_QUOTE_TTL_MS || 2_000));
  const expiresAt = Math.min(firm.firstQuote.observedAt + quoteTtlMs, firm.secondQuote.observedAt + quoteTtlMs);
  if (expiresAt <= Date.now()) throw new Error('0x firm quote expired during exact atomic preparation');

  const plan: ZeroXAtomicRoundTripPreparation = {
    opportunityId: input.opportunityId,
    chain: input.chain,
    receiver,
    inputToken: config.usdc,
    intermediateToken: config.usdt,
    loanAmount: firm.loanAmount.toString(),
    finalAmount: firm.finalAmount.toString(),
    flashLoanFeeAmount: flashLoanFeeAmount.toString(),
    grossProfitUsd,
    flashLoanFeeUsd,
    gasUsd,
    deterministicNetProfitUsd,
    grossProfitBps,
    flashLoanFeeBps,
    gasCostBps,
    allInCostBps,
    netProfitBps,
    minProfit: (minProfit.gt(0) ? minProfit : BigNumber.from(1)).toString(),
    payload: { to: receiver, data: finalData, value: '0', gasLimit: Number(estimatedGas.toString()) },
    firstQuote: firm.firstQuote,
    secondQuote: firm.secondQuote,
    expiresAt,
    simulated: true,
    provenance: [
      '0x:v2_allowance_holder_firm_quote',
      '0x:issues_allowance_spender_or_allowance_target_preserved',
      '0x:allowance_spender_equals_transaction_target_verified',
      'receiver:existing_deployment_verified_read_only',
      'receiver:permissions_verified_read_only',
      'balancer_v2:flash_fee_measured_onchain',
      'receiver:exact_eth_call_simulation',
      'receiver:exact_gas_estimate',
      'discovery_infrastructure_mutation:false',
      'synthetic_evidence:false',
    ],
  };
  preparedPlans.set(input.opportunityId, plan);
  return getPreparedZeroXAtomicPlan(input.opportunityId)!;
}

export async function executePreparedZeroXAtomicRoundTrip(
  opportunityId: string,
  options: { fundingMode?: 'sponsored' | 'native' } = {},
): Promise<ZeroXAtomicExecutionResult> {
  const request = requestInputs.get(opportunityId);
  if (!request) return rejected('DEX_ATOMIC_REQUEST_CONTEXT_MISSING');
  if (!stageManager.canExecuteTrades()) return rejected('DEX_ATOMIC_STAGE_NOT_EXECUTABLE');
  getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: request.chain });

  let plan: ZeroXAtomicRoundTripPreparation;
  try { plan = await prepareZeroXAtomicRoundTrip(request); }
  catch (error) { return rejected(error instanceof Error ? error.message : String(error)); }
  if (!(plan.deterministicNetProfitUsd > 0) || plan.expiresAt <= Date.now()) return rejected('DEX_ATOMIC_FRESH_ALL_IN_ECONOMICS_NOT_POSITIVE');

  const config = SUPPORTED_CHAINS[request.chain];
  await multiProviderRpcManager.initialize([request.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(request.chain, 'json_rpc');
  const wallet = configuredWallet();
  if (!wallet) return rejected('DEX_ATOMIC_SIGNER_MISSING');
  const connectedWallet = wallet.connect(provider);
  const sponsor = getGasSponsorManager();
  const requestedFundingMode = options.fundingMode ?? (sponsor.getReadiness().ready ? 'sponsored' : 'native');
  let transactionHash: string | undefined;
  let fundingModeUsed: 'sponsored' | 'native' | undefined;

  try {
    if (requestedFundingMode === 'sponsored') {
      if (!sponsor.getReadiness().ready) return rejected('DEX_ATOMIC_SPONSORSHIP_NOT_READY_FOR_LEASED_MODE');
      const sponsored = await sponsor.execute({
        wallet: connectedWallet,
        chainId: config.chainId,
        calls: [{ to: plan.payload.to, data: plan.payload.data, value: BigNumber.from(0) }],
        timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_EXECUTION_TIMEOUT_MS || 90_000)),
      });
      transactionHash = sponsored.transactionHash;
      fundingModeUsed = 'sponsored';
    } else {
      transactionHash = await withEvmSignerLane({
        chainId: config.chainId,
        walletAddress: connectedWallet.address,
        operation: async () => {
          const transaction = await connectedWallet.sendTransaction({
            to: plan.payload.to,
            data: plan.payload.data,
            value: 0,
            gasLimit: plan.payload.gasLimit,
          });
          return transaction.hash;
        },
      });
      fundingModeUsed = 'native';
    }

    const receipt = await provider.waitForTransaction(
      transactionHash,
      1,
      Math.max(15_000, Number(process.env.ZERO_CAPITAL_RECEIPT_TIMEOUT_MS || 120_000)),
    );
    if (!receipt) return { success: false, status: 'settlement_unknown', terminal: false, settlementConfirmed: false, transactionHash, fundingModeUsed, error: 'DEX_ATOMIC_RECEIPT_UNAVAILABLE' };

    const receiptStatus = receipt.status === 1 ? 1 : 0;
    const gasUsed = receipt.gasUsed?.toString();
    const effectiveGasPriceWei = receipt.effectiveGasPrice?.toString();
    if (receiptStatus !== 1) {
      return {
        success: false,
        status: 'failed',
        terminal: true,
        settlementConfirmed: true,
        transactionHash,
        fundingModeUsed,
        receiptStatus,
        gasUsed,
        effectiveGasPriceWei,
        error: 'DEX_ATOMIC_RECEIPT_REVERTED',
      };
    }

    const iface = new ethers.utils.Interface(RECEIVER_ABI);
    let receiverProfit: BigNumber | null = null;
    for (const log of receipt.logs) {
      if (!sameAddress(log.address, plan.receiver)) continue;
      try {
        const parsed = iface.parseLog(log);
        if (parsed.name === 'FlashLoanExecuted') receiverProfit = BigNumber.from(parsed.args.profit);
      } catch { /* unrelated receiver log */ }
    }
    if (!receiverProfit || receiverProfit.lte(0)) {
      return {
        success: false,
        status: 'failed',
        terminal: true,
        settlementConfirmed: true,
        transactionHash,
        fundingModeUsed,
        receiptStatus,
        gasUsed,
        effectiveGasPriceWei,
        error: 'DEX_ATOMIC_TERMINAL_PROFIT_EVENT_MISSING_OR_NONPOSITIVE',
      };
    }

    const realizedProfitUsd = baseUnitsToUsd(receiverProfit);
    const realizedProfitBps = realizedProfitUsd / request.notionalUsd * 10_000;
    logger.info('[DexAtomic] Terminal 0x receiver event confirmed; all-in reconciliation pending', {
      component: 'DexZeroXAtomicExecutor',
      opportunityId,
      chain: request.chain,
      transactionHash,
      fundingModeUsed,
      receiverProfitUsd: realizedProfitUsd,
      receiverProfitBps: realizedProfitBps,
      receiptStatus,
      gasUsed,
      effectiveGasPriceWei,
      settlementConfirmed: true,
      allInRealizedEconomicsAuthority: 'canonical_measured_topology_adapter_after_actual_gas',
      syntheticEvidence: false,
    });
    return {
      success: true,
      status: 'filled',
      terminal: true,
      settlementConfirmed: true,
      transactionHash,
      fundingModeUsed,
      receiptStatus,
      gasUsed,
      effectiveGasPriceWei,
      realizedProfitUsd,
      realizedProfitBps,
      gasUsd: plan.gasUsd,
    };
  } catch (error) {
    return transactionHash
      ? { success: false, status: 'settlement_unknown', terminal: false, settlementConfirmed: false, transactionHash, fundingModeUsed, error: error instanceof Error ? error.message : String(error) }
      : { success: false, status: 'failed', terminal: true, settlementConfirmed: false, fundingModeUsed, error: error instanceof Error ? error.message : String(error) };
  }
}