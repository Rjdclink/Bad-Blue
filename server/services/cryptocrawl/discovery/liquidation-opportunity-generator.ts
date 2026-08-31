import { Contract, BigNumber, ethers } from 'ethers';
import {
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

function rememberBorrower(chain: RpcSupportedChain, address: string, blockNumber: number): void {
  if (!ethers.utils.isAddress(address)) return;
  const normalized = ethers.utils.getAddress(address);
  const universe = borrowerUniverse.get(chain) || new Map<string, number>();
  universe.set(normalized, Math.max(blockNumber, universe.get(normalized) || 0));
  const maxUniverse = boundedInteger(process.env.CRYPTOCRAWL_LIQUIDATION_BORROWER_UNIVERSE_MAX, 2048, 64, 20_000);
  if (universe.size > maxUniverse) {
    const oldest = [...universe.entries()].sort((left, right) => left[1] - right[1]);
    for (let index = 0; index < universe.size - maxUniverse; index++) universe.delete(oldest[index][0]);
  }
  borrowerUniverse.set(chain, universe);
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
      ? 'Position is currently measured liquidatable; exact reserve/oracle/flash-liquidity/unwind/gas/atomic-simulation hydration is required before execution'
      : 'Position is currently measured liquidatable, but this chain remains discovery-only until exact pre-trade gas accounting includes every chain-specific fee component',
    missingInformation: executionReviewed ? [
      'liquidation_debt_reserve_and_amount',
      'liquidation_collateral_reserve_and_amount',
      'liquidation_bonus_and_protocol_fee',
      'liquidation_close_factor',
      'liquidation_oracle_values',
      'measured_flash_loan_provider_liquidity_and_fee',
      'liquidation_collateral_unwind_quote',
      'liquidation_gas_cost',
      'atomic_liquidation_payload_adapter',
      'exact_liquidation_simulation',
    ] : [
      'chain_specific_complete_pretrade_gas_accounting',
      'liquidation_debt_reserve_and_amount',
      'liquidation_collateral_reserve_and_amount',
      'liquidation_bonus_and_protocol_fee',
      'liquidation_oracle_values',
      'liquidation_collateral_unwind_quote',
    ],
    provenance: [
      'aave_v3_borrow_event_universe',
      'aave_v3_getUserAccountData',
      'health_factor_below_one',
      `exact_execution_chain_reviewed:${executionReviewed}`,
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
      detail: 'Aave user reserve/debt/collateral state, live oracle/configuration, measured Aave flash liquidity/fee, firm 0x collateral unwind, existing receiver permissions, full eth_call and exact gas estimate are current',
    },
    economics: {
      grossProfitUsd: prepared.deterministicNetProfitUsd + prepared.expectedFlashFeeUsd + prepared.expectedGasUsd,
      deterministicNetProfitUsd: prepared.deterministicNetProfitUsd,
      feeUsd: prepared.expectedFlashFeeUsd,
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
    executionCapabilityReason: 'Current Aave reserve/oracle/configuration evidence, conservative close-factor sizing, measured flash liquidity/fee, firm 0x unwind, verified receiver permissions, exact atomic simulation and bounded live gas economics prove positive deterministic all-in net profit',
    missingInformation: [],
    provenance: [
      ...current.provenance,
      ...prepared.provenance,
      `liquidation_debt_asset:${prepared.debtAsset}`,
      `liquidation_collateral_asset:${prepared.collateralAsset}`,
      `liquidation_debt_to_cover:${prepared.debtToCover}`,
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
  const managed = await multiProviderRpcManager.getProvider(chain, 'logs');
  const contract = new Contract(pool, AAVE_POOL_ABI, managed.http);
  const latestBlock = await managed.http.getBlockNumber();
  const targetBorrowers = boundedInteger(process.env.CRYPTOCRAWL_LIQUIDATION_BORROWER_TARGET, 128, 8, 2048);
  const universe = borrowerUniverse.get(chain) || new Map<string, number>();
  const baseLookback = boundedInteger(process.env.CRYPTOCRAWL_LIQUIDATION_LOOKBACK_BLOCKS, 5_000, 100, 100_000);
  const maxLookback = boundedInteger(process.env.CRYPTOCRAWL_LIQUIDATION_MAX_LOOKBACK_BLOCKS, 100_000, baseLookback, 1_000_000);
  const coverageMultiplier = universe.size === 0 ? 4 : universe.size < targetBorrowers ? 2 : 1;
  const lookback = Math.min(maxLookback, baseLookback * coverageMultiplier);
  const fromBlock = Math.max(0, latestBlock - lookback);

  const events = await contract.queryFilter(contract.filters.Borrow(), fromBlock, latestBlock);
  for (const event of events) {
    const borrower = String(event.args?.onBehalfOf || event.args?.user || '');
    rememberBorrower(chain, borrower, event.blockNumber);
  }

  const currentUniverse = borrowerUniverse.get(chain) || new Map<string, number>();
  const maxChecks = boundedInteger(process.env.CRYPTOCRAWL_LIQUIDATION_HEALTH_CHECKS_PER_CYCLE, 64, 4, 512);
  const borrowers = [...currentUniverse.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, maxChecks)
    .map(([address]) => address);
  const ttlMs = boundedInteger(process.env.CRYPTOCRAWL_LIQUIDATION_CANDIDATE_TTL_MS, 15_000, 1_000, 60_000);
  const settled = await Promise.allSettled(borrowers.map(borrower => inspectBorrower({
    chain,
    pool,
    contract,
    borrower,
    ttlMs,
  })));
  const observations = settled.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);

  if (!EXACT_EXECUTION_CHAINS.has(chain as ExecutableAaveLiquidationChain) || observations.length === 0) {
    return observations.map(observation => observation.candidate);
  }

  // Firm 0x quotes and exact full-payload simulations are deliberately bounded.
  // Prioritize the lowest health factor first, then larger measured debt, while
  // every other liquidatable borrower remains in measured discovery coverage.
  const hydrationLimit = boundedInteger(process.env.CRYPTOCRAWL_LIQUIDATION_FIRM_HYDRATION_PER_CHAIN, 2, 1, 8);
  const prioritized = [...observations].sort((left, right) => {
    if (left.healthFactor !== right.healthFactor) return left.healthFactor - right.healthFactor;
    if (left.totalDebtBase.eq(right.totalDebtBase)) return 0;
    return right.totalDebtBase.gt(left.totalDebtBase) ? 1 : -1;
  }).slice(0, hydrationLimit);

  for (const observation of prioritized) {
    try {
      const prepared = await prepareAaveLiquidation({
        opportunityId: observation.candidate.opportunityId,
        chain: chain as ExecutableAaveLiquidationChain,
        borrower: observation.borrower,
        expiresAt: observation.candidate.expiresAt,
      });
      observation.candidate = preparedCandidate(observation.candidate, prepared);
    } catch {
      // Fail closed. The base measured candidate already carries the complete set
      // of evidence still required; infrastructure permission needs are queued by
      // the preparation authority for reconciliation beneath the canonical scheduler.
    }
  }

  return observations.map(observation => observation.candidate);
}

export async function discoverMeasuredLiquidationCandidates(): Promise<MeasuredCandidate[]> {
  const configured = DISCOVERY_CHAINS.filter(chain => resolveAaveV3Pool(chain as SupportedExecutionChain) !== null);
  if (configured.length === 0) return [];
  await multiProviderRpcManager.initialize(configured);
  const settled = await Promise.allSettled(configured.map(chain => discoverChainLiquidations(chain)));
  return settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}
