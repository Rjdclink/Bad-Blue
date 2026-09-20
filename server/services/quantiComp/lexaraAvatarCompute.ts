import { quantiComp } from './runtime.js';
import { quantiTensorFabric } from './tensorFabric.js';
import {
  lexaraRayAvatarBackend,
  type LexaraRayAvatarRequest,
  type LexaraRayAvatarResponse,
} from './lexaraRayAvatarBackend.js';
import { QuantiCompError } from './types.js';

export interface LexaraAvatarBehaviorVector {
  values: number[];
  observedAt: number;
}

export interface LexaraAvatarClientCapabilities {
  webgpu: boolean;
  worker: boolean;
  offscreenCanvas: boolean;
  imageBitmap: boolean;
}

export interface LexaraAvatarTurnPlan {
  mode: 'client_webgpu' | 'ray_remote' | 'static_fallback';
  sessionId: string;
  turnId: string;
  generation: number;
  workerPath?: string;
  reason?: string;
}

export interface LexaraAvatarSegmentInput {
  sessionId: string;
  turnId: string;
  sequence: number;
  audioPcm16Base64?: string;
  audioSampleRate?: number;
  audioFeatures?: number[];
  behavior?: LexaraAvatarBehaviorVector;
  requestedFrames?: number;
  targetFps?: number;
  modelHint?: string;
}

export interface LexaraAvatarComputeResult {
  mode: 'ray_remote' | 'browser_fallback';
  sessionId: string;
  turnId: string;
  generation: number;
  sequence: number;
  stale: false;
  response: LexaraRayAvatarResponse | null;
  reason?: string;
}

export interface LexaraAvatarComputeStatus {
  sessions: number;
  activeGenerations: number;
  ray: ReturnType<typeof lexaraRayAvatarBackend.getStatus>;
  tensorFabric: ReturnType<typeof quantiTensorFabric.getStatus>;
}

type SessionState = {
  turnId: string;
  generation: number;
  lastSequence: number;
  updatedAt: number;
};

const SESSION_TTL_MS = 30 * 60_000;
const DEFAULT_SEGMENT_DEADLINE_MS = 240;

