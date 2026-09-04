import logger from '../../../logger.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import type { ChainId } from '../bridge/types.js';
import { recordAtomicReceiverProfitAsSystemCapital } from './onchain-receiver-profit-provenance.js';

function terminalDexTransaction(provenance: readonly string[]): string | null {
  for (const item of provenance) {
    const match = item.match(/^dex_atomic:tx:(0x[0-9a-fA-F]{64})$/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Settlement reconciliation only. It never discovers, admits or submits a trade.
 * Terminal DEX candidates already carry the canonical transaction reference; this
 * function converts that existing receipt evidence into exact on-chain ownership
 * lots idempotently.
 */
export async function reconcileTerminalDexProfitsIntoOnchainCapital(limit = 16): Promise<{
  attempted: number;
  recorded: number;
  deferred: number;
}> {
  const candidates = measuredCandidateRegistry.getRecent(512)
    .filter(candidate => candidate.topology === 'DEX_ATOMIC')
    .filter(candidate => Number(candidate.economics.realizedNetProfitBps) > 0)
    .flatMap(candidate => {
      const tx = terminalDexTransaction(candidate.provenance);
      const chain = candidate.chains[0]?.trim().toLowerCase() as ChainId | undefined;
      return tx && chain ? [{ candidate, tx, chain }] : [];
    })
    .slice(0, Math.max(0, Math.min(64, Math.trunc(limit))));

  let recorded = 0;
  let deferred = 0;
  for (const item of candidates) {
    try {
      const result = await recordAtomicReceiverProfitAsSystemCapital({
        opportunityId: item.candidate.opportunityId,
        chain: item.chain,
        transactionHash: item.tx,
      });
      if (result.recorded) recorded += 1;
      else deferred += 1;
    } catch (error) {
      deferred += 1;
      logger.debug('[OnchainCapital] Terminal DEX profit reconciliation deferred', {
        component: 'OnchainSystemCapitalReconciler',
        opportunityId: item.candidate.opportunityId,
        chain: item.chain,
        transactionHash: item.tx,
        error: error instanceof Error ? error.message : String(error),
        executionAuthority: false,
      });
    }
  }
  return { attempted: candidates.length, recorded, deferred };
}
