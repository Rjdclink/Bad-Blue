import { type FormEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CalendarDays, Download, FileText, Loader2, MapPin, Mic, MicOff, PenLine, Send, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { lexaraDocumentSpeech } from '@shared/lexaraDocumentSpeech';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { captureLexaraDeviceLocation, readLexaraDeviceLocation } from '@/lib/lexaraLocation';
import { lexaraRealtimeVoiceClient } from '@/lib/lexaraRealtimeVoiceClient';
import { useLocation } from 'wouter';

interface LexaraConversationProps {
  lawTypeId?: string;
  lawTypeName?: string;
}

interface ConversationDocument {
  title: string;
  content: string;
  documentType: string;
  state?: string;
  esign?: {
    eligible: boolean;
    reason: string;
    authority?: string;
  };
}

interface ConversationMessage {
  id: string;
  role: 'user' | 'lexara';
  content: string;
  timestamp: Date;
  spectraLaunch?: {
    target: string;
    clues: string;
    lexaraSessionId: string;
  };
}

function spectraTargetFromPrompt(value: string): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^(?:please\s+)?(?:show\s+me|where\s+(?:is|'s))\s+(.+?)[?.!]*$/i);
  const target = match?.[1]?.trim().replace(/[?.!]+$/g, '').trim() || '';
  return target.length >= 2 && target.length <= 500 ? target : null;
}

type ConversationPhase =
  | 'initializing'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'text-only'
  | 'error';

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
const SPEAKER_TAIL_GUARD_MS = 900;
const REALTIME_OVERLAP_MIN_EOT_CONFIDENCE = 0.7;

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

function approximatelySameSpeechWord(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.min(left.length, right.length) < 4 || Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return edits + (leftIndex < left.length || rightIndex < right.length ? 1 : 0) <= 1;
}

function isLikelyPlaybackEchoFragment(value: string): boolean {
  const normalized = normalizeSpeechText(value);
  const words = normalized.split(' ').filter(Boolean);
  return words.length > 0
    && words.length <= 4
    && !/^(?:wait|stop|no|hold on|hang on|actually|but wait|let me finish)\b/.test(normalized)
    && /^(?:on|in|at|to|from|with|for|of|by|about|under|over)\b/.test(normalized);
}

function looksLikeLexaraEcho(candidate: string, spokenText: string, tolerant = false): boolean {
  const normalizedCandidate = normalizeSpeechText(candidate);
  const normalizedSpoken = normalizeSpeechText(spokenText);
  if (!normalizedCandidate || !normalizedSpoken) return false;

  const candidateWords = normalizedCandidate.split(' ').filter(Boolean);
  const spokenWords = normalizedSpoken.split(' ').filter(Boolean);

  if (candidateWords.length === 1) {
    const word = candidateWords[0];
    if (word.length < 5) return false;
    return tolerant
      ? spokenWords.some(spoken => approximatelySameSpeechWord(word, spoken))
      : spokenWords.includes(word);
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
  if (candidateWords.length >= 3 && longestRun >= 3 && orderedEchoRatio >= 0.8) return true;
  if (!tolerant) return false;

  for (let start = 0; start <= spokenWords.length - candidateWords.length; start += 1) {
    let matches = 0;
    let hasAnchor = false;
    for (let index = 0; index < candidateWords.length; index += 1) {
      if (approximatelySameSpeechWord(candidateWords[index], spokenWords[start + index])) {
        matches += 1;
        if (candidateWords[index].length >= 4) hasAnchor = true;
      }
    }
    if (hasAnchor && matches / candidateWords.length >= 0.75) return true;
  }
  return false;
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
  const { user, isLoading: authLoading } = useAuth();
  const isMasterSession = Boolean((user as any)?.isMasterBypass);
  const userId = (user as any)?.id || (user as any)?.claims?.sub;
  const sessionIdRef = useRef(makeSessionId());

  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [phase, setPhase] = useState<ConversationPhase>('initializing');
  const [jurisdiction, setJurisdiction] = useState<string | undefined>();
  const [representationMatter, setRepresentationMatter] = useState<any | null>(null);
  const [hasSavedMatters, setHasSavedMatters] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<'live' | 'degraded' | 'reconnecting'>('reconnecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [emotion, setEmotion] = useState<LEXARAEmotionHint>('calm');
  const [gaze, setGaze] = useState<LEXARAGazeHint>('camera');
  const [conversationDocument, setConversationDocument] = useState<ConversationDocument | null>(null);
  const [savedArtifact, setSavedArtifact] = useState<{ title: string; fileName: string; mimeType: string; downloadUrl: string } | null>(null);
  const [deadlineCalendar, setDeadlineCalendar] = useState<{ label: string; dueDate: string; downloadUrl: string } | null>(null);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentPreviewOpen, setDocumentPreviewOpen] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [esignConsent, setEsignConsent] = useState(false);
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignBusy, setEsignBusy] = useState(false);
  const [signatureHasInk, setSignatureHasInk] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const signatureDrawingRef = useRef(false);

  useEffect(() => {
    // Reuse browser geolocation only when permission is already granted. Live
    // consent may have populated the signal; text-only mode never gets a surprise prompt.
    void captureLexaraDeviceLocation({ prompt: false }).catch(() => undefined);
  }, []);
  const [pendingDocument, setPendingDocument] = useState<{ title: string; facts: string; state: string; templateMode: boolean; missingFields?: string[]; packetItem?: boolean } | null>(null);
  const [showReviewPrompt, setShowReviewPrompt] = useState(false);

  const conversationRef = useRef<ConversationMessage[]>([]);
  const historyReadyRef = useRef(false);
  const phaseRef = useRef<ConversationPhase>('initializing');
  const currentRequestRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const initializedRef = useRef(false);
  // Greeting is scoped to this page entry, not persisted conversation history.
  const greetingRef = useRef(false);
  const greetingDisplayedRef = useRef(false);
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
  const recentLexaraSpeechEndedAtRef = useRef(0);
  const autoInterruptRef = useRef<(reason?: string) => void>(() => undefined);
  const lastFinalVoiceSegmentRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const validatedBargeInUtterancesRef = useRef<Set<number>>(new Set());
  const realtimeBargeInCandidatesRef = useRef<Set<number>>(new Set());
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

      const normalizedObserved = normalizeSpeechText(observed);
      const explicitPlaybackControl =
        /^(?:wait|stop|no|hold on|hang on|actually|but wait|let me finish)\b/i.test(normalizedObserved);
      const speakerTailActive =
        recentLexaraSpeechEndedAtRef.current > 0
        && Date.now() - recentLexaraSpeechEndedAtRef.current <= SPEAKER_TAIL_GUARD_MS;

      // Keep the microphone live while LEXARA speaks, but never trust VAD/AEC
      // alone. A transcript must first survive lexical echo rejection before it
      // can become either a barge-in probe or an authoritative user turn.
      const echoReference = activeLexaraSpeechRef.current
        || (Date.now() <= recentLexaraSpeechRef.current.expiresAt
          ? recentLexaraSpeechRef.current.text
          : '');

      if (
        !explicitPlaybackControl
        && echoReference
        && looksLikeLexaraEcho(
          observed,
          echoReference,
          meta.startedDuringPlayback === true || phaseRef.current === 'speaking' || speakerTailActive,
        )
      ) {
        lexaraRealtimeVoiceClient.reportInputDecision('realtime-input-rejected', 'suspected-echo');
        return;
      }

      // Speaker-tail leakage can be transcribed as a plausible stock closer even
      // when lexical echo matching misses it. During or immediately after LEXARA
      // playback, short generic courtesy fragments are non-semantic unless the
      // user produces a substantive turn. The server independently verifies the
      // same suspicious class with the secondary ASR route.
      const genericPlaybackTail = new Set([
        'thank you', 'thanks', 'bye', 'goodbye', 'you',
      ]);
      if (
        meta.engine === 'server'
        && echoReference
        && genericPlaybackTail.has(normalizedObserved)
        && (meta.startedDuringPlayback || (meta.speechDurationMs || 0) < 1_200)
      ) {
        lexaraRealtimeVoiceClient.reportInputDecision('realtime-input-rejected', 'generic-playback-tail');
        return;
      }

      if (
        speakerTailActive
        && meta.engine === 'server'
        && !meta.startedDuringPlayback
        && !explicitPlaybackControl
        && isLikelyPlaybackEchoFragment(observed)
      ) {
        lexaraRealtimeVoiceClient.reportInputDecision('realtime-input-rejected', 'speaker-tail');
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
            if (meta.provider === 'deepgram-flux') {
              realtimeBargeInCandidatesRef.current.add(meta.utteranceId);
            } else {
              validatedBargeInUtterancesRef.current.add(meta.utteranceId);
            }
          }
          autoInterruptRef.current(explicitPlaybackControl ? 'explicit-floor-control' : 'barge-in-candidate');
        }
        return;
      }

      if (meta.startedDuringPlayback && typeof meta.utteranceId === 'number') {
        const alreadyValidated = validatedBargeInUtterancesRef.current.has(meta.utteranceId);
        if (!alreadyValidated) {
          const realtimeCandidate =
            meta.provider === 'deepgram-flux'
            && realtimeBargeInCandidatesRef.current.has(meta.utteranceId);
          const finalRealtimeOwnership =
            isFinal
            && realtimeCandidate
            && (typeof meta.endOfTurnConfidence !== 'number'
              || meta.endOfTurnConfidence >= REALTIME_OVERLAP_MIN_EOT_CONFIDENCE)
            && !isLikelyPlaybackEchoFragment(observed)
            && !isSuspiciousGenericServerTranscript(observed, meta)
            && isStrongBargeIn(observed, meta);

          if (
            isFinal
            && explicitPlaybackControl
            && !isSuspiciousGenericServerTranscript(observed, meta)
          ) {
            validatedBargeInUtterancesRef.current.add(meta.utteranceId);
            lexaraRealtimeVoiceClient.reportInputDecision('realtime-input-confirmed', 'explicit-floor-control');
            if (phaseRef.current === 'speaking') autoInterruptRef.current('explicit-floor-control');
          } else if (finalRealtimeOwnership) {
            validatedBargeInUtterancesRef.current.add(meta.utteranceId);
            lexaraRealtimeVoiceClient.reportInputDecision('realtime-input-confirmed', 'confirmed-user-speech');
            if (phaseRef.current === 'speaking') autoInterruptRef.current();
          } else {
            realtimeBargeInCandidatesRef.current.delete(meta.utteranceId);
            lexaraRealtimeVoiceClient.reportInputDecision('realtime-input-rejected', 'unverified-playback-overlap');
            return;
          }
        }
      }

      if (
        isFinal
        && meta.engine === 'server'
        && isSuspiciousGenericServerTranscript(observed, meta)
      ) {
        lexaraRealtimeVoiceClient.reportInputDecision('realtime-input-rejected', 'low-speech-evidence');
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
        autoInterruptRef.current(explicitPlaybackControl ? 'explicit-floor-control' : 'confirmed-user-speech');
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
        realtimeBargeInCandidatesRef.current.delete(meta.utteranceId);
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

  const updateMessageContent = useCallback((id: string, content: string) => {
    setConversation(previous => {
      const next = previous.map(message =>
        message.id === id ? { ...message, content } : message
      );
      conversationRef.current = next;
      return next;
    });
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
    if (!finalizedSpeech) return false;
    text = finalizedSpeech;
    if (!liveEnabled || !voiceReady) {
      if (generation === undefined || generation === generationRef.current) {
        setConversationPhase('text-only');
      }
      return false;
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
    let playbackStarted = false;
    try {
      await speak(text, {
        context: 'guidance',
        autoPlay: true,
        onStart: () => { playbackStarted = true; },
        onError: () => {
          voiceFailed = true;
          setVoiceReady(false);
          setVoiceStatus('reconnecting');
          setConversationPhase('text-only');
        },
      });
    } finally {
      activeLexaraSpeechRef.current = '';
      recentLexaraSpeechEndedAtRef.current = Date.now();
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
    return playbackStarted;
  }, [clearVoiceTurnBuffer, liveEnabled, resumeListening, setConversationPhase, speak, voiceReady]);

  const handleUserMessage = useCallback(async (rawMessage: string) => {
    if (!historyReadyRef.current) return;
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
      if (pendingDocument?.missingFields?.length) {
        const activeField = pendingDocument.missingFields[0];
        setPendingDocument(previous => previous ? {
          ...previous,
          facts: `${previous.facts}\n\nLEXARA REQUESTED FORM FIELD: ${activeField}\nUSER ANSWER: ${message}`,
        } : previous);
      }

      const sharedContext = {
        previousMessages,
        lawType: lawTypeId,
        lawTypeName,
        jurisdiction,
        deviceLocation: readLexaraDeviceLocation(),
        sessionId: sessionIdRef.current,
        representationMatter,
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
      let streamedAnswer = '';
      let streamedAnswerMessageId: string | null = null;
      let streamedSpeechTurnId: string | null = null;
      let streamedSpeechCompletion: Promise<void> | null = null;
      let streamedSpeechFailed = false;
      let progressiveSpokenText = '';
      const progressiveVoiceReady =
        liveEnabled
        && voiceReady
        && !pendingDocument
        && lexaraRealtimeVoiceClient.isSpeechOutputReady();
      if (canReuseSpeculative) {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body?.error || body?.message || `LEXARA request failed (${response.status})`);
        }
        data = await response.json();
      } else {
        data = await readLexaraSseResponse(response, (event, payload) => {
          if (generation !== generationRef.current) return;

          if (event === 'answer-delta') {
            const delta = String(payload?.delta || '');
            if (!delta) return;
            streamedAnswer += delta;
            if (!streamedAnswerMessageId) {
              streamedAnswerMessageId = appendMessage('lexara', streamedAnswer);
            } else {
              updateMessageContent(streamedAnswerMessageId, streamedAnswer);
            }
            return;
          }

          if (event === 'speech-chunk') {
            const chunk = String(payload?.chunk || '').trim();
            if (!chunk || !progressiveVoiceReady || streamedSpeechFailed) return;
            try {
              if (!streamedSpeechTurnId) {
                streamedSpeechTurnId = `lexara-stream-${generation}-${Date.now()}`;
                clearVoiceTurnBuffer();
                resumeListening();
                setConversationPhase('speaking');
                setEmotion(responseEmotionRef.current);
                setGaze('camera');
                streamedSpeechCompletion = lexaraRealtimeVoiceClient.beginSpeechStream(
                  streamedSpeechTurnId,
                  {
                    onStart: () => {
                      if (generation !== generationRef.current) return;
                      setConversationPhase('speaking');
                    },
                  },
                );
              }
              progressiveSpokenText = `${progressiveSpokenText}${progressiveSpokenText ? ' ' : ''}${chunk}`;
              activeLexaraSpeechRef.current = progressiveSpokenText;
              recentLexaraSpeechRef.current = {
                text: progressiveSpokenText,
                expiresAt: Number.POSITIVE_INFINITY,
              };
              lexaraRealtimeVoiceClient.appendSpeechStream(chunk, streamedSpeechTurnId);
            } catch {
              streamedSpeechFailed = true;
              lexaraRealtimeVoiceClient.interrupt();
              streamedSpeechTurnId = null;
              streamedSpeechCompletion = null;
              activeLexaraSpeechRef.current = '';
            }
            return;
          }

          if (event === 'research' && (payload?.type === 'evidence' || payload?.type === 'checkpoint')) {
            return;
          }
        });
      }
      if (researchProgressTimerRef.current !== null) {
        window.clearTimeout(researchProgressTimerRef.current);
        researchProgressTimerRef.current = null;
      }
      if (generation !== generationRef.current) return;
      if (data?.representationMatter && typeof data.representationMatter === 'object') {
        setRepresentationMatter(data.representationMatter);
      }
      if (data?.savedArtifact?.downloadUrl && typeof data.savedArtifact.downloadUrl === 'string') {
        setSavedArtifact({
          title: String(data.savedArtifact.title || 'Saved file'),
          fileName: String(data.savedArtifact.fileName || data.savedArtifact.title || 'legalwhat-file'),
          mimeType: String(data.savedArtifact.mimeType || 'application/octet-stream'),
          downloadUrl: data.savedArtifact.downloadUrl,
        });
      } else {
        setSavedArtifact(null);
      }
      if (data?.deadlineCalendarUrl && data?.deadline?.dueDate) {
        setDeadlineCalendar({
          label: String(data.deadline?.rule?.label || 'Legal deadline'),
          dueDate: String(data.deadline.dueDate),
          downloadUrl: String(data.deadlineCalendarUrl),
        });
      } else {
        setDeadlineCalendar(null);
      }
      if (typeof data?.matterSessionId === 'string' && data.matterSessionId.trim()) {
        sessionIdRef.current = data.matterSessionId.trim();
      }
      const priorPendingDocument = pendingDocument;
      const documentIntentRequested = data?.documentIntent?.requested === true;
      const documentFollowup = /\b(?:document|draft|form|letter|complaint|petition|motion|affidavit|declaration|pdf|docx|edit|revise|change|paragraph|section|signature|download|export|file|filing)\b/i.test(message)
        || Boolean(priorPendingDocument?.missingFields?.length);
      // Document controls belong to the active document task, never to the
      // conversation globally. An unrelated completed turn retires stale UI.
      if (!documentIntentRequested && priorPendingDocument && !documentFollowup) {
        setPendingDocument(null);
        setConversationDocument(null);
        if (pendingActionRef.current?.kind === 'document') pendingActionRef.current = null;
      }
      if (documentIntentRequested) {
        const resolvedJurisdiction = String(data?.jurisdiction || jurisdiction || '').trim();
        if (resolvedJurisdiction) {
          const backgroundDocumentContext = typeof data?.backgroundDocumentContext === 'string'
            ? data.backgroundDocumentContext.trim().slice(0, 9_000)
            : '';
          const conversationFacts = [...previousMessages, { role: 'user', content: message }]
            .map(item => `${item.role === 'user' ? 'USER' : 'LEXARA'}: ${item.content}`)
            .join('\n\n')
            .slice(backgroundDocumentContext ? -20_000 : -30_000);
          const facts = backgroundDocumentContext
            ? `${conversationFacts}\n\nAPPLICATION-SUPPLIED LEXARA BACKGROUND EVIDENCE:\n${backgroundDocumentContext}`
            : conversationFacts;
          const pendingTitle = String(data.documentIntent.documentType || 'Legal Document');
          // A newly requested document replaces the prior document task UI.
          // Keep the conversation, but never let an older preview hide the new task.
          setConversationDocument(null);
          setDocumentPreviewOpen(false);
          setEsignOpen(false);
          setPendingDocument({
            title: pendingTitle,
            facts,
            state: resolvedJurisdiction,
            templateMode: data.documentIntent.templateMode === true,
            packetItem: data.documentIntent.packetItem === true,
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
        if (streamedSpeechTurnId) lexaraRealtimeVoiceClient.interrupt();
        activeLexaraSpeechRef.current = '';
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

        if (streamedAnswerMessageId) {
          updateMessageContent(streamedAnswerMessageId, answer);
        } else {
          appendMessage('lexara', answer);
        }
        // A document-action turn owns the artifact handoff. Keep the full draft
        // visible in chat, but do not feed document bodies/markup/placeholders
        // into realtime TTS; speak only ordinary conversational responses.
        const spokenAnswer = lexaraDocumentSpeech(answer, documentIntentRequested || Boolean(priorPendingDocument));
        // Ask for neutral feedback only after a completed substantive answer.
        // This is not sentiment-gated: positive, negative, and mixed experiences
        // all reach the same review page.
        setShowReviewPrompt(true);
        setGaze('camera');

        if (streamedSpeechTurnId && streamedSpeechCompletion && !streamedSpeechFailed) {
          const completedTurnId = streamedSpeechTurnId;
          const completion = lexaraRealtimeVoiceClient.endSpeechStream(completedTurnId);
          await completion;
          activeLexaraSpeechRef.current = '';
          recentLexaraSpeechEndedAtRef.current = Date.now();
          recentLexaraSpeechRef.current = {
            text: progressiveSpokenText,
            expiresAt: Date.now() + 8_000,
          };
          resumeListening();
          if (generation === generationRef.current) {
            setConversationPhase('listening');
            setEmotion('calm');
          }
        } else {
          const spokenPrefix = progressiveSpokenText.trim();
          const recoverySpeech = streamedSpeechFailed && spokenPrefix && spokenAnswer.startsWith(spokenPrefix)
            ? spokenAnswer.slice(spokenPrefix.length).trim()
            : spokenAnswer;
          if (recoverySpeech) await speakLexara(recoverySpeech, generation);
        }
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
  }, [appendMessage, clearVoiceTurnBuffer, jurisdiction, lawTypeId, lawTypeName, liveEnabled, pendingDocument, representationMatter, resumeListening, setConversationPhase, speakLexara, stopSpeaking, updateMessageContent, voiceReady]);

  handleMessageRef.current = handleUserMessage;

  autoInterruptRef.current = (reason = 'confirmed-user-speech') => {
    recentLexaraSpeechEndedAtRef.current = Date.now();
    stopSpeaking(reason);
    resumeListening();
    setConversationPhase(liveEnabled && voiceReady ? 'listening' : 'text-only');
    setEmotion('calm');
    setGaze('camera');
  };

  const sendGreeting = useCallback(async () => {
    if (!historyReady || greetingRef.current || userSpeechObservedRef.current) return;
    if (liveEnabled && !voiceReady) return;

    const greetingGeneration = generationRef.current;
    responseEmotionRef.current = 'calm';
    const greeting = hasSavedMatters
      ? 'You have saved legal matters I can pull up if you want to continue where you left off. How may I help you?'
      : 'How may I help you?';

    // Do not consume the one-shot greeting until the voice path is ready.
    // Once ready, reserve it before the await so overlapping readiness effects
    // cannot speak the greeting twice.
    greetingRef.current = true;
    if (!greetingDisplayedRef.current) {
      greetingDisplayedRef.current = true;
      appendMessage('lexara', greeting);
    }
    const started = await speakLexara(greeting, greetingGeneration).catch(() => false);
    // Only a pre-playback failure may retry after voice readiness recovers.
    // An interrupted/partially heard greeting must never restart over the user.
    if (liveEnabled && !started && greetingGeneration === generationRef.current) {
      greetingRef.current = false;
    }
  }, [appendMessage, hasSavedMatters, historyReady, liveEnabled, speakLexara, voiceReady]);

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
    setRepresentationMatter(null);
    setHasSavedMatters(false);
    greetingRef.current = false;
    greetingDisplayedRef.current = false;
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
    if (authLoading) return;
    if (isMasterSession) {
      historyReadyRef.current = true;
      setHistoryReady(true);
      return;
    }

    const controller = new AbortController();
    historyReadyRef.current = false;
    setHistoryReady(false);
    setRestoreError(null);
    currentRequestRef.current?.abort();
    currentRequestRef.current = null;
    generationRef.current += 1;
    sessionIdRef.current = makeSessionId();
    conversationRef.current = [];
    setConversation([]);
    setJurisdiction(undefined);
    setRepresentationMatter(null);
    setHasSavedMatters(false);
    greetingRef.current = false;
    greetingDisplayedRef.current = false;
    userSpeechObservedRef.current = false;
    pendingUserTurnQueueRef.current = [];
    nonSemanticLexaraMessageIdsRef.current.clear();

    if (!userId) {
      historyReadyRef.current = true;
      setHistoryReady(true);
      return () => controller.abort();
    }

    const restore = async () => {
      const params = new URLSearchParams();
      if (lawTypeId) params.set('lawType', lawTypeId);
      const response = await fetch(`/api/lexara/conversations/latest?${params}`, {
        credentials: 'include',
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Could not load your last Lexara conversation.');
      const data = await response.json();
      if (data?.success !== true) throw new Error('Could not load your last Lexara conversation.');
      if (controller.signal.aborted) return;

      setHasSavedMatters(data?.hasSavedMatters === true);
      const saved = data.conversation;
      if (saved && Array.isArray(saved.turns) && saved.turns.length) {
        const messages: ConversationMessage[] = saved.turns.flatMap((turn: any) => {
          if (typeof turn?.userPrompt !== 'string' || typeof turn?.lexaraResponse !== 'string') return [];
          const timestamp = new Date(turn.createdAt);
          const at = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
          return [
            { id: `${turn.id}-user`, role: 'user' as const, content: turn.userPrompt, timestamp: at },
            { id: `${turn.id}-lexara`, role: 'lexara' as const, content: turn.lexaraResponse, timestamp: at },
          ];
        });
        if (messages.length) {
          sessionIdRef.current = typeof saved.sessionId === 'string' && saved.sessionId
            ? saved.sessionId : makeSessionId();
          conversationRef.current = messages;
          setConversation(messages);
          const latestContext = saved.turns[saved.turns.length - 1]?.context;
          setJurisdiction(typeof latestContext?.jurisdiction === 'string'
            ? latestContext.jurisdiction : undefined);
          setRepresentationMatter(latestContext?.representationMatter && typeof latestContext.representationMatter === 'object'
            ? latestContext.representationMatter : null);
          // A returning user gets a fresh spoken entry greeting even when the
          // prior matter history is restored beneath it.
          greetingRef.current = false;
          userSpeechObservedRef.current = false;
        }
      }
      historyReadyRef.current = true;
      setHistoryReady(true);
    };

    void restore().catch(() => {
      if (!controller.signal.aborted) {
        setRestoreError('Could not load your last Lexara conversation. Retry before continuing.');
      }
    });
    return () => controller.abort();
  }, [authLoading, isMasterSession, lawTypeId, restoreAttempt, userId]);

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
    if (!historyReady) return restoreError ? 'History unavailable' : 'Restoring conversation';
    if (phase === 'initializing') return 'Preparing live consultation';
    if (phase === 'thinking') return 'Analyzing';
    if (phase === 'speaking') return 'Speaking';
    if (phase === 'listening') return 'Listening';
    if (phase === 'error') return 'Text available';
    return 'Text consultation';
  }, [historyReady, phase, restoreError]);

  const generateAndDownloadPendingDocument = async (format?: 'docx' | 'pdf') => {
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
          packetItem: pendingDocument.packetItem === true,
          packetItemTitle: pendingDocument.packetItem ? pendingDocument.title : undefined,
          templateMode: pendingDocument.templateMode,
          instructions: pendingDocument.templateMode
            ? 'Create the requested blank/template legal document. Preserve unknown required facts as bracketed placeholders.'
            : 'Create the requested document from the conversation facts. Preserve unknown required facts as bracketed placeholders.',
        }),
      });
      const data = await generated.json().catch(() => ({}));
      if (generated.status === 409 && data?.officialFormRequired && data?.officialForm) {
        const official = await fetch('/api/lexara/documents/official-form', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            officialForm: data.officialForm,
            facts: pendingDocument.facts,
            sessionId: sessionIdRef.current,
            lawType: lawTypeId,
          }),
        });
        if (!official.ok) {
          const issue = await official.json().catch(() => ({}));
          const missingFields = Array.isArray(issue?.missingFields)
            ? issue.missingFields.map((field: unknown) => String(field || '').trim()).filter(Boolean)
            : [];
          if (official.status === 422 && missingFields.length) {
            setPendingDocument(previous => previous ? { ...previous, missingFields } : previous);
            const firstField = missingFields[0].replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
            const question = `I need one more piece of information to complete ${pendingDocument.title}: what should I enter for ${firstField}?`;
            appendMessage('lexara', question);
            void speakLexara(question, generationRef.current).catch(() => undefined);
            return;
          }
          const missing = missingFields.length ? ' Missing information: ' + missingFields.join(', ') + '.' : '';
          throw new Error((issue?.error || 'Official form completion failed') + missing);
        }
        const blob = await official.blob();
        const nativeFormat = blob.type.includes('wordprocessingml') ? 'docx' : 'pdf';
        const title = String(data?.officialForm?.title || pendingDocument.title || 'Lexara Official Form');
        const url = URL.createObjectURL(blob);
        if (!format && nativeFormat === 'pdf') {
          window.open(url, '_blank', 'noopener,noreferrer');
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } else {
          const anchor = document.createElement('a');
          anchor.href = url; anchor.download = title.replace(/[^a-z0-9._-]+/gi, '-') + '.' + nativeFormat;
          document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
        }
        setPendingDocument(null); pendingActionRef.current = null; return;
      }
      if (!generated.ok || !data?.document) throw new Error(data?.error || 'Document generation failed');
      // Restore the proven strict handoff: only a server-validated document of
      // the requested type may become the downloadable artifact.
      if (data?.validated !== true || String(data?.documentType || '') !== pendingDocument.title) {
        throw new Error('LEXARA rejected a document that did not match the requested legal-document type');
      }
      const title = String(data?.title || pendingDocument.title);
      const content = String(data.document);
      setConversationDocument({
        title,
        content,
        documentType: String(data?.documentType || pendingDocument.title),
        state: pendingDocument.state,
        esign: data?.esign && typeof data.esign === 'object' ? data.esign : undefined,
      });
      setPendingDocument(null);
      pendingActionRef.current = null;
      if (!format) {
        setDocumentPreviewOpen(true);
        return;
      }
      const exported = await fetch('/api/lexara/documents/export', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, format, sessionId: sessionIdRef.current, lawType: lawTypeId }),
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

  const signaturePoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startSignatureStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    const point = signaturePoint(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineWidth = 2.2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#111827';
    signatureDrawingRef.current = true;
  };

  const continueSignatureStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!signatureDrawingRef.current) return;
    const context = signatureCanvasRef.current?.getContext('2d');
    if (!context) return;
    event.preventDefault();
    const point = signaturePoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    setSignatureHasInk(true);
  };

  const endSignatureStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!signatureDrawingRef.current) return;
    event.preventDefault();
    signatureDrawingRef.current = false;
    signatureCanvasRef.current?.releasePointerCapture?.(event.pointerId);
  };

  const clearSignatureDrawing = () => {
    const canvas = signatureCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    signatureDrawingRef.current = false;
    setSignatureHasInk(false);
  };

  const signConversationDocument = async () => {
    if (!conversationDocument || esignBusy) return;
    if (!conversationDocument.esign?.eligible) {
      throw new Error(conversationDocument.esign?.reason || 'This document requires a jurisdiction-specific signing method');
    }
    if (signerName.trim().length < 2) throw new Error('Enter the signer name');
    if (!esignConsent) throw new Error('Electronic-signature consent is required');

    setEsignBusy(true);
    try {
      const signatureDataUrl = signatureHasInk
        ? signatureCanvasRef.current?.toDataURL('image/png')
        : undefined;
      const response = await fetch('/api/lexara/documents/sign', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: conversationDocument.title,
          content: conversationDocument.content,
          documentType: conversationDocument.documentType,
          state: conversationDocument.state || jurisdiction,
          jurisdiction: conversationDocument.state || jurisdiction,
          lawType: lawTypeId,
          signerName: signerName.trim(),
          consentAccepted: true,
          signatureDataUrl,
          sessionId: sessionIdRef.current,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.esign?.reason || body?.error || 'Electronic signing failed');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${conversationDocument.title.replace(/[^a-z0-9._-]+/gi, '-')}-signed.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setEsignOpen(false);
      setEsignConsent(false);
      clearSignatureDrawing();
    } finally {
      setEsignBusy(false);
    }
  };

  const downloadSavedArtifact = async () => {
    if (!savedArtifact?.downloadUrl) return;
    const response = await fetch(savedArtifact.downloadUrl, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Saved file retrieval failed');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = savedArtifact.fileName || savedArtifact.title || 'legalwhat-file';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const downloadConversationDocument = async (format: 'docx' | 'pdf') => {
    if (!conversationDocument?.content) return;
    const response = await fetch('/api/lexara/documents/export', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: conversationDocument.title,
        content: conversationDocument.content,
        format,
        sessionId: sessionIdRef.current,
        lawType: lawTypeId,
      }),
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
          {!historyReady && !restoreError && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Restoring your last conversation…
            </div>
          )}
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

          {savedArtifact && (
            <div className="flex justify-start">
              <div className="max-w-[92%] rounded-2xl border bg-card p-4 text-sm shadow-sm">
                <div className="mb-2 flex items-center gap-2 font-semibold">
                  <FileText className="h-4 w-4" />
                  Saved legal matter file
                </div>
                <div className="mb-3">{savedArtifact.title}</div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void downloadSavedArtifact().catch(error => setErrorMessage(friendlyError(error)))}
                >
                  <Download className="mr-1 h-4 w-4" />
                  Open saved file
                </Button>
              </div>
            </div>
          )}

          {deadlineCalendar && (
            <div className="flex justify-start">
              <div className="max-w-[92%] rounded-2xl border bg-card p-4 text-sm shadow-sm">
                <div className="mb-2 flex items-center gap-2 font-semibold">
                  <CalendarDays className="h-4 w-4" />
                  Calculated legal deadline
                </div>
                <div className="mb-3">{deadlineCalendar.label}: {deadlineCalendar.dueDate}</div>
                <Button size="sm" variant="outline" asChild>
                  <a href={deadlineCalendar.downloadUrl}>
                    <Download className="mr-1 h-4 w-4" />
                    Add reminder to calendar
                  </a>
                </Button>
              </div>
            </div>
          )}

          {pendingDocument && !conversationDocument && (
            <div className="flex justify-start">
              <div className="max-w-[92%] rounded-2xl border bg-card p-4 text-sm shadow-sm">
                <div className="mb-2 font-medium">{pendingDocument.title}</div>
                <div className="mb-3">Preview the complete document or download it in your preferred format.</div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={documentBusy} onClick={() => void generateAndDownloadPendingDocument()}><FileText className="mr-1 h-4 w-4" />Preview Document</Button>
                  <Button size="sm" variant="outline" disabled={documentBusy} onClick={() => void generateAndDownloadPendingDocument('docx')}><Download className="mr-1 h-4 w-4" />Download DOCX</Button>
                  <Button size="sm" variant="outline" disabled={documentBusy} onClick={() => void generateAndDownloadPendingDocument('pdf')}><Download className="mr-1 h-4 w-4" />Download PDF</Button>
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
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setDocumentPreviewOpen(true)}><FileText className="mr-1 h-4 w-4" />Preview Document</Button>
                      <Button size="sm" variant="outline" onClick={() => void downloadConversationDocument('docx')}><Download className="mr-1 h-4 w-4" />Download DOCX</Button>
                      <Button size="sm" variant="outline" onClick={() => void downloadConversationDocument('pdf')}><Download className="mr-1 h-4 w-4" />Download PDF</Button>
                    </div>
                    {conversationDocument.esign?.eligible && (
                      <div className="mt-4 border-t pt-4">
                        <div className="mb-2 flex items-center gap-2 font-medium"><PenLine className="h-4 w-4" />Electronic signature</div>
                        {!esignOpen ? (
                          <Button size="sm" variant="outline" onClick={() => setEsignOpen(true)}>
                            <PenLine className="mr-1 h-4 w-4" />Sign this document
                          </Button>
                        ) : (
                          <div className="space-y-3">
                            <Input
                              value={signerName}
                              onChange={event => setSignerName(event.target.value)}
                              placeholder="Signer’s full name"
                              aria-label="Signer full name"
                            />
                            <div>
                              <div className="mb-1 text-xs text-muted-foreground">Draw signature (optional — typed signer name is still recorded)</div>
                              <canvas
                                ref={signatureCanvasRef}
                                width={560}
                                height={140}
                                className="h-28 w-full touch-none rounded-md border bg-white"
                                aria-label="Draw electronic signature"
                                onPointerDown={startSignatureStroke}
                                onPointerMove={continueSignatureStroke}
                                onPointerUp={endSignatureStroke}
                                onPointerCancel={endSignatureStroke}
                              />
                              <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={clearSignatureDrawing}>
                                <Trash2 className="mr-1 h-3.5 w-3.5" />Clear drawing
                              </Button>
                            </div>
                            <label className="flex items-start gap-2 text-xs">
                              <Checkbox
                                checked={esignConsent}
                                onCheckedChange={value => setEsignConsent(value === true)}
                                aria-label="Consent to electronic signature"
                              />
                              <span>I intend to sign this document electronically and consent to LegalWhat recording this signature event. I understand the signed PDF contains an audit record and may be retained or reproduced later.</span>
                            </label>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                disabled={esignBusy || signerName.trim().length < 2 || !esignConsent}
                                onClick={() => void signConversationDocument().catch(error => setErrorMessage(friendlyError(error)))}
                              >
                                {esignBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PenLine className="mr-1 h-4 w-4" />}
                                Sign & download PDF
                              </Button>
                              <Button size="sm" variant="ghost" disabled={esignBusy} onClick={() => setEsignOpen(false)}>Cancel</Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          )}

          <Dialog open={documentPreviewOpen} onOpenChange={setDocumentPreviewOpen}>
            <DialogContent className="flex h-[90dvh] w-[96vw] max-w-5xl flex-col gap-3 p-4 sm:p-6">
              <DialogHeader>
                <DialogTitle>{conversationDocument?.title || 'Document Preview'}</DialogTitle>
                <DialogDescription>Full document preview. You can make final text edits here before downloading.</DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-white">
                <textarea
                  value={conversationDocument?.content || ''}
                  onChange={event => conversationDocument && setConversationDocument({ ...conversationDocument, content: event.target.value })}
                  className="h-full w-full resize-none bg-white p-6 font-serif text-sm leading-7 text-slate-950 outline-none"
                  aria-label="Full document preview and editor"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={!conversationDocument} onClick={() => void downloadConversationDocument('docx')}><Download className="mr-2 h-4 w-4" />Download DOCX</Button>
                <Button variant="outline" disabled={!conversationDocument} onClick={() => void downloadConversationDocument('pdf')}><Download className="mr-2 h-4 w-4" />Download PDF</Button>
              </div>
            </DialogContent>
          </Dialog>

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
          {restoreError && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <span>{restoreError}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setRestoreAttempt(value => value + 1)}>
                Retry
              </Button>
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
              disabled={!historyReady}
              onChange={event => setUserInput(event.target.value)}
              placeholder={historyReady ? 'Type or speak naturally…' : 'Restoring your last conversation…'}
              className="min-w-0 flex-1 rounded-full border bg-background px-4 py-3 text-base outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
              aria-label="Message LEXARA"
              enterKeyHint="send"
              autoComplete="off"
              autoCapitalize="sentences"
              spellCheck
            />
            <Button type="submit" size="icon" className="h-11 w-11 shrink-0 touch-manipulation rounded-full" disabled={!historyReady || !userInput.trim()} aria-label="Send message">
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
