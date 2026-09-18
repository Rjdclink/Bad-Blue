import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, Mic, MicOff, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useVoiceMode, type VoiceTranscriptMeta } from '@/hooks/useVoiceMode';
import { useVoiceSynthesis } from '@/hooks/useVoiceSynthesis';
import {
  LEXARAAttorneyPortrait,
  LEXARAStatusIndicator,
  type LEXARAEmotionHint,
  type LEXARAGazeHint,
} from '@/components/LexaraEtherealAvatar';
import { getLexaraLiveEnabled } from '@/components/LexaraLiveConsentModal';
import { analyzeUserSignals } from '@shared/lexaraVoicePersona';
import { cn } from '@/lib/utils';

interface LexaraConversationProps {
  lawTypeId?: string;
  lawTypeName?: string;
}

interface ConversationMessage {
  id: string;
  role: 'user' | 'lexara';
  content: string;
  timestamp: Date;
}

interface StoredConversationState {
  schemaVersion: number;
  sessionId: string;
  jurisdiction?: string;
  messages: Array<{
    id: string;
    role: 'user' | 'lexara';
    content: string;
    timestamp: string;
  }>;
}

type ConversationPhase =
  | 'initializing'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'text-only'
  | 'error';

const CONVERSATION_STORAGE_SCHEMA_VERSION = 2;
const BROWSER_FINAL_FALLBACK_SETTLE_MS = 1_200;
const SERVER_VOICE_TURN_SETTLE_MS = 180;
const VOICE_END_GRACE_MS = 650;
const CHAT_TURN_TIMEOUT_MS = 45_000;
const MAX_STORED_CONVERSATION_MESSAGES = 24;

function makeMessageId(role: ConversationMessage['role']): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${role}-${crypto.randomUUID()}`;
  }
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `lexara-${crypto.randomUUID()}`;
  }
  return `lexara-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function conversationStorageKey(lawTypeId?: string): string {
  const normalized = lawTypeId?.trim().toLowerCase() || 'general';
  return `lexara-live-session:${normalized}`;
}

function loadStoredConversation(lawTypeId?: string): {
  sessionId: string;
  jurisdiction?: string;
  messages: ConversationMessage[];
} {
  const fallback = {
    sessionId: makeSessionId(),
    jurisdiction: undefined,
    messages: [] as ConversationMessage[],
  };

  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.sessionStorage.getItem(conversationStorageKey(lawTypeId));
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<StoredConversationState>;
    if (parsed.schemaVersion !== CONVERSATION_STORAGE_SCHEMA_VERSION) {
      window.sessionStorage.removeItem(conversationStorageKey(lawTypeId));
      return fallback;
    }
    const sessionId = typeof parsed.sessionId === 'string' && parsed.sessionId.trim()
      ? parsed.sessionId.trim().slice(0, 128)
      : fallback.sessionId;
    const jurisdiction = typeof parsed.jurisdiction === 'string' && parsed.jurisdiction.trim()
      ? parsed.jurisdiction.trim().slice(0, 80)
      : undefined;
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
        .slice(-MAX_STORED_CONVERSATION_MESSAGES)
        .flatMap(item => {
          if (!item || (item.role !== 'user' && item.role !== 'lexara')) return [];
          if (typeof item.content !== 'string' || !item.content.trim()) return [];
          const timestamp = new Date(item.timestamp || Date.now());
          return [{
            id: typeof item.id === 'string' && item.id ? item.id : makeMessageId(item.role),
            role: item.role,
            content: item.content.trim(),
            timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
          } satisfies ConversationMessage];
        })
      : [];

    return { sessionId, jurisdiction, messages };
  } catch {
    return fallback;
  }
}

function friendlyError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'LEXARA could not complete that turn. Please try again.';
}

