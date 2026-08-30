import logger from '../../../logger.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import type { InventoryVenue } from './cex-inventory-ledger.js';
import type { RebalancePlan } from './inventory-rebalancer.js';

export interface RebalanceTransferReceipt {
  transferId: string;
  sourceVenue: InventoryVenue;
  destinationVenue: InventoryVenue;
  asset: string;
  network: string;
  amount: number;
  submittedAt: number;
}

export interface RebalanceTransferSettlement {
  transferId: string;
  terminal: boolean;
  settlementConfirmed: boolean;
  successful: boolean;
  creditedAmount: number | null;
  withdrawalFeeAsset: number | null;
  sourceReference: string | null;
  destinationReference: string | null;
  settledAt: number | null;
  provenance: string[];
  error?: string;
}

export interface RebalanceTransferAdapter {
  sourceVenue: InventoryVenue;
  destinationVenue: InventoryVenue;
  supports(plan: RebalancePlan): Promise<boolean> | boolean;
  submit(plan: RebalancePlan): Promise<RebalanceTransferReceipt>;
  query(receipt: RebalanceTransferReceipt): Promise<RebalanceTransferSettlement>;
}

export interface RebalanceExecutionResult {
  success: boolean;
  status: 'rejected' | 'submitted' | 'settlement_unknown' | 'confirmed' | 'failed';
  settlementConfirmed: boolean;
  receipt?: RebalanceTransferReceipt;
  settlement?: RebalanceTransferSettlement;
  error?: string;
}

function key(source: InventoryVenue, destination: InventoryVenue): string {
  return `${source}->${destination}`;
}

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

class InventoryRebalanceExecutor {
  private readonly adapters = new Map<string, RebalanceTransferAdapter>();

  registerAdapter(adapter: RebalanceTransferAdapter): void {
    if (adapter.sourceVenue === adapter.destinationVenue) throw new Error('Rebalance adapter requires distinct venues');
    this.adapters.set(key(adapter.sourceVenue, adapter.destinationVenue), adapter);
  }

  unregisterAdapter(sourceVenue: InventoryVenue, destinationVenue: InventoryVenue): void {
    this.adapters.delete(key(sourceVenue, destinationVenue));
  }

  getRegisteredRoutes(): string[] {
    return [...this.adapters.keys()].sort();
  }

  async execute(plan: RebalancePlan): Promise<RebalanceExecutionResult> {
    if (!(plan.amount > 0) || !Number.isFinite(plan.amount)) {
      return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_REBALANCE_AMOUNT' };
    }
    if (plan.sourceVenue === plan.destinationVenue || plan.evidenceExpiresAt <= Date.now()) {
      return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_REBALANCE_ROUTE_OR_FRESHNESS' };
    }

    const adapter = this.adapters.get(key(plan.sourceVenue, plan.destinationVenue));
    if (!adapter) {
      return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_REBALANCE_ADAPTER_UNAVAILABLE' };
    }
    if (!await adapter.supports(plan)) {
      return { success: false, status: 'rejected', settlementConfirmed: false, error: 'REJECT_REBALANCE_NETWORK_OR_ADDRESS_UNVERIFIED' };
    }

    // Rebalancing moves real assets. It may never bypass the same live action
    // governance used by transaction submission.
    getCryptocrawlGovernance().requireAllowed('SUBMIT_TX', { chain: `cex:${plan.sourceVenue}` });

    const receipt = await adapter.submit(plan);
    const timeoutMs = bounded(process.env.CRYPTOCRAWL_REBALANCE_SETTLEMENT_TIMEOUT_MS, 30 * 60_000, 10_000, 6 * 60 * 60_000);
    const pollMs = bounded(process.env.CRYPTOCRAWL_REBALANCE_SETTLEMENT_POLL_MS, 10_000, 1_000, 60_000);
    const deadline = Date.now() + timeoutMs;
    let last: RebalanceTransferSettlement | undefined;

    while (Date.now() <= deadline) {
      try {
        last = await adapter.query(receipt);
        if (last.terminal) {
          const confirmed = last.settlementConfirmed === true && last.successful === true;
          logger.info('[InventoryRebalancer] Transfer reached terminal settlement', {
            component: 'InventoryRebalanceExecutor',
            transferId: receipt.transferId,
            route: key(plan.sourceVenue, plan.destinationVenue),
            asset: plan.asset,
            amount: plan.amount,
            settlementConfirmed: last.settlementConfirmed,
            successful: last.successful,
            creditedAmount: last.creditedAmount,
          });
          return {
            success: confirmed,
            status: confirmed ? 'confirmed' : 'failed',
            settlementConfirmed: confirmed,
            receipt,
            settlement: last,
            error: confirmed ? undefined : last.error || 'REBALANCE_TERMINAL_NOT_CONFIRMED',
          };
        }
      } catch (error) {
        logger.warn('[InventoryRebalancer] Settlement query failed; transfer remains in-flight', {
          component: 'InventoryRebalanceExecutor',
          transferId: receipt.transferId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }

    return {
      success: false,
      status: 'settlement_unknown',
      settlementConfirmed: false,
      receipt,
      settlement: last,
      error: 'REBALANCE_SETTLEMENT_TIMEOUT',
    };
  }
}

export const inventoryRebalanceExecutor = new InventoryRebalanceExecutor();
