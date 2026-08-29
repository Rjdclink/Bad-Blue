import logger from '../../../logger.js';
import {
  zeroCapitalEngine,
  type SupportedChain,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import {
  measureFlashLoanProviders,
  selectMeasuredFlashLoanProvider,
  type FlashLoanProviderEconomics,
} from '../execution/adapters/flash-loan-provider-economics.js';
import { recordProfitEstimate } from '../intelligence/profit-estimator.js';
import type { providers } from 'ethers';

const installed = new WeakSet<object>();
const evidenceCache = new Map<string, { observedAt: number; evidence: FlashLoanProviderEconomics[] }>();

function cacheTtlMs(): number {
  const value = Number(process.env.ZERO_CAPITAL_FLASH_PROVIDER_EVIDENCE_TTL_MS || 2_500);
  return Number.isFinite(value) ? Math.max(250, Math.min(15_000, Math.trunc(value))) : 2_500;
}

async function providerEvidence(
  chain: SupportedChain,
  provider: providers.Provider,
  asset: string,
): Promise<FlashLoanProviderEconomics[]> {
  if (chain === 'europa') return [];
  const key = `${chain}:${asset.toLowerCase()}`;
  const cached = evidenceCache.get(key);
  if (cached && Date.now() - cached.observedAt <= cacheTtlMs()) return cached.evidence.map(item => ({ ...item }));
  const evidence = await measureFlashLoanProviders({ chain: chain as any, provider, asset });
  evidenceCache.set(key, { observedAt: Date.now(), evidence });
  return evidence.map(item => ({ ...item }));
}

function bpsFromBaseUnits(value: bigint, notional: bigint): number | null {
  if (notional <= 0n) return null;
  return Number((value * 10_000n) / notional);
}

function updateCandidate(
  opportunity: ZeroCapitalOpportunity,
  selected: FlashLoanProviderEconomics | null,
  reason: string,
): void {
  const candidate = measuredCandidateRegistry.get(opportunity.id);
  if (!candidate) return;
  const positive = opportunity.expectedProfit > 0n;
  measuredCandidateRegistry.updateStatus(
    opportunity.id,
    positive && selected ? 'deterministic_positive' : 'enriched',
    {
      economics: {
        ...candidate.economics,
        deterministicNetProfitUsd: Number(opportunity.expectedProfit) / (10 ** opportunity.inputTokenDecimals),
        feeUsd: Number(opportunity.flashLoanFeeInInputToken || 0n) / (10 ** opportunity.inputTokenDecimals),
        flashLoanFeeBps: bpsFromBaseUnits(opportunity.flashLoanFeeInInputToken || 0n, opportunity.flashLoanAmount),
        allInCostBps: bpsFromBaseUnits(opportunity.estimatedExecutionCostInInputToken, opportunity.flashLoanAmount),
        breakEvenBps: bpsFromBaseUnits(opportunity.estimatedExecutionCostInInputToken, opportunity.flashLoanAmount),
        netProfitBps: opportunity.netProfitBps,
        bpsToBreakEven: opportunity.netProfitBps >= 0 ? 0 : Math.abs(opportunity.netProfitBps),
      },
      executableCapability: positive && !!selected && candidate.executableCapability,
      executionCapabilityReason: reason,
      missingInformation: selected ? [] : ['measured_flash_loan_provider_liquidity_and_fee'],
      provenance: selected
        ? [
            `flash_loan_provider:${selected.provider}`,
            'measured_flash_loan_fee',
            'measured_flash_loan_liquidity',
          ]
        : ['flash_loan_provider_unavailable_fail_closed'],
    },
  );
}

export function ensureZeroCapitalFlashProviderWiring(): void {
  const target = zeroCapitalEngine as unknown as {
    scanChain: (chain: SupportedChain, provider: providers.JsonRpcProvider) => Promise<ZeroCapitalOpportunity[]>;
  };
  if (installed.has(target)) return;
  installed.add(target);

  const originalScanChain = target.scanChain.bind(target);
  target.scanChain = async (chain, provider): Promise<ZeroCapitalOpportunity[]> => {
    const opportunities = await originalScanChain(chain, provider);
    if (chain === 'europa' || opportunities.length === 0) return opportunities;

    const repriced: ZeroCapitalOpportunity[] = [];
    for (const opportunity of opportunities) {
      try {
        const evidence = await providerEvidence(chain, provider, opportunity.inputToken);
        const selected = selectMeasuredFlashLoanProvider(evidence, opportunity.flashLoanAmount);
        if (!selected || selected.feeBps === null) {
          updateCandidate(opportunity, null, 'No flash-loan provider has complete measured fee and liquidity evidence for this amount');
          continue;
        }

        const measuredFlashFee = (opportunity.flashLoanAmount * BigInt(Math.round(selected.feeBps))) / 10_000n;
        const gas = opportunity.estimatedGasCostInInputToken || 0n;
        const relay = opportunity.relayFeeInInputToken || 0n;
        const allInCost = measuredFlashFee + gas + relay;
        const grossProfit = opportunity.grossProfit ?? (opportunity.expectedProfit + opportunity.estimatedExecutionCostInInputToken);
        const netProfit = grossProfit - allInCost;
        const netProfitBps = opportunity.flashLoanAmount > 0n
          ? Number((netProfit * 10_000n) / opportunity.flashLoanAmount)
          : Number.NEGATIVE_INFINITY;

        opportunity.flashLoanFeeInInputToken = measuredFlashFee;
        opportunity.estimatedExecutionCostInInputToken = allInCost;
        opportunity.expectedProfit = netProfit;
        opportunity.netProfitBps = netProfitBps;

        recordProfitEstimate({
          opportunityId: opportunity.id,
          chain,
          grossProfitUsd: Number(grossProfit) / (10 ** opportunity.inputTokenDecimals),
          estimatedCostsUsd: Number(allInCost) / (10 ** opportunity.inputTokenDecimals),
          estimatedNetProfitUsd: Number(netProfit) / (10 ** opportunity.inputTokenDecimals),
          netProfitBps,
          confidence: opportunity.confidence,
          observedAt: Date.now(),
        });

        updateCandidate(
          opportunity,
          selected,
          netProfit > 0n
            ? `Measured ${selected.provider} fee/liquidity keeps the route positive; downstream Cryptara/Monte Carlo/governance remain required`
            : `Measured ${selected.provider} fee/liquidity repriced the route to ${netProfitBps} BPS; observation only`,
        );
        if (netProfit > 0n) repriced.push(opportunity);
      } catch (error) {
        updateCandidate(
          opportunity,
          null,
          `Flash-loan provider evidence failed closed: ${error instanceof Error ? error.message : String(error)}`,
        );
        logger.warn('[ZeroCapitalFlashProvider] Provider evidence failed closed', {
          component: 'ZeroCapitalFlashProviderWiring',
          chain,
          opportunityId: opportunity.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return repriced;
  };

  logger.info('[ZeroCapitalFlashProvider] Live provider economics authority installed', {
    component: 'ZeroCapitalFlashProviderWiring',
    feeAuthority: 'measured_provider_state',
    liquidityAuthority: 'measured_provider_state',
    staticFlashLoanFeeAuthority: false,
    providerSelection: 'lowest_measured_fee_with_sufficient_measured_liquidity',
    failClosedOnMissingProviderEvidence: true,
  });
}
