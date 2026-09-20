export type LexaraEmbodimentMode = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface LexaraEmbodimentAudioFrame {
  active: boolean;
  currentTimeSec: number;
  level: number;
  brightness?: number;
  zeroCrossingRate?: number;
  turnId?: string | null;
}

export interface LexaraEmbodimentInput {
  nowMs: number;
  mode: LexaraEmbodimentMode;
  audio: LexaraEmbodimentAudioFrame;
  emotionHint: 'calm' | 'playful' | 'serious' | 'empathetic' | 'protective' | 'authoritative';
  gazeHint: 'camera' | 'side' | 'down' | 'up' | 'thinking';
}

export interface LexaraEmbodimentFrame {
  mode: LexaraEmbodimentMode;
  breath: number;
  blink: number;
  gazeX: number;
  gazeY: number;
  headX: number;
  headY: number;
  headRollDeg: number;
  headPitch: number;
  torsoX: number;
  torsoY: number;
  torsoScaleX: number;
  torsoScaleY: number;
  shoulderLift: number;
  nod: number;
  browLift: number;
  smile: number;
  mouthOpen: number;
  mouthWide: number;
  mouthRound: number;
  gestureEnergy: number;
  attention: number;
}

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

function exponentialSmoothing(current: number, target: number, dtSec: number, speed: number): number {
  if (!Number.isFinite(current)) return target;
  const alpha = 1 - Math.exp(-Math.max(0, dtSec) * speed);
  return current + (target - current) * alpha;
}

/**
 * A small One-Euro-style scalar filter. It keeps slow body/gaze motion stable
 * while allowing rapid speech-linked motion to remain responsive.
 */
class OneEuroScalar {
  private initialized = false;
  private value = 0;
  private derivative = 0;
  constructor(
    private readonly minCutoff = 1.5,
    private readonly beta = 0.12,
    private readonly derivativeCutoff = 1,
  ) {}

  private alpha(cutoff: number, dtSec: number): number {
    if (dtSec <= 0) return 1;
    const tau = 1 / (2 * Math.PI * Math.max(0.001, cutoff));
    return 1 / (1 + tau / dtSec);
  }

  update(next: number, dtSec: number): number {
    if (!this.initialized) {
      this.initialized = true;
      this.value = next;
      this.derivative = 0;
      return next;
    }

    const rawDerivative = dtSec > 0 ? (next - this.value) / dtSec : 0;
    const derivativeAlpha = this.alpha(this.derivativeCutoff, dtSec);
    this.derivative += (rawDerivative - this.derivative) * derivativeAlpha;

    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    const valueAlpha = this.alpha(cutoff, dtSec);
    this.value += (next - this.value) * valueAlpha;
    return this.value;
  }

  reset(value = 0): void {
    this.initialized = false;
    this.value = value;
    this.derivative = 0;
  }
}

/**
 * Stateful, non-blocking conversational behavior planner.
 *
 * It does not generate pixels and it never owns text/TTS timing. It translates
 * the already-authoritative conversation state + rendered audio clock into a
 * continuous embodied state used by whichever visual renderer is available.
 */
export class LexaraEmbodimentEngine {
  private rng = 0x5f3759df;
  private lastNowMs = 0;
  private nextBlinkMs = 0;
  private blinkStartMs = -1;
  private blinkDurationMs = 145;
  private queuedDoubleBlink = false;
  private nextNodMs = 0;
  private nodStartMs = -1;
  private nodDurationMs = 620;
  private nextGazeShiftMs = 0;
  private gazeTargetX = 0;
  private gazeTargetY = 0;
  private lastAudioLevel = 0;
  private smoothedMouthOpen = 0;
  private smoothedGestureEnergy = 0;
  private headXFilter = new OneEuroScalar(1.2, 0.18);
  private headYFilter = new OneEuroScalar(1.2, 0.18);
  private gazeXFilter = new OneEuroScalar(2.0, 0.3);
  private gazeYFilter = new OneEuroScalar(2.0, 0.3);

  constructor(seed = 0x5f3759df) {
    this.rng = seed >>> 0 || 0x5f3759df;
  }

  private random(): number {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng / 0xffffffff;
  }

  private scheduleBlink(nowMs: number): void {
    this.nextBlinkMs = nowMs + 2200 + this.random() * 3300;
  }

  private scheduleNod(nowMs: number, mode: LexaraEmbodimentMode): void {
    const base = mode === 'listening' ? 3000 : mode === 'speaking' ? 4200 : 6500;
    this.nextNodMs = nowMs + base + this.random() * (mode === 'listening' ? 2800 : 4200);
  }

  private scheduleGazeShift(nowMs: number, mode: LexaraEmbodimentMode): void {
    const base = mode === 'thinking' ? 900 : mode === 'listening' ? 1800 : 2200;
    this.nextGazeShiftMs = nowMs + base + this.random() * 2600;
  }

