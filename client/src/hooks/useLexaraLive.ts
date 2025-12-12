/**
 * useLexaraLive Hook
 * 
 * Manages Lexara Live consent state, media initialization, and first interaction handling.
 * 
 * Requirements:
 * 1. Check localStorage.lexaraLiveEnabled state ("true", "false", null)
 * 2. Initialize media stack when live=true
 * 3. Handle first user interaction to resume AudioContext and play greeting
 * 4. Provide "Enable Live Mode" functionality for text-only users
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'wouter';
import { 
  LEXARA_LIVE_ENABLED_KEY, 
  getLexaraLiveEnabled, 
  setLexaraLiveEnabled, 
  hasLexaraLiveConsent 
} from '@/components/LexaraLiveConsentModal';

// ============================================================================
// TYPES
// ============================================================================

export interface UseLexaraLiveOptions {
  /** Callback when Lexara should speak a greeting */
  onGreeting?: () => void;
  /** Callback when live mode is enabled/disabled */
  onLiveModeChange?: (enabled: boolean) => void;
}

export interface UseLexaraLiveResult {
  /** Whether live mode is currently enabled */
  isLiveEnabled: boolean;
  /** Whether the user has made a consent choice */
  hasConsent: boolean;
  /** Whether media is ready (camera + mic connected) */
  isMediaReady: boolean;
  /** Whether we're waiting for first user interaction */
  awaitingFirstInteraction: boolean;
  /** Error message if any */
  error: string | null;
  /** Show consent modal */
  showConsentModal: boolean;
  /** Set show consent modal */
  setShowConsentModal: (show: boolean) => void;
  /** Handle consent completion */
  handleConsent: (enabled: boolean) => void;
  /** Initialize media for live mode */
  initializeMedia: () => Promise<boolean>;
  /** Enable live mode (re-request permissions) */
  enableLiveMode: () => Promise<boolean>;
  /** Audio context for TTS playback */
  audioContext: AudioContext | null;
  /** Resume audio context (needed for first interaction) */
  resumeAudioContext: () => Promise<void>;
  /** Mark first interaction as complete */
  markFirstInteraction: () => void;
}

// ============================================================================
// HOOK: useLexaraLive
// ============================================================================

