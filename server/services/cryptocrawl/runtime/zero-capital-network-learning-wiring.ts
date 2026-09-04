import logger from '../../../logger.js';
import { getCryptaraNetworkSpecializationLearning, type CryptaraNetworkRole } from '../../cryptara/network-specialization-learning.js';
import {
  zeroCapitalEngine,
  type ExecutionResult,
  type ZeroCapitalOpportunity,
} from '../core/zero-capital-engine.js';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';

const installed = new WeakSet<object>();

type Runtime = {
  executeFunded: (opportunity: ZeroCapitalOpportunity, funding: GasFundingDecision & Record<string, unknown>) => Promise<ExecutionResult & Record<string, unknown>>;
};

function finite(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function protocolFromRoute(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const prefix = value.trim().toLowerCase().split(':', 1)[0];
  return prefix || undefined;
}

function recordTerminal(
  opportunity: ZeroCapitalOpportunity,
  funding: GasFundingDecision & Record<string, unknown>,
  result: ExecutionResult & Record<string, unknown>,
): void {
  const normalized = (result as any).normalized;
  if (!normalized || normalized.terminal !== true || normalized.settlementConfirmed !== true) return;

  const learner = getCryptaraNetworkSpecializationLearning();
  const observedAt = finite(normalized.settledAt) ?? Date.now();
  const submittedAt = finite(normalized.submittedAt);
  const explicitLatency = finite((result as any).latencyMs);
  const latencyMs = explicitLatency !== undefined
    ? Math.max(0, explicitLatency)
    : submittedAt !== undefined
      ? Math.max(0, observedAt - submittedAt)
      : undefined;
  const realizedCostUsd = finite((result as any).realizedFeeUsd ?? normalized.realized?.gasUsd ?? normalized.realized?.exchangeFeeUsd);
  const realizedNetProfitUsd = finite(normalized.realized?.netProfitUsd);
  const success = result.success === true && normalized.status === 'filled' && realizedNetProfitUsd !== undefined && realizedNetProfitUsd > 0;
  const baseProvenance = [
    'terminal_confirmed_zero_capital_settlement',
    'cryptara_network_specialization_learning',
    'learning_only_no_execution_authority',
    ...(Array.isArray(normalized.provenance) ? normalized.provenance.map(String) : []),
  ];

  const routeProtocols = [...new Set(
    (opportunity.route || [])
      .map(step => String((step as any).protocol || '').trim().toLowerCase())
      .filter(Boolean),
  )];
  const providerProtocol = protocolFromRoute(normalized.venueOrRoute);

  const record = (role: CryptaraNetworkRole, protocol?: string): void => {
    learner.record({
      network: String(opportunity.chain).toLowerCase(),
      protocol,
      role,
      terminal: true,
      success,
      observedAt,
      latencyMs,
      realizedCostUsd,
      realizedNetProfitUsd,
      ambiguous: false,
      provenance: [...new Set(baseProvenance)],
    });
  };

  // Network-level terminal truth learns whether this chain is actually effective.
  record('execution');
  record('settlement');

  // Route-specific evidence remains advisory and never changes execution eligibility.
  for (const protocol of routeProtocols) record('execution', protocol);
  if (providerProtocol) record('atomic_principal', providerProtocol);

  const fundingMode = String((result as any).fundingMode || (funding as any).mode || '').trim().toLowerCase();
  if (fundingMode === 'opportunity_erc20_postop') record('fee_payment', 'alchemy_erc20_postop');
  else if (fundingMode === 'system_native' || fundingMode === 'native') record('fee_payment', 'system_native');

  if ((result as any).capitalProvenanceVerified === true && success) {
    record('retained_capital');
  }
}

/**
 * Installs an outer, learning-only wrapper after canonical realized economics.
 * Only terminal-confirmed settlements teach Cryptara. RPC health, quotes,
 * preparation failures and simulated outcomes never become profitability truth.
 */
export function ensureZeroCapitalNetworkLearningWiring(): void {
  const runtime = zeroCapitalEngine as unknown as Runtime;
  if (installed.has(runtime)) return;
  installed.add(runtime);

  const delegate = runtime.executeFunded.bind(runtime);
  runtime.executeFunded = async (opportunity, funding) => {
    const result = await delegate(opportunity, funding);
    try {
      recordTerminal(opportunity, funding, result);
    } catch (error) {
      logger.warn('[Cryptara] Terminal network specialization learning degraded locally', {
        component: 'ZeroCapitalNetworkLearningWiring',
        opportunityId: opportunity.id,
        chain: opportunity.chain,
        error: error instanceof Error ? error.message : String(error),
        executionAffected: false,
        settlementAffected: false,
        globalHaltAuthority: false,
      });
    }
    return result;
  };

  logger.info('[Cryptara] Terminal network specialization learning installed', {
    component: 'ZeroCapitalNetworkLearningWiring',
    terminalSettlementOnly: true,
    quoteEvidenceAsProfitabilityTruth: false,
    rpcHealthAsProfitabilityTruth: false,
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
    capitalMovementAuthority: false,
  });
}
