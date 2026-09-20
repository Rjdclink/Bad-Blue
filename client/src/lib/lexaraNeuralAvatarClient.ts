export interface LexaraNeuralAvatarControls {
  mode: 'idle' | 'listening' | 'thinking' | 'speaking';
  breath: number;
  blink: number;
  gazeX: number;
  gazeY: number;
  headX: number;
  headY: number;
  headRollDeg: number;
  headPitch: number;
  browLift: number;
  smile: number;
  mouthOpen: number;
  mouthWide: number;
  mouthRound: number;
  gestureEnergy: number;
  attention: number;
}

export interface LexaraNeuralAvatarFrame {
  bitmap: ImageBitmap;
  generation: number;
  turnId: string;
  sequence: number;
  inferenceMs: number;
  averageInferenceMs: number;
  renderer: string;
}

export interface LexaraNeuralAvatarStatus {
  state: 'idle' | 'warming' | 'ready' | 'unavailable' | 'error';
  mode: 'client_webgpu' | 'ray_remote' | 'static_fallback' | null;
  renderer: string | null;
  generation: number;
  turnId: string | null;
  reason: string | null;
}

interface AvatarPlanResponse {
  success: boolean;
  mode: 'client_webgpu' | 'ray_remote' | 'static_fallback';
  sessionId: string;
  turnId: string;
  generation: number;
  workerPath?: string;
  reason?: string;
}

const WORKER_PATH = '/workers/lexara-neural-avatar-worker.js?v=20260920-e2e1';
const RENDER_INTERVAL_MS = 1000 / 18;

