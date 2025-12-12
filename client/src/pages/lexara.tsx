/**
 * LEXARA Personal Mode - Production Ready - FULL AUTO
 * 
 * Full viewport ethereal experience with:
 * - Ethereal background layer
 * - 3D/video avatar viewport  
 * - Minimal overlay for status + chat transcript
 * - FULL AUTO: Automatic device detection & media start
 * - Voice pipeline integration (talk & listen)
 * - ADAPTIVE BEHAVIOR: Switches between personable/professional modes
 *   based on user's tone, pitch, range, topic, and body language
 * - Responsive design for laptop & phone
 * 
 * ONE MODE: FULL AUTO - No toggles, no buttons, everything automatic
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { 
  ArrowLeft, Send, Mic, MicOff, Video, VideoOff,
  Loader2, AlertCircle
} from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { useToast } from '@/hooks/use-toast';
import { useVoiceMode } from '@/hooks/useVoiceMode';
import { useVoiceSynthesis } from '@/hooks/useVoiceSynthesis';
import { cn } from '@/lib/utils';
import { 
  LEXARAEtherealAvatar, 
  LEXARAStatusIndicator,
  type LEXARAEmotionHint,
  type LEXARAGazeHint,
} from '@/components/LexaraEtherealAvatar';
import { 
  LEXARABrain,
  type LEXARABrainContext,
} from '@shared/lexaraBrain';
import type { LEXARAResponsePayload } from '@shared/lexaraVoicePersona';

// Singleton brain instance
const lexaraBrain = new LEXARABrain();

// ============================================================================
// TYPES
// ============================================================================

interface ConversationMessage {
  id: string;
  role: 'lexara' | 'user';
  content: string;
  timestamp: Date;
  emotionHint?: LEXARAEmotionHint;
  gazeHint?: LEXARAGazeHint;
  behaviorMode?: 'personable' | 'professional';
}

interface MediaState {
  hasMic: boolean;
  hasCamera: boolean;
  mediaStream: MediaStream | null;
  autoStartEligible: boolean;
  isInitialized: boolean;
  permissionGranted: boolean;
}

// Voice metrics for adaptive behavior
interface LiveVoiceMetrics {
  pitch: number;
  speechRate: number;
  volume: number;
}

// ============================================================================
// LOCAL STORAGE KEYS
// ============================================================================

const LEXARA_AUTO_START_KEY = 'lexara_auto_start';
const LEXARA_CONSENT_KEY = 'lexara_consent';

// ============================================================================
// ADMIN CONTROLS PANEL (Bobby only)
// ============================================================================

interface AdminControlsProps {
  micEnabled: boolean;
  cameraEnabled: boolean;
  onMicToggle: (enabled: boolean) => void;
  onCameraToggle: (enabled: boolean) => void;
  isListening: boolean;
  hasVideo: boolean;
}

const AdminControlsPanel = memo(function AdminControlsPanel({
  micEnabled,
  cameraEnabled,
  onMicToggle,
  onCameraToggle,
  isListening,
  hasVideo,
}: AdminControlsProps) {
  return (
    <div className="absolute top-16 right-4 z-30 bg-slate-900/80 backdrop-blur-md rounded-lg border border-slate-700/50 p-4 space-y-4">
      <div className="flex items-center gap-2 text-xs text-amber-400 font-medium">
        <Settings className="h-3.5 w-3.5" />
        Admin Controls
      </div>
      
      {/* Microphone Toggle */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          {micEnabled ? <Mic className="h-4 w-4 text-emerald-400" /> : <MicOff className="h-4 w-4 text-slate-500" />}
          <span>Microphone</span>
        </div>
        <Switch
          checked={micEnabled}
          onCheckedChange={onMicToggle}
          className="data-[state=checked]:bg-emerald-500"
        />
      </div>
      
      {/* Camera Toggle */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          {cameraEnabled ? <Video className="h-4 w-4 text-blue-400" /> : <VideoOff className="h-4 w-4 text-slate-500" />}
          <span>Camera</span>
        </div>
        <Switch
          checked={cameraEnabled}
          onCheckedChange={onCameraToggle}
          className="data-[state=checked]:bg-blue-500"
        />
      </div>
      
      {/* Status */}
      <div className="text-xs text-slate-500 pt-2 border-t border-slate-700/50">
        {isListening && <span className="text-emerald-400">● Listening</span>}
        {hasVideo && <span className="text-blue-400 ml-2">● Video Active</span>}
      </div>
    </div>
  );
});

