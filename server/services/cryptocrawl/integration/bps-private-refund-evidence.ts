import { ethers } from 'ethers';
import logger from '../../../logger.js';
import { resolveExecutionWalletAddress, walletFromPrivateKey } from '../core/wallet-identity.js';
import { getOrCreateFlashbotsAuthPrivateKey } from '../execution/adapters/flashbots-auth-identity.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';

const FLASHBOTS_RELAY_URL = 'https://relay.flashbots.net';

interface FlashbotsRpcEnvelope<T> {
  result?: T;
  error?: { code?: number; message?: string };
}

interface FlashbotsFeeRefundRow {
  hash?: string;
  amount?: string;
  blockNumber?: string;
  status?: 'pending' | 'received' | string;
  recipient?: string;
}

interface FlashbotsFeeRefundPage {
  refunds?: FlashbotsFeeRefundRow[];
  cursor?: string;
}

export interface MeasuredPrivateRefundEvidence {
  hash: string;
  recipient: string;
  status: 'pending' | 'received';
  amountWei: bigint;
  blockNumber: number | null;
  observedAt: number;
  source: 'flashbots_fee_refund_rpc';
  executionAuthority: false;
  deterministicAdmissionCredit: false;
}

export interface PrivateRefundEvidenceSnapshot {
  observedAt: number;
  recipients: string[];
  receivedRefunds: number;
  pendingRefunds: number;
  receivedWei: string;
  pendingWei: string;
  lastError: string | null;
  authority: 'terminal_realized_refund_evidence_only';
  executionAuthority: false;
  deterministicAdmissionCredit: false;
}

let installed = false;
let refreshInFlight: Promise<void> | null = null;
let timer: NodeJS.Timeout | null = null;
let lastError: string | null = null;
let lastObservedAt = 0;
const evidenceByHash = new Map<string, MeasuredPrivateRefundEvidence[]>();
const observedRecipients = new Set<string>();

function pollingIntervalMs(): number {
  // Flashbots documents an approximately four-hour indexing delay for detailed
  // refund rows, so sub-minute polling would create load without fresher truth.
  const configured = Number(process.env.CRYPTOCRAWL_PRIVATE_REFUND_POLL_MS || 60 * 60_000);
  if (!Number.isFinite(configured)) return 60 * 60_000;
  return Math.max(15 * 60_000, Math.min(6 * 60 * 60_000, Math.trunc(configured)));
}

function maxPages(): number {
  const configured = Number(process.env.CRYPTOCRAWL_PRIVATE_REFUND_MAX_PAGES || 2);
  if (!Number.isFinite(configured)) return 2;
  return Math.max(1, Math.min(4, Math.trunc(configured)));
}

function normalizeHash(raw: unknown): string | null {
  const value = String(raw || '').trim().toLowerCase();
  return /^0x[a-f0-9]{64}$/.test(value) ? value : null;
}

