import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Loader2, Mic, MicOff, Paperclip, RotateCcw, Send, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SEOHead } from '@/components/SEOHead';
import { GeoconsoleRadarDashboard } from '@/components/geoconsole';
import { useVoiceMode } from '@/hooks/useVoiceMode';
import { useVoiceSynthesis } from '@/hooks/useVoiceSynthesis';
import type { GPSPoint, LocationCandidate } from '@shared/geoconsoleTypes';

type Phase = 'awaiting_target' | 'awaiting_details' | 'acquiring' | 'active' | 'error';

interface Message {
  id: string;
  role: 'spectra' | 'user';
  content: string;
}

interface MediaExtractionResponse {
  success?: boolean;
  point?: GPSPoint | null;
  hasGPS?: boolean;
  hasCaptureTimestamp?: boolean;
  metadata?: Record<string, any>;
  error?: string;
}

interface AcquisitionResponse {
  success: boolean;
  error?: string;
  target?: string;
  details?: string;
  acquisition?: {
    identityConfidence: number;
    locationConfidence: number;
    sourceCount: number;
    evidenceItemCount?: number;
    observationCount: number;
    summary: string;
    verificationStatus: string;
  };
  locationObservations?: GPSPoint[];
  candidateLocations?: LocationCandidate[];
}

const FIRST_PROMPT = 'What is it that you want to locate?';
const DETAILS_PROMPT = 'What information can you give me about the target?';

function combinedLocationConfidence(points: GPSPoint[], fallback = 0): number {
  if (points.length === 0) return Math.max(0, Math.min(1, fallback));

  const groups = new Map<string, number>();
  for (const point of points) {
    const kindFactor =
      point.observationKind === 'historical' ? 0.55 :
      point.observationKind === 'inferred' ? 0.65 :
      point.observationKind === 'interpolated' ? 0.45 :
      point.observationKind === 'predicted' ? 0.25 :
      1;
    const adjusted =
      Math.max(0, Math.min(1, Number(point.confidence) || 0)) * kindFactor;
    const key =
      point.correlationGroup ||
      `${point.source}:${point.provenance?.provider || 'unknown'}`;
    groups.set(key, Math.max(groups.get(key) || 0, adjusted));
  }

  const values = [...groups.values()];
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const corroboration = Math.min(0.08, Math.max(0, values.length - 1) * 0.02);
  return Math.max(fallback, Math.min(0.95, mean + corroboration));
}

function makeMessage(role: Message['role'], content: string): Message {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
  };
}

