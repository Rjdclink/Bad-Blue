import logger from '../../../logger.js';
import {
  registerGhostWalletBorrowerMandate,
  type GhostWalletBorrowerMandateInput,
} from './ghost-wallet-borrower-mandate.js';
import { ghostWalletIntermediaryBootstrap } from './ghost-wallet-intermediary-bootstrap.js';
import type { GhostWalletChain } from './ghost-wallet-provider-mesh.js';

const CHAINS = new Set<GhostWalletChain>(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche']);
const DEFAULT_POLL_MS = 10_000;
const MIN_POLL_MS = 1_000;
const MAX_POLL_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 4_000;
const MAX_BODY_BYTES = 1_048_576;
const MAX_FEEDS = 32;
const MAX_DEMANDS_PER_RESPONSE = 256;
const MAX_VERIFY_CONCURRENCY = 8;

interface ConfiguredFeed {
  id: string;
  url: string;
  pollMs: number;
  headerEnv: Record<string, string>;
}

interface FeedState {
  feed: ConfiguredFeed;
  timer: NodeJS.Timeout | null;
  inFlight: boolean;
  consecutiveFailures: number;
  nextAllowedAt: number;
  etag: string | null;
  lastModified: string | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  accepted: number;
  rejected: number;
  lastError: string | null;
}

interface FeedResponse {
  version?: unknown;
  demands?: unknown;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function asHttpsUrl(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return null;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function configuredFeeds(): ConfiguredFeed[] {
  const raw = process.env.GHOST_WALLET_BORROWER_DEMAND_FEEDS_JSON?.trim();
  if (!raw) return [];
  let rows: unknown;
  try { rows = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(rows)) return [];

  const unique = new Map<string, ConfiguredFeed>();
  for (const [index, row] of rows.slice(0, MAX_FEEDS).entries()) {
    if (!row || typeof row !== 'object' || (row as any).enabled === false) continue;
    const url = asHttpsUrl((row as any).url);
    if (!url) continue;
    const id = String((row as any).id || `feed-${index}`).trim().slice(0, 120) || `feed-${index}`;
    const headerEnvRaw = (row as any).headerEnv;
    const headerEnv: Record<string, string> = {};
    if (headerEnvRaw && typeof headerEnvRaw === 'object' && !Array.isArray(headerEnvRaw)) {
      for (const [header, envName] of Object.entries(headerEnvRaw)) {
        const safeHeader = String(header).trim();
        const safeEnv = String(envName || '').trim();
        if (!safeHeader || !safeEnv || safeHeader.length > 100 || safeEnv.length > 160) continue;
        headerEnv[safeHeader] = safeEnv;
      }
    }
    const feed: ConfiguredFeed = {
      id,
      url,
      pollMs: boundedInt((row as any).pollMs, DEFAULT_POLL_MS, MIN_POLL_MS, MAX_POLL_MS),
      headerEnv,
    };
    unique.set(url, feed);
  }
  return [...unique.values()];
}

function timeoutMs(): number {
  return boundedInt(process.env.GHOST_WALLET_BORROWER_FEED_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 500, 15_000);
}

function retryDelayMs(feed: ConfiguredFeed, failures: number, retryAfterMs?: number | null): number {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(MAX_POLL_MS, Math.max(feed.pollMs, retryAfterMs));
  const exponential = Math.min(MAX_POLL_MS, feed.pollMs * (2 ** Math.min(6, Math.max(0, failures - 1))));
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.max(feed.pollMs, Math.round(exponential * jitter));
}

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function demandInput(value: unknown): GhostWalletBorrowerMandateInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const chain = String(row.chain || '').trim().toLowerCase() as GhostWalletChain;
  if (!CHAINS.has(chain)) return null;
  return {
    chain,
    borrower: String(row.borrower || ''),
    asset: String(row.asset || ''),
    amountBaseUnits: row.amountBaseUnits === undefined ? undefined : String(row.amountBaseUnits),
    minAmountBaseUnits: row.minAmountBaseUnits === undefined ? undefined : String(row.minAmountBaseUnits),
    preferredAmountBaseUnits: row.preferredAmountBaseUnits === undefined ? undefined : String(row.preferredAmountBaseUnits),
    maxAmountBaseUnits: row.maxAmountBaseUnits === undefined ? undefined : String(row.maxAmountBaseUnits),
    maxBorrowerFeeBaseUnits: String(row.maxBorrowerFeeBaseUnits || ''),
    borrowerData: row.borrowerData === undefined ? undefined : String(row.borrowerData),
    authorizer: String(row.authorizer || ''),
    nonce: String(row.nonce ?? ''),
    deadline: Number(row.deadline),
    maxExecutions: Number(row.maxExecutions),
    minIntervalSeconds: row.minIntervalSeconds === undefined ? undefined : Number(row.minIntervalSeconds),
    signature: String(row.signature || ''),
  };
}

async function mapBounded<T>(items: readonly T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runner = async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await work(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) }, () => runner()));
}

