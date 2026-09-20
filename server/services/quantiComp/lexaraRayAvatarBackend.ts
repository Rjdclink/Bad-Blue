export interface LexaraRayAvatarRequest {
  sessionId: string;
  turnId: string;
  generation: number;
  sequence: number;
  audioPcm16Base64?: string;
  audioSampleRate?: number;
  audioFeatures?: number[];
  behaviorVector?: number[];
  identityStateKey?: string;
  requestedFrames?: number;
  targetFps?: number;
  modelHint?: string;
}

export interface LexaraRayAvatarFrame {
  index: number;
  ptsMs: number;
  mimeType: string;
  dataBase64: string;
}

export interface LexaraRayAvatarResponse {
  sessionId: string;
  turnId: string;
  generation: number;
  sequence: number;
  model: string;
  backend: 'ray_gpu' | 'ray_remote';
  frames: LexaraRayAvatarFrame[];
  producedAt: number;
  inferenceMs?: number;
}

export interface LexaraRayAvatarStatus {
  configured: boolean;
  inferUrl: string | null;
  healthUrl: string | null;
  lastPrewarmAt: number | null;
  lastPrewarmLatencyMs: number | null;
  lastPrewarmOk: boolean | null;
  consecutiveFailures: number;
  openUntil: number;
}

const DEFAULT_TIMEOUT_MS = 900;
const FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 15_000;

function cleanUrl(value: string | undefined): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function boundedTimeout(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(80, Math.min(10_000, Math.round(parsed)));
}

/**
 * Optional Ray Serve transport for LEXARA neural avatar inference.
 *
 * This adapter is intentionally dormant when no endpoint is configured.
 * QuantiComp remains the scheduler/cancellation/deadline authority; Ray is an
 * accelerator target, never a dependency of legal reasoning or TTS.
 */
export class LexaraRayAvatarBackend {
  private readonly inferUrl = cleanUrl(process.env.QUANTI_AVATAR_RAY_INFER_URL);
  private readonly healthUrl = cleanUrl(process.env.QUANTI_AVATAR_RAY_HEALTH_URL);
  private readonly token = String(process.env.QUANTI_AVATAR_RAY_TOKEN || '').trim();
  private readonly timeoutMs = boundedTimeout(
    process.env.QUANTI_AVATAR_RAY_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
  );
  private lastPrewarmAt: number | null = null;
  private lastPrewarmLatencyMs: number | null = null;
  private lastPrewarmOk: boolean | null = null;
  private consecutiveFailures = 0;
  private openUntil = 0;

  isConfigured(): boolean {
    return Boolean(this.inferUrl);
  }

  getStatus(): LexaraRayAvatarStatus {
    return {
      configured: this.isConfigured(),
      inferUrl: this.inferUrl,
      healthUrl: this.healthUrl,
      lastPrewarmAt: this.lastPrewarmAt,
      lastPrewarmLatencyMs: this.lastPrewarmLatencyMs,
      lastPrewarmOk: this.lastPrewarmOk,
      consecutiveFailures: this.consecutiveFailures,
      openUntil: this.openUntil,
    };
  }

  async prewarm(signal?: AbortSignal): Promise<boolean> {
    if (!this.inferUrl) return false;
    const target = this.healthUrl || this.inferUrl;
    const started = Date.now();
    this.lastPrewarmAt = started;
    try {
      const response = await this.request(target, this.healthUrl ? 'GET' : 'POST', this.healthUrl ? undefined : {
        type: 'prewarm',
        modelHint: 'lexara',
      }, signal, Math.max(this.timeoutMs, 2_500));
      this.lastPrewarmLatencyMs = Date.now() - started;
      this.lastPrewarmOk = response.ok;
      if (response.ok) this.recordSuccess();
      else this.recordFailure();
      return response.ok;
    } catch {
      this.lastPrewarmLatencyMs = Date.now() - started;
      this.lastPrewarmOk = false;
      this.recordFailure();
      return false;
    }
  }

  async infer(
    input: LexaraRayAvatarRequest,
    signal: AbortSignal,
  ): Promise<LexaraRayAvatarResponse> {
    if (!this.inferUrl) throw new Error('LEXARA_RAY_AVATAR_NOT_CONFIGURED');
    if (Date.now() < this.openUntil) throw new Error('LEXARA_RAY_AVATAR_CIRCUIT_OPEN');

    try {
      const response = await this.request(
        this.inferUrl,
        'POST',
        input,
        signal,
        this.timeoutMs,
        {
          'x-lexara-session': input.sessionId,
          'x-lexara-turn': input.turnId,
          'x-lexara-generation': String(input.generation),
          'x-lexara-sequence': String(input.sequence),
        },
      );
      if (!response.ok) {
        this.recordFailure();
        throw new Error(`LEXARA_RAY_AVATAR_HTTP_${response.status}`);
      }
      const payload = await response.json() as Partial<LexaraRayAvatarResponse>;
      const normalized: LexaraRayAvatarResponse = {
        sessionId: String(payload.sessionId || input.sessionId),
        turnId: String(payload.turnId || input.turnId),
        generation: Number(payload.generation ?? input.generation),
        sequence: Number(payload.sequence ?? input.sequence),
        model: String(payload.model || 'ray-avatar'),
        backend: payload.backend === 'ray_gpu' ? 'ray_gpu' : 'ray_remote',
        frames: Array.isArray(payload.frames)
          ? payload.frames
              .filter(frame => frame && Number.isFinite(Number(frame.index)) && Number.isFinite(Number(frame.ptsMs)) && typeof frame.dataBase64 === 'string')
              .map(frame => ({
                index: Number(frame.index),
                ptsMs: Number(frame.ptsMs),
                mimeType: String(frame.mimeType || 'image/webp'),
                dataBase64: String(frame.dataBase64),
              }))
          : [],
        producedAt: Number(payload.producedAt || Date.now()),
        inferenceMs: Number.isFinite(Number(payload.inferenceMs)) ? Number(payload.inferenceMs) : undefined,
      };
      this.recordSuccess();
      return normalized;
    } catch (error) {
      if (!signal.aborted) this.recordFailure();
      throw error;
    }
  }

  private async request(
    url: string,
    method: 'GET' | 'POST',
    body: unknown,
    externalSignal: AbortSignal | undefined,
    timeoutMs: number,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      return await fetch(url, {
        method,
        headers: {
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...extraHeaders,
        },
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onAbort);
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openUntil = 0;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= FAILURE_THRESHOLD) {
      this.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    }
  }
}

export const lexaraRayAvatarBackend = new LexaraRayAvatarBackend();