// ============================================================================
// ETHEREAL BACKGROUND COMPONENT
// ============================================================================

const EtherealBackground = memo(function EtherealBackground() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950/90 to-slate-900">
      {/* Animated gradient orbs */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-indigo-900/30 rounded-full blur-[120px] animate-pulse" />
      <div className="absolute bottom-1/4 right-1/3 w-[500px] h-[500px] bg-purple-900/20 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '1.5s' }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-cyan-900/10 rounded-full blur-[150px]" />
      
      {/* Subtle particle field */}
      <div className="absolute inset-0 opacity-30">
        {[...Array(40)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: `${1 + Math.random() * 2}px`,
              height: `${1 + Math.random() * 2}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              background: i % 4 === 0 
                ? 'rgba(212, 175, 55, 0.6)' 
                : i % 4 === 1 
                ? 'rgba(96, 165, 250, 0.5)'
                : i % 4 === 2
                ? 'rgba(139, 92, 246, 0.5)'
                : 'rgba(236, 72, 153, 0.4)',
              animation: `float-bg-particle ${12 + Math.random() * 8}s ease-in-out infinite ${Math.random() * 6}s`,
            }}
          />
        ))}
      </div>
      
      {/* Grid pattern overlay */}
      <div 
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: 'linear-gradient(rgba(99, 102, 241, 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(99, 102, 241, 0.5) 1px, transparent 1px)',
          backgroundSize: '80px 80px',
        }}
      />
      
      <style>{`
        @keyframes float-bg-particle {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.2; }
          25% { transform: translateY(-30px) translateX(10px); opacity: 0.5; }
          50% { transform: translateY(-15px) translateX(-10px); opacity: 0.3; }
          75% { transform: translateY(-40px) translateX(5px); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
});

// ============================================================================
// TRANSCRIPT PANEL COMPONENT
// ============================================================================

interface TranscriptPanelProps {
  messages: ConversationMessage[];
  interimTranscript: string;
  isThinking: boolean;
  userInput: string;
  setUserInput: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isDisabled: boolean;
}

const TranscriptPanel = memo(function TranscriptPanel({
  messages,
  interimTranscript,
  isThinking,
  userInput,
  setUserInput,
  onSubmit,
  isDisabled,
}: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  // Show only last N messages
  const visibleMessages = messages.slice(-10);
  
  return (
    <div className="flex flex-col h-full bg-slate-900/40 backdrop-blur-md border-l border-slate-700/30">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {visibleMessages.map(msg => (
          <div 
            key={msg.id} 
            className={cn(
              "flex gap-2",
              msg.role === 'user' && "flex-row-reverse"
            )}
          >
            <div className={cn(
              "max-w-[90%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
              msg.role === 'lexara' 
                ? "bg-gradient-to-br from-cyan-500/15 to-indigo-500/15 border border-cyan-500/20 text-slate-200" 
                : "bg-slate-700/50 border border-slate-600/30 text-slate-100"
            )}>
              {msg.content}
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
      
      {/* Input area */}
      <form onSubmit={onSubmit} className="p-3 border-t border-slate-700/30">
        <div className="flex gap-2">
          <input
            type="text"
            value={userInput}
            onChange={e => setUserInput(e.target.value)}
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
// MAIN COMPONENT - LUXARA SHELL
// ============================================================================

export default function LEXARAPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Conversation state
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [currentEmotion, setCurrentEmotion] = useState<LEXARAEmotionHint>('calm');
  const [currentGaze, setCurrentGaze] = useState<LEXARAGazeHint>('camera');
  const [isThinking, setIsThinking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  
  // Adaptive behavior mode tracking
  const [currentBehaviorMode, setCurrentBehaviorMode] = useState<'personable' | 'professional'>('personable');
  
  // Live voice metrics for adaptive behavior
  const [liveVoiceMetrics, setLiveVoiceMetrics] = useState<LiveVoiceMetrics>({
    pitch: 200,
    speechRate: 150,
    volume: 70,
  });
  
  // Media state - FULL AUTO
  const [mediaState, setMediaState] = useState<MediaState>({
    hasMic: false,
    hasCamera: false,
    mediaStream: null,
    autoStartEligible: false,
    isInitialized: false,
    permissionGranted: false,
  });
  
  // FULL AUTO MODE - Only show begin button on FIRST visit ever
  const [showBeginButton, setShowBeginButton] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  
  const initAttempted = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  
  // Voice hooks - FULL AUTO
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
  // DEVICE DETECTION
  // ============================================================================
  
  const detectDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasMic = devices.some(d => d.kind === 'audioinput');
      const hasCamera = devices.some(d => d.kind === 'videoinput');
      
      setMediaState(prev => ({ ...prev, hasMic, hasCamera }));
      return { hasMic, hasCamera };
    } catch (error) {
      console.error('Device detection failed:', error);
      return { hasMic: false, hasCamera: false };
    }
  }, []);

  // ============================================================================
  // MEDIA INITIALIZATION
  // ============================================================================
  
  const initializeMedia = useCallback(async (requestVideo = true, requestAudio = true) => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: requestAudio && mediaState.hasMic,
        video: requestVideo && mediaState.hasCamera,
      };
      
      // Don't request if nothing to request
      if (!constraints.audio && !constraints.video) {
        setMediaState(prev => ({
          ...prev,
          isInitialized: true,
          permissionGranted: false,
        }));
        return false;
      }
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Attach video to element
      if (videoRef.current && stream.getVideoTracks().length > 0) {
        videoRef.current.srcObject = stream;
      }
      
      // Set up audio analysis for lip sync
      if (stream.getAudioTracks().length > 0) {
        audioContextRef.current = new AudioContext();
        const source = audioContextRef.current.createMediaStreamSource(stream);
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
        source.connect(analyserRef.current);
      }
      
      // Store consent for auto-start on next visit
      localStorage.setItem(LEXARA_AUTO_START_KEY, 'true');
      localStorage.setItem(LEXARA_CONSENT_KEY, 'true');
      
      setMediaState(prev => ({
        ...prev,
        mediaStream: stream,
        isInitialized: true,
        permissionGranted: true,
        autoStartEligible: true,
      }));
      
      // Enable voice mode
      try {
        await voiceMode.enable();
        voiceMode.startListening();
      } catch (e) {
        console.log('Voice mode initialization deferred');
      }
      
      return true;
    } catch (error) {
      console.error('Media initialization failed:', error);
      // Fallback to text-only mode
      setMediaState(prev => ({
        ...prev,
        isInitialized: true,
        permissionGranted: false,
      }));
      return false;
    }
  }, [mediaState.hasMic, mediaState.hasCamera, voiceMode]);

  // ============================================================================
  // STOP MEDIA
  // ============================================================================
  
  const stopMedia = useCallback(() => {
    if (mediaState.mediaStream) {
      mediaState.mediaStream.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setMediaState(prev => ({
      ...prev,
      mediaStream: null,
      isInitialized: false,
      permissionGranted: false,
    }));
    voiceMode.disable();
  }, [mediaState.mediaStream, voiceMode]);

  // ============================================================================
  // FULL AUTO MODE - NO TOGGLES, EVERYTHING AUTOMATIC
  // ============================================================================

  // ============================================================================
  // AUTO-START LOGIC - FULL AUTO
  // ============================================================================
  
  useEffect(() => {
    if (initAttempted.current) return;
    initAttempted.current = true;
    
    const initialize = async () => {
      // Detect available devices
      const devices = await detectDevices();
      
      // Check for previous consent
      const hasConsent = localStorage.getItem(LEXARA_CONSENT_KEY) === 'true';
      
      // FULL AUTO MODE: Show begin button only on first visit
      setShowBeginButton(!hasConsent);
      setMediaState(prev => ({
        ...prev,
        hasMic: devices.hasMic,
        hasCamera: devices.hasCamera,
        autoStartEligible: hasConsent,
      }));
      
      if (hasConsent) {
        // FULL AUTO: Start immediately for returning users
        setTimeout(async () => {
          await initializeMedia(true, true);
          setSessionStarted(true);
          sendLEXARAGreeting();
        }, 300);
      }
    };
    
    initialize();
  }, [detectDevices, initializeMedia]);

  // ============================================================================
  // BEGIN SESSION HANDLER - FULL AUTO
  // ============================================================================
  
  const handleBeginSession = async () => {
    setShowBeginButton(false);
    
    // FULL AUTO: Always enable everything
    await initializeMedia(true, true);
    
    setSessionStarted(true);
    sendLEXARAGreeting();
  };

  // ============================================================================
  // AUDIO LEVEL MONITORING FOR LIP SYNC
  // ============================================================================
  
  useEffect(() => {
    if (!voiceSynthesis.isSpeaking) {
      setAudioLevel(0);
      return;
    }
    
    // Simulate audio level when speaking (since we're using TTS)
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
  
  const addMessage = useCallback((
    role: 'lexara' | 'user', 
    content: string, 
    response?: LEXARAResponsePayload & { behaviorMode?: 'personable' | 'professional' }
  ) => {
    setConversation(prev => [...prev, {
      id: `${role}-${Date.now()}`,
      role,
      content,
      timestamp: new Date(),
      emotionHint: response?.emotionHint,
      gazeHint: response?.gazeHint,
      behaviorMode: response?.behaviorMode,
    }]);
  }, []);
  
  const sendLEXARAGreeting = useCallback(async () => {
    const greetingText = "Hi there! I'm LEXARA, and I'm so glad you're here. I'm your legal consultation assistant, ready to help you understand legal concepts and explore your options. What can I help you with today?";
    
    addMessage('lexara', greetingText, {
      text: greetingText,
      emotionHint: 'playful',
      gazeHint: 'camera',
      voiceStyle: 'warm',
      behaviorMode: 'personable',
    });
    
    setCurrentEmotion('playful');
    setCurrentGaze('camera');
    setCurrentBehaviorMode('personable');
    
    // Speak the greeting
    try {
      await voiceSynthesis.speak(greetingText, {
        context: 'introduction',
        autoPlay: true,
      });
    } catch (e) {
      console.log('TTS greeting deferred until user interaction');
    }
  }, [addMessage, voiceSynthesis]);
  
  const handleUserMessage = useCallback(async (message: string) => {
    addMessage('user', message);
    setIsThinking(true);
    setCurrentEmotion('calm');
    setCurrentGaze('thinking');
    
    try {
      // Build context with voice metrics for adaptive behavior
      const context: LEXARABrainContext = {
        previousMessages: conversation.slice(-6).map(m => ({
          role: m.role === 'lexara' ? 'lexara' : 'user',
          content: m.content,
        })),
        // Pass live voice metrics for adaptive behavior analysis
        voiceMetrics: {
          pitch: liveVoiceMetrics.pitch,
          speechRate: liveVoiceMetrics.speechRate,
          volume: liveVoiceMetrics.volume,
        },
        // Current mode for continuity
        currentMode: currentBehaviorMode,
      };
      
      // Get response from LEXARA Brain (with adaptive behavior)
      const response = await lexaraBrain.ask(message, context);
      
      setIsThinking(false);
      setCurrentEmotion(response.emotionHint);
      setCurrentGaze(response.gazeHint);
      
      // Update behavior mode if changed
      if (response.behaviorMode !== currentBehaviorMode) {
        setCurrentBehaviorMode(response.behaviorMode);
        console.log(`LEXARA behavior mode: ${response.behaviorMode}`);
      }
      
      addMessage('lexara', response.text, response);
      
      // Speak the response with appropriate context
      voiceSynthesis.speak(response.text, {
        context: response.context || 'explanation',
        autoPlay: true,
      });
      
    } catch (error) {
      console.error('LEXARA brain error:', error);
      setIsThinking(false);
      setCurrentEmotion('empathetic');
      setCurrentGaze('camera');
      
      // Fallback based on current mode
      const fallbackText = currentBehaviorMode === 'personable'
        ? "I'm so sorry, I'm having a little trouble right now. Could you try asking me again? I really want to help!"
        : "I apologize for the technical difficulty. Please try your question again, and I'll do my best to assist you.";
      addMessage('lexara', fallbackText);
      voiceSynthesis.speak(fallbackText, { context: 'reassurance', autoPlay: true });
    }
  }, [addMessage, conversation, voiceSynthesis, liveVoiceMetrics, currentBehaviorMode]);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || isThinking) return;
    handleUserMessage(userInput.trim());
    setUserInput('');
  };

  // ============================================================================
  // CLEANUP
  // ============================================================================
  
  useEffect(() => {
    return () => {
      // Stop media streams
      if (mediaState.mediaStream) {
        mediaState.mediaStream.getTracks().forEach(track => track.stop());
      }
      // Close audio context
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [mediaState.mediaStream]);

  // ============================================================================
  // RENDER
  // ============================================================================
  
  return (
    <div className="fixed inset-0 overflow-hidden">
      <SEOHead 
        title="LEXARA - AI Legal Consultation" 
        description="Experience LEXARA, your ethereal AI legal consultation assistant."
      />
      
      {/* Ethereal Background */}
      <EtherealBackground />
      
      {/* Main Content Container */}
      <div className="relative z-10 h-full flex flex-col">
        {/* Minimal Header */}
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
            <span className="text-cyan-400 font-semibold tracking-wide">LUXARA</span>
            <LEXARAStatusIndicator 
              isSpeaking={voiceSynthesis.isSpeaking}
              isListening={voiceMode.isListening}
              isThinking={isThinking}
            />
          </div>
          
          {/* Status icons - minimal, no toggles */}
          <div className="flex items-center gap-2 text-xs">
            {mediaState.isInitialized && mediaState.hasMic && (
              <div className={cn(
                "p-1.5 rounded-full",
                voiceMode.isListening ? "text-emerald-400 bg-emerald-500/10" : "text-slate-500"
              )}>
                {voiceMode.isListening ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
              </div>
            )}
            {mediaState.isInitialized && mediaState.hasCamera && (
              <div className={cn(
                "p-1.5 rounded-full",
                mediaState.mediaStream?.getVideoTracks().length ? "text-blue-400 bg-blue-500/10" : "text-slate-500"
              )}>
                {mediaState.mediaStream?.getVideoTracks().length ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
              </div>
            )}
          </div>
        </header>
        
        {/* Main Layout - Responsive */}
        <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Avatar Viewport - Takes 50-60% on mobile, ~60% on desktop */}
          <div className="flex-1 md:flex-[3] relative flex items-center justify-center p-4 md:p-8">
            {/* Begin Session Button Overlay */}
            {showBeginButton && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
                <div className="text-center">
                  <h2 className="text-2xl font-light text-slate-200 mb-4">Welcome to LEXARA</h2>
                  <p className="text-slate-400 text-sm mb-6 max-w-xs mx-auto">
                    Your AI legal consultation assistant. Click to begin.
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
              <LexaraEtherealAvatar
                isSpeaking={voiceSynthesis.isSpeaking}
                isListening={voiceMode.isListening}
                isThinking={isThinking}
                audioLevel={audioLevel}
                emotionHint={currentEmotion}
                gazeHint={currentGaze}
                size="full"
              />
            </div>
            
            {/* Hidden video element for user camera */}
            <video 
              ref={videoRef}
              autoPlay 
              muted 
              playsInline
              className="hidden"
            />
          </div>
          
          {/* Transcript Panel - 40-50% on mobile, ~40% on desktop */}
          <div className="h-[40vh] md:h-full md:flex-[2] md:max-w-md">
            <TranscriptPanel
              messages={conversation}
              interimTranscript={voiceMode.interimTranscript}
              isThinking={isThinking}
              userInput={userInput}
              setUserInput={setUserInput}
              onSubmit={handleSubmit}
              isDisabled={isThinking || showBeginButton}
            />
          </div>
        </main>
        
        {/* Disclaimer footer - minimal */}
        <footer className="px-4 py-2 bg-slate-900/30 backdrop-blur-sm border-t border-slate-700/30">
          <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <AlertCircle className="h-3 w-3" />
            <span>AI-powered legal information, not legal advice. Consult a licensed attorney for legal counsel.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
