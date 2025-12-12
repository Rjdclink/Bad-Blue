/**
 * LEXARA VIEWPORT - Production Full-Page Interface
 * 
 * FULL AUTO MODE - No toggles, everything automatic
 * 
 * Components:
 * 1. Live Video Panel - User camera feed
 * 2. Audio I/O Engine - Mic input + speaker output
 * 3. Speech Synthesis Module - Feminine HD voice (TTS)
 * 4. Message/Action Panel - Chat transcript + input
 * 5. Dynamic Overlay Layer - Satellite/GPS feeds (GeoConsole)
 * 
 * GEO BEHAVIOR:
 * - Relevance check: If task involves location → LEXARA OFFERS
 * - Direct request: If user asks for map → LEXARA PROVIDES
 * - Never auto-opens geo viewport without offer/request
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { 
  ArrowLeft, Send, Mic, MicOff, Video, VideoOff,
  Loader2, AlertCircle, MapPin, Satellite, X, Maximize2, Minimize2
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

// ============================================================================
// CONSTANTS
// ============================================================================

const LEXARA_CONSENT_KEY = 'lexara_auto_start';

// Keywords that indicate geo-relevance
const GEO_RELEVANT_KEYWORDS = [
  'where is', 'location', 'locate', 'track', 'find',
  'gps', 'coordinates', 'address', 'map', 'satellite',
  'position', 'last known', 'movement', 'trail', 'heatmap',
  'people radar', 'nearby', 'distance', 'route', 'directions',
  'incident place', 'crime scene', 'witness location'
];

// Keywords that trigger immediate geo display
const GEO_REQUEST_KEYWORDS = [
  'show map', 'show the map', 'show satellite', 'show location',
  'show radar', 'show trail', 'show heatmap', 'people radar',
  'open map', 'open satellite', 'display map', 'display location',
  'see the map', 'view map', 'view location', 'show me the map',
  'show me where', 'show their location', 'show my location'
];

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
  geoOffer?: boolean; // True if this message offers geo view
}

interface MediaState {
  hasMic: boolean;
  hasCamera: boolean;
  mediaStream: MediaStream | null;
  autoStartEligible: boolean;
  isInitialized: boolean;
  permissionGranted: boolean;
}

interface GeoState {
  isVisible: boolean;
  isMaximized: boolean;
  mode: 'pin' | 'trail' | 'heatmap' | 'radar';
  coordinates: { lat: number; lng: number } | null;
  locationData: any | null;
  hasOffered: boolean; // Track if we've already offered geo view for current context
}

interface LiveVoiceMetrics {
  pitch: number;
  speechRate: number;
  volume: number;
}

// ============================================================================
// GEO RELEVANCE DETECTOR
// ============================================================================

function detectGeoRelevance(text: string): boolean {
  const lowerText = text.toLowerCase();
  return GEO_RELEVANT_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

function detectGeoRequest(text: string): boolean {
  const lowerText = text.toLowerCase();
  return GEO_REQUEST_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

function determineGeoMode(text: string): GeoState['mode'] {
  const lowerText = text.toLowerCase();
  if (lowerText.includes('trail') || lowerText.includes('movement') || lowerText.includes('history')) {
    return 'trail';
  }
  if (lowerText.includes('heatmap') || lowerText.includes('heat map')) {
    return 'heatmap';
  }
  if (lowerText.includes('radar') || lowerText.includes('people radar') || lowerText.includes('nearby')) {
    return 'radar';
  }
  return 'pin';
}

// ============================================================================
// ETHEREAL BACKGROUND
// ============================================================================

const EtherealBackground = memo(function EtherealBackground() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden">
      {/* Base gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-indigo-950/90 to-slate-900" />
      
      {/* Subtle particle field - very low intensity */}
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-cyan-500/10 blur-3xl animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-indigo-500/10 blur-3xl animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-purple-500/5 blur-3xl" />
      </div>
      
      {/* Subtle shimmer effect */}
      <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/[0.02] to-transparent" />
    </div>
  );
});

// ============================================================================
// GEO CONSOLE OVERLAY
// ============================================================================

interface GeoConsoleOverlayProps {
  geoState: GeoState;
  onClose: () => void;
  onToggleMaximize: () => void;
}

