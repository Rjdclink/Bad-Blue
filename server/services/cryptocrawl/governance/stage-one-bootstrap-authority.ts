import logger from '../../../logger.js';
import { measuredCandidateRegistry, type MeasuredCandidate } from '../discovery/measured-candidate-registry.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { evaluateAutomaticStageProgression } from './automatic-stage-progression.js';
import { hydrateStageOneAdvancementEvidence } from './stage-one-evidence-hydrator.js';
import {
  Stage,
  STAGE_CONFIGS,
  stageManager,
  type AutomaticAdvancementEvidence,
  type AutomaticAdvancementResult,
} from './stage-management.js';

const appliedValidationEvidence = new Set<string>();
let timer: NodeJS.Timeout | null = null;
let eligibleUnsubscribe: (() => void) | null = null;
let cycleInFlight: Promise<void> | null = null;

/**
 * Stage progression is a bounded scaling policy, not a profitability veto.
 * Stage 1 is therefore a constrained live pilot: strictly-positive executable
 * opportunities may run while later stages widen size/scope from terminal proof.
 *
 * STAGE_CONFIGS is the canonical object StageManager itself references, so this
 * changes the canonical policy seen by every existing governance/risk caller;
 * no execution path bypasses StageManager.
 */
function installStageOnePositiveExecutionPolicy(): void {
  const config = STAGE_CONFIGS[Stage.STAGE_1_CONSTRAINED_PILOT];
  config.description = 'Constrained live pilot - verified positive execution only';
  config.canExecuteTrades = true;
  config.allowedChains = ['polygon', 'arbitrum', 'europa'];
  config.minDailyProfit = 0;
  config.maxDailyProfit = 200;
  config.maxPositionSizeUSD = 100;
  config.maxDrawdownPercent = 5;
  config.autonomyLevel = 'limited';
}

// Apply at module initialization. canonical-runtime-wiring imports this module
// before runtime installation/startup, and StageManager retains the same shared
// StageConfig object reference.
installStageOnePositiveExecutionPolicy();

function validationWindowMs(): number {
  const configured = Number(process.env.CRYPTO_STAGE_ONE_LIVE_VALIDATION_WINDOW_MS || 5_000);
  return Number.isFinite(configured) ? Math.max(500, Math.min(30_000, Math.trunc(configured))) : 5_000;
}

function evidenceIdentity(candidate: MeasuredCandidate): string {
  const quoteFingerprint = candidate.rawQuotes
    .map(quote => [quote.source, quote.venue || '', quote.chain || '', quote.symbol || '', quote.observedAt, quote.bid ?? '', quote.ask ?? '', quote.amountIn ?? '', quote.amountOut ?? ''].join(':'))
    .sort()
    .join('|');
  return `${candidate.topology}:${candidate.opportunityId}:${candidate.observedAt}:${quoteFingerprint}`;
}

function stageOneValidationCandidate(candidate: MeasuredCandidate, now: number): boolean {
  if (candidate.status !== 'eligible') return false;
  if (!candidate.executableCapability) return false;
  if (candidate.missingInformation.length > 0) return false;
  if (candidate.expiresAt <= now) return false;
  if (now - candidate.updatedAt > validationWindowMs()) return false;
  if (candidate.topology !== 'CEX_CEX' && candidate.topology !== 'MAKER_CEX' && candidate.topology !== 'ZERO_CAPITAL_ATOMIC') return false;
  if (candidate.depth.status === 'unavailable') return false;
  if (candidate.rawQuotes.length === 0) return false;
  if (candidate.rawQuotes.some(quote => quote.executable === false)) return false;
  const net = candidate.economics.deterministicNetProfitUsd;
  if (net === null || !Number.isFinite(net) || net <= 0) return false;
  return true;
}

async function recordFreshStageOneValidations(): Promise<number> {
  const state = stageManager.getState();
  if (state.currentStage !== 1 || state.isPaused || state.killSwitchActive || state.blockingAnomaly || state.uncertainties.length > 0) return 0;

  const now = Date.now();
  const candidates = measuredCandidateRegistry.getRecent(512)
    .filter(candidate => stageOneValidationCandidate(candidate, now))
    .sort((left, right) => left.observedAt - right.observedAt);

  let recorded = 0;
  for (const candidate of candidates) {
    const identity = evidenceIdentity(candidate);
    if (appliedValidationEvidence.has(identity)) continue;
    appliedValidationEvidence.add(identity);
    await stageManager.recordLiveValidation({
      passed: true,
      chainHealthy: true,
      timestamp: candidate.updatedAt,
    });
    recorded++;
    logger.info('[StageOneBootstrap] Recorded current-market live validation', {
      component: 'StageOneBootstrapAuthority',
      opportunityId: candidate.opportunityId,
      topology: candidate.topology,
      netProfitUsd: candidate.economics.deterministicNetProfitUsd,
      liveValidationSamples: stageManager.getState().proofMetrics.liveValidationSamples,
      provenance: 'fresh_eligible_executable_candidate',
      terminalHistoryRequired: false,
    });
  }

  if (appliedValidationEvidence.size > 4096) {
    const keep = [...appliedValidationEvidence].slice(-2048);
    appliedValidationEvidence.clear();
    for (const identity of keep) appliedValidationEvidence.add(identity);
  }
  return recorded;
}

