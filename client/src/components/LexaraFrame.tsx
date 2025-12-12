/**
 * LEXARA Frame Component
 * 
 * Full-viewport interface for LEXARA AI Legal Consultation.
 * 
 * Features:
 * - Renders centered on all devices
 * - Auto-detects available webcam + microphone
 * - Auto-initializes speech input + output without toggles
 * - Contains dynamic container for LexaraAvatar
 * - Mode transitions: default, analysis, satelliteMode, peopleRadarMode, inmateMode, docGenMode
 * - Animated mode transitions
 */

import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useVoiceMode } from '@/hooks/useVoiceMode';
import { useVoiceSynthesis } from '@/hooks/useVoiceSynthesis';
import { SEOHead } from '@/components/SEOHead';
import {
  ArrowLeft,
  Send,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Loader2,
  AlertCircle,
  MapPin,
  Satellite,
  X,
  Maximize2,
  Minimize2,
  Users,
  FileText,
  Search,
  BarChart2,
} from 'lucide-react';

import { LexaraAvatar } from './lexara/LexaraAvatar';
import {
  getLexaraStateManager,
  type LexaraMode,
  type LexaraEmotionState,
  type ModeOffer,
} from './lexara/LexaraState';
import { getLexaraSpeech, lexaraSpeak } from './lexara/LexaraSpeech';
import {
  LEXARABrain,
  type LEXARABrainContext,
} from '@shared/lexaraBrain';

// ============================================================================
// CONSTANTS
// ============================================================================

const LEXARA_CONSENT_KEY = 'lexara_frame_auto_start';

// Singleton brain instance
const lexaraBrain = new LEXARABrain();

// Mode display configurations
const MODE_CONFIGS: Record<LexaraMode, {
  label: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
}> = {
  default: {
    label: 'Default',
    icon: Search,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
  },
  analysis: {
    label: 'Analysis',
    icon: BarChart2,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
  },
  satelliteMode: {
    label: 'Satellite',
    icon: Satellite,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
  },
  peopleRadarMode: {
    label: 'People Radar',
    icon: Users,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
  },
  inmateMode: {
    label: 'Inmate Locator',
    icon: Search,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
  },
  docGenMode: {
    label: 'Document Gen',
    icon: FileText,
    color: 'text-rose-400',
    bgColor: 'bg-rose-500/10',
  },
};

// ============================================================================
// PROPS
// ============================================================================

export interface LexaraFrameProps {
  mode?: LexaraMode;
  onModeChange?: (mode: LexaraMode) => void;
  className?: string;
}

// ============================================================================
// TYPES
// ============================================================================

interface ConversationMessage {
  id: string;
  role: 'lexara' | 'user';
  content: string;
  timestamp: Date;
  modeOffer?: ModeOffer | null;
}

interface MediaState {
  hasMic: boolean;
  hasCamera: boolean;
  mediaStream: MediaStream | null;
  isInitialized: boolean;
  permissionGranted: boolean;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/**
 * Ethereal background with animated particles
 */
const EtherealBackground = memo(function EtherealBackground() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden">
      {/* Base gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-indigo-950/90 to-slate-900" />

      {/* Subtle particle field */}
      <div className="absolute inset-0 opacity-30">
        <div
          className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-cyan-500/10 blur-3xl animate-pulse"
          style={{ animationDuration: '8s' }}
        />
        <div
          className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-indigo-500/10 blur-3xl animate-pulse"
          style={{ animationDuration: '10s', animationDelay: '2s' }}
        />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-purple-500/5 blur-3xl" />
      </div>

      {/* Subtle shimmer effect */}
      <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/[0.02] to-transparent" />
    </div>
  );
});

/**
 * Live video panel (picture-in-picture style)
 */