export function useLexaraLive(options: UseLexaraLiveOptions = {}): UseLexaraLiveResult {
  const { onGreeting, onLiveModeChange } = options;
  const [, setLocation] = useLocation();
  
  // State
  const [isLiveEnabled, setIsLiveEnabled] = useState<boolean>(false);
  const [hasConsent, setHasConsent] = useState<boolean>(false);
  const [isMediaReady, setIsMediaReady] = useState<boolean>(false);
  const [awaitingFirstInteraction, setAwaitingFirstInteraction] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showConsentModal, setShowConsentModal] = useState<boolean>(false);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  
  // Refs
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const firstInteractionHandled = useRef<boolean>(false);
  const greetingPlayed = useRef<boolean>(false);
  const initAttempted = useRef<boolean>(false);

  // ============================================================================
  // CHECK URL PARAMS FOR LIVE MODE
  // ============================================================================
  
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const urlParams = new URLSearchParams(window.location.search);
    const liveParam = urlParams.get('live');
    
    // Check localStorage first
    const storedConsent = getLexaraLiveEnabled();
    setHasConsent(storedConsent !== null);
    
    if (liveParam === 'true' || storedConsent === 'true') {
      setIsLiveEnabled(true);
    } else if (liveParam === 'false' || storedConsent === 'false') {
      setIsLiveEnabled(false);
    }
  }, []);

  // ============================================================================
  // AUDIO CONTEXT MANAGEMENT
  // ============================================================================

  const resumeAudioContext = useCallback(async () => {
    if (!audioContext) {
      const ctx = new AudioContext();
      setAudioContext(ctx);
      return;
    }
    
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
  }, [audioContext]);

  // Create audio context on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && !audioContext) {
      try {
        const ctx = new AudioContext();
        setAudioContext(ctx);
        
        // Mark as awaiting first interaction if suspended
        if (ctx.state === 'suspended') {
          setAwaitingFirstInteraction(true);
        }
      } catch (e) {
        console.log('AudioContext creation failed:', e);
      }
    }
    
    return () => {
      if (audioContext) {
        audioContext.close();
      }
    };
  }, []);

  // ============================================================================
  // FIRST INTERACTION HANDLING
  // ============================================================================

  const markFirstInteraction = useCallback(async () => {
    if (firstInteractionHandled.current) return;
    firstInteractionHandled.current = true;
    
    // Resume audio context
    await resumeAudioContext();
    setAwaitingFirstInteraction(false);
    
    // Play greeting if live mode is enabled and greeting hasn't been played
    if (isLiveEnabled && !greetingPlayed.current) {
      greetingPlayed.current = true;
      onGreeting?.();
    }
  }, [resumeAudioContext, isLiveEnabled, onGreeting]);

  // Setup first interaction listener when live mode is enabled
  useEffect(() => {
    if (!isLiveEnabled || firstInteractionHandled.current) return;
    
    const handleFirstInteraction = () => {
      markFirstInteraction();
    };
    
    // Listen for click, tap, or scroll
    document.addEventListener('click', handleFirstInteraction, { once: true });
    document.addEventListener('touchstart', handleFirstInteraction, { once: true });
    document.addEventListener('scroll', handleFirstInteraction, { once: true });
    document.addEventListener('keydown', handleFirstInteraction, { once: true });
    
    return () => {
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('touchstart', handleFirstInteraction);
      document.removeEventListener('scroll', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
    };
  }, [isLiveEnabled, markFirstInteraction]);

  // ============================================================================
  // MEDIA INITIALIZATION
  // ============================================================================

  const initializeMedia = useCallback(async (): Promise<boolean> => {
    // Skip if already attempted (prevents concurrent calls)
    if (initAttempted.current) {
      // Wait a tick for state to sync before returning
      return new Promise(resolve => setTimeout(() => resolve(isMediaReady), 0));
    }
    initAttempted.current = true;
    
    setError(null);
    
    try {
      // Request both audio and video
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      
      mediaStreamRef.current = stream;
      setIsMediaReady(true);
      setIsLiveEnabled(true);
      setLexaraLiveEnabled('true');
      onLiveModeChange?.(true);
      
      return true;
    } catch (err: any) {
      console.error('Media initialization failed:', err);
      
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setError('Camera/microphone permission denied. Using text-only mode.');
      } else if (err?.name === 'NotFoundError') {
        setError('No camera or microphone found. Using text-only mode.');
      } else {
        setError('Could not access camera/microphone. Using text-only mode.');
      }
      
      setIsMediaReady(false);
      setIsLiveEnabled(false);
      setLexaraLiveEnabled('false');
      onLiveModeChange?.(false);
      
      return false;
    }
  }, [isMediaReady, onLiveModeChange]);

  // Auto-initialize media when live mode is enabled
  useEffect(() => {
    if (isLiveEnabled && hasConsent && !initAttempted.current) {
      initializeMedia();
    }
  }, [isLiveEnabled, hasConsent, initializeMedia]);

  // ============================================================================
  // ENABLE LIVE MODE (for text-only users wanting to switch)
  // ============================================================================

  const enableLiveMode = useCallback(async (): Promise<boolean> => {
    // Don't reset initAttempted here - instead handle it properly
    // by checking if we need to stop existing stream first
    setError(null);
    
    try {
      // Stop any existing stream before requesting new one
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      
      mediaStreamRef.current = stream;
      setIsMediaReady(true);
      setIsLiveEnabled(true);
      setLexaraLiveEnabled('true');
      onLiveModeChange?.(true);
      
      // Update URL to reflect live mode
      const url = new URL(window.location.href);
      url.searchParams.set('live', 'true');
      window.history.replaceState({}, '', url.toString());
      
      return true;
    } catch (err: any) {
      console.error('Enable live mode failed:', err);
      
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setError('Camera/microphone permission denied.');
      } else if (err?.name === 'NotFoundError') {
        setError('No camera or microphone found.');
      } else {
        setError('Could not access camera/microphone.');
      }
      
      return false;
    }
  }, [onLiveModeChange]);

  // ============================================================================
  // CONSENT HANDLING
  // ============================================================================

  const handleConsent = useCallback((enabled: boolean) => {
    setHasConsent(true);
    setIsLiveEnabled(enabled);
    setShowConsentModal(false);
    onLiveModeChange?.(enabled);
    
    // Note: Routing is handled by the caller
  }, [onLiveModeChange]);

  // ============================================================================
  // CLEANUP
  // ============================================================================

  useEffect(() => {
    return () => {
      // Cleanup media stream on unmount
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return {
    isLiveEnabled,
    hasConsent,
    isMediaReady,
    awaitingFirstInteraction,
    error,
    showConsentModal,
    setShowConsentModal,
    handleConsent,
    initializeMedia,
    enableLiveMode,
    audioContext,
    resumeAudioContext,
    markFirstInteraction,
  };
}

export default useLexaraLive;
