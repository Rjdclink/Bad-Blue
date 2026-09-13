import logger from '../../../logger.js';
import type { SupportedChain, ZeroCapitalOpportunity } from '../core/zero-capital-engine.js';

interface CompletedHandoff {
  expiresAt: number;
  result: ZeroCapitalOpportunity[];
}

interface HandoffState {
  handoffId: string;
  sequence: number;
  chain: SupportedChain;
  candidateIds: string[];
  createdAt: number;
  acknowledgedAt: number | null;
  completedAt: number | null;
  attempts: number;
  replayAttempts: number;
  acknowledgementMisses: number;
  lastError: string | null;
}

export interface ZeroCapitalStageHandoffControl {
  handoffId: string;
  sequence: number;
  acknowledge: () => void;
  isActive: () => boolean;
}

export interface ZeroCapitalStageHandoffInput {
  chain: SupportedChain;
  opportunities: readonly ZeroCapitalOpportunity[];
  consume: (control: ZeroCapitalStageHandoffControl) => Promise<ZeroCapitalOpportunity[]>;
}

const inFlight = new Map<string, Promise<ZeroCapitalOpportunity[]>>();
const states = new Map<string, HandoffState>();
const completed = new Map<string, CompletedHandoff>();

let sequence = 0;
let totalHandoffs = 0;
let acknowledgedHandoffs = 0;
let completedHandoffs = 0;
let replayAttempts = 0;
let deduplicatedHandoffs = 0;
let exhaustedHandoffs = 0;
let acknowledgementMisses = 0;

function boundedInteger(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  const value = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(min, Math.min(max, value));
}

function maxAttempts(): number {
  return boundedInteger(process.env.ZERO_CAPITAL_STAGE_HANDOFF_MAX_ATTEMPTS, 3, 1, 5);
}

function identity(input: ZeroCapitalStageHandoffInput): string {
  const members = input.opportunities
    .map(opportunity => `${opportunity.id}@${opportunity.timestamp}`)
    .sort()
    .join('|');
  return `${input.chain}:${members}`;
}

function minimumExpiry(opportunities: readonly ZeroCapitalOpportunity[]): number {
  if (opportunities.length === 0) return Date.now();
  return Math.min(...opportunities.map(opportunity => opportunity.expiresAt));
}

function anyCandidateStillFresh(opportunities: readonly ZeroCapitalOpportunity[], now = Date.now()): boolean {
  return opportunities.some(opportunity => opportunity.expiresAt > now);
}

function prune(now = Date.now()): void {
  for (const [key, entry] of completed.entries()) {
    if (entry.expiresAt <= now) completed.delete(key);
  }
  if (states.size <= 512) return;
  const oldest = [...states.entries()]
    .sort((left, right) => left[1].createdAt - right[1].createdAt)
    .slice(0, states.size - 512);
  for (const [key] of oldest) states.delete(key);
}

async function recursivelyDeliver(
  input: ZeroCapitalStageHandoffInput,
  state: HandoffState,
  attempt: number,
): Promise<ZeroCapitalOpportunity[]> {
  state.attempts = attempt;
  if (!anyCandidateStillFresh(input.opportunities)) {
    throw new Error('Stage-1 candidates expired before Atomic BPS handoff could complete');
  }

  let active = true;
  let attemptAcknowledged = false;
  const control: ZeroCapitalStageHandoffControl = {
    handoffId: state.handoffId,
    sequence: state.sequence,
    acknowledge: () => {
      if (!active || attemptAcknowledged) return;
      attemptAcknowledged = true;
      if (state.acknowledgedAt === null) {
        state.acknowledgedAt = Date.now();
        acknowledgedHandoffs += 1;
      }
    },
    isActive: () => active && anyCandidateStillFresh(input.opportunities),
  };

  try {
    // The consumer itself must ACK synchronously when the single canonical Stage-2
    // engine is entered. The supervisor never self-acknowledges on its behalf.
    // One microtask is enough to detect a broken handoff contract without adding a
    // network/database/queue wait to the healthy path.
    const consumption = Promise.resolve(input.consume(control));
    await Promise.resolve();
    if (!attemptAcknowledged) {
      active = false;
      state.acknowledgementMisses += 1;
      acknowledgementMisses += 1;
      throw new Error('Atomic BPS consumer failed to acknowledge direct Stage-1 handoff');
    }

    const result = await consumption;
    active = false;
    state.completedAt = Date.now();
    state.lastError = null;
    completedHandoffs += 1;
    return result;
  } catch (error) {
    active = false;
    state.lastError = error instanceof Error ? error.message : String(error);
    if (attempt >= maxAttempts() || !anyCandidateStillFresh(input.opportunities)) {
      exhaustedHandoffs += 1;
      throw error;
    }

    // FIX-style bounded replay semantics, adapted for this in-process hot path:
    // replay uses the exact same immutable Stage-1 identity and only begins after
    // the prior attempt has definitively rejected. There are never concurrent
    // duplicate Stage-2 transformations for one handoff. Stale candidates are never
    // replayed; canonical discovery reacquires them on the next fresh scan.
    state.replayAttempts += 1;
    replayAttempts += 1;
    await Promise.resolve();
    return recursivelyDeliver(input, state, attempt + 1);
  }
}

