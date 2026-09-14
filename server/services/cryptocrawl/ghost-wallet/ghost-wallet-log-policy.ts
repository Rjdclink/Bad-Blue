const BSC_MAINNET_ENDPOINTS_WITHOUT_ETH_GET_LOGS = new Set([
  'bsc-dataseed.binance.org',
  'bsc-dataseed.bnbchain.org',
  'bsc-dataseed.nariox.org',
  'bsc-dataseed.defibit.io',
  'bsc-dataseed.ninicoin.io',
  'bsc.nodereal.io',
  'bsc-dataseed-public.bnbchain.org',
  'rpc-bnb.blockmachine.io',
]);

export const GHOST_WALLET_MAX_LOG_BLOCK_SPAN = 1_999;

export type GhostWalletDeploymentState = 'deployed' | 'undeployed' | 'unverified';

export function ghostWalletLogWindowEnd(fromBlock: number, latestBlock: number): number {
  if (!Number.isSafeInteger(fromBlock) || !Number.isSafeInteger(latestBlock) || fromBlock < 0 || latestBlock < fromBlock) {
    throw new Error('GHOST_WALLET_LOG_WINDOW_INVALID');
  }
  return Math.min(latestBlock, fromBlock + GHOST_WALLET_MAX_LOG_BLOCK_SPAN - 1);
}

export function ghostWalletDeploymentStateFromCodes(
  observedCodes: string[],
  candidateCount: number,
): GhostWalletDeploymentState {
  if (observedCodes.some(code => code !== '0x')) return 'deployed';
  const requiredNoCodeAgreement = Math.min(2, Math.max(0, Math.trunc(candidateCount)));
  if (requiredNoCodeAgreement > 0 && observedCodes.length >= requiredNoCodeAgreement) return 'undeployed';
  return 'unverified';
}

function collectErrorParts(
  value: unknown,
  parts: string[],
  visited: Set<object>,
  depth: number,
): void {
  if (value === null || value === undefined || depth > 5) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    parts.push(String(value));
    if (typeof value === 'string' && /^\s*[\[{]/.test(value)) {
      try { collectErrorParts(JSON.parse(value), parts, visited, depth + 1); } catch { /* not JSON */ }
    }
    return;
  }
  if (typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  const record = value as Record<string, unknown>;
  for (const key of ['message', 'reason', 'shortMessage', 'code', 'body', 'details', 'error', 'response', 'data']) {
    if (key in record) collectErrorParts(record[key], parts, visited, depth + 1);
  }
}

export function ghostWalletRpcErrorText(error: unknown): string {
  const parts: string[] = [];
  collectErrorParts(error, parts, new Set<object>(), 0);
  return parts.join(' ');
}

export function isGhostWalletLogRangeLimitError(error: unknown): boolean {
  const text = ghostWalletRpcErrorText(error);
  return /block range|range limit|maximum (?:block )?range|max (?:block )?range|query returned more than|too many (?:results|logs)|response size exceeded|log response size exceeded|limit exceeded|-32005\b/i.test(text);
}

export function isGhostWalletArchiveUnavailableError(error: unknown): boolean {
  const text = ghostWalletRpcErrorText(error);
  return /archive requests?.*(?:token|key|required)|historical (?:state|data).*(?:unavailable|unsupported)|missing trie node|pruned (?:state|history)|old events?.*(?:discarded|unavailable)/i.test(text);
}

export function isGhostWalletThrottleError(error: unknown): boolean {
  const text = ghostWalletRpcErrorText(error);
  return /rate limit|too many requests|throttl|request limit|limit exceeded|\b429\b|-32005\b/i.test(text)
    || /(?:^|\s)15(?:\s|$)/.test(text);
}

export function ghostWalletProviderSupportsSettlementLogs(chain: string, rawUrl: string): boolean {
  if (chain.trim().toLowerCase() !== 'bsc') return true;
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return !BSC_MAINNET_ENDPOINTS_WITHOUT_ETH_GET_LOGS.has(hostname);
  } catch {
    return false;
  }
}
