import { BigNumber, ethers, providers } from 'ethers';
import logger from '../../../logger.js';
import type { FilteredPendingTransaction } from '../capital-free/alchemy-filtered-pending-stream.js';
import type { DecodedPendingSwapRoute } from '../capital-free/pending-swap-route-decoder.js';
import { coinGeckoPriceClient } from '../bridge/coingecko-client.js';
import { zeroCapitalEngine, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import { walletFromPrivateKey } from '../core/wallet-identity.js';
import { minimumPositiveProfitBaseUnits } from '../governance/profit-admission-authority.js';
import { zeroCapitalRouteEvidenceRegistry } from '../optimization/zero-capital-route-evidence-registry.js';
import { multiProviderRpcManager } from '../api/blockchain-providers.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from './adapters/autonomous-route-planner.js';
import { buildDualFlashLoanReceiverPayload } from './adapters/dual-flashloan-receiver-builder.js';
import { flashLoanProviderSelectionRegistry, type FlashLoanProviderSelection } from './adapters/flash-loan-provider-selection-registry.js';
import { buildFlashLoanReceiverPayloadFromPlan } from './adapters/flashloan-receiver-builder.js';
import { MultiRelaySubmitter } from './multi-relay-submitter.js';
import type { ExactBackrunPlan } from './mev-backrun-executor.js';

export interface CompiledPostVictimBackrun {
  opportunityId: string;
  sourceZeroCapitalOpportunityId: string;
  victimHash: string;
  compiledAt: number;
  expiresAt: number;
  deterministicNetProfitUsd: number;
  deterministicNetProfitBps: number;
  expectedGasUsd: number;
  expectedGasInInputToken: bigint;
  targetBlock: number;
  simulationRelay: string | null;
  simulationBundleHash: string | null;
  simulationTotalGasUsed: number | null;
  plan: ExactBackrunPlan;
  provenance: string[];
}

/**
 * Measurement-only Mempool economics captured before the positive execution
 * admission gate. This is the all-in economics of the fresh compatible route
 * plus the raw EOA bundle's current gas and relay burden. It is deliberately not
 * represented as deterministic post-victim profit until the exact victim-first
 * signed bundle passes relay simulation.
 */
export interface MeasuredPostVictimBackrunEconomics {
  opportunityId: string;
  sourceZeroCapitalOpportunityId: string;
  victimHash: string;
  measuredAt: number;
  expiresAt: number;
  grossProfitUsd: number;
  grossProfitBps: number;
  flashLoanFeeUsd: number;
  flashLoanFeeBps: number;
  expectedGasUsd: number;
  gasCostBps: number;
  relayFeeUsd: number;
  relayCostBps: number;
  notionalUsd: number;
  measuredNetProfitUsd: number;
  measuredNetProfitBps: number;
  clearsExecutionResidual: boolean;
  executionAuthority: false;
  exactVictimFirstSimulationRequired: true;
  provenance: string[];
}

type SimulationAuthority = {
  initialize(): Promise<void>;
  simulateBundle(bundle: { signedTransactions: string[]; targetBlock: number }, targetBlock: number): Promise<{
    valid: boolean;
    reason?: string;
    relay?: string;
    bundleHash?: string;
    totalGasUsed?: number;
    firstRevert?: string;
  }>;
};

function validRawTransaction(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value) && value.length > 10;
}

function reconstructSignedTransaction(transaction: any): string | null {
  if (!transaction) return null;
  if (validRawTransaction(transaction.raw)) {
    try {
      const parsed = ethers.utils.parseTransaction(transaction.raw);
      if (parsed.hash?.toLowerCase() === String(transaction.hash || '').toLowerCase()) return transaction.raw;
    } catch {
      // Fall through to canonical serialization from signed transaction fields.
    }
  }
  if (!transaction.r || !transaction.s || transaction.v === undefined || transaction.v === null) return null;
  try {
    const type = transaction.type === null || transaction.type === undefined ? 0 : Number(transaction.type);
    const unsigned: ethers.utils.UnsignedTransaction = {
      nonce: transaction.nonce,
      gasLimit: transaction.gasLimit,
      to: transaction.to || undefined,
      value: transaction.value || BigNumber.from(0),
      data: transaction.data || '0x',
      chainId: transaction.chainId,
      ...(type === 0 ? { gasPrice: transaction.gasPrice } : {}),
      ...(type === 1 ? { type: 1, gasPrice: transaction.gasPrice, accessList: transaction.accessList || [] } : {}),
      ...(type === 2 ? {
        type: 2,
        maxFeePerGas: transaction.maxFeePerGas,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
        accessList: transaction.accessList || [],
      } : {}),
    };
    const raw = ethers.utils.serializeTransaction(unsigned, {
      r: transaction.r,
      s: transaction.s,
      v: Number(transaction.v),
    });
    const parsed = ethers.utils.parseTransaction(raw);
    return parsed.hash?.toLowerCase() === String(transaction.hash || '').toLowerCase() ? raw : null;
  } catch {
    return null;
  }
}