const GeoConsoleOverlay = memo(function GeoConsoleOverlay({
  geoState,
  onClose,
  onToggleMaximize,
}: GeoConsoleOverlayProps) {
  if (!geoState.isVisible) return null;
  
  const modeLabels = {
    pin: 'Location Pin',
    trail: 'Movement Trail',
    heatmap: 'Activity Heatmap',
    radar: 'People Radar',
  };
  
  return (
    <div className={cn(
      "absolute z-30 bg-slate-900/95 backdrop-blur-md border border-cyan-500/30 rounded-xl overflow-hidden shadow-2xl transition-all duration-300",
      geoState.isMaximized 
        ? "inset-4" 
        : "bottom-4 right-4 w-80 h-64 md:w-96 md:h-80"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/50 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <Satellite className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-medium text-slate-200">{modeLabels[geoState.mode]}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-slate-200"
            onClick={onToggleMaximize}
          >
            {geoState.isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-slate-200"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      {/* Map Content */}
      <div className="relative flex-1 h-full">
        {geoState.coordinates ? (
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Placeholder for actual map integration */}
            <div className="text-center">
              <MapPin className="h-12 w-12 text-cyan-400 mx-auto mb-2" />
              <p className="text-sm text-slate-300">
                {geoState.mode === 'pin' && 'Location Pinned'}
                {geoState.mode === 'trail' && 'Movement Trail Active'}
                {geoState.mode === 'heatmap' && 'Heatmap Rendering'}
                {geoState.mode === 'radar' && 'People Radar Scanning'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {geoState.coordinates.lat.toFixed(6)}, {geoState.coordinates.lng.toFixed(6)}
              </p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="h-8 w-8 text-cyan-400 mx-auto mb-2 animate-spin" />
              <p className="text-sm text-slate-400">Acquiring location data...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// ============================================================================
// LIVE VIDEO PANEL
// ============================================================================

interface LiveVideoPanelProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  isActive: boolean;
}

const LiveVideoPanel = memo(function LiveVideoPanel({
  videoRef,
  isActive,
}: LiveVideoPanelProps) {
  return (
    <div className={cn(
      "absolute bottom-4 left-4 w-32 h-24 md:w-40 md:h-30 rounded-xl overflow-hidden border-2 transition-all duration-300 z-20",
      isActive 
        ? "border-cyan-500/50 shadow-lg shadow-cyan-500/20" 
        : "border-slate-700/50 opacity-50"
    )}>
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

// ============================================================================
// MESSAGE PANEL
// ============================================================================

interface MessagePanelProps {
  messages: ConversationMessage[];
  interimTranscript: string;
  isThinking: boolean;
  userInput: string;
  setUserInput: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onGeoAccept: () => void;
  isDisabled: boolean;
}

const MessagePanel = memo(function MessagePanel({
  messages,
  interimTranscript,
  isThinking,
  userInput,
  setUserInput,
  onSubmit,
  onGeoAccept,
  isDisabled,
}: MessagePanelProps) {
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
              
              {/* Geo offer button */}
              {msg.geoOffer && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full text-xs border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                  onClick={onGeoAccept}
                >
                  <MapPin className="h-3 w-3 mr-1" />
                  Show Map View
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
// MAIN COMPONENT - LEXARA VIEWPORT
// ============================================================================

export default function LexaraViewport() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Conversation state
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [currentEmotion, setCurrentEmotion] = useState<LEXARAEmotionHint>('calm');
  const [currentGaze, setCurrentGaze] = useState<LEXARAGazeHint>('camera');
  const [isThinking, setIsThinking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  
  // Adaptive behavior mode
  const [currentBehaviorMode, setCurrentBehaviorMode] = useState<'personable' | 'professional'>('personable');
  
  // Live voice metrics
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
  
  // Geo state
  const [geoState, setGeoState] = useState<GeoState>({
    isVisible: false,
    isMaximized: false,
    mode: 'pin',
    coordinates: null,
    locationData: null,
    hasOffered: false,
  });
  
  // Session state
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
      return { hasMic, hasCamera };
    } catch (e) {
      console.log('Device detection failed:', e);
      return { hasMic: false, hasCamera: false };
    }
  }, []);

  // ============================================================================
  // MEDIA INITIALIZATION - FULL AUTO
  // ============================================================================
  
  const initializeMedia = useCallback(async (enableVideo: boolean, enableAudio: boolean) => {
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
      
      // Setup audio context for voice analysis
      if (enableAudio) {
        try {
          audioContextRef.current = new AudioContext();
          analyserRef.current = audioContextRef.current.createAnalyser();
          const source = audioContextRef.current.createMediaStreamSource(stream);
          source.connect(analyserRef.current);
        } catch (e) {
          console.log('Audio context setup failed:', e);
        }
      }
      
      setMediaState(prev => ({
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
    } catch (error: any) {
      console.error('Media initialization failed:', error);
      
      // Fallback: try audio only
      if (enableVideo && enableAudio) {
        return initializeMedia(false, true);
      }
      
      // Fallback: text only
      setMediaState(prev => ({
        ...prev,
        isInitialized: true,
        permissionGranted: false,
      }));
      
      toast({
        title: "Media Access",
        description: "Running in text-only mode. Voice features unavailable.",
        variant: "default",
      });
      
      return false;
    }
  }, [toast, voiceMode]);

  // ============================================================================
  // GEO FUNCTIONS
  // ============================================================================
  
  const acquireLocation = useCallback(async () => {
    return new Promise<{ lat: number; lng: number } | null>((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }, []);
  
  const openGeoConsole = useCallback(async (mode: GeoState['mode'] = 'pin') => {
    setGeoState(prev => ({
      ...prev,
      isVisible: true,
      mode,
    }));
    
    // Acquire location if not already available
    if (!geoState.coordinates) {
      const coords = await acquireLocation();
      setGeoState(prev => ({
        ...prev,
        coordinates: coords,
      }));
    }
  }, [acquireLocation, geoState.coordinates]);
  
  const closeGeoConsole = useCallback(() => {
    setGeoState(prev => ({
      ...prev,
      isVisible: false,
      isMaximized: false,
    }));
  }, []);
  
  const toggleGeoMaximize = useCallback(() => {
    setGeoState(prev => ({
      ...prev,
      isMaximized: !prev.isMaximized,
    }));
  }, []);
  
  const handleGeoAccept = useCallback(() => {
    openGeoConsole(geoState.mode);
  }, [openGeoConsole, geoState.mode]);

  // ============================================================================
  // AUTO-START LOGIC - FULL AUTO
  // ============================================================================
  
  useEffect(() => {
    if (initAttempted.current) return;
    initAttempted.current = true;
    
    const initialize = async () => {
      const devices = await detectDevices();
      const hasConsent = localStorage.getItem(LEXARA_CONSENT_KEY) === 'true';
      
      setShowBeginButton(!hasConsent);
      setMediaState(prev => ({
        ...prev,
        hasMic: devices.hasMic,
        hasCamera: devices.hasCamera,
        autoStartEligible: hasConsent,
      }));
      
      if (hasConsent) {
        // FULL AUTO: Start immediately
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
  // BEGIN SESSION - FULL AUTO
  // ============================================================================
  
  const handleBeginSession = async () => {
    setShowBeginButton(false);
    await initializeMedia(true, true);
    setSessionStarted(true);
    sendLEXARAGreeting();
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
  
  const addMessage = useCallback((
    role: 'lexara' | 'user', 
    content: string, 
    options?: {
      emotionHint?: LEXARAEmotionHint;
      gazeHint?: LEXARAGazeHint;
      behaviorMode?: 'personable' | 'professional';
      geoOffer?: boolean;
    }
  ) => {
    setConversation(prev => [...prev, {
      id: `${role}-${Date.now()}`,
      role,
      content,
      timestamp: new Date(),
      ...options,
    }]);
  }, []);
  
  const sendLEXARAGreeting = useCallback(async () => {
    const greetingText = "Hi there! I'm LEXARA, your AI legal consultation assistant. I'm here to help you understand legal concepts and explore your options. What can I help you with today?";
    
    addMessage('lexara', greetingText, {
      emotionHint: 'playful',
      gazeHint: 'camera',
      behaviorMode: 'personable',
    });
    
    setCurrentEmotion('playful');
    setCurrentGaze('camera');
    setCurrentBehaviorMode('personable');
    
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
    
    // Check for direct geo request
    if (detectGeoRequest(message)) {
      const mode = determineGeoMode(message);
      setIsThinking(false);
      
      // Acquire location and open geo console
      const coords = await acquireLocation();
      
      if (coords) {
        setGeoState(prev => ({
          ...prev,
          isVisible: true,
          mode,
          coordinates: coords,
        }));
        
        const responseText = `Here's the ${mode === 'pin' ? 'location' : mode} view for you.`;
        addMessage('lexara', responseText, {
          emotionHint: 'calm',
          gazeHint: 'camera',
        });
        voiceSynthesis.speak(responseText, { context: 'explanation', autoPlay: true });
      } else {
        const responseText = "I'd love to show you the map, but I couldn't get location data. Could you share an address or coordinates?";
        addMessage('lexara', responseText, {
          emotionHint: 'empathetic',
          gazeHint: 'camera',
        });
        voiceSynthesis.speak(responseText, { context: 'clarification', autoPlay: true });
      }
      
      setCurrentEmotion('calm');
      setCurrentGaze('camera');
      return;
    }
    
    try {
      const context: LEXARABrainContext = {
        previousMessages: conversation.slice(-6).map(m => ({
          role: m.role === 'lexara' ? 'lexara' : 'user',
          content: m.content,
        })),
        voiceMetrics: {
          pitch: liveVoiceMetrics.pitch,
          speechRate: liveVoiceMetrics.speechRate,
          volume: liveVoiceMetrics.volume,
        },
        currentMode: currentBehaviorMode,
      };
      
      const response = await lexaraBrain.ask(message, context);
      
      setIsThinking(false);
      setCurrentEmotion(response.emotionHint);
      setCurrentGaze(response.gazeHint);
      
      if (response.behaviorMode !== currentBehaviorMode) {
        setCurrentBehaviorMode(response.behaviorMode);
      }
      
      // Check if geo is relevant and we should offer
      const isGeoRelevant = detectGeoRelevance(message) || detectGeoRelevance(response.text);
      const shouldOffer = isGeoRelevant && !geoState.hasOffered && !geoState.isVisible;
      
      if (shouldOffer) {
        // Add response with geo offer
        const mode = determineGeoMode(message + ' ' + response.text);
        setGeoState(prev => ({ ...prev, mode, hasOffered: true }));
        
        const offerText = response.text + " I can show you a live map or satellite view of this if you'd like.";
        addMessage('lexara', offerText, {
          emotionHint: response.emotionHint,
          gazeHint: response.gazeHint,
          behaviorMode: response.behaviorMode,
          geoOffer: true,
        });
        voiceSynthesis.speak(offerText, { context: response.context || 'explanation', autoPlay: true });
      } else {
        addMessage('lexara', response.text, {
          emotionHint: response.emotionHint,
          gazeHint: response.gazeHint,
          behaviorMode: response.behaviorMode,
        });
        voiceSynthesis.speak(response.text, { context: response.context || 'explanation', autoPlay: true });
      }
      
    } catch (error) {
      console.error('LEXARA brain error:', error);
      setIsThinking(false);
      setCurrentEmotion('empathetic');
      setCurrentGaze('camera');
      
      const fallbackText = currentBehaviorMode === 'personable'
        ? "I'm so sorry, I'm having a little trouble right now. Could you try asking me again?"
        : "I apologize for the technical difficulty. Please try your question again.";
      addMessage('lexara', fallbackText);
      voiceSynthesis.speak(fallbackText, { context: 'reassurance', autoPlay: true });
    }
  }, [addMessage, conversation, voiceSynthesis, liveVoiceMetrics, currentBehaviorMode, acquireLocation, geoState.hasOffered, geoState.isVisible]);
  
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
      if (mediaState.mediaStream) {
        mediaState.mediaStream.getTracks().forEach(track => track.stop());
      }
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
        description="Experience LEXARA, your ethereal AI legal consultation assistant with voice interaction and satellite intelligence."
      />
      
      {/* Ethereal Background */}
      <EtherealBackground />
      
      {/* Main Content */}
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
            <span className="text-cyan-400 font-semibold tracking-wide">LEXARA</span>
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
            {geoState.isVisible && (
              <div className="p-1.5 rounded-full text-cyan-400 bg-cyan-500/10">
                <Satellite className="h-3.5 w-3.5" />
              </div>
            )}
          </div>
        </header>
        
        {/* Main Layout */}
        <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Avatar Viewport */}
          <div className="flex-1 md:flex-[3] relative flex items-center justify-center p-4 md:p-8">
            {/* Begin Session Overlay */}
            {showBeginButton && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
                <div className="text-center">
                  <h2 className="text-2xl font-light text-slate-200 mb-4">Welcome to LEXARA</h2>
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
              <LEXARAEtherealAvatar
                isSpeaking={voiceSynthesis.isSpeaking}
                isListening={voiceMode.isListening}
                isThinking={isThinking}
                audioLevel={audioLevel}
                emotionHint={currentEmotion}
                gazeHint={currentGaze}
                size="full"
              />
            </div>
            
            {/* Live Video Panel (PiP) */}
            <LiveVideoPanel
              videoRef={videoRef}
              isActive={!!mediaState.mediaStream?.getVideoTracks().length}
            />
            
            {/* Geo Console Overlay */}
            <GeoConsoleOverlay
              geoState={geoState}
              onClose={closeGeoConsole}
              onToggleMaximize={toggleGeoMaximize}
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
              onGeoAccept={handleGeoAccept}
              isDisabled={isThinking || showBeginButton}
            />
          </div>
        </main>
        
        {/* Disclaimer Footer */}
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
