import express from 'express';
import { getCryptara } from '../services/cryptara';
import { pipeline } from '../services/cryptocrawl/integration/master-pipeline.js';
import { ghostWalletAutonomousController } from '../services/cryptocrawl/ghost-wallet/ghost-wallet-autonomous-controller.js';
import { quoteGhostWalletBorrowerRoute } from '../services/cryptocrawl/ghost-wallet/ghost-wallet-borrower-surface.js';
import {
  cancelGhostWalletBorrowerMandate,
  registerGhostWalletBorrowerMandate,
} from '../services/cryptocrawl/ghost-wallet/ghost-wallet-borrower-mandate.js';
import { getGhostWalletExternalBridgeDescriptor } from '../services/cryptocrawl/ghost-wallet/ghost-wallet-external-bridge.js';
import { getGhostWalletPerformanceSnapshot } from '../services/cryptocrawl/ghost-wallet/ghost-wallet-performance-intelligence.js';
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
  signal: { type: 'sentiment'; output: unknown };
  decision: { verdict: WireVerdict; reason: string };
  executionStub: { executed: false; reason: string };
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

function enforceGhostRequestBounds(req: express.Request): void {
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
    const cryptara = getCryptara();
    await cryptara.initialize();
    const sentiment = await cryptara.analyzeSentiment();
    const verdict: WireVerdict = (noExecution && noIntervals) ? 'PASS' : 'FAIL';
    const reason = verdict === 'PASS'
      ? 'Stage 5 gate satisfied (NO_EXECUTION + NO_INTERVALS)'
      : 'Stage 5 gate failed: require NO_EXECUTION=true and NO_INTERVALS=true';
    const response: WireCheckResponse = {
      ok: verdict === 'PASS', stage: 5, noExecution, noIntervals, cryptaraMode,
      signal: { type: 'sentiment', output: sentiment },
      decision: { verdict, reason },
      executionStub: { executed: false, reason: 'Execution disabled in Stage 5' },
    };
    return res.json(response);
  } catch (error: any) {
    log.error('Wire-check failed', { error: error?.message ?? String(error) });
    return res.status(500).json({ ok: false, stage: 5, error: error?.message ?? String(error) });
  }
});

