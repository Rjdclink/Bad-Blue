/**
 * A nationwide, jurisdiction-neutral signal for requests to GET the actual
 * court/agency form (as opposed to asking for an explanation about forms).
 * The selected court and source are resolved separately.
 */
const COURT_FORM_NOUN = /\b(?:forms?|filing\s+packet|court\s+paperwork|application|cover\s+sheet|court\s+worksheet|affidavit|declaration|petition)\b/i;
const DELIVERY_VERB = /\b(?:give|grab|fetch|retrieve|download|bring|send|provide|obtain|find|locate|get|show|pull\s+up|open)\b/i;
const DELIVERY_PHRASE = /\b(?:i\s+(?:need|want|would\s+like)|(?:can|could|will|would)\s+you|please)\b/i;
const COURT_PROCEDURE = /\b(?:child\s+support|custody|visitation|parenting\s+time|divorce|dissolution|small\s+claims|eviction|guardianship|probate|protection\s+order|name\s+change|adoption|appeal)\b/i;
const FILING_OBJECTIVE = /\b(?:i|we)\s+(?:need|want|would\s+like|have)\s+(?:to\s+)?(?:file|apply|petition|request|submit|start|modify|change|reduce|increase|adjust)\b/i;


export function isLexaraOfficialFormDeliveryRequest(text: string): boolean {
  const request=String(text||'').trim();
  if(!request || !COURT_FORM_NOUN.test(request)) return false;
  if(/\b(?:what\s+is|what\s+are|explain|define|tell\s+me\s+about|how\s+(?:do|can)\s+i\s+(?:fill|complete)|(?:need|want)\s+to\s+know\s+(?:what|which)|what\s+forms?\s+(?:do|should)|which\s+forms?\s+(?:do|should))\b/i.test(request)) return false;
  if(/\b(?:do\s+not|don't|dont|never)\s+(?:get|find|give|provide|download|retrieve|grab|show|open)\b/i.test(request)) return false;
  if(COURT_PROCEDURE.test(request) && FILING_OBJECTIVE.test(request)
    && !/\b(?:need|want)\s+to\s+(?:know|understand|learn)\b/i.test(request)) return true;
  return (DELIVERY_VERB.test(request) || /\bi\s+(?:need|want|would\s+like)\s+(?:a|an|the|my|this|that|a\s+copy\s+of)?\s*[^?]{0,140}\b(?:forms?|application|filing\s+packet)\b/i.test(request))
    && (DELIVERY_PHRASE.test(request) || /^\s*(?:get|grab|find|show|provide|give|download|retrieve|fetch|locate|open|send|pull\s+up)\b/i.test(request));
}

export function lexaraRequestedOfficialFormTitle(text: string): string {
  // A request can name the form *before* a comma and specify the issuing
  // county/court afterwards. Search for that instrument, not the whole turn.
  const requested = String(text || '').replace(/[’]/g, "'").trim()
    .replace(/^(?:(?:hey\s+)?lexara[,!:]?\s*)/i, '')
    .replace(/^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:need|want|would\s+like)\s+(?:(?:you\s+to|to)\s+)?)/i, '')
    .replace(/^(?:please\s+)?(?:find|locate|grab|fetch|retrieve|download|bring|send|provide|get|show|open|give|pull\s+up)(?:\s+(?:me|a\s+copy\s+of|the\s+copy\s+of))?\s+/i, '')
    .replace(/^(?:(?:the|a|an)\s+)?(?:copy\s+of\s+)?(?:(?:official|local)\s+)?/i, '')
    .replace(/[,;]\s*(?:(?:the|a|an)\s+)?(?:(?:official|local|state|federal|county|court)\s+)*(?:court\s+)?forms?\b[\s\S]*$/i, '')
    .replace(/\s+(?:from|in)\s+(?:the\s+)?[A-Za-z][A-Za-z .'-]{0,100}\b(?:county|court|judicial branch)(?:,\s*[A-Za-z .'-]+)?$/i, '')
    .replace(/[?.!,;]+$/g, '').trim();
  return requested.slice(0, 180) || 'Official Court Form';
}
