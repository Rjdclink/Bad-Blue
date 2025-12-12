/**
 * LEXARA Avatar Component
 * 
 * Ethereal, spectral 18-year-old feminine figure with:
 * - Luminous, electric-blue irises and gold-ring pupils
 * - Non-cartoon, non-uncanny appearance
 * - Procedural animation: floating hair, micro-movements, spectral glow
 * - Emotion states: curious, focused, alert, empathetic
 */

import React, { memo, useState, useEffect, useRef, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { LexaraEmotionState } from './LexaraState';

// ============================================================================
// TYPES
// ============================================================================

export interface LexaraAvatarProps {
  className?: string;
  isSpeaking?: boolean;
  isListening?: boolean;
  isThinking?: boolean;
  audioLevel?: number;  // 0-1 for lip sync
  emotion?: LexaraEmotionState;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

// ============================================================================
// SIZE CONFIGURATIONS
// ============================================================================

const SIZE_CONFIG = {
  sm: { container: 'w-32 h-40', avatar: 'w-28 h-36' },
  md: { container: 'w-48 h-64', avatar: 'w-44 h-60' },
  lg: { container: 'w-64 h-80', avatar: 'w-60 h-76' },
  xl: { container: 'w-80 h-96', avatar: 'w-76 h-92' },
  full: { container: 'w-full h-full min-h-[400px]', avatar: 'w-full h-full' },
};

// ============================================================================
// EMOTION COLOR CONFIGURATIONS
// ============================================================================

const EMOTION_COLORS: Record<LexaraEmotionState, {
  iris: string;
  glow: string;
  aura: string;
  accent: string;
}> = {
  curious: {
    iris: '#60a5fa',      // Electric blue
    glow: 'rgba(96, 165, 250, 0.4)',
    aura: 'rgba(96, 165, 250, 0.15)',
    accent: '#d4af37',    // Gold
  },
  focused: {
    iris: '#6366f1',      // Indigo blue
    glow: 'rgba(99, 102, 241, 0.4)',
    aura: 'rgba(99, 102, 241, 0.15)',
    accent: '#d4af37',
  },
  alert: {
    iris: '#38bdf8',      // Sky blue
    glow: 'rgba(56, 189, 248, 0.5)',
    aura: 'rgba(56, 189, 248, 0.2)',
    accent: '#f59e0b',    // Amber
  },
  empathetic: {
    iris: '#a78bfa',      // Purple-blue
    glow: 'rgba(167, 139, 250, 0.4)',
    aura: 'rgba(167, 139, 250, 0.15)',
    accent: '#f472b6',    // Pink
  },
};

// ============================================================================
// LEXARA AVATAR COMPONENT
// ============================================================================

export const LexaraAvatar = memo(function LexaraAvatar({
  className,
  isSpeaking = false,
  isListening = false,
  isThinking = false,
  audioLevel = 0,
  emotion = 'curious',
  size = 'full',
}: LexaraAvatarProps) {
  // Animation state
  const [breathePhase, setBreathePhase] = useState(0);
  const [hairDrift, setHairDrift] = useState(0);
  const [lipOpenAmount, setLipOpenAmount] = useState(0);
  const [blinkState, setBlinkState] = useState(false);
  const [microMovementX, setMicroMovementX] = useState(0);
  const [microMovementY, setMicroMovementY] = useState(0);

  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);

  // Get emotion colors
  const colors = useMemo(() => EMOTION_COLORS[emotion], [emotion]);
  const sizes = SIZE_CONFIG[size];

  // ============================================================================
  // PROCEDURAL ANIMATION LOOP
  // ============================================================================

  useEffect(() => {
    let frameCount = 0;

    const animate = (timestamp: number) => {
      // Throttle to ~20 FPS for performance
      if (timestamp - lastTimeRef.current > 50) {
        lastTimeRef.current = timestamp;
        frameCount++;

        // Breathing cycle (slow, subtle)
        setBreathePhase(prev => (prev + 0.015) % (Math.PI * 2));

        // Hair drift (very slow, ethereal)
        setHairDrift(prev => (prev + 0.008) % (Math.PI * 2));

        // Micro-movements (very subtle)
        setMicroMovementX(Math.sin(frameCount * 0.02) * 0.5);
        setMicroMovementY(Math.cos(frameCount * 0.015) * 0.3);

        // Random blinking
        if (frameCount % 120 === 0 && Math.random() > 0.7) {
          setBlinkState(true);
          setTimeout(() => setBlinkState(false), 120);
        }
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Lip sync based on audio level
  useEffect(() => {
    if (isSpeaking && audioLevel > 0) {
      setLipOpenAmount(Math.min(audioLevel * 1.5, 1));
    } else {
      setLipOpenAmount(prev => prev * 0.8); // Smooth close
    }
  }, [isSpeaking, audioLevel]);

  // ============================================================================
  // CALCULATED ANIMATION VALUES
  // ============================================================================

  const breatheScale = 1 + Math.sin(breathePhase) * 0.006;
  const hairOffset = Math.sin(hairDrift) * 2.5;
  const shoulderMovement = Math.sin(breathePhase * 0.5) * 1;

  // Eye gaze based on state
  const getEyeOffset = useMemo(() => {
    if (isThinking) return { x: 2, y: -1.5 };
    if (isListening) return { x: 0, y: 0 };
    return { x: microMovementX * 0.5, y: microMovementY * 0.3 };
  }, [isThinking, isListening, microMovementX, microMovementY]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden',
        'bg-gradient-to-br from-slate-950 via-indigo-950/80 to-slate-900',
        sizes.container,
        className
      )}
    >
      {/* Animated particle field - ethereal background */}
      <div className="absolute inset-0 opacity-35">
        {[...Array(25)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: `${1 + Math.random() * 2}px`,
              height: `${1 + Math.random() * 2}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              background: i % 3 === 0
                ? colors.accent
                : i % 3 === 1
                ? colors.iris
                : 'rgba(139, 92, 246, 0.6)',
              animation: `lexara-float-particle ${8 + Math.random() * 6}s ease-in-out infinite ${Math.random() * 4}s`,
            }}
          />
        ))}
      </div>

      {/* Radial depth gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at center 30%, transparent 0%, transparent 40%, rgba(2,6,23,0.5) 100%)',
        }}
      />

      {/* Spectral aura behind avatar */}
      <div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 w-3/4 h-1/2 rounded-full blur-3xl"
        style={{
          background: `radial-gradient(ellipse, ${colors.aura} 0%, transparent 70%)`,
          opacity: isSpeaking ? 0.5 : 0.3,
          animation: 'lexara-shimmer-pulse 4s ease-in-out infinite',
        }}
      />

      {/* Main avatar container with breathing */}
      <div
        className="relative z-10 w-full h-full flex items-center justify-center"
        style={{
          transform: `scale(${breatheScale}) translate(${microMovementX}px, ${microMovementY}px)`,
          transition: 'transform 0.1s ease-out',
        }}
      >
        {/* Outer aura ring */}
        <div
          className={cn(
            'absolute rounded-full border',
            isSpeaking && 'animate-pulse'
          )}
          style={{
            width: '80%',
            height: '80%',
            borderColor: `${colors.iris}30`,
            boxShadow: `0 0 50px ${colors.glow}, 0 0 100px ${colors.aura}`,
          }}
        />

        {/* SVG Avatar - Ethereal young woman */}
        <svg
          viewBox="0 0 200 280"
          className="w-full h-full max-w-[280px] max-h-[380px]"
          style={{ filter: 'blur(0.15px)' }}
        >
          <defs>
            {/* Hair gradient - dark, flowing */}
            <linearGradient id="lexaraHairGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(30,41,59,0.95)" />
              <stop offset="40%" stopColor="rgba(51,65,85,0.9)" />
              <stop offset="70%" stopColor="rgba(71,85,105,0.85)" />
              <stop offset="100%" stopColor="rgba(30,41,59,0.95)" />
            </linearGradient>

            {/* Skin gradient - ethereal, luminous */}
            <linearGradient id="lexaraSkinGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(241,245,249,0.88)" />
              <stop offset="50%" stopColor="rgba(226,232,240,0.82)" />
              <stop offset="100%" stopColor="rgba(203,213,225,0.75)" />
            </linearGradient>

            {/* Clothing gradient - soft, elegant */}
            <linearGradient id="lexaraClothGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(148,163,184,0.55)" />
              <stop offset="100%" stopColor="rgba(100,116,139,0.45)" />
            </linearGradient>

            {/* Glow filter for spectral effect */}
            <filter id="lexaraGlow">
              <feGaussianBlur stdDeviation="1.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Soft shadow */}
            <filter id="lexaraShadow">
              <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodOpacity="0.15" />
            </filter>
          </defs>

          {/* Long flowing hair - back layer */}
          <path
            d={`M50 ${55 + hairOffset * 0.3} 
                Q35 90, ${45 + hairOffset * 0.5} 160 
                Q50 200, ${40 + hairOffset * 0.4} 240
                L35 250 
                Q45 210, 45 140 
                Q40 80, 50 ${55 + hairOffset * 0.3}Z`}
            fill="url(#lexaraHairGrad)"
            opacity="0.88"
          />
          <path
            d={`M150 ${55 - hairOffset * 0.3} 
                Q165 90, ${155 - hairOffset * 0.5} 160 
                Q150 200, ${160 - hairOffset * 0.4} 240
                L165 250 
                Q155 210, 155 140 
                Q160 80, 150 ${55 - hairOffset * 0.3}Z`}
            fill="url(#lexaraHairGrad)"
            opacity="0.88"
          />

          {/* Hair top volume */}
          <ellipse
            cx="100"
            cy="58"
            rx="48"
            ry="28"
            fill="url(#lexaraHairGrad)"
            opacity="0.95"
          />

          {/* Neck */}
          <path
            d={`M85 145 
                Q100 ${155 + shoulderMovement * 0.5}, 115 145 
                L118 170 
                Q100 180, 82 170 Z`}
            fill="url(#lexaraSkinGrad)"
            opacity="0.88"
            filter="url(#lexaraShadow)"
          />

          {/* Shoulders and upper body */}
          <path
            d={`M55 ${175 + shoulderMovement} 
                Q82 165, 100 170 
                Q118 165, 145 ${175 + shoulderMovement}
                L150 250 
                Q100 260, 50 250 Z`}
            fill="url(#lexaraClothGrad)"
            stroke="rgba(148,163,184,0.25)"
            strokeWidth="1"
          />

          {/* Face - ethereal oval */}
          <ellipse
            cx="100"
            cy="100"
            rx="37"
            ry="46"
            fill="url(#lexaraSkinGrad)"
            filter="url(#lexaraGlow)"
            opacity="0.92"
          />

          {/* Front hair strands */}
          <path
            d={`M62 ${60 + hairOffset * 0.2} 
                Q55 80, 60 105 
                Q65 85, 62 ${60 + hairOffset * 0.2}Z`}
            fill="url(#lexaraHairGrad)"
            opacity="0.92"
          />
          <path
            d={`M138 ${60 - hairOffset * 0.2} 
                Q145 80, 140 105 
                Q135 85, 138 ${60 - hairOffset * 0.2}Z`}
            fill="url(#lexaraHairGrad)"
            opacity="0.92"
          />

          {/* Eyes - Electric blue with gold rings */}
          <g filter="url(#lexaraGlow)">
            {/* Left eye */}
            <ellipse
              cx={82 + getEyeOffset.x * 0.5}
              cy={92 + getEyeOffset.y * 0.5}
              rx={8}
              ry={blinkState ? 0.5 : 5.5}
              fill="rgba(255,255,255,0.95)"
              style={{ transition: 'ry 0.08s ease-out' }}
            />
            {!blinkState && (
              <>
                {/* Gold ring pupil */}
                <circle
                  cx={82 + getEyeOffset.x}
                  cy={92 + getEyeOffset.y}
                  r="4.5"
                  fill={colors.accent}
                  opacity="0.9"
                />
                {/* Electric blue iris */}
                <circle
                  cx={82 + getEyeOffset.x}
                  cy={92 + getEyeOffset.y}
                  r="3"
                  fill={colors.iris}
                  className={isListening ? 'animate-pulse' : ''}
                />
                {/* Highlight */}
                <circle cx={80} cy={90} r="0.8" fill="rgba(255,255,255,0.95)" />
              </>
            )}

            {/* Right eye */}
            <ellipse
              cx={118 + getEyeOffset.x * 0.5}
              cy={92 + getEyeOffset.y * 0.5}
              rx={8}
              ry={blinkState ? 0.5 : 5.5}
              fill="rgba(255,255,255,0.95)"
              style={{ transition: 'ry 0.08s ease-out' }}
            />
            {!blinkState && (
              <>
                {/* Gold ring pupil */}
                <circle
                  cx={118 + getEyeOffset.x}
                  cy={92 + getEyeOffset.y}
                  r="4.5"
                  fill={colors.accent}
                  opacity="0.9"
                />
                {/* Electric blue iris */}
                <circle
                  cx={118 + getEyeOffset.x}
                  cy={92 + getEyeOffset.y}
                  r="3"
                  fill={colors.iris}
                  className={isListening ? 'animate-pulse' : ''}
                />
                {/* Highlight */}
                <circle cx={116} cy={90} r="0.8" fill="rgba(255,255,255,0.95)" />
              </>
            )}
          </g>

          {/* Eyebrows - subtle, expressive */}
          <path
            d={`M72 ${82 - (isListening ? 1.5 : 0)} Q84 ${79 - (isListening ? 2 : 0)}, 92 82`}
            stroke="rgba(71,85,105,0.45)"
            strokeWidth="1.3"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d={`M108 82 Q116 ${79 - (isListening ? 2 : 0)}, 128 ${82 - (isListening ? 1.5 : 0)}`}
            stroke="rgba(71,85,105,0.45)"
            strokeWidth="1.3"
            fill="none"
            strokeLinecap="round"
          />

          {/* Nose - delicate */}
          <path
            d="M100 95 L100 109 Q96 113, 100 116"
            stroke="rgba(148,163,184,0.3)"
            strokeWidth="1"
            fill="none"
          />

          {/* Lips - animated for speech */}
          <g>
            {/* Upper lip */}
            <path
              d={`M88 ${126 - lipOpenAmount * 1.5} 
                  Q100 ${123 - lipOpenAmount * 2}, 112 ${126 - lipOpenAmount * 1.5}`}
              stroke="rgba(244,114,182,0.55)"
              strokeWidth="1.8"
              fill="none"
              strokeLinecap="round"
            />
            {/* Lower lip */}
            <path
              d={`M90 ${128 + lipOpenAmount * 3} 
                  Q100 ${132 + lipOpenAmount * 4}, 110 ${128 + lipOpenAmount * 3}`}
              stroke="rgba(244,114,182,0.45)"
              strokeWidth="1.4"
              fill="none"
              strokeLinecap="round"
            />
            {/* Mouth opening when speaking */}
            {isSpeaking && lipOpenAmount > 0.1 && (
              <ellipse
                cx="100"
                cy={128 + lipOpenAmount * 1.5}
                rx={4 + lipOpenAmount * 2.5}
                ry={lipOpenAmount * 2.5}
                fill="rgba(30,20,20,0.55)"
              />
            )}
          </g>
        </svg>

        {/* Spectral shimmer overlay */}
        <div
          className="absolute inset-0 pointer-events-none opacity-15"
          style={{
            background: `linear-gradient(135deg, transparent 0%, ${colors.iris}40 50%, transparent 100%)`,
            animation: 'lexara-shimmer 5s ease-in-out infinite',
          }}
        />

        {/* Speaking pulse effect */}
        {isSpeaking && (
          <div
            className="absolute inset-0 pointer-events-none rounded-full"
            style={{
              boxShadow: `0 0 35px ${colors.glow}, 0 0 70px ${colors.aura}`,
              animation: 'lexara-pulse-glow 0.35s ease-in-out infinite',
            }}
          />
        )}

        {/* Thinking glow effect */}
        {isThinking && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              boxShadow: `0 0 45px ${colors.accent}50, 0 0 90px ${colors.accent}25`,
              animation: 'lexara-pulse-glow 1.2s ease-in-out infinite',
            }}
          />
        )}
      </div>

      {/* Status badge - minimal, elegant */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
        <div
          className={cn(
            'px-4 py-1.5 rounded-full text-xs font-medium tracking-wider backdrop-blur-md border',
            isSpeaking ? 'bg-blue-500/15 border-blue-400/35 text-blue-300' :
            isListening ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300' :
            isThinking ? 'bg-amber-500/15 border-amber-400/35 text-amber-300' :
            'bg-slate-800/50 border-slate-600/35 text-slate-400'
          )}
        >
          {isSpeaking ? '● Speaking' :
           isListening ? '● Listening' :
           isThinking ? '● Thinking' :
           '○ Ready'}
        </div>
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes lexara-float-particle {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.25; }
          50% { transform: translateY(-18px) translateX(5px); opacity: 0.65; }
        }
        @keyframes lexara-shimmer {
          0%, 100% { opacity: 0.12; transform: translateX(-5%); }
          50% { opacity: 0.25; transform: translateX(5%); }
        }
        @keyframes lexara-shimmer-pulse {
          0%, 100% { opacity: 0.25; transform: translateX(-50%) scale(1); }
          50% { opacity: 0.4; transform: translateX(-50%) scale(1.04); }
        }
        @keyframes lexara-pulse-glow {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
});

export default LexaraAvatar;
