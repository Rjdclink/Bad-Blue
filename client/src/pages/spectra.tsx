/**
 * SPECTRA - LEXARA + GeoConsole + People Radar
 * 
 * Unified intelligence interface combining:
 * - LEXARA conversational AI
 * - Satellite/GPS visualization
 * - People Radar tracking with confidence scores
 * - Movement trail visualization (device pings, camera hits, social media EXIF)
 * 
 * MODES:
 * - Live: Real-time tracking with current device location
 * - History: Historical movement trail visualization
 * 
 * FULL AUTO: No toggles, automatic device detection
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { 
  ArrowLeft, Send, Mic, MicOff, Video, VideoOff,
  Loader2, AlertCircle, MapPin, Satellite, X, Maximize2, Minimize2,
  Radio, History, Clock, Target, Eye, Crosshair, Users
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
  getLEXARABrain,
  type LEXARABrainContext,
} from '@shared/lexaraBrain';

// ============================================================================
// CONSTANTS
// ============================================================================

const LEXARA_CONSENT_KEY = 'lexara_auto_start';

// Singleton brain instance (one brain = one executor)
const lexaraBrain = getLEXARABrain();

// ============================================================================
// TYPES
// ============================================================================

type SpectraMode = 'live' | 'history';

interface TrackPoint {
  id: string;
  label: string;
  lat: number;
  lon: number;
  timestamp: string; // ISO
  confidence: number; // 0–1
  source: 'device' | 'camera' | 'social' | 'manual';
}

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
  isInitialized: boolean;
  permissionGranted: boolean;
}

interface ViewState {
  latitude: number;
  longitude: number;
  zoom: number;
}


// ============================================================================
// ETHEREAL BACKGROUND
// ============================================================================

const EtherealBackground = memo(function EtherealBackground() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-indigo-950/90 to-slate-900" />
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-cyan-500/10 blur-3xl animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-indigo-500/10 blur-3xl animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-purple-500/5 blur-3xl" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/[0.02] to-transparent" />
    </div>
  );
});

// ============================================================================
// PEOPLE RADAR MAP COMPONENT
// ============================================================================

interface PeopleRadarMapProps {
  mode: SpectraMode;
  trackPoints: TrackPoint[];
  viewState: ViewState;
  onViewStateChange: (vs: ViewState) => void;
  selectedPoint: TrackPoint | null;
  onSelectPoint: (point: TrackPoint | null) => void;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  onClose: () => void;
}

const PeopleRadarMap = memo(function PeopleRadarMap({
  mode,
  trackPoints,
  viewState,
  onViewStateChange,
  selectedPoint,
  onSelectPoint,
  isMaximized,
  onToggleMaximize,
  onClose,
}: PeopleRadarMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  
  // Get source icon
  const getSourceIcon = (source: TrackPoint['source']) => {
    switch (source) {
      case 'device': return '📱';
      case 'camera': return '📷';
      case 'social': return '📸';
      case 'manual': return '📍';
      default: return '📍';
    }
  };
  
  // Get confidence color
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return 'text-emerald-400 bg-emerald-500/20';
    if (confidence >= 0.7) return 'text-amber-400 bg-amber-500/20';
    return 'text-red-400 bg-red-500/20';
  };
  
  // Format timestamp
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffHours < 48) return 'Yesterday';
    return `${Math.floor(diffHours / 24)}d ago`;
  };
  
  return (
    <div className={cn(
      "absolute z-30 bg-slate-900/95 backdrop-blur-md border border-cyan-500/30 rounded-xl overflow-hidden shadow-2xl transition-all duration-300",
      isMaximized 
        ? "inset-4" 
        : "bottom-4 right-4 w-[400px] h-[350px] md:w-[500px] md:h-[400px]"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/50 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-cyan-400 animate-pulse" />
          <span className="text-sm font-medium text-slate-200">SPECTRA - People Radar</span>
          <div className={cn(
            "px-2 py-0.5 rounded-full text-xs font-medium",
            mode === 'live' ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
          )}>
            {mode === 'live' ? 'LIVE' : 'HISTORY'}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-slate-200"
            onClick={onToggleMaximize}
          >
            {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
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
      
      {/* Map Area */}
      <div className="flex-1 relative" style={{ height: 'calc(100% - 44px - 80px)' }}>
        <div 
          ref={mapRef}
          className="absolute inset-0 bg-slate-800"
          style={{
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <Satellite className="h-12 w-12 text-cyan-400/50 mx-auto mb-2" />
              <p className="text-xs text-slate-400">Satellite View</p>
              <p className="text-xs text-slate-500">
                {viewState.latitude.toFixed(4)}, {viewState.longitude.toFixed(4)}
              </p>
              <p className="text-[11px] text-slate-500 mt-2 max-w-[260px]">
                Satellite imagery is not configured on this panel. Provide real coordinates and use GeoConsole for map rendering.
              </p>
            </div>
          </div>
          
          {/* Coordinate markers are intentionally not rendered on this panel
              until a real map projection is implemented (no fake XY placement). */}
        </div>
      </div>
      
      {/* Track Point Details / Timeline */}
      <div className="h-20 px-3 py-2 bg-slate-800/30 border-t border-slate-700/50 overflow-x-auto">
        {selectedPoint ? (
          <div className="flex items-center gap-3">
            <div className="text-2xl">{getSourceIcon(selectedPoint.source)}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{selectedPoint.label}</p>
              <p className="text-xs text-slate-400">{formatTime(selectedPoint.timestamp)}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-slate-500">Confidence:</span>
                <div className={cn(
                  "px-2 py-0.5 rounded-full text-xs font-medium",
                  getConfidenceColor(selectedPoint.confidence)
                )}>
                  {Math.round(selectedPoint.confidence * 100)}%
                </div>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              <p>{selectedPoint.lat.toFixed(4)}</p>
              <p>{selectedPoint.lon.toFixed(4)}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 overflow-x-auto">
            {trackPoints.map((point, index) => (
              <button
                key={point.id}
                className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 transition-colors"
                onClick={() => onSelectPoint(point)}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{getSourceIcon(point.source)}</span>
                  <span className="text-xs text-slate-300">{formatTime(point.timestamp)}</span>
                </div>
              </button>
            ))}
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
  isDisabled: boolean;
}

const MessagePanel = memo(function MessagePanel({
  messages,
  interimTranscript,
  isThinking,
  userInput,
  setUserInput,
  onSubmit,
  isDisabled,
}: MessagePanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, interimTranscript]);
  
  return (
    <div className="flex flex-col h-full bg-slate-900/60 backdrop-blur-sm border-l border-slate-700/30">
      <div className="px-4 py-3 border-b border-slate-700/30">
        <h2 className="text-sm font-semibold text-slate-200">SPECTRA Console</h2>
      </div>
      
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
            </div>
          </div>
        ))}
        
        {isThinking && (
          <div className="flex gap-2">
            <div className="bg-amber-500/15 border border-amber-500/20 rounded-2xl px-4 py-2.5 flex items-center gap-2 text-amber-300 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing...
            </div>
          </div>
        )}
        
        {interimTranscript && (
          <div className="flex gap-2 flex-row-reverse">
            <div className="bg-slate-700/30 border border-slate-600/20 rounded-2xl px-4 py-2 text-slate-400 text-sm italic">
              {interimTranscript}...
            </div>
          </div>
        )}
        
        <div ref={scrollRef} />
      </div>
      
      <form onSubmit={onSubmit} className="p-3 border-t border-slate-700/30">
        <div className="flex gap-2">
          <input
            type="text"
            value={userInput}
            onChange={e => setUserInput(e.target.value)}
            placeholder="Ask LEXARA or search..."
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
// MAIN COMPONENT - SPECTRA PAGE
// ============================================================================

export default function SpectraPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // SPECTRA mode - real data only
  const [spectraMode, setSpectraMode] = useState<SpectraMode>('live');
  const [trackPoints, setTrackPoints] = useState<TrackPoint[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<TrackPoint | null>(null);
  const [showRadar, setShowRadar] = useState(true);
  const [radarMaximized, setRadarMaximized] = useState(false);
  
  // Map view state - PRODUCTION: World view until real data arrives (no hardcoded location)
  const [viewState, setViewState] = useState<ViewState>({
    latitude: 0,  // Center of world - will update when real data loads
    longitude: 0,
    zoom: 2,      // World view zoom until data available
  });
  
  // Conversation state
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [currentEmotion, setCurrentEmotion] = useState<LEXARAEmotionHint>('calm');
  const [currentGaze, setCurrentGaze] = useState<LEXARAGazeHint>('camera');
  const [isThinking, setIsThinking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [currentBehaviorMode, setCurrentBehaviorMode] = useState<'personable' | 'professional'>('personable');
  
  // Media state
  const [mediaState, setMediaState] = useState<MediaState>({
    hasMic: false,
    hasCamera: false,
    mediaStream: null,
    isInitialized: false,
    permissionGranted: false,
  });
  
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

  // Prevent feedback loops: pause ASR while LEXARA is speaking (then resume).
  useEffect(() => {
    if (voiceSynthesis.isSpeaking) {
      voiceMode.stopListening();
      return;
    }
    if (voiceMode.isEnabled) {
      voiceMode.startListening();
    }
  }, [voiceSynthesis.isSpeaking, voiceMode.isEnabled, voiceMode.startListening, voiceMode.stopListening]);

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
      return { hasMic: false, hasCamera: false };
    }
  }, []);

  // ============================================================================
  // MEDIA INITIALIZATION
  // ============================================================================
  
  const initializeMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      setMediaState(prev => ({
        ...prev,
        mediaStream: stream,
        isInitialized: true,
        permissionGranted: true,
      }));
      
      localStorage.setItem(LEXARA_CONSENT_KEY, 'true');
      
      try {
        await voiceMode.enable();
        voiceMode.startListening();
      } catch (e) {
        console.log('Voice mode deferred');
      }
      
      return true;
    } catch (error) {
      setMediaState(prev => ({
        ...prev,
        isInitialized: true,
        permissionGranted: false,
      }));
      return false;
    }
  }, [voiceMode]);

  // ============================================================================
  // AUTO-START
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
      }));
      
      if (hasConsent) {
        setTimeout(async () => {
          await initializeMedia();
          setSessionStarted(true);
          sendGreeting();
        }, 300);
      }
    };
    
    initialize();
  }, [detectDevices, initializeMedia]);

  // ============================================================================
  // HANDLERS
  // ============================================================================
  
  const handleBeginSession = async () => {
    setShowBeginButton(false);
    await initializeMedia();
    setSessionStarted(true);
    sendGreeting();
  };
  
  const addMessage = useCallback((
    role: 'lexara' | 'user', 
    content: string, 
    options?: Partial<ConversationMessage>
  ) => {
    setConversation(prev => [...prev, {
      id: `${role}-${Date.now()}`,
      role,
      content,
      timestamp: new Date(),
      ...options,
    }]);
  }, []);
  
  const sendGreeting = useCallback(() => {
    const greetingText = "SPECTRA online. I'm LEXARA, your intelligence analyst. I have access to People Radar and satellite tracking. How can I assist with your search?";
    
    addMessage('lexara', greetingText, {
      emotionHint: 'calm',
      gazeHint: 'camera',
      behaviorMode: 'professional',
    });
    
    setCurrentEmotion('calm');
    setCurrentGaze('camera');
    setCurrentBehaviorMode('professional');
    
    voiceSynthesis.speak(greetingText, { context: 'introduction', autoPlay: true }).catch(() => {});
  }, [addMessage, voiceSynthesis]);
  
  const handleUserMessage = useCallback(async (message: string) => {
    addMessage('user', message);
    setIsThinking(true);
    
    // Check for mode switch commands
    if (message.toLowerCase().includes('live mode') || message.toLowerCase().includes('go live')) {
      setSpectraMode('live');
      setIsThinking(false);
      const response = "Switching to LIVE mode. Real-time tracking active.";
      addMessage('lexara', response);
      voiceSynthesis.speak(response, { context: 'explanation', autoPlay: true }).catch(() => {});
      return;
    }
    
    if (message.toLowerCase().includes('history') || message.toLowerCase().includes('past locations')) {
      setSpectraMode('history');
      setIsThinking(false);
      const response = "Switching to HISTORY mode. Displaying movement trail.";
      addMessage('lexara', response);
      voiceSynthesis.speak(response, { context: 'explanation', autoPlay: true }).catch(() => {});
      return;
    }
    
    if (message.toLowerCase().includes('show radar') || message.toLowerCase().includes('open radar')) {
      setShowRadar(true);
      setIsThinking(false);
      const response = "People Radar is now visible. I'm tracking " + trackPoints.length + " location points.";
      addMessage('lexara', response);
      voiceSynthesis.speak(response, { context: 'explanation', autoPlay: true }).catch(() => {});
      return;
    }
    
    try {
      const context: LEXARABrainContext = {
        previousMessages: conversation.slice(-6).map(m => ({
          role: m.role === 'lexara' ? 'lexara' : 'user',
          content: m.content,
        })),
        currentMode: currentBehaviorMode,
      };
      
      const response = await lexaraBrain.ask(message, context);
      
      setIsThinking(false);
      setCurrentEmotion(response.emotionHint);
      setCurrentGaze(response.gazeHint);
      
      addMessage('lexara', response.text, {
        emotionHint: response.emotionHint,
        gazeHint: response.gazeHint,
        behaviorMode: response.behaviorMode,
      });
      
      voiceSynthesis.speak(response.text, { context: response.context || 'explanation', autoPlay: true }).catch(() => {});
      
    } catch (error) {
      setIsThinking(false);
      const fallbackText = "I'm having trouble processing that request. Please try again.";
      addMessage('lexara', fallbackText);
      voiceSynthesis.speak(fallbackText, { context: 'reassurance', autoPlay: true }).catch(() => {});
    }
  }, [addMessage, conversation, voiceSynthesis, currentBehaviorMode, trackPoints.length]);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || isThinking) return;
    handleUserMessage(userInput.trim());
    setUserInput('');
  };

  // ============================================================================
  // AUDIO LEVEL
  // ============================================================================
  
  useEffect(() => {
    if (!voiceSynthesis.isSpeaking) {
      setAudioLevel(0);
      return;
    }
    const interval = setInterval(() => {
      // Real-world mode: do not fabricate "audio levels" with randomness.
      // Keep a steady visualization while speech synthesis is active.
      setAudioLevel(0.55);
    }, 80);
    return () => {
      clearInterval(interval);
      setAudioLevel(0);
    };
  }, [voiceSynthesis.isSpeaking]);

  // ============================================================================
  // CLEANUP
  // ============================================================================
  
  useEffect(() => {
    return () => {
      if (mediaState.mediaStream) {
        mediaState.mediaStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [mediaState.mediaStream]);

  // ============================================================================
  // RENDER
  // ============================================================================
  
  return (
    <div className="fixed inset-0 overflow-hidden">
      <SEOHead 
        title="SPECTRA - LEXARA + People Radar" 
        description="SPECTRA intelligence platform combining LEXARA AI with People Radar tracking and satellite visualization."
      />
      
      <EtherealBackground />
      
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
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-cyan-400 animate-pulse" />
              <span className="text-cyan-400 font-semibold tracking-wide">SPECTRA</span>
            </div>
            <LEXARAStatusIndicator 
              isSpeaking={voiceSynthesis.isSpeaking}
              isListening={voiceMode.isListening}
              isThinking={isThinking}
            />
          </div>
          
          {/* Mode Toggle */}
          <div className="flex items-center gap-2">
            <Button
              variant={spectraMode === 'live' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSpectraMode('live')}
              className={cn(
                "text-xs",
                spectraMode === 'live' 
                  ? "bg-emerald-600 hover:bg-emerald-500" 
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              <Target className="h-3 w-3 mr-1" />
              Live
            </Button>
            <Button
              variant={spectraMode === 'history' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSpectraMode('history')}
              className={cn(
                "text-xs",
                spectraMode === 'history' 
                  ? "bg-amber-600 hover:bg-amber-500" 
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              <History className="h-3 w-3 mr-1" />
              History
            </Button>
          </div>
        </header>
        
        {/* Main Layout */}
        <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Avatar Viewport */}
          <div className="flex-1 md:flex-[3] relative flex items-center justify-center p-4 md:p-8">
            {/* Begin Session Overlay */}
            {showBeginButton && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-4">
                    <Radio className="h-8 w-8 text-cyan-400 animate-pulse" />
                    <h2 className="text-2xl font-light text-slate-200">SPECTRA</h2>
                  </div>
                  <p className="text-slate-400 text-sm mb-6 max-w-xs mx-auto">
                    LEXARA + People Radar + Satellite Intelligence
                  </p>
                  <Button 
                    onClick={handleBeginSession}
                    size="lg"
                    className="bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white px-8 py-3 rounded-full font-medium shadow-lg hover:shadow-xl transition-all"
                  >
                    Initialize SPECTRA
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
            
            {/* Live Video Panel */}
            <LiveVideoPanel
              videoRef={videoRef}
              isActive={!!mediaState.mediaStream?.getVideoTracks().length}
            />
            
            {/* People Radar Map */}
            {showRadar && (
              <PeopleRadarMap
                mode={spectraMode}
                trackPoints={trackPoints}
                viewState={viewState}
                onViewStateChange={setViewState}
                selectedPoint={selectedPoint}
                onSelectPoint={setSelectedPoint}
                isMaximized={radarMaximized}
                onToggleMaximize={() => setRadarMaximized(!radarMaximized)}
                onClose={() => setShowRadar(false)}
              />
            )}
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
              isDisabled={isThinking || showBeginButton}
            />
          </div>
        </main>
        
        {/* Footer */}
        <footer className="px-4 py-2 bg-slate-900/30 backdrop-blur-sm border-t border-slate-700/30">
          <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <AlertCircle className="h-3 w-3" />
            <span>SPECTRA Intelligence Platform • Real-world location intelligence operations</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
