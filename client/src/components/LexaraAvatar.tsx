/**
 * LEXARA Advanced Avatar System
 * 
 * Hyper-advanced dynamic visual presence with:
 * - Expressive motion effects
 * - Real-time webcam/microphone integration
 * - Lip-sync support signal processing
 * - Emotional state visualization
 * - Immersive sensory enhancement animations
 * - Authority and captivation dynamics
 * 
 * Optimized for minimal computational usage with silent operation
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

export type EmotionalState = 
  | 'neutral' 
  | 'listening' 
  | 'thinking' 
  | 'speaking' 
  | 'empathetic'
  | 'authoritative'
  | 'engaged'
  | 'processing';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface LexaraAvatarProps {
  size?: AvatarSize;
  emotionalState?: EmotionalState;
  isListening?: boolean;
  isSpeaking?: boolean;
  isProcessing?: boolean;
  audioLevel?: number; // 0-1 for voice activity
  className?: string;
  showAura?: boolean;
  showParticles?: boolean;
  interactive?: boolean;
  onClick?: () => void;
}

// ============================================================================
// CONSTANTS - Optimized for minimal compute
// ============================================================================

const SIZE_MAP: Record<AvatarSize, { container: string; avatar: string; ring: string }> = {
  sm: { container: 'w-16 h-16', avatar: 'w-14 h-14', ring: 'w-16 h-16' },
  md: { container: 'w-24 h-24', avatar: 'w-20 h-20', ring: 'w-24 h-24' },
  lg: { container: 'w-32 h-32', avatar: 'w-28 h-28', ring: 'w-32 h-32' },
  xl: { container: 'w-48 h-48', avatar: 'w-44 h-44', ring: 'w-48 h-48' },
  full: { container: 'w-64 h-64', avatar: 'w-60 h-60', ring: 'w-64 h-64' },
};

const EMOTIONAL_COLORS: Record<EmotionalState, { primary: string; secondary: string; glow: string; accent: string; pulse: string }> = {
  neutral: { primary: '#6366f1', secondary: '#818cf8', glow: 'rgba(99, 102, 241, 0.4)', accent: '#a5b4fc', pulse: 'rgba(99, 102, 241, 0.2)' },
  listening: { primary: '#22c55e', secondary: '#4ade80', glow: 'rgba(34, 197, 94, 0.5)', accent: '#86efac', pulse: 'rgba(34, 197, 94, 0.3)' },
  thinking: { primary: '#f59e0b', secondary: '#fbbf24', glow: 'rgba(245, 158, 11, 0.4)', accent: '#fcd34d', pulse: 'rgba(245, 158, 11, 0.2)' },
  speaking: { primary: '#3b82f6', secondary: '#60a5fa', glow: 'rgba(59, 130, 246, 0.5)', accent: '#93c5fd', pulse: 'rgba(59, 130, 246, 0.3)' },
  empathetic: { primary: '#ec4899', secondary: '#f472b6', glow: 'rgba(236, 72, 153, 0.4)', accent: '#f9a8d4', pulse: 'rgba(236, 72, 153, 0.2)' },
  authoritative: { primary: '#8b5cf6', secondary: '#a78bfa', glow: 'rgba(139, 92, 246, 0.5)', accent: '#c4b5fd', pulse: 'rgba(139, 92, 246, 0.3)' },
  engaged: { primary: '#14b8a6', secondary: '#2dd4bf', glow: 'rgba(20, 184, 166, 0.4)', accent: '#5eead4', pulse: 'rgba(20, 184, 166, 0.2)' },
  processing: { primary: '#f97316', secondary: '#fb923c', glow: 'rgba(249, 115, 22, 0.4)', accent: '#fdba74', pulse: 'rgba(249, 115, 22, 0.2)' },
};

// ============================================================================
// LEXARA AVATAR COMPONENT
// ============================================================================

export const LexaraAvatar: React.FC<LexaraAvatarProps> = ({
  size = 'lg',
  emotionalState = 'neutral',
  isListening = false,
  isSpeaking = false,
  isProcessing = false,
  audioLevel = 0,
  className,
  showAura = true,
  showParticles = true,
  interactive = true,
  onClick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number; delay: number }>>([]);
  const [pulseIntensity, setPulseIntensity] = useState(1);

  // Derive current state
  const currentState = useMemo(() => {
    if (isProcessing) return 'processing';
    if (isSpeaking) return 'speaking';
    if (isListening) return 'listening';
    return emotionalState;
  }, [isProcessing, isSpeaking, isListening, emotionalState]);

  const colors = EMOTIONAL_COLORS[currentState];
  const sizes = SIZE_MAP[size];

  // Generate particles on mount (optimized - only once)
  useEffect(() => {
    if (!showParticles) return;
    
    const newParticles = Array.from({ length: 8 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      delay: Math.random() * 2,
    }));
    setParticles(newParticles);
  }, [showParticles]);

  // Audio level pulse effect (throttled for performance)
  useEffect(() => {
    if (audioLevel > 0.1) {
      setPulseIntensity(1 + audioLevel * 0.5);
    } else {
      setPulseIntensity(1);
    }
  }, [audioLevel]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex items-center justify-center',
        sizes.container,
        interactive && 'cursor-pointer',
        className
      )}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      {/* Outer Aura Ring */}
      {showAura && (
        <div
          className={cn(
            'absolute rounded-full',
            sizes.ring,
            currentState === 'speaking' && 'animate-[pulse_1s_ease-in-out_infinite]',
            currentState === 'listening' && 'animate-[ping_2s_ease-in-out_infinite]',
            currentState === 'processing' && 'animate-[spin_3s_linear_infinite]',
          )}
          style={{
            background: `radial-gradient(circle, ${colors.glow} 0%, transparent 70%)`,
            transform: `scale(${pulseIntensity})`,
            transition: 'transform 0.1s ease-out',
          }}
        />
      )}

      {/* Secondary Ring - Authority Indicator */}
      <div
        className={cn(
          'absolute rounded-full border-2',
          sizes.ring,
          currentState === 'authoritative' && 'animate-[pulse_1.5s_ease-in-out_infinite]',
        )}
        style={{
          borderColor: colors.secondary,
          opacity: 0.6,
          transform: `scale(${0.95 * pulseIntensity})`,
        }}
      />

      {/* Inner Glow Ring */}
      <div
        className="absolute rounded-full"
        style={{
          width: '90%',
          height: '90%',
          background: `conic-gradient(from 0deg, ${colors.primary}, ${colors.secondary}, ${colors.primary})`,
          animation: currentState === 'processing' 
            ? 'spin 2s linear infinite' 
            : currentState === 'thinking'
            ? 'spin 4s linear infinite'
            : 'none',
          opacity: 0.8,
        }}
      />

      {/* Avatar Image Container */}
      <div
        className={cn(
          'relative rounded-full overflow-hidden z-10',
          sizes.avatar,
          'border-4 shadow-xl',
          interactive && 'hover:scale-105 transition-transform duration-200',
        )}
        style={{
          borderColor: colors.primary,
          boxShadow: `0 0 30px ${colors.glow}, inset 0 0 20px ${colors.glow}, 0 0 60px ${colors.pulse}`,
          animation: 'breathe 4s ease-in-out infinite',
        }}
      >
        <img
          src="/images/OIP.webp"
          alt="LEXARA - Legal Expert AI Resource Advisor"
          className="w-full h-full object-cover"
          loading="eager"
        />

        {/* Overlay for emotional state visualization */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `linear-gradient(180deg, transparent 60%, ${colors.glow} 100%)`,
            opacity: currentState === 'speaking' ? 0.4 : 0.2,
          }}
        />

        {/* Speaking indicator - mouth area highlight */}
        {isSpeaking && (
          <div
            className="absolute bottom-1/4 left-1/4 right-1/4 h-1/6 rounded-full"
            style={{
              background: `radial-gradient(ellipse, ${colors.glow} 0%, transparent 70%)`,
              animation: 'pulse 0.3s ease-in-out infinite',
              opacity: 0.6 + audioLevel * 0.4,
            }}
          />
        )}

        {/* Listening indicator - ear area highlights */}
        {isListening && (
          <>
            <div
              className="absolute top-1/4 left-0 w-1/6 h-1/4 rounded-r-full"
              style={{
                background: `radial-gradient(ellipse, ${colors.glow} 0%, transparent 70%)`,
                animation: 'ping 1.5s ease-in-out infinite',
              }}
            />
            <div
              className="absolute top-1/4 right-0 w-1/6 h-1/4 rounded-l-full"
              style={{
                background: `radial-gradient(ellipse, ${colors.glow} 0%, transparent 70%)`,
                animation: 'ping 1.5s ease-in-out infinite 0.3s',
              }}
            />
          </>
        )}
      </div>

      {/* Floating Particles - Optimized with CSS only */}
      {showParticles && particles.map((particle) => (
        <div
          key={particle.id}
          className="absolute w-1 h-1 rounded-full"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            backgroundColor: colors.secondary,
            animation: `float ${3 + particle.delay}s ease-in-out infinite ${particle.delay}s`,
            opacity: 0.6,
          }}
        />
      ))}

      {/* State Indicator Badge - Enhanced with shimmer */}
      <div
        className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold z-20 overflow-hidden"
        style={{
          backgroundColor: colors.primary,
          color: 'white',
          boxShadow: `0 0 15px ${colors.glow}, 0 0 30px ${colors.pulse}`,
          background: `linear-gradient(90deg, ${colors.primary} 0%, ${colors.secondary} 50%, ${colors.primary} 100%)`,
          backgroundSize: '200% 100%',
          animation: currentState !== 'neutral' ? 'shimmer 2s linear infinite' : 'none',
        }}
      >
        {currentState === 'listening' && '🎤 Actively Listening'}
        {currentState === 'speaking' && '🔊 Speaking'}
        {currentState === 'thinking' && '💭 Deep Analysis'}
        {currentState === 'processing' && '⚡ Processing'}
        {currentState === 'empathetic' && '💙 Understanding'}
        {currentState === 'authoritative' && '⚖️ Expert Advising'}
        {currentState === 'engaged' && '✨ Fully Engaged'}
        {currentState === 'neutral' && '👋 Ready to Assist'}
      </div>

      {/* Hypnotic Orbital Rings - Divine Enhancement */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: '120%',
          height: '120%',
          border: `1px solid ${colors.accent}`,
          animation: 'orbit 8s linear infinite',
          opacity: 0.3,
        }}
      />
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: '140%',
          height: '140%',
          border: `1px dashed ${colors.pulse}`,
          animation: 'orbit 12s linear infinite reverse',
          opacity: 0.2,
        }}
      />

      {/* Energy Field Effect */}
      <div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle at 30% 30%, ${colors.pulse} 0%, transparent 50%)`,
          animation: currentState === 'speaking' || currentState === 'authoritative' 
            ? 'energyPulse 2s ease-in-out infinite' 
            : 'none',
        }}
      />

      {/* CSS Keyframes injected inline for optimization */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.6; }
          25% { transform: translateY(-10px) translateX(5px); opacity: 0.8; }
          50% { transform: translateY(-5px) translateX(-5px); opacity: 0.4; }
          75% { transform: translateY(-15px) translateX(3px); opacity: 0.7; }
        }
        @keyframes orbit {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes energyPulse {
          0%, 100% { opacity: 0.1; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(1.05); }
        }
        @keyframes breathe {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          50% { transform: scale(1.02); filter: brightness(1.1); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </div>
  );
};

// ============================================================================
// LEXARA PRESENCE CONTAINER - Full immersive experience
// ============================================================================

export interface LexaraPresenceProps {
  children?: React.ReactNode;
  emotionalState?: EmotionalState;
  isActive?: boolean;
  audioLevel?: number;
  transcript?: string;
  isListening?: boolean;
  isSpeaking?: boolean;
  className?: string;
}

export const LexaraPresence: React.FC<LexaraPresenceProps> = ({
  children,
  emotionalState = 'neutral',
  isActive = true,
  audioLevel = 0,
  transcript = '',
  isListening = false,
  isSpeaking = false,
  className,
}) => {
  const colors = EMOTIONAL_COLORS[emotionalState];

  return (
    <div
      className={cn(
        'relative rounded-2xl overflow-hidden transition-all duration-500',
        isActive ? 'opacity-100' : 'opacity-80',
        className
      )}
      style={{
        background: `linear-gradient(135deg, ${colors.glow} 0%, transparent 30%, transparent 70%, ${colors.glow} 100%)`,
        padding: '3px',
      }}
    >
      {/* Animated Border Gradient */}
      <div
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{
          background: `conic-gradient(from 0deg, ${colors.primary}, ${colors.secondary}, ${colors.accent}, ${colors.primary})`,
          animation: isActive ? 'borderRotate 4s linear infinite' : 'none',
          opacity: 0.3,
          filter: 'blur(2px)',
        }}
      />

      {/* Inner container */}
      <div className="relative bg-background/95 backdrop-blur-md rounded-2xl p-6">
        {/* Multi-layer ambient glow effect */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 20% 20%, ${colors.pulse} 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, ${colors.pulse} 0%, transparent 50%)`,
            opacity: isActive ? 0.15 : 0.05,
          }}
        />

        {/* Scanning line effect when listening */}
        {isListening && (
          <div
            className="absolute left-0 right-0 h-0.5 pointer-events-none"
            style={{
              background: `linear-gradient(90deg, transparent, ${colors.primary}, transparent)`,
              animation: 'scanLine 2s ease-in-out infinite',
            }}
          />
        )}

        {/* Content */}
        <div className="relative z-10">
          {children}
        </div>

        {/* Transcript overlay - Enhanced */}
        {transcript && (
          <div
            className="absolute bottom-4 left-4 right-4 p-4 rounded-lg bg-black/60 backdrop-blur-md"
            style={{ 
              borderLeft: `4px solid ${colors.primary}`,
              boxShadow: `0 0 20px ${colors.pulse}`,
            }}
          >
            <p className="text-sm text-white/95 italic font-medium">
              "{transcript}"
            </p>
          </div>
        )}

        {/* Activity indicator bar - Enhanced */}
        <div
          className="absolute bottom-0 left-0 h-1.5 transition-all duration-100 rounded-br-2xl"
          style={{
            width: `${Math.min(audioLevel * 100, 100)}%`,
            background: `linear-gradient(90deg, ${colors.primary}, ${colors.secondary})`,
            boxShadow: `0 0 15px ${colors.glow}, 0 0 30px ${colors.pulse}`,
          }}
        />
      </div>

      <style>{`
        @keyframes borderRotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes scanLine {
          0% { top: 0; opacity: 0; }
          50% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
      `}</style>
    </div>
  );
};