function normalizedId(value: string, field: string): string {
  const clean = String(value || '').trim();
  if (!clean || clean.length > 160) throw new Error(`LEXARA_AVATAR_INVALID_${field.toUpperCase()}`);
  return clean;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

/**
 * LEXARA-specific QuantiComp facade.
 *
 * The important boundary is architectural: QuantiComp owns deadline,
 * supersession, cancellation and validation. The optional Ray endpoint supplies
 * acceleration only. Missing/failed GPU compute resolves to browser fallback
 * and never delays or disables legal reasoning or TTS.
 */
export class LexaraAvatarComputeCoordinator {
  private readonly sessions = new Map<string, SessionState>();

  beginTurn(sessionIdValue: string, turnIdValue: string): number {
    const sessionId = normalizedId(sessionIdValue, 'session');
    const turnId = normalizedId(turnIdValue, 'turn');
    this.evictExpiredSessions();
    const previous = this.sessions.get(sessionId);
    const generation = (previous?.generation || 0) + 1;
    this.sessions.set(sessionId, {
      turnId,
      generation,
      lastSequence: -1,
      updatedAt: Date.now(),
    });
    quantiComp.advanceSupersessionGeneration(
      `lexara-avatar:${sessionId}`,
      generation * 1_000_000,
      'lexara-avatar-visual',
    );
    return generation;
  }

  endTurn(sessionIdValue: string, turnIdValue: string): void {
    const sessionId = normalizedId(sessionIdValue, 'session');
    const turnId = normalizedId(turnIdValue, 'turn');
    const state = this.sessions.get(sessionId);
    if (!state || state.turnId !== turnId) return;
    // Advancing the generation fence cancels/suppresses any in-flight visual
    // result from this turn even when there is no replacement segment yet.
    const nextGeneration = state.generation + 1;
    this.sessions.set(sessionId, {
      ...state,
      generation: nextGeneration,
      lastSequence: Number.MAX_SAFE_INTEGER,
      updatedAt: Date.now(),
    });
    quantiComp.advanceSupersessionGeneration(
      `lexara-avatar:${sessionId}`,
      nextGeneration * 1_000_000,
      'lexara-avatar-visual',
    );
  }

  planTurn(
    sessionIdValue: string,
    turnIdValue: string,
    capabilities: LexaraAvatarClientCapabilities,
  ): LexaraAvatarTurnPlan {
    const sessionId = normalizedId(sessionIdValue, 'session');
    const turnId = normalizedId(turnIdValue, 'turn');
    const generation = this.beginTurn(sessionId, turnId);
    const clientWebGpuReady = (
      capabilities?.webgpu === true &&
      capabilities?.worker === true &&
      capabilities?.offscreenCanvas === true &&
      capabilities?.imageBitmap === true
    );

    if (clientWebGpuReady) {
      return {
        mode: 'client_webgpu',
        sessionId,
        turnId,
        generation,
        workerPath: '/workers/lexara-neural-avatar-worker.js?v=20260920-e2e1',
      };
    }

    if (lexaraRayAvatarBackend.isConfigured()) {
      return {
        mode: 'ray_remote',
        sessionId,
        turnId,
        generation,
        reason: 'client_webgpu_unavailable',
      };
    }

    return {
      mode: 'static_fallback',
      sessionId,
      turnId,
      generation,
      reason: 'no_neural_compute_backend_available',
    };
  }

  publishIdentityContext(
    modelKey: string,
    values: ArrayLike<number>,
    ttlMs = 24 * 60 * 60_000,
  ) {
    const key = `lexara:avatar:identity:${normalizedId(modelKey, 'model')}`;
    return quantiTensorFabric.publishFloat32State(key, values, {
      ttlMs: boundedInt(ttlMs, 24 * 60 * 60_000, 60_000, 7 * 24 * 60 * 60_000),
    });
  }

  async prewarm(signal?: AbortSignal): Promise<boolean> {
    return lexaraRayAvatarBackend.prewarm(signal);
  }

  async submitSegment(
    input: LexaraAvatarSegmentInput,
    options: { signal?: AbortSignal; deadlineMs?: number } = {},
  ): Promise<LexaraAvatarComputeResult> {
    const sessionId = normalizedId(input.sessionId, 'session');
    const turnId = normalizedId(input.turnId, 'turn');
    const sequence = boundedInt(input.sequence, 0, 0, Number.MAX_SAFE_INTEGER);
    const state = this.sessions.get(sessionId);
    if (!state || state.turnId !== turnId) {
      throw new Error('LEXARA_AVATAR_TURN_NOT_ACTIVE');
    }
    if (sequence <= state.lastSequence) {
      throw new QuantiCompError(
        'Avatar segment sequence is stale',
        'SUPERSEDED',
        { sessionId, turnId, sequence, lastSequence: state.lastSequence },
      );
    }

    state.lastSequence = sequence;
    state.updatedAt = Date.now();

    // Sequence is folded into a monotonically increasing generation. This is
    // the LeBrony/snake-skin-style "latest useful generation wins" rule:
    // intermediate visual work may be shed; conversation/audio never are.
    const generation = state.generation * 1_000_000 + Math.min(sequence, 999_999);
    const deadlineMs = boundedInt(
      options.deadlineMs ?? process.env.QUANTI_AVATAR_SEGMENT_DEADLINE_MS,
      DEFAULT_SEGMENT_DEADLINE_MS,
      80,
      2_000,
    );
    const supersessionKey = `lexara-avatar:${sessionId}`;
    const resourceDomain = 'lexara-avatar-visual';
    const identityStateKey = String(process.env.QUANTI_AVATAR_IDENTITY_STATE_KEY || 'lexara:avatar:identity:canonical').trim();

    if (!lexaraRayAvatarBackend.isConfigured()) {
      return {
        mode: 'browser_fallback',
        sessionId,
        turnId,
        generation,
        sequence,
        stale: false,
        response: null,
        reason: 'ray_avatar_backend_not_configured',
      };
    }

    const request: LexaraRayAvatarRequest = {
      sessionId,
      turnId,
      generation,
      sequence,
      audioPcm16Base64: input.audioPcm16Base64,
      audioSampleRate: input.audioSampleRate,
      audioFeatures: input.audioFeatures,
      behaviorVector: input.behavior?.values,
      identityStateKey,
      requestedFrames: boundedInt(input.requestedFrames, 4, 1, 30),
      targetFps: boundedInt(input.targetFps, 30, 12, 60),
      modelHint: input.modelHint,
    };

    const deadlineAt = Date.now() + deadlineMs;
    const result = await quantiComp.submit<LexaraRayAvatarRequest, LexaraRayAvatarResponse>({
      id: `lexara-avatar:${sessionId}:${turnId}:${sequence}`,
      kind: 'lexara.avatar.segment',
      lane: 'ultra_hot',
      priority: 1_000_000,
      input: request,
      features: {
        avatarRealtime: 1,
        sequence,
        requestedFrames: request.requestedFrames || 0,
        targetFps: request.targetFps || 0,
        behaviorDimensions: request.behaviorVector?.length || 0,
        audioFeatureDimensions: request.audioFeatures?.length || 0,
      },
      resourceHints: {
        cpuWeight: 0.15,
        memoryMB: 512,
        ioWeight: 1,
        expectedDurationMs: Math.max(1, deadlineMs - 20),
        preferredBackend: 'remote',
        parallelismHint: 1,
        resourceDomain,
      },
      policy: {
        timeoutMs: deadlineMs,
        deadlineAt,
        deterministic: true,
        sideEffectFree: true,
        backendEligible: false,
        allowDeduplication: false,
        usefulWorkUnits: request.requestedFrames || 1,
        strictValidation: true,
        supersessionKey,
        generation,
        preemptible: true,
      },
      execute: (payload, context) => lexaraRayAvatarBackend.infer(payload, context.signal),
      validate: response => (
        response.sessionId === sessionId &&
        response.turnId === turnId &&
        response.generation === generation &&
        response.sequence === sequence &&
        Array.isArray(response.frames) &&
        response.frames.every(frame => (
          Number.isFinite(frame.index) &&
          Number.isFinite(frame.ptsMs) &&
          typeof frame.dataBase64 === 'string' &&
          frame.dataBase64.length > 0
        ))
      ),
    }, { signal: options.signal });

    // The workload itself intentionally owns remote transport. Mark the returned
    // metric accurately without granting the generic backend registry authority
    // over an endpoint that has not completed measured promotion.
    result.metrics.backend = 'remote';

    return {
      mode: 'ray_remote',
      sessionId,
      turnId,
      generation,
      sequence,
      stale: false,
      response: result.result,
    };
  }

  getStatus(): LexaraAvatarComputeStatus {
    this.evictExpiredSessions();
    return {
      sessions: this.sessions.size,
      activeGenerations: this.sessions.size,
      ray: lexaraRayAvatarBackend.getStatus(),
      tensorFabric: quantiTensorFabric.getStatus(),
    };
  }

  private evictExpiredSessions(now = Date.now()): void {
    for (const [sessionId, state] of this.sessions) {
      if (now - state.updatedAt > SESSION_TTL_MS) this.sessions.delete(sessionId);
    }
    quantiTensorFabric.evictExpired(now);
  }
}

export const lexaraAvatarCompute = new LexaraAvatarComputeCoordinator();
