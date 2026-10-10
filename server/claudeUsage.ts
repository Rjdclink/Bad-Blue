import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface UsageScope {
  turnId: string;
  calls: number;
  pending: number;
  unmetered: number;
  estimatedUsd: number;
  searches: number;
  reportRequested?: boolean;
}
const scopes = new AsyncLocalStorage<UsageScope>();
function rates(model: string, totalInputTokens: number) {
  if (/^claude-haiku-5-5$/i.test(model)) return totalInputTokens > 100_000
    ? { input: 0.5, output: 2.5, read: 0.05, write: 0.625 }
    : { input: 0.1, output: 0.5, read: 0.01, write: 0.125 };
  if (/claude-sonnet-5-5/i.test(model)) return { input: 2, output: 10, read: 0.1, write: 2.5 };
  if (/claude-opus-5-5/i.test(model)) return { input: 4, output: 20, read: 0.2, write: 5 };
  return null;
}
export function runClaudeUsageScope<T>(run: () => T): T {
  return scopes.run({ turnId: randomUUID(), calls: 0, pending: 0, unmetered: 0, estimatedUsd: 0, searches: 0 }, run);
}
function reportScope(scope: UsageScope): void {
  const { reportRequested, ...totals } = scope;
  console.info('[Claude Turn Usage]', {
    ...totals, estimatedUsd: Number(scope.estimatedUsd.toFixed(8)),
    complete: scope.pending === 0 && scope.unmetered === 0,
    costBasis: 'received API usage at published standard rates; excludes tax and other providers',
  });
}
export function createClaudeUsageReporter(): () => void {
  const scope = scopes.getStore();
  return () => {
    if (!scope) return;
    scope.reportRequested = true;
    reportScope(scope);
  };
}
export async function meterClaudeRequest<T extends { usage?: any }>(
  model: string, operation: string, request: () => Promise<T>,
): Promise<T> {
  const scope = scopes.getStore();
  if (scope) { scope.calls += 1; scope.pending += 1; }
  try {
    const response = await request();
    const usage = response.usage;
    const inputTokens = Number(usage?.input_tokens || 0);
    const outputTokens = Number(usage?.output_tokens || 0);
    const cacheReadInputTokens = Number(usage?.cache_read_input_tokens || 0);
    const cacheCreationInputTokens = Number(usage?.cache_creation_input_tokens || 0);
    const price = rates(model, inputTokens + cacheReadInputTokens + cacheCreationInputTokens);
    const searches = Number(usage?.server_tool_use?.web_search_requests || 0);
    const estimatedUsd = usage && price
      ? (inputTokens * price.input + outputTokens * price.output
        + cacheReadInputTokens * price.read + cacheCreationInputTokens * price.write) / 1_000_000
        + searches * 0.01
      : null;
    if (scope) {
      if (estimatedUsd === null) scope.unmetered += 1;
      else scope.estimatedUsd += estimatedUsd;
      scope.searches += searches;
    }
    console.info('[Claude Request Usage]', {
      turnId: scope?.turnId || null, model, operation, inputTokens, outputTokens,
      cacheReadInputTokens, cacheCreationInputTokens, searches,
      estimatedUsd: estimatedUsd === null ? null : Number(estimatedUsd.toFixed(8)),
      complete: estimatedUsd !== null,
    });
    return response;
  } catch (error) {
    if (scope) scope.unmetered += 1;
    console.warn('[Claude Request Usage]', {
      turnId: scope?.turnId || null, model, operation, complete: false,
      estimatedUsd: null, reason: 'request ended without API usage; billing must be reconciled',
    });
    throw error;
  } finally {
    if (scope) {
      scope.pending -= 1;
      if (scope.reportRequested && scope.pending === 0) reportScope(scope);
    }
  }
}

