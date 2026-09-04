import logger from '../../../logger.js';
import { zeroCapitalEngine, type ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';
import type { GasFundingDecision } from '../capital-free/dynamic-gas-funding-engine.js';

const installed = new WeakSet<object>();

type PostOpReportingRuntime = {
  executeFunded: (
    opportunity: ZeroCapitalOpportunity,
    funding: GasFundingDecision & Record<string, unknown>,
  ) => Promise<any>;
};

/**
 * The opportunity-backed ERC20 lane reports profit as the operational-wallet
 * token delta AFTER the paymaster's postOp token charge. The canonical realized
 * profit boundary must not subtract that charge a second time. It does, however,
 * need to preserve the measured monetary gas cost for telemetry, Cryptara and
 * all-in reporting instead of replacing it with native-gas USD = 0.
 *
 * This wrapper is installed after the canonical realized-profit boundary and is
 * reporting-only: it never changes profit, success, settlement authority or any
 * capital movement decision.
 */
export function ensureZeroCapitalPostOpCostReportingWiring(): void {
  const runtime = zeroCapitalEngine as unknown as PostOpReportingRuntime;
  if (installed.has(runtime)) return;
  installed.add(runtime);

  const delegate = runtime.executeFunded.bind(runtime);
  runtime.executeFunded = async (opportunity, funding) => {
    const result = await delegate(opportunity, funding);
    if (
      result?.fundingMode !== 'opportunity_erc20_postop' ||
      !Number.isFinite(Number(result?.providerFeeUsd)) ||
      Number(result.providerFeeUsd) < 0 ||
      !result?.normalized?.realized
    ) return result;

    const providerFeeUsd = Number(result.providerFeeUsd);
    const normalized = {
      ...result.normalized,
      realized: {
        ...result.normalized.realized,
        gasUsd: providerFeeUsd,
      },
      provenance: [...new Set([
        ...(result.normalized.provenance || []),
        'postop_provider_token_fee:measured_and_preserved',
        'postop_fee_already_net_of_operational_wallet_profit:no_double_subtraction',
        'operator_native_gas_input:zero',
      ])],
    };

    return {
      ...result,
      normalized,
      realizedFeeUsd: providerFeeUsd,
      providerMonetaryGasCostUsd: providerFeeUsd,
    };
  };

  logger.info('[ZeroInitialCapital] Opportunity-backed postOp cost reporting guard installed', {
    component: 'ZeroCapitalPostOpCostReportingWiring',
    measuredProviderTokenFeePreserved: true,
    netProfitDoubleSubtraction: false,
    operatorNativeGasInputZeroSemanticsPreserved: true,
    executionAuthority: false,
    canonicalEconomicsAuthority: false,
  });
}