export default function SpectraPage() {
  const [, setLocation] = useLocation();
  const [phase, setPhase] = useState<Phase>('awaiting_target');
  const [target, setTarget] = useState('');
  const [details, setDetails] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    makeMessage('spectra', FIRST_PROMPT),
  ]);
  const [input, setInput] = useState('');
  const [observations, setObservations] = useState<GPSPoint[]>([]);
  const [candidateLocations, setCandidateLocations] = useState<LocationCandidate[]>([]);
  const [directEvidence, setDirectEvidence] = useState<GPSPoint[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [sourceCount, setSourceCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const messageHandlerRef = useRef<(message: string) => void>(() => undefined);

  const voiceSynthesis = useVoiceSynthesis();
  const voiceMode = useVoiceMode({
    continuous: false,
    interimResults: true,
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        messageHandlerRef.current(text.trim());
      }
    },
  });

  const addMessage = useCallback((role: Message['role'], content: string) => {
    setMessages(previous => [...previous, makeMessage(role, content)]);
  }, []);

  const speakIfEnabled = useCallback((text: string) => {
    if (!voiceMode.isEnabled) return;

    voiceMode.suspendListening();
    voiceSynthesis.speak(text, {
      context: 'guidance',
      autoPlay: true,
      assistantName: 'SPECTRA',
      onEnd: () => voiceMode.resumeListening(),
      onError: () => voiceMode.resumeListening(),
    }).catch(() => {
      voiceMode.resumeListening();
    });
  }, [
    voiceMode.isEnabled,
    voiceMode.resumeListening,
    voiceMode.suspendListening,
    voiceSynthesis,
  ]);

  const resetSession = useCallback(() => {
    requestRef.current += 1;
    setPhase('awaiting_target');
    setTarget('');
    setDetails('');
    setObservations([]);
    setCandidateLocations([]);
    setDirectEvidence([]);
    setConfidence(null);
    setSourceCount(0);
    setLastError(null);
    setInput('');
    setMessages([makeMessage('spectra', FIRST_PROMPT)]);
    speakIfEnabled(FIRST_PROMPT);
  }, [speakIfEnabled]);

  const acquireTarget = useCallback(async (
    targetValue: string,
    detailsValue: string,
    extraEvidence: GPSPoint[] = directEvidence,
  ) => {
    const requestId = ++requestRef.current;
    setPhase('acquiring');
    setLastError(null);

    try {
      const response = await fetch('/api/spectra/acquire', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: targetValue,
          details: detailsValue,
          directEvidence: extraEvidence.map(point => ({
            ...point,
            timestamp: new Date(point.timestamp).toISOString(),
            receivedAt: point.receivedAt
              ? new Date(point.receivedAt).toISOString()
              : undefined,
            provenance: point.provenance
              ? {
                  ...point.provenance,
                  capturedAt: point.provenance.capturedAt
                    ? new Date(point.provenance.capturedAt).toISOString()
                    : undefined,
                }
              : undefined,
          })),
        }),
      });

      const payload = await response.json() as AcquisitionResponse;
      if (requestId !== requestRef.current) return;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Target acquisition failed.');
      }

      const discoveredPoints = Array.isArray(payload.locationObservations)
        ? payload.locationObservations
        : [];
      const mergedByKey = new Map<string, GPSPoint>();
      for (const point of [...extraEvidence, ...discoveredPoints]) {
        const timestamp = new Date(point.timestamp).toISOString();
        const evidenceGroup =
          point.correlationGroup ||
          point.provenance?.recordId ||
          `${point.source}:${point.provenance?.provider || 'unknown'}`;
        const key = [
          Number(point.latitude).toFixed(6),
          Number(point.longitude).toFixed(6),
          timestamp,
          point.source,
          evidenceGroup,
        ].join('|');
        mergedByKey.set(key, point);
      }
      const points = [...mergedByKey.values()].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      const serverLocationConfidence = payload.acquisition?.locationConfidence ?? 0;
      const mergedLocationConfidence = combinedLocationConfidence(
        points,
        serverLocationConfidence,
      );
      setObservations(points);
      setCandidateLocations(Array.isArray(payload.candidateLocations) ? payload.candidateLocations : []);
      setConfidence(
        points.length > 0 || serverLocationConfidence > 0
          ? mergedLocationConfidence
          : null
      );
      setSourceCount(payload.acquisition?.sourceCount ?? 0);
      setPhase('active');

      const certainty = points.length > 0 || serverLocationConfidence > 0
        ? Math.round(mergedLocationConfidence * 100)
        : null;

      const regionalCandidates = Array.isArray(payload.candidateLocations)
        ? payload.candidateLocations
        : [];
      const responseText = points.length > 0
        ? `I acquired ${points.length} timestamped location observation${points.length === 1 ? '' : 's'} for ${targetValue}. The map is updated${certainty !== null ? ` with ${certainty}% location-evidence confidence` : ''}.`
        : regionalCandidates.length > 0
          ? `I found a regional location candidate for ${targetValue} and placed it on the map. I do not yet have timestamped coordinate evidence for a movement track.`
          : `I completed the search for ${targetValue} across ${payload.acquisition?.sourceCount ?? 0} source${(payload.acquisition?.sourceCount ?? 0) === 1 ? '' : 's'}, but I do not yet have timestamped coordinate evidence strong enough to place the target on the map.`;

      addMessage('spectra', responseText);
      speakIfEnabled(responseText);
    } catch (error) {
      if (requestId !== requestRef.current) return;
      const message = error instanceof Error ? error.message : 'Target acquisition failed.';
      setLastError(message);
      setPhase('error');
      const responseText = 'I could not complete that acquisition. Give me corrected or additional target information and I will try again.';
      addMessage('spectra', responseText);
      speakIfEnabled(responseText);
    }
  }, [addMessage, directEvidence, speakIfEnabled]);

  const handleMediaEvidence = useCallback(async (file: File) => {
    if (phase === 'awaiting_target') {
      const response = 'Tell me what you want to locate first. Then I can use that media as target information.';
      addMessage('spectra', response);
      speakIfEnabled(response);
      return;
    }
    if (phase === 'acquiring') return;

    addMessage('user', `Shared target media: ${file.name}`);
    setLastError(null);

    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/gps/extract-upload', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const payload = await response.json() as MediaExtractionResponse;

      if (!response.ok) {
        throw new Error(payload.error || 'Media analysis failed.');
      }

      const extractedPoint = payload.point || null;
      const nextDirectEvidence = extractedPoint
        ? [...directEvidence, extractedPoint]
        : directEvidence;

      if (extractedPoint) {
        setDirectEvidence(nextDirectEvidence);
      }

      const device = payload.metadata?.device;
      const capture = payload.metadata?.capture;
      const evidenceDescription = [
        `Uploaded target media: ${file.name}`,
        device?.make || device?.model
          ? `Device: ${[device?.make, device?.model].filter(Boolean).join(' ')}`
          : '',
        capture?.dateTimeOriginal ? `Capture time metadata: ${capture.dateTimeOriginal}` : '',
        extractedPoint ? 'Timestamped GPS metadata present.' : 'No timestamped GPS metadata present.',
      ].filter(Boolean).join('. ');

      const expandedDetails = [details, evidenceDescription].filter(Boolean).join('\n');
      setDetails(expandedDetails);

      const responseText = extractedPoint
        ? 'I extracted timestamped location metadata from that media and added it to the target evidence.'
        : 'I analyzed that media and added the available metadata to the target evidence. It did not contain timestamped GPS coordinates.';
      addMessage('spectra', responseText);
      speakIfEnabled(responseText);

      await acquireTarget(target, expandedDetails, nextDirectEvidence);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Media analysis failed.';
      setLastError(message);
      addMessage('spectra', 'I could not analyze that media. You can continue by telling me what you know about the target.');
    } finally {
      if (mediaInputRef.current) mediaInputRef.current.value = '';
    }
  }, [
    acquireTarget,
    addMessage,
    details,
    directEvidence,
    phase,
    speakIfEnabled,
    target,
  ]);

  const handleUserMessage = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || phase === 'acquiring') return;

    if (/^(new target|start over|reset|new search)$/i.test(message)) {
      resetSession();
      return;
    }

    addMessage('user', message);
    setInput('');

    if (phase === 'awaiting_target') {
      setTarget(message);
      setPhase('awaiting_details');
      addMessage('spectra', DETAILS_PROMPT);
      speakIfEnabled(DETAILS_PROMPT);
      return;
    }

    if (phase === 'awaiting_details') {
      setDetails(message);
      await acquireTarget(target, message);
      return;
    }

    const expandedDetails = [details, message].filter(Boolean).join('\n');
    setDetails(expandedDetails);
    await acquireTarget(target, expandedDetails);
  }, [
    acquireTarget,
    addMessage,
    details,
    phase,
    resetSession,
    speakIfEnabled,
    target,
  ]);

  useEffect(() => {
    messageHandlerRef.current = (message: string) => {
      void handleUserMessage(message);
    };
  }, [handleUserMessage]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, phase]);

  useEffect(() => {
    // Keep the microphone suspended from the instant a SPECTRA turn starts
    // loading until audible playback has fully ended. This prevents the
    // recognizer from hearing SPECTRA's own voice or restarting during TTS fetch.
    if (voiceSynthesis.isLoading || voiceSynthesis.isSpeaking) {
      if (voiceMode.isEnabled && !voiceMode.isSuspended) {
        voiceMode.suspendListening();
      }
      return;
    }

    if (
      voiceMode.isEnabled &&
      !voiceMode.isListening &&
      !voiceMode.isSuspended &&
      phase !== 'acquiring'
    ) {
      voiceMode.startListening();
    }
  }, [
    phase,
    voiceMode.isEnabled,
    voiceMode.isListening,
    voiceMode.isSuspended,
    voiceMode.startListening,
    voiceMode.suspendListening,
    voiceSynthesis.isLoading,
    voiceSynthesis.isSpeaking,
  ]);

  const toggleVoice = useCallback(async () => {
    if (voiceMode.isEnabled) {
      voiceMode.disable();
      return;
    }
    try {
      await voiceMode.enable();
      voiceMode.startListening();
    } catch {
      // Text remains the primary input if microphone permission is unavailable.
    }
  }, [voiceMode]);

  const mapStatus = useMemo(() => {
    if (phase === 'acquiring') return 'Acquiring target…';
    if (observations.length > 0) {
      return confidence == null
        ? `${observations.length} location observation${observations.length === 1 ? '' : 's'}`
        : `${Math.round(confidence * 100)}% location-evidence confidence`;
    }
    if (candidateLocations.length > 0) return 'Regional candidate mapped';
    if (target) return `Target: ${target}`;
    return 'Waiting for target';
  }, [candidateLocations.length, confidence, observations.length, phase, target]);

  const placeholder =
    phase === 'awaiting_target'
      ? 'Tell SPECTRA what you want to locate…'
      : phase === 'awaiting_details'
        ? 'Tell SPECTRA what you know about the target…'
        : phase === 'acquiring'
          ? 'SPECTRA is acquiring the target…'
          : 'Add information, or say “new target”…';

  const showMap =
    phase === 'acquiring' ||
    phase === 'active' ||
    observations.length > 0 ||
    candidateLocations.length > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <SEOHead
        title="SPECTRA | LegalWhat"
        description="SPECTRA unified target acquisition and geospatial intelligence."
      />

      <header className="h-14 border-b border-slate-800 bg-slate-950/95 backdrop-blur flex items-center justify-between px-3 sm:px-5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation('/welcome')}
          className="text-slate-300 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>

        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-cyan-400" />
          <span className="font-semibold tracking-[0.18em] text-cyan-300">SPECTRA</span>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={resetSession}
          className="text-slate-400 hover:text-white"
          title="New target"
          aria-label="New target"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </header>

      <main className={
        showMap
          ? 'h-[calc(100vh-3.5rem)] min-h-[620px] grid grid-rows-[minmax(340px,58vh)_minmax(280px,1fr)] lg:grid-rows-1 lg:grid-cols-[minmax(0,1fr)_380px]'
          : 'h-[calc(100vh-3.5rem)] min-h-[560px] flex items-stretch justify-center'
      }>
        {showMap && <section className="relative min-h-0 border-b lg:border-b-0 lg:border-r border-slate-800">
          <GeoconsoleRadarDashboard
            initialData={observations}
            candidateLocations={candidateLocations}
            subject={target || 'SPECTRA target'}
            spectraShell
          />

          <div className="pointer-events-none absolute left-3 top-3 z-30 rounded-full border border-slate-700/70 bg-slate-950/85 px-3 py-1.5 text-xs text-slate-200 shadow-xl backdrop-blur">
            {mapStatus}
          </div>

          {phase === 'acquiring' && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-950/20">
              <div className="flex items-center gap-2 rounded-full border border-cyan-500/30 bg-slate-950/90 px-4 py-2 text-sm text-cyan-200 shadow-xl backdrop-blur">
                <Loader2 className="h-4 w-4 animate-spin" />
                SPECTRA is correlating available evidence
              </div>
            </div>
          )}
        </section>}

        <section
          data-testid="spectra-console"
          className={showMap
            ? 'min-h-0 flex flex-col bg-slate-950'
            : 'min-h-0 flex w-full max-w-2xl flex-col bg-slate-950 sm:border-x sm:border-slate-800'
          }
        >
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h1 className="text-sm font-semibold text-slate-100">SPECTRA Console</h1>
                <p className="text-[11px] text-slate-500">
                  {sourceCount > 0 ? `${sourceCount} sources correlated` : 'Tell SPECTRA what you need located'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void toggleVoice()}
                className={voiceMode.isEnabled ? 'text-cyan-300 bg-cyan-500/10' : 'text-slate-400'}
                title={voiceMode.isEnabled ? 'Turn voice off' : 'Turn voice on'}
                aria-label={voiceMode.isEnabled ? 'Turn voice off' : 'Turn voice on'}
              >
                {voiceMode.isEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
            {messages.map(message => (
              <div
                key={message.id}
                className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className={
                    message.role === 'user'
                      ? 'max-w-[88%] rounded-2xl rounded-br-md bg-slate-800 px-4 py-3 text-sm leading-relaxed text-slate-100'
                      : 'max-w-[92%] rounded-2xl rounded-bl-md border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm leading-relaxed text-slate-100'
                  }
                >
                  {message.content}
                </div>
              </div>
            ))}

            {phase === 'acquiring' && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Acquiring…
                </div>
              </div>
            )}

            {lastError && (
              <div className="text-xs text-rose-300 px-1">{lastError}</div>
            )}

            <div ref={scrollRef} />
          </div>

          <form
            onSubmit={event => {
              event.preventDefault();
              void handleUserMessage(input);
            }}
            className="border-t border-slate-800 p-3"
          >
            <input
              ref={mediaInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) void handleMediaEvidence(file);
              }}
            />
            <div
              className="flex items-end gap-2"
              onDragOver={event => {
                if (phase !== 'awaiting_target' && phase !== 'acquiring') {
                  event.preventDefault();
                }
              }}
              onDrop={event => {
                if (phase === 'awaiting_target' || phase === 'acquiring') return;
                event.preventDefault();
                const file = event.dataTransfer.files?.[0];
                if (file) void handleMediaEvidence(file);
              }}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={phase === 'awaiting_target' || phase === 'acquiring'}
                onClick={() => mediaInputRef.current?.click()}
                className="h-11 w-11 shrink-0 rounded-full text-slate-400 hover:text-cyan-300"
                title="Add target photo or video"
                aria-label="Add target photo or video"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <textarea
                data-testid="spectra-input"
                value={input}
                onChange={event => setInput(event.target.value)}
                onPaste={event => {
                  if (phase === 'awaiting_target' || phase === 'acquiring') return;
                  const file = Array.from(event.clipboardData.files || []).find(item =>
                    item.type.startsWith('image/') || item.type.startsWith('video/')
                  );
                  if (file) {
                    event.preventDefault();
                    void handleMediaEvidence(file);
                  }
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void handleUserMessage(input);
                  }
                }}
                rows={1}
                disabled={phase === 'acquiring'}
                placeholder={placeholder}
                className="min-h-11 max-h-28 flex-1 resize-none rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-500/50"
              />
              <Button
                data-testid="spectra-send"
                type="submit"
                size="icon"
                disabled={!input.trim() || phase === 'acquiring'}
                className="h-11 w-11 shrink-0 rounded-full bg-cyan-600 hover:bg-cyan-500"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
