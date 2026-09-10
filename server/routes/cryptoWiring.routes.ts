import express from 'express';
import { getCryptara } from '../services/cryptara';
import { pipeline } from '../services/cryptocrawl/integration/master-pipeline.js';
import { quoteGhostWalletBorrowerRoute } from '../services/cryptocrawl/ghost-wallet/ghost-wallet-borrower-surface.js';
import { getGhostWalletExternalBridgeDescriptor } from '../services/cryptocrawl/ghost-wallet/ghost-wallet-external-bridge.js';
import { ghostWalletProviderMesh, type GhostWalletChain } from '../services/cryptocrawl/ghost-wallet/ghost-wallet-provider-mesh.js';
import { createLogger } from '../logger';

const log = createLogger('crypto-wiring');
const router = express.Router();
const GHOST_CHAINS = new Set<GhostWalletChain>(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche']);
const GHOST_QUOTE_RATE_WINDOW_MS = 60_000;
const ghostQuoteRate = new Map<string, { startedAt: number; count: number }>();

type WireVerdict = 'PASS' | 'FAIL';

interface WireCheckResponse {
  ok: boolean;
  stage: 5;
  noExecution: boolean;
  noIntervals: boolean;
  cryptaraMode: string;
  signal: {
    type: 'sentiment';
    output: unknown;
  };
  decision: {
    verdict: WireVerdict;
    reason: string;
  };
  executionStub: {
    executed: false;
    reason: string;
  };
}

function truthyEnv(name: string): boolean {
  return process.env[name] === 'true';
}

function boundedPositiveInt(name: string, fallback: number, ceiling: number): number {
  const raw = Number(process.env[name] || fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.min(ceiling, Math.trunc(raw)));
}

function ghostChain(value: unknown): GhostWalletChain {
  const chain = String(value || '').trim().toLowerCase() as GhostWalletChain;
  if (!GHOST_CHAINS.has(chain)) throw new Error('GHOST_WALLET_CHAIN_UNSUPPORTED');
  return chain;
}

function enforceGhostQuoteRequestBounds(req: express.Request): void {
  const maxCandidates = boundedPositiveInt('GHOST_WALLET_MAX_LENDER_CANDIDATES_PER_REQUEST', 32, 256);
  const candidates = req.body?.lenderCandidates;
  if (Array.isArray(candidates) && candidates.length > maxCandidates) {
    throw new Error(`GHOST_WALLET_LENDER_CANDIDATE_LIMIT_EXCEEDED:${maxCandidates}`);
  }

  const borrowerData = req.body?.borrowerData;
  if (borrowerData !== undefined) {
    const value = String(borrowerData);
    const maxBytes = boundedPositiveInt('GHOST_WALLET_MAX_BORROWER_DATA_BYTES', 16_384, 131_072);
    const payloadBytes = value.startsWith('0x') ? Math.ceil(Math.max(0, value.length - 2) / 2) : Buffer.byteLength(value);
    if (payloadBytes > maxBytes) throw new Error(`GHOST_WALLET_BORROWER_DATA_LIMIT_EXCEEDED:${maxBytes}`);
  }

  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const limit = boundedPositiveInt('GHOST_WALLET_QUOTE_REQUESTS_PER_MINUTE', 30, 600);
  const existing = ghostQuoteRate.get(key);
  if (!existing || now - existing.startedAt >= GHOST_QUOTE_RATE_WINDOW_MS) {
    ghostQuoteRate.set(key, { startedAt: now, count: 1 });
  } else {
    existing.count += 1;
    if (existing.count > limit) throw new Error(`GHOST_WALLET_QUOTE_RATE_LIMIT_EXCEEDED:${limit}`);
  }

  if (ghostQuoteRate.size > 10_000) {
    for (const [entryKey, value] of ghostQuoteRate) {
      if (now - value.startedAt >= GHOST_QUOTE_RATE_WINDOW_MS) ghostQuoteRate.delete(entryKey);
    }
  }
}

router.post('/wire-check', async (_req, res) => {
  const noExecution = truthyEnv('NO_EXECUTION');
  const noIntervals = truthyEnv('NO_INTERVALS');
  const cryptaraMode = process.env.CRYPTARA_MODE || 'UNSET';

  try {
    // Signal synthesis: on-demand call only (no timers)
    const cryptara = getCryptara();
    await cryptara.initialize();
    const sentiment = await cryptara.analyzeSentiment();

    // Decision engine: deterministic gate for Stage 5
    const verdict: WireVerdict = (noExecution && noIntervals) ? 'PASS' : 'FAIL';
    const reason = verdict === 'PASS'
      ? 'Stage 5 gate satisfied (NO_EXECUTION + NO_INTERVALS)'
      : 'Stage 5 gate failed: require NO_EXECUTION=true and NO_INTERVALS=true';

    const response: WireCheckResponse = {
      ok: verdict === 'PASS',
      stage: 5,
      noExecution,
      noIntervals,
      cryptaraMode,
      signal: { type: 'sentiment', output: sentiment },
      decision: { verdict, reason },
      executionStub: { executed: false, reason: 'Execution disabled in Stage 5' },
    };

    return res.json(response);
  } catch (error: any) {
    log.error('Wire-check failed', { error: error?.message ?? String(error) });
    return res.status(500).json({
      ok: false,
      stage: 5,
      error: error?.message ?? String(error),
    });
  }
});

/**
 * Public Ghost Wallet capability manifest. This endpoint never submits a
 * transaction and exposes no secrets. A not-yet-deployed deterministic bridge
 * includes permissionless CREATE2 bootstrap calldata so an integrator/borrower,
 * not the operator, can fund the one-time deployment transaction.
 */
router.get('/ghost-wallet/capabilities', async (_req, res) => {
  try {
    await ghostWalletProviderMesh.initialize();
    const descriptors = await Promise.allSettled(
      ghostWalletProviderMesh.getReadyChains().map(chain => getGhostWalletExternalBridgeDescriptor(chain)),
    );
    return res.json({
      ok: true,
      model: 'borrow_upstream_then_atomically_lend_downstream',
      transactionPayer: 'caller',
      operatorMonetaryInputRequired: false,
      fixedBpsProfitFloor: false,
      minimumPositiveSpread: 'one_smallest_token_unit_when_configured_spread_bps_is_zero',
      lenderUniverseHardLimit: null,
      borrowerUniverseHardLimit: null,
      perRequestLenderCandidateLimit: boundedPositiveInt('GHOST_WALLET_MAX_LENDER_CANDIDATES_PER_REQUEST', 32, 256),
      perRequestBorrowerDataBytesLimit: boundedPositiveInt('GHOST_WALLET_MAX_BORROWER_DATA_BYTES', 16_384, 131_072),
      perIpQuoteRequestsPerMinute: boundedPositiveInt('GHOST_WALLET_QUOTE_REQUESTS_PER_MINUTE', 30, 600),
      adapters: ['erc3156', 'aave_v3', 'morpho_blue', 'balancer_v2'],
      alchemyDependency: false,
      providerMesh: ghostWalletProviderMesh.getStatus(),
      bridges: descriptors.flatMap(result => result.status === 'fulfilled' ? [result.value] : []),
      unavailableChains: descriptors.flatMap(result => result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
        : []),
    });
  } catch (error: any) {
    log.warn('Ghost Wallet capability manifest unavailable', { error: error?.message ?? String(error) });
    return res.status(503).json({ ok: false, error: error?.message ?? String(error) });
  }
});

/**
 * On-demand borrower quote. Work occurs only because a borrower asks; there is no
 * scanning timer. All healthy Ghost RPCs and implemented lender adapters are
 * measured in parallel, and the cheapest live same-asset route is returned.
 */
router.post('/ghost-wallet/quote', async (req, res) => {
  try {
    enforceGhostQuoteRequestBounds(req);
    const chain = ghostChain(req.body?.chain);
    const candidates = Array.isArray(req.body?.lenderCandidates)
      ? [...new Map(req.body.lenderCandidates.map((row: any) => {
          const address = String(row?.address || '');
          return [address.trim().toLowerCase(), {
            kind: 'erc3156' as const,
            address,
            ...(row?.label ? { label: String(row.label).slice(0, 128) } : {}),
          }];
        })).values()]
      : undefined;
    const quote = await quoteGhostWalletBorrowerRoute({
      chain,
      borrower: String(req.body?.borrower || ''),
      asset: String(req.body?.asset || ''),
      amountBaseUnits: String(req.body?.amountBaseUnits || ''),
      borrowerData: req.body?.borrowerData === undefined ? undefined : String(req.body.borrowerData),
      lenderCandidates: candidates,
    });
    return res.json({ ok: true, quote });
  } catch (error: any) {
    const message = error?.message ?? String(error);
    const unavailable = /UNAVAILABLE|NO_COMPATIBLE|UNSUPPORTED/.test(message);
    const rateLimited = /RATE_LIMIT_EXCEEDED/.test(message);
    const requestTooLarge = /CANDIDATE_LIMIT_EXCEEDED|DATA_LIMIT_EXCEEDED/.test(message);
    log.warn('Ghost Wallet borrower quote failed closed', { error: message });
    if (rateLimited) res.setHeader('Retry-After', '60');
    return res.status(rateLimited ? 429 : requestTooLarge ? 413 : unavailable ? 503 : 400).json({ ok: false, error: message });
  }
});

router.post('/deployment-review', async (_req, res) => {
  try {
    const review = await pipeline.reviewDeploymentReadiness({ passes: 2 });
    return res.json({ ok: review.finalStatus === 'ready', review });
  } catch (error: any) {
    log.error('Deployment review failed', { error: error?.message ?? String(error) });
    return res.status(500).json({
      ok: false,
      error: error?.message ?? String(error),
    });
  }
});

export default router;