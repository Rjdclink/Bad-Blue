export type LexaraBackgroundSubjectKind = 'person' | 'organization' | 'place' | 'entity';

export interface LexaraBackgroundSubject {
  name: string;
  kind: LexaraBackgroundSubjectKind;
  identifiable: boolean;
  location?: string;
}

const ORGANIZATION = /\b(?:LLC|L\.L\.C\.|Inc\.?|Corporation|Corp\.?|Company|Co\.?|LP|LLP|PLLC|Foundation|Association|University|Bank|Ltd\.?)\b/i;
const PLACE = /\b(?:city|town|village|county|state|province|park|river|lake|mount|mountain|airport|station|building|bridge|museum|landmark|memorial|tower)\b/i;
const NOISE = /^(?:Research Objective|Current User|Lexara Delegated|Full Background|Background Report|What Is|Who Is|Where Is|When Was|Tell Me|Find Out|Look Up|Public Records|New Question|Legal Analysis|The Company|The Person|The City)$/i;
const CONVERSATIONAL_LEAD = /^(?:Hello|Hi|Hey|Okay|Ok|So|Well|Please|What|Who|Where|When|How|Does|Did|Has|Have|Is|Are|Can|Could|Would|Should|Tell|Find|Check|Show|Look|Research|Lexara|Pantheon|Current|Background|The)(?:\b|[.])/i;
const PROPER_NAME = /\b[A-Z][\p{L}\p{N}.'’&-]*(?:\s+(?:of|the|and|&|[A-Z][\p{L}\p{N}.'’&-]*)){1,6}/gu;
const IDENTIFIER = /\b(?:born\s+(?:in\s+)?(?:19|20)\d{2}|dob\s*[:=]?\s*\d|age\s+\d{1,3}|lives?\s+in\s+[A-Z]|from\s+[A-Z][a-z]+|in\s+[A-Z][a-z]+(?:,|\s+[A-Z])|employer\s+[A-Z]|works?\s+(?:at|for)\s+[A-Z]|email\s+\S+@|phone\s+\d|address\s+\d|middle\s+name\s+[A-Z])\b/i;
const FOLLOWUP = /\b(?:he|she|they|them|their|his|her|its|it|that|this|same|there|about\s+them|about\s+it|try\s+again|keep\s+looking)\b/i;
const CONTEXTUAL_REFERENCE = /\b(?:he|she|they|them|their|his|her|its|it|that|this|those|these|same person|same company|same place|and what about|what about|how about|also check|and the|keep looking|try again|look further)\b/i;

function refersToPriorSubject(text: string): boolean {
  return FOLLOWUP.test(text) || CONTEXTUAL_REFERENCE.test(text);
}

function candidates(text: string): string[] {
  return [...text.matchAll(PROPER_NAME)]
    .map(match => match[0]
      .replace(/^(?:(?:Please|Research|Lexara|Pantheon|Tell|Find|Check|Show|Look|Full|Complete|Current|Background|The|Is|Are|Has|Have|Who|Where|When|How|Does|Did|Can|Could|Would|Should)\s+)+/i, '')
      .replace(/\s+(?:of|the|and)$/i, '')
      .replace(/['’]s(?:\s+.*)?$/i, '')
      .replace(/[.,;:!?]+$/u, '')
      .trim())
    .filter(name => name.split(/\s+/).length >= 2 && !NOISE.test(name))
    .filter(name => !CONVERSATIONAL_LEAD.test(name));
}

function classify(name: string, text: string): LexaraBackgroundSubjectKind {
  if (ORGANIZATION.test(name) || new RegExp(`\\b(?:company|business|corporation|nonprofit)\\s+(?:named|called)?\\s*${escapeRegExp(name)}\\b`, 'i').test(text)) return 'organization';
  if (PLACE.test(name) || new RegExp(`\\b(?:city|town|county|place|location|landmark)\\s+(?:of|named|called)?\\s*${escapeRegExp(name)}\\b`, 'i').test(text)) return 'place';
  if (/\b(?:product|project|ship|aircraft|organization|institution|website)\s+(?:named|called)\b/i.test(text)) return 'entity';
  return 'person';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveLexaraBackgroundSubject(
  prompt: string,
  previousUserTurns: readonly string[] = [],
  jurisdiction?: string,
): LexaraBackgroundSubject | null {
  const current = prompt.split(/Research objective:|LEXARA-DELEGATED FACTUAL OBJECTIVE:/i)[0];
  const followsPrior = refersToPriorSubject(current);
  const explicitPlace = current.match(/\b(?:city|town|county|village|state|place|location)\s+of\s+([A-Z][\p{L}.'’-]+)(?:,\s*([A-Z][\p{L}.'’-]+))?/u)
    || current.match(/\b([A-Z][\p{L}.'’-]+),\s*([A-Z][\p{L}.'’-]+)\b/u);
  const explicitEntity = current.match(/\b(company|business|organization|corporation|firm|nonprofit|website|domain|entity)\s+(?:(?:named|called)\s+)?["“]?([A-Z][\p{L}\p{N}.'’&-]*(?:\s+[A-Z][\p{L}\p{N}.'’&-]*){0,5})["”]?/iu);
  const standaloneSubject = current.trim().match(/^[A-Z][\p{L}\p{N}.'’&-]{1,120}$/u)?.[0];
  const name = explicitEntity?.[2]
    || candidates(current)[0]
    || (standaloneSubject && !CONVERSATIONAL_LEAD.test(standaloneSubject) ? standaloneSubject : undefined)
    || (explicitPlace ? explicitPlace[1] : undefined)
    || (followsPrior ? [...previousUserTurns].reverse().flatMap(candidates)[0] : undefined);
  if (!name) return null;
  const context = `${followsPrior ? previousUserTurns.slice(-2).join(' ') : ''} ${current}`;
  const kind = explicitEntity?.[2] === name
    ? /^(?:website|domain|entity)$/i.test(explicitEntity[1]) ? 'entity' : 'organization'
    : explicitPlace?.[1] === name ? 'place' : classify(name, context);
  const location = jurisdiction || explicitPlace?.[2] || context.match(/\b(?:in|from|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:,\s*[A-Z]{2})?)\b/)?.[1];
  return {
    name,
    kind,
    location,
    identifiable: kind === 'organization' || kind === 'entity'
      || (kind === 'place' ? Boolean(location || name.split(/\s+/).length > 2)
        : Boolean(location || IDENTIFIER.test(context) || name.split(/\s+/).length >= 3)),
  };
}