/**
 * Bounded "hand under a hand under a hand" supervision for the locked Stage-1 ->
 * Atomic-BPS boundary. Healthy flow is a direct same-process call with no added
 * I/O wait. The Stage-2 consumer must explicitly acknowledge receipt immediately.
 * Duplicate delivery shares the same in-flight promise. A definitively rejected
 * handoff is replayed serially with the same identity up to a small bounded depth;
 * stale candidates are never blindly replayed and are left for canonical fresh
 * discovery. This module has no Stage-1 classification, economic, admission, or
 * execution authority.
 */
export async function handoffStageOneToAtomicBps(
  input: ZeroCapitalStageHandoffInput,
): Promise<ZeroCapitalOpportunity[]> {
  if (input.opportunities.length === 0) return [];
  prune();

  const key = identity(input);
  const cached = completed.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    deduplicatedHandoffs += 1;
    return cached.result;
  }

  const existing = inFlight.get(key);
  if (existing) {
    deduplicatedHandoffs += 1;
    return existing;
  }

  const handoffSequence = ++sequence;
  const state: HandoffState = {
    handoffId: `${input.chain}:${handoffSequence}`,
    sequence: handoffSequence,
    chain: input.chain,
    candidateIds: input.opportunities.map(opportunity => opportunity.id),
    createdAt: Date.now(),
    acknowledgedAt: null,
    completedAt: null,
    attempts: 0,
    replayAttempts: 0,
    acknowledgementMisses: 0,
    lastError: null,
  };
  states.set(key, state);
  totalHandoffs += 1;

  const task = recursivelyDeliver(input, state, 1)
    .then(result => {
      completed.set(key, {
        expiresAt: Math.min(minimumExpiry(input.opportunities), minimumExpiry(result)),
        result,
      });
      return result;
    })
    .finally(() => {
      if (inFlight.get(key) === task) inFlight.delete(key);
    });

  inFlight.set(key, task);

  try {
    return await task;
  } catch (error) {
    logger.warn('[ZeroCapitalStageHandoff] Bounded Stage-1 to Atomic-BPS handoff exhausted; canonical discovery must reacquire fresh evidence', {
      component: 'ZeroCapitalStageHandoffSupervisor',
      chain: input.chain,
      handoffId: state.handoffId,
      candidateIds: state.candidateIds,
      attempts: state.attempts,
      replayAttempts: state.replayAttempts,
      acknowledgementMisses: state.acknowledgementMisses,
      error: state.lastError || (error instanceof Error ? error.message : String(error)),
      stageOneAuthorityChanged: false,
      economicAuthority: false,
      executionAuthority: false,
      concurrentDuplicateStageTwoRuns: false,
      freshReacquisitionRequired: true,
    });
    throw error;
  }
}

export function getZeroCapitalStageHandoffSnapshot() {
  const latest = [...states.values()].sort((left, right) => right.sequence - left.sequence)[0] || null;
  return {
    directInMemoryHandoff: true,
    explicitStageTwoAcknowledgement: true,
    externalQueueOnHotPath: false,
    databaseOnHotPath: false,
    boundedRecursiveSupervision: true,
    maxAttempts: maxAttempts(),
    totalHandoffs,
    acknowledgedHandoffs,
    completedHandoffs,
    replayAttempts,
    deduplicatedHandoffs,
    exhaustedHandoffs,
    acknowledgementMisses,
    inFlight: inFlight.size,
    latest: latest ? { ...latest, candidateIds: [...latest.candidateIds] } : null,
    stageOneAuthority: false,
    economicAuthority: false,
    executionAuthority: false,
  };
}
