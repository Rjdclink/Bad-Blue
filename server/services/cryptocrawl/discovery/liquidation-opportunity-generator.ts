import { Contract, BigNumber, ethers } from 'ethers';
import {
  multiProviderRpcManager,
  type SupportedChain as RpcSupportedChain,
} from '../api/blockchain-providers.js';
import { resolveAaveV3Pool } from '../execution/adapters/flash-loan-provider-economics.js';
import type { SupportedExecutionChain } from '../execution/adapters/onchain-payload-builder.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';

const AAVE_POOL_ABI = [
  'event Borrow(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint8 interestRateMode,uint256 borrowRate,uint16 indexed referralCode)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase,uint256 totalDebtBase,uint256 availableBorrowsBase,uint256 currentLiquidationThreshold,uint256 ltv,uint256 healthFactor)',
];

const DISCOVERY_CHAINS: RpcSupportedChain[] = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc'];
const borrowerUniverse = new Map<RpcSupportedChain, Map<string, number>>();

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

  const settled = await Promise.allSettled(borrowers.map(async borrower => {
    const observedAt = Date.now();
    const account = await contract.getUserAccountData(borrower) as [BigNumber, BigNumber, BigNumber, BigNumber, BigNumber, BigNumber];
    const totalCollateralBase = BigNumber.from(account[0]);
    const totalDebtBase = BigNumber.from(account[1]);
    const healthFactorRaw = BigNumber.from(account[5]);
    const healthFactor = healthFactorNumber(healthFactorRaw);
    if (!(healthFactor < 1) || totalDebtBase.lte(0) || totalCollateralBase.lte(0)) return null;

    return measuredCandidateRegistry.record({
      opportunityId: `aave-liquidation:${chain}:${borrower}:${observedAt}`,
      topology: 'LIQUIDATION',
      observedAt,
      expiresAt: observedAt + ttlMs,
      status: 'enriched',
      assets: ['AAVE_V3_POSITION'],
      venues: ['aave_v3'],
      chains: [chain],
      rawQuotes: [{
        source: 'aave_v3_pool',
        venue: 'aave_v3',
        chain,
        observedAt,
        executable: false,
        provenance: [
          `borrower:${borrower}`,
          `health_factor:${healthFactor.toFixed(8)}`,
          `total_collateral_base:${totalCollateralBase.toString()}`,
          `total_debt_base:${totalDebtBase.toString()}`,
          `pool:${pool}`,
        ],
      }],
      depth: {
        status: 'measured',
        detail: `Aave V3 getUserAccountData measured healthFactor=${healthFactor.toFixed(8)}, totalDebtBase=${totalDebtBase.toString()}, totalCollateralBase=${totalCollateralBase.toString()}`,
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
      executionCapabilityReason: 'Position is measured liquidatable (health factor < 1), but reserve-level debt/collateral, liquidation bonus, close factor, oracle value, flash liquidity, swap unwind, gas, and exact atomic simulation are not yet complete',
      missingInformation: [
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
      ],
      provenance: [
        'aave_v3_borrow_event_universe',
        'aave_v3_getUserAccountData',
        'health_factor_below_one',
        'liquidation_profitability:not_assumed',
        'synthetic_evidence:false',
      ],
    });
  }));

  return settled.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
}

export async function discoverMeasuredLiquidationCandidates(): Promise<MeasuredCandidate[]> {
  const configured = DISCOVERY_CHAINS.filter(chain => resolveAaveV3Pool(chain as SupportedExecutionChain) !== null);
  if (configured.length === 0) return [];
  const settled = await Promise.allSettled(configured.map(chain => discoverChainLiquidations(chain)));
  return settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}
