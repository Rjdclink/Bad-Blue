import type { QuoteVenue, VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import {
  executeCexPlan,
  type CexExecutorOptions,
  type CexExecutionResult,
} from './cex-settlement.js';

export type ExchangeOrderReceipt = NonNullable<CexExecutionResult['buyOrder']>;
export type ArbitrageExecutionResult = CexExecutionResult;

export class CentralizedExchangeExecutor {
  constructor(private readonly options: CexExecutorOptions = {}) {}

  async execute(plan: VerifiedArbitragePlan): Promise<ArbitrageExecutionResult> {
    getCryptocrawlGovernance().requireAllowed('EXECUTE_OPPORTUNITY', { pair: plan.symbol });
    if (process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION !== 'true') {
      throw new Error('CRYPTO_ARBITRAGE_LIVE_EXECUTION=true is required for live orders');
    }
    if (process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION !== 'I_ACCEPT_LIVE_ORDER_RISK') {
      throw new Error('CRYPTO_ARBITRAGE_LIVE_CONFIRMATION=I_ACCEPT_LIVE_ORDER_RISK is required for live orders');
    }
    if (plan.bridge) throw new Error('Cross-chain plans require settlement orchestration and cannot be submitted as spot orders');
    if (!['kraken', 'okx'].includes(plan.buyVenue) || !['kraken', 'okx'].includes(plan.sellVenue)) {
      throw new Error(`Live execution is not configured for ${plan.buyVenue} -> ${plan.sellVenue}`);
    }
    return executeCexPlan(plan, this.options);
  }
}

export const centralizedExchangeExecutor = new CentralizedExchangeExecutor();