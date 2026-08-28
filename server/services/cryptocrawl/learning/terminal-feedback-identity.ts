import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';

/**
 * Stable identity for one terminal execution lifecycle. Callback time is never
 * used: a replay of the same authenticated settlement must resolve to the same
 * key so learning/governance cannot count it twice.
 */
export function terminalFeedbackIdentity(feedback: CryptaraExecutionFeedback): string {
  const settlement = feedback.settlement;
  if (!settlement || settlement.terminal !== true) {
    throw new Error('Terminal feedback identity requires a terminal normalized settlement');
  }

  if (settlement.transactionHash?.trim()) {
    return `tx:${settlement.chain || feedback.chain}:${settlement.transactionHash.trim().toLowerCase()}`;
  }

  const orderIds = (settlement.orders || [])
    .filter(order => order.orderId?.trim())
    .map(order => `${order.venue.toLowerCase()}:${order.orderId.trim()}`)
    .sort();
  if (orderIds.length > 0) {
    return `orders:${settlement.venueOrRoute}:${orderIds.join('|')}`;
  }

  // A terminal rejection may have no order id because neither venue accepted an
  // order. Its canonical opportunity + original lifecycle timestamps are stable
  // across callback retries and do not depend on Date.now().
  return [
    'terminal',
    feedback.opportunityId || `${feedback.chain}:${feedback.symbol}:${feedback.strategy}`,
    settlement.status,
    String(settlement.submittedAt),
    String(settlement.settledAt ?? 'none'),
  ].join(':');
}
