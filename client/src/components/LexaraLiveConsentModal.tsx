/**
 * LEXARA Live Consent Modal
 *
 * This component is the single authority for whether live voice/video is
 * permitted. It acquires browser permissions and stores the user's choice.
 * The mounted consultation owns the actual SpeechRecognition instance.
 */

import { useState, useCallback, memo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Scale, Mic, Video, Shield, Loader2, AlertTriangle, Check } from 'lucide-react';

export const LEXARA_LIVE_ENABLED_KEY = 'lexaraLiveEnabled';

export function getLexaraLiveEnabled(): 'true' | 'false' | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = localStorage.getItem(LEXARA_LIVE_ENABLED_KEY);
    if (value === 'true' || value === 'false') return value;
    return null;
  } catch {
    return null;
  }
}

export function setLexaraLiveEnabled(value: 'true' | 'false'): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LEXARA_LIVE_ENABLED_KEY, value);
  } catch (error) {
    console.error('Failed to set lexaraLiveEnabled:', error);
  }
}

export function hasLexaraLiveConsent(): boolean {
  return getLexaraLiveEnabled() !== null;
}

export function isLexaraLiveEnabled(): boolean {
  return getLexaraLiveEnabled() === 'true';
}

export interface LexaraLiveConsentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConsent: (enabled: boolean) => void;
  targetLawArea?: string;
}