function randomId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function reportAvatarEvent(
  event: 'avatar-quanti-plan' | 'avatar-neural-ready' | 'avatar-neural-frame' | 'avatar-neural-unavailable' | 'avatar-neural-error',
  details: Record<string, unknown> = {},
): void {
  const payload = JSON.stringify({
    event,
    source: 'neural-avatar',
    ...details,
    userAgent: navigator.userAgent,
  });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        '/api/lexara/voice/playback-event',
        new Blob([payload], { type: 'application/json' }),
      );
      return;
    }
  } catch {
    // Telemetry is strictly observational.
  }
  void fetch('/api/lexara/voice/playback-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}

class LexaraNeuralAvatarClient {
  private readonly sessionId = randomId('lexara-avatar');
  private worker: Worker | null = null;
  private workerImageUrl = '';
  private workerReady = false;
  private activeTurnId: string | null = null;
  private planningTurnId: string | null = null;
  private generation = 0;
  private planSerial = 0;
  private lastRenderAt = 0;
  private lastControls: LexaraNeuralAvatarControls | null = null;
  private latestFrame: LexaraNeuralAvatarFrame | null = null;
  private neuralFrameReportedGeneration = -1;
  private status: LexaraNeuralAvatarStatus = {
    state: 'idle',
    mode: null,
    renderer: null,
    generation: 0,
    turnId: null,
    reason: null,
  };

  getStatus(): LexaraNeuralAvatarStatus {
    return { ...this.status };
  }

  getLatestFrame(): LexaraNeuralAvatarFrame | null {
    if (!this.latestFrame) return null;
    if (
      this.latestFrame.generation !== this.generation ||
      this.latestFrame.turnId !== this.activeTurnId
    ) return null;
    return this.latestFrame;
  }

  canUseClientWebGpu(): boolean {
    return (
      typeof Worker !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      'gpu' in navigator &&
      typeof OffscreenCanvas !== 'undefined' &&
      typeof createImageBitmap === 'function'
    );
  }

  async prewarm(imageUrl: string): Promise<void> {
    if (!this.canUseClientWebGpu()) {
      this.status = {
        ...this.status,
        state: 'unavailable',
        mode: 'static_fallback',
        reason: 'webgpu_or_worker_unavailable',
      };
      return;
    }
    this.ensureWorker(imageUrl);
  }

  async ensureTurn(turnIdValue: string, imageUrl: string): Promise<void> {
    const turnId = String(turnIdValue || '').trim();
    if (!turnId) return;
    if (this.activeTurnId === turnId && this.generation > 0) {
      this.ensureWorker(imageUrl);
      return;
    }
    if (this.planningTurnId === turnId) return;

    this.planningTurnId = turnId;
    const serial = ++this.planSerial;
    this.status = {
      ...this.status,
      state: 'warming',
      turnId,
      reason: null,
    };

    const capabilities = {
      webgpu: this.canUseClientWebGpu(),
      worker: typeof Worker !== 'undefined',
      offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
      imageBitmap: typeof createImageBitmap === 'function',
    };

    try {
      const response = await fetch('/api/lexara/avatar/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          sessionId: this.sessionId,
          turnId,
          capabilities,
        }),
      });
      if (!response.ok) throw new Error(`avatar plan HTTP ${response.status}`);
      const plan = await response.json() as AvatarPlanResponse;
      if (serial !== this.planSerial) return;
      if (!plan.success) throw new Error(plan.reason || 'avatar plan rejected');

      this.activeTurnId = turnId;
      this.generation = plan.generation;
      this.neuralFrameReportedGeneration = -1;
      this.closeLatestFrame();
      this.status = {
        state: plan.mode === 'static_fallback' ? 'unavailable' : 'warming',
        mode: plan.mode,
        renderer: null,
        generation: plan.generation,
        turnId,
        reason: plan.reason || null,
      };
      reportAvatarEvent('avatar-quanti-plan', {
        renderer: plan.mode,
        mode: plan.mode,
        generation: plan.generation,
        turnId,
        webgpu: capabilities.webgpu,
      });

      if (plan.mode === 'client_webgpu') {
        this.ensureWorker(imageUrl, plan.workerPath || WORKER_PATH);
        this.worker?.postMessage({
          type: 'generation',
          generation: plan.generation,
          turnId,
        });
        this.flushLastControls();
      } else if (plan.mode === 'static_fallback') {
        reportAvatarEvent('avatar-neural-unavailable', {
          renderer: 'static-fallback',
          generation: plan.generation,
          turnId,
          reason: plan.reason || 'no_neural_compute_backend',
        });
      }
    } catch (error) {
      if (serial !== this.planSerial) return;
      this.status = {
        state: 'error',
        mode: 'static_fallback',
        renderer: null,
        generation: this.generation,
        turnId,
        reason: error instanceof Error ? error.message : String(error),
      };
      reportAvatarEvent('avatar-neural-error', {
        renderer: 'plan',
        generation: this.generation,
        turnId,
        error: this.status.reason,
      });
    } finally {
      if (this.planningTurnId === turnId) this.planningTurnId = null;
    }
  }

  render(controls: LexaraNeuralAvatarControls, nowMs = performance.now()): void {
    this.lastControls = controls;
    if (
      !this.worker ||
      !this.workerReady ||
      this.status.mode !== 'client_webgpu' ||
      !this.activeTurnId ||
      this.generation <= 0
    ) return;
    if (nowMs - this.lastRenderAt < RENDER_INTERVAL_MS) return;
    this.lastRenderAt = nowMs;
    this.worker.postMessage({
      type: 'render',
      generation: this.generation,
      turnId: this.activeTurnId,
      frame: controls,
    });
  }

  async endCurrentTurn(): Promise<void> {
    const turnId = this.activeTurnId;
    const generation = this.generation;
    if (!turnId) return;
    this.activeTurnId = null;
    this.generation = 0;
    this.lastControls = null;
    this.closeLatestFrame();
    this.worker?.postMessage({ type: 'cancel', generation, turnId });
    void fetch('/api/lexara/avatar/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ sessionId: this.sessionId, turnId }),
      keepalive: true,
    }).catch(() => undefined);
  }

  dispose(): void {
    void this.endCurrentTurn();
    this.closeLatestFrame();
    this.worker?.postMessage({ type: 'dispose' });
    this.worker?.terminate();
    this.worker = null;
    this.workerReady = false;
    this.workerImageUrl = '';
    this.status = {
      state: 'idle',
      mode: null,
      renderer: null,
      generation: 0,
      turnId: null,
      reason: null,
    };
  }

  private ensureWorker(imageUrl: string, workerPath = WORKER_PATH): void {
    if (this.worker && this.workerImageUrl === imageUrl) return;
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' });
      this.worker.terminate();
      this.worker = null;
    }
    this.workerReady = false;
    this.workerImageUrl = imageUrl;
    this.status = {
      ...this.status,
      state: 'warming',
      reason: null,
    };

    try {
      const worker = new Worker(workerPath, { name: 'lexara-neural-avatar' });
      this.worker = worker;
      worker.onmessage = event => this.handleWorkerMessage(event.data || {});
      worker.onerror = event => {
        const message = event.message || 'neural avatar worker error';
        this.status = {
          ...this.status,
          state: 'error',
          mode: 'static_fallback',
          reason: message,
        };
        reportAvatarEvent('avatar-neural-error', {
          renderer: 'worker',
          generation: this.generation,
          turnId: this.activeTurnId,
          error: message,
        });
      };
      worker.postMessage({
        type: 'init',
        imageUrl,
      });
      if (this.generation > 0 && this.activeTurnId) {
        worker.postMessage({
          type: 'generation',
          generation: this.generation,
          turnId: this.activeTurnId,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = {
        ...this.status,
        state: 'error',
        mode: 'static_fallback',
        reason: message,
      };
      reportAvatarEvent('avatar-neural-error', {
        renderer: 'worker-create',
        generation: this.generation,
        turnId: this.activeTurnId,
        error: message,
      });
    }
  }

  private handleWorkerMessage(message: any): void {
    if (message.type === 'ready') {
      this.workerReady = true;
      this.status = {
        ...this.status,
        state: 'ready',
        renderer: String(message.renderer || 'onnx-webgpu'),
        reason: null,
      };
      if (this.generation > 0 && this.activeTurnId) {
        this.worker?.postMessage({
          type: 'generation',
          generation: this.generation,
          turnId: this.activeTurnId,
        });
      }
      reportAvatarEvent('avatar-neural-ready', {
        renderer: this.status.renderer,
        generation: this.generation,
        turnId: this.activeTurnId,
      });
      this.flushLastControls();
      return;
    }

    if (message.type === 'frame' && message.bitmap instanceof ImageBitmap) {
      if (
        Number(message.generation) !== this.generation ||
        String(message.turnId || '') !== this.activeTurnId
      ) {
        message.bitmap.close();
        return;
      }
      const next: LexaraNeuralAvatarFrame = {
        bitmap: message.bitmap,
        generation: Number(message.generation),
        turnId: String(message.turnId),
        sequence: Number(message.sequence) || 0,
        inferenceMs: Number(message.inferenceMs) || 0,
        averageInferenceMs: Number(message.averageInferenceMs) || 0,
        renderer: String(message.renderer || 'onnx-webgpu'),
      };
      const previous = this.latestFrame;
      this.latestFrame = next;
      previous?.bitmap.close();
      this.status = {
        ...this.status,
        state: 'ready',
        renderer: next.renderer,
        reason: null,
      };

      if (this.neuralFrameReportedGeneration !== this.generation) {
        this.neuralFrameReportedGeneration = this.generation;
        reportAvatarEvent('avatar-neural-frame', {
          renderer: next.renderer,
          generation: next.generation,
          turnId: next.turnId,
          sequence: next.sequence,
          inferenceMs: Math.round(next.inferenceMs),
          averageInferenceMs: Math.round(next.averageInferenceMs),
        });
      }
      return;
    }

    if (message.type === 'unavailable') {
      this.workerReady = false;
      this.status = {
        ...this.status,
        state: 'unavailable',
        mode: 'static_fallback',
        reason: String(message.reason || 'neural worker unavailable'),
      };
      reportAvatarEvent('avatar-neural-unavailable', {
        renderer: 'worker',
        generation: this.generation,
        turnId: this.activeTurnId,
        reason: this.status.reason,
      });
      return;
    }

    if (message.type === 'error') {
      this.workerReady = false;
      this.status = {
        ...this.status,
        state: 'error',
        mode: 'static_fallback',
        reason: String(message.message || 'neural worker inference error'),
      };
      reportAvatarEvent('avatar-neural-error', {
        renderer: String(message.stage || 'worker'),
        generation: this.generation,
        turnId: this.activeTurnId,
        error: this.status.reason,
      });
    }
  }

  private flushLastControls(): void {
    if (!this.lastControls) return;
    this.lastRenderAt = 0;
    this.render(this.lastControls, performance.now());
  }

  private closeLatestFrame(): void {
    this.latestFrame?.bitmap.close();
    this.latestFrame = null;
  }
}

export const lexaraNeuralAvatarClient = new LexaraNeuralAvatarClient();