function samePair(leftIn: string, leftOut: string, rightIn: string, rightOut: string): boolean {
  const a = leftIn.toLowerCase();
  const b = leftOut.toLowerCase();
  const c = rightIn.toLowerCase();
  const d = rightOut.toLowerCase();
  return (a === c && b === d) || (a === d && b === c);
}

function routeTouchesVictim(opportunity: ZeroCapitalOpportunity, decoded: DecodedPendingSwapRoute): boolean {
  for (let victimIndex = 1; victimIndex < decoded.tokenPath.length; victimIndex += 1) {
    const victimIn = decoded.tokenPath[victimIndex - 1];
    const victimOut = decoded.tokenPath[victimIndex];
    if (opportunity.route.some(step => samePair(step.tokenIn, step.tokenOut, victimIn, victimOut))) return true;
  }
  return false;
}

function selectCompatibleOpportunity(decoded: DecodedPendingSwapRoute, now: number): {
  opportunity: ZeroCapitalOpportunity;
  selection: FlashLoanProviderSelection;
} | null {
  const candidates = new Map<string, ZeroCapitalOpportunity>();
  for (const token of decoded.tokenPath) {
    for (const opportunity of zeroCapitalRouteEvidenceRegistry.getCompatibleOpportunities({
      chain: 'ethereum',
      inputToken: token,
      now,
    })) candidates.set(opportunity.id, opportunity);
  }
  const eligible = [...candidates.values()]
    .filter(opportunity => opportunity.expectedProfit > 0n && opportunity.expiresAt > now)
    .filter(opportunity => routeTouchesVictim(opportunity, decoded))
    .flatMap(opportunity => {
      const selection = flashLoanProviderSelectionRegistry.get(opportunity.id, now);
      return selection && selection.expiresAt > now ? [{ opportunity, selection }] : [];
    })
    .sort((left, right) => {
      if (left.opportunity.expectedProfit === right.opportunity.expectedProfit) return left.opportunity.id.localeCompare(right.opportunity.id);
      return left.opportunity.expectedProfit > right.opportunity.expectedProfit ? -1 : 1;
    });
  return eligible[0] || null;
}

async function feeCeiling(provider: providers.JsonRpcProvider): Promise<{
  maxFeePerGas: BigNumber;
  maxPriorityFeePerGas: BigNumber;
}> {
  const [feeData, latestBlock] = await Promise.all([provider.getFeeData(), provider.getBlock('latest')]);
  const baseFee = latestBlock.baseFeePerGas;
  if (!baseFee || baseFee.lte(0)) throw new Error('BACKRUN_BASE_FEE_UNAVAILABLE');
  const configuredPriority = Number(process.env.CRYPTOCRAWL_BACKRUN_PRIORITY_FEE_GWEI || '0.25');
  const priority = ethers.utils.parseUnits(
    String(Number.isFinite(configuredPriority) ? Math.max(0, Math.min(20, configuredPriority)) : 0.25),
    'gwei',
  );
  const conservative = baseFee.mul(2).add(priority);
  const maxFeePerGas = feeData.maxFeePerGas && feeData.maxFeePerGas.gt(conservative)
    ? feeData.maxFeePerGas
    : conservative;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas.gt(priority)
    ? feeData.maxPriorityFeePerGas
    : priority;
  return { maxFeePerGas, maxPriorityFeePerGas };
}

