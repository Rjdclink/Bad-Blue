import { getLexaraSharedAudioContext } from '@/lib/lexaraSpeechClient';

export interface LexaraRealtimeSttEvent {
  event?: string;
  transcript?: string;
  words?: Array<{ word?: string; confidence?: number }>;
  turn_index?: number;
  audio_window_start?: number;
  audio_window_end?: number;
  end_of_turn_confidence?: number;
  [key: string]: unknown;
}

interface ConnectOptions {
  stream: MediaStream;
  keyterms?: string[];
  onSttEvent?: (event: LexaraRealtimeSttEvent) => void;
  onFatal?: (error: Error) => void;
}

interface SpeakOptions {
  onStart?: () => void;
}

interface ActiveSpeech {
  turnId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  metadataComplete: boolean;
  playbackDrained: boolean;
  started: boolean;
  onStart?: () => void;
  timeout: number;
  requestedAt: number;
  renderReported: boolean;
  progressTimeout: number | null;
}

const CONNECT_TIMEOUT_MS = 9_000;
const SPEECH_TIMEOUT_MS = 180_000;
const REALTIME_AUDIO_STALL_TIMEOUT_MS = 2_500;
const CAPTURE_FRAME_MS = 80;

const loadedWorkletContexts = new WeakSet<AudioContext>();
let workletModuleUrl: string | null = null;

const WORKLET_SOURCE = String.raw`
class LexaraCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.enabled = true;
    this.frameSamples = Math.max(128, Math.round(sampleRate * ((options.processorOptions?.frameMs || 80) / 1000)));
    this.pending = new Float32Array(this.frameSamples);
    this.offset = 0;
    this.port.onmessage = event => {
      if (event.data?.type === 'enabled') {
        this.enabled = event.data.value === true;
        if (!this.enabled) this.offset = 0;
      }
    };
  }

  process(inputs) {
    if (!this.enabled) return true;
    const channel = inputs?.[0]?.[0];
    if (!channel?.length) return true;

    let inputOffset = 0;
    while (inputOffset < channel.length) {
      const remaining = this.frameSamples - this.offset;
      const count = Math.min(remaining, channel.length - inputOffset);
      this.pending.set(channel.subarray(inputOffset, inputOffset + count), this.offset);
      this.offset += count;
      inputOffset += count;

      if (this.offset === this.frameSamples) {
        const pcm = new Int16Array(this.frameSamples);
        for (let i = 0; i < this.frameSamples; i += 1) {
          const sample = Math.max(-1, Math.min(1, this.pending[i]));
          pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }
        this.port.postMessage({ type: 'frame', buffer: pcm.buffer }, [pcm.buffer]);
        this.offset = 0;
      }
    }
    return true;
  }
}

class LexaraPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.queueOffset = 0;
    this.queuedSamples = 0;
    this.startThresholdFrames = Math.max(128, Math.round(sampleRate * 0.024));
    this.started = false;
    this.renderedFrames = 0;
    this.hadAudio = false;
    this.port.onmessage = event => {
      if (event.data?.type === 'audio' && event.data.buffer) {
        const chunk = new Int16Array(event.data.buffer);
        this.queue.push(chunk);
        this.queuedSamples += chunk.length;
        this.hadAudio = true;
      } else if (event.data?.type === 'clear') {
        this.queue = [];
        this.queueOffset = 0;
        this.queuedSamples = 0;
        this.started = false;
        this.hadAudio = false;
        this.port.postMessage({ type: 'drained', renderedFrames: this.renderedFrames });
      } else if (event.data?.type === 'reset_counter') {
        this.renderedFrames = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs?.[0]?.[0];
    if (!output) return true;
    output.fill(0);

    if (!this.started) {
      if (this.queuedSamples < this.startThresholdFrames) return true;
      this.started = true;
    }

    let writeOffset = 0;
    let energySum = 0;
    let diffEnergySum = 0;
    let zeroCrossings = 0;
    let previousSample = 0;
    let hasPreviousSample = false;
    while (writeOffset < output.length && this.queue.length) {
      const current = this.queue[0];
      const available = current.length - this.queueOffset;
      const count = Math.min(available, output.length - writeOffset);
      for (let i = 0; i < count; i += 1) {
        const sample = current[this.queueOffset + i] / 0x8000;
        output[writeOffset + i] = sample;
        energySum += sample * sample;
        if (hasPreviousSample) {
          const diff = sample - previousSample;
          diffEnergySum += diff * diff;
          if ((sample >= 0 && previousSample < 0) || (sample < 0 && previousSample >= 0)) {
            zeroCrossings += 1;
          }
        }
        previousSample = sample;
        hasPreviousSample = true;
      }
      writeOffset += count;
      this.queueOffset += count;
      this.queuedSamples = Math.max(0, this.queuedSamples - count);
      this.renderedFrames += count;

      if (this.queueOffset >= current.length) {
        this.queue.shift();
        this.queueOffset = 0;
      }
    }

    const level = writeOffset > 0
      ? Math.min(1, Math.sqrt(energySum / writeOffset) * 2.4)
      : 0;
    const brightness = writeOffset > 1
      ? Math.min(1, Math.sqrt(diffEnergySum / (writeOffset - 1)) * 3.4)
      : 0;
    const zeroCrossingRate = writeOffset > 1
      ? Math.min(1, zeroCrossings / (writeOffset - 1))
      : 0;

    if (this.hadAudio && this.queue.length === 0) {
      this.hadAudio = false;
      this.started = false;
      this.port.postMessage({
        type: 'drained',
        renderedFrames: this.renderedFrames,
        level,
        brightness,
        zeroCrossingRate,
      });
    } else if (writeOffset > 0) {
      this.port.postMessage({
        type: 'rendered',
        renderedFrames: this.renderedFrames,
        level,
        brightness,
        zeroCrossingRate,
      });
    }

    return true;
  }
}

registerProcessor('lexara-capture-processor', LexaraCaptureProcessor);
registerProcessor('lexara-playback-processor', LexaraPlaybackProcessor);
`;

