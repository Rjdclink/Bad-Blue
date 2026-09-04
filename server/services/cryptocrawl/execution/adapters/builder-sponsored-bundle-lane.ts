export type SponsoredBuilderName = 'Titan' | 'Quasar';

export interface SponsoredBuilderBundle {
  signedTransactions: string[];
  targetBlock: number;
  replacementUuid: string;
}

export interface SponsoredBuilderAcceptance {
  builder: SponsoredBuilderName;
  endpoint: string;
  accepted: boolean;
  bundleHash?: string;
  latencyMs: number;
  error?: string;
}

export interface SponsoredBuilderSubmissionResult {
  submitted: number;
  acceptedBy: SponsoredBuilderName[];
  failedBy: SponsoredBuilderName[];
  attempts: SponsoredBuilderAcceptance[];
  transactionCount: number;
  publicMempoolFallback: false;
}

const SPONSORED_BUILDERS: Array<{ name: SponsoredBuilderName; endpoint: string }> = [
  { name: 'Titan', endpoint: 'https://rpc.titanbuilder.xyz' },
  { name: 'Quasar', endpoint: 'https://rpc.quasar.win' },
];
const MAX_COLD_START_BUNDLE_TRANSACTIONS = 16;

function validRawTransaction(value: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(value) && value.length > 10;
}

function hexBlock(block: number): string {
  if (!Number.isSafeInteger(block) || block <= 0) throw new Error('targetBlock must be a positive safe integer');
  return `0x${block.toString(16)}`;
}

async function rpcSubmit(input: {
  builder: SponsoredBuilderName;
  endpoint: string;
  bundle: SponsoredBuilderBundle;
  timeoutMs: number;
}): Promise<SponsoredBuilderAcceptance> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'eth_sendBundle',
      params: [{
        txs: input.bundle.signedTransactions,
        blockNumber: hexBlock(input.bundle.targetBlock),
        // No transaction in the bootstrap chain is dispensable. A deployment,
        // permission, or execution failure must invalidate the entire candidate.
        revertingTxHashes: [],
        droppingTxHashes: [],
        replacementUuid: input.bundle.replacementUuid,
      }],
    });
    const response = await fetch(input.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: any = null;
    try { payload = text ? JSON.parse(text) : null; } catch { /* handled below */ }
    if (!response.ok) throw new Error(`${input.builder} HTTP ${response.status}: ${text.slice(0, 240)}`);
    if (payload?.error) throw new Error(`${input.builder} rejected bundle: ${payload.error.message || payload.error.code || 'unknown error'}`);
    const bundleHash = String(payload?.result?.bundleHash || payload?.result || '');
    if (!/^0x[0-9a-fA-F]{64}$/.test(bundleHash)) throw new Error(`${input.builder} returned no valid bundle hash`);
    return {
      builder: input.builder,
      endpoint: input.endpoint,
      accepted: true,
      bundleHash,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      builder: input.builder,
      endpoint: input.endpoint,
      accepted: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Low-level transport for the builder-sponsored cold-start lane.
 *
 * IMPORTANT: This module intentionally has no signer and no public RPC fallback.
 * It accepts already-signed transaction bytes from the canonical execution signer
 * and sends those exact bytes to builders that document sponsored bundles. The
 * bundle may contain deterministic CREATE2 deployment/configuration transactions
 * followed by the opportunity-backed execution transaction. None may revert or be
 * dropped. This transport is designed to be owned by MultiRelaySubmitter rather
 * than becoming a parallel execution authority.
 */
export async function submitBuilderSponsoredBundle(
  bundle: SponsoredBuilderBundle,
  options: { timeoutMs?: number } = {},
): Promise<SponsoredBuilderSubmissionResult> {
  if (!Array.isArray(bundle.signedTransactions) || bundle.signedTransactions.length === 0) {
    throw new Error('Cold-start sponsored bundle must contain at least one signed transaction');
  }
  if (bundle.signedTransactions.length > MAX_COLD_START_BUNDLE_TRANSACTIONS) {
    throw new Error(`Cold-start sponsored bundle exceeds ${MAX_COLD_START_BUNDLE_TRANSACTIONS} transactions`);
  }
  if (bundle.signedTransactions.some(transaction => !validRawTransaction(transaction))) {
    throw new Error('Sponsored bundle contains invalid raw transaction bytes');
  }
  hexBlock(bundle.targetBlock);
  if (!bundle.replacementUuid || bundle.replacementUuid.trim().length < 8) {
    throw new Error('Sponsored bundle requires a stable replacementUuid of at least 8 characters');
  }

  const timeoutMs = Math.max(500, Math.min(10_000, options.timeoutMs ?? 2_000));
  const attempts = await Promise.all(SPONSORED_BUILDERS.map(builder => rpcSubmit({
    builder: builder.name,
    endpoint: builder.endpoint,
    bundle,
    timeoutMs,
  })));
  const acceptedBy = attempts.filter(attempt => attempt.accepted).map(attempt => attempt.builder);
  const failedBy = attempts.filter(attempt => !attempt.accepted).map(attempt => attempt.builder);
  return {
    submitted: acceptedBy.length,
    acceptedBy,
    failedBy,
    attempts,
    transactionCount: bundle.signedTransactions.length,
    publicMempoolFallback: false,
  };
}