async function gasBound(input: {
  gasLimit: number;
  maxFeePerGas: BigNumber;
  inputAssetSymbol: 'USDC' | 'USDT';
  inputTokenDecimals: number;
}): Promise<{ usd: number; baseUnits: bigint }> {
  const prices = await coinGeckoPriceClient.getLiveSymbolPrices(['ETH', input.inputAssetSymbol]);
  const ethUsd = prices.get('ETH');
  const tokenUsd = prices.get(input.inputAssetSymbol);
  if (!Number.isFinite(ethUsd) || Number(ethUsd) <= 0 || !Number.isFinite(tokenUsd) || Number(tokenUsd) <= 0) {
    throw new Error('BACKRUN_LIVE_GAS_CONVERSION_PRICE_UNAVAILABLE');
  }
  const maxGasWei = BigNumber.from(input.gasLimit).mul(input.maxFeePerGas);
  const nativeGas = Number(ethers.utils.formatEther(maxGasWei));
  const usd = nativeGas * Number(ethUsd);
  if (!Number.isFinite(usd) || usd <= 0) throw new Error('BACKRUN_MAX_GAS_USD_INVALID');
  const tokenUnits = usd / Number(tokenUsd);
  const decimalScale = 10 ** input.inputTokenDecimals;
  if (!Number.isSafeInteger(decimalScale) || decimalScale <= 0) throw new Error('BACKRUN_INPUT_TOKEN_DECIMALS_UNSAFE');
  const baseUnitsNumber = Math.ceil(tokenUnits * decimalScale);
  if (!Number.isSafeInteger(baseUnitsNumber) || baseUnitsNumber <= 0) throw new Error('BACKRUN_GAS_BASE_UNITS_UNSAFE');
  return { usd, baseUnits: BigInt(baseUnitsNumber) };
}

function preciseBps(value: bigint, notional: bigint): number {
  if (notional <= 0n) return Number.NEGATIVE_INFINITY;
  const precision = 1_000_000n;
  return Number((value * 10_000n * precision) / notional) / Number(precision);
}

function usdFromBaseUnits(value: bigint, decimals: number, tokenUsd: number): number {
  return Number(value) / (10 ** decimals) * tokenUsd;
}

async function simulateVictimFirstBundle(plan: ExactBackrunPlan): Promise<{
  valid: boolean;
  reason?: string;
  relay?: string;
  bundleHash?: string;
  totalGasUsed?: number;
}> {
  const submitter = new MultiRelaySubmitter();
  const authority = submitter as unknown as SimulationAuthority;
  await authority.initialize();
  return authority.simulateBundle({
    signedTransactions: [plan.signedVictimTransaction, plan.signedBackrunTransaction],
    targetBlock: plan.targetBlock,
  }, plan.targetBlock);
}

class ExactPostVictimBackrunRegistry {
  private readonly entries = new Map<string, CompiledPostVictimBackrun>();

  record(evidence: CompiledPostVictimBackrun): void {
    if (evidence.expiresAt <= evidence.compiledAt) return;
    this.entries.set(evidence.opportunityId, {
      ...evidence,
      plan: { ...evidence.plan, provenance: [...evidence.plan.provenance] },
      provenance: [...evidence.provenance],
    });
    this.prune();
  }

  get(opportunityId: string, now = Date.now()): CompiledPostVictimBackrun | null {
    const evidence = this.entries.get(opportunityId);
    if (!evidence || evidence.expiresAt <= now) {
      if (evidence) this.entries.delete(opportunityId);
      return null;
    }
    return {
      ...evidence,
      plan: { ...evidence.plan, provenance: [...evidence.plan.provenance] },
      provenance: [...evidence.provenance],
    };
  }

  remove(opportunityId: string): void { this.entries.delete(opportunityId); }

  private prune(): void {
    const now = Date.now();
    for (const [id, evidence] of this.entries) if (evidence.expiresAt <= now) this.entries.delete(id);
    const max = Math.max(32, Math.min(2048, Number(process.env.CRYPTOCRAWL_BACKRUN_PLAN_REGISTRY_MAX || 256)));
    if (this.entries.size <= max) return;
    const oldest = [...this.entries.values()].sort((left, right) => left.compiledAt - right.compiledAt);
    for (let index = 0; index < oldest.length - max; index += 1) this.entries.delete(oldest[index].opportunityId);
  }
}

class MeasuredPostVictimBackrunEconomicsRegistry {
  private readonly entries = new Map<string, MeasuredPostVictimBackrunEconomics>();

