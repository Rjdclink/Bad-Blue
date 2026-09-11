import { Contract, BigNumber, ethers } from 'ethers';
import logger from '../../../logger.js';
import {
  classifyRpcOperationError,
  multiProviderRpcManager,
  type SupportedChain as RpcSupportedChain,
} from '../api/blockchain-providers.js';
import { resolveAaveV3Pool } from '../execution/adapters/flash-loan-provider-economics.js';
import type { SupportedExecutionChain } from '../execution/adapters/onchain-payload-builder.js';
import {
  prepareAaveLiquidation,
  type AaveLiquidationPreparation,
  type ExecutableAaveLiquidationChain,
} from '../execution/aave-liquidation-atomic-executor.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';

const AAVE_POOL_ABI = [
  'event Borrow(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint8 interestRateMode,uint256 borrowRate,uint16 indexed referralCode)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase,uint256 totalDebtBase,uint256 availableBorrowsBase,uint256 currentLiquidationThreshold,uint256 ltv,uint256 healthFactor)',
];

const DISCOVERY_CHAINS: RpcSupportedChain[] = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc'];
const EXACT_EXECUTION_CHAINS = new Set<ExecutableAaveLiquidationChain>(['ethereum', 'polygon']);
const borrowerUniverse = new Map<RpcSupportedChain, Map<string, number>>();
const borrowerHealthCheckedAt = new Map<RpcSupportedChain, Map<string, number>>();
const borrowerBackfillCursor = new Map<RpcSupportedChain, number>();

type LiquidatableObservation = {
  candidate: MeasuredCandidate;
  borrower: string;
  healthFactor: number;
  totalDebtBase: BigNumber;
};

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function liquidationHydrationConcurrency(): number {
  return boundedInteger(process.env.CRYPTOCRAWL_LIQUIDATION_HYDRATION_CONCURRENCY, 4, 1, 12);
}

