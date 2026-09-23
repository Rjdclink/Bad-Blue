import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import { ArrowLeft, Check, Loader2, Mic, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { LAW_TYPE_DATA } from '@shared/lawTypes';
import { SEOHead } from '@/components/SEOHead';
import { setLexaraLiveEnabled } from '@/components/LexaraLiveConsentModal';
import { unlockAudio } from '@/lib/lexaraSpeechClient';

function consentMicrophoneConstraints(): MediaTrackConstraints {
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
  const constraints: MediaTrackConstraints = {};
  if (supported.echoCancellation) constraints.echoCancellation = true;
  if (supported.noiseSuppression) constraints.noiseSuppression = true;
  if (supported.autoGainControl) constraints.autoGainControl = true;
  if (supported.channelCount) constraints.channelCount = { ideal: 1 };
  return constraints;
}

export default function LexaraConsentPage() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute('/lexara-consent/:domainId');
  const domainId = params?.domainId;
  const domainInfo = useMemo(
    () => LAW_TYPE_DATA.find(type => type.id === domainId),
    [domainId],
  );

  const [accepted, setAccepted] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [speakerReady, setSpeakerReady] = useState(false);
  const [voiceServiceReady, setVoiceServiceReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const prepareLiveConversation = useCallback(async () => {
    setPreparing(true);
    setError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser cannot open a microphone.');
      }

      const standardsCaptureSupported =
        'MediaRecorder' in window
        && !!((window as any).AudioContext || (window as any).webkitAudioContext);
      const browserSpeechSupported =
        'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;

      if (!standardsCaptureSupported && !browserSpeechSupported) {
        throw new Error('This browser is too old for live voice.');
      }

      const readinessPromise = fetch('/api/lexara/voice/live-readiness', {
        method: 'GET',
        cache: 'no-store',
      })
        .then(async response => {
          if (!response.ok) return null;
          return response.json();
        })
        .catch(() => null);

      const [audioUnlocked, stream, readiness] = await Promise.all([
        unlockAudio(),
        navigator.mediaDevices.getUserMedia({
          audio: consentMicrophoneConstraints(),
          video: false,
        }),
        readinessPromise,
      ]);

      const microphoneGranted = stream.getAudioTracks().length > 0;
      stream.getTracks().forEach(track => track.stop());

      const backendReady =
        readiness?.liveVoiceConfigured === true
        && readiness?.speechOutputVerified === true
        && readiness?.legalReasoningConfigured !== false;
      setMicReady(microphoneGranted);
      setSpeakerReady(audioUnlocked);
      setVoiceServiceReady(readiness ? backendReady : null);

      if (!backendReady) {
        setError('LEXARA live conversation is temporarily unavailable on the server. You can still continue by typing.');
      } else if (!microphoneGranted || !audioUnlocked) {
        setError('LEXARA could not fully prepare your microphone and sound. Check browser permissions and try again.');
      }
    } catch (permissionError: any) {
      setMicReady(false);
      setSpeakerReady(false);
      setVoiceServiceReady(null);
      const name = String(permissionError?.name || '');
      setError(
        name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? 'Microphone permission was denied. Allow microphone access in your browser and try again.'
          : 'LEXARA could not initialize live audio on this device. Check microphone access and try again.',
      );
    } finally {
      setPreparing(false);
    }
  }, []);

  const handleAcceptance = useCallback(async (checked: boolean) => {
    setAccepted(checked);
    if (!checked) {
      setMicReady(false);
      setSpeakerReady(false);
      setVoiceServiceReady(null);
      setError(null);
      return;
    }
    await prepareLiveConversation();
  }, [prepareLiveConversation]);

  const continueLive = useCallback(() => {
    if (!domainId || !accepted || !micReady || !speakerReady || voiceServiceReady !== true) return;
    setLexaraLiveEnabled('true');
    setLocation(`/legal-consultation/${domainId}?live=true`);
  }, [accepted, domainId, micReady, setLocation, speakerReady, voiceServiceReady]);

  useEffect(() => {
    if (!domainId || !accepted || !micReady || !speakerReady || voiceServiceReady !== true || preparing) return;
    setLexaraLiveEnabled('true');
    setLocation(`/legal-consultation/${domainId}?live=true`, { replace: true });
  }, [accepted, domainId, micReady, preparing, setLocation, speakerReady, voiceServiceReady]);

  const continueTextOnly = useCallback(() => {
    if (!domainId) return;
    setLexaraLiveEnabled('false');
    setLocation(`/legal-consultation/${domainId}?live=false`);
  }, [domainId, setLocation]);

  if (!domainInfo || !domainId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <div className="max-w-md text-center">
          <p className="mb-4">That legal area could not be loaded.</p>
          <Button onClick={() => setLocation('/welcome')}>Return to the law library</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-white">
      <SEOHead
        title={`LEXARA Live Consent - ${domainInfo.name} | LegalWhat`}
        description="Prepare microphone and audio playback before entering a LEXARA live legal consultation."
        canonicalUrl={`https://legalwhat.com/lexara-consent/${domainId}`}
      />

      <div className="mx-auto grid min-h-[100dvh] max-w-6xl grid-cols-1 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative min-h-[38vh] overflow-hidden lg:min-h-screen">
          <img
            src="/images/oip.webp?v=20260918-lexara3"
            alt="LEXARA legal professional seated behind her desk"
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/15 to-transparent lg:bg-gradient-to-r lg:from-transparent lg:via-slate-950/10 lg:to-slate-950" />
          <div className="absolute bottom-5 left-5 right-5 rounded-2xl border border-white/15 bg-slate-950/70 p-4 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">LEXARA Live</p>
            <h1 className="mt-1 text-2xl font-semibold">{domainInfo.name}</h1>
            <p className="mt-2 text-sm text-slate-300">Prepare the conversation once, then speak naturally.</p>
          </div>
        </section>

        <section className="flex min-h-[62vh] items-center p-5 sm:p-8 lg:min-h-screen lg:p-12">
          <div className="w-full rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-2xl backdrop-blur sm:p-8">
            <Button
              variant="ghost"
              onClick={() => setLocation('/welcome')}
              className="mb-5 -ml-3 gap-2 text-slate-300 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to law library
            </Button>

            <h2 className="text-2xl font-bold">Ready to talk?</h2>
            <p className="mt-3 text-base leading-relaxed text-slate-200 sm:text-sm">
              LEXARA needs your microphone so you can speak naturally, and sound enabled so you can hear her replies. You can switch to typing at any time.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-slate-400">
              LEXARA provides AI legal information and analysis, not an attorney-client relationship. Verify important authorities and deadlines before relying on them.
            </p>

            <div className="mt-6 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="lexara-live-consent"
                  checked={accepted}
                  disabled={preparing}
                  onCheckedChange={value => void handleAcceptance(value === true)}
                  className="mt-1"
                />
                <Label htmlFor="lexara-live-consent" className="cursor-pointer text-sm leading-relaxed text-slate-200">
                  I agree to let LEXARA use my microphone for this conversation and play her spoken replies.
                </Label>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center gap-2">
                  {micReady ? <Check className="h-5 w-5 text-emerald-400" /> : <Mic className="h-5 w-5 text-cyan-300" />}
                  <span className="font-medium">Microphone</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">{micReady ? 'Ready' : 'Permission required'}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center gap-2">
                  {speakerReady ? <Check className="h-5 w-5 text-emerald-400" /> : <Volume2 className="h-5 w-5 text-cyan-300" />}
                  <span className="font-medium">Sound</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">{speakerReady ? 'Ready' : 'Needs activation'}</p>
              </div>
            </div>

            {voiceServiceReady === true && !preparing && (
              <p className="mt-4 text-center text-xs text-emerald-300">
                LEXARA voice and legal reasoning are configured.
              </p>
            )}

            {preparing && (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-sm text-cyan-200">
                <Loader2 className="h-4 w-4 animate-spin" />
                Preparing microphone and audio…
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                {error}
              </div>
            )}

            <Button
              onClick={continueLive}
              disabled={!accepted || !micReady || !speakerReady || voiceServiceReady === false || preparing}
              className="mt-6 min-h-12 w-full touch-manipulation py-6 text-base"
            >
              Start conversation
            </Button>
            <Button
              variant="ghost"
              onClick={continueTextOnly}
              disabled={preparing}
              className="mt-2 min-h-11 w-full touch-manipulation text-slate-400 hover:text-slate-200"
            >
              Use typing instead
            </Button>

            {error && accepted && !preparing && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void prepareLiveConversation()}
                className="mt-3 min-h-11 w-full touch-manipulation border-white/20 bg-white/5 text-white hover:bg-white/10"
              >
                Try audio setup again
              </Button>
            )}

            <p className="mt-4 text-center text-xs text-slate-500">
              Designed for modern Android and Apple phones and tablets, Macs, and Windows PCs. If voice cannot start, typing always remains available.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
