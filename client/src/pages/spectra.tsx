import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Loader2, Mic, MicOff, Paperclip, RotateCcw, Send, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SEOHead } from '@/components/SEOHead';
import { GeoconsoleRadarDashboard } from '@/components/geoconsole';
import { useVoiceMode } from '@/hooks/useVoiceMode';
import { useVoiceSynthesis } from '@/hooks/useVoiceSynthesis';
import { getLexaraLiveEnabled } from '@/components/LexaraLiveConsentModal';
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

interface TelemetryImportResponse {
  success?: boolean;
  error?: string;
  data?: {
    sessionId?: string;
    parsedObservationCount?: number;
    processedObservationCount?: number;
    persistence?: { available?: boolean };
  };
}

function isSpectraTelemetryFile(file: File): boolean {
  const extension = file.name.toLowerCase().split('.').pop() || '';
  return ['geojson', 'gpx', 'kml', 'nmea', 'csv', 'ndjson', 'jsonl', 'log', 'txt'].includes(extension);
}

interface SpectraLaunchPayload {
  target: string;
  clues: string;
  lexaraSessionId?: string;
  conversation?: Array<{
    role?: string;
    content?: string;
    timestamp?: string;
  }>;
}

function readLexaraSpectraLaunch(): SpectraLaunchPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem('legalwhat:spectra-launch');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const target = String(parsed?.target || '').trim();
    const clues = String(parsed?.clues || '').trim();
    if (!target || !clues) return null;
    return {
      target: target.slice(0, 500),
      clues: clues.slice(-8_000),
      lexaraSessionId: typeof parsed?.lexaraSessionId === 'string'
        ? parsed.lexaraSessionId.slice(0, 200)
        : undefined,
      conversation: Array.isArray(parsed?.conversation)
        ? parsed.conversation.slice(-30)
        : undefined,
    };
  } catch {
    return null;
  }
}

function launchDetails(launch: SpectraLaunchPayload): string {
  const conversation = (launch.conversation || [])
    .map(item => {
      const role = item?.role === 'lexara' ? 'LEXARA' : 'USER';
      const content = String(item?.content || '').replace(/\s+/g, ' ').trim();
      return content ? `${role}: ${content}` : '';
    })
    .filter(Boolean)
    .join('\n');

  return [
    launch.clues,
    conversation ? `LEXARA conversation context:\n${conversation}` : '',
  ].filter(Boolean).join('\n\n').slice(-10_000);
}

interface AcquisitionResponse {
  success: boolean;
  error?: string;
  target?: string;
  details?: string;
  resolvedTargetLabel?: string;
  sessionId?: string;
  persistenceAvailable?: boolean;
  acquisition?: {
    identityConfidence: number;
    locationConfidence: number;
    sourceCount: number;
    evidenceItemCount?: number;
    observationCount: number;
    discoveryPasses?: number;
    discoveryQueriesAttempted?: number;
    discoveryQueriesFailed?: number;
    summary: string;
    verificationStatus: string;
  };
  locationObservations?: GPSPoint[];
  candidateLocations?: LocationCandidate[];
}

const FIRST_PROMPT = 'What is it that you want to locate?';
const DETAILS_PROMPT = 'What information can you give me about the target?';
const CONTINUOUS_ACQUISITION_DELAY_MS = 1_500;

interface AcquireTargetOptions {
  backgroundPass?: boolean;
  signal?: AbortSignal;
  recursivePass?: number;
  queryStartedAt?: string;
}

function createSpectraSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `spectra-${crypto.randomUUID()}`;
    }
  } catch {
    // Fall through to the compatibility identifier.
  }
  return `spectra-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
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
  const lexaraLaunchRef = useRef<SpectraLaunchPayload | null>(readLexaraSpectraLaunch());
  const initialLexaraLaunch = lexaraLaunchRef.current;
  const launchedFromLexaraRef = useRef(Boolean(initialLexaraLaunch));
  const originLexaraSessionIdRef = useRef<string | null>(
    initialLexaraLaunch?.lexaraSessionId || null
  );
  const [phase, setPhase] = useState<Phase>(
    initialLexaraLaunch ? 'acquiring' : 'awaiting_target'
  );
  const [target, setTarget] = useState(initialLexaraLaunch?.target || '');
  const [details, setDetails] = useState(
    initialLexaraLaunch ? launchDetails(initialLexaraLaunch) : ''
  );
  const [messages, setMessages] = useState<Message[]>([
    initialLexaraLaunch
      ? makeMessage('spectra', 'LEXARA context received. Opening the SPECTRA investigation…')
      : makeMessage('spectra', FIRST_PROMPT),
  ]);
  const [input, setInput] = useState('');
  const [observations, setObservations] = useState<GPSPoint[]>([]);
  const [candidateLocations, setCandidateLocations] = useState<LocationCandidate[]>([]);
  const [directEvidence, setDirectEvidence] = useState<GPSPoint[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [sourceCount, setSourceCount] = useState(0);
  const [spectraSessionId, setSpectraSessionId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [acquisitionStage, setAcquisitionStage] = useState('Waiting for target');
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const messageHandlerRef = useRef<(message: string) => void>(() => undefined);
  const lastSpokenTextRef = useRef<{ normalized: string; expiresAt: number } | null>(null);
  const recentVoiceTurnRef = useRef<{ normalized: string; at: number } | null>(null);
  const initialVoicePromptRef = useRef(false);
  const queryStartedAtRef = useRef(new Date().toISOString());
  const spectraSessionIdRef = useRef<string | null>(null);
  const targetRef = useRef(target);
  const detailsRef = useRef(details);
  const directEvidenceRef = useRef(directEvidence);
  const continuousAcquisitionActiveRef = useRef(false);
  const continuousAcquisitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAcquisitionAbortRef = useRef<AbortController | null>(null);
  const recursivePassRef = useRef(0);
  const hardStopRef = useRef<(reason?: string, notifyServer?: boolean) => void>(() => undefined);

  useEffect(() => {
    targetRef.current = target;
    detailsRef.current = details;
    directEvidenceRef.current = directEvidence;
    spectraSessionIdRef.current = spectraSessionId;
  }, [details, directEvidence, spectraSessionId, target]);

  const voiceSynthesis = useVoiceSynthesis();
  const voiceMode = useVoiceMode({
    continuous: false,
    interimResults: true,
    onTranscript: (text, isFinal, meta) => {
      if (!isFinal) return;

      const cleaned = text.replace(/\s+/g, ' ').trim();
      if (!cleaned) return;

      const normalized = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const now = Date.now();
      const spoken = lastSpokenTextRef.current;
      const recent = recentVoiceTurnRef.current;

      // Browser recognizers expose confidence inconsistently. A real positive
      // confidence below this floor is too weak to advance a target workflow;
      // zero/undefined means the engine did not supply a usable score.
      if (
        meta?.confidence !== undefined &&
        meta.confidence > 0 &&
        meta.confidence < 0.45
      ) {
        return;
      }

      // Do not let SPECTRA's own audible prompt become the user's next answer.
      if (
        spoken &&
        now <= spoken.expiresAt &&
        normalized &&
        (
          normalized === spoken.normalized ||
          spoken.normalized.includes(normalized) ||
          normalized.includes(spoken.normalized)
        )
      ) {
        return;
      }

      if (
        recent &&
        recent.normalized === normalized &&
        now - recent.at < 4_000
      ) {
        return;
      }

      recentVoiceTurnRef.current = { normalized, at: now };
      messageHandlerRef.current(cleaned);
    },
  });

  const addMessage = useCallback((role: Message['role'], content: string) => {
    setMessages(previous => [...previous, makeMessage(role, content)]);
  }, []);

  useEffect(() => {
    if (launchedFromLexaraRef.current) return;
    if (initialVoicePromptRef.current || getLexaraLiveEnabled() !== 'true') return;
    initialVoicePromptRef.current = true;

    void (async () => {
      try {
        await voiceMode.enable();
        await voiceSynthesis.speak(FIRST_PROMPT, {
          context: 'guidance',
          autoPlay: true,
          assistantName: 'SPECTRA',
          onEnd: () => voiceMode.startListening(),
          onError: () => voiceMode.startListening(),
        });
      } catch {
        // Keep the typed SPECTRA workflow available when browser audio policy
        // or microphone permission prevents automatic voice activation.
      }
    })();
  }, [voiceMode.enable, voiceMode.startListening, voiceSynthesis]);

  const speakIfEnabled = useCallback((text: string) => {
    if (!voiceMode.isEnabled) return;

    const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    lastSpokenTextRef.current = {
      normalized,
      expiresAt: Date.now() + Math.max(8_000, text.length * 90),
    };

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
    hardStopRef.current('new_target', true);
    queryStartedAtRef.current = new Date().toISOString();
    recursivePassRef.current = 0;
    spectraSessionIdRef.current = null;
    requestRef.current += 1;
    launchedFromLexaraRef.current = false;
    originLexaraSessionIdRef.current = null;
    setPhase('awaiting_target');
    setTarget('');
    setDetails('');
    setObservations([]);
    setCandidateLocations([]);
    setDirectEvidence([]);
    setConfidence(null);
    setSourceCount(0);
    setSpectraSessionId(null);
    setLastError(null);
    setAcquisitionStage('Waiting for target');
    setInput('');
    setMessages([makeMessage('spectra', FIRST_PROMPT)]);
    speakIfEnabled(FIRST_PROMPT);
  }, [speakIfEnabled]);

  const acquireTarget = useCallback(async (
    targetValue: string,
    detailsValue: string,
    extraEvidence: GPSPoint[] = directEvidence,
    sessionOverride?: string,
    options: AcquireTargetOptions = {},
  ): Promise<AcquisitionResponse | null> => {
    const backgroundPass = options.backgroundPass === true;

    if (!backgroundPass && activeAcquisitionAbortRef.current) {
      activeAcquisitionAbortRef.current.abort(new Error('SPECTRA foreground acquisition superseded the background pass.'));
      activeAcquisitionAbortRef.current = null;
    }

    const localController = options.signal ? null : new AbortController();
    const acquisitionSignal = options.signal || localController?.signal;
    if (!backgroundPass && localController) {
      activeAcquisitionAbortRef.current = localController;
    }

    const requestId = ++requestRef.current;
    const resolvedSessionId =
      sessionOverride ||
      spectraSessionIdRef.current ||
      createSpectraSessionId();

    if (spectraSessionIdRef.current !== resolvedSessionId) {
      spectraSessionIdRef.current = resolvedSessionId;
      setSpectraSessionId(resolvedSessionId);
    }

    if (!backgroundPass) {
      setPhase('acquiring');
      setLastError(null);
      setAcquisitionStage('Resolving supplied location context…');
    } else {
      setAcquisitionStage(
        `Continuous recursive acquisition · pass ${Math.max(1, options.recursivePass || 1)}`,
      );
    }

    // Put evidence already in hand on the map immediately. Deep discovery may
    // take substantially longer, but the viewer should never lose verified
    // evidence while the next acquisition pass is running.
    if (extraEvidence.length > 0) {
      setObservations(previous => {
        const merged = new Map<string, GPSPoint>();
        for (const point of [...previous, ...extraEvidence]) {
          const timestamp = new Date(point.timestamp).toISOString();
          const evidenceGroup =
            point.correlationGroup ||
            point.provenance?.recordId ||
            `${point.source}:${point.provenance?.provider || 'unknown'}`;
          merged.set([
            Number(point.latitude).toFixed(6),
            Number(point.longitude).toFixed(6),
            timestamp,
            point.source,
            evidenceGroup,
          ].join('|'), point);
        }
        return [...merged.values()].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
      });
    }

    const previewRegionPromise = backgroundPass
      ? Promise.resolve()
      : (async () => {
          for (const locationText of [detailsValue, targetValue]) {
            if (!locationText.trim()) continue;
            try {
              const previewResponse = await fetch('/api/geoconsole/geocode-city-state', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ location: locationText }),
                signal: acquisitionSignal,
              });
              const previewPayload = await previewResponse.json().catch(() => ({}));
              if (
                requestId !== requestRef.current ||
                !previewResponse.ok ||
                previewPayload?.success !== true
              ) {
                continue;
              }

              const region = previewPayload.data;
              if (
                Number.isFinite(Number(region?.latitude)) &&
                Number.isFinite(Number(region?.longitude))
              ) {
                setCandidateLocations([{
                  latitude: Number(region.latitude),
                  longitude: Number(region.longitude),
                  label: String(region.displayName || locationText),
                  confidence: 0.25,
                  basis: 'regional_context',
                  accuracyMeters: Number.isFinite(Number(region.accuracyMeters))
                    ? Number(region.accuracyMeters)
                    : 25_000,
                }]);
                setAcquisitionStage('Regional context mapped; broadening identity discovery…');
                return;
              }
            } catch (error) {
              if (acquisitionSignal?.aborted) return;
              // Regional preview is advisory and must never block deeper discovery.
            }
          }
          if (requestId === requestRef.current) {
            setAcquisitionStage('Broadening identity and source discovery…');
          }
        })();

    try {
      void previewRegionPromise;
      const response = await fetch('/api/spectra/acquire', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: acquisitionSignal,
        body: JSON.stringify({
          target: targetValue,
          details: detailsValue,
          sessionId: resolvedSessionId,
          originSessionId: originLexaraSessionIdRef.current || undefined,
          queryStartedAt: options.queryStartedAt || queryStartedAtRef.current,
          recursivePass: Math.max(0, options.recursivePass || 0),
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

      const payload = await response.json().catch(() => ({})) as AcquisitionResponse;
      if (requestId !== requestRef.current) return null;

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

      const canonicalLocationConfidence = payload.acquisition?.locationConfidence ?? 0;
      setObservations(points);
      setCandidateLocations(Array.isArray(payload.candidateLocations) ? payload.candidateLocations : []);
      setConfidence(
        points.length > 0 || canonicalLocationConfidence > 0
          ? canonicalLocationConfidence
          : null
      );
      setSourceCount(payload.acquisition?.sourceCount ?? 0);
      if (typeof payload.sessionId === 'string' && payload.sessionId.trim()) {
        const returnedSessionId = payload.sessionId.trim();
        spectraSessionIdRef.current = returnedSessionId;
        setSpectraSessionId(returnedSessionId);
      }

      if (!backgroundPass) {
        setPhase('active');
      } else {
        setLastError(null);
        setAcquisitionStage(
          `Continuous recursive acquisition · pass ${Math.max(1, options.recursivePass || 1)} complete`,
        );
      }

      if (!backgroundPass) {
        const certainty = points.length > 0 || canonicalLocationConfidence > 0
          ? Math.round(canonicalLocationConfidence * 100)
          : null;

        const regionalCandidates = Array.isArray(payload.candidateLocations)
          ? payload.candidateLocations
          : [];
        const resolvedTarget = payload.resolvedTargetLabel?.trim() || targetValue;
        const responseText = points.length > 0
          ? `I acquired ${points.length} timestamped location observation${points.length === 1 ? '' : 's'} for ${resolvedTarget}. The map is updated${certainty !== null ? ` with ${certainty}% location-evidence confidence` : ''}.`
          : regionalCandidates.length > 0
            ? `I found a regional location candidate for ${resolvedTarget} and placed it on the map. I do not yet have timestamped coordinate evidence for a movement track.`
            : `I completed the current discovery pass for ${resolvedTarget} across ${payload.acquisition?.sourceCount ?? 0} distinct source group${(payload.acquisition?.sourceCount ?? 0) === 1 ? '' : 's'}, but I do not yet have timestamped coordinate evidence strong enough to place the target precisely on the map.`;

        addMessage('spectra', responseText);
        speakIfEnabled(responseText);
      }

      return payload;
    } catch (error) {
      if (
        acquisitionSignal?.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        return null;
      }
      if (requestId !== requestRef.current) return null;

      const message = error instanceof Error ? error.message : 'Target acquisition failed.';
      if (backgroundPass) {
        setLastError(message);
        setAcquisitionStage('Continuous acquisition retrying…');
        return null;
      }

      setLastError(message);
      setAcquisitionStage('Acquisition needs additional information');
      setPhase('error');
      const responseText = 'I could not complete that acquisition. Give me corrected or additional target information and I will try again.';
      addMessage('spectra', responseText);
      speakIfEnabled(responseText);
      return null;
    } finally {
      if (
        localController
        && activeAcquisitionAbortRef.current === localController
      ) {
        activeAcquisitionAbortRef.current = null;
      }
    }
  }, [addMessage, directEvidence, speakIfEnabled]);

  const stopContinuousAcquisition = useCallback((
    reason = 'viewer_exit',
    notifyServer = true,
  ) => {
    continuousAcquisitionActiveRef.current = false;

    if (continuousAcquisitionTimerRef.current) {
      clearTimeout(continuousAcquisitionTimerRef.current);
      continuousAcquisitionTimerRef.current = null;
    }

    if (activeAcquisitionAbortRef.current) {
      activeAcquisitionAbortRef.current.abort(new Error(`SPECTRA acquisition stopped: ${reason}`));
      activeAcquisitionAbortRef.current = null;
    }

    requestRef.current += 1;

    const sessionId = spectraSessionIdRef.current;
    if (!notifyServer || !sessionId || typeof window === 'undefined') return;

    const body = JSON.stringify({ sessionId });
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon('/api/spectra/acquisition/stop', blob)) return;
      }
    } catch {
      // Keepalive fetch below is the fallback.
    }

    void fetch('/api/spectra/acquisition/stop', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => undefined);
  }, []);

  hardStopRef.current = stopContinuousAcquisition;

  const startContinuousAcquisition = useCallback(() => {
    if (
      continuousAcquisitionActiveRef.current
      || !targetRef.current.trim()
      || !detailsRef.current.trim()
      || !spectraSessionIdRef.current
    ) {
      return;
    }

    continuousAcquisitionActiveRef.current = true;

    const runPass = async () => {
      if (!continuousAcquisitionActiveRef.current) return;

      const controller = new AbortController();
      activeAcquisitionAbortRef.current = controller;
      const pass = ++recursivePassRef.current;

      try {
        await acquireTarget(
          targetRef.current,
          detailsRef.current,
          directEvidenceRef.current,
          spectraSessionIdRef.current || undefined,
          {
            backgroundPass: true,
            signal: controller.signal,
            recursivePass: pass,
            queryStartedAt: queryStartedAtRef.current,
          },
        );
      } finally {
        if (activeAcquisitionAbortRef.current === controller) {
          activeAcquisitionAbortRef.current = null;
        }

        if (continuousAcquisitionActiveRef.current) {
          continuousAcquisitionTimerRef.current = setTimeout(
            () => void runPass(),
            CONTINUOUS_ACQUISITION_DELAY_MS,
          );
        }
      }
    };

    continuousAcquisitionTimerRef.current = setTimeout(
      () => void runPass(),
      CONTINUOUS_ACQUISITION_DELAY_MS,
    );
  }, [acquireTarget]);

  useEffect(() => {
    if (
      (phase === 'active' || phase === 'error')
      && target.trim()
      && details.trim()
      && spectraSessionId
    ) {
      startContinuousAcquisition();
    }
  }, [details, phase, spectraSessionId, startContinuousAcquisition, target]);

  useEffect(() => {
    const onPageHide = () => {
      stopContinuousAcquisition('page_exit', true);
    };

    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      if (
        continuousAcquisitionActiveRef.current
        || activeAcquisitionAbortRef.current
      ) {
        stopContinuousAcquisition('spectra_unmounted', false);
      }
    };
  }, [stopContinuousAcquisition]);

  useEffect(() => {
    const launch = lexaraLaunchRef.current;
    if (!launch) return;

    lexaraLaunchRef.current = null;
    try {
      sessionStorage.removeItem('legalwhat:spectra-launch');
    } catch {
      // One-time launch context can still proceed if storage cleanup is unavailable.
    }

    const targetValue = launch.target;
    const detailsValue = launchDetails(launch);
    setTarget(targetValue);
    setDetails(detailsValue);
    setAcquisitionStage('LEXARA context received; starting SPECTRA acquisition…');
    void acquireTarget(targetValue, detailsValue);
  }, [acquireTarget]);

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
        directEvidenceRef.current = nextDirectEvidence;
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
      detailsRef.current = expandedDetails;
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

  const handleTelemetryEvidence = useCallback(async (file: File) => {
    if (phase === 'awaiting_target') {
      const response = 'Tell me what you want to locate first. Then I can attach that telemetry to the target.';
      addMessage('spectra', response);
      speakIfEnabled(response);
      return;
    }
    if (phase === 'acquiring') return;

    addMessage('user', `Shared target telemetry: ${file.name}`);
    setLastError(null);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('subjectLabel', target);
      if (spectraSessionId) form.append('sessionId', spectraSessionId);

      const response = await fetch('/api/geoconsole/telemetry/import-file', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const payload = await response.json() as TelemetryImportResponse;
      if (!response.ok || payload.success !== true) {
        throw new Error(payload.error || 'Telemetry import failed.');
      }

      const importedSessionId = String(payload.data?.sessionId || spectraSessionId || '').trim();
      if (importedSessionId) {
        spectraSessionIdRef.current = importedSessionId;
        setSpectraSessionId(importedSessionId);
      }

      if (importedSessionId) {
        const historyResponse = await fetch(
          `/api/geoconsole/telemetry-history/${encodeURIComponent(importedSessionId)}`,
          { credentials: 'include' },
        );
        if (historyResponse.ok) {
          const historyPayload = await historyResponse.json().catch(() => ({}));
          const history = Array.isArray(historyPayload?.data) ? historyPayload.data : [];
          const importedPoints: GPSPoint[] = history.flatMap((point: any) => {
            const timestamp = new Date(point?.timestamp);
            if (
              !Number.isFinite(Number(point?.latitude))
              || !Number.isFinite(Number(point?.longitude))
              || !Number.isFinite(timestamp.getTime())
            ) return [];
            return [{
              ...point,
              latitude: Number(point.latitude),
              longitude: Number(point.longitude),
              timestamp,
              receivedAt: point.receivedAt ? new Date(point.receivedAt) : undefined,
              provenance: point.provenance
                ? {
                    ...point.provenance,
                    capturedAt: point.provenance.capturedAt
                      ? new Date(point.provenance.capturedAt)
                      : undefined,
                  }
                : undefined,
            } as GPSPoint];
          });

          if (importedPoints.length) {
            setObservations(previous => {
              const merged = new Map<string, GPSPoint>();
              for (const point of [...previous, ...importedPoints]) {
                const evidenceGroup =
                  point.correlationGroup
                  || point.provenance?.recordId
                  || `${point.source}:${point.provenance?.provider || 'unknown'}`;
                const key = [
                  Number(point.latitude).toFixed(7),
                  Number(point.longitude).toFixed(7),
                  new Date(point.timestamp).toISOString(),
                  point.source,
                  evidenceGroup,
                ].join('|');
                merged.set(key, point);
              }
              return [...merged.values()].sort(
                (left, right) =>
                  new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
              );
            });
          }
        }
      }

      const parsedCount = Number(payload.data?.parsedObservationCount || 0);
      const processedCount = Number(payload.data?.processedObservationCount || 0);
      const evidenceDescription = [
        `Imported target telemetry: ${file.name}`,
        `Parsed timestamped observations: ${parsedCount}`,
        `Accepted location observations: ${processedCount}`,
      ].join('. ');
      const expandedDetails = [details, evidenceDescription].filter(Boolean).join('\n');
      detailsRef.current = expandedDetails;
      setDetails(expandedDetails);

      const responseText = processedCount > 0
        ? `I imported ${processedCount} usable location observation${processedCount === 1 ? '' : 's'} from that telemetry and added them to the investigation.`
        : 'I parsed that telemetry, but it did not contain a usable timestamped location observation.';
      addMessage('spectra', responseText);
      speakIfEnabled(responseText);

      await acquireTarget(
        target,
        expandedDetails,
        directEvidence,
        importedSessionId || undefined,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Telemetry import failed.';
      setLastError(message);
      addMessage('spectra', 'I could not import that telemetry file. You can continue with the target information already supplied.');
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
    spectraSessionId,
    target,
  ]);

  const handleTargetFile = useCallback((file: File) => {
    if (isSpectraTelemetryFile(file)) {
      void handleTelemetryEvidence(file);
      return;
    }
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      void handleMediaEvidence(file);
      return;
    }

    const response = 'That file type is not a supported SPECTRA media or telemetry format.';
    addMessage('spectra', response);
    speakIfEnabled(response);
    if (mediaInputRef.current) mediaInputRef.current.value = '';
  }, [addMessage, handleMediaEvidence, handleTelemetryEvidence, speakIfEnabled]);

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
    if (phase === 'acquiring') return acquisitionStage;
    if (observations.length > 0) {
      return confidence == null
        ? `${observations.length} location observation${observations.length === 1 ? '' : 's'}`
        : `${Math.round(confidence * 100)}% location-evidence confidence`;
    }
    if (candidateLocations.length > 0) return 'Regional candidate mapped';
    if (target) return `Target: ${target}`;
    return 'Waiting for target';
  }, [acquisitionStage, candidateLocations.length, confidence, observations.length, phase, target]);

  const placeholder =
    phase === 'awaiting_target'
      ? 'Tell SPECTRA what you want to locate…'
      : phase === 'awaiting_details'
        ? 'Tell SPECTRA what you know about the target…'
        : phase === 'acquiring'
          ? 'SPECTRA is acquiring the target…'
          : 'Add information, or say “new target”…';

  // SPECTRA is map-first: the canonical map is present from initial load,
  // before a target or clue exists. Evidence progressively populates it.
  const showMap = true;

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
          onClick={() => {
            hardStopRef.current('back_button', true);
            setLocation('/lexara-consent');
          }}
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
            sessionId={spectraSessionId}
            spectraShell
          />

          <div className="pointer-events-none absolute left-3 top-3 z-30 rounded-full border border-slate-700/70 bg-slate-950/85 px-3 py-1.5 text-xs text-slate-200 shadow-xl backdrop-blur">
            {mapStatus}
          </div>

          {phase === 'acquiring' && (
            <div className="pointer-events-none absolute bottom-3 left-3 z-30 max-w-[min(88%,26rem)] rounded-xl border border-slate-700/70 bg-slate-950/88 px-3 py-2 text-[11px] text-slate-300 shadow-xl backdrop-blur">
              <div className="font-medium text-cyan-200">Acquired so far</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                <span>Target description ✓</span>
                <span>Details received ✓</span>
                <span>{/\d[\d\s().+-]{6,}\d/.test(details) ? 'Phone anchor ✓' : 'Phone anchor —'}</span>
                <span>{candidateLocations.length > 0 ? 'Regional context ✓' : 'Regional context searching'}</span>
                <span>{observations.length > 0 ? `${observations.length} timed observation${observations.length === 1 ? '' : 's'} ✓` : 'Timed evidence searching'}</span>
              </div>
            </div>
          )}

          {phase === 'acquiring' && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-950/20">
              <div className="flex items-center gap-2 rounded-full border border-cyan-500/30 bg-slate-950/90 px-4 py-2 text-sm text-cyan-200 shadow-xl backdrop-blur">
                <Loader2 className="h-4 w-4 animate-spin" />
                {acquisitionStage}
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
                  {sourceCount > 0 ? `${sourceCount} evidence sources reviewed` : 'Tell SPECTRA what you need located'}
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
              accept="image/*,video/*,.geojson,.gpx,.kml,.nmea,.csv,.ndjson,.jsonl,.log,.txt"
              className="hidden"
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) handleTargetFile(file);
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
                if (file) handleTargetFile(file);
              }}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={phase === 'awaiting_target' || phase === 'acquiring'}
                onClick={() => mediaInputRef.current?.click()}
                className="h-11 w-11 shrink-0 rounded-full text-slate-400 hover:text-cyan-300"
                title="Add target media or telemetry"
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