const LexaraLiveConsentModal = memo(function LexaraLiveConsentModal({
  isOpen,
  onClose,
  onConsent,
  targetLawArea,
}: LexaraLiveConsentModalProps) {
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [permissionsGranted, setPermissionsGranted] = useState({
    audio: false,
    video: false,
  });

  const requestLivePermissions = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: true,
      });

      const audioGranted = stream.getAudioTracks().length > 0;
      const videoGranted = stream.getVideoTracks().length > 0;
      stream.getTracks().forEach(track => track.stop());

      setPermissionsGranted({ audio: audioGranted, video: videoGranted });
      return { audio: audioGranted, video: videoGranted };
    } catch (combinedError: any) {
      // Camera denial/unavailability must not prevent voice consultation.
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        const audioGranted = audioStream.getAudioTracks().length > 0;
        audioStream.getTracks().forEach(track => track.stop());
        setPermissionsGranted({ audio: audioGranted, video: false });
        return { audio: audioGranted, video: false };
      } catch {
        setPermissionsGranted({ audio: false, video: false });
        if (combinedError?.name === 'NotAllowedError' || combinedError?.name === 'PermissionDeniedError') {
          setError('Microphone/camera permission was denied. You can continue in text-only mode.');
        } else if (combinedError?.name === 'NotFoundError') {
          setError('No compatible microphone or camera was found. You can continue in text-only mode.');
        } else {
          setError('Live devices are unavailable. You can continue in text-only mode.');
        }
        return { audio: false, video: false };
      }
    }
  }, []);

  const handleDisclaimerToggle = useCallback(async (checked: boolean) => {
    setDisclaimerAccepted(checked);
    setError(null);

    if (!checked) {
      setPermissionsGranted({ audio: false, video: false });
      return;
    }

    setIsRequesting(true);
    try {
      await requestLivePermissions();
    } finally {
      setIsRequesting(false);
    }
  }, [requestLivePermissions]);

  const handleEnableLive = useCallback(() => {
    if (!disclaimerAccepted) {
      setError('Please accept the disclaimer first.');
      return;
    }

    // Voice is the essential live-conversation capability. Camera may be absent
    // without forcing text mode, but camera-only permission is not treated as
    // voice consent being operational.
    const liveOperational = permissionsGranted.audio;
    setLexaraLiveEnabled(liveOperational ? 'true' : 'false');
    onConsent(liveOperational);
  }, [disclaimerAccepted, onConsent, permissionsGranted.audio]);

  const handleDecline = useCallback(() => {
    setLexaraLiveEnabled('false');
    onConsent(false);
  }, [onConsent]);

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open && !isRequesting) onClose(); }}>
      <DialogContent
        className="max-w-2xl overflow-hidden border-slate-700/50 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 p-0 text-slate-100"
        onPointerDownOutside={event => { if (isRequesting) event.preventDefault(); }}
        onEscapeKeyDown={event => { if (isRequesting) event.preventDefault(); }}
      >
        <div className="relative p-8 pb-6">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-indigo-500/10" />
          <DialogHeader className="relative">
            <div className="mb-4 flex items-center justify-center gap-3">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-cyan-400/20 blur-xl" />
                <div className="relative rounded-full border border-cyan-500/30 bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 p-3">
                  <Scale className="h-8 w-8 text-cyan-400" />
                </div>
              </div>
            </div>
            <DialogTitle className="text-center text-2xl font-bold text-white">
              Enable LEXARA Live
            </DialogTitle>
            <DialogDescription className="mt-2 text-center text-slate-300">
              {targetLawArea
                ? `Enable real-time voice legal analysis for ${targetLawArea}.`
                : 'Enable real-time voice legal analysis and optional video with LEXARA.'}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-8 pb-6">
          <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
            <Badge className={permissionsGranted.audio
              ? 'flex items-center gap-1.5 border-green-500/30 bg-green-500/15 px-3 py-1 text-green-300'
              : 'flex items-center gap-1.5 border-cyan-500/30 bg-cyan-500/15 px-3 py-1 text-cyan-300'}>
              {permissionsGranted.audio ? <Check className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              Voice {permissionsGranted.audio ? '✓' : 'Input'}
            </Badge>
            <Badge className={permissionsGranted.video
              ? 'flex items-center gap-1.5 border-green-500/30 bg-green-500/15 px-3 py-1 text-green-300'
              : 'flex items-center gap-1.5 border-indigo-500/30 bg-indigo-500/15 px-3 py-1 text-indigo-300'}>
              {permissionsGranted.video ? <Check className="h-3.5 w-3.5" /> : <Video className="h-3.5 w-3.5" />}
              Video {permissionsGranted.video ? '✓' : 'Optional'}
            </Badge>
            <Badge className="flex items-center gap-1.5 border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-emerald-300">
              <Shield className="h-3.5 w-3.5" />
              Permission Controlled
            </Badge>
          </div>

          <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div className="flex-1">
                <p className="mb-1 text-sm font-medium text-amber-200">Legal Disclaimer</p>
                <p className="mb-4 text-sm leading-relaxed text-amber-100/80">
                  LEXARA is an AI legal analysis assistant, not a lawyer. It provides legal information and analysis, does not create an attorney-client relationship, and can make mistakes. Verify important legal authorities and deadlines and consult a licensed attorney when appropriate.
                </p>
                <div className="flex items-start gap-3 border-t border-amber-500/20 pt-3">
                  <Checkbox
                    id="disclaimer-accept"
                    checked={disclaimerAccepted}
                    onCheckedChange={checked => void handleDisclaimerToggle(checked as boolean)}
                    disabled={isRequesting}
                    className="mt-0.5 border-amber-400/50 data-[state=checked]:border-amber-500 data-[state=checked]:bg-amber-500"
                  />
                  <Label htmlFor="disclaimer-accept" className="cursor-pointer text-sm leading-relaxed text-amber-100">
                    I understand and agree to microphone access for live conversation and optional camera access.
                  </Label>
                </div>
              </div>
            </div>
          </div>

          {isRequesting && (
            <div className="mb-4 rounded-lg border border-cyan-500/30 bg-cyan-500/15 p-4 text-center">
              <div className="flex items-center justify-center gap-2 text-cyan-300">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="font-medium">Requesting microphone and camera access…</span>
              </div>
            </div>
          )}

          {disclaimerAccepted && !isRequesting && permissionsGranted.audio && (
            <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/15 p-3 text-center">
              <p className="flex items-center justify-center gap-2 text-sm text-green-300">
                <Check className="h-4 w-4" />
                Microphone access granted{permissionsGranted.video ? ' · camera access granted' : ' · camera unavailable'}
              </p>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/15 p-3 text-center">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}
        </div>

        <div className="space-y-3 p-8 pt-2">
          <Button
            onClick={handleEnableLive}
            disabled={isRequesting || !disclaimerAccepted || !permissionsGranted.audio}
            className="w-full bg-gradient-to-r from-cyan-600 to-indigo-600 py-6 text-base font-medium text-white shadow-lg transition-all hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-50"
          >
            {isRequesting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Waiting for permission…
              </>
            ) : permissionsGranted.audio ? (
              <>
                <Check className="mr-2 h-5 w-5" />
                Continue to LEXARA Live
              </>
            ) : (
              <>
                <Mic className="mr-2 h-5 w-5" />
                Grant microphone access to enable live voice
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            onClick={handleDecline}
            disabled={isRequesting}
            className="w-full text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
          >
            Continue without live features (text only)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

export default LexaraLiveConsentModal;
