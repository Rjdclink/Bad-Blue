import { BigNumber, Contract, ethers, type Wallet, type providers } from 'ethers';
import logger from '../../../logger.js';
import {
  getZeroInitialCapitalDynamicOrchestrator,
  type ZeroInitialCapitalLane,
  type ZeroInitialCapitalPreparedCandidate,
} from '../capital-free/zero-initial-capital-dynamic-orchestrator.js';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';
import {
  zeroCapitalEngine,
  type ExecutionResult,
  type SupportedChain,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import { buildFlashLoanExecutionPlanFromOpportunity } from '../execution/adapters/autonomous-route-planner.js';
import { buildDualFlashLoanReceiverPayload } from '../execution/adapters/dual-flashloan-receiver-builder.js';
import { buildFlashLoanReceiverPayloadFromPlan } from '../execution/adapters/flashloan-receiver-builder.js';
import { dualFlashLoanProviderSelectionRegistry } from '../execution/adapters/dual-flash-loan-provider-selection-registry.js';
import { flashLoanProviderSelectionRegistry } from '../execution/adapters/flash-loan-provider-selection-registry.js';
import type { NormalizedRealizedExecution } from '../execution/settlement-types.js';
import { getGasSponsorManager } from '../strategies/gas-sponsorship.js';

const installed = new WeakSet<object>();
const ERC20_BALANCE_ABI = ['function balanceOf(address account) view returns (uint256)'];
const RECEIVER_EVENT = new ethers.utils.Interface([
  'event FlashLoanExecuted(address indexed initiator,address indexed loanToken,uint256 loanAmount,uint256 profit)',
]);

type FundingLaneKind = 'opportunity_erc20_postop' | 'external_sponsor' | 'system_native';

type DynamicFundingRuntime = {
  providers: Map<SupportedChain, providers.JsonRpcProvider>;
  executionWallets: Map<SupportedChain, Wallet>;
  receiverManager: { getReceiver: (chain: string) => string | null };
  executeFunded: (opportunity: ZeroCapitalOpportunity, funding: GasFundingDecision & Record<string, unknown>) => Promise<ExecutionResult>;
};

interface PreparedPayload {
  receiver: string;
  to: string;
  data: string;
  value: BigNumber;
  minimumReceiverProfitBaseUnits: bigint;
  providerKind: 'balancer_v2' | 'aave_v3' | 'aave_balancer_dual';
}

interface DynamicFundingPrepared {
  kind: FundingLaneKind;
  funding: GasFundingDecision & Record<string, unknown>;
  payload?: PreparedPayload;
  maxFeeTokenAmount?: bigint;
  minimumResidualAfterGasTokenAmount?: bigint;
}

function toUsd(value: bigint, decimals: number, priceUsd: number): number {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return 0;
  const amount = Number(ethers.utils.formatUnits(value.toString(), decimals));
  const usd = amount * priceUsd;
  return Number.isFinite(usd) ? Math.max(0, usd) : 0;
}

function residualFloor(minimumProfitBaseUnits: bigint): bigint {
  const bps = BigInt(Math.max(1, Math.min(5_000, Math.trunc(Number(process.env.ZERO_INITIAL_CAPITAL_MIN_RESIDUAL_BPS || 500)))));
  const relative = (minimumProfitBaseUnits * bps + 9_999n) / 10_000n;
  return relative > 0n ? relative : 1n;
}

function extractProfit(receipt: providers.TransactionReceipt, receiver: string): bigint | null {
  for (const entry of receipt.logs) {
    if (entry.address.toLowerCase() !== receiver.toLowerCase()) continue;
    try {
      const parsed = RECEIVER_EVENT.parseLog(entry);
      if (parsed.name === 'FlashLoanExecuted') return BigInt(parsed.args.profit.toString());
    } catch {
      // Ignore unrelated receiver logs.
    }
  }
  return null;
}

function ambiguousReason(reason: string): boolean {
  return /ambiguous|unknown|timeout|timed out|econnreset|socket|network|connection|temporar/i.test(reason);
}

function classifyExecution(result: ExecutionResult): 'confirmed' | 'definitive_failure' | 'ambiguous' {
  if (result.success === true && result.receiptStatus === 1 && typeof result.txHash === 'string') return 'confirmed';
  if (result.txHash && result.receiptStatus === undefined) return 'ambiguous';
  return ambiguousReason(String(result.error || '')) ? 'ambiguous' : 'definitive_failure';
}

function normalizedOpportunityBackedSettlement(input: {
  opportunity: ZeroCapitalOpportunity;
  txHash: string;
  receipt: providers.TransactionReceipt;
  netProfitBaseUnits: bigint;
  providerFeeTokenBaseUnits: bigint;
  startedAt: number;
}): NormalizedRealizedExecution {
  const priceUsd = Number(input.opportunity.inputAssetUsdPrice || 0);
  return {
    status: 'filled',
    terminal: true,
    settlementConfirmed: true,
    submittedAt: input.startedAt,
    settledAt: Date.now(),
    venueOrRoute: `alchemy_erc20_postop:${input.opportunity.route.map(step => step.protocol).join('->')}`,
    chain: input.opportunity.chain,
    predicted: {
      profitUsd: toUsd(input.opportunity.expectedProfit, input.opportunity.inputTokenDecimals, priceUsd),
      feeUsd: toUsd(input.opportunity.estimatedExecutionCostInInputToken, input.opportunity.inputTokenDecimals, priceUsd),
      slippageBps: input.opportunity.expectedSlippageBps,
    },
    realized: {
      acquisitionCostUsd: null,
      proceedsUsd: null,
      exchangeFeeUsd: null,
      gasUsd: toUsd(input.providerFeeTokenBaseUnits, input.opportunity.inputTokenDecimals, priceUsd),
      gasUsed: input.receipt.gasUsed?.toString() || null,
      effectiveGasPriceWei: input.receipt.effectiveGasPrice?.toString() || null,
      slippageBps: null,
      netProfitUsd: toUsd(input.netProfitBaseUnits, input.opportunity.inputTokenDecimals, priceUsd),
    },
    provenance: [
      'canonical_measured_positive_execution_authority',
      'alchemy_gas_manager',
      'erc4337_user_operation',
      'erc20_postop_opportunity_backed_gas',
      'operator_native_gas_input_zero',
      'receiver_event_gross_profit_verified',
      'operational_wallet_token_delta_net_of_postop_fee_verified',
      'provider_fee_token_delta_measured',
      'synthetic_evidence:false',
    ],
    transactionHash: input.txHash,
    blockNumber: input.receipt.blockNumber,
    receiptStatus: 1,
  };
}

function selectedPayload(
  runtime: DynamicFundingRuntime,
  opportunity: ZeroCapitalOpportunity,
  wallet: Wallet,
): PreparedPayload {
  const now = Date.now();
  const dual = dualFlashLoanProviderSelectionRegistry.get(opportunity.id, now);
  if (dual) {
    if (dual.expiresAt <= now) throw new Error('Dual-provider selection expired before dynamic funding preparation');
    if (dual.receiverCapability.owner.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error('Dual-provider receiver owner does not match operational wallet');
    }
    if (dual.balancerAmount + dual.aaveAmount !== opportunity.flashLoanAmount) {
      throw new Error('Dual-provider principal no longer matches opportunity notional');
    }
    const plan = buildFlashLoanExecutionPlanFromOpportunity(opportunity, {
      receiver: dual.receiver,
      provider: 'balancer_v2',
      profitRecipient: wallet.address,
      nowMs: now,
    });
    const payload = buildDualFlashLoanReceiverPayload({
      chain: plan.chain,
      receiver: dual.receiver,
      loanToken: plan.loanToken,
      balancerAmount: dual.balancerAmount.toString(),
      aaveAmount: dual.aaveAmount.toString(),
      minProfit: plan.minProfit,
      profitRecipient: wallet.address,
      steps: plan.steps,
      gasLimit: Math.max(1_800_000, plan.gasLimit || 0),
    });
    return {
      receiver: dual.receiver,
      to: payload.to,
      data: payload.data,
      value: BigNumber.from(payload.value),
      minimumReceiverProfitBaseUnits: BigInt(plan.minProfit),
      providerKind: 'aave_balancer_dual',
    };
  }

  const selection = flashLoanProviderSelectionRegistry.get(opportunity.id, now);
  if (selection?.provider === 'aave_v3') {
    if (selection.expiresAt <= now) throw new Error('Aave provider selection expired before dynamic funding preparation');
    if (selection.receiverCapability.owner.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error('Aave receiver owner does not match operational wallet');
    }
    const plan = buildFlashLoanExecutionPlanFromOpportunity(opportunity, {
      receiver: selection.receiver,
      provider: 'aave_v3',
      profitRecipient: wallet.address,
      nowMs: now,
    });
    const payload = buildFlashLoanReceiverPayloadFromPlan(plan);
    return {
      receiver: selection.receiver,
      to: payload.to,
      data: payload.data,
      value: BigNumber.from(payload.value),
      minimumReceiverProfitBaseUnits: BigInt(plan.minProfit),
      providerKind: 'aave_v3',
    };
  }

  const receiver = runtime.receiverManager.getReceiver(opportunity.chain);
  if (!receiver) throw new Error(`No verified Balancer receiver is available on ${opportunity.chain}`);
  const plan = buildFlashLoanExecutionPlanFromOpportunity(opportunity, {
    receiver,
    provider: 'balancer_v2',
    profitRecipient: wallet.address,
    nowMs: now,
  });
  const payload = buildFlashLoanReceiverPayloadFromPlan(plan);
  return {
    receiver,
    to: payload.to,
    data: payload.data,
    value: BigNumber.from(payload.value),
    minimumReceiverProfitBaseUnits: BigInt(plan.minProfit),
    providerKind: 'balancer_v2',
  };
}

async function provenSystemNativeGasAvailable(input: {
  opportunity: ZeroCapitalOpportunity;
  wallet: Wallet;
  nativeBalance: bigint;
  reserveFloor: bigint;
}): Promise<boolean> {
  if (input.nativeBalance < input.reserveFloor || input.reserveFloor <= 0n) return false;
  try {
    const { isDatabaseConfigured, pool } = await import('../../../db.js');
    if (!isDatabaseConfigured) return false;
    const scope = `zero-capital:${input.opportunity.chain.toLowerCase()}:${input.opportunity.inputToken.toLowerCase()}:${input.wallet.address.toLowerCase()}`;
    const result = await pool.query(
      `SELECT s.lifecycle, s.internally_generated_balance,
              COALESCE(SUM(CASE WHEN a.state='SETTLED' AND a.reimbursement_verified=true
                                   AND a.destination_chain=$2
                                   AND lower(a.destination_wallet)=lower($3)
                              THEN a.delivered_native_wei::numeric ELSE 0 END),0)::text AS proven_native_wei,
              MAX(CASE WHEN a.state='SETTLED' AND a.reimbursement_verified=true
                         AND a.destination_chain=$2
                         AND lower(a.destination_wallet)=lower($3)
                       THEN a.destination_native_balance_after_wei::numeric ELSE NULL END)::text AS latest_verified_balance_after_wei
         FROM public.zero_capital_capital_state s
         LEFT JOIN public.zero_capital_native_gas_funding_attempts a ON a.scope=s.scope
        WHERE s.scope=$1
        GROUP BY s.lifecycle, s.internally_generated_balance`,
      [scope, input.opportunity.chain, input.wallet.address],
    );
    const row = result.rows[0];
    if (!row || String(row.lifecycle) !== 'SELF_FUNDED') return false;
    if (!(BigInt(String(row.internally_generated_balance || '0')) > 0n)) return false;
    const provenNativeWei = BigInt(String(row.proven_native_wei || '0'));
    const latestVerifiedAfter = row.latest_verified_balance_after_wei === null || row.latest_verified_balance_after_wei === undefined
      ? 0n
      : BigInt(String(row.latest_verified_balance_after_wei));
    if (provenNativeWei <= 0n || latestVerifiedAfter <= 0n) return false;
    // A later unexplained top-up must never become zero-capital authority.
    if (input.nativeBalance > latestVerifiedAfter) return false;
    return true;
  } catch {
    return false;
  }
}

async function executeOpportunityBacked(input: {
  opportunity: ZeroCapitalOpportunity;
  provider: providers.JsonRpcProvider;
  wallet: Wallet;
  prepared: PreparedPayload;
  maxFeeTokenAmount: bigint;
  minimumResidualAfterGasTokenAmount: bigint;
}): Promise<ExecutionResult & Record<string, unknown>> {
  const startedAt = Date.now();
  const token = new Contract(input.opportunity.inputToken, ERC20_BALANCE_ABI, input.provider);
  const starting = BigInt((await token.balanceOf(input.wallet.address)).toString());
  try {
    const network = await input.provider.getNetwork();
    const executed = await getGasSponsorManager().executeOpportunityBacked({
      wallet: input.wallet,
      chainId: network.chainId,
      calls: [{ to: input.prepared.to, data: input.prepared.data, value: input.prepared.value }],
      tokenAddress: input.opportunity.inputToken,
      guaranteedSurplusBeforeGasTokenAmount: input.prepared.minimumReceiverProfitBaseUnits,
      minimumResidualAfterGasTokenAmount: input.minimumResidualAfterGasTokenAmount,
      timeoutMs: Math.max(10_000, Number(process.env.ZERO_CAPITAL_SPONSORED_TX_TIMEOUT_MS || 60_000)),
    });
    let receipt = await input.provider.getTransactionReceipt(executed.transactionHash);
    if (!receipt) receipt = await input.provider.waitForTransaction(executed.transactionHash, 1, 15_000);
    if (!receipt || receipt.status !== 1) {
      return { success: false, txHash: executed.transactionHash, error: 'Opportunity-backed transaction was not confirmed successfully' };
    }

    const receiverGrossProfit = extractProfit(receipt, input.prepared.receiver);
    if (receiverGrossProfit === null || receiverGrossProfit <= 0n) {
      return { success: false, txHash: executed.transactionHash, receiptStatus: 1, error: 'No positive verified FlashLoanExecuted profit was emitted' };
    }
    const ending = BigInt((await token.balanceOf(input.wallet.address)).toString());
    const netDelta = ending - starting;
    if (netDelta <= 0n) {
      return { success: false, txHash: executed.transactionHash, receiptStatus: 1, error: 'Opportunity-backed settlement left no positive operational-wallet token delta' };
    }
    if (receiverGrossProfit < netDelta) {
      return { success: false, txHash: executed.transactionHash, receiptStatus: 1, error: 'Operational-wallet token delta exceeds verified receiver gross profit' };
    }
    const providerFeeTokenBaseUnits = receiverGrossProfit - netDelta;
    if (providerFeeTokenBaseUnits > executed.maxFeeTokenAmount || providerFeeTokenBaseUnits > input.maxFeeTokenAmount) {
      return { success: false, txHash: executed.transactionHash, receiptStatus: 1, error: 'Measured postOp fee exceeds the pre-authorized opportunity-backed gas ceiling' };
    }
    if (netDelta < input.minimumResidualAfterGasTokenAmount) {
      return { success: false, txHash: executed.transactionHash, receiptStatus: 1, error: 'Measured postOp settlement violated the required residual-profit floor' };
    }

    const gasUsed = BigInt(receipt.gasUsed.toString());
    const effectiveGasPriceWei = receipt.effectiveGasPrice ? BigInt(receipt.effectiveGasPrice.toString()) : 0n;
    return {
      success: true,
      txHash: executed.transactionHash,
      normalized: normalizedOpportunityBackedSettlement({
        opportunity: input.opportunity,
        txHash: executed.transactionHash,
        receipt,
        netProfitBaseUnits: netDelta,
        providerFeeTokenBaseUnits,
        startedAt,
      }),
      profit: netDelta,
      profitVerified: true,
      gasUsed,
      effectiveGasPriceWei,
      receiptStatus: 1,
      nativeFeeWei: 0n,
      zeroMonetaryGasVerified: true,
      zeroOperatorNativeGasInputVerified: true,
      fundingMode: 'opportunity_erc20_postop',
      providerFeeTokenAddress: input.opportunity.inputToken,
      providerFeeTokenBaseUnits,
      providerFeeUsd: toUsd(providerFeeTokenBaseUnits, input.opportunity.inputTokenDecimals, Number(input.opportunity.inputAssetUsdPrice || 0)),
      receiverGrossProfitBaseUnits: receiverGrossProfit,
      profitRecipient: input.wallet.address,
      latencyMs: Date.now() - startedAt,
      blockNumber: receipt.blockNumber,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startedAt,
      zeroOperatorNativeGasInputVerified: true,
      fundingMode: 'opportunity_erc20_postop',
    };
  }
}

export function ensureZeroInitialCapitalDynamicExecutionWiring(): void {
  const runtime = zeroCapitalEngine as unknown as DynamicFundingRuntime;
  if (installed.has(runtime)) return;
  installed.add(runtime);

  const delegate = runtime.executeFunded.bind(runtime);
  const orchestrator = getZeroInitialCapitalDynamicOrchestrator();
  runtime.executeFunded = async (opportunity, passedFunding): Promise<ExecutionResult> => {
    const provider = runtime.providers.get(opportunity.chain);
    const wallet = runtime.executionWallets.get(opportunity.chain);
    if (!provider || !wallet) return { success: false, error: `No provider/execution wallet for ${opportunity.chain}` };

    const priceUsd = Number(opportunity.inputAssetUsdPrice || 0);
    const lanes: Array<ZeroInitialCapitalLane<ZeroCapitalOpportunity, DynamicFundingPrepared, ExecutionResult>> = [];
    const sponsor = getGasSponsorManager();

    if (sponsor.getReadiness().ready) {
      lanes.push({
        id: `gas:${opportunity.chain}:opportunity-erc20-postop`,
        provider: 'alchemy-gas-manager',
        priority: 20,
        redundancyDepth: 0,
        supports: () => /^0x[a-fA-F0-9]{40}$/.test(opportunity.inputToken),
        prepare: async () => {
          const payload = selectedPayload(runtime, opportunity, wallet);
          if (payload.minimumReceiverProfitBaseUnits <= 1n) return { status: 'rejected', reason: 'Receiver minimum profit is too small for opportunity-backed gas' };
          const network = await provider.getNetwork();
          const quote = await sponsor.quoteOpportunityBackedGas({
            wallet,
            chainId: network.chainId,
            calls: [{ to: payload.to, data: payload.data, value: payload.value }],
            tokenAddress: opportunity.inputToken,
          });
          const floor = residualFloor(payload.minimumReceiverProfitBaseUnits);
          if (quote.maxTokenAmount + floor >= payload.minimumReceiverProfitBaseUnits) {
            return { status: 'rejected', reason: 'Opportunity-backed gas quote consumes the required residual-profit floor' };
          }
          const residual = payload.minimumReceiverProfitBaseUnits - quote.maxTokenAmount;
          const candidate: ZeroInitialCapitalPreparedCandidate<DynamicFundingPrepared> = {
            laneId: `gas:${opportunity.chain}:opportunity-erc20-postop`,
            provider: 'alchemy-gas-manager',
            prepared: {
              kind: 'opportunity_erc20_postop',
              funding: {
                chain: opportunity.chain,
                mode: 'sponsored',
                nativeBalance: 0n,
                reserveFloor: 0n,
                reason: 'Gas is repaid from execution-created ERC-20 profit in postOp; operator native-gas input is zero',
                operatorNativeGasInputRequired: false,
                bootstrapEligible: true,
              },
              payload,
              maxFeeTokenAmount: quote.maxTokenAmount,
              minimumResidualAfterGasTokenAmount: floor,
            },
            expiresAt: opportunity.expiresAt,
            estimatedAllInCostUsd: toUsd(quote.maxTokenAmount, opportunity.inputTokenDecimals, priceUsd),
            guaranteedResidualProfitUsd: toUsd(residual, opportunity.inputTokenDecimals, priceUsd),
            scoreBias: 8,
          };
          return { status: 'available', candidate };
        },
        execute: async candidate => {
          const prepared = candidate.prepared;
          if (!prepared.payload || prepared.maxFeeTokenAmount === undefined || prepared.minimumResidualAfterGasTokenAmount === undefined) {
            return { status: 'definitive_failure', reason: 'Opportunity-backed lane lost prepared payment evidence' };
          }
          const result = await executeOpportunityBacked({
            opportunity,
            provider,
            wallet,
            prepared: prepared.payload,
            maxFeeTokenAmount: prepared.maxFeeTokenAmount,
            minimumResidualAfterGasTokenAmount: prepared.minimumResidualAfterGasTokenAmount,
          });
          const status = classifyExecution(result);
          return {
            status,
            result,
            reason: result.error,
            realizedCostUsd: Number((result as any).providerFeeUsd || 0),
            residualProfitUsd: result.profit ? toUsd(result.profit, opportunity.inputTokenDecimals, priceUsd) : undefined,
          };
        },
      });

      lanes.push({
        id: `gas:${opportunity.chain}:external-sponsor`,
        provider: 'alchemy-gas-manager',
        priority: 10,
        redundancyDepth: 1,
        supports: () => true,
        prepare: async () => {
          const payload = selectedPayload(runtime, opportunity, wallet);
          const candidate: ZeroInitialCapitalPreparedCandidate<DynamicFundingPrepared> = {
            laneId: `gas:${opportunity.chain}:external-sponsor`,
            provider: 'alchemy-gas-manager',
            prepared: {
              kind: 'external_sponsor',
              funding: {
                chain: opportunity.chain,
                mode: 'sponsored',
                nativeBalance: 0n,
                reserveFloor: 0n,
                reason: 'External sponsor fronts native gas; operator native-gas input is zero',
                operatorNativeGasInputRequired: false,
                bootstrapEligible: true,
              },
            },
            expiresAt: opportunity.expiresAt,
            estimatedAllInCostUsd: 0,
            guaranteedResidualProfitUsd: toUsd(payload.minimumReceiverProfitBaseUnits, opportunity.inputTokenDecimals, priceUsd),
          };
          return { status: 'available', candidate };
        },
        execute: async candidate => {
          const result = await delegate(opportunity, candidate.prepared.funding);
          const status = classifyExecution(result);
          return {
            status,
            result,
            reason: result.error,
            residualProfitUsd: result.profit ? toUsd(result.profit, opportunity.inputTokenDecimals, priceUsd) : undefined,
          };
        },
      });
    }

    if (passedFunding.mode === 'native') {
      const nativeProven = await provenSystemNativeGasAvailable({
        opportunity,
        wallet,
        nativeBalance: passedFunding.nativeBalance,
        reserveFloor: passedFunding.reserveFloor,
      });
      if (nativeProven) {
        lanes.push({
          id: `gas:${opportunity.chain}:system-native`,
          provider: 'system-generated-native-reserve',
          priority: 0,
          redundancyDepth: 2,
          supports: () => true,
          prepare: async () => ({
            status: 'available',
            candidate: {
              laneId: `gas:${opportunity.chain}:system-native`,
              provider: 'system-generated-native-reserve',
              prepared: {
                kind: 'system_native',
                funding: {
                  ...passedFunding,
                  reason: 'Native gas is permitted only from receipt-backed system-generated native funding provenance',
                  operatorNativeGasInputRequired: false,
                  bootstrapEligible: false,
                },
              },
              expiresAt: opportunity.expiresAt,
              estimatedAllInCostUsd: toUsd(opportunity.estimatedGasCostInInputToken || 0n, opportunity.inputTokenDecimals, priceUsd),
              guaranteedResidualProfitUsd: toUsd(opportunity.expectedProfit, opportunity.inputTokenDecimals, priceUsd),
              scoreBias: -5,
            },
          }),
          execute: async candidate => {
            const result = await delegate(opportunity, candidate.prepared.funding);
            const status = classifyExecution(result);
            return {
              status,
              result,
              reason: result.error,
              residualProfitUsd: result.profit ? toUsd(result.profit, opportunity.inputTokenDecimals, priceUsd) : undefined,
            };
          },
        });
      }
    }

    const run = await orchestrator.run<ExecutionResult>({
      opportunityId: opportunity.id,
      chain: opportunity.chain,
      strategy: opportunity.type,
      expiresAt: opportunity.expiresAt,
      context: opportunity,
      lanes,
      maxRetriesPerLane: Math.max(0, Math.min(4, Number(process.env.ZERO_INITIAL_CAPITAL_RETRIES_PER_LANE || 1))),
      retryBaseDelayMs: Math.max(25, Math.min(2_000, Number(process.env.ZERO_INITIAL_CAPITAL_RETRY_BASE_MS || 75))),
      freshnessCheck: async () => ({
        fresh: Date.now() < opportunity.expiresAt,
        reason: Date.now() < opportunity.expiresAt ? undefined : 'Opportunity expired before dynamic funding submission',
      }),
      canonicalEconomicsCheck: async candidate => {
        if (!(candidate.guaranteedResidualProfitUsd > 0)) {
          return { approved: false, reason: 'Dynamic funding candidate has no positive guaranteed residual profit' };
        }
        if (Date.now() >= candidate.expiresAt) return { approved: false, reason: 'Dynamic funding candidate expired before submission' };
        return { approved: true };
      },
    });

    if (run.status === 'confirmed' && run.result) return run.result;
    if (run.status === 'ambiguous') {
      return {
        success: false,
        error: `ZERO_INITIAL_CAPITAL_SUBMISSION_AMBIGUOUS:${run.provider || run.laneId || 'unknown'}:${run.reason || 'reconciliation required'}`,
      };
    }
    return {
      success: false,
      error: `ZERO_INITIAL_CAPITAL_FUNDING_${run.status.toUpperCase()}:${run.reason || 'no safe funding lane confirmed'}`,
    };
  };

  logger.info('[ZeroInitialCapital] Dynamic live execution funding wiring installed', {
    component: 'ZeroInitialCapitalDynamicExecutionWiring',
    liveOrchestrator: true,
    parallelPreparation: true,
    serializedSubmission: true,
    opportunityBackedErc20PostOp: true,
    externalSponsorLane: true,
    nativeLaneRequiresSystemGeneratedProvenance: true,
    unexplainedWalletNativeBalanceAuthority: false,
    operatorNativeGasInputRequired: false,
    profitRecipient: 'operational_wallet_before_rainbow_treasury_split',
    ambiguousSubmissionFallbackAllowed: false,
    globalHaltAuthority: false,
  });
}
