import { memo, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { getLexaraServerPlaybackClock } from '@/lib/lexaraSpeechClient';
import { lexaraRealtimeVoiceClient } from '@/lib/lexaraRealtimeVoiceClient';
import { sampleLexaraClipMotion } from '@/lib/lexaraClipMotion';
import {
  getLexaraPreparedFacePose,
  type LexaraPreparedFacePose,
} from '@/lib/lexaraPreparedFacePoses';
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
const CLIP_MOTION_ENABLED = String(import.meta.env.VITE_LEXARA_CLIP_MOTION_ENABLED ?? '1') !== '0';
// The audio player is authoritative. This read-only canvas may use its PCM features
// for mouth timing, but it never changes the voice stream or audio controls.
const LEGACY_PORTRAIT_MOUTH_OVERLAY_ENABLED =
  String(import.meta.env.VITE_LEXARA_LEGACY_PORTRAIT_MOUTH_OVERLAY_ENABLED ?? '1') !== '0';
// All other local portrait patches are off by default: they create artifacts when
// a small still image is independently re-composited around the face and body.
const LEGACY_PORTRAIT_NON_MOUTH_OVERLAYS_ENABLED =
  String(import.meta.env.VITE_LEXARA_LEGACY_PORTRAIT_NON_MOUTH_OVERLAYS_ENABLED ?? '0') === 'unsafe-experiment';
const PORTRAIT_BREATHING_ENABLED =
  String(import.meta.env.VITE_LEXARA_PORTRAIT_BREATHING_ENABLED ?? '1') !== '0';
const PREPARED_PORTRAIT_FACE_ENABLED =
  String(import.meta.env.VITE_LEXARA_PREPARED_FACE_ENABLED ?? '1') !== '0';
const LEXARA_MOUTH_ATLAS_SRC = '/images/lexara-mouth-atlas.webp?v=20260922-continuous120';
const TARGET_FPS = 60;

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

interface FeatheredPatchSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

// Shift the mouth about one source pixel lower than the previous midpoint.
// Portrait-relative coordinates preserve its position across viewport sizes.
// Single immutable registration point: the closed-lip seam midpoint in the
// canonical portrait. Every mouth child is derived from this point; no child
// layer owns an independent x/y origin.
const LEXARA_MOUTH_ANCHOR = Object.freeze({ cx: 0.520, cy: 0.317 });
const LEXARA_MOUTH_REGION: Region = Object.freeze({
  cx: LEXARA_MOUTH_ANCHOR.cx,
  cy: LEXARA_MOUTH_ANCHOR.cy,
  rx: 0.040,
  ry: 0.0115,
});
const LEXARA_MOUTH_LANDMARKS = Object.freeze({
  seam: LEXARA_MOUTH_ANCHOR,
  leftCorner: { x: 0.480, y: 0.317 },
  rightCorner: { x: 0.560, y: 0.317 },
  upperCenter: { x: 0.520, y: 0.3055 },
  lowerCenter: { x: 0.520, y: 0.3285 },
});

function blendPreparedFacePose(frame: LexaraEmbodimentFrame): LexaraPreparedFacePose {
  const previous = getLexaraPreparedFacePose(frame.mouthPreviousPoseIndex);
  const current = getLexaraPreparedFacePose(frame.mouthPoseIndex);
  const rawBlend = Math.max(0, Math.min(1, frame.mouthPoseBlend));
  const blend = rawBlend * rawBlend * (3 - 2 * rawBlend);
  const mix = (from: number, to: number) => from + (to - from) * blend;
  return {
    ...current,
    mouthOpen: mix(previous.mouthOpen, current.mouthOpen),
    mouthWide: mix(previous.mouthWide, current.mouthWide),
    mouthRound: mix(previous.mouthRound, current.mouthRound),
    jawDrop: mix(previous.jawDrop, current.jawDrop),
    cheekLift: mix(previous.cheekLift, current.cheekLift),
    browLift: mix(previous.browLift, current.browLift),
  };
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
    renderer: 'embodied-canvas-v2',
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

function drawFeatheredImageTransform(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  layout: ImageLayout,
  region: Region,
  transform: {
    dx?: number;
    dy?: number;
    scaleX?: number;
    scaleY?: number;
    alpha?: number;
  },
  surface: FeatheredPatchSurface,
): void {
  const r = ellipseRegion(layout, region);
  const padding = Math.max(2, Math.min(r.rx, r.ry) * 0.18);
  const left = r.cx - r.rx - padding;
  const top = r.cy - r.ry - padding;
  const cssWidth = Math.max(2, (r.rx + padding) * 2);
  const cssHeight = Math.max(2, (r.ry + padding) * 2);
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const pixelWidth = Math.max(2, Math.ceil(cssWidth * dpr));
  const pixelHeight = Math.max(2, Math.ceil(cssHeight * dpr));
  if (surface.canvas.width !== pixelWidth || surface.canvas.height !== pixelHeight) {
    surface.canvas.width = pixelWidth;
    surface.canvas.height = pixelHeight;
  }

  const patchCtx = surface.ctx;
  patchCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  patchCtx.clearRect(0, 0, cssWidth, cssHeight);
  patchCtx.globalCompositeOperation = 'source-over';
  patchCtx.globalAlpha = transform.alpha ?? 1;

  const localCx = r.cx - left;
  const localCy = r.cy - top;
  patchCtx.save();
  patchCtx.translate(localCx + (transform.dx ?? 0), localCy + (transform.dy ?? 0));
  patchCtx.scale(transform.scaleX ?? 1, transform.scaleY ?? 1);
  patchCtx.translate(-localCx, -localCy);
  patchCtx.drawImage(image, layout.x - left, layout.y - top, layout.width, layout.height);
  patchCtx.restore();

  // Feathering keeps every moving patch attached to the unchanged portrait.
  // Hard-edged face patches caused the earlier intermittent oval/seam artifact.
  patchCtx.globalCompositeOperation = 'destination-in';
  patchCtx.globalAlpha = 1;
  patchCtx.save();
  patchCtx.translate(localCx, localCy);
  patchCtx.scale(1, r.ry / Math.max(0.001, r.rx));
  const mask = patchCtx.createRadialGradient(0, 0, r.rx * 0.48, 0, 0, r.rx);
  mask.addColorStop(0, 'rgba(0, 0, 0, 1)');
  mask.addColorStop(0.72, 'rgba(0, 0, 0, 0.98)');
  mask.addColorStop(0.90, 'rgba(0, 0, 0, 0.42)');
  mask.addColorStop(1, 'rgba(0, 0, 0, 0)');
  patchCtx.fillStyle = mask;
  patchCtx.beginPath();
  patchCtx.arc(0, 0, r.rx, 0, Math.PI * 2);
  patchCtx.fill();
  patchCtx.restore();
  patchCtx.globalCompositeOperation = 'source-over';

  ctx.drawImage(surface.canvas, 0, 0, pixelWidth, pixelHeight, left, top, cssWidth, cssHeight);
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
  mouthAtlas: HTMLImageElement | null,
  layout: ImageLayout,
  frame: LexaraEmbodimentFrame,
  headDx: number,
  headDy: number,
): void {
  // Coordinates are calibrated against the original 239x239 production image.
  // The original y=0.357 target was below the real lips and visibly animated the
  // chin/throat instead; production capture calibration now centers the lip-only
  // layer halfway between the rejected low and high positions.
  const anchor = point(layout, LEXARA_MOUTH_ANCHOR.cx, LEXARA_MOUTH_ANCHOR.cy);
  const r = {
    cx: anchor.x,
    cy: anchor.y,
    rx: layout.width * LEXARA_MOUTH_REGION.rx,
    ry: layout.height * LEXARA_MOUTH_REGION.ry,
  };
  const pose = blendPreparedFacePose(frame);
  const open = Math.min(0.60, Math.max(frame.mouthOpen * 0.95, pose.mouthOpen * 0.68));
  const wide = Math.min(1, Math.max(frame.mouthWide * 0.52, pose.mouthWide));
  const round = Math.min(1, Math.max(frame.mouthRound * 0.48, pose.mouthRound));
  const baseHalfWidth = layout.width * ((LEXARA_MOUTH_LANDMARKS.rightCorner.x - LEXARA_MOUTH_LANDMARKS.leftCorner.x) / 2);
  const baseUpper = layout.height * (LEXARA_MOUTH_LANDMARKS.seam.cy - LEXARA_MOUTH_LANDMARKS.upperCenter.y);
  const baseLower = layout.height * (LEXARA_MOUTH_LANDMARKS.lowerCenter.y - LEXARA_MOUTH_LANDMARKS.seam.cy);
  const cornerScale = Math.max(0.91, Math.min(1.11, 1 + wide * 0.10 - round * 0.075));
  const lipHalfWidth = baseHalfWidth * cornerScale;
  const gap = Math.max(0, Math.min(r.ry * 1.32, open * r.ry * 2.20));
  const upperExtent = Math.max(r.ry * 0.72, Math.min(r.ry * 1.28, baseUpper * (0.92 + open * 0.34)));
  const lowerExtent = Math.max(r.ry * 0.68, Math.min(r.ry * 1.78, baseLower * (0.80 + open * 1.22)));
  // Keep the source-mouth centroid and both commissures fixed. Speech may change
  // aperture/curvature, but ordinary visemes cannot translate or horizontally
  // rescale the photographed lips.
  const scaleX = 1;

  const traceLipBoundary = () => {
    ctx.beginPath();
    ctx.moveTo(r.cx - lipHalfWidth, r.cy);
    ctx.bezierCurveTo(
      r.cx - lipHalfWidth * 0.56,
      r.cy - upperExtent,
      r.cx - lipHalfWidth * 0.18,
      r.cy - upperExtent * 0.86,
      r.cx,
      r.cy - upperExtent * 0.48,
    );
    ctx.bezierCurveTo(
      r.cx + lipHalfWidth * 0.18,
      r.cy - upperExtent * 0.86,
      r.cx + lipHalfWidth * 0.56,
      r.cy - upperExtent,
      r.cx + lipHalfWidth,
      r.cy,
    );
    ctx.bezierCurveTo(
      r.cx + lipHalfWidth * 0.58,
      r.cy + lowerExtent * 0.88,
      r.cx + lipHalfWidth * 0.18,
      r.cy + lowerExtent,
      r.cx,
      r.cy + lowerExtent * 0.78,
    );
    ctx.bezierCurveTo(
      r.cx - lipHalfWidth * 0.18,
      r.cy + lowerExtent,
      r.cx - lipHalfWidth * 0.58,
      r.cy + lowerExtent * 0.88,
      r.cx - lipHalfWidth,
      r.cy,
    );
    ctx.closePath();
  };

  ctx.save();
  ctx.translate(headDx, headDy);
  traceLipBoundary();
  ctx.clip();

  // Warp the photographed lips around fixed corners instead of translating two
  // rectangular halves. Each narrow strip moves most at the center and reaches
  // zero displacement at both commissures, preserving registration and symmetry.
  const stripCount = 24;
  const stripWidth = (lipHalfWidth * 2) / stripCount;
  for (let index = 0; index < stripCount; index += 1) {
    const stripLeft = r.cx - lipHalfWidth + index * stripWidth;
    const stripCenter = stripLeft + stripWidth / 2;
    const normalizedX = Math.max(-1, Math.min(1, (stripCenter - r.cx) / Math.max(0.001, lipHalfWidth)));
    const centerWeight = Math.pow(Math.max(0, 1 - normalizedX * normalizedX), 1.35);
    const upperDy = -gap * 0.20 * centerWeight;
    const lowerDy = gap * 0.58 * centerWeight;

    ctx.save();
    ctx.beginPath();
    ctx.rect(stripLeft - 0.35, r.cy - upperExtent, stripWidth + 0.7, upperExtent);
    ctx.clip();
    ctx.translate(0, upperDy);
    ctx.drawImage(image, layout.x, layout.y, layout.width, layout.height);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(stripLeft - 0.35, r.cy, stripWidth + 0.7, lowerExtent);
    ctx.clip();
    ctx.translate(0, lowerDy);
    ctx.drawImage(image, layout.x, layout.y, layout.width, layout.height);
    ctx.restore();
  }

  // Preserve the portrait's real lip texture, with a restrained color lift.
  // Paint the aperture last so moving lip pixels cannot hide the voice shape.
  ctx.fillStyle = 'rgba(142, 79, 83, 0.16)';
  ctx.beginPath();
  ctx.ellipse(r.cx, r.cy - upperExtent * 0.34 - gap * 0.22, lipHalfWidth * 0.82, upperExtent * 0.37, 0, 0, Math.PI * 2);
  ctx.ellipse(r.cx, r.cy + lowerExtent * 0.37 + gap * 0.48, lipHalfWidth * 0.80, lowerExtent * 0.39, 0, 0, Math.PI * 2);
  ctx.fill();

  if (open > 0.025) {
    const innerCx = r.cx;
    const innerCy = r.cy + gap * 0.16;
    const innerRx = Math.max(baseHalfWidth * 0.48, Math.min(lipHalfWidth * 0.72, lipHalfWidth * (0.58 + open * 0.12)));
    const innerRy = Math.max(0.32, Math.min(r.ry * 0.72, gap * 0.46));

    ctx.fillStyle = 'rgba(39, 10, 14, 0.94)';
    ctx.beginPath();
    ctx.ellipse(innerCx, innerCy, innerRx, innerRy, 0, 0, Math.PI * 2);
    ctx.fill();

    if (mouthAtlas?.complete && mouthAtlas.naturalWidth >= 512 && mouthAtlas.naturalHeight >= 288) {
      const cellWidth = 128;
      const cellHeight = 72;
      // Atlas cells contain useful interior detail but must not own placement.
      // Draw exactly one selected interior texture per frame into the canonical
      // aperture. Cross-fading two photographed cells was the visible "layer"
      // doubling in production captures.
      const destinationWidth = innerRx * 2.06;
      const destinationHeight = innerRy * 2.10;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(innerCx, innerCy, innerRx, innerRy, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const atlasPose = getLexaraPreparedFacePose(frame.mouthPoseIndex);
      const cellIndex = Math.max(0, Math.min(14, atlasPose.visemeIndex));
      const sourceX = (cellIndex % 4) * cellWidth;
      const sourceY = Math.floor(cellIndex / 4) * cellHeight;
      ctx.globalAlpha = 1;
      ctx.drawImage(
        mouthAtlas,
        sourceX,
        sourceY,
        cellWidth,
        cellHeight,
        innerCx - destinationWidth / 2,
        innerCy - destinationHeight / 2,
        destinationWidth,
        destinationHeight,
      );
      ctx.restore();

      // Re-establish rigid, high-contrast oral structures after texture
      // resampling. Upper teeth stay tied to the upper-face anchor; the tongue
      // follows the aperture/jaw and remains behind the teeth.
      const showsTeeth = [2, 3, 4, 7, 8, 11, 12].includes(pose.visemeIndex) || open > 0.52;
      const showsTongue = [3, 4, 8, 10, 11].includes(pose.visemeIndex) && open > 0.20;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(innerCx, innerCy, innerRx, innerRy, 0, 0, Math.PI * 2);
      ctx.clip();
      if (showsTongue) {
        ctx.fillStyle = 'rgba(154, 66, 76, 0.94)';
        ctx.beginPath();
        ctx.ellipse(innerCx, innerCy + innerRy * 0.54, innerRx * 0.54, Math.max(0.34, innerRy * 0.30), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(104, 43, 53, 0.42)';
        ctx.lineWidth = Math.max(0.45, layout.width * 0.00075);
        ctx.beginPath();
        ctx.moveTo(innerCx, innerCy + innerRy * 0.38);
        ctx.lineTo(innerCx, innerCy + innerRy * 0.72);
        ctx.stroke();
      }
      if (showsTeeth) {
        const teethY = r.cy + Math.min(gap * 0.06, r.ry * 0.20);
        ctx.fillStyle = 'rgba(244, 236, 226, 0.98)';
        ctx.beginPath();
        ctx.ellipse(innerCx, teethY, innerRx * 0.72, Math.max(0.38, innerRy * 0.27), 0, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(112, 92, 86, 0.28)';
        ctx.lineWidth = Math.max(0.35, layout.width * 0.00055);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      const showsTeeth = [2, 3, 4, 7, 8, 11, 12].includes(pose.visemeIndex) || open > 0.52;
      const showsTongue = [3, 4, 8, 10, 11].includes(pose.visemeIndex) && open > 0.20;
      if (showsTeeth) {
        ctx.fillStyle = 'rgba(239, 228, 216, 0.92)';
        ctx.beginPath();
        ctx.ellipse(innerCx, innerCy - innerRy * 0.40, innerRx * 0.72, Math.max(0.28, innerRy * 0.25), 0, Math.PI, Math.PI * 2);
        ctx.fill();
      }
      if (showsTongue) {
        ctx.fillStyle = 'rgba(151, 68, 76, 0.82)';
        ctx.beginPath();
        ctx.ellipse(innerCx, innerCy + innerRy * 0.52, innerRx * 0.56, Math.max(0.25, innerRy * 0.28), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }


  ctx.restore();
}

function drawPreparedSpeechFace(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  mouthAtlas: HTMLImageElement | null,
  layout: ImageLayout,
  frame: LexaraEmbodimentFrame,
  reducedMotion: boolean,
  surface: FeatheredPatchSurface,
): void {
  if (frame.mode !== 'speaking') return;

  const pose = blendPreparedFacePose(frame);
  const motionScale = reducedMotion ? 0.32 : 1;
  const activity = Math.min(1, frame.mouthOpen * 0.72 + frame.gestureEnergy * 0.28);
  const jawAmount = Math.min(1, pose.jawDrop * 0.78 + activity * 0.32);

  // Original portrait pixels are deformed in four independently feathered
  // regions. No generated skin, jaw, cheek, brow, or forehead replaces Lexara.
  drawFeatheredImageTransform(
    ctx,
    image,
    layout,
    { cx: 0.520, cy: 0.354, rx: 0.073, ry: 0.069 },
    {
      dy: jawAmount * layout.height * 0.0068 * motionScale,
      scaleX: 1 + pose.mouthWide * 0.0035 * motionScale,
      scaleY: 1 + jawAmount * 0.016 * motionScale,
    },
    surface,
  );

  const cheekAmount = Math.min(1, pose.cheekLift + frame.mouthWide * 0.16 + activity * 0.12);
  const cheekDy = -cheekAmount * layout.height * 0.0036 * motionScale;
  const cheekDx = cheekAmount * layout.width * 0.0022 * motionScale;
  drawFeatheredImageTransform(
    ctx,
    image,
    layout,
    { cx: 0.474, cy: 0.302, rx: 0.036, ry: 0.046 },
    { dx: -cheekDx, dy: cheekDy, scaleX: 1 + cheekAmount * 0.008 * motionScale },
    surface,
  );
  drawFeatheredImageTransform(
    ctx,
    image,
    layout,
    { cx: 0.562, cy: 0.302, rx: 0.036, ry: 0.046 },
    { dx: cheekDx, dy: cheekDy, scaleX: 1 + cheekAmount * 0.008 * motionScale },
    surface,
  );

  const emphasis = Math.max(-1, Math.min(1, frame.browLift * 0.52 + pose.browLift + frame.gestureEnergy * 0.18));
  const browDy = -emphasis * layout.height * 0.0052 * motionScale;
  drawFeatheredImageTransform(
    ctx,
    image,
    layout,
    { cx: 0.481, cy: 0.226, rx: 0.033, ry: 0.014 },
    { dy: browDy },
    surface,
  );
  drawFeatheredImageTransform(
    ctx,
    image,
    layout,
    { cx: 0.551, cy: 0.226, rx: 0.033, ry: 0.014 },
    { dy: browDy },
    surface,
  );
  drawFeatheredImageTransform(
    ctx,
    image,
    layout,
    { cx: 0.518, cy: 0.196, rx: 0.078, ry: 0.047 },
    {
      dy: browDy * 0.28,
      scaleY: 1 + Math.abs(emphasis) * 0.006 * motionScale,
      alpha: 0.96,
    },
    surface,
  );

  // Do not pre-shift a second copy of the photographed lips. That transition
  // patch had its own transform and could visibly separate from the live mouth.
  // The canonical mouth renderer now owns the complete lip registration.
  drawMouth(ctx, image, mouthAtlas, layout, frame, 0, 0);
}

function renderEmbodiedFrame(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  mouthAtlas: HTMLImageElement | null,
  layout: ImageLayout,
  frame: LexaraEmbodimentFrame,
  reducedMotion: boolean,
  skinColor: string,
  patchSurface: FeatheredPatchSurface,
  preparedFaceEnabled: boolean,
  onPreparedFaceError: (error: unknown) => void,
): void {
  const width = layout.width;
  const height = layout.height;
  const motionScale = reducedMotion ? 0.26 : 1;

  const torsoDx = frame.torsoX * width * 0.0026 * motionScale;
  const torsoDy = frame.torsoY * height * 0.0042 * motionScale;
  const headDx = frame.headX * width * 0.0052 * motionScale;
  const headDy = frame.headY * height * 0.0042 * motionScale;
  const headRotation = frame.headRollDeg * 0.68 * motionScale;

  // A small, low-opacity blouse/neck patch supplies visible breathing and vocal
  // energy without touching the face, jaw, hands, desk, or background.
  if (PORTRAIT_BREATHING_ENABLED) {
    const speechLift = frame.mode === 'speaking' ? frame.gestureEnergy : 0;
    drawImageWithLocalTransform(
      ctx,
      image,
      layout,
      { cx: 0.516, cy: 0.535, rx: 0.072, ry: 0.105 },
      {
        dy: (frame.breath * 0.46 + speechLift * 0.38) * height * 0.0018 * motionScale,
        scaleX: 1 + frame.breath * 0.0007 * motionScale,
        scaleY: 1 + (frame.breath * 0.0018 + speechLift * 0.0012) * motionScale,
        alpha: reducedMotion ? 0.24 : 0.46,
        blurPx: 0.18,
      },
    );
  }

  // Keep all non-mouth motion disabled by default. These independent image patches
  // are the source of the intermittent face seams and blink artifact.
  if (LEGACY_PORTRAIT_NON_MOUTH_OVERLAYS_ENABLED) {
    // Breathing and shoulder/torso movement. These are deliberately visible at
    // conversational viewing sizes but remain bounded so desk/background geometry
    // does not visibly shear.
    drawImageWithLocalTransform(
      ctx,
      image,
      layout,
      { cx: 0.515, cy: 0.675, rx: 0.285, ry: 0.30 },
      {
        dx: torsoDx,
        dy: torsoDy,
        rotationDeg: frame.torsoX * 0.22 * motionScale,
        scaleX: reducedMotion ? 1 : frame.torsoScaleX,
        scaleY: reducedMotion ? 1 + (frame.torsoScaleY - 1) * 0.35 : frame.torsoScaleY,
        alpha: 0.985,
      },
    );

    // Hand/forearm regions move only when the behavior planner has speaking or
    // backchannel energy. This is not a canned gesture clip; it is continuous
    // motion coupled to the current behavioral state.
    if (!reducedMotion && frame.gestureEnergy > 0.08) {
      const handMotion = frame.gestureEnergy;
      drawImageWithLocalTransform(
        ctx,
        image,
        layout,
        { cx: 0.455, cy: 0.858, rx: 0.115, ry: 0.135 },
        {
          dx: Math.sin(frame.mouthOpen * 7.2 + frame.nod) * width * 0.0024 * handMotion,
          dy: -height * 0.0020 * handMotion,
          rotationDeg: -0.55 * handMotion,
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
          rotationDeg: 0.38 * handMotion,
          alpha: 0.98,
        },
      );
    }


  }

  // Keep the old head, eye, brow, and blink patches available only for a controlled
  // experiment. They are never part of the normal mouth-only renderer.
  if (LEGACY_PORTRAIT_NON_MOUTH_OVERLAYS_ENABLED) {
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


  }

  // This prepared visual layer reads the existing playback clock. It performs no
  // network request, buffering, speech recognition, or change to the voice path.
  if (PREPARED_PORTRAIT_FACE_ENABLED && preparedFaceEnabled) {
    try {
      drawPreparedSpeechFace(ctx, image, mouthAtlas, layout, frame, reducedMotion, patchSurface);
    } catch (error) {
      onPreparedFaceError(error);
    }
  } else if (LEGACY_PORTRAIT_MOUTH_OVERLAY_ENABLED) {
    drawMouth(ctx, image, null, layout, frame, 0, 0);
  }
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
    let preparedFaceFailed = false;
    let preparedFaceFailureReported = false;
    let lastMotionTurnKey = '';
    let skinColor = 'rgb(177, 132, 108)';
    const engine = new LexaraEmbodimentEngine(0x4c455841);
    const image = new Image();
    image.decoding = 'async';
    image.src = imageSrc;
    const mouthAtlas = new Image();
    mouthAtlas.decoding = 'async';
    mouthAtlas.src = LEXARA_MOUTH_ATLAS_SRC;
    const patchCanvas = document.createElement('canvas');
    const patchContext = patchCanvas.getContext('2d', { alpha: true });
    if (!patchContext) return undefined;
    const patchSurface: FeatheredPatchSurface = { canvas: patchCanvas, ctx: patchContext };

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
      const frameIntervalMs = 1000 / TARGET_FPS;
      if (nowMs - lastPaintMs + 0.5 < frameIntervalMs) return;
      lastPaintMs = nowMs - ((nowMs - lastPaintMs) % frameIntervalMs);

      if (rendererFailed) return;

      const input = latestInputRef.current;
      const requestedMode = getMode(input);
      const realtimeClock = lexaraRealtimeVoiceClient.getPlaybackClock();
      const serverClock = getLexaraServerPlaybackClock();
      const audioActive = realtimeClock.active || serverClock.active;
      const audioTime = realtimeClock.active
        ? realtimeClock.currentTimeSec
        : serverClock.active
          ? serverClock.currentTimeSec
          : 0;
      const audioTurnId = realtimeClock.active ? realtimeClock.turnId : serverClock.turnId;
      // Visible speech must follow rendered audio, not merely the React speaking flag.
      // This prevents the resting portrait from being hidden before audio starts or
      // after playback ends, while keeping animation completely off the audio path.
      const mode: LexaraEmbodimentMode =
        audioActive ? 'speaking' : requestedMode === 'speaking' ? 'idle' : requestedMode;

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
          turnId: audioTurnId,
        },
      });

      if (CLIP_MOTION_ENABLED && mode === 'speaking' && audioActive) {
        // Reference clips provide natural motion geometry only. The live playback
        // clock and PCM features remain authoritative; references constrain a
        // continuous rig and never become a frame-by-frame canned animation.
        const motion = sampleLexaraClipMotion(
          audioTime, audioTurnId, frame.mouthOpen, frame.mouthWide,
        );
        frame.mouthOpen = Math.min(1, frame.mouthOpen * (0.92 + motion.jaw * 0.12));
        frame.mouthWide = Math.min(1, Math.max(0, frame.mouthWide * 0.88 + motion.width * 0.12));
        frame.browLift = Math.max(-1, Math.min(1, frame.browLift - motion.headY * 0.08));
        frame.gestureEnergy = Math.min(1, frame.gestureEnergy + Math.abs(motion.headX) * 0.04);
      }

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
        renderEmbodiedFrame(
          ctx,
          image,
          mouthAtlas,
          layout,
          frame,
          reducedMotion,
          skinColor,
          patchSurface,
          !preparedFaceFailed,
          error => {
            preparedFaceFailed = true;
            if (!preparedFaceFailureReported) {
              preparedFaceFailureReported = true;
              reportAvatarEvent('avatar-renderer-error', {
                reducedMotion,
                mode,
                layer: 'prepared-face',
                fallback: 'portrait-plus-throat',
                error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
              });
            }
          },
        );

        if (!rendererReported) {
          rendererReported = true;
          reportAvatarEvent('avatar-renderer-ready', {
            reducedMotion,
            mode,
            preparedPoseCount: 120,
            mouthAtlasReady: mouthAtlas.complete && mouthAtlas.naturalWidth > 0,
          });
        }

        if (mode === 'speaking' && frame.mouthOpen > 0.08) {
          const turnKey = audioTurnId || `server-${Math.floor(audioTime * 2)}`;
          if (turnKey && turnKey !== lastMotionTurnKey) {
            lastMotionTurnKey = turnKey;
            reportAvatarEvent('avatar-motion-started', {
              reducedMotion,
              mode,
              turnId: audioTurnId,
              mouthOpen: Number(frame.mouthOpen.toFixed(3)),
              mouthPoseIndex: frame.mouthPoseIndex,
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
      data-live-avatar={LIVE_AVATAR_ENABLED ? 'embodied-canvas' : 'static'}
      data-prepared-face={PREPARED_PORTRAIT_FACE_ENABLED ? 'continuous-120-reference-rig' : 'legacy'}
      data-clip-motion={CLIP_MOTION_ENABLED ? 'reference-guided-continuous' : 'off'}
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

export const LEXARAEtherealAvatar = LEXARAAttorneyPortrait;

export default LEXARAAttorneyPortrait;
