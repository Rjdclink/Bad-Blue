/**
 * The microphone can hear a different person or a nearby phone call. Speech
 * detection and transcript confidence cannot identify the intended addressee.
 * During active Lexara work, accept only an addressed interruption or a clear
 * legal follow-up, without adding a model/API call to the live audio path.
 * Ordinary idle listening and typed messages retain their existing behavior.
 */
export function isDirectedLexaraVoiceTurn(
  text: string,
  context: { busy: boolean; priorQuestion?: string },
): boolean {
  const normalized = String(text || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (!context.busy) return true;

  // A wake phrase is only necessary to break into ongoing work, not for normal
  // hands-free conversation. Accept natural variants of the assistant's name.
  if (/^(?:(?:hey|hi|hello|okay|ok|excuse me)\s+)?(?:lexara|lex era|legalwhat)\b/.test(normalized)) return true;

  const legalSubject = /\b(?:law|laws|legal|statute|code|section|citation|precedent|court|judge|case|appeal|motion|petition|filing|trial|sentence|penalty|criminal|civil|deadline|hearing|evidence|affidavit|contract|divorce|custody|probation|warrant|judgment|attorney|lawsuit|charge|damages|rights|claim|fine|fine amount|claimant|defendant|plaintiff|loan|foreclosure)\b/.test(normalized);
  const question = /^(?:what|which|why|when|where|how|who|can|could|would|will|does|do|did|is|are|should|tell me|find|look up|explain|and what|what about)\b/.test(normalized);
  const legalContext = /\b(?:law|legal|statute|code|citation|court|case|motion|judge|hearing|claim|lawsuit|filing|contract|appeal|deadline|rights|charge|foreclosure|divorce|custody|evidence|trial|petition|warrant)\b/i.test(context.priorQuestion || '');
  const clearCorrection = /^(?:actually|correction|i meant|i need to correct|also the|the correct|one correction|let me clarify)\b/.test(normalized);
  return Boolean(legalSubject && (question || (legalContext && clearCorrection)));
}
