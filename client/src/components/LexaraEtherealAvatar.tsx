import { memo } from 'react';
import { cn } from '@/lib/utils';

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

const SIZE_CONFIG = {
  sm: 'w-32 h-40',
  md: 'w-48 h-64',
  lg: 'w-64 h-80',
  xl: 'w-80 h-96',
  full: 'w-full h-full min-h-[400px]',
};

/**
 * Compatibility name retained because the live conversation already imports it,
 * but the visual is intentionally the established professional attorney image.
 */
export const LEXARAEtherealAvatar = memo(function LEXARAEtherealAvatar({
  isSpeaking = false,
  isListening = false,
  isThinking = false,
  className,
  size = 'full',
}: LEXARAEtherealAvatarProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl',
        SIZE_CONFIG[size],
        className,
      )}
      aria-label="LEXARA professional legal assistant"
    >
      <img
        src="/images/oip.webp"
        alt="LEXARA professional attorney"
        className="h-full w-full object-cover object-center"
        draggable={false}
      />

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

export default LEXARAEtherealAvatar;