  record(evidence: MeasuredPostVictimBackrunEconomics): void {
    if (evidence.expiresAt <= evidence.measuredAt) return;
    this.entries.set(evidence.opportunityId, { ...evidence, provenance: [...evidence.provenance] });
    this.prune();
  }

  get(opportunityId: string, now = Date.now()): MeasuredPostVictimBackrunEconomics | null {
    const evidence = this.entries.get(opportunityId);
    if (!evidence || evidence.expiresAt <= now) {
      if (evidence) this.entries.delete(opportunityId);
      return null;
    }
    return { ...evidence, provenance: [...evidence.provenance] };
  }

  remove(opportunityId: string): void { this.entries.delete(opportunityId); }

  private prune(): void {
    const now = Date.now();
    for (const [id, evidence] of this.entries) if (evidence.expiresAt <= now) this.entries.delete(id);
    const max = Math.max(32, Math.min(2048, Number(process.env.CRYPTOCRAWL_BACKRUN_MEASUREMENT_REGISTRY_MAX || 512)));
    if (this.entries.size <= max) return;
    const oldest = [...this.entries.values()].sort((left, right) => left.measuredAt - right.measuredAt);
    for (let index = 0; index < oldest.length - max; index += 1) this.entries.delete(oldest[index].opportunityId);
  }
}

export const exactPostVictimBackrunRegistry = new ExactPostVictimBackrunRegistry();
export const measuredPostVictimBackrunEconomicsRegistry = new MeasuredPostVictimBackrunEconomicsRegistry();

/**
 * Compile one exact Ethereum victim-first private bundle. This function never
 * submits a transaction. Eligibility is granted only after a real relay
 * eth_callBundle simulation of the exact signed victim followed by the exact
 * signed flash-funded backrun. The receiver's minProfit is raised to cover the
 * signed transaction's maximum gas liability, relay cost, and a strictly positive
 * residual, so a successful inclusion cannot consume personal principal or gas.
 */