async function runBounded<T, R>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const count = Math.max(1, Math.min(items.length, Math.floor(concurrency)));
  await Promise.all(Array.from({ length: count }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

function rememberBorrower(chain: RpcSupportedChain, address: string, blockNumber: number): void {
  if (!ethers.utils.isAddress(address)) return;
  const normalized = ethers.utils.getAddress(address);
  const universe = borrowerUniverse.get(chain) || new Map<string, number>();
  universe.set(normalized, Math.max(blockNumber, universe.get(normalized) || 0));
  const maxUniverse = boundedInteger(process.env.CRYPTOCRAWL_LIQUIDATION_BORROWER_UNIVERSE_MAX, 4096, 64, 20_000);
  if (universe.size > maxUniverse) {
    const oldest = [...universe.entries()].sort((left, right) => left[1] - right[1]);
    const checked = borrowerHealthCheckedAt.get(chain);
    for (let index = 0; index < universe.size - maxUniverse; index++) {
      universe.delete(oldest[index][0]);
      checked?.delete(oldest[index][0]);
    }
  }
  borrowerUniverse.set(chain, universe);
}

function selectBorrowersForHealthCheck(chain: RpcSupportedChain, maxChecks: number): string[] {
  const universe = borrowerUniverse.get(chain) || new Map<string, number>();
  const checked = borrowerHealthCheckedAt.get(chain) || new Map<string, number>();
  borrowerHealthCheckedAt.set(chain, checked);
  return [...universe.entries()]
    .sort((left, right) => {
      const leftCheckedAt = checked.get(left[0]) || 0;
      const rightCheckedAt = checked.get(right[0]) || 0;
      if (leftCheckedAt !== rightCheckedAt) return leftCheckedAt - rightCheckedAt;
      return right[1] - left[1];
    })
    .slice(0, maxChecks)
    .map(([address]) => address);
}

function isAdaptiveLogRangeFailure(error: unknown): boolean {
  if (classifyRpcOperationError(error, 'logs') !== 'provider_capability') return false;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();
  return [
    'block range',
    'range limit',
    'query returned more than',
    'too many results',
    'response size exceeded',
    'log response size exceeded',
  ].some(fragment => message.includes(fragment));
}

async function queryBorrowEvents(input: {
  chain: RpcSupportedChain;
  pool: string;
  fromBlock: number;
  toBlock: number;
}): Promise<ethers.Event[]> {
  const { result } = await multiProviderRpcManager.execute(input.chain, 'logs', async provider => {
    const contract = new Contract(input.pool, AAVE_POOL_ABI, provider);
    return contract.queryFilter(contract.filters.Borrow(), input.fromBlock, input.toBlock);
  });
  return result;
}

async function collectBorrowEvents(input: {
  chain: RpcSupportedChain;
  pool: string;
  fromBlock: number;
  toBlock: number;
}): Promise<number> {
  if (input.toBlock < input.fromBlock) return 0;
  const minimumWindow = boundedInteger(process.env.CRYPTOCRAWL_LIQUIDATION_LOG_MIN_WINDOW_BLOCKS, 1, 1, 1_000);
  const pending: Array<[number, number]> = [[input.fromBlock, input.toBlock]];
  let collected = 0;

  while (pending.length > 0) {
    const [fromBlock, toBlock] = pending.shift()!;
    try {
      const events = await queryBorrowEvents({ chain: input.chain, pool: input.pool, fromBlock, toBlock });
      for (const event of events) {
        const borrower = String(event.args?.onBehalfOf || event.args?.user || '');
        rememberBorrower(input.chain, borrower, event.blockNumber);
      }
      collected += events.length;
    } catch (error) {
      const windowSize = toBlock - fromBlock + 1;
      if (!isAdaptiveLogRangeFailure(error) || windowSize <= minimumWindow) throw error;
      const midpoint = Math.floor((fromBlock + toBlock) / 2);
      pending.unshift([fromBlock, midpoint], [midpoint + 1, toBlock]);
    }
  }

  return collected;
}

function healthFactorNumber(raw: BigNumber): number {
  const value = Number(ethers.utils.formatUnits(raw, 18));
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function baseCandidate(input: {
  chain: RpcSupportedChain;
  pool: string;
  borrower: string;
  observedAt: number;
  expiresAt: number;
  healthFactor: number;
  totalCollateralBase: BigNumber;
  totalDebtBase: BigNumber;
}): MeasuredCandidate {
  const executionReviewed = EXACT_EXECUTION_CHAINS.has(input.chain as ExecutableAaveLiquidationChain);
  return measuredCandidateRegistry.record({
    opportunityId: `aave-liquidation:${input.chain}:${input.borrower}:${input.observedAt}`,
    topology: 'LIQUIDATION',
    observedAt: input.observedAt,
    expiresAt: input.expiresAt,
    status: 'enriched',
    assets: ['AAVE_V3_POSITION'],
    venues: ['aave_v3'],
    chains: [input.chain],
    rawQuotes: [{
      source: 'aave_v3_pool',
      venue: 'aave_v3',
      chain: input.chain,
      observedAt: input.observedAt,
      executable: false,
      provenance: [
        `borrower:${input.borrower}`,
        `health_factor:${input.healthFactor.toFixed(8)}`,
        `total_collateral_base:${input.totalCollateralBase.toString()}`,
        `total_debt_base:${input.totalDebtBase.toString()}`,
        `pool:${input.pool}`,
      ],
    }],
    depth: {
      status: 'measured',
      detail: `Aave V3 getUserAccountData measured healthFactor=${input.healthFactor.toFixed(8)}, totalDebtBase=${input.totalDebtBase.toString()}, totalCollateralBase=${input.totalCollateralBase.toString()}`,
    },
    economics: {
      grossProfitUsd: null,
      deterministicNetProfitUsd: null,
      feeUsd: null,
      gasUsd: null,
      bridgeUsd: 0,
      expectedSlippageBps: null,
      expectedPriceImpactBps: null,
    },
    quoteAgeMs: 0,
    executableCapability: false,
    executionCapabilityReason: executionReviewed
      ? 'Position is currently measured liquidatable and receives exact same-block reserve/protocol-rule/oracle/flash-liquidity/unwind/gas hydration in this discovery cycle; eth_call is advisory only'
      : 'Position is currently measured liquidatable, but this chain remains discovery-only until exact pre-trade gas accounting includes every chain-specific fee component',
    missingInformation: executionReviewed ? [
      'required:liquidation_debt_reserve_and_amount',
      'required:liquidation_collateral_reserve_and_amount',
      'required:liquidation_bonus_and_protocol_fee',
      'required:liquidation_close_factor_total_debt_thresholds_and_dust',
      'required:liquidation_reserve_pause_grace_and_emode_state',
      'required:liquidation_oracle_values',
      'required:measured_flash_loan_provider_liquidity_and_fee',
      'required:liquidation_collateral_unwind_quote',
      'required:liquidation_gas_cost',
      'required:atomic_liquidation_payload_adapter',
    ] : [
      'required:chain_specific_complete_pretrade_gas_accounting',
      'required:liquidation_debt_reserve_and_amount',
      'required:liquidation_collateral_reserve_and_amount',
      'required:liquidation_bonus_and_protocol_fee',
      'required:liquidation_oracle_values',
      'required:liquidation_collateral_unwind_quote',
    ],
    provenance: [
      'aave_v3_borrow_event_universe',
      'aave_v3_progressive_historical_borrow_backfill',
      'aave_v3_rotating_health_factor_coverage',
      'aave_v3_getUserAccountData',
      'health_factor_below_one',
      `exact_execution_chain_reviewed:${executionReviewed}`,
      ...(executionReviewed ? ['liquidation_first_pass:full_hydration_same_cycle'] : []),
      'liquidation_eth_call_simulation_execution_authority:false',
      'liquidation_profitability:not_assumed',
      'synthetic_evidence:false',
    ],
  });
}

function preparedCandidate(current: MeasuredCandidate, prepared: AaveLiquidationPreparation): MeasuredCandidate {
  return measuredCandidateRegistry.record({
    opportunityId: current.opportunityId,
    topology: current.topology,
    observedAt: current.observedAt,
    expiresAt: Math.min(current.expiresAt, prepared.expiresAt),
    status: 'eligible',
    assets: [prepared.debtSymbol, prepared.collateralSymbol],
    venues: ['aave_v3', '0x'],
    chains: current.chains,
    rawQuotes: [
      ...current.rawQuotes,
      {
        source: '0x',
        venue: '0x',
        chain: prepared.chain,
        symbol: `${prepared.collateralSymbol}->${prepared.debtSymbol}`,
        observedAt: prepared.unwindQuote.observedAt,
        amountIn: prepared.collateralSellAmount,
        amountOut: prepared.unwindBuyAmount,
        executable: true,
        provenance: ['0x:v2_allowance_holder_firm_liquidation_unwind'],
      },
    ],
    depth: {
      status: 'measured',
      detail: 'Aave same-block reserve/debt/collateral state, exact close-factor/dust/eMode/pause/grace rules, live oracle/configuration, measured Aave flash liquidity/fee, firm 0x collateral unwind, receiver permissions and exact gas are current; eth_call is advisory telemetry',
    },
    economics: {
      grossProfitUsd: prepared.deterministicNetProfitUsd + prepared.expectedFlashFeeUsd + prepared.expectedGasUsd,
      deterministicNetProfitUsd: prepared.deterministicNetProfitUsd,
      // Aave flash premium is not an exchange fee. It is represented exclusively
      // by flashLoanFeeBps below so canonical BPS attribution counts it once.
      feeUsd: 0,
      gasUsd: prepared.expectedGasUsd,
      bridgeUsd: 0,
      expectedSlippageBps: prepared.expectedUnwindCostUsd / prepared.notionalUsd * 10_000,
      expectedPriceImpactBps: null,
      notionalUsd: prepared.notionalUsd,
      grossProfitBps: prepared.grossProfitBps,
      flashLoanFeeBps: prepared.flashLoanFeeBps,
      gasCostBps: prepared.gasCostBps,
      allInCostBps: prepared.allInCostBps,
      breakEvenBps: prepared.allInCostBps,
      netProfitBps: prepared.netProfitBps,
      bpsToBreakEven: 0,
    },
    quoteAgeMs: Math.max(0, Date.now() - prepared.unwindQuote.observedAt),
    executableCapability: true,
    executionCapabilityReason: 'Current same-block Aave protocol facts, exact protocol-valid sizing, measured flash liquidity/fee, firm 0x unwind, verified receiver permissions and bounded live gas economics prove positive deterministic all-in net profit; simulation remains advisory only',
    missingInformation: [],
    provenance: [
      ...current.provenance,
      ...prepared.provenance,
      `liquidation_debt_asset:${prepared.debtAsset}`,
      `liquidation_collateral_asset:${prepared.collateralAsset}`,
      `liquidation_debt_to_cover:${prepared.debtToCover}`,
      `liquidation_simulation_advisory_passed:${prepared.simulated}`,
      'liquidation_simulation_veto_authority:false',
      'liquidation_first_pass:full_hydration_completed',
      'flash_premium_attribution:flashLoanFeeBps_only',
      'canonical_scheduler_dispatch_required:true',
      'synthetic_evidence:false',
    ],
  });
}

async function inspectBorrower(input: {
  chain: RpcSupportedChain;
  pool: string;
  contract: Contract;
  borrower: string;
  ttlMs: number;
}): Promise<LiquidatableObservation | null> {
  const observedAt = Date.now();
  const account = await input.contract.getUserAccountData(input.borrower) as [BigNumber, BigNumber, BigNumber, BigNumber, BigNumber, BigNumber];
  const totalCollateralBase = BigNumber.from(account[0]);
  const totalDebtBase = BigNumber.from(account[1]);
  const healthFactorRaw = BigNumber.from(account[5]);
  const healthFactor = healthFactorNumber(healthFactorRaw);
  if (!(healthFactor < 1) || totalDebtBase.lte(0) || totalCollateralBase.lte(0)) return null;
  const candidate = baseCandidate({
    chain: input.chain,
    pool: input.pool,
    borrower: input.borrower,
    observedAt,
    expiresAt: observedAt + input.ttlMs,
    healthFactor,
    totalCollateralBase,
    totalDebtBase,
  });
  return { candidate, borrower: input.borrower, healthFactor, totalDebtBase };
}

async function discoverChainLiquidations(chain: RpcSupportedChain): Promise<MeasuredCandidate[]> {
  const pool = resolveAaveV3Pool(chain as SupportedExecutionChain);
  if (!pool) return [];
  const managed = await multiProviderRpcManager.getProvider(chain, 'contract_calls');
  const contract = new Contract(pool, AAVE_POOL_ABI, managed.http);
  const { result: latestBlock } = await multiProviderRpcManager.execute(chain, 'blocks', provider => provider.getBlockNumber());
  const targetBorrowers = boundedInteger(process.env.CRYPTOCRAWL_LIQUIDATION_BORROWER_TARGET, 128, 8, 2048);
  const universe = borrowerUniverse.get(chain) || new Map<string, number>();
  const baseLookback = boundedInteger(process.env.CRYPTOCRAWL_LIQUIDATION_LOOKBACK_BLOCKS, 5_000, 100, 100_000);
  const maxLookback = boundedInteger(process.env.CRYPTOCRAWL_LIQUIDATION_MAX_LOOKBACK_BLOCKS, 100_000, baseLookback, 1_000_000);
  const coverageMultiplier = universe.size === 0 ? 4 : universe.size < targetBorrowers ? 2 : 1;
  const lookback = Math.min(maxLookback, baseLookback * coverageMultiplier);
  const fromBlock = Math.max(0, latestBlock - lookback);

  await collectBorrowEvents({ chain, pool, fromBlock, toBlock: latestBlock });

  // Health factor can cross below one because collateral/oracle values change long
  // after the latest Borrow event. Walk older Borrow history in bounded windows so
  // long-lived positions are eventually represented instead of treating a recent
  // event window as the complete active borrower set.
  const historicalLookback = boundedInteger(
    process.env.CRYPTOCRAWL_LIQUIDATION_HISTORICAL_LOOKBACK_BLOCKS,
    2_000_000,
    maxLookback,
    20_000_000,
  );
  const backfillWindow = boundedInteger(
    process.env.CRYPTOCRAWL_LIQUIDATION_BACKFILL_BLOCKS_PER_SCAN,
    10_000,
    100,
    100_000,
  );
  const oldestAllowedBlock = Math.max(0, latestBlock - historicalLookback);
  const priorCursor = Math.min(borrowerBackfillCursor.get(chain) ?? fromBlock, fromBlock);
  if (priorCursor > oldestAllowedBlock) {
    const backfillTo = priorCursor - 1;
    const backfillFrom = Math.max(oldestAllowedBlock, backfillTo - backfillWindow + 1);
    try {
      await collectBorrowEvents({ chain, pool, fromBlock: backfillFrom, toBlock: backfillTo });
      borrowerBackfillCursor.set(chain, backfillFrom);
    } catch (error) {
      logger.debug('[LiquidationDiscovery] Historical borrower backfill deferred', {
        component: 'LiquidationOpportunityGenerator',
        chain,
        fromBlock: backfillFrom,
        toBlock: backfillTo,
        error: error instanceof Error ? error.message : String(error),
        recentBorrowerScanContinued: true,
        executionAuthority: false,
      });
    }
  }

  const maxChecks = boundedInteger(process.env.CRYPTOCRAWL_LIQUIDATION_HEALTH_CHECKS_PER_CYCLE, 64, 4, 512);
  const borrowers = selectBorrowersForHealthCheck(chain, maxChecks);
  const ttlMs = boundedInteger(process.env.CRYPTOCRAWL_LIQUIDATION_CANDIDATE_TTL_MS, 15_000, 1_000, 60_000);
  const settled = await Promise.allSettled(borrowers.map(borrower => inspectBorrower({
    chain,
    pool,
    contract,
    borrower,
    ttlMs,
  })));
  const checked = borrowerHealthCheckedAt.get(chain) || new Map<string, number>();
  const checkedAt = Date.now();
  for (const borrower of borrowers) checked.set(borrower, checkedAt);
  borrowerHealthCheckedAt.set(chain, checked);
  const observations = settled.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);

  if (!EXACT_EXECUTION_CHAINS.has(chain as ExecutableAaveLiquidationChain) || observations.length === 0) {
    return observations.map(observation => observation.candidate);
  }

  // Every liquidatable position on a reviewed execution chain receives same-cycle
  // hard-fact hydration. Concurrency controls provider pressure; it never drops a
  // viable position. eth_call may run for telemetry but is not execution evidence.
  const prioritized = [...observations].sort((left, right) => {
    if (left.healthFactor !== right.healthFactor) return left.healthFactor - right.healthFactor;
    if (left.totalDebtBase.eq(right.totalDebtBase)) return 0;
    return right.totalDebtBase.gt(left.totalDebtBase) ? 1 : -1;
  });

  await runBounded(prioritized, liquidationHydrationConcurrency(), async observation => {
    try {
      const prepared = await prepareAaveLiquidation({
        opportunityId: observation.candidate.opportunityId,
        chain: chain as ExecutableAaveLiquidationChain,
        borrower: observation.borrower,
        expiresAt: observation.candidate.expiresAt,
      });
      observation.candidate = preparedCandidate(observation.candidate, prepared);
    } catch {
      // The base candidate remains explicit with required hard-evidence facts. A
      // same-cycle acquisition failure cannot silently disappear or gain synthetic
      // execution authority, but advisory simulation is never added as a blocker.
    }
    return observation.candidate;
  });

  return observations.map(observation => observation.candidate);
}

export async function discoverMeasuredLiquidationCandidates(): Promise<MeasuredCandidate[]> {
  const configured = DISCOVERY_CHAINS.filter(chain => resolveAaveV3Pool(chain as SupportedExecutionChain) !== null);
  if (configured.length === 0) return [];
  await multiProviderRpcManager.initialize(configured);
  const settled = await Promise.allSettled(configured.map(chain => discoverChainLiquidations(chain)));
  return settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}