async function ensureWorklets(context: AudioContext): Promise<void> {
  if (loadedWorkletContexts.has(context)) return;
  if (!context.audioWorklet || typeof AudioWorkletNode === 'undefined') {
    throw new Error('AudioWorklet is unavailable on this browser');
  }

  if (!workletModuleUrl) {
    workletModuleUrl = URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: 'application/javascript' }),
    );
  }
  await context.audioWorklet.addModule(workletModuleUrl);
  loadedWorkletContexts.add(context);
}

function sanitizeKeyterms(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, 100);
}

function reportRealtimeVoiceEvent(
  event: string,
  details: Record<string, unknown> = {},
): void {
  const payload = JSON.stringify({
    event,
    source: 'realtime',
    provider: 'deepgram-flux',
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
    // Telemetry is never allowed to affect the audio path.
  }
  void fetch('/api/lexara/voice/playback-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}

function websocketUrl(endpoint: string, ticket: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = endpoint.startsWith('/') ? endpoint : '/api/lexara/realtime';
  return `${protocol}//${window.location.host}${path}?ticket=${encodeURIComponent(ticket)}`;
}

class LexaraRealtimeVoiceClient {
  private socket: WebSocket | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private captureSink: GainNode | null = null;
  private playback: AudioWorkletNode | null = null;
  private activeSpeech: ActiveSpeech | null = null;
  private ready = false;
  private renderedFrames = 0;
  private playbackLevel = 0;
  private playbackBrightness = 0;
  private playbackZeroCrossingRate = 0;
  private cumulativeRenderedFrames = 0;
  private onSttEvent: ((event: LexaraRealtimeSttEvent) => void) | null = null;
  private onFatal: ((error: Error) => void) | null = null;

  isReady(): boolean {
    return this.ready && this.socket?.readyState === WebSocket.OPEN;
  }

  getPlaybackClock(): {
    active: boolean;
    currentTimeSec: number;
    level: number;
    brightness: number;
    zeroCrossingRate: number;
    sampleRate: number | null;
    turnId: string | null;
  } {
    const sampleRate = this.context?.sampleRate || 0;
    return {
      active: Boolean(this.activeSpeech?.started && this.renderedFrames > 0),
      currentTimeSec: sampleRate > 0 ? this.renderedFrames / sampleRate : 0,
      level: Math.max(0, Math.min(1, this.playbackLevel)),
      brightness: Math.max(0, Math.min(1, this.playbackBrightness)),
      zeroCrossingRate: Math.max(0, Math.min(1, this.playbackZeroCrossingRate)),
      sampleRate: sampleRate > 0 ? sampleRate : null,
      turnId: this.activeSpeech?.turnId || null,
    };
  }

  async connect(options: ConnectOptions): Promise<void> {
    if (this.isReady()) {
      this.onSttEvent = options.onSttEvent || null;
      this.onFatal = options.onFatal || null;
      this.configureStt({ keyterms: options.keyterms });
      return;
    }

    this.close(false);
    this.onSttEvent = options.onSttEvent || null;
    this.onFatal = options.onFatal || null;

    const ticketResponse = await fetch('/api/lexara/realtime-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: '{}',
    });
    const ticketPayload = await ticketResponse.json().catch(() => ({}));
    if (!ticketResponse.ok || typeof ticketPayload?.ticket !== 'string') {
      throw new Error(ticketPayload?.error || 'LEXARA realtime voice ticket unavailable');
    }

    const context = await getLexaraSharedAudioContext();
    // Flux accepts raw PCM at 8/16/24/44.1/48 kHz. If a niche browser exposes
    // another AudioContext rate, keep the proven MediaRecorder route instead of
    // lying about the PCM clock or introducing a resampler into the hot path.
    if (![8_000, 16_000, 24_000, 44_100, 48_000].includes(context.sampleRate)) {
      throw new Error(`Unsupported realtime PCM sample rate: ${context.sampleRate}`);
    }
    await ensureWorklets(context);
    if (context.state === 'suspended') await context.resume();
    if (context.state !== 'running') {
      throw new Error('LEXARA realtime audio context is not running');
    }

    const source = context.createMediaStreamSource(options.stream);
    const capture = new AudioWorkletNode(context, 'lexara-capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { frameMs: CAPTURE_FRAME_MS },
    });
    const captureSink = context.createGain();
    captureSink.gain.value = 0;
    const playback = new AudioWorkletNode(context, 'lexara-playback-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });

    source.connect(capture);
    capture.connect(captureSink);
    captureSink.connect(context.destination);
    playback.connect(context.destination);

    this.context = context;
    this.source = source;
    this.capture = capture;
    this.captureSink = captureSink;
    this.playback = playback;
    this.renderedFrames = 0;

    const socket = new WebSocket(websocketUrl(
      typeof ticketPayload.endpoint === 'string' ? ticketPayload.endpoint : '/api/lexara/realtime',
      ticketPayload.ticket,
    ));
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    capture.port.onmessage = event => {
      if (event.data?.type !== 'frame' || !(event.data.buffer instanceof ArrayBuffer)) return;
      if (socket.readyState === WebSocket.OPEN && this.ready) {
        socket.send(event.data.buffer);
      }
    };

    playback.port.onmessage = event => {
      const renderedFrames = Number(event.data?.renderedFrames);
      if (Number.isFinite(renderedFrames)) {
        this.renderedFrames = Math.max(this.renderedFrames, renderedFrames);
      }
      const level = Number(event.data?.level);
      if (Number.isFinite(level)) {
        this.playbackLevel = Math.max(0, Math.min(1, level));
      }
      const brightness = Number(event.data?.brightness);
      if (Number.isFinite(brightness)) {
        this.playbackBrightness = Math.max(0, Math.min(1, brightness));
      }
      const zeroCrossingRate = Number(event.data?.zeroCrossingRate);
      if (Number.isFinite(zeroCrossingRate)) {
        this.playbackZeroCrossingRate = Math.max(0, Math.min(1, zeroCrossingRate));
      }
      const active = this.activeSpeech;
      if (
        active
        && !active.renderReported
        && Number.isFinite(renderedFrames)
        && renderedFrames > 0
      ) {
        active.renderReported = true;
        reportRealtimeVoiceEvent('realtime-playing', {
          turnId: active.turnId,
          startupMs: Math.round(performance.now() - active.requestedAt),
          renderedFrames,
        });
      }
      if (event.data?.type === 'drained' && active?.started) {
        active.playbackDrained = true;
        this.maybeResolveSpeech(active);
      }
    };

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('LEXARA realtime voice connection timed out'));
      }, CONNECT_TIMEOUT_MS);

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      };

      socket.onopen = () => {
        socket.send(JSON.stringify({
          type: 'client_config',
          inputSampleRate: context.sampleRate,
          outputSampleRate: context.sampleRate,
          keyterms: sanitizeKeyterms(options.keyterms),
        }));
      };

      socket.onmessage = event => {
        if (event.data instanceof ArrayBuffer) {
          this.handleAudio(event.data);
          return;
        }

        const message = this.parseControl(event.data);
        if (!message) return;
        this.handleControlMessage(message);

        if (message.type === 'ready' && !settled) {
          settled = true;
          window.clearTimeout(timer);
          this.ready = true;
          resolve();
        } else if (message.type === 'fatal') {
          fail(new Error(`LEXARA realtime voice failed: ${String(message.code || 'unknown')}`));
        }
      };

      socket.onerror = () => fail(new Error('LEXARA realtime voice socket failed'));
      socket.onclose = event => {
        const wasReady = this.ready;
        this.ready = false;
        if (!settled) {
          fail(new Error(`LEXARA realtime voice closed before ready (${event.code})`));
          return;
        }
        if (wasReady && event.code !== 1000) {
          this.failActiveSpeech(new Error('LEXARA realtime voice connection closed'));
          this.onFatal?.(new Error('LEXARA realtime voice connection closed'));
        }
      };
    }).catch(error => {
      this.close(false);
      throw error;
    });
  }

  setInputEnabled(enabled: boolean): void {
    this.capture?.port.postMessage({ type: 'enabled', value: enabled });
  }

  configureStt(options: {
    keyterms?: string[];
    eagerEotThreshold?: number;
    eotThreshold?: number;
    eotTimeoutMs?: number;
  }): void {
    if (!this.isReady()) return;
    const thresholds: Record<string, number> = {};
    if (Number.isFinite(options.eagerEotThreshold)) {
      thresholds.eager_eot_threshold = Number(options.eagerEotThreshold);
    }
    if (Number.isFinite(options.eotThreshold)) {
      thresholds.eot_threshold = Number(options.eotThreshold);
    }
    if (Number.isFinite(options.eotTimeoutMs)) {
      thresholds.eot_timeout_ms = Math.round(Number(options.eotTimeoutMs));
    }

    this.socket!.send(JSON.stringify({
      type: 'stt_configure',
      ...(options.keyterms ? { keyterms: sanitizeKeyterms(options.keyterms) } : {}),
      ...(Object.keys(thresholds).length ? { thresholds } : {}),
    }));
  }

  async speak(text: string, turnId: string, options: SpeakOptions = {}): Promise<void> {
    const cleanText = text.replace(/\s+/g, ' ').trim();
    const cleanTurnId = turnId.trim();
    if (!cleanText || !cleanTurnId) return;
    if (!this.isReady()) throw new Error('LEXARA realtime voice is not connected');

    if (this.activeSpeech) this.interrupt();

    this.clearPlayback();
    this.playback?.port.postMessage({ type: 'reset_counter' });
    this.renderedFrames = 0;
    this.playbackLevel = 0;
    this.playbackBrightness = 0;
    this.playbackZeroCrossingRate = 0;

    const promise = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        if (this.activeSpeech?.turnId !== cleanTurnId) return;
        this.activeSpeech = null;
        reject(new Error('LEXARA realtime speech timed out'));
      }, SPEECH_TIMEOUT_MS);

      this.activeSpeech = {
        turnId: cleanTurnId,
        resolve,
        reject,
        metadataComplete: false,
        playbackDrained: false,
        started: false,
        onStart: options.onStart,
        timeout,
        requestedAt: performance.now(),
        renderReported: false,
        progressTimeout: null,
      };
    });

    this.socket!.send(JSON.stringify({
      type: 'tts_speak',
      turnId: cleanTurnId,
      text: cleanText,
    }));
    this.socket!.send(JSON.stringify({
      type: 'tts_flush',
      turnId: cleanTurnId,
    }));

    return promise;
  }

  interrupt(): void {
    const context = this.context;
    const active = this.activeSpeech;
    const renderedThisTurn = active ? this.renderedFrames : 0;
    if (active) {
      this.cumulativeRenderedFrames += renderedThisTurn;
      this.renderedFrames = 0;
    }
    const playbackOffsetMs = context
      ? Math.round((this.cumulativeRenderedFrames / context.sampleRate) * 1000)
      : 0;

    this.clearPlayback();
    if (active && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'tts_interrupt',
        turnId: active.turnId,
        playbackOffsetMs,
      }));
      reportRealtimeVoiceEvent('realtime-interrupted', {
        turnId: active.turnId,
        playbackOffsetMs,
      });
    }

    if (active) {
      window.clearTimeout(active.timeout);
      if (active.progressTimeout !== null) window.clearTimeout(active.progressTimeout);
      this.activeSpeech = null;
      active.resolve();
    }
  }

  close(stopTracks = false): void {
    this.ready = false;
    this.interrupt();

    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      try { socket.close(1000, 'LEXARA client closed'); } catch { /* noop */ }
    }

    for (const node of [this.source, this.capture, this.captureSink, this.playback]) {
      try { node?.disconnect(); } catch { /* already detached */ }
    }

    if (stopTracks) {
      try {
        this.source?.mediaStream?.getTracks?.().forEach(track => track.stop());
      } catch {
        // The voice-mode hook normally owns microphone track lifetime.
      }
    }

    this.source = null;
    this.capture = null;
    this.captureSink = null;
    this.playback = null;
    this.context = null;
    this.onSttEvent = null;
    this.onFatal = null;
  }

  private parseControl(value: unknown): any | null {
    try {
      return JSON.parse(String(value));
    } catch {
      return null;
    }
  }

  private handleAudio(buffer: ArrayBuffer): void {
    const active = this.activeSpeech;
    if (!active || !this.playback) return;

    if (!active.started) {
      active.started = true;
      reportRealtimeVoiceEvent('realtime-first-audio', {
        turnId: active.turnId,
        startupMs: Math.round(performance.now() - active.requestedAt),
      });
      active.onStart?.();
    }
    active.playbackDrained = false;
    if (active.progressTimeout !== null) window.clearTimeout(active.progressTimeout);
    active.progressTimeout = window.setTimeout(() => {
      if (this.activeSpeech !== active || active.metadataComplete) return;
      const error = new Error('LEXARA realtime audio stream stalled');
      this.clearPlayback();
      this.failActiveSpeech(error);
    }, REALTIME_AUDIO_STALL_TIMEOUT_MS);
    this.playback.port.postMessage({ type: 'audio', buffer }, [buffer]);
  }

  private handleControlMessage(message: any): void {
    if (message.type === 'stt' && message.payload && typeof message.payload === 'object') {
      this.onSttEvent?.(message.payload as LexaraRealtimeSttEvent);
      return;
    }

    if (message.type === 'fatal') {
      const error = new Error(`LEXARA realtime voice failed: ${String(message.code || 'unknown')}`);
      this.failActiveSpeech(error);
      this.ready = false;
      this.onFatal?.(error);
      return;
    }

    if (message.type !== 'tts_control' || !message.payload) return;
    const payload = message.payload;

    if (payload.type === 'SpeechStarted') {
      const active = this.activeSpeech;
      if (active && !active.started) {
        active.started = true;
        active.onStart?.();
      }
      return;
    }

    if (payload.type === 'SpeechMetadata') {
      const active = this.activeSpeech;
      if (!active) return;
      if (active.progressTimeout !== null) {
        window.clearTimeout(active.progressTimeout);
        active.progressTimeout = null;
      }
      active.metadataComplete = true;
      this.maybeResolveSpeech(active);
      return;
    }

    if (payload.type === 'SpeechInterrupted') {
      const active = this.activeSpeech;
      if (!active) return;
      window.clearTimeout(active.timeout);
      if (active.progressTimeout !== null) window.clearTimeout(active.progressTimeout);
      this.activeSpeech = null;
      active.resolve();
    }
  }

  private maybeResolveSpeech(active: ActiveSpeech): void {
    if (this.activeSpeech !== active) return;
    if (!active.metadataComplete || !active.playbackDrained) return;
    window.clearTimeout(active.timeout);
    if (active.progressTimeout !== null) window.clearTimeout(active.progressTimeout);
    this.cumulativeRenderedFrames += this.renderedFrames;
    this.renderedFrames = 0;
    this.activeSpeech = null;
    reportRealtimeVoiceEvent('realtime-ended', {
      turnId: active.turnId,
      totalMs: Math.round(performance.now() - active.requestedAt),
    });
    active.resolve();
  }

  private failActiveSpeech(error: Error): void {
    const active = this.activeSpeech;
    if (!active) return;
    window.clearTimeout(active.timeout);
    if (active.progressTimeout !== null) window.clearTimeout(active.progressTimeout);
    this.activeSpeech = null;
    active.reject(error);
  }

  private clearPlayback(): void {
    this.playbackLevel = 0;
    this.playbackBrightness = 0;
    this.playbackZeroCrossingRate = 0;
    this.playback?.port.postMessage({ type: 'clear' });
  }
}

export const lexaraRealtimeVoiceClient = new LexaraRealtimeVoiceClient();
