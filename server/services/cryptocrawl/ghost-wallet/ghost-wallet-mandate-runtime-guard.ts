import { pool } from '../runtime/cryptocrawl-runtime-database.js';

/**
 * Final authorization guard immediately before a Ghost controller signs/submits.
 * Discovery/controller admission can race a signed cancellation or replacement;
 * execution must fail closed against the durable mandate row at the last boundary.
 */
export async function assertGhostWalletMandateStillExecutable(payload: Record<string, unknown>): Promise<void> {
  const mandateId = String(payload.mandateId || '').trim();
  if (!mandateId) return;
  const mandateScope = String(payload.mandateScope || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(mandateScope)) {
    throw new Error('GHOST_WALLET_MANDATE_SCOPE_INVALID');
  }

  const result = await pool.query(
    `SELECT chain,enabled,metadata
     FROM private.cryptocrawler_ghost_wallet_venues
     WHERE venue_id=$1 AND protocol='signed_erc3156_borrower_mandate'
     LIMIT 1`,
    [mandateId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('GHOST_WALLET_MANDATE_FINAL_NOT_FOUND');
  if (row.enabled !== true) throw new Error('GHOST_WALLET_MANDATE_FINAL_CANCELLED');

  const expectedChain = String(payload.chain || '').trim().toLowerCase();
  if (expectedChain && String(row.chain || '').trim().toLowerCase() !== expectedChain) {
    throw new Error('GHOST_WALLET_MANDATE_FINAL_CHAIN_MISMATCH');
  }

  const metadata = row.metadata && typeof row.metadata === 'object'
    ? row.metadata as Record<string, unknown>
    : {};
  const durableScope = String(metadata.mandateDigest || '').trim().toLowerCase();
  if (durableScope !== mandateScope) {
    throw new Error('GHOST_WALLET_MANDATE_FINAL_VERSION_MISMATCH');
  }
  if (metadata.cancelledAt !== undefined && metadata.cancelledAt !== null) {
    throw new Error('GHOST_WALLET_MANDATE_FINAL_CANCELLED');
  }

  const deadline = Number(metadata.deadline);
  if (!Number.isSafeInteger(deadline) || deadline <= Math.floor(Date.now() / 1000)) {
    throw new Error('GHOST_WALLET_MANDATE_FINAL_EXPIRED');
  }
}

export const GHOST_WALLET_MANDATE_RUNTIME_GUARD_POLICY = {
  checkedImmediatelyBeforeControllerSubmission: true,
  cancellationFailsClosed: true,
  replacementDigestMustMatchQueuedScope: true,
  chainMustMatchQueuedWork: true,
  expiryRecheckedAtSubmission: true,
  zeroCapitalDependency: false,
} as const;