const LiveVideoPanel = memo(function LiveVideoPanel({
  videoRef,
  isActive,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  isActive: boolean;
}) {
  return (
    <div
      className={cn(
        'absolute bottom-4 left-4 w-32 h-24 md:w-40 md:h-30 rounded-xl overflow-hidden border-2 transition-all duration-300 z-20',
        isActive
          ? 'border-cyan-500/50 shadow-lg shadow-cyan-500/20'
          : 'border-slate-700/50 opacity-50'
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-cover bg-slate-900"
      />
      {!isActive && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80">
          <VideoOff className="h-6 w-6 text-slate-500" />
        </div>
      )}
    </div>
  );
});

/**
 * Mode indicator badge
 */
const ModeIndicator = memo(function ModeIndicator({
  mode,
  onModeChange,
}: {
  mode: LexaraMode;
  onModeChange?: (mode: LexaraMode) => void;
}) {
  const config = MODE_CONFIGS[mode];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
        config.color,
        config.bgColor,
        'border-current/20'
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{config.label}</span>
    </div>
  );
});

/**
 * Message panel for conversation
 */
const MessagePanel = memo(function MessagePanel({
  messages,
  interimTranscript,
  isThinking,
  userInput,
  setUserInput,
  onSubmit,
  onAcceptModeOffer,
  isDisabled,
}: {
  messages: ConversationMessage[];
  interimTranscript: string;
  isThinking: boolean;
  userInput: string;
  setUserInput: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onAcceptModeOffer: (mode: LexaraMode) => void;
  isDisabled: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, interimTranscript]);

  return (
    <div className="flex flex-col h-full bg-slate-900/60 backdrop-blur-sm border-l border-slate-700/30">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700/30">
        <h2 className="text-sm font-semibold text-slate-200">Conversation</h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn('flex gap-2', msg.role === 'user' && 'flex-row-reverse')}
          >
            <div
              className={cn(
                'max-w-[90%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                msg.role === 'lexara'
                  ? 'bg-gradient-to-br from-cyan-500/15 to-indigo-500/15 border border-cyan-500/20 text-slate-200'
                  : 'bg-slate-700/50 border border-slate-600/30 text-slate-100'
              )}
            >
              {msg.content}

              {/* Mode offer button */}
              {msg.modeOffer && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full text-xs border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                  onClick={() => onAcceptModeOffer(msg.modeOffer!.suggestedMode)}
                >
                  <MapPin className="h-3 w-3 mr-1" />
                  Switch to {MODE_CONFIGS[msg.modeOffer.suggestedMode].label}
                </Button>
              )}
            </div>
          </div>
        ))}

        {/* Thinking indicator */}
        {isThinking && (
          <div className="flex gap-2">
            <div className="bg-amber-500/15 border border-amber-500/20 rounded-2xl px-4 py-2.5 flex items-center gap-2 text-amber-300 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking...
            </div>
          </div>
        )}

        {/* Interim transcript */}
        {interimTranscript && (
          <div className="flex gap-2 flex-row-reverse">
            <div className="bg-slate-700/30 border border-slate-600/20 rounded-2xl px-4 py-2 text-slate-400 text-sm italic">
              {interimTranscript}...
            </div>
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      {/* Input */}
      <form onSubmit={onSubmit} className="p-3 border-t border-slate-700/30">
        <div className="flex gap-2">
          <input
            type="text"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="Type or speak..."
            className="flex-1 bg-slate-800/60 border border-slate-700/50 text-slate-100 rounded-full px-4 py-2 text-sm focus:outline-none focus:border-cyan-500/50 placeholder:text-slate-500"
            disabled={isDisabled}
          />
          <Button
            type="submit"
            disabled={!userInput.trim() || isDisabled}
            size="sm"
            className="rounded-full bg-cyan-600 hover:bg-cyan-500 px-4"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
});

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function LexaraFrame({
  mode: propMode,
  onModeChange,
  className,
}: LexaraFrameProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // State manager
  const stateManager = getLexaraStateManager();

  // Conversation state
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [currentEmotion, setCurrentEmotion] = useState<LexaraEmotionState>('curious');
  const [isThinking, setIsThinking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  // Mode state
  const [currentMode, setCurrentMode] = useState<LexaraMode>(propMode || 'default');
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Media state
  const [mediaState, setMediaState] = useState<MediaState>({
    hasMic: false,
    hasCamera: false,
    mediaStream: null,
    isInitialized: false,
    permissionGranted: false,
  });

  // Session state
  const [showBeginButton, setShowBeginButton] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);

  const initAttempted = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Voice hooks
  const voiceMode = useVoiceMode({
    continuous: true,
    interimResults: true,
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        handleUserMessage(text.trim());
      }
    },
  });

  const voiceSynthesis = useVoiceSynthesis();

  // ============================================================================
  // MODE TRANSITION
  // ============================================================================

  const transitionToMode = useCallback(
    (newMode: LexaraMode) => {
      if (newMode === currentMode) return;

      setIsTransitioning(true);

      // Update state manager
      stateManager.nextMode(newMode, 'User requested mode change');

      // Animate transition
      setTimeout(() => {
        setCurrentMode(newMode);
        setIsTransitioning(false);
        onModeChange?.(newMode);
      }, 300);
    },
    [currentMode, stateManager, onModeChange]
  );

  // Sync mode from props
  useEffect(() => {
    if (propMode && propMode !== currentMode) {
      transitionToMode(propMode);
    }
  }, [propMode, currentMode, transitionToMode]);

  // ============================================================================
  // DEVICE DETECTION
  // ============================================================================

  const detectDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasMic = devices.some((d) => d.kind === 'audioinput');
      const hasCamera = devices.some((d) => d.kind === 'videoinput');
      return { hasMic, hasCamera };
    } catch (e) {
      console.log('Device detection failed:', e);
      return { hasMic: false, hasCamera: false };
    }
  }, []);

  // ============================================================================
  // MEDIA INITIALIZATION
  // ============================================================================

  const initializeMedia = useCallback(
    async (enableVideo: boolean, enableAudio: boolean) => {
      try {
        const constraints: MediaStreamConstraints = {
          video: enableVideo,
          audio: enableAudio,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        // Attach to video element
        if (videoRef.current && enableVideo) {
          videoRef.current.srcObject = stream;
        }

        setMediaState((prev) => ({
          ...prev,
          mediaStream: stream,
          isInitialized: true,
          permissionGranted: true,
        }));

        // Store consent
        localStorage.setItem(LEXARA_CONSENT_KEY, 'true');

        // Start voice mode
        if (enableAudio) {
          try {
            await voiceMode.enable();
            voiceMode.startListening();
          } catch (e) {
            console.log('Voice mode start deferred');
          }
        }

        return true;
      } catch (error: unknown) {
        console.error('Media initialization failed:', error);

        // Fallback: try audio only
        if (enableVideo && enableAudio) {
          return initializeMedia(false, true);
        }

        // Fallback: text only
        setMediaState((prev) => ({
          ...prev,
          isInitialized: true,
          permissionGranted: false,
        }));

        toast({
          title: 'Media Access',
          description: 'Running in text-only mode. Voice features unavailable.',
          variant: 'default',
        });

        return false;
      }
    },
    [toast, voiceMode]
  );

  // ============================================================================
  // AUTO-START LOGIC
  // ============================================================================

  useEffect(() => {
    if (initAttempted.current) return;
    initAttempted.current = true;

    const initialize = async () => {
      const devices = await detectDevices();
      const hasConsent = localStorage.getItem(LEXARA_CONSENT_KEY) === 'true';

      setShowBeginButton(!hasConsent);
      setMediaState((prev) => ({
        ...prev,
        hasMic: devices.hasMic,
        hasCamera: devices.hasCamera,
      }));

      if (hasConsent) {
        // Auto-start
        setTimeout(async () => {
          await initializeMedia(true, true);
          setSessionStarted(true);
          sendGreeting();
        }, 300);
      }
    };

    initialize();
  }, [detectDevices, initializeMedia]);

  // ============================================================================
  // BEGIN SESSION
  // ============================================================================

  const handleBeginSession = async () => {
    setShowBeginButton(false);
    await initializeMedia(true, true);
    setSessionStarted(true);
    sendGreeting();
  };

  // ============================================================================
  // AUDIO LEVEL MONITORING
  // ============================================================================

  useEffect(() => {
    if (!voiceSynthesis.isSpeaking) {
      setAudioLevel(0);
      return;
    }

    const interval = setInterval(() => {
      setAudioLevel(0.3 + Math.random() * 0.5);
    }, 80);

    return () => {
      clearInterval(interval);
      setAudioLevel(0);
    };
  }, [voiceSynthesis.isSpeaking]);

  // ============================================================================
  // CONVERSATION HANDLERS
  // ============================================================================

  const addMessage = useCallback(
    (
      role: 'lexara' | 'user',
      content: string,
      modeOffer?: ModeOffer | null
    ) => {
      setConversation((prev) => [
        ...prev,
        {
          id: `${role}-${Date.now()}`,
          role,
          content,
          timestamp: new Date(),
          modeOffer,
        },
      ]);
    },
    []
  );

  const sendGreeting = useCallback(async () => {
    const greetingText =
      "Hi there! I'm LEXARA, your AI legal consultation assistant. I'm here to help you understand legal concepts and explore your options. What can I help you with today?";

    addMessage('lexara', greetingText);
    setCurrentEmotion('curious');

    try {
      await voiceSynthesis.speak(greetingText, {
        context: 'introduction',
        autoPlay: true,
      });
    } catch (e) {
      console.log('TTS greeting deferred until user interaction');
    }
  }, [addMessage, voiceSynthesis]);

  const handleUserMessage = useCallback(
    async (message: string) => {
      addMessage('user', message);
      setIsThinking(true);
      setCurrentEmotion('focused');

      // Add context to state manager
      stateManager.addConversationContext(message);

      // Check for mode offer
      const modeOffer = stateManager.offerMode(message);

      try {
        const context: LEXARABrainContext = {
          previousMessages: conversation.slice(-6).map((m) => ({
            role: m.role === 'lexara' ? 'lexara' : 'user',
            content: m.content,
          })),
        };

        const response = await lexaraBrain.ask(message, context);

        setIsThinking(false);

        // Map emotion hint to LexaraEmotionState
        const emotionMap: Record<string, LexaraEmotionState> = {
          calm: 'curious',
          playful: 'curious',
          serious: 'focused',
          empathetic: 'empathetic',
          protective: 'alert',
          authoritative: 'focused',
        };
        setCurrentEmotion(emotionMap[response.emotionHint] || 'curious');

        // Add response with mode offer if relevant
        if (modeOffer && modeOffer.confidence > 0.3) {
          const offerText =
            response.text + ' ' + modeOffer.reason;
          addMessage('lexara', offerText, modeOffer);
        } else {
          addMessage('lexara', response.text);
        }

        // Map LEXARA context to valid SpeechContext
        const contextMap: Record<string, 'explanation' | 'guidance' | 'reassurance' | 'introduction' | 'evaluation'> = {
          greeting: 'introduction',
          explanation: 'explanation',
          guidance: 'guidance',
          reassurance: 'reassurance',
          serious: 'evaluation',
          casual: 'explanation',
          protective: 'reassurance',
        };
        const speechContext = contextMap[response.context || ''] || 'explanation';

        voiceSynthesis.speak(response.text, {
          context: speechContext,
          autoPlay: true,
        });
      } catch (error) {
        console.error('LEXARA brain error:', error);
        setIsThinking(false);
        setCurrentEmotion('empathetic');

        const fallbackText =
          "I'm so sorry, I'm having a little trouble right now. Could you try asking me again?";
        addMessage('lexara', fallbackText);
        voiceSynthesis.speak(fallbackText, {
          context: 'reassurance',
          autoPlay: true,
        });
      }
    },
    [addMessage, conversation, voiceSynthesis, stateManager]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || isThinking) return;
    handleUserMessage(userInput.trim());
    setUserInput('');
  };

  const handleAcceptModeOffer = (mode: LexaraMode) => {
    transitionToMode(mode);

    const responseText = `Switching to ${MODE_CONFIGS[mode].label} mode. How can I help you?`;
    addMessage('lexara', responseText);
    voiceSynthesis.speak(responseText, {
      context: 'explanation',
      autoPlay: true,
    });
  };

  // ============================================================================
  // CLEANUP
  // ============================================================================

  useEffect(() => {
    return () => {
      if (mediaState.mediaStream) {
        mediaState.mediaStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [mediaState.mediaStream]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className={cn('fixed inset-0 overflow-hidden', className)}>
      <SEOHead
        title="LEXARA - AI Legal Consultation"
        description="Experience LEXARA, your ethereal AI legal consultation assistant with voice interaction."
      />

      {/* Ethereal Background */}
      <EtherealBackground />

      {/* Main Content */}
      <div className="relative z-10 h-full flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 bg-slate-900/30 backdrop-blur-sm border-b border-slate-700/30">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation('/')}
            className="text-slate-400 hover:text-slate-100"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>

          <div className="flex items-center gap-3">
            <span className="text-cyan-400 font-semibold tracking-wide">LEXARA</span>
            <ModeIndicator mode={currentMode} onModeChange={transitionToMode} />
          </div>

          {/* Status icons */}
          <div className="flex items-center gap-2 text-xs">
            {mediaState.isInitialized && mediaState.hasMic && (
              <div
                className={cn(
                  'p-1.5 rounded-full',
                  voiceMode.isListening
                    ? 'text-emerald-400 bg-emerald-500/10'
                    : 'text-slate-500'
                )}
              >
                {voiceMode.isListening ? (
                  <Mic className="h-3.5 w-3.5" />
                ) : (
                  <MicOff className="h-3.5 w-3.5" />
                )}
              </div>
            )}
            {mediaState.isInitialized && mediaState.hasCamera && (
              <div
                className={cn(
                  'p-1.5 rounded-full',
                  mediaState.mediaStream?.getVideoTracks().length
                    ? 'text-blue-400 bg-blue-500/10'
                    : 'text-slate-500'
                )}
              >
                {mediaState.mediaStream?.getVideoTracks().length ? (
                  <Video className="h-3.5 w-3.5" />
                ) : (
                  <VideoOff className="h-3.5 w-3.5" />
                )}
              </div>
            )}
          </div>
        </header>

        {/* Main Layout */}
        <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Avatar Viewport */}
          <div
            className={cn(
              'flex-1 md:flex-[3] relative flex items-center justify-center p-4 md:p-8 transition-all duration-300',
              isTransitioning && 'opacity-50 scale-95'
            )}
          >
            {/* Begin Session Overlay */}
            {showBeginButton && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
                <div className="text-center">
                  <h2 className="text-2xl font-light text-slate-200 mb-4">
                    Welcome to LEXARA
                  </h2>
                  <p className="text-slate-400 text-sm mb-6 max-w-xs mx-auto">
                    Your AI legal consultation assistant with voice interaction.
                  </p>
                  <Button
                    onClick={handleBeginSession}
                    size="lg"
                    className="bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white px-8 py-3 rounded-full font-medium shadow-lg hover:shadow-xl transition-all"
                  >
                    Begin Session
                  </Button>
                </div>
              </div>
            )}

            {/* Avatar */}
            <div className="w-full h-full max-w-lg max-h-[600px] relative">
              <LexaraAvatar
                isSpeaking={voiceSynthesis.isSpeaking}
                isListening={voiceMode.isListening}
                isThinking={isThinking}
                audioLevel={audioLevel}
                emotion={currentEmotion}
                size="full"
              />
            </div>

            {/* Live Video Panel (PiP) */}
            <LiveVideoPanel
              videoRef={videoRef}
              isActive={!!mediaState.mediaStream?.getVideoTracks().length}
            />
          </div>

          {/* Message Panel */}
          <div className="h-[40vh] md:h-full md:flex-[2] md:max-w-md">
            <MessagePanel
              messages={conversation}
              interimTranscript={voiceMode.interimTranscript}
              isThinking={isThinking}
              userInput={userInput}
              setUserInput={setUserInput}
              onSubmit={handleSubmit}
              onAcceptModeOffer={handleAcceptModeOffer}
              isDisabled={isThinking || showBeginButton}
            />
          </div>
        </main>

        {/* Disclaimer Footer */}
        <footer className="px-4 py-2 bg-slate-900/30 backdrop-blur-sm border-t border-slate-700/30">
          <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <AlertCircle className="h-3 w-3" />
            <span>
              AI-powered legal information, not legal advice. Consult a licensed
              attorney for legal counsel.
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
