/**
 * LEXARA Live Consent Modal
 * 
 * Full-screen consent modal shown on first login/landing for Lexara Live voice+video features.
 * 
 * Requirements:
 * 1. Three states for localStorage.lexaraLiveEnabled: "true", "false", null/undefined
 * 2. Show legal disclaimer ("not legal advice")
 * 3. Single CTA: "I understand and enable Lexara live co-counsel (voice, mic & camera)."
 * 4. On click: Call getUserMedia({ audio: true, video: true })
 *    - If granted: localStorage.lexaraLiveEnabled = "true", route to /consultation/[lawArea]?live=true
 *    - If denied: localStorage.lexaraLiveEnabled = "false", route to /consultation/[lawArea]?live=false
 * 5. Do not create own confirm dialogs - rely only on browser's native permission prompt
 * 6. Show "Waiting for browser permission..." during prompt
 */

import { useState, useCallback, memo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Scale, Mic, Video, Shield, Loader2, AlertTriangle } from 'lucide-react';

// ============================================================================
// CONSTANTS
// ============================================================================

export const LEXARA_LIVE_ENABLED_KEY = 'lexaraLiveEnabled';

/**
 * Get the current state of Lexara Live consent
 * Returns: "true" | "false" | null
 */
export function getLexaraLiveEnabled(): 'true' | 'false' | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = localStorage.getItem(LEXARA_LIVE_ENABLED_KEY);
    if (value === 'true' || value === 'false') return value;
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Set the Lexara Live consent state
 */
export function setLexaraLiveEnabled(value: 'true' | 'false'): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LEXARA_LIVE_ENABLED_KEY, value);
  } catch (e) {
    console.error('Failed to set lexaraLiveEnabled:', e);
  }
}

/**
 * Check if consent has been given (no choice yet returns false)
 */
export function hasLexaraLiveConsent(): boolean {
  return getLexaraLiveEnabled() !== null;
}

/**
 * Check if live mode is enabled
 */
export function isLexaraLiveEnabled(): boolean {
  return getLexaraLiveEnabled() === 'true';
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Time in ms to display error message before auto-continuing to text mode */
const ERROR_DISPLAY_TIMEOUT_MS = 2000;

// ============================================================================
// TYPES
// ============================================================================

export interface LexaraLiveConsentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConsent: (enabled: boolean) => void;
  targetLawArea?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

const LexaraLiveConsentModal = memo(function LexaraLiveConsentModal({
  isOpen,
  onClose,
  onConsent,
  targetLawArea,
}: LexaraLiveConsentModalProps) {
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Handle the consent button click
   * Requests getUserMedia permissions from the browser
   */
  const handleEnableLive = useCallback(async () => {
    setIsRequesting(true);
    setError(null);

    try {
      // Request both audio and video permissions
      // This will trigger the browser's native permission prompt
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });

      // Permission granted - stop the stream immediately (we just needed permission)
      stream.getTracks().forEach(track => track.stop());

      // Store consent
      setLexaraLiveEnabled('true');
      onConsent(true);
    } catch (err: any) {
      // Permission denied or error
      console.log('getUserMedia denied or failed:', err?.name, err?.message);
      
      // Store that user declined/couldn't enable
      setLexaraLiveEnabled('false');
      
      // Set appropriate error message
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setError('Camera/microphone permission was denied. Continuing in text-only mode.');
      } else if (err?.name === 'NotFoundError') {
        setError('No camera or microphone found. Continuing in text-only mode.');
      } else {
        setError('Could not access camera/microphone. Continuing in text-only mode.');
      }
      
      // After short delay, continue with text-only mode
      setTimeout(() => {
        onConsent(false);
      }, ERROR_DISPLAY_TIMEOUT_MS);
    } finally {
      setIsRequesting(false);
    }
  }, [onConsent]);

  /**
   * Handle declining live mode (text-only)
   */
  const handleDecline = useCallback(() => {
    setLexaraLiveEnabled('false');
    onConsent(false);
  }, [onConsent]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !isRequesting) onClose(); }}>
      <DialogContent 
        className="max-w-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 border-slate-700/50 text-slate-100 p-0 overflow-hidden"
        onPointerDownOutside={(e) => { if (isRequesting) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (isRequesting) e.preventDefault(); }}
      >
        {/* Header Section */}
        <div className="relative p-8 pb-6">
          {/* Background effect */}
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-indigo-500/10 pointer-events-none" />
          
          <DialogHeader className="relative">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="relative">
                <div className="absolute inset-0 bg-cyan-400/20 rounded-full blur-xl" />
                <div className="relative p-3 rounded-full bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 border border-cyan-500/30">
                  <Scale className="h-8 w-8 text-cyan-400" />
                </div>
              </div>
            </div>
            
            <DialogTitle className="text-2xl font-bold text-center text-white">
              Enable LEXARA Live Co-Counsel
            </DialogTitle>
            
            <DialogDescription className="text-center text-slate-300 mt-2">
              Experience real-time voice and video consultation with LEXARA
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Content Section */}
        <div className="px-8 pb-6">
          {/* Feature badges */}
          <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
            <Badge className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30 flex items-center gap-1.5 px-3 py-1">
              <Mic className="h-3.5 w-3.5" />
              Voice Input
            </Badge>
            <Badge className="bg-indigo-500/15 text-indigo-300 border-indigo-500/30 flex items-center gap-1.5 px-3 py-1">
              <Video className="h-3.5 w-3.5" />
              Video Chat
            </Badge>
            <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 flex items-center gap-1.5 px-3 py-1">
              <Shield className="h-3.5 w-3.5" />
              Secure Connection
            </Badge>
          </div>

          {/* Legal Disclaimer Box */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-200 font-medium text-sm mb-1">Legal Disclaimer</p>
                <p className="text-amber-100/80 text-sm leading-relaxed">
                  LEXARA provides AI-powered legal information and assistance but does{' '}
                  <strong className="text-amber-200">not</strong> provide legal advice. 
                  The information provided is for educational purposes only. For legal advice, 
                  please consult a licensed attorney in your jurisdiction.
                </p>
              </div>
            </div>
          </div>

          {/* Permission info */}
          <p className="text-slate-400 text-sm text-center mb-6">
            By enabling live mode, you'll be asked to grant camera and microphone access 
            through your browser's permission prompt. You can revoke these permissions 
            at any time in your browser settings.
          </p>

          {/* Error message */}
          {error && (
            <div className="bg-red-500/15 border border-red-500/30 rounded-lg p-3 mb-4 text-center">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          {/* Waiting for permission message */}
          {isRequesting && (
            <div className="bg-cyan-500/15 border border-cyan-500/30 rounded-lg p-4 mb-4 text-center">
              <div className="flex items-center justify-center gap-2 text-cyan-300">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="font-medium">Waiting for browser permission…</span>
              </div>
              <p className="text-cyan-200/70 text-sm mt-2">
                Please allow camera and microphone access in the browser prompt
              </p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="p-8 pt-2 space-y-3">
          {/* Primary CTA */}
          <Button
            onClick={handleEnableLive}
            disabled={isRequesting}
            className="w-full bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-medium py-6 text-base shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
          >
            {isRequesting ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Waiting for permission...
              </>
            ) : (
              <>
                <Mic className="h-5 w-5 mr-2" />
                I understand and enable LEXARA live co-counsel (voice, mic & camera)
              </>
            )}
          </Button>

          {/* Secondary option */}
          <Button
            variant="ghost"
            onClick={handleDecline}
            disabled={isRequesting}
            className="w-full text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
          >
            Continue without live features (text only)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

export default LexaraLiveConsentModal;
