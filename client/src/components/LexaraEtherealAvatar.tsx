import { memo, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { getLexaraServerPlaybackClock } from '@/lib/lexaraSpeechClient';
import { lexaraRealtimeVoiceClient } from '@/lib/lexaraRealtimeVoiceClient';

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
  '/images/oip.webp?v=20260918-lexara3',
  '/images/OIP.webp?v=20260918-lexara3',
  '/images/OIP.comp12.webp?v=20260918-lexara3',
  '/images/OIP.comp14.webp?v=20260918-lexara3',
] as const;

const SIZE_CONFIG = {
  sm: 'w-32 h-40',
  md: 'w-48 h-64',
  lg: 'w-64 h-80',
  xl: 'w-80 h-96',
  full: 'w-full h-full min-h-[400px]',
};

const LIVE_AVATAR_ENABLED = String(import.meta.env.VITE_LEXARA_LIVE_AVATAR_ENABLED ?? '1') !== '0';

const HEAD_MASK = 'radial-gradient(ellipse 29% 31% at 50% 29%, #000 45%, rgba(0,0,0,.92) 60%, transparent 79%)';
const MOUTH_MASK = 'radial-gradient(ellipse 12% 7% at 50% 39%, #000 48%, rgba(0,0,0,.88) 62%, transparent 80%)';
const TORSO_MASK = 'radial-gradient(ellipse 49% 48% at 50% 63%, #000 38%, rgba(0,0,0,.9) 67%, transparent 91%)';

function setTransform(node: HTMLElement | null, value: string): void {
  if (node) node.style.transform = value;
}

function resetMotion(
  body: HTMLElement | null,
  head: HTMLElement | null,
  mouth: HTMLElement | null,
): void {
  setTransform(body, 'translate3d(0,0,0) scale3d(1,1,1)');
  setTransform(head, 'translate3d(0,0,0) rotate(0deg) scale3d(1,1,1)');
  setTransform(mouth, 'translate3d(0,0,0) scale3d(1,1,1)');
}

/**
 * Canonical LEXARA visual: the established professional attorney at her desk.
 *
 * The live-motion layer is intentionally a read-only subscriber to the speech
 * clocks. It never awaits, starts, pauses, buffers, or mutates TTS. If motion
 * misses a frame, speech/text continue untouched and the next RAF samples the
 * current audio position instead of replaying stale visual work.
 */