export async function compileExactPostVictimBackrun(input: {
  candidateOpportunityId: string;
  observation: FilteredPendingTransaction;
  decoded: DecodedPendingSwapRoute;
  candidateExpiresAt: number;
}): Promise<CompiledPostVictimBackrun | null> {
  const now = Date.now();
  if (input.observation.chain !== 'ethereum' || !input.decoded.routeComplete || input.candidateExpiresAt <= now) return null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.observation.hash)) return null;

  try {
    await multiProviderRpcManager.initialize(['ethereum']);
    const { http: provider } = await multiProviderRpcManager.getProvider('ethereum', 'json_rpc');
    const network = await provider.getNetwork();
    if (network.chainId !== 1) return null;

    const funding = await zeroCapitalEngine.getGasFundingDecision('ethereum');
    // Private EOA bundles still pay protocol gas. Paymaster/provider sponsorship
    // cannot be silently transferred to a raw signed EOA transaction.
    if (funding.mode !== 'native'
      || funding.paymentSource !== 'system_owned_native'
      || funding.strictZeroInitialCapitalEligible !== true
      || funding.operatorMonetaryInputRequired !== false) return null;

    const selected = selectCompatibleOpportunity(input.decoded, now);
    if (!selected) return null;
    const { opportunity, selection } = selected;
    if (opportunity.inputTokenDecimals > 6) return null; // Ethereum dynamic stable inputs are six decimals; keep integer conversion exact.

    const victim = await provider.getTransaction(input.observation.hash);
    if (!victim || victim.hash.toLowerCase() !== input.observation.hash.toLowerCase()) return null;
    const signedVictimTransaction = reconstructSignedTransaction(victim);
    if (!signedVictimTransaction) return null;

    const wallet = walletFromPrivateKey(process.env.WALLET_PRIVATE_KEY).connect(provider);
    if (victim.from && victim.from.toLowerCase() === wallet.address.toLowerCase()) return null;

    const gasLimit = selection.kind === 'dual' ? 1_800_000 : 1_400_000;
    const fees = await feeCeiling(provider);
    const gas = await gasBound({
      gasLimit,
      maxFeePerGas: fees.maxFeePerGas,
      inputAssetSymbol: opportunity.inputAssetSymbol,
      inputTokenDecimals: opportunity.inputTokenDecimals,
    });
    const relayFee = opportunity.relayFeeInInputToken || 0n;
    const minimumResidual = minimumPositiveProfitBaseUnits();
    const requiredReceiverProfit = gas.baseUnits + relayFee + minimumResidual;
    const grossProfit = opportunity.grossProfit ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
    const flashFee = selection.kind === 'dual'
      ? selection.totalMeasuredFlashFee
      : opportunity.flashLoanFeeInInputToken || 0n;
    const measuredReceiverProfit = grossProfit - flashFee;

    const tokenPrice = (await coinGeckoPriceClient.getLiveSymbolPrices([opportunity.inputAssetSymbol])).get(opportunity.inputAssetSymbol);
    if (!Number.isFinite(tokenPrice) || Number(tokenPrice) <= 0) return null;
    const price = Number(tokenPrice);
    const measuredNetBaseUnits = measuredReceiverProfit - gas.baseUnits - relayFee;
    const measuredExpiresAt = Math.min(input.candidateExpiresAt, opportunity.expiresAt, selection.expiresAt, now + 12_000);
    const notionalUsd = usdFromBaseUnits(opportunity.flashLoanAmount, opportunity.inputTokenDecimals, price);
    if (!(notionalUsd > 0) || measuredExpiresAt <= now) return null;
    measuredPostVictimBackrunEconomicsRegistry.record({
      opportunityId: input.candidateOpportunityId,
      sourceZeroCapitalOpportunityId: opportunity.id,
      victimHash: input.observation.hash,
      measuredAt: now,
      expiresAt: measuredExpiresAt,
      grossProfitUsd: usdFromBaseUnits(grossProfit, opportunity.inputTokenDecimals, price),
      grossProfitBps: preciseBps(grossProfit, opportunity.flashLoanAmount),
      flashLoanFeeUsd: usdFromBaseUnits(flashFee, opportunity.inputTokenDecimals, price),
      flashLoanFeeBps: preciseBps(flashFee, opportunity.flashLoanAmount),
      expectedGasUsd: gas.usd,
      gasCostBps: preciseBps(gas.baseUnits, opportunity.flashLoanAmount),
      relayFeeUsd: usdFromBaseUnits(relayFee, opportunity.inputTokenDecimals, price),
      relayCostBps: preciseBps(relayFee, opportunity.flashLoanAmount),
      notionalUsd,
      measuredNetProfitUsd: usdFromBaseUnits(measuredNetBaseUnits, opportunity.inputTokenDecimals, price),
      measuredNetProfitBps: preciseBps(measuredNetBaseUnits, opportunity.flashLoanAmount),
      clearsExecutionResidual: measuredNetBaseUnits >= minimumResidual,
      executionAuthority: false,
      exactVictimFirstSimulationRequired: true,
      provenance: [
        `source_zero_capital_opportunity:${opportunity.id}`,
        `flash_provider:${selection.provider}`,
        'mempool_stage_two:compatible_route_all_in_measurement',
        'mempool_stage_two:raw_eoa_bundle_gas_remeasured',
        'mempool_stage_two:relay_fee_included',
        'mempool_stage_two:flash_fee_included',
        'exact_post_victim_state_not_assumed',
        'exact_victim_first_bundle_simulation_required_for_execution',
        'predicted_savings_credited:false',
        'synthetic_economics:false',
        'execution_authority:false',
      ],
    });

    // This existing execution gate remains authoritative. A non-positive or
    // insufficient residual is now observable to Stage 2, but still cannot be
    // compiled into an executable backrun.
    if (measuredReceiverProfit < requiredReceiverProfit) return null;

    const planningOpportunity: ZeroCapitalOpportunity = {
      ...opportunity,
      expectedProfit: measuredReceiverProfit,
    };
    const plan = buildFlashLoanExecutionPlanFromOpportunity(planningOpportunity, {
      receiver: selection.receiver,
      provider: selection.kind === 'single' ? selection.provider : 'balancer_v2',
      profitRecipient: wallet.address,
      minProfitBaseUnits: requiredReceiverProfit,
      nowMs: now,
    });
    const payload = selection.kind === 'dual'
      ? buildDualFlashLoanReceiverPayload({
          chain: plan.chain,
          receiver: selection.receiver,
          loanToken: plan.loanToken,
          balancerAmount: selection.balancerAmount.toString(),
          aaveAmount: selection.aaveAmount.toString(),
          minProfit: plan.minProfit,
          profitRecipient: plan.profitRecipient,
          steps: plan.steps,
          gasLimit,
        })
      : buildFlashLoanReceiverPayloadFromPlan({ ...plan, gasLimit });

    const [nonce, currentBlock] = await Promise.all([
      provider.getTransactionCount(wallet.address, 'pending'),
      provider.getBlockNumber(),
    ]);
    const targetBlock = currentBlock + 1;
    const signedBackrunTransaction = await wallet.signTransaction({
      chainId: 1,
      type: 2,
      nonce,
      to: payload.to,
      data: payload.data,
      value: BigNumber.from(payload.value),
      gasLimit: BigNumber.from(gasLimit),
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    const parsedBackrun = ethers.utils.parseTransaction(signedBackrunTransaction);
    if (!parsedBackrun.hash || parsedBackrun.from?.toLowerCase() !== wallet.address.toLowerCase()) return null;

    const expiresAt = measuredExpiresAt;
    if (expiresAt <= now) return null;
    const guaranteedNetBaseUnits = requiredReceiverProfit - gas.baseUnits - relayFee;
    if (guaranteedNetBaseUnits <= 0n) return null;
    const deterministicNetProfitUsd = usdFromBaseUnits(guaranteedNetBaseUnits, opportunity.inputTokenDecimals, price);
    if (!Number.isFinite(deterministicNetProfitUsd) || deterministicNetProfitUsd <= 0) return null;

    const exactPlan: ExactBackrunPlan = {
      chain: 'ethereum',
      victimHash: input.observation.hash,
      signedVictimTransaction,
      signedBackrunTransaction,
      targetBlock,
      deterministicNetProfitUsd,
      expectedGasUsd: gas.usd,
      expiresAt,
      provenance: [
        `source_zero_capital_opportunity:${opportunity.id}`,
        `flash_provider:${selection.provider}`,
        'victim_raw_signature_reconstructed_and_hash_verified',
        'victim_first_backrun_second',
        'receiver_min_profit_covers_max_signed_gas_and_relay_cost',
        'no_frontrun_or_sandwich',
        'synthetic_evidence:false',
      ],
      principalProvenance: 'temporary_external',
      gasProvenance: 'system_owned',
      completeAllInCostsMeasured: true,
    };

    const simulation = await simulateVictimFirstBundle(exactPlan);
    if (!simulation.valid) {
      logger.debug('[ExactBackrunCompiler] Victim-first bundle simulation rejected candidate', {
        component: 'ExactPostVictimBackrunCompiler',
        victimHash: input.observation.hash,
        sourceOpportunityId: opportunity.id,
        reason: simulation.reason || 'relay_simulation_failed',
        executionAuthority: false,
      });
      return null;
    }

    const evidence: CompiledPostVictimBackrun = {
      opportunityId: input.candidateOpportunityId,
      sourceZeroCapitalOpportunityId: opportunity.id,
      victimHash: input.observation.hash,
      compiledAt: now,
      expiresAt,
      deterministicNetProfitUsd,
      deterministicNetProfitBps: preciseBps(guaranteedNetBaseUnits, opportunity.flashLoanAmount),
      expectedGasUsd: gas.usd,
      expectedGasInInputToken: gas.baseUnits,
      targetBlock,
      simulationRelay: simulation.relay || null,
      simulationBundleHash: simulation.bundleHash || null,
      simulationTotalGasUsed: Number.isFinite(simulation.totalGasUsed) ? Number(simulation.totalGasUsed) : null,
      plan: exactPlan,
      provenance: [
        ...exactPlan.provenance,
        'exact_post_victim_backrun_compiler:passed',
        'exact_victim_first_eth_callBundle_simulation:passed',
        ...(simulation.relay ? [`bundle_simulation_relay:${simulation.relay}`] : []),
      ],
    };
    exactPostVictimBackrunRegistry.record(evidence);
    return evidence;
  } catch (error) {
    logger.debug('[ExactBackrunCompiler] Candidate remains observation-only', {
      component: 'ExactPostVictimBackrunCompiler',
      victimHash: input.observation.hash,
      error: error instanceof Error ? error.message : String(error),
      executionAuthority: false,
      routeLocalFailure: true,
    });
    return null;
  }
}