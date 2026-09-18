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
import { useAuth } from '@/hooks/useAuth';

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
const BROWSER_FINAL_FALLBACK_SETTLE_MS = 900;
const SERVER_VOICE_TURN_SETTLE_MS = 500;
const VOICE_END_GRACE_MS = 650;
const INCOMPLETE_TURN_GRACE_MS = 2_400;
const CHAT_TURN_TIMEOUT_MS = 15_000;
const ACKNOWLEDGEMENT_SOFT_TIMEOUT_MS = 450;
const ACKNOWLEDGEMENT_DEDUPE_MS = 8_000;
const ACKNOWLEDGEMENT_COOLDOWN_MS = 2_500;
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

function sanitizeLikelySpeechArtifacts(
  text: string,
  meta: VoiceTranscriptMeta,
): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';

  const segments = trimmed.match(/[^.!?]+[.!?]?/g)?.map(segment => segment.trim()).filter(Boolean) || [trimmed];
  const genericSegment = /^(?:thank\s+you(?:\s*,?\s*[a-z]+)?|thanks(?:\s*,?\s*[a-z]+)?|okay|ok|bye|goodbye)[.!?]*$/i;
  const generatedDeparture = /^(?:(?:i'm|i\s+am)\s+going\s+to\s+go|i\s+have\s+to\s+go)[.!?]*$/i;
  const genericCount = segments.filter(segment => genericSegment.test(segment)).length;
  const weakAcousticEvidence =
    meta.startedDuringPlayback
    || (typeof meta.noSpeechProbability === 'number' && meta.noSpeechProbability >= 0.35)
    || (typeof meta.avgLogprob === 'number' && meta.avgLogprob <= -0.75)
    || (typeof meta.confidence === 'number' && meta.confidence < 0.5);

  // Whisper/browser STT commonly hallucinates stock closers in quiet or
  // speaker-leakage audio. If the same turn contains repeated generic closers,
  // treat those fragments as contamination wherever they occur, not only at the
  // tail. Preserve the substantive clauses and genuine control questions.
  if (genericCount >= 2 || weakAcousticEvidence) {
    const cleaned = segments.filter(segment => {
      if (genericSegment.test(segment)) return false;
      if (genericCount >= 2 && generatedDeparture.test(segment)) return false;
      return true;
    });
    const substantive = cleaned.join(' ').replace(/\s+/g, ' ').trim();
    if (substantive) return substantive;
  }

  // A single generic closer remains valid user speech unless the acoustic
  // evidence is weak. This preserves real "thank you" or "goodbye" turns.
  if (weakAcousticEvidence && genericSegment.test(trimmed)) return '';
  return trimmed;
}

function isPresenceControlTurn(value: string): boolean {
  const clean = value.trim();
  return /^(?:(?:hey|hello)[, ]*)?(?:lexara[, ]*)?(?:are you (?:still )?there|you still there|you there|can you hear me|are you listening|hello|did you hear me|are you still working(?: on (?:this|it))?)[?.! ]*$/i.test(clean);
}

function splitTrailingPresenceControlTurn(value: string): { main: string; control: string } {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return { main: '', control: '' };
  if (isPresenceControlTurn(trimmed)) return { main: '', control: trimmed };

  const segments = trimmed.match(/[^.!?]+[.!?]?/g)?.map(segment => segment.trim()).filter(Boolean) || [];
  if (segments.length < 2) return { main: trimmed, control: '' };

  const last = segments[segments.length - 1];
  if (!isPresenceControlTurn(last)) return { main: trimmed, control: '' };

  return {
    main: segments.slice(0, -1).join(' ').trim(),
    control: last,
  };
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

function isLikelyIncompleteUtterance(value: string): boolean {
  const normalized = normalizeSpeechText(value);
  if (!normalized) return false;
  const words = normalized.split(' ').filter(Boolean);
  const last = words[words.length - 1] || '';

  if (/^(?:i|we)\s+(?:was|were|am|had|have|got|went|started|tried|wanted|needed|saw|heard|told|asked|thought)$/.test(normalized)) {
    return true;
  }

  const trailingConnectors = new Set([
    'and', 'but', 'because', 'so', 'then', 'when', 'while', 'after', 'before',
    'if', 'unless', 'although', 'though', 'with', 'without', 'to', 'from', 'at',
    'in', 'on', 'for', 'of', 'the', 'a', 'an', 'my', 'our', 'his', 'her',
    'their', 'that', 'which', 'who',
  ]);
  if (trailingConnectors.has(last)) return true;

  if (words.length <= 2 && /^(?:i|we|he|she|they|it)\s+(?:was|were|is|are|had|have|did|do|can|could|would|should|will)$/.test(normalized)) {
    return true;
  }

  return false;
}

function isStrongBargeIn(text: string, meta: VoiceTranscriptMeta): boolean {
  const normalized = normalizeSpeechText(text);
  if (!normalized) return false;
  const explicit = /^(?:wait|stop|no|hold on|hang on|actually|but wait|let me finish)\b/.test(normalized);
  if (explicit) return true;

  const genericAcknowledgements = new Set([
    'thank you', 'thanks', 'okay', 'ok', 'yes', 'yeah', 'yep', 'bye', 'goodbye', 'you',
  ]);
  if (genericAcknowledgements.has(normalized)) return false;

  const words = normalized.split(' ').filter(Boolean);
  if (words.length < 2) return false;

  if (typeof meta.speechDurationMs === 'number' && meta.speechDurationMs < 350) return false;
  if (typeof meta.confidence === 'number' && meta.confidence < 0.5) return false;
  if (typeof meta.noSpeechProbability === 'number' && meta.noSpeechProbability >= 0.35) return false;
  if (typeof meta.avgLogprob === 'number' && meta.avgLogprob <= -0.85) return false;
  return true;
}

function looksLikeLexaraEcho(candidate: string, spokenText: string): boolean {
  const normalizedCandidate = normalizeSpeechText(candidate);
  const normalizedSpoken = normalizeSpeechText(spokenText);
  if (!normalizedCandidate || !normalizedSpoken) return false;

  const candidateWords = normalizedCandidate.split(' ').filter(Boolean);
  const spokenWords = normalizedSpoken.split(' ').filter(Boolean);

  if (candidateWords.length === 1) {
    const word = candidateWords[0];
    return word.length >= 5 && spokenWords.includes(word);
  }

  // Exact phrase leakage is strong echo evidence. For longer candidates compare
  // ordered contiguous runs rather than bag-of-words overlap, so a real user who
  // repeats legal terms from LEXARA is not discarded merely for sharing words.
  if (normalizedSpoken.includes(normalizedCandidate)) return true;

  let longestRun = 0;
  for (let candidateIndex = 0; candidateIndex < candidateWords.length; candidateIndex += 1) {
    for (let spokenIndex = 0; spokenIndex < spokenWords.length; spokenIndex += 1) {
      let run = 0;
      while (
        candidateIndex + run < candidateWords.length
        && spokenIndex + run < spokenWords.length
        && candidateWords[candidateIndex + run] === spokenWords[spokenIndex + run]
      ) {
        run += 1;
      }
      longestRun = Math.max(longestRun, run);
    }
  }

  const orderedEchoRatio = longestRun / candidateWords.length;
  return candidateWords.length >= 3 && longestRun >= 3 && orderedEchoRatio >= 0.8;
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
  const { user } = useAuth();
  const isMasterSession = Boolean((user as any)?.isMasterBypass);
  const initialStateRef = useRef(
    isMasterSession
      ? { sessionId: makeSessionId(), jurisdiction: undefined, messages: [] as ConversationMessage[] }
      : loadStoredConversation(lawTypeId),
  );
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
  const pendingUserTurnQueueRef = useRef<Array<{ text: string; messageId: string }>>([]);
  const currentPreRenderedTurnIdRef = useRef<string | null>(null);
  const nonSemanticLexaraMessageIdsRef = useRef<Set<string>>(new Set());
  const currentTurnTextRef = useRef('');
  const analysisActiveRef = useRef(false);
  const lastAcknowledgementRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const controlAcknowledgementSpeechRef = useRef<Promise<void> | null>(null);
  const responseEmotionRef = useRef<LEXARAEmotionHint>('authoritative');
  const activeLexaraSpeechRef = useRef('');
  const recentLexaraSpeechRef = useRef<{ text: string; expiresAt: number }>({ text: '', expiresAt: 0 });
  const autoInterruptRef = useRef<() => void>(() => undefined);
  const lastFinalVoiceSegmentRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const validatedBargeInUtterancesRef = useRef<Set<number>>(new Set());

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

    // Some mobile/server STT chunks can contain the tail of a substantive turn
    // plus a later conversational check-in. Keep the check-in as its own turn
    // instead of grafting "are you still there?" onto the legal statement.
    const split = splitTrailingPresenceControlTurn(text);
    if (split.main) handleMessageRef.current(split.main);
    if (split.control) {
      window.setTimeout(() => handleMessageRef.current(split.control), 0);
    }
  }, [clearVoiceTurnTimer]);

  const voiceMode = useVoiceMode({
    continuous: true,
    interimResults: true,
    shouldProbeBargeIn: () => phaseRef.current === 'speaking',
    onVoiceStart: () => {
      // Voice activity means the user may be continuing a turn, so cancel any
      // pending commit. It does NOT own interruption authority: speaker echo can
      // also create VAD energy even when the microphone reports AEC enabled.
      voiceEndPendingRef.current = false;
      clearVoiceTurnTimer();
    },
    onVoiceEnd: () => {
      voiceEndPendingRef.current = true;
      clearVoiceTurnTimer();
      const buffered = voiceTurnBufferRef.current.trim();
      if (buffered) {
        const settleMs = isLikelyIncompleteUtterance(buffered)
          ? INCOMPLETE_TURN_GRACE_MS
          : VOICE_END_GRACE_MS;
        voiceTurnTimerRef.current = window.setTimeout(flushVoiceTurn, settleMs);
      }
    },
    onTranscript: (text, isFinal, meta) => {
      const observed = sanitizeLikelySpeechArtifacts(text, meta);
      if (!observed) return;

      // Keep the microphone live while LEXARA speaks, but never trust VAD/AEC
      // alone. A transcript must first survive lexical echo rejection before it
      // can become either a barge-in probe or an authoritative user turn.
      const echoReference = activeLexaraSpeechRef.current
        || (Date.now() <= recentLexaraSpeechRef.current.expiresAt
          ? recentLexaraSpeechRef.current.text
          : '');

      if (echoReference && looksLikeLexaraEcho(observed, echoReference)) {
        return;
      }

      if (meta.bargeInProbe) {
        // Probe transcripts are non-destructive snapshots of the recording.
        // They may yield the conversational floor, but never become user text;
        // the complete recording remains authoritative after the user finishes.
        if (
          phaseRef.current === 'speaking'
          && !isSuspiciousGenericServerTranscript(observed, meta)
          && isStrongBargeIn(observed, meta)
        ) {
          if (typeof meta.utteranceId === 'number') {
            validatedBargeInUtterancesRef.current.add(meta.utteranceId);
          }
          autoInterruptRef.current();
        }
        return;
      }

      if (meta.startedDuringPlayback && typeof meta.utteranceId === 'number') {
        const alreadyValidated = validatedBargeInUtterancesRef.current.has(meta.utteranceId);
        if (!alreadyValidated) {
          // A recording that began during playback is admitted only when the
          // final transcript itself is strong and does not match recent LEXARA
          // speech. Do not require playback to still be active by the time the
          // server transcript returns; that race was dropping genuine short
          // interruptions on mobile.
          if (
            isFinal
            && !isSuspiciousGenericServerTranscript(observed, meta)
            && isStrongBargeIn(observed, meta)
          ) {
            validatedBargeInUtterancesRef.current.add(meta.utteranceId);
            if (phaseRef.current === 'speaking') autoInterruptRef.current();
          } else {
            return;
          }
        }
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
        // True barge-in remains first-class, but speaker echo and tiny final STT
        // fragments are not allowed to chop LEXARA's playback. A deliberate
        // interruption must survive lexical echo rejection above and carry
        // enough final acoustic/transcript evidence to own the floor.
        if (!isStrongBargeIn(observed, meta)) return;
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

      if (typeof meta.utteranceId === 'number') {
        validatedBargeInUtterancesRef.current.delete(meta.utteranceId);
      }
      voiceTurnBufferRef.current = mergeSpeechSegments(voiceTurnBufferRef.current, observed);

      clearVoiceTurnTimer();
      const bufferedTurn = voiceTurnBufferRef.current.trim();
      const settleMs = isLikelyIncompleteUtterance(bufferedTurn)
        ? INCOMPLETE_TURN_GRACE_MS
        : meta.engine === 'server'
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

  const appendMessage = useCallback((role: ConversationMessage['role'], content: string): string => {
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
    return nextMessage.id;
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
        if (analysisActiveRef.current) {
          setConversationPhase('thinking');
          setGaze('thinking');
        } else {
          setConversationPhase('listening');
          setEmotion('calm');
        }
      }
    }
  }, [clearVoiceTurnBuffer, liveEnabled, resumeListening, setConversationPhase, speak, voiceReady]);

  const handleUserMessage = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message) return;

    // Speech that arrives while legal analysis is running is a new conversational
    // turn, never a continuation silently grafted onto the prior blue bubble.
    // Presence/control checks are answered immediately without cancelling,
    // restarting, or mutating the in-flight legal analysis.
    if (currentRequestRef.current) {
      userSpeechObservedRef.current = true;
      clearVoiceTurnBuffer();
      const userMessageId = appendMessage('user', message);
      setUserInput('');
      setErrorMessage(null);

      const presenceControl = isPresenceControlTurn(message);
      if (!presenceControl) {
        // Preserve each interruption as its own turn. Distinct questions/facts
        // must never be concatenated into one fabricated user statement.
        pendingUserTurnQueueRef.current.push({ text: message, messageId: userMessageId });
      }

      try {
        const response = await fetch('/api/lexara/acknowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: message,
            context: { analysisActive: analysisActiveRef.current },
          }),
        });
        const data = response.ok ? await response.json() : null;
        const acknowledgement = String(data?.acknowledgement || '').trim();
        const normalizedAck = normalizeSpeechText(acknowledgement);
        const now = Date.now();
        const duplicateAck = normalizedAck
          && normalizedAck === lastAcknowledgementRef.current.text
          && now - lastAcknowledgementRef.current.at < ACKNOWLEDGEMENT_DEDUPE_MS;
        const acknowledgementTooSoon = !presenceControl
          && now - lastAcknowledgementRef.current.at < ACKNOWLEDGEMENT_COOLDOWN_MS;

        if (acknowledgement && !duplicateAck && !acknowledgementTooSoon) {
          lastAcknowledgementRef.current = { text: normalizedAck, at: now };
          const acknowledgementMessageId = appendMessage('lexara', acknowledgement);
          nonSemanticLexaraMessageIdsRef.current.add(acknowledgementMessageId);
          const controlSpeech = speakLexara(acknowledgement, generationRef.current)
            .catch(() => undefined);
          controlAcknowledgementSpeechRef.current = controlSpeech;
          await controlSpeech;
          if (controlAcknowledgementSpeechRef.current === controlSpeech) {
            controlAcknowledgementSpeechRef.current = null;
          }
        }
      } catch {
        // The active legal analysis remains authoritative even if the lightweight
        // conversational acknowledgement route fails.
      }
      return;
    }

    userSpeechObservedRef.current = true;
    clearVoiceTurnBuffer();

    const generation = generationRef.current + 1;
    generationRef.current = generation;

    stopSpeaking();

    const controller = new AbortController();
    currentRequestRef.current = controller;
    analysisActiveRef.current = true;
    let requestTimedOut = false;
    const requestTimeout = window.setTimeout(() => {
      requestTimedOut = true;
      controller.abort();
    }, CHAT_TURN_TIMEOUT_MS);

    currentTurnTextRef.current = message;
    const preRenderedMessageId = currentPreRenderedTurnIdRef.current;
    currentPreRenderedTurnIdRef.current = null;
    const excludedQueuedUserIds = new Set<string>([
      ...(preRenderedMessageId ? [preRenderedMessageId] : []),
      ...pendingUserTurnQueueRef.current.map(turn => turn.messageId),
    ]);
    const previousMessages = conversationRef.current
      .filter(item =>
        !(item.role === 'user' && excludedQueuedUserIds.has(item.id))
        && !nonSemanticLexaraMessageIdsRef.current.has(item.id)
      )
      .map(item => ({
        role: item.role,
        content: item.content,
      }));

    const userEmotion = emotionFromUserText(message);
    responseEmotionRef.current = userEmotion === 'calm' ? 'authoritative' : userEmotion;

    if (!preRenderedMessageId) appendMessage('user', message);
    setUserInput('');
    setErrorMessage(null);
    setConversationPhase('thinking');
    setEmotion(userEmotion);
    setGaze('thinking');

    try {
      const sharedContext = {
        previousMessages,
        lawType: lawTypeId,
        lawTypeName,
        jurisdiction,
        sessionId: sessionIdRef.current,
        behaviorMode: 'professional',
      };

      // Start the deep legal/Harmony path immediately, but do not make the user
      // wait silently for it. The acknowledgement endpoint is deliberately
      // sub-LLM and returns a context-aware conversational response right away.
      const analysisPromise = fetch('/api/lexara/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: message,
          includeAudio: false,
          context: sharedContext,
        }),
      });

      const acknowledgementPromise = fetch('/api/lexara/acknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: message,
          context: { ...sharedContext, analysisActive: false },
        }),
      })
        .then(async response => {
          if (!response.ok) return null;
          return response.json();
        })
        .catch(() => null);

      let analysisSettled = false;
      const trackedAnalysisPromise = analysisPromise.finally(() => {
        analysisSettled = true;
      });

      const firstEvent = await Promise.race([
        trackedAnalysisPromise.then(() => 'analysis' as const),
        new Promise<'ack'>(resolve => {
          window.setTimeout(() => resolve('ack'), ACKNOWLEDGEMENT_SOFT_TIMEOUT_MS);
        }),
      ]);

      let acknowledgement = '';
      let acknowledgementSpeech: Promise<void> | null = null;
      if (firstEvent === 'ack' && !analysisSettled) {
        const acknowledgementData = await Promise.race([
          acknowledgementPromise,
          new Promise<null>(resolve => {
            window.setTimeout(() => resolve(null), 250);
          }),
        ]);
        acknowledgement = String(acknowledgementData?.acknowledgement || '').trim();
        const normalizedAck = normalizeSpeechText(acknowledgement);
        const now = Date.now();
        const duplicateAck = normalizedAck
          && normalizedAck === lastAcknowledgementRef.current.text
          && now - lastAcknowledgementRef.current.at < ACKNOWLEDGEMENT_DEDUPE_MS;
        const acknowledgementTooSoon =
          now - lastAcknowledgementRef.current.at < ACKNOWLEDGEMENT_COOLDOWN_MS;

        if (
          acknowledgement
          && !duplicateAck
          && !acknowledgementTooSoon
          && generation === generationRef.current
        ) {
          lastAcknowledgementRef.current = { text: normalizedAck, at: now };
          const acknowledgementMessageId = appendMessage('lexara', acknowledgement);
          nonSemanticLexaraMessageIdsRef.current.add(acknowledgementMessageId);
          setGaze('camera');
          acknowledgementSpeech = speakLexara(acknowledgement, generation)
            .catch(() => undefined)
            .then(() => {
              if (
                generation === generationRef.current
                && currentRequestRef.current
                && !activeLexaraSpeechRef.current
              ) {
                setConversationPhase('thinking');
                setGaze('thinking');
              }
            });
        }
      }

      const response = await trackedAnalysisPromise;

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || body?.message || `LEXARA request failed (${response.status})`);
      }

      const data = await response.json();
      if (generation !== generationRef.current) return;
      // Model/research work is complete before TTS begins. A barge-in during
      // answer playback is a new turn, not an "analysis still running" check-in.
      analysisActiveRef.current = false;

      const answer = String(data?.response || '').trim();
      if (!answer) throw new Error('LEXARA returned an empty response');

      if (data?.jurisdiction && typeof data.jurisdiction === 'string') {
        setJurisdiction(data.jurisdiction);
      }

      // Presence/control turns intentionally return the acknowledgement itself.
      // Do not render or speak the same sentence twice.
      const duplicateOfAcknowledgement =
        acknowledgement
        && normalizeSpeechText(answer) === normalizeSpeechText(acknowledgement);

      if (acknowledgementSpeech && !duplicateOfAcknowledgement) {
        // Do not make the substantive answer wait for filler audio. The voice
        // engine resolves the interrupted acknowledgement and the answer takes
        // the floor immediately.
        stopSpeaking();
      }

      if (!duplicateOfAcknowledgement) {
        // A check-in acknowledgement may still be speaking when the deep answer
        // becomes ready. Wait for every currently-active control acknowledgement
        // so LEXARA never talks over herself or cuts off the user's check-in.
        while (controlAcknowledgementSpeechRef.current) {
          const controlSpeech = controlAcknowledgementSpeechRef.current;
          await controlSpeech;
          if (controlAcknowledgementSpeechRef.current === controlSpeech) break;
        }

        appendMessage('lexara', answer);
        setGaze('camera');
        await speakLexara(answer, generation);
      }
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
        analysisActiveRef.current = false;
        currentTurnTextRef.current = '';
        const pending = pendingUserTurnQueueRef.current.shift();
        if (pending?.text.trim()) {
          currentPreRenderedTurnIdRef.current = pending.messageId;
          window.setTimeout(() => handleMessageRef.current(pending.text), 0);
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
    if (!isMasterSession || typeof window === 'undefined') return;

    // Master-only privacy/state invariant: every law area and every fresh master
    // login starts a new matter. Remove all persisted LEXARA session state, then
    // rotate the in-memory session when the selected law area changes.
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith('lexara-live-session:')) {
        window.sessionStorage.removeItem(key);
      }
    }

    currentRequestRef.current?.abort();
    currentRequestRef.current = null;
    generationRef.current += 1;
    sessionIdRef.current = makeSessionId();
    conversationRef.current = [];
    setConversation([]);
    setJurisdiction(undefined);
    greetingRef.current = false;
    pendingUserTurnQueueRef.current = [];
    currentPreRenderedTurnIdRef.current = null;
    nonSemanticLexaraMessageIdsRef.current.clear();
    currentTurnTextRef.current = '';
    analysisActiveRef.current = false;
    controlAcknowledgementSpeechRef.current = null;
    lastAcknowledgementRef.current = { text: '', at: 0 };
    clearVoiceTurnBuffer();
  }, [clearVoiceTurnBuffer, isMasterSession, lawTypeId]);

  useEffect(() => {
    if (isMasterSession) return;
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
  }, [conversation, isMasterSession, jurisdiction]);

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
                Continuing the analysis…
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