function normalizeSpeechText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSuspiciousGenericServerTranscript(
  text: string,
  meta: VoiceTranscriptMeta,
): boolean {
  const normalized = normalizeSpeechText(text);
  if (!normalized) return true;

  const generic = new Set([
    'thank you',
    'thanks',
    'okay',
    'ok',
    'bye',
    'goodbye',
    'you',
  ]);
  if (!generic.has(normalized)) return false;

  const speechDurationMs = meta.speechDurationMs;
  const veryShort = typeof speechDurationMs === 'number'
    && speechDurationMs > 0
    && speechDurationMs < 450;
  const short = typeof speechDurationMs === 'number'
    && speechDurationMs > 0
    && speechDurationMs < 1_200;
  const highNoSpeech = typeof meta.noSpeechProbability === 'number'
    && meta.noSpeechProbability >= 0.35;
  const weakLogprob = typeof meta.avgLogprob === 'number'
    && meta.avgLogprob <= -0.65;
  const weakConfidence = typeof meta.confidence === 'number'
    && meta.confidence < 0.55;
  const hasAcousticQuality = typeof meta.noSpeechProbability === 'number'
    || typeof meta.avgLogprob === 'number'
    || typeof meta.confidence === 'number';

  // Generic acknowledgements are valid speech, so reject them only when the
  // acoustic evidence is weak. This blocks common STT hallucinations such as
  // phantom "thank you" without blacklisting a real user acknowledgement.
  return highNoSpeech
    || (short && (weakLogprob || weakConfidence))
    || (veryShort && !hasAcousticQuality);
}

function mergeSpeechSegments(existing: string, incoming: string): string {
  const left = existing.replace(/\s+/g, ' ').trim();
  const right = incoming.replace(/\s+/g, ' ').trim();
  if (!left) return right;
  if (!right) return left;

  const leftWords = left.split(' ');
  const rightWords = right.split(' ');
  const normalizeWord = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, '');
  const leftNormalized = leftWords.map(normalizeWord);
  const rightNormalized = rightWords.map(normalizeWord);
  const leftPhrase = leftNormalized.join(' ');
  const rightPhrase = rightNormalized.join(' ');

  if (leftPhrase === rightPhrase) return right.length >= left.length ? right : left;
  if (rightPhrase.startsWith(leftPhrase + ' ')) return right;
  if (leftPhrase.endsWith(' ' + rightPhrase)) return left;

  const maxOverlap = Math.min(leftWords.length, rightWords.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const leftTail = leftNormalized.slice(-overlap).join(' ');
    const rightHead = rightNormalized.slice(0, overlap).join(' ');
    if (leftTail && leftTail === rightHead) {
      return [...leftWords, ...rightWords.slice(overlap)].join(' ');
    }
  }

  return `${left} ${right}`;
}

function looksLikeLexaraEcho(candidate: string, spokenText: string): boolean {
  const normalizedCandidate = normalizeSpeechText(candidate);
  const normalizedSpoken = normalizeSpeechText(spokenText);
  if (!normalizedCandidate || !normalizedSpoken) return false;

  const candidateWords = normalizedCandidate.split(' ').filter(Boolean);
  if (candidateWords.length === 1) {
    const word = candidateWords[0];
    return word.length >= 5 && normalizedSpoken.split(' ').includes(word);
  }

  const spokenWords = new Set(normalizedSpoken.split(' ').filter(Boolean));
  const overlap = candidateWords.filter(word => spokenWords.has(word)).length / candidateWords.length;
  return overlap >= 0.75 || normalizedSpoken.includes(normalizedCandidate);
}

function emotionFromUserText(text: string): LEXARAEmotionHint {
  try {
    const emotionalState = analyzeUserSignals(text)?.signals?.emotionalState;
    if (emotionalState === 'anxious') return 'empathetic';
    if (emotionalState === 'frustrated') return 'protective';
    if (emotionalState === 'curious') return 'playful';
    if (emotionalState === 'grateful') return 'empathetic';
  } catch {
    // Signal analysis is advisory; conversation must continue if it fails.
  }
  return 'calm';
}

