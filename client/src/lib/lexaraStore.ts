/**
 * Lexara Global State Store - Zustand
 * 
 * Manages global Lexara state including:
 * - Session status (idle, initializing, active, error)
 * - Consent persistence (localStorage)
 * - Media stream state
 * - Current session data
 * - Error tracking
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================================================
// TYPES
// ============================================================================

export type LexaraStatus = 'idle' | 'initializing' | 'active' | 'error' | 'speaking' | 'listening';

export interface LexaraMediaState {
  hasMic: boolean;
  hasCamera: boolean;
  micPermission: 'prompt' | 'granted' | 'denied';
  cameraPermission: 'prompt' | 'granted' | 'denied';
  audioStream: MediaStream | null;
  videoStream: MediaStream | null;
  audioLevel: number;
}

export interface LexaraSession {
  id: string;
  startedAt: Date;
  lawArea?: string;
  conversationHistory: Array<{
    role: 'user' | 'lexara';
    content: string;
    timestamp: Date;
  }>;
}

export interface LexaraError {
  code: string;
  message: string;
  timestamp: Date;
  recoverable: boolean;
}

export interface LexaraState {
  // Core status
  status: LexaraStatus;
  
  // Consent (persisted)
  consent: boolean;
  consentTimestamp: number | null;
  
  // Media state
  media: LexaraMediaState;
  
  // Session
  session: LexaraSession | null;
  
  // Errors
  lastError: LexaraError | null;
  
  // Actions
  setStatus: (status: LexaraStatus) => void;
  setConsent: (consent: boolean) => void;
  updateMedia: (media: Partial<LexaraMediaState>) => void;
  setAudioLevel: (level: number) => void;
  startSession: (lawArea?: string) => void;
  endSession: () => void;
  addMessage: (role: 'user' | 'lexara', content: string) => void;
  setError: (error: LexaraError | null) => void;
  reset: () => void;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialMediaState: LexaraMediaState = {
  hasMic: false,
  hasCamera: false,
  micPermission: 'prompt',
  cameraPermission: 'prompt',
  audioStream: null,
  videoStream: null,
  audioLevel: 0,
};

const initialState = {
  status: 'idle' as LexaraStatus,
  consent: false,
  consentTimestamp: null,
  media: initialMediaState,
  session: null,
  lastError: null,
};

// ============================================================================
// STORE
// ============================================================================

export const useLexaraStore = create<LexaraState>()(
  persist(
    (set, get) => ({
      ...initialState,
      
      setStatus: (status) => set({ status }),
      
      setConsent: (consent) => set({ 
        consent,
        consentTimestamp: consent ? Date.now() : null,
      }),
      
      updateMedia: (mediaUpdate) => set((state) => ({
        media: { ...state.media, ...mediaUpdate },
      })),
      
      setAudioLevel: (level) => set((state) => ({
        media: { ...state.media, audioLevel: level },
      })),
      
      startSession: (lawArea) => {
        const sessionId = `lexara-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        set({
          status: 'active',
          session: {
            id: sessionId,
            startedAt: new Date(),
            lawArea,
            conversationHistory: [],
          },
          lastError: null,
        });
      },
      
      endSession: () => {
        const { media } = get();
        // Stop media streams if they exist
        if (media.audioStream) {
          media.audioStream.getTracks().forEach(track => track.stop());
        }
        if (media.videoStream) {
          media.videoStream.getTracks().forEach(track => track.stop());
        }
        set({
          status: 'idle',
          session: null,
          media: initialMediaState,
        });
      },
      
      addMessage: (role, content) => set((state) => {
        if (!state.session) return state;
        return {
          session: {
            ...state.session,
            conversationHistory: [
              ...state.session.conversationHistory,
              { role, content, timestamp: new Date() },
            ],
          },
        };
      }),
      
      setError: (error) => set({ 
        lastError: error,
        status: error ? 'error' : get().status,
      }),
      
      reset: () => {
        const { media } = get();
        // Stop media streams if they exist
        if (media.audioStream) {
          media.audioStream.getTracks().forEach(track => track.stop());
        }
        if (media.videoStream) {
          media.videoStream.getTracks().forEach(track => track.stop());
        }
        set(initialState);
      },
    }),
    {
      name: 'lexara-consent-storage',
      // Only persist consent-related fields
      partialize: (state) => ({
        consent: state.consent,
        consentTimestamp: state.consentTimestamp,
      }),
    }
  )
);

// ============================================================================
// HELPER HOOKS
// ============================================================================

/**
 * Check if Lexara has consent to use media
 */
export const useLexaraConsent = () => {
  return useLexaraStore((state) => state.consent);
};

/**
 * Get current Lexara status
 */
export const useLexaraStatus = () => {
  return useLexaraStore((state) => state.status);
};

/**
 * Get audio level for visualizations
 */
export const useLexaraAudioLevel = () => {
  return useLexaraStore((state) => state.media.audioLevel);
};

/**
 * Get current session
 */
export const useLexaraSession = () => {
  return useLexaraStore((state) => state.session);
};
