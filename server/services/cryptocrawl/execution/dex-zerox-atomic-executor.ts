import { BigNumber, Wallet, ethers } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import { DEFAULT_GAS_LIMIT, SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import { gasOracle } from '../bridge/gas-oracle.js';
import type { ChainId } from '../bridge/types.js';
import { resolveOperationalProfitRecipient } from '../core/wallet-identity.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import {
  isStrictlyPositiveAllInNetProfit,
  minimumPositiveProfitBaseUnits,
} from '../governance/profit-admission-authority.js';
import { requireZeroCapitalInfrastructureDeploymentAllowed } from '../governance/zero-capital-infrastructure-policy.js';
import { stageManager } from '../governance/stage-management.js';
import { getMeasuredErc20Decimals } from '../intelligence/erc20-decimals-authority.js';
import { marketDataProviders, type DexQuoteObservation } from '../intelligence/market-data-providers.js';
import { getGasSponsorManager, type SponsoredCall } from '../strategies/gas-sponsorship.js';
import { executeSystemOwnedNativeTransaction } from './system-owned-native-transaction.js';
import {
  calculateMeasuredFlashLoanFee,
  measureFlashLoanProviders,
  selectMeasuredFlashLoanProvider,
  type FlashLoanProviderEconomics,
  type FlashLoanProviderKind,
} from './adapters/flash-loan-provider-economics.js';
import { ensureProviderSpecificReceiverCapability } from './adapters/provider-specific-receiver-bootstrap.js';
import { verifyFlashLoanReceiverCapability } from './adapters/flash-loan-receiver-capability.js';
import {
  getSponsoredReceiverManager,
  type ReceiverFundingMode,
} from './adapters/sponsored-receiver-manager.js';

const RECEIVER_ABI = [
  'function executeBalancerFlashLoan(address loanToken,uint256 loanAmount,(address target,uint256 value,bytes callData,address approvalToken,uint256 approvalAmount)[] steps,uint256 minProfit,address profitRecipient) external',
  'function executeAaveFlashLoan(address loanToken,uint256 loanAmount,(address target,uint256 value,bytes callData,address approvalToken,uint256 approvalAmount)[] steps,uint256 minProfit,address profitRecipient) external',
  'function executeMorphoFlashLoan(address loanToken,uint256 loanAmount,(address target,uint256 value,bytes callData,address approvalToken,uint256 approvalAmount)[] steps,uint256 minProfit,address profitRecipient) external',
  'event FlashLoanExecuted(address indexed initiator,address indexed loanToken,uint256 loanAmount,uint256 profit)',
];