function hexBigInt(raw: unknown): bigint | null {
  const value = String(raw || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function hexBlock(raw: unknown): number | null {
  const value = hexBigInt(raw);
  if (value === null || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

async function signedFlashbotsRpc<T>(method: string, params: unknown[]): Promise<T> {
  const authPrivateKey = await getOrCreateFlashbotsAuthPrivateKey();
  const signer = walletFromPrivateKey(authPrivateKey);
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  // Flashbots' documented relay authentication signs the EIP-191 message of the
  // keccak256 JSON body using an arbitrary reputation/auth key, never trade funds.
  const signature = await signer.signMessage(ethers.utils.id(body));
  const envelope = await fetchJsonWithRetry<FlashbotsRpcEnvelope<T>>(FLASHBOTS_RELAY_URL, {
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-flashbots-signature': `${signer.address}:${signature}`,
      },
      body,
    },
    maxRetries: 1,
    timeoutMs: 6_000,
  });
  if (envelope.error) {
    throw new Error(`Flashbots ${method} failed: ${envelope.error.message || envelope.error.code || 'unknown error'}`);
  }
  if (envelope.result === undefined) throw new Error(`Flashbots ${method} returned no result`);
  return envelope.result;
}

async function recipientAddresses(): Promise<string[]> {
  const addresses = new Set<string>();
  const execution = resolveExecutionWalletAddress();
  if (execution.address) addresses.add(execution.address);

  // Fee refunds from the private transaction API default to the request/auth
  // signer unless a delegation is explicitly configured. Querying both controlled
  // identities preserves already-earned evidence without moving any funds.
  try {
    const authKey = await getOrCreateFlashbotsAuthPrivateKey();
    addresses.add(walletFromPrivateKey(authKey).address);
  } catch {
    // Missing Flashbots auth disables this optional evidence surface only.
  }
  return [...addresses];
}

async function fetchRecipientRows(recipient: string): Promise<MeasuredPrivateRefundEvidence[]> {
  const rows: MeasuredPrivateRefundEvidence[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages(); page += 1) {
    const result = await signedFlashbotsRpc<FlashbotsFeeRefundPage>(
      'flashbots_getFeeRefundsByRecipient',
      [{ recipient, ...(cursor ? { cursor } : {}) }],
    );
    for (const raw of result.refunds || []) {
      const hash = normalizeHash(raw.hash);
      const amountWei = hexBigInt(raw.amount);
      const status = raw.status === 'received' ? 'received' : raw.status === 'pending' ? 'pending' : null;
      if (!hash || amountWei === null || amountWei <= 0n || !status) continue;
      rows.push({
        hash,
        recipient,
        status,
        amountWei,
        blockNumber: hexBlock(raw.blockNumber),
        observedAt: Date.now(),
        source: 'flashbots_fee_refund_rpc',
        executionAuthority: false,
        deterministicAdmissionCredit: false,
      });
    }
    cursor = typeof result.cursor === 'string' && result.cursor.trim() ? result.cursor : undefined;
    if (!cursor) break;
  }
  return rows;
}

export async function refreshPrivateRefundEvidence(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const recipients = await recipientAddresses();
    if (recipients.length === 0) {
      lastError = 'No controlled execution or Flashbots auth recipient is configured';
      return;
    }

    const settled = await Promise.allSettled(recipients.map(async recipient => ({
      recipient,
      rows: await fetchRecipientRows(recipient),
    })));
    let successes = 0;
    const next = new Map<string, MeasuredPrivateRefundEvidence[]>();
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      successes += 1;
      observedRecipients.add(result.value.recipient);
      for (const row of result.value.rows) {
        const bucket = next.get(row.hash) || [];
        bucket.push(row);
        next.set(row.hash, bucket);
      }
    }
    if (successes === 0) {
      const firstFailure = settled.find(result => result.status === 'rejected') as PromiseRejectedResult | undefined;
      throw firstFailure?.reason || new Error('Flashbots refund evidence refresh failed for every recipient');
    }

    evidenceByHash.clear();
    for (const [hash, rows] of next.entries()) evidenceByHash.set(hash, rows);
    lastObservedAt = Date.now();
    lastError = null;

    const snapshot = getPrivateRefundEvidenceSnapshot();
    logger.info('[BpsPrivateRefund] Measured private-transport refund evidence refreshed', {
      component: 'BpsPrivateRefundEvidence',
      recipients: snapshot.recipients.length,
      receivedRefunds: snapshot.receivedRefunds,
      pendingRefunds: snapshot.pendingRefunds,
      receivedWei: snapshot.receivedWei,
      pendingWei: snapshot.pendingWei,
      deterministicAdmissionCredit: false,
      terminalRealizedEvidenceOnly: true,
      executionAuthority: false,
    });
  })()
    .catch(error => {
      lastError = error instanceof Error ? error.message : String(error);
      logger.debug('[BpsPrivateRefund] Refund evidence refresh unavailable; canonical execution/economics remain unchanged', {
        component: 'BpsPrivateRefundEvidence',
        error: lastError,
        canonicalExecutionBlocked: false,
        syntheticSavingsIntroduced: false,
        executionAuthority: false,
      });
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export function getMeasuredPrivateRefundEvidence(hashRaw: string): MeasuredPrivateRefundEvidence[] {
  const hash = normalizeHash(hashRaw);
  if (!hash) return [];
  return (evidenceByHash.get(hash) || []).map(row => ({ ...row }));
}

/**
 * Returns only money already marked RECEIVED by Flashbots. Pending or forecast
 * refunds are deliberately excluded so they can never turn a negative candidate
 * positive before execution.
 */
export function receivedPrivateRefundWei(hashRaw: string): bigint {
  return getMeasuredPrivateRefundEvidence(hashRaw)
    .filter(row => row.status === 'received')
    .reduce((sum, row) => sum + row.amountWei, 0n);
}

export function measuredReceivedPrivateRefundBps(
  hashRaw: string,
  notionalUsd: number,
  ethUsd: number,
): number | null {
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0 || !Number.isFinite(ethUsd) || ethUsd <= 0) return null;
  const refundWei = receivedPrivateRefundWei(hashRaw);
  if (refundWei <= 0n) return null;
  const refundEth = Number(ethers.utils.formatEther(refundWei));
  if (!Number.isFinite(refundEth) || refundEth <= 0) return null;
  return (refundEth * ethUsd / notionalUsd) * 10_000;
}

export function getPrivateRefundEvidenceSnapshot(): PrivateRefundEvidenceSnapshot {
  let receivedRefunds = 0;
  let pendingRefunds = 0;
  let receivedWei = 0n;
  let pendingWei = 0n;
  for (const rows of evidenceByHash.values()) {
    for (const row of rows) {
      if (row.status === 'received') {
        receivedRefunds += 1;
        receivedWei += row.amountWei;
      } else {
        pendingRefunds += 1;
        pendingWei += row.amountWei;
      }
    }
  }
  return {
    observedAt: lastObservedAt,
    recipients: [...observedRecipients],
    receivedRefunds,
    pendingRefunds,
    receivedWei: receivedWei.toString(),
    pendingWei: pendingWei.toString(),
    lastError,
    authority: 'terminal_realized_refund_evidence_only',
    executionAuthority: false,
    deterministicAdmissionCredit: false,
  };
}

export function ensureBpsPrivateRefundEvidenceWiring(): void {
  if (installed) return;
  installed = true;
  void refreshPrivateRefundEvidence();
  timer = setInterval(() => void refreshPrivateRefundEvidence(), pollingIntervalMs());
  timer.unref?.();
  logger.info('[BpsPrivateRefund] Realized private-refund evidence wiring installed', {
    component: 'BpsPrivateRefundEvidence',
    source: 'Flashbots fee-refund RPC',
    pendingRefundAdmissionCredit: false,
    forecastRefundAdmissionCredit: false,
    executionAuthority: false,
  });
}

export function stopBpsPrivateRefundEvidenceWiring(): void {
  if (timer) clearInterval(timer);
  timer = null;
  installed = false;
}
