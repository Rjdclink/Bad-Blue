import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Download, FileText, Loader2, Mic, MicOff, Send, Star } from 'lucide-react';
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
const BROWSER_FINAL_FALLBACK_SETTLE_MS = 1_200;
const SERVER_VOICE_TURN_SETTLE_MS = 300;
const FLUX_FINAL_SETTLE_MS = 1_200;
const VOICE_END_GRACE_MS = 850;
const INCOMPLETE_TURN_GRACE_MS = 2_200;
const CHAT_TURN_TIMEOUT_MS = 10 * 60_000;
const RESEARCH_PROGRESS_FIRST_MS = 8_000;
const RESEARCH_PROGRESS_REPEAT_MS = 30_000;
const ACKNOWLEDGEMENT_SOFT_TIMEOUT_MS = 450;
const ACKNOWLEDGEMENT_DEDUPE_MS = 8_000;
const ACKNOWLEDGEMENT_COOLDOWN_MS = 2_500;
const MAX_STORED_CONVERSATION_MESSAGES = 24;

async function readLexaraSseResponse(response: Response, onEvent: (event: string, data: any) => void): Promise<any> {
  if (!response.ok || !response.body) throw new Error(`LEXARA stream failed (${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed: any = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = 'message';
      let dataText = '';
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataText += line.slice(5).trim();
      }
      if (dataText) {
        const data = JSON.parse(dataText);
        onEvent(event, data);
        if (event === 'complete') completed = data;
        if (event === 'error') throw new Error(data?.error || 'LEXARA research failed');
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
  if (!completed) throw new Error('LEXARA stream ended before completion');
  return completed;
}

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

  if (
    words.length >= 3
    && /^(?:i|we|he|she|they)\s+/.test(normalized)
    && /ing$/.test(last)
  ) {
    return true;
  }

  return false;
}

function isStrongBargeIn(text: string, meta: VoiceTranscriptMeta): boolean {
  const normalized = normalizeSpeechText(text);
  if (!normalized) return false;
  const explicit = /^(?:wait|stop|no|hold on|hang on|actually|but wait|let me finish)\b/.test(normalized);
  if (explicit) return true;

  const nonInterruptingClosers = new Set([
    'thank you', 'thanks', 'bye', 'goodbye', 'you',
  ]);
  const nonInterruptingBackchannels = new Set([
    'uh huh', 'uhuh', 'mm hmm', 'mmhmm', 'mhm', 'hmm',
  ]);
  if (
    nonInterruptingClosers.has(normalized)
    || nonInterruptingBackchannels.has(normalized)
  ) return false;

  // Short acknowledgements can be either backchannels or deliberate barge-ins.
  // Admit them only when they begin during playback and carry enough acoustic
  // evidence; this avoids turning "okay" into a permanent interruption veto.
  const shortInterruption = new Set(['okay', 'ok', 'yes', 'yeah', 'yep']);
  if (shortInterruption.has(normalized)) {
    const duration = meta.speechDurationMs || 0;
    const strongAcoustics =
      (typeof meta.noSpeechProbability !== 'number' || meta.noSpeechProbability < 0.35)
      && (typeof meta.avgLogprob !== 'number' || meta.avgLogprob > -0.85)
      && (typeof meta.confidence !== 'number' || meta.confidence >= 0.5);
    return meta.startedDuringPlayback === true && duration >= 450 && strongAcoustics;
  }

  const words = normalized.split(' ').filter(Boolean);
  if (words.length === 1) {
    const duration = meta.speechDurationMs || 0;
    const strongAcoustics =
      (typeof meta.noSpeechProbability !== 'number' || meta.noSpeechProbability < 0.35)
      && (typeof meta.avgLogprob !== 'number' || meta.avgLogprob > -0.85)
      && (typeof meta.confidence !== 'number' || meta.confidence >= 0.5);
    const substantiveSingleWord =
      words[0].length >= 3
      && !nonInterruptingClosers.has(words[0])
      && !shortInterruption.has(words[0]);
    return meta.startedDuringPlayback === true
      && duration >= 300
      && strongAcoustics
      && substantiveSingleWord;
  }

  if (words.length < 2) return false;

  if (typeof meta.speechDurationMs === 'number' && meta.speechDurationMs < 300) return false;
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
  const [voiceStatus, setVoiceStatus] = useState<'live' | 'degraded' | 'reconnecting'>('reconnecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [emotion, setEmotion] = useState<LEXARAEmotionHint>('calm');
  const [gaze, setGaze] = useState<LEXARAGazeHint>('camera');
  const [conversationDocument, setConversationDocument] = useState<{ title: string; content: string } | null>(null);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [pendingDocument, setPendingDocument] = useState<{ title: string; facts: string; state: string; templateMode: boolean } | null>(null);
  const [showReviewPrompt, setShowReviewPrompt] = useState(false);

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
  const pendingActionRef = useRef<{ kind: 'document'; label: string } | null>(null);
  const activeAnalysisNeedsReconciliationRef = useRef(false);
  const lastAcknowledgementRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const controlAcknowledgementSpeechRef = useRef<Promise<void> | null>(null);
  const responseEmotionRef = useRef<LEXARAEmotionHint>('authoritative');
  const activeLexaraSpeechRef = useRef('');
  const recentLexaraSpeechRef = useRef<{ text: string; expiresAt: number }>({ text: '', expiresAt: 0 });
  const autoInterruptRef = useRef<() => void>(() => undefined);
  const lastFinalVoiceSegmentRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const validatedBargeInUtterancesRef = useRef<Set<number>>(new Set());
  const speculativeRequestRef = useRef<{ text: string; controller: AbortController; promise: Promise<Response> } | null>(null);
  const researchProgressTimerRef = useRef<number | null>(null);

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

  const voiceKeyterms = useMemo(
    () => [...new Set([
      'LEXARA',
      'LegalWhat',
      lawTypeName || '',
      jurisdiction || '',
    ].map(value => value.trim()).filter(Boolean))],
    [jurisdiction, lawTypeName],
  );

  const voiceMode = useVoiceMode({
    continuous: true,
    interimResults: true,
    keyterms: voiceKeyterms,
    shouldProbeBargeIn: () => phaseRef.current === 'speaking',
    onEagerTurn: (text) => {
      // EagerEndOfTurn is display/preparation-only. It never owns the user's
      // authoritative turn buffer and never starts conversational work before
      // confirmed EndOfTurn. The final event supplies the committed transcript.
      void text;
    },
    onTurnResumed: () => {
      speculativeRequestRef.current?.controller.abort();
      speculativeRequestRef.current = null;
    },
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

      // Speaker-tail leakage can be transcribed as a plausible stock closer even
      // when lexical echo matching misses it. During or immediately after LEXARA
      // playback, short generic courtesy fragments are non-semantic unless the
      // user produces a substantive turn. The server independently verifies the
      // same suspicious class with the secondary ASR route.
      const normalizedObserved = normalizeSpeechText(observed);
      const genericPlaybackTail = new Set([
        'thank you', 'thanks', 'bye', 'goodbye', 'you',
      ]);
      if (
        meta.engine === 'server'
        && echoReference
        && genericPlaybackTail.has(normalizedObserved)
        && (meta.startedDuringPlayback || (meta.speechDurationMs || 0) < 1_200)
      ) {
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
          // A normal sentence that merely starts while LEXARA is speaking is not
          // allowed to promote itself into user-turn authority. It must have won
          // the non-destructive barge-in probe above. The only short-final
          // exception is an explicit floor-control phrase, which preserves
          // immediate "stop/wait/no" interruption without admitting plausible
          // speaker-leakage hallucinations as blue user messages.
          const explicitPlaybackControl =
            /^(?:wait|stop|no|hold on|hang on|actually|but wait|let me finish)\b/i.test(observed.trim());
          if (
            isFinal
            && explicitPlaybackControl
            && !isSuspiciousGenericServerTranscript(observed, meta)
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
      const settleMs = meta.provider === 'deepgram-flux'
        ? (isLikelyIncompleteUtterance(bufferedTurn) ? INCOMPLETE_TURN_GRACE_MS : FLUX_FINAL_SETTLE_MS)
        : isLikelyIncompleteUtterance(bufferedTurn)
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

  const checkVoiceBackendReadiness = useCallback(async (): Promise<boolean> => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2_500);
    try {
      const response = await fetch('/api/lexara/voice/live-readiness', {
        credentials: 'include',
        signal: controller.signal,
      });
      if (!response.ok) {
        setVoiceStatus('reconnecting');
        return false;
      }
      const data = await response.json().catch(() => ({}));
      const ready = data?.liveVoiceConfigured === true
        && data?.speechOutputVerified === true
        && Array.isArray(data?.outputProviders)
        && data.outputProviders.length > 0;
      setVoiceStatus(ready ? 'live' : 'reconnecting');
      return ready;
    } catch {
      setVoiceStatus('reconnecting');
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
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

      const backendReady = await checkVoiceBackendReadiness();
      setVoiceReady(backendReady);
      setErrorMessage(null);
      setConversationPhase(backendReady ? 'listening' : 'text-only');
      return backendReady;
    } catch (error) {
      setVoiceReady(false);
      setErrorMessage(friendlyError(error));
      setConversationPhase('text-only');
      return false;
    }
  }, [checkVoiceBackendReadiness, enableRecognition, setConversationPhase, startListening]);

  const speakLexara = useCallback(async (text: string, generation?: number) => {
    // TTS must only receive the same finalized semantic text rendered in chat.
    // Reject control characters / malformed transport residue rather than
    // synthesizing it as audible gibberish.
    const finalizedSpeech = String(text || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim();
    if (!finalizedSpeech) return;
    text = finalizedSpeech;
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

    let voiceFailed = false;
    try {
      await speak(text, {
        context: 'guidance',
        autoPlay: true,
        onError: () => {
          voiceFailed = true;
          setVoiceReady(false);
          setVoiceStatus('reconnecting');
          setConversationPhase('text-only');
        },
      });
    } finally {
      activeLexaraSpeechRef.current = '';
      recentLexaraSpeechRef.current = { text, expiresAt: Date.now() + 8_000 };
      resumeListening();
      if (generation === undefined || generation === generationRef.current) {
        if (voiceFailed) {
          setConversationPhase('text-only');
        } else if (analysisActiveRef.current) {
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
        // Preserve each interruption as its own turn, then cancel the superseded
        // generation immediately. The queued turn inherits the accumulated
        // conversation facts and starts as soon as the abort unwinds instead of
        // waiting for obsolete legal work to finish and be discarded.
        pendingUserTurnQueueRef.current.push({ text: message, messageId: userMessageId });
        activeAnalysisNeedsReconciliationRef.current = true;
        currentRequestRef.current.abort();
      }

      try {
        const response = await fetch('/api/lexara/acknowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: message,
            context: {
              analysisActive: analysisActiveRef.current || pendingActionRef.current !== null,
              pendingAction: pendingActionRef.current?.label,
            },
          }),
        });
        const data = response.ok ? await response.json() : null;
        const acknowledgementKind = String(data?.kind || '');
        if (
          !presenceControl
          && (acknowledgementKind === 'added-facts' || acknowledgementKind === 'analysis')
        ) {
          // A factual update can materially change the answer already being
          // computed. Mark that answer stale, but keep the work alive until the
          // update is safely queued; the next turn reconciles the new fact with
          // the existing case context instead of presenting an obsolete result.
          activeAnalysisNeedsReconciliationRef.current = true;
        }
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
    activeAnalysisNeedsReconciliationRef.current = false;
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
      const speculative = speculativeRequestRef.current;
      // Speculative /chat responses cannot carry progressive Pantheon SSE
      // evidence. Reuse them only for turns that do not need grounded research.
      const researchLikely = /\?|\b(?:look\s+(?:it|this|that)\s+up|search|research|verify|find\s+out|check|investigate|current|currently|latest|today|now|record|filing|docket|license|mortgage|inmate|incarcerat|property)\b/i.test(message);
      const canReuseSpeculative = speculative?.text === message && !researchLikely;
      const analysisPromise = canReuseSpeculative
        ? speculative!.promise
        : fetch('/api/lexara/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            signal: controller.signal,
            body: JSON.stringify({
              prompt: message,
              includeAudio: false,
              context: sharedContext,
            }),
          });
      if (!canReuseSpeculative) speculative?.controller.abort();
      speculativeRequestRef.current = null;

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

      // Long Pantheon research must never look frozen. Progress messages are
      // explicitly non-semantic and only appear while the same request is still
      // running; they never claim a finding or confidence level that the server
      // has not returned.
      let progressCount = 0;
      const scheduleResearchProgress = () => {
        researchProgressTimerRef.current = window.setTimeout(() => {
          if (generation !== generationRef.current || !currentRequestRef.current || analysisSettled) return;
          progressCount += 1;
          const progressText = progressCount === 1
            ? "I'm still looking for that information. I haven't found evidence strong enough to give you a reliable answer yet."
            : "I'm still researching that and checking additional sources.";
          const progressMessageId = appendMessage('lexara', progressText);
          nonSemanticLexaraMessageIdsRef.current.add(progressMessageId);
          void speakLexara(progressText, generation).catch(() => undefined);
          scheduleResearchProgress();
        }, progressCount === 0 ? RESEARCH_PROGRESS_FIRST_MS : RESEARCH_PROGRESS_REPEAT_MS);
      };
      scheduleResearchProgress();

      const response = await trackedAnalysisPromise;
      let data: any;
      if (canReuseSpeculative) {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body?.error || body?.message || `LEXARA request failed (${response.status})`);
        }
        data = await response.json();
      } else {
        data = await readLexaraSseResponse(response, (event, payload) => {
          if (generation !== generationRef.current || event !== 'research') return;
          if (payload?.type === 'evidence' || payload?.type === 'checkpoint') {
            const confidence = Math.max(0, Math.min(100, Math.round(Number(payload?.confidence || 0) * 100)));
            const evidenceText = String(payload?.evidence || '').trim();
            if (!evidenceText) return;
            const progressiveText = confidence >= 80
              ? `${evidenceText.slice(0, 500)}`
              : `${evidenceText.slice(0, 500)} I'm continuing to verify this.`;
            const progressiveId = appendMessage('lexara', progressiveText);
            nonSemanticLexaraMessageIdsRef.current.add(progressiveId);
            void speakLexara(progressiveText, generation).catch(() => undefined);
          }
        });
      }
      if (researchProgressTimerRef.current !== null) {
        window.clearTimeout(researchProgressTimerRef.current);
        researchProgressTimerRef.current = null;
      }
      if (generation !== generationRef.current) return;
      if (data?.documentIntent?.requested === true) {
        const resolvedJurisdiction = String(data?.jurisdiction || jurisdiction || '').trim();
        if (resolvedJurisdiction) {
          const facts = [...previousMessages, { role: 'user', content: message }]
            .map(item => `${item.role === 'user' ? 'USER' : 'LEXARA'}: ${item.content}`)
            .join('\n\n')
            .slice(-30000);
          const pendingTitle = String(data.documentIntent.documentType || 'Legal Document');
          setPendingDocument({
            title: pendingTitle,
            facts,
            state: resolvedJurisdiction,
            templateMode: data.documentIntent.templateMode === true,
          });
          pendingActionRef.current = { kind: 'document', label: pendingTitle };
        }
      }
      // Model/research work is complete before TTS begins. A barge-in during
      // answer playback is a new turn, not an "analysis still running" check-in.
      analysisActiveRef.current = false;

      const answer = String(data?.response || '').trim();
      if (!answer) throw new Error('LEXARA returned an empty response');

      if (data?.jurisdiction && typeof data.jurisdiction === 'string') {
        setJurisdiction(data.jurisdiction);
      }

      const reconcileBeforeAnswer =
        activeAnalysisNeedsReconciliationRef.current
        && pendingUserTurnQueueRef.current.length > 0;

      // A new fact received during analysis can invalidate the answer that just
      // finished. Do not speak a knowingly stale legal conclusion; the queued
      // factual turn immediately re-runs the analysis against the accumulated
      // case context. Presence checks and new questions do not trigger this.
      if (reconcileBeforeAnswer) {
        return;
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
        // Ask for neutral feedback only after a completed substantive answer.
        // This is not sentiment-gated: positive, negative, and mixed experiences
        // all reach the same review page.
        setShowReviewPrompt(true);
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
      if (researchProgressTimerRef.current !== null) {
        window.clearTimeout(researchProgressTimerRef.current);
        researchProgressTimerRef.current = null;
      }
      if (generation === generationRef.current) {
        currentRequestRef.current = null;
        analysisActiveRef.current = false;
        activeAnalysisNeedsReconciliationRef.current = false;
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
    if (liveEnabled && !voiceReady) return;

    const greetingGeneration = generationRef.current;
    responseEmotionRef.current = 'calm';
    const greeting = 'How can I help you?';

    // Do not consume the one-shot greeting until the voice path is ready.
    // Once ready, reserve it before the await so overlapping readiness effects
    // cannot speak the greeting twice.
    greetingRef.current = true;
    appendMessage('lexara', greeting);
    await speakLexara(greeting, greetingGeneration).catch(() => undefined);
  }, [appendMessage, liveEnabled, speakLexara, voiceReady]);

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
    if (!liveEnabled) return;

    let cancelled = false;
    const recover = async () => {
      const ready = await checkVoiceBackendReadiness();
      if (cancelled || !ready) return;
      if (!voiceReady) {
        setVoiceReady(true);
        setErrorMessage(null);
        // Keep the microphone from winning the startup race against the
        // one-shot spoken greeting. speakLexara() resumes full-duplex
        // recognition as soon as the greeting begins.
        if (greetingRef.current || userSpeechObservedRef.current) {
          startListening();
        }
      }
      if (phaseRef.current === 'text-only' || phaseRef.current === 'initializing') {
        setConversationPhase('listening');
      }
      // Recovery can make voice ready after the one-shot greeting effect already
      // ran. Re-attempt the pending greeting immediately; sendGreeting will only
      // consume it once readiness is true.
      if (!greetingRef.current && !userSpeechObservedRef.current) {
        void sendGreeting();
      }
    };

    void recover();
    const interval = window.setInterval(() => {
      void recover();
    }, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [checkVoiceBackendReadiness, liveEnabled, sendGreeting, setConversationPhase, startListening, voiceReady]);

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
    pendingActionRef.current = null;
    activeAnalysisNeedsReconciliationRef.current = false;
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
    void sendGreeting();
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

  const generateAndDownloadPendingDocument = async (format: 'docx' | 'pdf') => {
    if (!pendingDocument || documentBusy) return;
    setDocumentBusy(true);
    try {
      const generated = await fetch('/api/lexara/documents/generate', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: pendingDocument.state,
          facts: pendingDocument.facts,
          lawType: lawTypeId,
          documentType: pendingDocument.title,
          templateMode: pendingDocument.templateMode,
          instructions: pendingDocument.templateMode
            ? 'Create the requested blank/template legal document. Preserve unknown required facts as bracketed placeholders.'
            : 'Create the requested document from the conversation facts. Preserve unknown required facts as bracketed placeholders.',
        }),
      });
      const data = await generated.json().catch(() => ({}));
      if (!generated.ok || !data?.document) throw new Error(data?.error || 'Document generation failed');
      if (data?.validated !== true || String(data?.documentType || '') !== pendingDocument.title) {
        throw new Error('LEXARA rejected a document that did not match the requested legal-document type');
      }
      const title = String(data?.title || pendingDocument.title);
      const content = String(data.document);
      setConversationDocument({ title, content });
      const exported = await fetch('/api/lexara/documents/export', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, format }),
      });
      if (!exported.ok) throw new Error('Document export failed');
      const blob = await exported.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/[^a-z0-9._-]+/gi, '-') }.${format}`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      setPendingDocument(null);
      pendingActionRef.current = null;
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setDocumentBusy(false);
    }
  };

  const downloadConversationDocument = async (format: 'docx' | 'pdf') => {
    if (!conversationDocument?.content) return;
    const response = await fetch('/api/lexara/documents/export', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: conversationDocument.title, content: conversationDocument.content, format }),
    });
    if (!response.ok) throw new Error('Document export failed');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${conversationDocument.title.replace(/[^a-z0-9._-]+/gi, '-') }.${format}`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  };

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
              {
                liveEnabled && voiceReady
                  ? 'Voice live'
                  : liveEnabled
                    ? 'Voice reconnecting'
                    : 'Text mode'
              }
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

          {pendingDocument && !conversationDocument && (
            <div className="flex justify-start">
              <div className="max-w-[92%] rounded-2xl border bg-card p-4 text-sm shadow-sm">
                <div className="mb-2 font-medium">{pendingDocument.title}</div>
                <div className="mb-3">Would you like your document as a DOCX or PDF?</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={documentBusy} onClick={() => void generateAndDownloadPendingDocument('docx')}><Download className="mr-1 h-4 w-4" />DOCX</Button>
                  <Button size="sm" variant="outline" disabled={documentBusy} onClick={() => void generateAndDownloadPendingDocument('pdf')}><Download className="mr-1 h-4 w-4" />PDF</Button>
                </div>
              </div>
            </div>
          )}

          {(conversationDocument || documentBusy) && (
            <div className="flex justify-start">
              <div className="max-w-[92%] rounded-2xl border bg-card p-4 text-sm shadow-sm">
                <div className="mb-2 flex items-center gap-2 font-semibold"><FileText className="h-4 w-4" />LEXARA Document</div>
                {documentBusy ? (
                  <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Preparing editable document…</div>
                ) : conversationDocument ? (
                  <>
                    <div className="mb-3 font-medium">{conversationDocument.title}</div>
                    <textarea
                      value={conversationDocument.content}
                      onChange={event => setConversationDocument({ ...conversationDocument, content: event.target.value })}
                      className="mb-3 min-h-48 w-full rounded-md border bg-background p-3 font-mono text-xs"
                      aria-label="Editable legal document"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => void downloadConversationDocument('docx')}><Download className="mr-1 h-4 w-4" />DOCX</Button>
                      <Button size="sm" variant="outline" onClick={() => void downloadConversationDocument('pdf')}><Download className="mr-1 h-4 w-4" />PDF</Button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )}

          {/* Interim STT hypotheses are intentionally not rendered as user
              messages. Only a final, echo-screened committed turn can enter
              the visible conversation. */}

          {isThinking && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Continuing the analysis…
              </div>
            </div>
          )}

          {showReviewPrompt && !isThinking && (
            <div className="flex justify-start">
              <a
                href="/reviews?source=lexara"
                className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-sm hover:text-foreground"
                aria-label="Share feedback about Legal What?"
              >
                <Star className="h-3.5 w-3.5" />
                Share feedback
              </a>
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