export interface ZeroXAtomicRoundTripPreparation {
  opportunityId: string;
  chain: ChainId;
  receiver: string;
  flashLoanProvider: FlashLoanProviderKind;
  inputToken: string;
  intermediateToken: string;
  inputTokenDecimals: number;
  intermediateTokenDecimals: number;
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
  simulated: boolean;
  simulationAdvisoryError?: string;
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
  /** Receiver profit after flash-loan repayment/fee, before system-owned native gas. */
  realizedProfitUsd?: number;
  /** Receiver profit BPS before system-owned native gas. Not terminal all-in net BPS. */
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

function requireTokenDecimals(decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Stablecoin decimals are unavailable');
  return decimals;
}

function stableUnits(usd: number, decimals: number): string {
  requireTokenDecimals(decimals);
  if (!Number.isFinite(usd) || usd <= 0) throw new Error('Stablecoin USD amount must be positive');
  const micros = BigNumber.from(Math.max(1, Math.floor(usd * 1_000_000)).toString());
  if (decimals === 6) return micros.toString();
  if (decimals > 6) return micros.mul(BigNumber.from(10).pow(decimals - 6)).toString();
  const divisor = BigNumber.from(10).pow(6 - decimals);
  return micros.div(divisor).toString();
}

function usdToBaseUnitsCeil(usd: number, decimals: number): BigNumber {
  requireTokenDecimals(decimals);
  if (!Number.isFinite(usd) || usd < 0) throw new Error('Stablecoin USD cost is invalid');
  const micros = BigNumber.from(Math.max(0, Math.ceil(usd * 1_000_000)).toString());
  if (decimals === 6) return micros;
  if (decimals > 6) return micros.mul(BigNumber.from(10).pow(decimals - 6));
  const divisor = BigNumber.from(10).pow(6 - decimals);
  return micros.add(divisor).sub(1).div(divisor);
}

function baseUnitsToUsd(value: BigNumber, decimals: number): number {
  requireTokenDecimals(decimals);
  const result = Number(ethers.utils.formatUnits(value, decimals));
  if (!Number.isFinite(result)) throw new Error('Stablecoin base-unit value exceeds safe USD conversion range');
  return result;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function adaptiveStablecoinSlippagePpm(opportunityId: string): number {
  const configured = Number(process.env.ZEROX_STABLECOIN_SLIPPAGE_PPM);
  if (Number.isInteger(configured) && configured >= 0 && configured <= 1_000_000) return configured;

  const candidate = measuredCandidateRegistry.get(opportunityId);
  const netBps = Number(candidate?.canonicalBps?.netBps);
  if (!Number.isFinite(netBps) || netBps <= 0) return 10_000;

  const perLegBps = Math.max(0.10, Math.min(100, netBps * 0.25));
  return Math.max(10, Math.min(10_000, Math.round(perLegBps * 100)));
}

function configuredTradeSurplusMaxBps(): number {
  const parsed = Number(process.env.ZEROX_TRADE_SURPLUS_MAX_BPS || 10_000);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(10_000, parsed)) : 10_000;
}

function rememberInfrastructureNeed(input: AtomicRequest): void {
  pendingInfrastructure.set(input.opportunityId, { ...input, queuedAt: Date.now() });
}

function orderedMeasuredProviders(
  evidence: readonly FlashLoanProviderEconomics[],
  requestedAmount: bigint,
): FlashLoanProviderEconomics[] {
  const remaining = new Set<FlashLoanProviderKind>(['morpho_blue', 'aave_v3', 'balancer_v2']);
  const ordered: FlashLoanProviderEconomics[] = [];
  while (remaining.size > 0) {
    const selected = selectMeasuredFlashLoanProvider(evidence, requestedAmount, [...remaining]);
    if (!selected) break;
    ordered.push(selected);
    remaining.delete(selected.provider);
  }
  return ordered;
}

async function existingReceiverForProvider(input: {
  providerKind: FlashLoanProviderKind;
  chain: ChainId;
  provider: ethers.providers.JsonRpcProvider;
  wallet: Wallet;
}): Promise<string | null> {
  if (input.providerKind === 'balancer_v2') {
    const record = await getSponsoredReceiverManager().inspectExistingReceiver({
      chain: input.chain,
      provider: input.provider,
      owner: input.wallet.address,
    }).catch(() => null);
    if (!record) return null;
    const verified = await verifyFlashLoanReceiverCapability({
      kind: 'balancer_v1',
      chain: input.chain as any,
      provider: input.provider,
      expectedOwner: input.wallet.address,
      address: record.address,
    }).catch(() => null);
    return verified?.address ?? null;
  }
  const verified = await verifyFlashLoanReceiverCapability({
    kind: input.providerKind,
    chain: input.chain as any,
    provider: input.provider,
    expectedOwner: input.wallet.address,
  }).catch(() => null);
  return verified?.address ?? null;
}

async function selectExistingProviderReceiver(input: {
  chain: ChainId;
  provider: ethers.providers.JsonRpcProvider;
  wallet: Wallet;
  asset: string;
  requestedAmount: bigint;
}): Promise<{ economics: FlashLoanProviderEconomics; receiver: string } | null> {
  const evidence = await measureFlashLoanProviders({
    chain: input.chain as any,
    provider: input.provider,
    asset: input.asset,
  });
  for (const economics of orderedMeasuredProviders(evidence, input.requestedAmount)) {
    const receiver = await existingReceiverForProvider({
      providerKind: economics.provider,
      chain: input.chain,
      provider: input.provider,
      wallet: input.wallet,
    });
    if (receiver) return { economics, receiver };
  }
  return null;
}

function quoteTransaction(quote: DexQuoteObservation, expectedSellAmount: BigNumber): {
  target: string;
  data: string;
  value: BigNumber;
  gas: BigNumber;
  allowanceSpender: string;
} {
  if (!quote.executable || quote.quoteKind !== 'quote' || !quote.transaction) throw new Error('0x firm quote did not return executable transaction evidence');
  if (quote.amountMode !== 'exact_in') throw new Error('Atomic round-trip execution requires exact-in 0x calldata; exact-out remains a separate settlement capability');
  const target = asAddress('0x transaction target', quote.transaction.to);
  const data = String(quote.transaction.data || '');
  if (!ethers.utils.isHexString(data) || data === '0x') throw new Error('0x firm quote transaction calldata is missing');
  const value = BigNumber.from(quote.transaction.value || '0');
  if (!value.isZero()) throw new Error('Stablecoin atomic DEX route unexpectedly requires native transaction value');
  const gas = asPositiveInteger('0x firm quote gas', quote.transaction.gas || quote.estimatedGas);

  const explicitSpender = quote.allowanceSpender || quote.allowanceTarget;
  const spender = explicitSpender ? asAddress('0x allowance spender', explicitSpender) : target;
  if (!sameAddress(spender, target)) throw new Error('0x allowance spender differs from transaction target; unsupported AllowanceHolder route fails closed');

  const quotedSellAmount = asPositiveInteger('0x firm quote sellAmount', quote.sellAmount);
  if (!quotedSellAmount.eq(expectedSellAmount)) throw new Error('0x firm quote sell amount drifted from the requested atomic amount');
  return { target, data, value, gas, allowanceSpender: spender };
}

function infrastructureFundingMode(): ReceiverFundingMode {
  return 'native';
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
  if (input.fundingMode === 'sponsored') throw new Error('0x receiver permission sponsorship lacks canonical zero-operator-cost proof');

  const connected = input.wallet.connect(input.provider);
  for (const call of input.calls) {
    const data = String(call.data || '0x');
    const callHash = ethers.utils.keccak256(data);
    const result = await executeSystemOwnedNativeTransaction({
      chain: input.chain,
      wallet: connected,
      provider: input.provider,
      idempotencyKey: `dex-infra:${input.chain}:${call.to.toLowerCase()}:${callHash}`,
      purpose: 'zero_capital_receiver_permission_setup',
      transaction: { to: call.to, data, value: BigNumber.from(call.value || 0) },
      confirmations: 1,
    });
    if (result.receipt.status !== 1) throw new Error('0x receiver permission transaction reverted');
  }
}

function encodeReceiverPayload(input: {
  providerKind: FlashLoanProviderKind;
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
  const functionName = input.providerKind === 'aave_v3'
    ? 'executeAaveFlashLoan'
    : input.providerKind === 'morpho_blue'
      ? 'executeMorphoFlashLoan'
      : 'executeBalancerFlashLoan';
  return new ethers.utils.Interface(RECEIVER_ABI).encodeFunctionData(functionName, [
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
  inputTokenDecimals: number;
  intermediateTokenDecimals: number;
  firstQuote: DexQuoteObservation;
  secondQuote: DexQuoteObservation;
  intermediateAmount: BigNumber;
  finalAmount: BigNumber;
  first: ReturnType<typeof quoteTransaction>;
  second: ReturnType<typeof quoteTransaction>;
}> {
  const config = SUPPORTED_CHAINS[input.request.chain];
  const [inputTokenDecimals, intermediateTokenDecimals] = await Promise.all([
    getMeasuredErc20Decimals(input.request.chain, config.usdc),
    getMeasuredErc20Decimals(input.request.chain, config.usdt),
  ]);
  const loanAmount = BigNumber.from(stableUnits(input.request.notionalUsd, inputTokenDecimals));
  const slippagePpm = adaptiveStablecoinSlippagePpm(input.request.opportunityId);
  const firstQuote = await marketDataProviders.getDexQuote({
    chainId: config.chainId,
    sellToken: config.usdc,
    buyToken: config.usdt,
    sellAmount: loanAmount.toString(),
    takerAddress: input.receiver,
    purpose: 'execution',
    slippagePpm,
  });
  if (!firstQuote?.buyAmount || !firstQuote.liquidityAvailable) throw new Error('0x first firm quote unavailable');
  if (firstQuote.tradeSurplusRequested) throw new Error('First atomic leg must not divert positive slippage away from the intermediate sell amount');
  const intermediateAmount = asPositiveInteger('0x first buyAmount', firstQuote.buyAmount);
  const first = quoteTransaction(firstQuote, loanAmount);

  const secondQuote = await marketDataProviders.getDexQuote({
    chainId: config.chainId,
    sellToken: config.usdt,
    buyToken: config.usdc,
    sellAmount: intermediateAmount.toString(),
    takerAddress: input.receiver,
    purpose: 'execution',
    slippagePpm,
    tradeSurplusRecipient: input.receiver,
    tradeSurplusMaxBps: configuredTradeSurplusMaxBps(),
  });
  if (!secondQuote?.buyAmount || !secondQuote.liquidityAvailable) throw new Error('0x second firm quote unavailable');
  if (secondQuote.tradeSurplusRequested && !sameAddress(secondQuote.tradeSurplusRecipient || '', input.receiver)) {
    throw new Error('0x terminal trade-surplus recipient differs from the canonical atomic receiver');
  }
  const finalAmount = asPositiveInteger('0x second buyAmount', secondQuote.buyAmount);
  const second = quoteTransaction(secondQuote, intermediateAmount);
  return { loanAmount, inputTokenDecimals, intermediateTokenDecimals, firstQuote, secondQuote, intermediateAmount, finalAmount, first, second };
}

async function ensureProviderReceiver(input: {
  economics: FlashLoanProviderEconomics;
  request: AtomicRequest;
  provider: ethers.providers.JsonRpcProvider;
  wallet: Wallet;
  fundingMode: ReceiverFundingMode;
}): Promise<string> {
  const connectedWallet = input.wallet.connect(input.provider);
  if (input.economics.provider === 'balancer_v2') {
    const record = await getSponsoredReceiverManager().ensureReceiver({
      chain: input.request.chain,
      provider: input.provider,
      wallet: connectedWallet,
      fundingMode: input.fundingMode,
    });
    return record.address;
  }
  const capability = await ensureProviderSpecificReceiverCapability({
    kind: input.economics.provider,
    chain: input.request.chain as any,
    provider: input.provider,
    wallet: connectedWallet,
    fundingMode: input.fundingMode,
    executeSetupCalls: calls => executeInfrastructureCalls({
      chain: input.request.chain,
      chainId: SUPPORTED_CHAINS[input.request.chain].chainId,
      wallet: connectedWallet,
      provider: input.provider,
      fundingMode: input.fundingMode,
      calls,
    }),
  });
  if (!capability) throw new Error(`${input.economics.provider} receiver capability is unavailable`);
  return capability.address;
}

async function ensureInfrastructureForRequest(request: AtomicRequest): Promise<void> {
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
  const inputTokenDecimals = await getMeasuredErc20Decimals(request.chain, config.usdc);
  const requestedAmount = BigInt(stableUnits(request.notionalUsd, inputTokenDecimals));
  const evidence = await measureFlashLoanProviders({ chain: request.chain as any, provider, asset: config.usdc });
  const candidates = orderedMeasuredProviders(evidence, requestedAmount);
  if (candidates.length === 0) throw new Error(`No compatible measured flash-loan provider can fund DEX_ATOMIC on ${request.chain}`);

  const failures: string[] = [];
  for (const economics of candidates) {
    try {
      const receiver = await ensureProviderReceiver({ economics, request, provider, wallet: connectedWallet, fundingMode });
      const firm = await firmRoundTripQuotes({ request, receiver });
      const calls = await getSponsoredReceiverManager().buildMissingExplicitPermissionCalls({
        receiver,
        provider,
        targets: [firm.first.target, firm.second.target],
        approvalTokens: [config.usdc, config.usdt],
      });
      await executeInfrastructureCalls({ chain: request.chain, chainId: config.chainId, wallet: connectedWallet, provider, fundingMode, calls });
      return;
    } catch (error) {
      failures.push(`${economics.provider}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`DEX_ATOMIC provider-local infrastructure alternatives exhausted: ${failures.join(' | ')}`);
}

export async function reconcilePendingZeroXAtomicInfrastructure(maxRequests = 1): Promise<ZeroXAtomicInfrastructureResult> {
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
        component: 'DexZeroXAtomicExecutor', opportunityId: request.opportunityId, chain: request.chain,
        tradeSubmitted: false, discoveryMutationAuthority: false, personalGasFallbackAllowed: false,
      });
    } catch (error) {
      failed += 1;
      details.push({ opportunityId: request.opportunityId, chain: request.chain, ready: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { attempted: pending.length, prepared, failed, remaining: pendingInfrastructure.size, details };
}

export function getPreparedZeroXAtomicPlan(opportunityId: string): ZeroXAtomicRoundTripPreparation | null {
  const plan = preparedPlans.get(opportunityId);
  if (!plan || plan.expiresAt <= Date.now()) {
    preparedPlans.delete(opportunityId);
    return null;
  }
  return { ...plan, payload: { ...plan.payload }, firstQuote: { ...plan.firstQuote }, secondQuote: { ...plan.secondQuote }, provenance: [...plan.provenance] };
}

export async function prepareZeroXAtomicRoundTrip(input: AtomicRequest): Promise<ZeroXAtomicRoundTripPreparation> {
  requestInputs.set(input.opportunityId, { ...input });
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

  const inputTokenDecimalsForSelection = await getMeasuredErc20Decimals(input.chain, config.usdc);
  const requestedAmount = BigInt(stableUnits(input.notionalUsd, inputTokenDecimalsForSelection));
  const selected = await selectExistingProviderReceiver({
    chain: input.chain,
    provider,
    wallet: connectedWallet,
    asset: config.usdc,
    requestedAmount,
  });
  if (!selected) {
    rememberInfrastructureNeed(input);
    throw new Error('DEX_ATOMIC_COMPATIBLE_PROVIDER_RECEIVER_NOT_READY');
  }
  const receiver = selected.receiver;
  const firm = await firmRoundTripQuotes({ request: input, receiver });

  const missingPermissionCalls = await getSponsoredReceiverManager().buildMissingExplicitPermissionCalls({
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

  const refreshedEvidence = await measureFlashLoanProviders({ chain: input.chain as any, provider, asset: config.usdc });
  const refreshedSelected = selectMeasuredFlashLoanProvider(
    refreshedEvidence,
    BigInt(firm.loanAmount.toString()),
    [selected.economics.provider],
  );
  if (!refreshedSelected) throw new Error(`DEX_ATOMIC_${selected.economics.provider.toUpperCase()}_EVIDENCE_EXPIRED_OR_INSUFFICIENT`);
  const measuredFlashFee = calculateMeasuredFlashLoanFee(refreshedSelected, BigInt(firm.loanAmount.toString()));
  if (measuredFlashFee === null || refreshedSelected.feeBps === null) {
    throw new Error(`DEX_ATOMIC_${selected.economics.provider.toUpperCase()}_FLASH_FEE_UNMEASURED`);
  }
  const flashLoanFeeBps = refreshedSelected.feeBps;
  const flashLoanFeeAmount = BigNumber.from(measuredFlashFee.toString());
  const grossBaseUnits = firm.finalAmount.sub(firm.loanAmount);
  if (grossBaseUnits.lte(0)) throw new Error('0x firm round-trip gross economics are not positive');
  const profitRecipient = asAddress('operational profit recipient', resolveOperationalProfitRecipient());
  const canonicalMinProfit = BigNumber.from(minimumPositiveProfitBaseUnits().toString());
  const finalData = encodeReceiverPayload({
    providerKind: refreshedSelected.provider,
    receiver, loanToken: config.usdc, loanAmount: firm.loanAmount, minProfit: canonicalMinProfit, profitRecipient,
    first: firm.first, second: firm.second, intermediateAmount: firm.intermediateAmount, intermediateToken: config.usdt,
  });

  let simulated = false;
  let simulationAdvisoryError: string | undefined;
  try {
    await provider.call({ from: connectedWallet.address, to: receiver, data: finalData, value: 0 });
    simulated = true;
  } catch (error) {
    simulationAdvisoryError = error instanceof Error ? error.message : String(error);
    logger.debug('[DexAtomic] eth_call simulation advisory failed; execution admission remains governed by fresh executable economics and required transaction facts', {
      component: 'DexZeroXAtomicExecutor',
      opportunityId: input.opportunityId,
      chain: input.chain,
      flashLoanProvider: refreshedSelected.provider,
      simulationAdvisoryError,
      simulationVetoAuthority: false,
    });
  }

  const estimatedGas = await provider.estimateGas({ from: connectedWallet.address, to: receiver, data: finalData, value: 0 });
  const gas = await gasOracle.getGasPrice(input.chain);
  const gasUsd = gas.usdCost * Number(estimatedGas.toString()) / DEFAULT_GAS_LIMIT;
  if (!Number.isFinite(gasUsd) || gasUsd < 0) throw new Error('Exact DEX atomic gas cost could not be measured');
  const gasBaseUnits = usdToBaseUnitsCeil(gasUsd, firm.inputTokenDecimals);
  const deterministicNetBaseUnits = grossBaseUnits.sub(flashLoanFeeAmount).sub(gasBaseUnits);
  if (deterministicNetBaseUnits.lte(0)) throw new Error('0x firm atomic round-trip is not positive after measured flash fee and gas');

  const grossProfitUsd = baseUnitsToUsd(grossBaseUnits, firm.inputTokenDecimals);
  const flashLoanFeeUsd = baseUnitsToUsd(flashLoanFeeAmount, firm.inputTokenDecimals);
  const deterministicNetProfitUsd = baseUnitsToUsd(deterministicNetBaseUnits, firm.inputTokenDecimals);
  const grossProfitBps = grossProfitUsd / input.notionalUsd * 10_000;
  const gasCostBps = gasUsd / input.notionalUsd * 10_000;
  const allInCostBps = flashLoanFeeBps + gasCostBps;
  const netProfitBps = deterministicNetProfitUsd / input.notionalUsd * 10_000;
  const quoteTtlMs = Math.max(500, Number(process.env.ZEROX_QUOTE_TTL_MS || 2_000));
  const expiresAt = Math.min(firm.firstQuote.observedAt + quoteTtlMs, firm.secondQuote.observedAt + quoteTtlMs, refreshedSelected.observedAt + quoteTtlMs);
  if (expiresAt <= Date.now()) throw new Error('0x firm quote or flash-provider evidence expired during exact atomic preparation');

  const plan: ZeroXAtomicRoundTripPreparation = {
    opportunityId: input.opportunityId,
    chain: input.chain,
    receiver,
    flashLoanProvider: refreshedSelected.provider,
    inputToken: config.usdc,
    intermediateToken: config.usdt,
    inputTokenDecimals: firm.inputTokenDecimals,
    intermediateTokenDecimals: firm.intermediateTokenDecimals,
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
    minProfit: canonicalMinProfit.toString(),
    payload: { to: receiver, data: finalData, value: '0', gasLimit: Number(estimatedGas.toString()) },
    firstQuote: firm.firstQuote,
    secondQuote: firm.secondQuote,
    expiresAt,
    simulated,
    ...(simulationAdvisoryError ? { simulationAdvisoryError } : {}),
    provenance: [
      '0x:v2_allowance_holder_firm_quote',
      `0x:sub_bps_slippage_ppm:${firm.secondQuote.slippagePpmApplied ?? 'provider_default'}`,
      '0x:slippage_tolerance_is_execution_guard_not_expected_cost_credit',
      '0x:first_leg_trade_surplus_capture:false',
      `0x:terminal_trade_surplus_capture:${firm.secondQuote.tradeSurplusRequested}`,
      '0x:trade_surplus_pretrade_credit:false_terminal_receipt_only',
      '0x:issues_allowance_spender_or_allowance_target_preserved',
      '0x:allowance_spender_equals_transaction_target_verified',
      `0x:simulation_incomplete_advisory_only:${firm.firstQuote.simulationIncomplete === true || firm.secondQuote.simulationIncomplete === true}`,
      `token_decimals:input:${firm.inputTokenDecimals}`,
      `token_decimals:intermediate:${firm.intermediateTokenDecimals}`,
      'token_decimals:measured_onchain',
      `flash_loan_provider:${refreshedSelected.provider}`,
      'flash_loan_provider:fee_and_liquidity_remeasured_after_firm_quote',
      'provider_receiver:existing_deployment_verified_read_only',
      'receiver:permissions_verified_read_only',
      simulated ? 'receiver:eth_call_simulation_advisory_passed' : 'receiver:eth_call_simulation_advisory_unavailable_or_failed',
      'receiver:eth_call_simulation_veto_authority:false',
      'receiver:exact_gas_estimate_required_for_all_in_cost_and_tx_limit',
      'profit_admission:single_strictly_positive_authority',
      'gas:system_owned_native_reservation_required_at_execution',
      'provider_failure_scope:route_local',
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
  if (!isStrictlyPositiveAllInNetProfit(plan.deterministicNetProfitUsd) || plan.expiresAt <= Date.now()) {
    return rejected('DEX_ATOMIC_FRESH_ALL_IN_ECONOMICS_NOT_POSITIVE');
  }

  const config = SUPPORTED_CHAINS[request.chain];
  await multiProviderRpcManager.initialize([request.chain]);
  const { http: provider } = await multiProviderRpcManager.getProvider(request.chain, 'json_rpc');
  const wallet = configuredWallet();
  if (!wallet) return rejected('DEX_ATOMIC_SIGNER_MISSING');
  const connectedWallet = wallet.connect(provider);
  const sponsor = getGasSponsorManager();
  const requestedFundingMode = options.fundingMode ?? 'native';
  let transactionHash: string | undefined;
  let fundingModeUsed: 'sponsored' | 'native' | undefined;
  let nativeReceipt: ethers.providers.TransactionReceipt | null = null;

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
      const native = await executeSystemOwnedNativeTransaction({
        chain: request.chain,
        wallet: connectedWallet,
        provider,
        idempotencyKey: `dex-atomic:${opportunityId}:${plan.flashLoanProvider}:${plan.receiver.toLowerCase()}`,
        purpose: `dex_atomic_${plan.flashLoanProvider}_execution`,
        transaction: { to: plan.payload.to, data: plan.payload.data, value: 0, gasLimit: plan.payload.gasLimit },
        confirmations: 1,
      });
      transactionHash = native.transactionHash;
      nativeReceipt = native.receipt;
      fundingModeUsed = 'native';
    }

    const receipt = nativeReceipt || await provider.waitForTransaction(
      transactionHash,
      1,
      Math.max(15_000, Number(process.env.ZERO_CAPITAL_RECEIPT_TIMEOUT_MS || 120_000)),
    );
    if (!receipt) return { success: false, status: 'settlement_unknown', terminal: false, settlementConfirmed: false, transactionHash, fundingModeUsed, error: 'DEX_ATOMIC_RECEIPT_UNAVAILABLE' };

    const receiptStatus = receipt.status === 1 ? 1 : 0;
    const gasUsed = receipt.gasUsed?.toString();
    const effectiveGasPriceWei = receipt.effectiveGasPrice?.toString();
    if (receiptStatus !== 1) {
      return { success: false, status: 'failed', terminal: true, settlementConfirmed: true, transactionHash, fundingModeUsed, receiptStatus, gasUsed, effectiveGasPriceWei, error: 'DEX_ATOMIC_RECEIPT_REVERTED' };
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
      return { success: false, status: 'failed', terminal: true, settlementConfirmed: true, transactionHash, fundingModeUsed, receiptStatus, gasUsed, effectiveGasPriceWei, error: 'DEX_ATOMIC_TERMINAL_PROFIT_EVENT_MISSING_OR_NONPOSITIVE' };
    }

    const realizedProfitUsd = baseUnitsToUsd(receiverProfit, plan.inputTokenDecimals);
    const realizedProfitBps = realizedProfitUsd / request.notionalUsd * 10_000;
    logger.info('[DexAtomic] Terminal 0x receiver event confirmed; all-in reconciliation pending', {
      component: 'DexZeroXAtomicExecutor', opportunityId, chain: request.chain, transactionHash, fundingModeUsed,
      flashLoanProvider: plan.flashLoanProvider,
      receiverProfitUsd: realizedProfitUsd, receiverProfitBps: realizedProfitBps,
      inputTokenDecimals: plan.inputTokenDecimals,
      terminalTradeSurplusCaptureRequested: plan.secondQuote.tradeSurplusRequested,
      terminalTradeSurplusPretradeCreditBps: 0,
      receiptStatus, gasUsed, effectiveGasPriceWei, settlementConfirmed: true,
      personalGasFallbackAllowed: false,
      systemOwnedNativeGasLedgerApplied: fundingModeUsed === 'native',
      allInRealizedEconomicsAuthority: 'canonical_measured_topology_adapter_after_actual_gas',
      syntheticEvidence: false,
    });
    return {
      success: true, status: 'filled', terminal: true, settlementConfirmed: true,
      transactionHash, fundingModeUsed, receiptStatus, gasUsed, effectiveGasPriceWei,
      realizedProfitUsd, realizedProfitBps, gasUsd: plan.gasUsd,
    };
  } catch (error) {
    return transactionHash
      ? { success: false, status: 'settlement_unknown', terminal: false, settlementConfirmed: false, transactionHash, fundingModeUsed, error: error instanceof Error ? error.message : String(error) }
      : { success: false, status: 'failed', terminal: true, settlementConfirmed: false, fundingModeUsed, error: error instanceof Error ? error.message : String(error) };
  }
}