router.get('/ghost-wallet/capabilities', async (_req, res) => {
  try {
    await ghostWalletProviderMesh.initialize();
    const descriptors = await Promise.allSettled(
      ghostWalletProviderMesh.getReadyChains().map(chain => getGhostWalletExternalBridgeDescriptor(chain)),
    );
    return res.json({
      ok: true,
      model: 'borrow_upstream_then_atomically_lend_downstream',
      intermediarySubmitsTransactions: false,
      executionModes: ['external_caller', 'autonomous_controller_signed_mandate'],
      autonomousBorrowerAuthorization: ['borrower_erc1271', 'owner_eoa', 'owner_erc1271'],
      autonomousAmountAuthorization: ['exact_amount', 'signed_min_preferred_max_range'],
      operatorMonetaryInputRequiredForPrincipal: false,
      fixedBpsProfitFloor: false,
      perTransactionSpreadPricing: true,
      minimumPositiveSpread: 'one_smallest_token_unit_or_exact_gas_calibrated_higher_spread',
      lenderUniverseHardLimit: null,
      borrowerUniverseHardLimit: null,
      perRequestLenderCandidateLimit: boundedPositiveInt('GHOST_WALLET_MAX_LENDER_CANDIDATES_PER_REQUEST', 32, 256),
      perRequestBorrowerDataBytesLimit: boundedPositiveInt('GHOST_WALLET_MAX_BORROWER_DATA_BYTES', 16_384, 131_072),
      perIpQuoteRequestsPerMinute: boundedPositiveInt('GHOST_WALLET_QUOTE_REQUESTS_PER_MINUTE', 30, 600),
      adapters: ['erc3156', 'aave_v3', 'morpho_blue', 'balancer_v2'],
      adaptiveRpcHedging: true,
      providerCircuitBreaking: true,
      gasAdjustedAutonomousRouteSelection: true,
      dynamicRangeSizing: true,
      liveProfitabilityTelemetry: true,
      alchemyDependency: false,
      zeroCapitalExecutionAuthority: false,
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

router.get('/ghost-wallet/telemetry', (_req, res) => {
  return res.json({
    ok: true,
    authority: 'telemetry_only_terminal_settlement_remains_profit_truth',
    controller: ghostWalletAutonomousController.getStatus(),
    providers: ghostWalletProviderMesh.getStatus(),
    performance: getGhostWalletPerformanceSnapshot(),
  });
});

router.post('/ghost-wallet/quote', async (req, res) => {
  try {
    enforceGhostRequestBounds(req);
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

router.post('/ghost-wallet/borrower-mandate', async (req, res) => {
  try {
    enforceGhostRequestBounds(req);
    const mandate = await registerGhostWalletBorrowerMandate({
      chain: ghostChain(req.body?.chain),
      borrower: String(req.body?.borrower || ''),
      asset: String(req.body?.asset || ''),
      amountBaseUnits: req.body?.amountBaseUnits === undefined ? undefined : String(req.body.amountBaseUnits),
      minAmountBaseUnits: req.body?.minAmountBaseUnits === undefined ? undefined : String(req.body.minAmountBaseUnits),
      preferredAmountBaseUnits: req.body?.preferredAmountBaseUnits === undefined ? undefined : String(req.body.preferredAmountBaseUnits),
      maxAmountBaseUnits: req.body?.maxAmountBaseUnits === undefined ? undefined : String(req.body.maxAmountBaseUnits),
      maxBorrowerFeeBaseUnits: String(req.body?.maxBorrowerFeeBaseUnits || ''),
      borrowerData: req.body?.borrowerData === undefined ? undefined : String(req.body.borrowerData),
      authorizer: String(req.body?.authorizer || ''),
      nonce: String(req.body?.nonce ?? ''),
      deadline: Number(req.body?.deadline),
      maxExecutions: Number(req.body?.maxExecutions),
      minIntervalSeconds: req.body?.minIntervalSeconds === undefined ? undefined : Number(req.body.minIntervalSeconds),
      signature: String(req.body?.signature || ''),
    });
    return res.status(201).json({ ok: true, mandate });
  } catch (error: any) {
    const message = error?.message ?? String(error);
    const rateLimited = /RATE_LIMIT_EXCEEDED/.test(message);
    const unavailable = /UNAVAILABLE/.test(message);
    const requestTooLarge = /DATA_LIMIT_EXCEEDED/.test(message);
    log.warn('Ghost Wallet borrower mandate rejected', { error: message });
    if (rateLimited) res.setHeader('Retry-After', '60');
    return res.status(rateLimited ? 429 : requestTooLarge ? 413 : unavailable ? 503 : 400).json({ ok: false, error: message });
  }
});

router.post('/ghost-wallet/borrower-mandate/cancel', async (req, res) => {
  try {
    enforceGhostRequestBounds(req);
    const result = await cancelGhostWalletBorrowerMandate({
      mandateId: String(req.body?.mandateId || ''),
      authorizer: String(req.body?.authorizer || ''),
      deadline: Number(req.body?.deadline),
      signature: String(req.body?.signature || ''),
    });
    return res.json({ ok: true, ...result });
  } catch (error: any) {
    const message = error?.message ?? String(error);
    const rateLimited = /RATE_LIMIT_EXCEEDED/.test(message);
    const unavailable = /UNAVAILABLE/.test(message);
    log.warn('Ghost Wallet borrower mandate cancellation rejected', { error: message });
    if (rateLimited) res.setHeader('Retry-After', '60');
    return res.status(rateLimited ? 429 : unavailable ? 503 : 400).json({ ok: false, error: message });
  }
});

router.post('/deployment-review', async (_req, res) => {
  try {
    const review = await pipeline.reviewDeploymentReadiness({ passes: 2 });
    return res.json({ ok: review.finalStatus === 'ready', review });
  } catch (error: any) {
    log.error('Deployment review failed', { error: error?.message ?? String(error) });
    return res.status(500).json({ ok: false, stage: 5, error: error?.message ?? String(error) });
  }
});

export default router;
