/**
 * LEXARA Live Consent Modal
 * 
 * Full-screen consent modal shown on first login/landing for Lexara Live voice+video features.
 * 
 * Requirements:
 * 1. Three states for localStorage.lexaraLiveEnabled: "true", "false", null/undefined
 * 2. Show legal disclaimer ("not legal advice") with checkbox
 * 3. Checkbox triggers immediate mic/camera permission request
 * 4. Continue button only enabled after disclaimer accepted and permissions granted
 * 5. Shows permission status badges (mic ✓, camera ✓)
 */

import { useState, useCallback, memo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Scale, Mic, Video, Shield, Loader2, AlertTriangle, Check, X } from 'lucide-react';
import { useVoiceMode } from '@/hooks/useVoiceMode';

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
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [permissionsGranted, setPermissionsGranted] = useState<{
    audio: boolean;
    video: boolean;
  }>({ audio: false, video: false });
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  // Voice mode hook - enableVoice is called HERE when checkbox is checked
  const voiceMode = useVoiceMode({
    continuous: true,
    interimResults: true,
  });

  /**
   * Handle disclaimer checkbox change
   * When checked, immediately request camera/mic permissions AND enable voice
   * This is the ONLY place where voice is enabled
   */
  const handleDisclaimerToggle = useCallback(async (checked: boolean) => {
    setDisclaimerAccepted(checked);
    
    if (checked) {
      // Immediately request permissions when disclaimer is checked
      setIsRequesting(true);
      setError(null);
      
      try {
        // Request both audio and video permissions
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });

        // Permission granted - keep track of granted permissions
        const audioTrack = stream.getAudioTracks()[0];
        const videoTrack = stream.getVideoTracks()[0];
        
        setPermissionsGranted({
          audio: !!audioTrack,
          video: !!videoTrack,
        });

        // Stop the stream - we'll re-acquire it when entering Lexara
        stream.getTracks().forEach(track => track.stop());
        
        // NOW enable voice mode since we have audio permission
        if (audioTrack) {
          try {
            await voiceMode.enableVoice();
            setVoiceEnabled(true);
          } catch (voiceErr) {
            console.log('Voice mode enable failed:', voiceErr);
            // Voice failed but we still have camera, continue
          }
        }
        
      } catch (err: any) {
        console.log('getUserMedia failed during checkbox toggle:', err?.name, err?.message);
        
        // Try audio only if video fails
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setPermissionsGranted({ audio: true, video: false });
          audioStream.getTracks().forEach(track => track.stop());
          
          // Enable voice with audio-only permission
          try {
            await voiceMode.enableVoice();
            setVoiceEnabled(true);
          } catch (voiceErr) {
            console.log('Voice mode enable failed:', voiceErr);
          }
        } catch (audioErr) {
          // Both failed
          setPermissionsGranted({ audio: false, video: false });
          setVoiceEnabled(false);
          
          if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
            setError('Permission denied. You can still continue in text-only mode.');
          } else if (err?.name === 'NotFoundError') {
            setError('No camera/microphone found. You can still continue in text-only mode.');
          } else {
            setError('Could not access devices. You can still continue in text-only mode.');
          }
        }
      } finally {
        setIsRequesting(false);
      }
    } else {
      // Unchecked - reset permissions state and disable voice
      setPermissionsGranted({ audio: false, video: false });
      setVoiceEnabled(false);
      voiceMode.disable();
      setError(null);
    }
  }, [voiceMode]);

  /**
   * Handle the consent button click
   * Only available after disclaimer is accepted
   */
  const handleEnableLive = useCallback(async () => {
    if (!disclaimerAccepted) {
      setError('Please accept the disclaimer first');
      return;
    }

    // Store consent based on permissions granted
    const hasAnyPermission = permissionsGranted.audio || permissionsGranted.video;
    setLexaraLiveEnabled(hasAnyPermission ? 'true' : 'false');
    onConsent(hasAnyPermission);
  }, [disclaimerAccepted, permissionsGranted, onConsent]);

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
          {/* Permission Status Badges */}
          <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
            <Badge className={`flex items-center gap-1.5 px-3 py-1 ${
              permissionsGranted.audio 
                ? 'bg-green-500/15 text-green-300 border-green-500/30' 
                : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
            }`}>
              {permissionsGranted.audio ? <Check className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              Voice {permissionsGranted.audio ? '✓' : 'Input'}
            </Badge>
            <Badge className={`flex items-center gap-1.5 px-3 py-1 ${
              permissionsGranted.video 
                ? 'bg-green-500/15 text-green-300 border-green-500/30' 
                : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
            }`}>
              {permissionsGranted.video ? <Check className="h-3.5 w-3.5" /> : <Video className="h-3.5 w-3.5" />}
              Video {permissionsGranted.video ? '✓' : 'Chat'}
            </Badge>
            <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 flex items-center gap-1.5 px-3 py-1">
              <Shield className="h-3.5 w-3.5" />
              Secure Connection
            </Badge>
          </div>

          {/* Legal Disclaimer Box with Checkbox */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-amber-200 font-medium text-sm mb-1">Legal Disclaimer</p>
                <p className="text-amber-100/80 text-sm leading-relaxed mb-4">
                  LEXARA provides AI-powered legal information and assistance but does{' '}
                  <strong className="text-amber-200">not</strong> provide legal advice. 
                  The information provided is for educational purposes only. For legal advice, 
                  please consult a licensed attorney in your jurisdiction.
                </p>
                
                {/* Disclaimer Checkbox - triggers permission request */}
                <div className="flex items-start gap-3 pt-3 border-t border-amber-500/20">
                  <Checkbox 
                    id="disclaimer-accept"
                    checked={disclaimerAccepted}
                    onCheckedChange={(checked) => handleDisclaimerToggle(checked as boolean)}
                    disabled={isRequesting}
                    className="mt-0.5 border-amber-400/50 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                  />
                  <Label 
                    htmlFor="disclaimer-accept" 
                    className="text-amber-100 text-sm leading-relaxed cursor-pointer"
                  >
                    I understand that LEXARA does not provide legal advice and I agree to enable 
                    voice and camera access for the live co-counsel experience
                  </Label>
                </div>
              </div>
            </div>
          </div>

          {/* Requesting permissions indicator */}
          {isRequesting && (
            <div className="bg-cyan-500/15 border border-cyan-500/30 rounded-lg p-4 mb-4 text-center">
              <div className="flex items-center justify-center gap-2 text-cyan-300">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="font-medium">Requesting camera & microphone access…</span>
              </div>
              <p className="text-cyan-200/70 text-sm mt-2">
                Please allow access in the browser prompt that appears
              </p>
            </div>
          )}

          {/* Permission status message */}
          {disclaimerAccepted && !isRequesting && (permissionsGranted.audio || permissionsGranted.video) && (
            <div className="bg-green-500/15 border border-green-500/30 rounded-lg p-3 mb-4 text-center">
              <p className="text-green-300 text-sm flex items-center justify-center gap-2">
                <Check className="h-4 w-4" />
                {permissionsGranted.audio && permissionsGranted.video 
                  ? 'Camera and microphone access granted!' 
                  : permissionsGranted.audio 
                  ? 'Microphone access granted (camera unavailable)' 
                  : 'Camera access granted (microphone unavailable)'}
              </p>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="bg-red-500/15 border border-red-500/30 rounded-lg p-3 mb-4 text-center">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="p-8 pt-2 space-y-3">
          {/* Primary CTA - only enabled after disclaimer accepted */}
          <Button
            onClick={handleEnableLive}
            disabled={isRequesting || !disclaimerAccepted}
            className="w-full bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-medium py-6 text-base shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
          >
            {isRequesting ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Waiting for permission...
              </>
            ) : disclaimerAccepted && (permissionsGranted.audio || permissionsGranted.video) ? (
              <>
                <Check className="h-5 w-5 mr-2" />
                Continue to LEXARA Live
              </>
            ) : (
              <>
                <Mic className="h-5 w-5 mr-2" />
                Accept disclaimer above to enable live features
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