export const LEXARAAttorneyPortrait = memo(function LEXARAAttorneyPortrait({
  isSpeaking = false,
  isListening = false,
  isThinking = false,
  audioLevel = 0,
  emotionHint = 'calm',
  gazeHint = 'camera',
  className,
  size = 'full',
}: LEXARAEtherealAvatarProps) {
  const [imageIndex, setImageIndex] = useState(0);
  const [motionAllowed, setMotionAllowed] = useState(true);
  const bodyLayerRef = useRef<HTMLImageElement>(null);
  const headLayerRef = useRef<HTMLImageElement>(null);
  const mouthLayerRef = useRef<HTMLImageElement>(null);
  const imageSrc = LEXARA_ATTORNEY_IMAGE_SOURCES[Math.min(imageIndex, LEXARA_ATTORNEY_IMAGE_SOURCES.length - 1)];
  const liveMotionEnabled = LIVE_AVATAR_ENABLED && motionAllowed;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setMotionAllowed(!query.matches);
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);

  useEffect(() => {
    const body = bodyLayerRef.current;
    const head = headLayerRef.current;
    const mouth = mouthLayerRef.current;
    if (!liveMotionEnabled || !body || !head || !mouth) {
      resetMotion(body, head, mouth);
      return undefined;
    }

    let frame = 0;
    let smoothedLevel = 0;

    const animate = (nowMs: number) => {
      const realtimeClock = lexaraRealtimeVoiceClient.getPlaybackClock();
      const serverClock = getLexaraServerPlaybackClock();
      const audioClockActive = realtimeClock.active || serverClock.active;
      const audioTime = realtimeClock.active
        ? realtimeClock.currentTimeSec
        : serverClock.active
          ? serverClock.currentTimeSec
          : nowMs / 1000;

      // Natural idle motion remains independent of speech generation.
      const breath = Math.sin((nowMs / 1000) * ((Math.PI * 2) / 4.6));
      const micro = Math.sin((nowMs / 1000) * 0.83 + 0.7);
      const listeningBias = isListening ? Math.sin((nowMs / 1000) * 0.61) * 0.16 : 0;
      const thinkingBias = isThinking ? Math.sin((nowMs / 1000) * 0.47 + 1.1) * 0.20 : 0;
      const gazeBias = gazeHint === 'side'
        ? -0.20
        : gazeHint === 'down'
          ? 0.10
          : gazeHint === 'up'
            ? -0.10
            : gazeHint === 'thinking'
              ? 0.14
              : 0;
      const emotionScale = emotionHint === 'playful'
        ? 1.18
        : emotionHint === 'serious' || emotionHint === 'authoritative'
          ? 0.82
          : 1;

      // Realtime PCM supplies true rendered energy. HTTP TTS intentionally
      // avoids inserting an AnalyserNode into playback; its fallback cadence
      // is sampled from the already-playing media clock so it can never delay audio.
      const fallbackSpeechLevel = audioClockActive
        ? Math.max(
            0,
            Math.min(
              1,
              0.42
                + 0.28 * Math.sin(audioTime * 25.4)
                + 0.17 * Math.sin(audioTime * 41.8 + 1.2)
                + 0.10 * Math.sin(audioTime * 63.2 + 2.1),
            ),
          )
        : 0;
      const measuredLevel = realtimeClock.active
        ? realtimeClock.level
        : Math.max(fallbackSpeechLevel, Math.min(1, audioLevel) * 0.35);
      const targetLevel = audioClockActive ? measuredLevel : 0;
      smoothedLevel += (targetLevel - smoothedLevel) * (targetLevel > smoothedLevel ? 0.48 : 0.26);

      const speechNod = audioClockActive ? Math.sin(audioTime * 5.2) * smoothedLevel * 0.14 : 0;
      const bodyY = breath * 0.34;
      const bodyScaleY = 1 + breath * 0.0016 + smoothedLevel * 0.0007;
      const bodyScaleX = 1 + breath * 0.0007;
      const headX = (micro * 0.22 + listeningBias) * emotionScale;
      const headY = breath * -0.14 + speechNod + thinkingBias;
      const headRotate = (micro * 0.055 + gazeBias + speechNod * 0.18) * emotionScale;
      const mouthOpen = audioClockActive ? smoothedLevel : 0;
      const mouthY = mouthOpen * 0.24;
      const mouthScaleY = 1 + mouthOpen * 0.036;
      const mouthScaleX = 1 - mouthOpen * 0.006;

      setTransform(
        body,
        `translate3d(0,${bodyY.toFixed(3)}px,0) scale3d(${bodyScaleX.toFixed(5)},${bodyScaleY.toFixed(5)},1)`,
      );
      setTransform(
        head,
        `translate3d(${headX.toFixed(3)}px,${headY.toFixed(3)}px,0) rotate(${headRotate.toFixed(4)}deg) scale3d(1.0004,1.0004,1)`,
      );
      setTransform(
        mouth,
        `translate3d(0,${mouthY.toFixed(3)}px,0) scale3d(${mouthScaleX.toFixed(5)},${mouthScaleY.toFixed(5)},1)`,
      );

      frame = window.requestAnimationFrame(animate);
    };

    frame = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(frame);
      resetMotion(body, head, mouth);
    };
  }, [
    audioLevel,
    emotionHint,
    gazeHint,
    isListening,
    isSpeaking,
    isThinking,
    liveMotionEnabled,
  ]);

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl',
        SIZE_CONFIG[size],
        className,
      )}
      style={{ contain: 'layout paint' }}
      aria-label="LEXARA professional legal assistant"
      data-live-avatar={liveMotionEnabled ? 'enabled' : 'static'}
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

      {liveMotionEnabled && (
        <>
          <img
            ref={bodyLayerRef}
            src={imageSrc}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain object-center"
            draggable={false}
            decoding="async"
            style={{
              maskImage: TORSO_MASK,
              WebkitMaskImage: TORSO_MASK,
              transformOrigin: '50% 66%',
              willChange: isSpeaking || isListening || isThinking ? 'transform' : 'auto',
            }}
          />
          <img
            ref={headLayerRef}
            src={imageSrc}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain object-center"
            draggable={false}
            decoding="async"
            style={{
              maskImage: HEAD_MASK,
              WebkitMaskImage: HEAD_MASK,
              transformOrigin: '50% 39%',
              willChange: isSpeaking || isListening || isThinking ? 'transform' : 'auto',
            }}
          />
          <img
            ref={mouthLayerRef}
            src={imageSrc}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain object-center"
            draggable={false}
            decoding="async"
            style={{
              maskImage: MOUTH_MASK,
              WebkitMaskImage: MOUTH_MASK,
              transformOrigin: '50% 39%',
              willChange: isSpeaking ? 'transform' : 'auto',
            }}
          />
        </>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-slate-950/85 via-slate-950/30 to-transparent" />

      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-slate-950/75 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
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

// Backward-compatible alias for dormant legacy imports. The canonical live
// consultation path uses LEXARAAttorneyPortrait and never renders an ethereal SVG.
export const LEXARAEtherealAvatar = LEXARAAttorneyPortrait;

export default LEXARAAttorneyPortrait;