export default function LexaraConversation({ lawTypeId, lawTypeName }: LexaraConversationProps) {
  const initialStateRef = useRef(loadStoredConversation(lawTypeId));
  const storageKeyRef = useRef(conversationStorageKey(lawTypeId));
  const sessionIdRef = useRef(initialStateRef.current.sessionId);

  const [conversation, setConversation] = useState<ConversationMessage[]>(initialStateRef.current.messages);
  const [userInput, setUserInput] = useState('');
  const [phase, setPhase] = useState<ConversationPhase>('initializing');
  const [jurisdiction, setJurisdiction] = useState<string | undefined>(initialStateRef.current.jurisdiction);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [emotion, setEmotion] = useState<LEXARAEmotionHint>('calm');
  const [gaze, setGaze] = useState<LEXARAGazeHint>('camera');

  const conversationRef = useRef<ConversationMessage[]>(initialStateRef.current.messages);
  const phaseRef = useRef<ConversationPhase>('initializing');
  const currentRequestRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const initializedRef = useRef(false);
  // Greeting is scoped to this page entry, not persisted conversation history.
  const greetingRef = useRef(false);
  const userSpeechObservedRef = useRef(false);
  const handleMessageRef = useRef<(text: string) => void>(() => undefined);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const conversationScrollRef = useRef<HTMLDivElement>(null);
  const voiceTurnBufferRef = useRef('');
  const voiceTurnTimerRef = useRef<number | null>(null);
  const voiceEndPendingRef = useRef(false);
  const pendingUserTurnRef = useRef('');
  const pendingTurnAlreadyRenderedRef = useRef(false);
  const currentTurnTextRef = useRef('');
  const responseEmotionRef = useRef<LEXARAEmotionHint>('authoritative');
  const activeLexaraSpeechRef = useRef('');
  const recentLexaraSpeechRef = useRef<{ text: string; expiresAt: number }>({ text: '', expiresAt: 0 });
  const autoInterruptRef = useRef<() => void>(() => undefined);
  const lastFinalVoiceSegmentRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  const clearVoiceTurnTimer = useCallback(() => {
    if (voiceTurnTimerRef.current !== null) {
      window.clearTimeout(voiceTurnTimerRef.current);
      voiceTurnTimerRef.current = null;
    }
  }, []);

  const clearVoiceTurnBuffer = useCallback(() => {
    clearVoiceTurnTimer();
    voiceTurnBufferRef.current = '';
  }, [clearVoiceTurnTimer]);

  const flushVoiceTurn = useCallback(() => {
    clearVoiceTurnTimer();
    voiceEndPendingRef.current = false;
    const text = voiceTurnBufferRef.current.trim();
    voiceTurnBufferRef.current = '';
    if (!text) return;
    handleMessageRef.current(text);
  }, [clearVoiceTurnTimer]);

  const voiceMode = useVoiceMode({
    continuous: true,
    interimResults: true,
    onVoiceStart: () => {
      // A renewed speech burst means the user has not finished the turn yet.
      voiceEndPendingRef.current = false;
      clearVoiceTurnTimer();
      // Acoustic energy alone is not proof of user speech. Interruption is
      // transcript-confirmed below so LEXARA cannot cut herself off.
    },
    onVoiceEnd: () => {
      voiceEndPendingRef.current = true;
      clearVoiceTurnTimer();
      if (voiceTurnBufferRef.current.trim()) {
        voiceTurnTimerRef.current = window.setTimeout(flushVoiceTurn, VOICE_END_GRACE_MS);
      }
    },
    onTranscript: (text, isFinal, meta) => {
      const observed = text.trim();
      if (!observed) return;

      // Keep the microphone live while LEXARA speaks. Browser echo cancellation
      // removes most speaker leakage; this lexical guard rejects residual TTS
      // echoes so genuine user speech can automatically barge in.
      const echoReference = activeLexaraSpeechRef.current
        || (Date.now() <= recentLexaraSpeechRef.current.expiresAt
          ? recentLexaraSpeechRef.current.text
          : '');

      if (echoReference && looksLikeLexaraEcho(observed, echoReference)) {
        return;
      }

      if (
        isFinal
        && meta.engine === 'server'
        && isSuspiciousGenericServerTranscript(observed, meta)
      ) {
        return;
      }

      // Never interrupt LEXARA on an interim browser hypothesis. Speaker echo
      // often appears first as an unstable interim transcript and was cutting
      // off otherwise healthy ElevenLabs playback. Genuine barge-in remains
      // available once a final, echo-screened transcript is committed.
      if (!isFinal) {
        if (phaseRef.current !== 'speaking') {
          voiceEndPendingRef.current = false;
          clearVoiceTurnTimer();
        }
        return;
      }

      if (phaseRef.current === 'speaking') {
        const words = normalizeSpeechText(observed).split(' ').filter(Boolean);
        const weakBrowserEvidence = meta.engine === 'browser'
          && typeof meta.confidence === 'number'
          && meta.confidence < 0.45;
        const weakServerEvidence = meta.engine === 'server'
          && (
            (typeof meta.speechDurationMs === 'number' && meta.speechDurationMs < 300)
            || (typeof meta.noSpeechProbability === 'number' && meta.noSpeechProbability >= 0.45)
          );
        if (words.length === 0 || weakBrowserEvidence || weakServerEvidence) return;
        autoInterruptRef.current();
      }

      userSpeechObservedRef.current = true;

      const normalized = normalizeSpeechText(observed);
      const now = Date.now();
      if (
        normalized
        && normalized === lastFinalVoiceSegmentRef.current.text
        && now - lastFinalVoiceSegmentRef.current.at < 1_800
      ) {
        return;
      }
      lastFinalVoiceSegmentRef.current = { text: normalized, at: now };

      voiceTurnBufferRef.current = mergeSpeechSegments(voiceTurnBufferRef.current, observed);

      clearVoiceTurnTimer();
      const settleMs = meta.engine === 'server'
        ? SERVER_VOICE_TURN_SETTLE_MS
        : voiceEndPendingRef.current
          ? VOICE_END_GRACE_MS
          : BROWSER_FINAL_FALLBACK_SETTLE_MS;
      voiceTurnTimerRef.current = window.setTimeout(flushVoiceTurn, settleMs);
    },
    onError: error => {
      const message = String(error.message || '');
      const normalized = message.toLowerCase();
      if (normalized.includes('permission') || normalized.includes('audio-capture')) {
        setVoiceReady(false);
        setErrorMessage('Microphone access is off. Turn it on to keep talking, or continue by typing.');
        return;
      }
      setErrorMessage('I’m having trouble hearing you right now. You can keep typing while voice recovers.');
    },
  });

  const {
    enableVoice: enableRecognition,
    startListening,
    stopListening,
    resumeListening,
    isListening: recognitionListening,
    interimTranscript,
  } = voiceMode;

  const voiceSynthesis = useVoiceSynthesis();
  const {
    speak,
    stop: stopSpeaking,
    isSpeaking: synthesisSpeaking,
  } = voiceSynthesis;

  const setConversationPhase = useCallback((next: ConversationPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const appendMessage = useCallback((role: ConversationMessage['role'], content: string) => {
    const nextMessage: ConversationMessage = {
      id: makeMessageId(role),
      role,
      content,
      timestamp: new Date(),
    };

    setConversation(previous => {
      const next = [...previous, nextMessage];
      conversationRef.current = next;
      return next;
    });
  }, []);

  const enableVoice = useCallback(async () => {
    try {
      await enableRecognition();
      setVoiceReady(true);
      setErrorMessage(null);
      startListening();
      setConversationPhase('listening');
      return true;
    } catch (error) {
      setVoiceReady(false);
      setErrorMessage(friendlyError(error));
      setConversationPhase('text-only');
      return false;
    }
  }, [enableRecognition, setConversationPhase, startListening]);

  const speakLexara = useCallback(async (text: string, generation?: number) => {
    if (!liveEnabled || !voiceReady) {
      if (generation === undefined || generation === generationRef.current) {
        setConversationPhase('text-only');
      }
      return;
    }

    clearVoiceTurnBuffer();
    activeLexaraSpeechRef.current = text;
    recentLexaraSpeechRef.current = { text, expiresAt: Number.POSITIVE_INFINITY };
    // Full-duplex: recognition stays live while LEXARA speaks so natural
    // barge-in can be detected without a button.
    resumeListening();
    if (generation === undefined || generation === generationRef.current) {
      setConversationPhase('speaking');
      setEmotion(responseEmotionRef.current);
      setGaze('camera');
    }

    try {
      await speak(text, {
        context: 'guidance',
        autoPlay: true,
      });
    } finally {
      activeLexaraSpeechRef.current = '';
      recentLexaraSpeechRef.current = { text, expiresAt: Date.now() + 8_000 };
      resumeListening();
      if (generation === undefined || generation === generationRef.current) {
        setConversationPhase('listening');
        setEmotion('calm');
      }
    }
  }, [clearVoiceTurnBuffer, liveEnabled, resumeListening, setConversationPhase, speak, voiceReady]);

  const handleUserMessage = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message) return;

    // If recognition produces a late continuation after a turn was committed,
    // fold it into the same user turn instead of aborting active reasoning.
    if (currentRequestRef.current) {
      const base = pendingUserTurnRef.current || currentTurnTextRef.current;
      const combined = mergeSpeechSegments(base, message);
      pendingUserTurnRef.current = combined;
      setConversation(previous => {
        const next = [...previous];
        for (let index = next.length - 1; index >= 0; index -= 1) {
          if (next[index].role === 'user') {
            next[index] = { ...next[index], content: combined };
            break;
          }
        }
        conversationRef.current = next;
        return next;
      });
      return;
    }

    userSpeechObservedRef.current = true;
    clearVoiceTurnBuffer();

    const generation = generationRef.current + 1;
    generationRef.current = generation;

    stopSpeaking();

    const controller = new AbortController();
    currentRequestRef.current = controller;
    let requestTimedOut = false;
    const requestTimeout = window.setTimeout(() => {
      requestTimedOut = true;
      controller.abort();
    }, CHAT_TURN_TIMEOUT_MS);

    currentTurnTextRef.current = message;
    const previousMessages = conversationRef.current.map(item => ({
      role: item.role,
      content: item.content,
    }));

    const userEmotion = emotionFromUserText(message);
    responseEmotionRef.current = userEmotion === 'calm' ? 'authoritative' : userEmotion;

    const alreadyRendered = pendingTurnAlreadyRenderedRef.current;
    pendingTurnAlreadyRenderedRef.current = false;
    if (!alreadyRendered) appendMessage('user', message);
    setUserInput('');
    setErrorMessage(null);
    setConversationPhase('thinking');
    setEmotion(userEmotion);
    setGaze('thinking');

    try {
      const response = await fetch('/api/lexara/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: message,
          includeAudio: false,
          context: {
            previousMessages,
            lawType: lawTypeId,
            lawTypeName,
            jurisdiction,
            sessionId: sessionIdRef.current,
            behaviorMode: 'professional',
          },
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || body?.message || `LEXARA request failed (${response.status})`);
      }

      const data = await response.json();
      if (generation !== generationRef.current) return;
      if (pendingUserTurnRef.current) return;

      const answer = String(data?.response || '').trim();
      if (!answer) throw new Error('LEXARA returned an empty response');

      if (data?.jurisdiction && typeof data.jurisdiction === 'string') {
        setJurisdiction(data.jurisdiction);
      }

      appendMessage('lexara', answer);
      setGaze('camera');
      await speakLexara(answer, generation);
    } catch (error: any) {
      if (generation !== generationRef.current) return;

      if (error?.name === 'AbortError') {
        if (!requestTimedOut) return;
        setErrorMessage('LEXARA’s analysis timed out. Please repeat or shorten the last turn.');
      } else {
        setErrorMessage(friendlyError(error));
      }

      setConversationPhase(liveEnabled && voiceReady ? 'listening' : 'error');
      setEmotion('empathetic');
      setGaze('camera');
    } finally {
      window.clearTimeout(requestTimeout);
      if (generation === generationRef.current) {
        currentRequestRef.current = null;
        currentTurnTextRef.current = '';
        const pending = pendingUserTurnRef.current.trim();
        pendingUserTurnRef.current = '';
        if (pending) {
          pendingTurnAlreadyRenderedRef.current = true;
          window.setTimeout(() => handleMessageRef.current(pending), 0);
        }
      }
    }
  }, [appendMessage, clearVoiceTurnBuffer, jurisdiction, lawTypeId, lawTypeName, liveEnabled, setConversationPhase, speakLexara, stopSpeaking, voiceReady]);

  handleMessageRef.current = handleUserMessage;

  autoInterruptRef.current = () => {
    stopSpeaking();
    resumeListening();
    setConversationPhase(liveEnabled && voiceReady ? 'listening' : 'text-only');
    setEmotion('calm');
    setGaze('camera');
  };

  const sendGreeting = useCallback(async () => {
    if (greetingRef.current || userSpeechObservedRef.current) return;
    greetingRef.current = true;
    const greetingGeneration = generationRef.current;
    responseEmotionRef.current = 'calm';

    const domain = lawTypeName ? ` about ${lawTypeName}` : '';
    const greeting = `Hello. Tell me what happened${domain}, in your own words. I'll identify the legal issues, test the strengths and weaknesses, and ask only the questions that materially affect the analysis.`;
    appendMessage('lexara', greeting);

    if (liveEnabled && voiceReady) {
      await speakLexara(greeting, greetingGeneration).catch(() => undefined);
    }
  }, [appendMessage, lawTypeName, liveEnabled, speakLexara, voiceReady]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initialize = async () => {
      const consentedLive = getLexaraLiveEnabled() === 'true';
      setLiveEnabled(consentedLive);

      if (!consentedLive) {
        setConversationPhase('text-only');
        return;
      }

      setConversationPhase('initializing');
      await enableVoice();
    };

    initialize().catch(() => {
      setConversationPhase('text-only');
    });
  }, [enableVoice, setConversationPhase]);

  useEffect(() => {
    try {
      const stored: StoredConversationState = {
        schemaVersion: CONVERSATION_STORAGE_SCHEMA_VERSION,
        sessionId: sessionIdRef.current,
        jurisdiction,
        messages: conversation
          .slice(-MAX_STORED_CONVERSATION_MESSAGES)
          .map(message => ({
            id: message.id,
            role: message.role,
            content: message.content,
            timestamp: message.timestamp.toISOString(),
          })),
      };
      window.sessionStorage.setItem(storageKeyRef.current, JSON.stringify(stored));
    } catch {
      // Session persistence is best-effort; live conversation still works without it.
    }
  }, [conversation, jurisdiction]);

  useEffect(() => {
    if (phase === 'initializing' || greetingRef.current) return;

    const timer = window.setTimeout(() => {
      sendGreeting().catch(() => undefined);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [phase, sendGreeting]);

  useEffect(() => {
    setAudioLevel(synthesisSpeaking ? 0.45 : recognitionListening ? 0.12 : 0);
  }, [recognitionListening, synthesisSpeaking]);

  useEffect(() => {
    const scroller = conversationScrollRef.current;
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
  }, [conversation, interimTranscript, phase]);

  useEffect(() => {
    return () => {
      currentRequestRef.current?.abort();
      clearVoiceTurnBuffer();
      stopSpeaking();
      stopListening();
    };
  }, [clearVoiceTurnBuffer, stopListening, stopSpeaking]);

  const statusLabel = useMemo(() => {
    if (phase === 'initializing') return 'Preparing live consultation';
    if (phase === 'thinking') return 'Analyzing';
    if (phase === 'speaking') return 'Speaking';
    if (phase === 'listening') return 'Listening';
    if (phase === 'error') return 'Text available';
    return 'Text consultation';
  }, [phase]);

  const submitText = (event: FormEvent) => {
    event.preventDefault();
    handleUserMessage(userInput);
  };

  const isThinking = phase === 'thinking';
  const isSpeaking = phase === 'speaking' || synthesisSpeaking;
  const isListening = phase === 'listening' && recognitionListening;

  return (
    <div className="mx-auto grid h-[calc(100dvh-73px)] max-w-7xl grid-cols-1 grid-rows-[minmax(220px,38dvh)_minmax(0,1fr)] overflow-hidden lg:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)] lg:grid-rows-1">
      <section className="relative flex min-h-0 items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 p-3 sm:p-6 lg:min-h-full">
        <div className="absolute inset-0 opacity-40">
          <div className="absolute left-1/4 top-1/4 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 h-96 w-96 rounded-full bg-indigo-400/10 blur-3xl" />
        </div>

        <div className="relative z-10 h-full w-full max-w-lg">
          <LEXARAAttorneyPortrait
            isSpeaking={isSpeaking}
            isListening={isListening}
            isThinking={isThinking}
            audioLevel={audioLevel}
            emotionHint={emotion}
            gazeHint={gaze}
            size="full"
          />
        </div>

        <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 backdrop-blur">
          <LEXARAStatusIndicator
            isSpeaking={isSpeaking}
            isListening={isListening}
            isThinking={isThinking}
          />
          <span>{statusLabel}</span>
        </div>
      </section>

      <section className="flex min-h-0 flex-col border-t bg-background lg:min-h-full lg:border-l lg:border-t-0">
        <div className="border-b px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">LEXARA Consultation</h2>
              <p className="text-xs text-muted-foreground">
                {lawTypeName || 'Legal analysis'}{jurisdiction ? ` · ${jurisdiction}` : ''}
              </p>
            </div>
            <div className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
              liveEnabled && voiceReady
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'bg-muted text-muted-foreground',
            )}>
              {liveEnabled && voiceReady ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
              {liveEnabled && voiceReady ? 'Voice live' : 'Text mode'}
            </div>
          </div>
        </div>

        <div ref={conversationScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4" aria-live="polite">
          {conversation.map(message => (
            <div
              key={message.id}
              className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm',
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'border bg-card text-card-foreground',
                )}
              >
                {message.content}
              </div>
            </div>
          ))}

          {interimTranscript && !isSpeaking && (
            <div className="flex justify-end">
              <div className="max-w-[92%] rounded-2xl bg-muted px-4 py-3 text-sm italic text-muted-foreground">
                {interimTranscript}…
              </div>
            </div>
          )}

          {isThinking && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Reviewing the facts and law…
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div ref={messageEndRef} />
        </div>

        <div className="border-t px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {liveEnabled && !voiceReady && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void enableVoice()}
              className="mb-3 min-h-11 w-full gap-2 touch-manipulation text-base sm:text-sm"
            >
              <Mic className="h-4 w-4" />
              Start microphone
            </Button>
          )}

          <form onSubmit={submitText} className="flex gap-2">
            <input
              value={userInput}
              onChange={event => setUserInput(event.target.value)}
              placeholder="Type or speak naturally…"
              className="min-w-0 flex-1 rounded-full border bg-background px-4 py-3 text-base outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
              aria-label="Message LEXARA"
              enterKeyHint="send"
              autoComplete="off"
              autoCapitalize="sentences"
              spellCheck
            />
            <Button type="submit" size="icon" className="h-11 w-11 shrink-0 touch-manipulation rounded-full" disabled={!userInput.trim()} aria-label="Send message">
              <Send className="h-4 w-4" />
            </Button>
          </form>

          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            AI legal information and analysis. Verify controlling authority before relying on a citation or deadline.
          </p>
        </div>
      </section>
    </div>
  );
}