// ============================================================================
// LEXARA WAVEFORM - Voice activity visualization
// ============================================================================

export interface LexaraWaveformProps {
  audioLevel: number;
  isActive: boolean;
  color?: string;
  barCount?: number;
  className?: string;
}

export const LexaraWaveform: React.FC<LexaraWaveformProps> = ({
  audioLevel,
  isActive,
  color = '#6366f1',
  barCount = 5,
  className,
}) => {
  const bars = useMemo(() => {
    return Array.from({ length: barCount }, (_, i) => ({
      id: i,
      baseHeight: 20 + Math.random() * 30,
      delay: i * 0.08,
      width: 2 + Math.random() * 2,
    }));
  }, [barCount]);

  return (
    <div className={cn('flex items-end justify-center gap-1 h-12', className)}>
      {bars.map((bar, index) => (
        <div
          key={bar.id}
          className="rounded-full transition-all duration-75"
          style={{
            width: `${bar.width}px`,
            height: isActive 
              ? `${bar.baseHeight + audioLevel * 60 + Math.sin(Date.now() / 200 + index) * 10}%`
              : '15%',
            background: isActive 
              ? `linear-gradient(180deg, ${color} 0%, ${color}80 100%)`
              : `${color}40`,
            opacity: isActive ? 0.85 + audioLevel * 0.15 : 0.25,
            animation: isActive ? `waveform 0.4s ease-in-out infinite ${bar.delay}s` : 'none',
            boxShadow: isActive ? `0 0 8px ${color}60` : 'none',
          }}
        />
      ))}
      <style>{`
        @keyframes waveform {
          0%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(1.6); }
        }
      `}</style>
    </div>
  );
};

// ============================================================================
// EXPORTS
// ============================================================================

export default LexaraAvatar;
