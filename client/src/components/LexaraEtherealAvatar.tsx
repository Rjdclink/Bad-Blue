import { memo, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { getLexaraServerPlaybackClock } from '@/lib/lexaraSpeechClient';
import { lexaraRealtimeVoiceClient } from '@/lib/lexaraRealtimeVoiceClient';
import {
  LexaraEmbodimentEngine,
  type LexaraEmbodimentFrame,
  type LexaraEmbodimentMode,
} from '@/lib/lexaraEmbodimentEngine';

export type LEXARAEmotionHint = 'calm' | 'playful' | 'serious' | 'empathetic' | 'protective' | 'authoritative';
export type LEXARAGazeHint = 'camera' | 'side' | 'down' | 'up' | 'thinking';
export type LEXARAVoiceStyle = 'soft' | 'firm' | 'warm' | 'professional' | 'protective';

export interface LEXARAEtherealAvatarProps {
  isSpeaking?: boolean;
  isListening?: boolean;
  isThinking?: boolean;
  audioLevel?: number;
  emotionHint?: LEXARAEmotionHint;
  gazeHint?: LEXARAGazeHint;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const LEXARA_ATTORNEY_IMAGE_SOURCES = [
  '/images/oip.webp?v=20260920-embodied2',
  '/images/OIP.webp?v=20260920-embodied2',
  '/images/OIP.comp12.webp?v=20260920-embodied2',
  '/images/OIP.comp14.webp?v=20260920-embodied2',
] as const;

const SIZE_CONFIG = {
  sm: 'w-32 h-40',
  md: 'w-48 h-64',
  lg: 'w-64 h-80',
  xl: 'w-80 h-96',
  full: 'w-full h-full min-h-[400px]',
};

const LIVE_AVATAR_ENABLED = String(import.meta.env.VITE_LEXARA_LIVE_AVATAR_ENABLED ?? '1') !== '0';
const TARGET_FPS = 30;

interface LatestAvatarInput {
  isSpeaking: boolean;
  isListening: boolean;
  isThinking: boolean;
  emotionHint: LEXARAEmotionHint;
  gazeHint: LEXARAGazeHint;
}

interface ImageLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Region {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

function getMode(input: LatestAvatarInput): LexaraEmbodimentMode {
  if (input.isSpeaking) return 'speaking';
  if (input.isThinking) return 'thinking';
  if (input.isListening) return 'listening';
  return 'idle';
}

function reportAvatarEvent(
  event: 'avatar-renderer-ready' | 'avatar-motion-started' | 'avatar-renderer-error',
  details: Record<string, unknown> = {},
): void {
  const payload = JSON.stringify({
    event,
    source: 'avatar',
    renderer: 'lexara-portrait-rig-v3',
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
    // Avatar telemetry is observational only.
  }
  void fetch('/api/lexara/voice/playback-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}

function containLayout(
  canvasWidth: number,
  canvasHeight: number,
  naturalWidth: number,
  naturalHeight: number,
): ImageLayout {
  const scale = Math.min(canvasWidth / naturalWidth, canvasHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
  };
}

function point(layout: ImageLayout, nx: number, ny: number): { x: number; y: number } {
  return {
    x: layout.x + layout.width * nx,
    y: layout.y + layout.height * ny,
  };
}

function ellipseRegion(layout: ImageLayout, region: Region): {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
} {
  const center = point(layout, region.cx, region.cy);
  return {
    cx: center.x,
    cy: center.y,
    rx: layout.width * region.rx,
    ry: layout.height * region.ry,
  };
}

function drawImageWithLocalTransform(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  layout: ImageLayout,
  region: Region,
  transform: {
    dx?: number;
    dy?: number;
    rotationDeg?: number;
    scaleX?: number;
    scaleY?: number;
    alpha?: number;
    blurPx?: number;
  },
): void {
  const r = ellipseRegion(layout, region);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(r.cx, r.cy, r.rx, r.ry, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha = transform.alpha ?? 1;
  if (transform.blurPx) ctx.filter = `blur(${transform.blurPx}px)`;

  ctx.translate(r.cx + (transform.dx ?? 0), r.cy + (transform.dy ?? 0));
  ctx.rotate(((transform.rotationDeg ?? 0) * Math.PI) / 180);
  ctx.scale(transform.scaleX ?? 1, transform.scaleY ?? 1);
  ctx.translate(-r.cx, -r.cy);
  ctx.drawImage(image, layout.x, layout.y, layout.width, layout.height);
  ctx.restore();
}

function drawPatchShift(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  layout: ImageLayout,
  region: Region,
  dx: number,
  dy: number,
): void {
  const r = ellipseRegion(layout, region);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(r.cx, r.cy, r.rx, r.ry, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(dx, dy);
  ctx.drawImage(image, layout.x, layout.y, layout.width, layout.height);
  ctx.restore();
}

function sampleImageColor(
  image: HTMLImageElement,
  nx: number,
  ny: number,
  fallback: string,
): string {
  try {
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = Math.max(1, image.naturalWidth);
    sampleCanvas.height = Math.max(1, image.naturalHeight);
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!sampleCtx) return fallback;
    sampleCtx.drawImage(image, 0, 0);
    const x = Math.max(0, Math.min(image.naturalWidth - 1, Math.round(image.naturalWidth * nx)));
    const y = Math.max(0, Math.min(image.naturalHeight - 1, Math.round(image.naturalHeight * ny)));
    const pixel = sampleCtx.getImageData(x, y, 1, 1).data;
    return `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
  } catch {
    return fallback;
  }
}

function drawBlink(
  ctx: CanvasRenderingContext2D,
  layout: ImageLayout,
  eye: Region,
  blink: number,
  skinColor: string,
  headDx: number,
  headDy: number,
): void {
  if (blink <= 0.015) return;
  const r = ellipseRegion(layout, eye);
  const openness = Math.max(0.08, 1 - blink);
  const coverHeight = r.ry * (1 - openness) * 2.05;

  ctx.save();
  ctx.translate(headDx, headDy);
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.ellipse(r.cx, r.cy, r.rx * 1.08, Math.max(0.6, coverHeight), 0, 0, Math.PI * 2);
  ctx.fill();

  if (blink > 0.58) {
    ctx.strokeStyle = 'rgba(55, 36, 30, 0.72)';
    ctx.lineWidth = Math.max(0.65, layout.width * 0.0011);
    ctx.beginPath();
    ctx.moveTo(r.cx - r.rx * 0.72, r.cy);
    ctx.quadraticCurveTo(r.cx, r.cy + r.ry * 0.16, r.cx + r.rx * 0.72, r.cy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMouth(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  layout: ImageLayout,
  frame: LexaraEmbodimentFrame,
  headDx: number,
  headDy: number,
): void {
  // Tuned once for the canonical LEXARA attorney portrait. Values are normalized
  // to the actual image content and therefore survive responsive object-contain.
  const mouth: Region = { cx: 0.516, cy: 0.432, rx: 0.038, ry: 0.022 };
  const r = ellipseRegion(layout, mouth);
  const open = frame.mouthOpen;
  const wide = frame.mouthWide;
  const round = frame.mouthRound;
  const gap = open * r.ry * 1.18;
  const scaleX = 1 + wide * 0.10 - round * 0.055;
  const scaleY = 1 + round * 0.05;

  ctx.save();
  ctx.translate(headDx, headDy);

  if (open > 0.035) {
    ctx.fillStyle = 'rgba(39, 10, 14, 0.94)';
    ctx.beginPath();
    ctx.ellipse(r.cx, r.cy + gap * 0.12, r.rx * (0.72 + wide * 0.16), Math.max(0.8, gap * 0.82), 0, 0, Math.PI * 2);
    ctx.fill();

    if (open > 0.32 && wide > 0.34) {
      ctx.fillStyle = 'rgba(239, 228, 216, 0.90)';
      ctx.beginPath();
      ctx.ellipse(r.cx, r.cy - gap * 0.16, r.rx * 0.52, Math.max(0.45, gap * 0.16), 0, Math.PI, Math.PI * 2);
      ctx.fill();
    }
  }

  // Upper lip / philtrum half.
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.cx - r.rx * 1.2, r.cy - r.ry * 1.65, r.rx * 2.4, r.ry * 1.72);
  ctx.clip();
  ctx.translate(r.cx, r.cy - gap * 0.48);
  ctx.scale(scaleX, scaleY);
  ctx.translate(-r.cx, -r.cy);
  ctx.drawImage(image, layout.x, layout.y, layout.width, layout.height);
  ctx.restore();

  // Lower lip / chin half.
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.cx - r.rx * 1.2, r.cy, r.rx * 2.4, r.ry * 2.05);
  ctx.clip();
  ctx.translate(r.cx, r.cy + gap * 0.64);
  ctx.scale(scaleX, scaleY);
  ctx.translate(-r.cx, -r.cy);
  ctx.drawImage(image, layout.x, layout.y, layout.width, layout.height);
  ctx.restore();

  ctx.restore();
}

function renderEmbodiedFrame(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  layout: ImageLayout,
  frame: LexaraEmbodimentFrame,
  reducedMotion: boolean,
  skinColor: string,
): void {
  const width = layout.width;
  const height = layout.height;
  const motionScale = reducedMotion ? 0.26 : 1;

  const torsoDx = frame.torsoX * width * 0.0026 * motionScale;
  const torsoDy = frame.torsoY * height * 0.0042 * motionScale;
  const headDx = frame.headX * width * 0.0052 * motionScale;
  const headDy = frame.headY * height * 0.0042 * motionScale;
  const headRotation = frame.headRollDeg * 0.68 * motionScale;

  // Breathing and shoulder/torso movement. These are deliberately visible at
  // conversational viewing sizes but remain bounded so desk/background geometry
  // does not visibly shear.
  drawImageWithLocalTransform(
    ctx,
    image,
    layout,
    { cx: 0.515, cy: 0.775, rx: 0.275, ry: 0.19 },
    {
      dx: torsoDx,
      dy: torsoDy,
      rotationDeg: frame.torsoX * 0.22 * motionScale,
      // Never scale the throat/upper chest patch. Respiration is represented by
      // bounded lower-torso translation so the neck cannot visibly stretch.
      scaleX: reducedMotion ? 1 : 1 + (frame.torsoScaleX - 1) * 0.35,
      scaleY: reducedMotion ? 1 : 1 + (frame.torsoScaleY - 1) * 0.22,
      alpha: 0.985,
    },
  );

  // Hand/forearm regions move only when the behavior planner has speaking or
  // backchannel energy. This is not a canned gesture clip; it is continuous
  // motion coupled to the current behavioral state.
  if (!reducedMotion && (frame.gestureEnergy > 0.08 || Math.abs(frame.fidget) > 0.08)) {
    const handMotion = Math.min(1, frame.gestureEnergy + Math.abs(frame.fidget) * 0.34);
    drawImageWithLocalTransform(
      ctx,
      image,
      layout,
      { cx: 0.455, cy: 0.858, rx: 0.115, ry: 0.135 },
      {
        dx: Math.sin(frame.mouthOpen * 7.2 + frame.nod) * width * 0.0024 * handMotion,
        dy: -height * 0.0020 * handMotion,
        rotationDeg: -0.55 * handMotion + frame.fidget * 0.42,
        alpha: 0.98,
      },
    );
    drawImageWithLocalTransform(
      ctx,
      image,
      layout,
      { cx: 0.615, cy: 0.87, rx: 0.11, ry: 0.13 },
      {
        dx: width * 0.0014 * handMotion,
        dy: height * 0.0012 * handMotion,
        rotationDeg: 0.38 * handMotion - frame.fidget * 0.28,
        alpha: 0.98,
      },
    );
  }

  // Head/hair moves as one coherent region. The soft scale change is large
  // enough to read as real head motion instead of a sub-pixel CSS shimmer.
  drawImageWithLocalTransform(
    ctx,
    image,
    layout,
    { cx: 0.515, cy: 0.322, rx: 0.125, ry: 0.235 },
    {
      dx: headDx,
      dy: headDy,
      rotationDeg: headRotation,
      scaleX: 1 + Math.abs(frame.headX) * 0.0018 * motionScale,
      scaleY: 1 + frame.headPitch * 0.0024 * motionScale,
      alpha: 0.992,
    },
  );

  const gazeDx = frame.gazeX * width * 0.00165 * motionScale;
  const gazeDy = frame.gazeY * height * 0.00115 * motionScale;
  const leftEye: Region = { cx: 0.489, cy: 0.298, rx: 0.018, ry: 0.0105 };
  const rightEye: Region = { cx: 0.543, cy: 0.298, rx: 0.018, ry: 0.0105 };

  if (frame.blink < 0.82) {
    drawPatchShift(ctx, image, layout, leftEye, headDx - gazeDx, headDy - gazeDy);
    drawPatchShift(ctx, image, layout, rightEye, headDx - gazeDx, headDy - gazeDy);
  }

  // Eyebrow response gives thinking/emphasis a visible facial component.
  if (!reducedMotion && Math.abs(frame.browLift) > 0.035) {
    const browDy = -frame.browLift * height * 0.0028;
    drawPatchShift(ctx, image, layout, { cx: 0.489, cy: 0.276, rx: 0.025, ry: 0.010 }, headDx, headDy + browDy);
    drawPatchShift(ctx, image, layout, { cx: 0.543, cy: 0.276, rx: 0.025, ry: 0.010 }, headDx, headDy + browDy);
  }

  drawBlink(ctx, layout, leftEye, frame.blink, skinColor, headDx, headDy);
  drawBlink(ctx, layout, rightEye, frame.blink, skinColor, headDx, headDy);

  // Mouth geometry is driven from already-rendered TTS PCM features, not the
  // microphone. It remains active even when prefers-reduced-motion is enabled
  // because lip motion is communicative, not decorative.
  drawMouth(ctx, image, layout, frame, headDx, headDy);
}

/**
 * Canonical LEXARA attorney portrait.
 *
 * The base photograph is never replaced or blocked by the animation system.
 * A transparent behavioral canvas is a read-only subscriber to the authoritative
 * conversation and audio clocks. If this layer fails, text/TTS continue and the
 * unchanged attorney image remains visible underneath.
 */
export const LEXARAAttorneyPortrait = memo(function LEXARAAttorneyPortrait({
  isSpeaking = false,
  isListening = false,
  isThinking = false,
  emotionHint = 'calm',
  gazeHint = 'camera',
  className,
  size = 'full',
}: LEXARAEtherealAvatarProps) {
  const [imageIndex, setImageIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestInputRef = useRef<LatestAvatarInput>({
    isSpeaking,
    isListening,
    isThinking,
    emotionHint,
    gazeHint,
  });

  latestInputRef.current = {
    isSpeaking,
    isListening,
    isThinking,
    emotionHint,
    gazeHint,
  };

  const imageSrc = LEXARA_ATTORNEY_IMAGE_SOURCES[Math.min(imageIndex, LEXARA_ATTORNEY_IMAGE_SOURCES.length - 1)];

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);

  useEffect(() => {
    if (!LIVE_AVATAR_ENABLED) return undefined;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return undefined;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return undefined;

    let disposed = false;
    let frameHandle = 0;
    let lastPaintMs = 0;
    let rendererReported = false;
    let rendererFailed = false;
    let lastMotionTurnKey = '';
    let skinColor = 'rgb(177, 132, 108)';
    const engine = new LexaraEmbodimentEngine(0x4c455841);
    const image = new Image();
    image.decoding = 'async';
    image.src = imageSrc;

    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      const cssWidth = Math.max(1, Math.round(rect.width));
      const cssHeight = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
      const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
    };

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(resizeCanvas)
      : null;
    observer?.observe(container);
    window.addEventListener('resize', resizeCanvas, { passive: true });
    resizeCanvas();

    image.onload = () => {
      skinColor = sampleImageColor(image, 0.515, 0.258, skinColor);
      engine.reset(performance.now());
    };

    const paint = (nowMs: number) => {
      if (disposed) return;
      frameHandle = window.requestAnimationFrame(paint);
      if (!image.complete || !image.naturalWidth || !image.naturalHeight) return;
      if (nowMs - lastPaintMs < 1000 / TARGET_FPS) return;
      lastPaintMs = nowMs;

      if (rendererFailed) return;

      const input = latestInputRef.current;
      const mode = getMode(input);
      const realtimeClock = lexaraRealtimeVoiceClient.getPlaybackClock();
      const serverClock = getLexaraServerPlaybackClock();
      const audioActive = realtimeClock.active || serverClock.active;
      const audioTime = realtimeClock.active
        ? realtimeClock.currentTimeSec
        : serverClock.active
          ? serverClock.currentTimeSec
          : 0;

      const frame = engine.update({
        nowMs,
        mode,
        emotionHint: input.emotionHint,
        gazeHint: input.gazeHint,
        audio: {
          active: audioActive,
          currentTimeSec: audioTime,
          level: realtimeClock.active ? realtimeClock.level : Number.NaN,
          brightness: realtimeClock.active ? realtimeClock.brightness : undefined,
          zeroCrossingRate: realtimeClock.active ? realtimeClock.zeroCrossingRate : undefined,
          turnId: realtimeClock.turnId,
        },
      });

      const rect = canvas.getBoundingClientRect();
      const dprX = canvas.width / Math.max(1, rect.width);
      const dprY = canvas.height / Math.max(1, rect.height);
      ctx.setTransform(dprX, 0, 0, dprY, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const layout = containLayout(
        rect.width,
        rect.height,
        image.naturalWidth,
        image.naturalHeight,
      );

      try {
        renderEmbodiedFrame(ctx, image, layout, frame, reducedMotion, skinColor);

        if (!rendererReported) {
          rendererReported = true;
          reportAvatarEvent('avatar-renderer-ready', {
            reducedMotion,
            mode,
          });
        }

        if (mode === 'speaking' && frame.mouthOpen > 0.08) {
          const turnKey = realtimeClock.turnId || `server-${Math.floor(audioTime * 2)}`;
          if (turnKey && turnKey !== lastMotionTurnKey) {
            lastMotionTurnKey = turnKey;
            reportAvatarEvent('avatar-motion-started', {
              reducedMotion,
              mode,
              turnId: realtimeClock.turnId,
              mouthOpen: Number(frame.mouthOpen.toFixed(3)),
            });
          }
        }
      } catch (error) {
        rendererFailed = true;
        ctx.clearRect(0, 0, rect.width, rect.height);
        reportAvatarEvent('avatar-renderer-error', {
          reducedMotion,
          mode,
          error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
        });
      }
    };

    frameHandle = window.requestAnimationFrame(paint);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameHandle);
      observer?.disconnect();
      window.removeEventListener('resize', resizeCanvas);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [imageSrc, reducedMotion]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl',
        SIZE_CONFIG[size],
        className,
      )}
      style={{ contain: 'layout paint' }}
      aria-label="LEXARA professional legal assistant"
      data-live-avatar={LIVE_AVATAR_ENABLED ? 'portrait-rig-v3' : 'static'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
    >
      <img
        src={imageSrc}
        alt="LEXARA professional attorney seated behind her desk"
        className="h-full w-full bg-slate-950 object-contain object-center"
        draggable={false}
        decoding="async"
        fetchPriority="high"
        onError={() => {
          setImageIndex(current => Math.min(current + 1, LEXARA_ATTORNEY_IMAGE_SOURCES.length - 1));
        }}
      />

      {LIVE_AVATAR_ENABLED && (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full select-none"
        />
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-slate-950/70 via-slate-950/20 to-transparent" />

      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-slate-950/72 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
        {isSpeaking ? 'Speaking' : isThinking ? 'Analyzing' : isListening ? 'Listening' : 'LEXARA'}
      </div>
    </div>
  );
});

export function LEXARAStatusIndicator({
  isSpeaking = false,
  isListening = false,
  isThinking = false,
  className,
}: {
  isSpeaking?: boolean;
  isListening?: boolean;
  isThinking?: boolean;
  className?: string;
}) {
  const state = isSpeaking ? 'speaking' : isThinking ? 'thinking' : isListening ? 'listening' : 'idle';
  return (
    <span
      className={cn(
        'inline-block h-2.5 w-2.5 rounded-full',
        state === 'idle' ? 'bg-slate-400' : 'bg-emerald-400 animate-pulse',
        className,
      )}
      aria-label={`LEXARA ${state}`}
    />
  );
}

// Backward-compatible symbol only. The production component is the attorney
// portrait rig; no Ethereal visual system is instantiated.
export const LEXARAEtherealAvatar = LEXARAAttorneyPortrait;

export default LEXARAAttorneyPortrait;
