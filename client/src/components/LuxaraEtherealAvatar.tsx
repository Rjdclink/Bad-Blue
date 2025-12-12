/**
 * LUXARA Ethereal Avatar Component
 * 
 * Spectral, ethereal, softly luminous avatar for Luxara
 * - Not cartoony - intelligent, calm 18-19 year old presence
 * - Soft hair movement
 * - Subtle idle breathing / micro-movements
 * - Eye tracking simulated (looking toward camera)
 * - Lip sync driven by audio amplitude
 */

import React, { useState, useEffect, useRef, memo, useMemo } from 'react';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

export type LuxaraEmotionHint = 'calm' | 'playful' | 'serious' | 'empathetic' | 'protective' | 'authoritative';
export type LuxaraGazeHint = 'camera' | 'side' | 'down' | 'up' | 'thinking';
export type LuxaraVoiceStyle = 'soft' | 'firm' | 'warm' | 'professional' | 'protective';

export interface LuxaraEtherealAvatarProps {
  isSpeaking?: boolean;
  isListening?: boolean;
  isThinking?: boolean;
  audioLevel?: number; // 0-1 for lip sync
  emotionHint?: LuxaraEmotionHint;
  gazeHint?: LuxaraGazeHint;
  className?: string;
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
// ETHEREAL LUXARA AVATAR
// ============================================================================

export const LuxaraEtherealAvatar = memo(function LuxaraEtherealAvatar({
  isSpeaking = false,
  isListening = false,
  isThinking = false,
  audioLevel = 0,
  emotionHint = 'calm',
  gazeHint = 'camera',
  className,
  size = 'full',
}: LuxaraEtherealAvatarProps) {
  // Animation state
  const [breathePhase, setBreathePhase] = useState(0);
  const [hairDrift, setHairDrift] = useState(0);
  const [lipOpenAmount, setLipOpenAmount] = useState(0);
  const [blinkState, setBlinkState] = useState(false);
  
  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  
  // Gentle breathing and hair animation - low FPS for performance
  useEffect(() => {
    let frameCount = 0;
    
    const animate = (timestamp: number) => {
      if (timestamp - lastTimeRef.current > 50) { // ~20 FPS max
        lastTimeRef.current = timestamp;
        frameCount++;
        
        // Breathing cycle (slow)
        setBreathePhase(prev => (prev + 0.02) % (Math.PI * 2));
        
        // Hair drift (very slow)
        setHairDrift(prev => (prev + 0.01) % (Math.PI * 2));
        
        // Random blinking
        if (frameCount % 100 === 0 && Math.random() > 0.7) {
          setBlinkState(true);
          setTimeout(() => setBlinkState(false), 150);
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
      setLipOpenAmount(0);
    }
  }, [isSpeaking, audioLevel]);
  
  // Calculate animation values
  const breatheScale = 1 + Math.sin(breathePhase) * 0.008;
  const hairOffset = Math.sin(hairDrift) * 3;
  const shoulderMovement = Math.sin(breathePhase * 0.5) * 1.5;
  
  // Eye position based on gaze hint
  const getEyeOffset = useMemo(() => {
    switch (gazeHint) {
      case 'side': return { x: 3, y: 0 };
      case 'down': return { x: 0, y: 2 };
      case 'up': return { x: 0, y: -2 };
      case 'thinking': return { x: 2, y: -1 };
      default: return { x: 0, y: 0 };
    }
  }, [gazeHint]);
  
  // Emotion-based color accents
  const getEmotionColor = useMemo(() => {
    switch (emotionHint) {
      case 'playful': return { primary: '#60a5fa', secondary: '#d4af37', glow: 'rgba(96, 165, 250, 0.3)' };
      case 'serious': return { primary: '#6366f1', secondary: '#94a3b8', glow: 'rgba(99, 102, 241, 0.3)' };
      case 'empathetic': return { primary: '#f472b6', secondary: '#d4af37', glow: 'rgba(244, 114, 182, 0.3)' };
      case 'protective': return { primary: '#ef4444', secondary: '#d4af37', glow: 'rgba(239, 68, 68, 0.3)' };
      case 'authoritative': return { primary: '#8b5cf6', secondary: '#d4af37', glow: 'rgba(139, 92, 246, 0.3)' };
      default: return { primary: '#60a5fa', secondary: '#d4af37', glow: 'rgba(96, 165, 250, 0.3)' };
    }
  }, [emotionHint]);
  
  const sizes = SIZE_CONFIG[size];

  return (
    <div className={cn(
      'relative flex items-center justify-center overflow-hidden',
      'bg-gradient-to-br from-slate-950 via-indigo-950/80 to-slate-900',
      sizes.container,
      className
    )}>
      {/* Animated particle field - ethereal background */}
      <div className="absolute inset-0 opacity-40">
        {[...Array(30)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: `${1.5 + Math.random() * 2.5}px`,
              height: `${1.5 + Math.random() * 2.5}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              background: i % 3 === 0 
                ? 'rgba(212, 175, 55, 0.7)' 
                : i % 3 === 1 
                ? 'rgba(96, 165, 250, 0.6)' 
                : 'rgba(139, 92, 246, 0.5)',
              animation: `float-particle ${8 + Math.random() * 6}s ease-in-out infinite ${Math.random() * 4}s`,
            }}
          />
        ))}
      </div>
      
      {/* Radial depth gradient */}
      <div 
        className="absolute inset-0" 
        style={{ 
          background: 'radial-gradient(circle at center 30%, transparent 0%, transparent 35%, rgba(2,6,23,0.6) 100%)' 
        }} 
      />
      
      {/* Soft shimmer behind avatar */}
      <div 
        className="absolute top-1/4 left-1/2 -translate-x-1/2 w-3/4 h-1/2 rounded-full blur-3xl opacity-30"
        style={{
          background: `radial-gradient(ellipse, ${getEmotionColor.glow} 0%, transparent 70%)`,
          animation: 'shimmer-pulse 4s ease-in-out infinite',
        }}
      />
      
      {/* Main avatar container with breathing */}
      <div 
        className="relative z-10 w-full h-full flex items-center justify-center"
        style={{ 
          transform: `scale(${breatheScale})`, 
          transition: 'transform 0.1s ease-out' 
        }}
      >
        {/* Outer aura ring */}
        <div 
          className={cn(
            "absolute rounded-full border border-cyan-400/20",
            isSpeaking && "animate-pulse"
          )}
          style={{ 
            width: '85%', 
            height: '85%',
            boxShadow: `0 0 60px ${getEmotionColor.glow}, 0 0 120px rgba(212,175,55,0.1)` 
          }}
        />
        
        {/* SVG Avatar - Ethereal young woman */}
        <svg 
          viewBox="0 0 200 280" 
          className="w-full h-full max-w-[280px] max-h-[380px]"
          style={{ filter: 'blur(0.2px)' }}
        >
          <defs>
            {/* Hair gradient - dark, flowing */}
            <linearGradient id="luxHairGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(30,41,59,0.95)" />
              <stop offset="40%" stopColor="rgba(51,65,85,0.9)" />
              <stop offset="70%" stopColor="rgba(71,85,105,0.85)" />
              <stop offset="100%" stopColor="rgba(30,41,59,0.95)" />
            </linearGradient>
            
            {/* Skin gradient - ethereal, luminous */}
            <linearGradient id="luxSkinGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(241,245,249,0.85)" />
              <stop offset="50%" stopColor="rgba(226,232,240,0.8)" />
              <stop offset="100%" stopColor="rgba(203,213,225,0.7)" />
            </linearGradient>
            
            {/* Clothing gradient - soft, professional */}
            <linearGradient id="luxClothGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(148,163,184,0.6)" />
              <stop offset="100%" stopColor="rgba(100,116,139,0.5)" />
            </linearGradient>
            
            {/* Glow filter */}
            <filter id="luxGlow">
              <feGaussianBlur stdDeviation="2" result="blur"/>
              <feMerge>
                <feMergeNode in="blur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
            
            {/* Soft shadow */}
            <filter id="luxShadow">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.2"/>
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
            fill="url(#luxHairGrad)" 
            opacity="0.85"
          />
          <path 
            d={`M150 ${55 - hairOffset * 0.3} 
                Q165 90, ${155 - hairOffset * 0.5} 160 
                Q150 200, ${160 - hairOffset * 0.4} 240
                L165 250 
                Q155 210, 155 140 
                Q160 80, 150 ${55 - hairOffset * 0.3}Z`} 
            fill="url(#luxHairGrad)" 
            opacity="0.85"
          />
          
          {/* Hair top volume */}
          <ellipse 
            cx="100" 
            cy="58" 
            rx="48" 
            ry="30" 
            fill="url(#luxHairGrad)" 
            opacity="0.95"
          />
          
          {/* Neck */}
          <path 
            d={`M85 145 
                Q100 ${155 + shoulderMovement * 0.5}, 115 145 
                L118 170 
                Q100 180, 82 170 Z`} 
            fill="url(#luxSkinGrad)" 
            opacity="0.85"
            filter="url(#luxShadow)"
          />
          
          {/* Shoulders and upper body */}
          <path 
            d={`M55 ${175 + shoulderMovement} 
                Q82 165, 100 170 
                Q118 165, 145 ${175 + shoulderMovement}
                L150 250 
                Q100 260, 50 250 Z`} 
            fill="url(#luxClothGrad)" 
            stroke="rgba(148,163,184,0.3)" 
            strokeWidth="1"
          />
          
          {/* Face - ethereal oval */}
          <ellipse 
            cx="100" 
            cy="100" 
            rx="38" 
            ry="48" 
            fill="url(#luxSkinGrad)" 
            filter="url(#luxGlow)" 
            opacity="0.92"
          />
          
          {/* Front hair strands */}
          <path 
            d={`M62 ${60 + hairOffset * 0.2} 
                Q55 80, 60 105 
                Q65 85, 62 ${60 + hairOffset * 0.2}Z`} 
            fill="url(#luxHairGrad)" 
            opacity="0.9"
          />
          <path 
            d={`M138 ${60 - hairOffset * 0.2} 
                Q145 80, 140 105 
                Q135 85, 138 ${60 - hairOffset * 0.2}Z`} 
            fill="url(#luxHairGrad)" 
            opacity="0.9"
          />
          
          {/* Eyes - Electric blue with golden irises */}
          <g filter="url(#luxGlow)">
            {/* Left eye */}
            <ellipse 
              cx={82 + getEyeOffset.x * 0.5} 
              cy={92 + getEyeOffset.y * 0.5} 
              rx={blinkState ? 8 : 8} 
              ry={blinkState ? 0.5 : 6} 
              fill="rgba(255,255,255,0.95)"
              style={{ transition: 'ry 0.1s ease-out' }}
            />
            {!blinkState && (
              <>
                <circle 
                  cx={82 + getEyeOffset.x} 
                  cy={92 + getEyeOffset.y} 
                  r="5" 
                  fill="rgba(212,175,55,0.9)"
                />
                <circle 
                  cx={82 + getEyeOffset.x} 
                  cy={92 + getEyeOffset.y} 
                  r="3.2" 
                  fill={getEmotionColor.primary}
                  className={isListening ? "animate-pulse" : ""}
                />
                <circle cx={80} cy={90} r="1" fill="rgba(255,255,255,0.9)"/>
              </>
            )}
            
            {/* Right eye */}
            <ellipse 
              cx={118 + getEyeOffset.x * 0.5} 
              cy={92 + getEyeOffset.y * 0.5} 
              rx={blinkState ? 8 : 8} 
              ry={blinkState ? 0.5 : 6} 
              fill="rgba(255,255,255,0.95)"
              style={{ transition: 'ry 0.1s ease-out' }}
            />
            {!blinkState && (
              <>
                <circle 
                  cx={118 + getEyeOffset.x} 
                  cy={92 + getEyeOffset.y} 
                  r="5" 
                  fill="rgba(212,175,55,0.9)"
                />
                <circle 
                  cx={118 + getEyeOffset.x} 
                  cy={92 + getEyeOffset.y} 
                  r="3.2" 
                  fill={getEmotionColor.primary}
                  className={isListening ? "animate-pulse" : ""}
                />
                <circle cx={116} cy={90} r="1" fill="rgba(255,255,255,0.9)"/>
              </>
            )}
          </g>
          
          {/* Eyebrows - subtle, expressive */}
          <path 
            d={`M72 ${82 - (isListening ? 2 : 0)} Q84 ${79 - (isListening ? 3 : 0)}, 92 82`} 
            stroke="rgba(71,85,105,0.5)" 
            strokeWidth="1.5" 
            fill="none"
            strokeLinecap="round"
          />
          <path 
            d={`M108 82 Q116 ${79 - (isListening ? 3 : 0)}, 128 ${82 - (isListening ? 2 : 0)}`} 
            stroke="rgba(71,85,105,0.5)" 
            strokeWidth="1.5" 
            fill="none"
            strokeLinecap="round"
          />
          
          {/* Nose - delicate */}
          <path 
            d="M100 95 L100 110 Q96 114, 100 117" 
            stroke="rgba(148,163,184,0.35)" 
            strokeWidth="1" 
            fill="none"
          />
          
          {/* Lips - animated for speech */}
          <g>
            {/* Upper lip */}
            <path 
              d={`M88 ${126 - lipOpenAmount * 1.5} 
                  Q100 ${123 - lipOpenAmount * 2}, 112 ${126 - lipOpenAmount * 1.5}`} 
              stroke="rgba(244,114,182,0.6)" 
              strokeWidth="2" 
              fill="none"
              strokeLinecap="round"
            />
            {/* Lower lip */}
            <path 
              d={`M90 ${128 + lipOpenAmount * 3} 
                  Q100 ${132 + lipOpenAmount * 4}, 110 ${128 + lipOpenAmount * 3}`} 
              stroke="rgba(244,114,182,0.5)" 
              strokeWidth="1.5" 
              fill="none"
              strokeLinecap="round"
            />
            {/* Mouth opening when speaking */}
            {isSpeaking && lipOpenAmount > 0.1 && (
              <ellipse 
                cx="100" 
                cy={128 + lipOpenAmount * 1.5} 
                rx={4 + lipOpenAmount * 3} 
                ry={lipOpenAmount * 3} 
                fill="rgba(30,20,20,0.6)"
              />
            )}
          </g>
        </svg>
        
        {/* Spectral shimmer overlay */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            background: 'linear-gradient(135deg, transparent 0%, rgba(96,165,250,0.3) 50%, transparent 100%)',
            animation: 'shimmer 5s ease-in-out infinite',
          }}
        />
        
        {/* Speaking pulse effect */}
        {isSpeaking && (
          <div 
            className="absolute inset-0 pointer-events-none rounded-full"
            style={{
              boxShadow: `0 0 40px ${getEmotionColor.glow}, 0 0 80px rgba(59,130,246,0.2)`,
              animation: 'pulse-glow 0.35s ease-in-out infinite',
            }}
          />
        )}
        
        {/* Thinking glow effect */}
        {isThinking && (
          <div 
            className="absolute inset-0 pointer-events-none"
            style={{
              boxShadow: '0 0 50px rgba(212,175,55,0.3), 0 0 100px rgba(212,175,55,0.15)',
              animation: 'pulse-glow 1.2s ease-in-out infinite',
            }}
          />
        )}
      </div>
      
      {/* Status badge - minimal, elegant */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
        <div className={cn(
          "px-4 py-1.5 rounded-full text-xs font-medium tracking-wider backdrop-blur-md border",
          isSpeaking ? "bg-blue-500/20 border-blue-400/40 text-blue-300" :
          isListening ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-300" :
          isThinking ? "bg-amber-500/20 border-amber-400/40 text-amber-300" :
          "bg-slate-800/60 border-slate-600/40 text-slate-400"
        )}>
          {isSpeaking ? '● Speaking' : 
           isListening ? '● Listening' : 
           isThinking ? '● Thinking' : 
           '○ Ready'}
        </div>
      </div>
      
      {/* CSS Animations */}
      <style>{`
        @keyframes float-particle {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.3; }
          50% { transform: translateY(-20px) translateX(6px); opacity: 0.7; }
        }
        @keyframes shimmer {
          0%, 100% { opacity: 0.15; transform: translateX(-5%); }
          50% { opacity: 0.3; transform: translateX(5%); }
        }
        @keyframes shimmer-pulse {
          0%, 100% { opacity: 0.25; transform: translateX(-50%) scale(1); }
          50% { opacity: 0.4; transform: translateX(-50%) scale(1.05); }
        }
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
});

// ============================================================================
// LUXARA STATUS INDICATOR
// ============================================================================

export interface LuxaraStatusIndicatorProps {
  isSpeaking: boolean;
  isListening: boolean;
  isThinking: boolean;
  className?: string;
}

export const LuxaraStatusIndicator: React.FC<LuxaraStatusIndicatorProps> = ({
  isSpeaking,
  isListening,
  isThinking,
  className,
}) => {
  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      {/* Mic indicator */}
      <div className={cn(
        "w-2 h-2 rounded-full transition-colors",
        isListening ? "bg-emerald-400 animate-pulse" : "bg-slate-600"
      )} />
      
      {/* Speaker indicator */}
      <div className={cn(
        "w-2 h-2 rounded-full transition-colors",
        isSpeaking ? "bg-blue-400 animate-pulse" : "bg-slate-600"
      )} />
      
      {/* Thinking indicator */}
      <div className={cn(
        "w-2 h-2 rounded-full transition-colors",
        isThinking ? "bg-amber-400 animate-pulse" : "bg-slate-600"
      )} />
    </div>
  );
};

export default LuxaraEtherealAvatar;
