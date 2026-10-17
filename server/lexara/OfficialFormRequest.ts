/**
 * A nationwide, jurisdiction-neutral signal for requests to GET the actual
 * court/agency form (as opposed to asking for an explanation about forms).
 * The selected court and source are resolved separately.
 */
const COURT_FORM_NOUN = /\b(?:forms?|filing\s+packet|court\s+paperwork|application|cover\s+sheet|court\s+worksheet|affidavit|declaration|petition)\b/i;
const DELIVERY_VERB = /\b(?:give|grab|fetch|retrieve|download|bring|send|provide|obtain|find|locate|get|show|pull\s+up|open)\b/i;
const DELIVERY_PHRASE = /\b(?:i\s+(?:need|want|would\s+like)|(?:can|could|will|would)\s+you|please)\b/i;

export function isLexaraOfficialFormDeliveryRequest(text: string): boolean {
  const request=String(text||'').trim();
  if(!request || !COURT_FORM_NOUN.test(request)) return false;
  if(/\b(?:what\s+is|what\s+are|explain|define|tell\s+me\s+about|how\s+(?:do|can)\s+i\s+(?:fill|complete))\b/i.test(request)) return false;
  if(/\b(?:do\s+not|don't|dont|never)\s+(?:get|find|give|provide|download|retrieve|grab|show|open)\b/i.test(request)) return false;
  return (DELIVERY_VERB.test(request) || /\bi\s+(?:need|want|would\s+like)\s+(?:a|an|the|my|this|that|a\s+copy\s+of)?\s*[^?]{0,140}\b(?:forms?|application|filing\s+packet)\b/i.test(request))
    && (DELIVERY_PHRASE.test(request) || /^\s*(?:get|grab|find|show|provide|give|download|retrieve|fetch|locate|open|send|pull\s+up)\b/i.test(request));
}

export function lexaraRequestedOfficialFormTitle(text: string): string {
  return String(text||'').trim()
    .replace(/^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:need|want|would\s+like)\s+(?:you\s+to\s+)?)/i,'')
    .replace(/^(?:please\s+)?(?:grab|fetch|retrieve|download|bring|send|provide|find|locate|get|show|pull\s+up|open|give)(?:\s+me)?\s+/i,'')
    .replace(/^(?:a|an|the|a\s+copy\s+of|the\s+copy\s+of)\s+/i,'')
    .replace(/[?.!]+$/,'').trim().slice(0,180) || 'Official Court Form';
}