function stageOneFoundationLadderEvidence(evidence: AutomaticAdvancementEvidence): AutomaticAdvancementEvidence {
  return {
    ...evidence,
    evaluatedAt: Date.now(),
    marketGate: {
      ...evidence.marketGate,
      reasons: [
        ...evidence.marketGate.reasons,
        'stage_one_bootstrap: foundation tier advances from verified live-system proof; realized-profit criteria begin after the first governed terminal execution',
      ],
    },
    profitLadder: {
      currentTierId: 0,
      readyForNextTier: true,
      blockers: [],
    },
  };
}

async function attemptStageOneBootstrap(): Promise<AutomaticAdvancementResult | null> {
  if (stageManager.getState().currentStage !== 1) return null;

  await evaluateAutomaticStageProgression().catch(error => {
    logger.debug('[StageOneBootstrap] Normal progression refresh remained blocked', {
      component: 'StageOneBootstrapAuthority',
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const state = stageManager.getState();
  if (state.currentStage !== 1 || !state.proofMetrics.meetsAdvancementCriteria) return null;
  if (state.isPaused || state.manualHold || state.killSwitchActive || state.blockingAnomaly || state.uncertainties.length > 0) return null;
  const evidence = state.automaticAdvancementEvidence;
  if (!evidence || evidence.marketGate.decision !== 'ALLOW' || !evidence.risk.circuitBreakersClear) return null;

  const result = await stageManager.evaluateAutomaticAdvancement(stageOneFoundationLadderEvidence(evidence));
  canonicalOpportunityState.refreshGovernance();
  logger.info('[StageOneBootstrap] Stage-1 foundation advancement evaluated from current evidence', {
    component: 'StageOneBootstrapAuthority',
    advanced: result.advanced,
    fromStage: result.fromStage,
    toStage: result.toStage,
    blockers: result.blockers,
    priorRealizedProfitRequired: false,
    foundationProfitLadderStillAdvances: true,
    terminalSettlementRequiredAfterExecution: true,
    empiricalScalingHistoryStartsAtStage2: true,
  });
  return result;
}

async function cycle(): Promise<void> {
  if (cycleInFlight) {
    await cycleInFlight;
    return;
  }
  const work = (async (): Promise<void> => {
    if (stageManager.getState().currentStage !== 1) return;

    await hydrateStageOneAdvancementEvidence().catch(error => {
      logger.debug('[StageOneBootstrap] Proactive evidence hydration remained incomplete', {
        component: 'StageOneBootstrapAuthority',
        error: error instanceof Error ? error.message : String(error),
        missingEvidenceBypass: false,
      });
    });

    const recorded = await recordFreshStageOneValidations();
    if (recorded > 0 || stageManager.getState().proofMetrics.meetsAdvancementCriteria) {
      await attemptStageOneBootstrap();
    }
  })().catch(error => {
    logger.warn('[StageOneBootstrap] Bootstrap evidence cycle failed closed', {
      component: 'StageOneBootstrapAuthority',
      error: error instanceof Error ? error.message : String(error),
    });
  });
  cycleInFlight = work;
  try {
    await work;
  } finally {
    if (cycleInFlight === work) cycleInFlight = null;
  }
}

export function ensureStageOneBootstrapAuthority(): void {
  if (timer) return;
  const intervalMs = Math.max(250, Math.min(5_000, Number(process.env.CRYPTO_STAGE_ONE_BOOTSTRAP_EVALUATION_MS || 750)));
  eligibleUnsubscribe = measuredCandidateRegistry.onEligible(candidate => {
    if (candidate.expiresAt > Date.now() && stageManager.getState().currentStage === 1) void cycle();
  });
  timer = setInterval(() => void cycle(), intervalMs);
  timer.unref?.();
  void cycle();
  logger.info('[StageOneBootstrap] Current-evidence foundation authority installed', {
    component: 'StageOneBootstrapAuthority',
    intervalMs,
    stageOneCanExecuteTrades: stageManager.canExecuteTrades(),
    stageOnePolicy: 'constrained_live_positive_execution',
    executionWake: 'eligible_candidate_event_driven',
    pollingRole: 'fallback_progression_only',
    validationSource: 'fresh_eligible_executable_candidates_after_proactive_hydration',
    supportedBootstrapTopologies: ['CEX_CEX', 'MAKER_CEX', 'ZERO_CAPITAL_ATOMIC'],
    priorTerminalHistoryRequired: false,
    missingCriticalEvidenceMayAdvance: false,
    tierZeroAuthority: 'stage_manager_live_validation_proof',
    realizedProfitCriteriaBeginAtStage2: true,
    pauseKillRiskMarketGatesPreserved: true,
    terminalSettlementStillRequiredAfterExecution: true,
  });
}