  reset(nowMs = performance.now()): void {
    this.lastNowMs = nowMs;
    this.blinkStartMs = -1;
    this.nodStartMs = -1;
    this.lastAudioLevel = 0;
    this.smoothedMouthOpen = 0;
    this.smoothedGestureEnergy = 0;
    this.gazeTargetX = 0;
    this.gazeTargetY = 0;
    this.headXFilter.reset();
    this.headYFilter.reset();
    this.gazeXFilter.reset();
    this.gazeYFilter.reset();
    this.scheduleBlink(nowMs);
    this.scheduleNod(nowMs, 'idle');
    this.scheduleGazeShift(nowMs, 'idle');
  }

  update(input: LexaraEmbodimentInput): LexaraEmbodimentFrame {
    const nowMs = input.nowMs;
    if (!this.lastNowMs) this.reset(nowMs);
    const dtSec = clamp((nowMs - this.lastNowMs) / 1000, 0.001, 0.08);
    this.lastNowMs = nowMs;

    if (!this.nextBlinkMs) this.scheduleBlink(nowMs);
    if (!this.nextNodMs) this.scheduleNod(nowMs, input.mode);
    if (!this.nextGazeShiftMs) this.scheduleGazeShift(nowMs, input.mode);

    // Blink scheduler: non-periodic, occasionally double-blinks, and never waits
    // on network/model work.
    if (this.blinkStartMs < 0 && nowMs >= this.nextBlinkMs) {
      this.blinkStartMs = nowMs;
      this.blinkDurationMs = 115 + this.random() * 55;
      this.queuedDoubleBlink = this.random() < 0.14;
    }

    let blink = 0;
    if (this.blinkStartMs >= 0) {
      const t = (nowMs - this.blinkStartMs) / this.blinkDurationMs;
      if (t >= 1) {
        if (this.queuedDoubleBlink) {
          this.queuedDoubleBlink = false;
          this.blinkStartMs = nowMs + 70;
        } else {
          this.blinkStartMs = -1;
          this.scheduleBlink(nowMs);
        }
      } else if (t >= 0) {
        blink = Math.pow(Math.sin(Math.PI * t), 0.72);
      }
    }

    // Conversational nods are state dependent. Listening gets genuine
    // backchannel-like nod opportunities; speaking nods are less frequent.
    if (this.nodStartMs < 0 && nowMs >= this.nextNodMs && (input.mode === 'listening' || input.mode === 'speaking')) {
      this.nodStartMs = nowMs;
      this.nodDurationMs = input.mode === 'listening' ? 520 + this.random() * 220 : 620 + this.random() * 260;
    }

    let nod = 0;
    if (this.nodStartMs >= 0) {
      const t = (nowMs - this.nodStartMs) / this.nodDurationMs;
      if (t >= 1) {
        this.nodStartMs = -1;
        this.scheduleNod(nowMs, input.mode);
      } else if (t >= 0) {
        nod = Math.sin(Math.PI * t) * Math.sin(Math.PI * t * 2) * 0.8;
      }
    }

    // Gaze targets come from conversational intent, then vary within a bounded
    // human range instead of repeating a canned loop.
    if (nowMs >= this.nextGazeShiftMs) {
      const r1 = this.random() * 2 - 1;
      const r2 = this.random() * 2 - 1;
      if (input.gazeHint === 'thinking' || input.mode === 'thinking') {
        this.gazeTargetX = (r1 < 0 ? -0.62 : 0.62) + r1 * 0.14;
        this.gazeTargetY = 0.24 + Math.abs(r2) * 0.28;
      } else if (input.gazeHint === 'side') {
        this.gazeTargetX = r1 < 0 ? -0.72 : 0.72;
        this.gazeTargetY = r2 * 0.12;
      } else if (input.gazeHint === 'down') {
        this.gazeTargetX = r1 * 0.12;
        this.gazeTargetY = 0.48 + Math.abs(r2) * 0.2;
      } else if (input.gazeHint === 'up') {
        this.gazeTargetX = r1 * 0.12;
        this.gazeTargetY = -0.42 - Math.abs(r2) * 0.14;
      } else {
        const directness = input.mode === 'listening' ? 0.16 : 0.22;
        this.gazeTargetX = r1 * directness;
        this.gazeTargetY = r2 * directness * 0.55;
      }
      this.scheduleGazeShift(nowMs, input.mode);
    }

    const gazeX = this.gazeXFilter.update(this.gazeTargetX, dtSec);
    const gazeY = this.gazeYFilter.update(this.gazeTargetY, dtSec);

    const timeSec = nowMs / 1000;
    const breathingPeriod =
      input.mode === 'speaking' ? 4.0
        : input.mode === 'thinking' ? 5.1
          : input.mode === 'listening' ? 4.5
            : 4.7;
    const breath = Math.sin((timeSec / breathingPeriod) * Math.PI * 2);

    const audio = input.audio;
    const fallbackSpeech =
      input.mode === 'speaking'
        ? clamp(
            0.38
              + Math.sin(audio.currentTimeSec * 24.7) * 0.23
              + Math.sin(audio.currentTimeSec * 41.3 + 0.8) * 0.16,
            0.04,
            0.92,
          )
        : 0;

    const rawLevel = audio.active ? clamp(audio.level * 1.45, 0, 1) : fallbackSpeech;
    const attack = rawLevel > this.smoothedMouthOpen ? 18 : 10;
    this.smoothedMouthOpen = exponentialSmoothing(this.smoothedMouthOpen, rawLevel, dtSec, attack);

    const brightness = clamp(Number.isFinite(audio.brightness) ? Number(audio.brightness) : 0.35);
    const zcr = clamp(Number.isFinite(audio.zeroCrossingRate) ? Number(audio.zeroCrossingRate) : 0.22);
    const onset = clamp((rawLevel - this.lastAudioLevel) * 4, 0, 1);
    this.lastAudioLevel = rawLevel;

    const mouthWideTarget = audio.active
      ? clamp(zcr * 2.6 + brightness * 0.62 + onset * 0.22)
      : clamp(0.4 + Math.sin(audio.currentTimeSec * 10.3) * 0.2);
    const mouthRoundTarget = audio.active
      ? clamp((1 - zcr) * 0.58 + (1 - brightness) * 0.28)
      : clamp(0.35 + Math.sin(audio.currentTimeSec * 7.1 + 1.4) * 0.18);

    const gestureTarget = input.mode === 'speaking'
      ? clamp(this.smoothedMouthOpen * 0.72 + onset * 0.55)
      : input.mode === 'listening'
        ? 0.16 + Math.max(0, nod) * 0.45
        : input.mode === 'thinking'
          ? 0.10
          : 0.06;
    this.smoothedGestureEnergy = exponentialSmoothing(this.smoothedGestureEnergy, gestureTarget, dtSec, 5.5);

    const emotionSmile =
      input.emotionHint === 'playful' ? 0.68
        : input.emotionHint === 'empathetic' ? 0.28
          : input.emotionHint === 'calm' ? 0.12
            : input.emotionHint === 'protective' ? 0.04
              : -0.08;

    const browTarget =
      input.mode === 'thinking' ? 0.30
        : input.emotionHint === 'empathetic' ? 0.22
          : input.emotionHint === 'authoritative' || input.emotionHint === 'serious' ? -0.12
            : onset * 0.34;

    const thinkingBias = input.mode === 'thinking' ? (gazeX >= 0 ? 0.72 : -0.72) : 0;
    const listeningLean = input.mode === 'listening' ? 0.28 : 0;
    const speechBeat = input.mode === 'speaking'
      ? Math.sin((audio.active ? audio.currentTimeSec : timeSec) * 5.4) * this.smoothedGestureEnergy
      : 0;

    const headXTarget = gazeX * 0.44 + thinkingBias * 0.35 + Math.sin(timeSec * 0.47) * 0.10;
    const headYTarget = -breath * 0.10 + nod * 0.62 + speechBeat * 0.14;
    const headX = this.headXFilter.update(headXTarget, dtSec);
    const headY = this.headYFilter.update(headYTarget, dtSec);

    const attention =
      input.mode === 'listening' ? 1
        : input.mode === 'speaking' ? 0.94
          : input.mode === 'thinking' ? 0.72
            : 0.62;

    return {
      mode: input.mode,
      breath,
      blink: clamp(blink),
      gazeX: clamp(gazeX, -1, 1),
      gazeY: clamp(gazeY, -1, 1),
      headX: clamp(headX, -1, 1),
      headY: clamp(headY, -1, 1),
      headRollDeg: clamp((gazeX * -1.15) + thinkingBias * 0.9 + speechBeat * 0.34, -2.4, 2.4),
      headPitch: clamp(nod + (input.mode === 'thinking' ? 0.18 : 0), -1, 1),
      torsoX: clamp(Math.sin(timeSec * 0.31) * 0.10 + gazeX * 0.08, -1, 1),
      torsoY: clamp(breath * 0.32 - listeningLean * 0.12, -1, 1),
      torsoScaleX: 1 + breath * 0.0018,
      torsoScaleY: 1 + breath * 0.0048 + (input.mode === 'listening' ? 0.0014 : 0),
      shoulderLift: clamp(breath * 0.36 + this.smoothedGestureEnergy * 0.16, -1, 1),
      nod: clamp(nod, -1, 1),
      browLift: clamp(browTarget, -1, 1),
      smile: clamp(emotionSmile, -1, 1),
      mouthOpen: clamp(this.smoothedMouthOpen),
      mouthWide: clamp(mouthWideTarget),
      mouthRound: clamp(mouthRoundTarget),
      gestureEnergy: clamp(this.smoothedGestureEnergy),
      attention,
    };
  }
}
