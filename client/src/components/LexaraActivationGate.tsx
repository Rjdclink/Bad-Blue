/**
 * Lexara Activation Gate - Full-Screen Picture-Based Interface
 * 
 * Key Design Rules:
 * 1. Lexara is a STATIC PICTURE component, not a 3D avatar
 * 2. All effects happen AROUND the picture, not warping the face
 * 3. Single activation button using client/public/icon-512x512.png
 * 
 * Features:
 * - Full-screen gate before Lexara loads
 * - Lexara picture centered with soft halo pulse
 * - Legal disclaimer text
 * - Framer Motion animations (fade-in, halo pulse, gate fade-out)
 * - 4-step activation ritual on button click
 */

import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Mic, Camera, Loader2 } from 'lucide-react';
import { useLexaraStore } from '@/lib/lexaraStore';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

export interface LexaraActivationGateProps {
  onActivated: () => void;
  lawArea?: string;
  /** Image source for Lexara picture */
  lexaraImageSrc?: string;
}

type ActivationStep = 'idle' | 'permissions' | 'media' | 'audio-engine' | 'session' | 'complete' | 'error';

interface ActivationState {
  step: ActivationStep;
  error: string | null;
  progress: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Lexara image - the female sitting at desk (existing Lexara avatar)
const DEFAULT_LEXARA_IMAGE = '/images/OIP.webp';
const ACTIVATION_ICON = '/icon-512x512.png';

const STEP_MESSAGES: Record<ActivationStep, string> = {
  'idle': 'Ready to activate',
  'permissions': 'Requesting camera and microphone access...',
  'media': 'Initializing media streams...',
  'audio-engine': 'Starting audio engine...',
  'session': 'Connecting to Lexara...',
  'complete': 'Activation complete!',
  'error': 'Activation failed',
};

// ============================================================================
// LEXARA PICTURE COMPONENT (with DIVINE visual FX around picture)
// Enhanced with celestial effects befitting a Supreme Court-level AI
// ============================================================================

interface LexaraPictureProps {
  imageSrc: string;
  audioLevel: number;
  isSpeaking: boolean;
  isListening: boolean;
}

const LexaraPicture = memo(function LexaraPicture({
  imageSrc,
  audioLevel,
  isSpeaking,
  isListening,
}: LexaraPictureProps) {
  // Normalize audio level to 0-1 range for visual effects
  const normalizedLevel = Math.min(1, Math.max(0, audioLevel));
  
  return (
    <div className="relative flex items-center justify-center" style={{ width: '400px', height: '400px' }}>
      {/* ============ DIVINE OUTER AURAS ============ */}
      
      {/* Celestial outer nebula - the most distant glow */}
      <motion.div
        className="absolute rounded-full"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ 
          scale: [1, 1.15, 1.05, 1.1, 1],
          opacity: [0.15, 0.25, 0.18, 0.22, 0.15],
          rotate: [0, 180, 360],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: 'linear',
        }}
        style={{
          width: '380px',
          height: '380px',
          background: 'conic-gradient(from 0deg, rgba(34, 211, 238, 0.1), rgba(139, 92, 246, 0.1), rgba(236, 72, 153, 0.05), rgba(34, 211, 238, 0.1))',
          filter: 'blur(40px)',
        }}
      />
      
      {/* Secondary nebula - counter-rotating */}
      <motion.div
        className="absolute rounded-full"
        animate={{ 
          scale: [1.05, 1, 1.08, 0.98, 1.05],
          rotate: [360, 180, 0],
        }}
        transition={{
          duration: 15,
          repeat: Infinity,
          ease: 'linear',
        }}
        style={{
          width: '350px',
          height: '350px',
          background: 'conic-gradient(from 180deg, rgba(99, 102, 241, 0.15), rgba(34, 211, 238, 0.1), rgba(139, 92, 246, 0.12), rgba(99, 102, 241, 0.15))',
          filter: 'blur(30px)',
        }}
      />
      
      {/* Primary cyan halo - constant soft glow (THE KEY HALO) */}
      <motion.div
        className="absolute rounded-full"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ 
          scale: [1, 1.08, 1.02, 1.06, 1],
          opacity: isSpeaking ? [0.35, 0.5, 0.4, 0.45, 0.35] : [0.2, 0.28, 0.22, 0.25, 0.2],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        style={{
          width: '320px',
          height: '320px',
          background: 'radial-gradient(circle, rgba(34, 211, 238, 0.4) 0%, rgba(34, 211, 238, 0.2) 40%, transparent 70%)',
          filter: 'blur(20px)',
        }}
      />
      
      {/* Silver/white divine light burst */}
      <motion.div
        className="absolute"
        animate={{
          opacity: [0.1, 0.2, 0.15, 0.18, 0.1],
          scale: [1, 1.05, 1.02, 1.03, 1],
        }}
        transition={{
          duration: 6,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        style={{
          width: '300px',
          height: '300px',
          background: 'radial-gradient(ellipse at center, rgba(255, 255, 255, 0.15) 0%, transparent 60%)',
          filter: 'blur(15px)',
        }}
      />
      
      {/* ============ LISTENING RING - follows mic level ============ */}
      <motion.div
        className="absolute rounded-full"
        animate={{
          scale: isListening ? 1 + normalizedLevel * 0.2 : 1,
          opacity: isListening ? 0.4 + normalizedLevel * 0.5 : 0,
        }}
        transition={{ duration: 0.08, ease: 'easeOut' }}
        style={{
          width: '290px',
          height: '290px',
          border: `${isListening ? 3 + normalizedLevel * 5 : 2}px solid rgba(34, 211, 238, ${isListening ? 0.5 + normalizedLevel * 0.4 : 0.3})`,
          boxShadow: isListening 
            ? `0 0 ${20 + normalizedLevel * 30}px rgba(34, 211, 238, ${0.3 + normalizedLevel * 0.4}), inset 0 0 ${10 + normalizedLevel * 20}px rgba(34, 211, 238, 0.1)`
            : 'none',
        }}
      />
      
      {/* Outer listening pulse rings */}
      {isListening && (
        <>
          <motion.div
            className="absolute rounded-full border border-cyan-400/30"
            animate={{
              scale: [1, 1.3, 1.5],
              opacity: [0.4, 0.2, 0],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: 'easeOut',
            }}
            style={{ width: '280px', height: '280px' }}
          />
          <motion.div
            className="absolute rounded-full border border-cyan-400/20"
            animate={{
              scale: [1, 1.4, 1.6],
              opacity: [0.3, 0.15, 0],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: 'easeOut',
              delay: 0.5,
            }}
            style={{ width: '280px', height: '280px' }}
          />
        </>
      )}
      
      {/* ============ SPEAKING MODE - Divine broadcast effect ============ */}
      {isSpeaking && (
        <>
          {/* Speaking pulse ring - rhythmic */}
          <motion.div
            className="absolute rounded-full"
            animate={{
              scale: [1, 1.15, 1.08, 1.12, 1],
              opacity: [0.5, 0.2, 0.4, 0.25, 0.5],
            }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            style={{
              width: '300px',
              height: '300px',
              background: 'radial-gradient(circle, rgba(99, 102, 241, 0.3) 0%, rgba(34, 211, 238, 0.2) 50%, transparent 70%)',
            }}
          />
          
          {/* Voice wave rings emanating outward */}
          <motion.div
            className="absolute rounded-full border-2 border-indigo-400/40"
            animate={{
              scale: [1, 1.4],
              opacity: [0.5, 0],
            }}
            transition={{
              duration: 1,
              repeat: Infinity,
              ease: 'easeOut',
            }}
            style={{ width: '270px', height: '270px' }}
          />
          <motion.div
            className="absolute rounded-full border-2 border-cyan-400/30"
            animate={{
              scale: [1, 1.5],
              opacity: [0.4, 0],
            }}
            transition={{
              duration: 1,
              repeat: Infinity,
              ease: 'easeOut',
              delay: 0.3,
            }}
            style={{ width: '270px', height: '270px' }}
          />
          <motion.div
            className="absolute rounded-full border border-purple-400/20"
            animate={{
              scale: [1, 1.6],
              opacity: [0.3, 0],
            }}
            transition={{
              duration: 1,
              repeat: Infinity,
              ease: 'easeOut',
              delay: 0.6,
            }}
            style={{ width: '270px', height: '270px' }}
          />
        </>
      )}
      
      {/* ============ PICTURE CONTAINER with Divine floating ============ */}
      <motion.div
        className="relative z-10"
        animate={{
          y: [-2, 2, -1, 1.5, -2],
          x: [-1, 1, -0.5, 0.8, -1],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      >
        {/* Inner divine glow ring */}
        <motion.div
          className="absolute -inset-4 rounded-full"
          animate={{
            opacity: [0.6, 0.8, 0.65, 0.75, 0.6],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          style={{
            background: 'conic-gradient(from 0deg, rgba(34, 211, 238, 0.3), rgba(139, 92, 246, 0.2), rgba(99, 102, 241, 0.25), rgba(34, 211, 238, 0.3))',
            filter: 'blur(12px)',
          }}
        />
        
        {/* Picture frame silver/cyan border glow */}
        <div 
          className="absolute -inset-1 rounded-full"
          style={{
            background: 'linear-gradient(135deg, rgba(192, 192, 192, 0.4), rgba(34, 211, 238, 0.3), rgba(192, 192, 192, 0.4))',
            filter: 'blur(4px)',
          }}
        />
        
        {/* The actual Lexara picture - STATIC, no warping - THE SACRED IMAGE */}
        <motion.img
          src={imageSrc}
          alt="Lexara - AI Legal Consultant with Supreme Court-level expertise"
          className="relative w-56 h-56 md:w-64 md:h-64 rounded-full object-cover shadow-2xl"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, ease: 'easeOut' }}
          style={{
            border: '4px solid rgba(71, 85, 105, 0.6)',
            boxShadow: `
              0 0 30px rgba(34, 211, 238, 0.3),
              0 0 60px rgba(99, 102, 241, 0.2),
              inset 0 0 20px rgba(0, 0, 0, 0.3)
            `,
          }}
        />
        
        {/* ============ SHIMMER EFFECTS (on frame, NOT face) ============ */}
        
        {/* Constant subtle shimmer around frame */}
        <motion.div
          className="absolute inset-0 rounded-full overflow-hidden pointer-events-none"
          style={{ padding: '4px' }}
        >
          <motion.div
            className="absolute inset-0"
            animate={{
              background: [
                'linear-gradient(45deg, transparent 40%, rgba(255,255,255,0.08) 50%, transparent 60%)',
                'linear-gradient(45deg, transparent 40%, rgba(255,255,255,0.08) 50%, transparent 60%)',
              ],
              backgroundPosition: ['-200% 0', '200% 0'],
            }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: 'linear',
            }}
            style={{ backgroundSize: '200% 100%' }}
          />
        </motion.div>
        
        {/* Speaking shimmer - more pronounced */}
        {isSpeaking && (
          <motion.div
            className="absolute inset-0 rounded-full overflow-hidden pointer-events-none"
          >
            <motion.div
              className="absolute inset-0"
              animate={{
                x: ['-100%', '200%'],
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              style={{
                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)',
                width: '50%',
              }}
            />
          </motion.div>
        )}
        
        {/* Divine crown highlight at top */}
        <motion.div
          className="absolute -top-2 left-1/2 -translate-x-1/2 w-20 h-8"
          animate={{
            opacity: [0.3, 0.5, 0.35, 0.45, 0.3],
          }}
          transition={{
            duration: 5,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          style={{
            background: 'radial-gradient(ellipse at center bottom, rgba(255, 215, 0, 0.3), transparent 70%)',
            filter: 'blur(6px)',
          }}
        />
      </motion.div>
      
      {/* ============ ORBITAL RINGS - Divine authority ============ */}
      
      {/* Inner orbital ring */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        animate={{ rotate: 360 }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        style={{
          width: '340px',
          height: '340px',
          border: '1px solid rgba(34, 211, 238, 0.15)',
        }}
      />
      
      {/* Outer orbital ring - counter rotation */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        animate={{ rotate: -360 }}
        transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
        style={{
          width: '370px',
          height: '370px',
          border: '1px dashed rgba(139, 92, 246, 0.12)',
        }}
      />
      
      {/* Orbital particle dots */}
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className="absolute w-2 h-2 rounded-full bg-cyan-400/60"
          animate={{
            rotate: 360,
          }}
          transition={{
            duration: 12 + i * 3,
            repeat: Infinity,
            ease: 'linear',
            delay: i * 2,
          }}
          style={{
            width: '340px',
            height: '340px',
            transformOrigin: 'center center',
          }}
        >
          <div 
            className="absolute w-2 h-2 rounded-full"
            style={{
              background: `radial-gradient(circle, ${i % 2 === 0 ? 'rgba(34, 211, 238, 0.8)' : 'rgba(139, 92, 246, 0.8)'}, transparent)`,
              boxShadow: `0 0 8px ${i % 2 === 0 ? 'rgba(34, 211, 238, 0.6)' : 'rgba(139, 92, 246, 0.6)'}`,
              top: '0',
              left: '50%',
              transform: 'translateX(-50%)',
            }}
          />
        </motion.div>
      ))}
    </div>
  );
});

// ============================================================================
// ACTIVATION BUTTON COMPONENT
// ============================================================================

interface ActivationButtonProps {
  onClick: () => void;
  isActivating: boolean;
  activationState: ActivationState;
}

const ActivationButton = memo(function ActivationButton({
  onClick,
  isActivating,
  activationState,
}: ActivationButtonProps) {
  return (
    <motion.button
      onClick={onClick}
      disabled={isActivating}
      className={cn(
        "relative group flex items-center gap-4 px-8 py-5 rounded-2xl",
        "bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900",
        "border-2 border-slate-700/50",
        "shadow-xl shadow-cyan-500/10",
        "transition-all duration-300",
        "hover:border-cyan-500/50 hover:shadow-2xl hover:shadow-cyan-500/20",
        "hover:-translate-y-1",
        "focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:ring-offset-2 focus:ring-offset-slate-900",
        "disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:translate-y-0",
      )}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5, duration: 0.5 }}
      whileHover={{ scale: isActivating ? 1 : 1.02 }}
      whileTap={{ scale: isActivating ? 1 : 0.98 }}
    >
      {/* Button glow effect */}
      <motion.div
        className="absolute inset-0 rounded-2xl bg-gradient-to-r from-cyan-500/10 via-transparent to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
      />
      
      {/* Breathing animation border */}
      <motion.div
        className="absolute inset-0 rounded-2xl border border-cyan-500/30"
        animate={{
          opacity: [0.3, 0.6, 0.3],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
      
      {/* Icon */}
      <div className="relative flex-shrink-0">
        {isActivating ? (
          <Loader2 className="w-10 h-10 text-cyan-400 animate-spin" />
        ) : (
          <motion.div
            className="relative"
            animate={{
              filter: ['drop-shadow(0 0 8px rgba(34, 211, 238, 0.4))', 'drop-shadow(0 0 16px rgba(34, 211, 238, 0.6))', 'drop-shadow(0 0 8px rgba(34, 211, 238, 0.4))'],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          >
            <img
              src={ACTIVATION_ICON}
              alt="Activate"
              className="w-10 h-10 rounded-lg"
            />
          </motion.div>
        )}
      </div>
      
      {/* Text content */}
      <div className="relative text-left">
        <div className="text-lg font-semibold text-white tracking-wide">
          {isActivating ? STEP_MESSAGES[activationState.step] : 'ACTIVATE LIVE LEGAL CONSULTATION'}
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-400 mt-1">
          <Mic className="w-4 h-4" />
          <span>Microphone</span>
          <span className="text-slate-600">+</span>
          <Camera className="w-4 h-4" />
          <span>Camera Required</span>
        </div>
      </div>
    </motion.button>
  );
});

// ============================================================================
// LEGAL DISCLAIMER COMPONENT
// ============================================================================

const LegalDisclaimer = memo(function LegalDisclaimer() {
  return (
    <motion.div
      className="max-w-lg mx-auto mt-8 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.5 }}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-amber-200 font-medium text-sm mb-1">Legal Disclaimer</p>
          <p className="text-amber-100/80 text-sm leading-relaxed">
            Lexara provides AI-powered legal information and guidance but does{' '}
            <strong className="text-amber-200">not</strong> constitute legal advice. 
            The information provided is for educational and informational purposes only. 
            For legal advice specific to your situation, please consult a licensed attorney 
            in your jurisdiction. By activating, you acknowledge this disclaimer.
          </p>
        </div>
      </div>
    </motion.div>
  );
});

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function LexaraActivationGate({
  onActivated,
  lawArea,
  lexaraImageSrc = DEFAULT_LEXARA_IMAGE,
}: LexaraActivationGateProps) {
  const [activationState, setActivationState] = useState<ActivationState>({
    step: 'idle',
    error: null,
    progress: 0,
  });
  
  const { setConsent, updateMedia, startSession, setError, setStatus } = useLexaraStore();
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  
  const isActivating = activationState.step !== 'idle' && activationState.step !== 'complete' && activationState.step !== 'error';
  
  /**
   * 4-STEP ACTIVATION RITUAL (Order is Critical)
   * 
   * 1. Permissions: getUserMedia({ audio: true, video: true })
   * 2. Media Init: Verify stream, attach to analyser
   * 3. Audio Engine: Initialize/resume AudioContext
   * 4. Lexara Live Logic: Create session in Zustand
   */
  const handleActivation = useCallback(async () => {
    setActivationState({ step: 'permissions', error: null, progress: 0 });
    
    try {
      // =========================================
      // STEP 1: PERMISSIONS
      // =========================================
      setActivationState({ step: 'permissions', error: null, progress: 10 });
      
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });
      } catch (permError: any) {
        // Handle permission denial gracefully
        if (permError.name === 'NotAllowedError' || permError.name === 'PermissionDeniedError') {
          throw new Error('Camera and microphone access is required for live consultation. Please allow access and try again.');
        } else if (permError.name === 'NotFoundError') {
          throw new Error('No camera or microphone found. Please connect devices and try again.');
        }
        throw new Error('Could not access camera or microphone. Please check your device settings.');
      }
      
      mediaStreamRef.current = stream;
      
      // =========================================
      // STEP 2: MEDIA INITIALIZATION
      // =========================================
      setActivationState({ step: 'media', error: null, progress: 35 });
      
      // Verify stream has at least 1 live audio + video track
      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();
      
      if (audioTracks.length === 0 || !audioTracks[0].enabled) {
        throw new Error('No active audio track found. Please check your microphone.');
      }
      
      if (videoTracks.length === 0 || !videoTracks[0].enabled) {
        throw new Error('No active video track found. Please check your camera.');
      }
      
      // Update store with media state
      updateMedia({
        hasMic: true,
        hasCamera: true,
        micPermission: 'granted',
        cameraPermission: 'granted',
        audioStream: stream,
        videoStream: stream,
      });
      
      // =========================================
      // STEP 3: AUDIO ENGINE INITIALIZATION
      // =========================================
      setActivationState({ step: 'audio-engine', error: null, progress: 60 });
      
      // Initialize AudioContext for audio analysis
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('Web Audio API not supported in this browser.');
      }
      
      audioContextRef.current = new AudioContextClass();
      
      // Resume if suspended (required for some browsers)
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      // Create audio analyser for level monitoring
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyser);
      
      // =========================================
      // STEP 4: LEXARA LIVE LOGIC / SESSION
      // =========================================
      setActivationState({ step: 'session', error: null, progress: 85 });
      
      // Set consent and start session
      setConsent(true);
      startSession(lawArea);
      setStatus('active');
      
      // =========================================
      // COMPLETE
      // =========================================
      setActivationState({ step: 'complete', error: null, progress: 100 });
      
      // Small delay for visual feedback, then notify parent
      setTimeout(() => {
        onActivated();
      }, 500);
      
    } catch (error: any) {
      console.error('[Lexara Activation] Error:', error);
      
      // Clean up on error
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      
      setActivationState({
        step: 'error',
        error: error.message || 'Activation failed. Please try again.',
        progress: 0,
      });
      
      setError({
        code: 'ACTIVATION_FAILED',
        message: error.message || 'Activation failed',
        timestamp: new Date(),
        recoverable: true,
      });
    }
  }, [lawArea, onActivated, setConsent, updateMedia, startSession, setStatus, setError]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);
  
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950/90 to-slate-900"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* Background effects */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <motion.div
            className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-cyan-500/10 blur-3xl"
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.1, 0.2, 0.1],
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
          <motion.div
            className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-indigo-500/10 blur-3xl"
            animate={{
              scale: [1, 1.1, 1],
              opacity: [0.1, 0.15, 0.1],
            }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: 2,
            }}
          />
        </div>
        
        {/* Content */}
        <div className="relative z-10 flex flex-col items-center px-4 max-w-2xl mx-auto text-center">
          {/* Lexara Picture */}
          <LexaraPicture
            imageSrc={lexaraImageSrc}
            audioLevel={0}
            isSpeaking={false}
            isListening={isActivating}
          />
          
          {/* Title */}
          <motion.h1
            className="mt-8 text-3xl md:text-4xl font-bold text-white"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            Meet <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-400">Lexara</span>
          </motion.h1>
          
          <motion.p
            className="mt-3 text-lg text-slate-300"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            Your AI Legal Consultation Assistant
          </motion.p>
          
          {/* Error display */}
          {activationState.error && (
            <motion.div
              className="mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 max-w-md"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <p className="text-red-300 text-sm">{activationState.error}</p>
              <button
                onClick={() => setActivationState({ step: 'idle', error: null, progress: 0 })}
                className="mt-2 text-red-400 hover:text-red-300 text-sm underline"
              >
                Try Again
              </button>
            </motion.div>
          )}
          
          {/* Activation Button */}
          {!activationState.error && (
            <div className="mt-10">
              <ActivationButton
                onClick={handleActivation}
                isActivating={isActivating}
                activationState={activationState}
              />
            </div>
          )}
          
          {/* Progress bar during activation */}
          {isActivating && (
            <motion.div
              className="mt-6 w-full max-w-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${activationState.progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </motion.div>
          )}
          
          {/* Legal Disclaimer */}
          <LegalDisclaimer />
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