class GhostWalletBorrowerDemandMesh {
  private running = false;
  private readonly states = new Map<string, FeedState>();

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    ghostWalletIntermediaryBootstrap.start();
    const feeds = configuredFeeds();
    for (const feed of feeds) {
      const state: FeedState = {
        feed,
        timer: null,
        inFlight: false,
        consecutiveFailures: 0,
        nextAllowedAt: 0,
        etag: null,
        lastModified: null,
        lastAttemptAt: null,
        lastSuccessAt: null,
        accepted: 0,
        rejected: 0,
        lastError: null,
      };
      this.states.set(feed.id, state);
      queueMicrotask(() => { void this.refresh(state); });
    }
    logger.info('[GhostWalletDemand] Signed borrower demand mesh started', {
      component: 'GhostWalletBorrowerDemandMesh',
      configuredFeeds: feeds.length,
      directSignedRegistrationRemainsEnabled: true,
      feedItemsRequireExistingCryptographicMandateVerification: true,
      genericTradeIntentsAcceptedAsBorrowers: false,
      successfulAtomicRepaymentStillRequiredForTrustedBorrower: true,
      matchedIntentIntermediaryAutoBootstrap: true,
      matchedIntentIntermediaryGasAuthority: 'pimlico_sponsored_user_operation',
      zeroCapitalDependency: false,
    });
  }

  stop(): void {
    this.running = false;
    ghostWalletIntermediaryBootstrap.stop();
    for (const state of this.states.values()) if (state.timer) clearTimeout(state.timer);
    this.states.clear();
  }

  getStatus() {
    return {
      running: this.running,
      configuredFeeds: this.states.size,
      feeds: [...this.states.values()].map(state => ({
        id: state.feed.id,
        urlOrigin: (() => { try { return new URL(state.feed.url).origin; } catch { return 'invalid'; } })(),
        pollMs: state.feed.pollMs,
        consecutiveFailures: state.consecutiveFailures,
        nextAllowedAt: state.nextAllowedAt || null,
        lastAttemptAt: state.lastAttemptAt,
        lastSuccessAt: state.lastSuccessAt,
        accepted: state.accepted,
        rejected: state.rejected,
        lastError: state.lastError,
      })),
      directSignedRegistration: true,
      cryptographicAdmissionAuthority: 'registerGhostWalletBorrowerMandate',
      genericOrderBooksAreNotBorrowerAuthority: true,
      matchedIntentIntermediaryBootstrap: ghostWalletIntermediaryBootstrap.getStatus(),
    };
  }

  requestRefresh(): void {
    for (const state of this.states.values()) {
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      queueMicrotask(() => { void this.refresh(state); });
    }
  }

  private schedule(state: FeedState, delayMs: number): void {
    if (!this.running) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      void this.refresh(state);
    }, Math.max(MIN_POLL_MS, delayMs));
    state.timer.unref?.();
  }

  private async refresh(state: FeedState): Promise<void> {
    if (!this.running || state.inFlight) return;
    const now = Date.now();
    if (state.nextAllowedAt > now) {
      this.schedule(state, state.nextAllowedAt - now);
      return;
    }
    state.inFlight = true;
    state.lastAttemptAt = now;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs());
    timer.unref?.();
    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (state.etag) headers['if-none-match'] = state.etag;
      if (state.lastModified) headers['if-modified-since'] = state.lastModified;
      for (const [header, envName] of Object.entries(state.feed.headerEnv)) {
        const value = process.env[envName]?.trim();
        if (value) headers[header] = value;
      }
      const response = await fetch(state.feed.url, { method: 'GET', headers, signal: controller.signal, redirect: 'error' });
      if (response.status === 304) {
        state.consecutiveFailures = 0;
        state.lastSuccessAt = Date.now();
        state.lastError = null;
        state.nextAllowedAt = Date.now() + state.feed.pollMs;
        return;
      }
      if (!response.ok) {
        const error = new Error(`GHOST_WALLET_BORROWER_FEED_HTTP_${response.status}`) as Error & { retryAfterMs?: number | null };
        error.retryAfterMs = retryAfterMs(response);
        throw error;
      }
      const length = Number(response.headers.get('content-length') || 0);
      if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new Error('GHOST_WALLET_BORROWER_FEED_BODY_TOO_LARGE');
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new Error('GHOST_WALLET_BORROWER_FEED_BODY_TOO_LARGE');
      const parsed = JSON.parse(text) as FeedResponse;
      const demands = Array.isArray(parsed.demands) ? parsed.demands.slice(0, MAX_DEMANDS_PER_RESPONSE) : [];
      await mapBounded(demands, MAX_VERIFY_CONCURRENCY, async rawDemand => {
        const input = demandInput(rawDemand);
        if (!input) {
          state.rejected += 1;
          return;
        }
        try {
          await registerGhostWalletBorrowerMandate(input);
          state.accepted += 1;
        } catch {
          state.rejected += 1;
        }
      });
      state.etag = response.headers.get('etag') || state.etag;
      state.lastModified = response.headers.get('last-modified') || state.lastModified;
      state.consecutiveFailures = 0;
      state.lastSuccessAt = Date.now();
      state.lastError = null;
      state.nextAllowedAt = Date.now() + state.feed.pollMs;
    } catch (error) {
      state.consecutiveFailures += 1;
      state.lastError = error instanceof Error ? error.message : String(error);
      const retryAfter = Number((error as { retryAfterMs?: number | null } | null)?.retryAfterMs || 0) || null;
      const delay = retryDelayMs(state.feed, state.consecutiveFailures, retryAfter);
      state.nextAllowedAt = Date.now() + delay;
      logger.debug('[GhostWalletDemand] Borrower demand feed degraded locally', {
        component: 'GhostWalletBorrowerDemandMesh',
        feedId: state.feed.id,
        error: state.lastError,
        retryInMs: delay,
        routeLocalFailure: true,
      });
    } finally {
      clearTimeout(timer);
      state.inFlight = false;
      if (this.running) this.schedule(state, Math.max(MIN_POLL_MS, state.nextAllowedAt - Date.now()));
    }
  }
}

export const ghostWalletBorrowerDemandMesh = new GhostWalletBorrowerDemandMesh();

export const GHOST_WALLET_BORROWER_DEMAND_POLICY = {
  externalDemandSourcesOpenEndedByConfiguration: true,
  httpsOnly: true,
  signedMandateVerificationRequired: true,
  eip712OrErc1271AuthorityPreserved: true,
  nonceReplayProtectionPreserved: true,
  directSignedPushRegistrationPreserved: true,
  genericTradeIntentAdmission: false,
  bytecodeOnlyBorrowerTrust: false,
  atomicRepaymentEvidenceStillRequiredForVerifiedStatus: true,
  matchedIntentIntermediaryAutoBootstrap: true,
  matchedIntentIntermediaryDeploymentGasAuthority: 'pimlico_sponsored_user_operation',
  boundedFeedCount: MAX_FEEDS,
  boundedResponseDemandCount: MAX_DEMANDS_PER_RESPONSE,
  boundedVerificationConcurrency: MAX_VERIFY_CONCURRENCY,
  etagConditionalRefresh: true,
  throttleBackoffWithJitter: true,
  zeroCapitalIntegration: false,
} as const;
