import { ethers } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager, type SupportedChain } from '../api/blockchain-providers.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from './measured-candidate-registry.js';

export interface LiquidationObservation {
  protocol: string;
  chain: SupportedChain;
  account: string;
  observedAt: number;
  consistentBlock: number;
  healthFactor: number;
  closeFactor: number;
  liquidationBonusBps: number;
  debtAsset: string | null;
  collateralAsset: string | null;
  debtToCoverUsd: number | null;
  grossBonusUsd: number | null;
  gasPriorityUsd: number | null;
  swapImpactUsd: number | null;
  flashLoanFeeUsd: number | null;
  auctionCostUsd: number | null;
  reorgFinalityRiskUsd: number | null;
  competitorDensityCostUsd: number | null;
  oracleObservedAt: number | null;
  oracleSource: string | null;
  transactionRequirementsKnown: boolean;
  simulationPassed: boolean | null;
  provenance: string[];
}

function finiteNonNegative(value: number | null): value is number { return value !== null && Number.isFinite(value) && value >= 0; }

export function evaluateLiquidationObservation(input: LiquidationObservation): MeasuredCandidate {
  const missing: string[] = [];
  for (const [name,value] of Object.entries({
    debtToCoverUsd: input.debtToCoverUsd,
    grossBonusUsd: input.grossBonusUsd,
    gasPriorityUsd: input.gasPriorityUsd,
    swapImpactUsd: input.swapImpactUsd,
    flashLoanFeeUsd: input.flashLoanFeeUsd,
    auctionCostUsd: input.auctionCostUsd,
    reorgFinalityRiskUsd: input.reorgFinalityRiskUsd,
    competitorDensityCostUsd: input.competitorDensityCostUsd,
  })) if (!finiteNonNegative(value)) missing.push(name);
  if (!input.debtAsset) missing.push('debt_asset');
  if (!input.collateralAsset) missing.push('collateral_asset');
  if (!input.oracleSource || !input.oracleObservedAt) missing.push('oracle_freshness');
  if (!input.transactionRequirementsKnown) missing.push('transaction_requirements');
  if (input.simulationPassed !== true) missing.push('pre_simulation');

  const costsKnown = missing.length === 0;
  const totalCosts = costsKnown
    ? input.gasPriorityUsd! + input.swapImpactUsd! + input.flashLoanFeeUsd! + input.auctionCostUsd! + input.reorgFinalityRiskUsd! + input.competitorDensityCostUsd!
    : null;
  const net = totalCosts === null || input.grossBonusUsd === null ? null : input.grossBonusUsd - totalCosts;
  const positive = net !== null && net > 0 && input.healthFactor < 1;
  return measuredCandidateRegistry.record({
    opportunityId: `liquidation:${input.protocol}:${input.chain}:${input.account}:${input.consistentBlock}`,
    topology: 'DEX_ATOMIC',
    observedAt: input.observedAt,
    expiresAt: input.observedAt + Math.max(1_000, Number(process.env.LIQUIDATION_CANDIDATE_TTL_MS || 12_000)),
    status: positive ? 'deterministic_positive' : missing.length ? 'enriched' : 'blocked',
    assets: [input.debtAsset || 'unknown_debt', input.collateralAsset || 'unknown_collateral'],
    venues: [input.protocol],
    chains: [input.chain],
    rawQuotes: [{ source: `${input.protocol}:health_factor`, chain: input.chain, observedAt: input.observedAt, price: input.healthFactor, provenance: input.provenance }],
    depth: { status: 'not_applicable', detail: 'liquidation depth is protocol/account state plus unwind liquidity, not a CEX book' },
    economics: {
      grossProfitUsd: input.grossBonusUsd,
      deterministicNetProfitUsd: net,
      feeUsd: input.flashLoanFeeUsd,
      gasUsd: input.gasPriorityUsd,
      bridgeUsd: 0,
      expectedSlippageBps: input.debtToCoverUsd && input.swapImpactUsd !== null ? input.swapImpactUsd / input.debtToCoverUsd * 10_000 : null,
      expectedPriceImpactBps: null,
    },
    quoteAgeMs: Math.max(0, Date.now() - input.observedAt),
    executableCapability: false,
    executionCapabilityReason: 'liquidation monitoring is live-read capable; live liquidation submission remains disabled until protocol adapter fork/testnet/replay/invariant proof is explicitly promoted',
    missingInformation: missing,
    provenance: [...new Set([...input.provenance, 'canonical_liquidation_engine', 'gas_is_real_cost', 'live_submission_disabled'])],
  });
}

const AAVE_ACCOUNT_DATA = new ethers.utils.Interface([
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase,uint256 totalDebtBase,uint256 availableBorrowsBase,uint256 currentLiquidationThreshold,uint256 ltv,uint256 healthFactor)',
]);

export async function scanConfiguredAaveV3Health(chain: SupportedChain): Promise<MeasuredCandidate[]> {
  const prefix = `AAVE_V3_${chain.toUpperCase()}`;
  const poolAddress = process.env[`${prefix}_POOL_ADDRESS`]?.trim();
  const accounts = (process.env[`${prefix}_MONITORED_ACCOUNTS`] || '').split(',').map(value => value.trim()).filter(ethers.utils.isAddress);
  if (!poolAddress || !ethers.utils.isAddress(poolAddress) || accounts.length === 0) return [];
  const results: MeasuredCandidate[] = [];
  const block = await multiProviderRpcManager.execute(chain, 'blocks', provider => provider.getBlockNumber());
  for (const account of accounts.slice(0, Math.max(1, Number(process.env.LIQUIDATION_ACCOUNT_SCAN_LIMIT || 50)))) {
    try {
      const encoded = AAVE_ACCOUNT_DATA.encodeFunctionData('getUserAccountData', [account]);
      const raw = await multiProviderRpcManager.execute(chain, 'contract_calls', provider => provider.call({ to: poolAddress, data: encoded }, block));
      const decoded = AAVE_ACCOUNT_DATA.decodeFunctionResult('getUserAccountData', raw);
      const healthFactor = Number(ethers.utils.formatUnits(decoded.healthFactor, 18));
      const totalDebtBase = decoded.totalDebtBase;
      if (!Number.isFinite(healthFactor) || totalDebtBase.isZero() || healthFactor >= 1.05) continue;
      const validated = process.env[`${prefix}_FORK_REPLAY_INVARIANTS_PASSED`] === 'true';
      results.push(evaluateLiquidationObservation({
        protocol: 'aave-v3', chain, account, observedAt: Date.now(), consistentBlock: block,
        healthFactor, closeFactor: Number(process.env[`${prefix}_CLOSE_FACTOR`] || 0),
        liquidationBonusBps: Number(process.env[`${prefix}_LIQUIDATION_BONUS_BPS`] || 0),
        debtAsset: null, collateralAsset: null, debtToCoverUsd: null, grossBonusUsd: null,
        gasPriorityUsd: null, swapImpactUsd: null, flashLoanFeeUsd: null, auctionCostUsd: 0,
        reorgFinalityRiskUsd: null, competitorDensityCostUsd: null,
        oracleObservedAt: null, oracleSource: null, transactionRequirementsKnown: false,
        simulationPassed: validated ? null : false,
        provenance: ['aave_v3_getUserAccountData', `consistent_block:${block}`, validated ? 'adapter_replay_flag_present' : 'adapter_live_disabled_pending_fork_replay_invariants'],
      }));
    } catch (error) {
      logger.debug('[Liquidation] Aave v3 health scan degraded', { chain, account, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

export const LIQUIDATION_LIVE_EXECUTION_ENABLED = false as const;
