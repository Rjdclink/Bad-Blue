export type LexaraBackgroundSubjectKind = 'person' | 'organization' | 'place' | 'entity';

export interface LexaraBackgroundSubject {
  name: string;
  kind: LexaraBackgroundSubjectKind;
  identifiable: boolean;
  location?: string;
}

const ORGANIZATION = /\b(?:LLC|L\.L\.C\.|Inc\.?|Corporation|Corp\.?|Company|Co\.?|LP|LLP|PLLC|Foundation|Association|University|Bank|Ltd\.?|Holdings|Technologies|Industries|Enterprises|Systems|Solutions|Partners|Group)\b/i;
const PLACE = /\b(?:city|town|village|county|state|province|park|river|lake|mount|mountain|airport|station|building|bridge|museum|landmark|memorial|tower)\b/i;
const NOISE = /^(?:Research Objective|Current User|Lexara Delegated|Full Background|Background Report|What Is|Who Is|Where Is|When Was|Tell Me|Find Out|Look Up|Public Records|New Question|Legal Analysis|The Company|The Person|The City)$/i;
const CONVERSATIONAL_LEAD = /^(?:Hello|Hi|Hey|Good|Thanks|Thank|Okay|Ok|Alright|Sure|So|Well|Actually|Anyway|Please|What|Who|Where|When|How|Does|Did|Has|Have|Is|Are|Can|Could|Would|Should|Tell|Find|Check|Show|Look|Research|Lexara|Pantheon|Current|Background|The)(?:\b|[.])/i;
const PROPER_NAME = /\b[A-Z][\p{L}\p{N}.'’&-]*(?:\s+(?:of|the|and|&|[A-Z][\p{L}\p{N}.'’&-]*)){1,6}/gu;
const IDENTIFIER = /\b(?:born\s+(?:in\s+)?(?:19|20)\d{2}|dob\s*[:=]?\s*\d|age\s+\d{1,3}|lives?\s+in\s+[A-Z]|from\s+[A-Z][a-z]+|in\s+[A-Z][a-z]+(?:,|\s+[A-Z])|employer\s+[A-Z]|works?\s+(?:at|for)\s+[A-Z]|email\s+\S+@|phone\s+\d|address\s+\d|middle\s+name\s+[A-Z])\b/i;
const FOLLOWUP = /\b(?:he|she|they|them|their|his|her|its|it|that|this|same|there|about\s+them|about\s+it|try\s+again|keep\s+looking)\b/i;
const CONTEXTUAL_REFERENCE = /\b(?:he|she|they|them|their|his|her|its|it|that|this|those|these|same person|same company|same place|and what about|what about|how about|also check|and the|keep looking|try again|look further)\b/i;

function refersToPriorSubject(text: string): boolean {
  return FOLLOWUP.test(text) || CONTEXTUAL_REFERENCE.test(text);
}

function candidates(text: string): string[] {
  // A sentence-ending period is not an internal name abbreviation. Preserve
  // initials and short titles while preventing the next instruction from joining
  // the name and later replacing a compatible shorter subject from history.
  const subjectText = text.replace(/([\p{L}]{3})\.(?=\s+[A-Z])/gu, '$1;');
  return [...subjectText.matchAll(PROPER_NAME)]
    .map(match => match[0]
      .replace(/^(?:(?:Please|Research|Lexara|Pantheon|Tell|Find|Check|Show|Look|Full|Complete|Current|Background|The|Is|Are|Has|Have|Who|Where|When|How|Does|Did|Can|Could|Would|Should)\s+)+/i, '')
      .replace(/\s+(?:of|the|and)$/i, '')
      .replace(/['’]s(?:\s+.*)?$/i, '')
      .replace(/[.,;:!?]+$/u, '')
      .trim())
    .filter(name => name.split(/\s+/).length >= 2 && !NOISE.test(name))
    .filter(name => !CONVERSATIONAL_LEAD.test(name));
}

export function hasMultipleLexaraBackgroundSubjectCandidates(prompt: string): boolean {
  const current = String(prompt || '').split(/Research objective:|LEXARA-DELEGATED FACTUAL OBJECTIVE:/i)[0];
  return candidates(current).length > 1;
}

function classify(name: string, text: string): LexaraBackgroundSubjectKind {
  if (ORGANIZATION.test(name) || new RegExp(`\\b(?:company|business|organization|corporation|firm|nonprofit|institution)\\s+(?:named|called)?\\s*${escapeRegExp(name)}\\b`, 'i').test(text)) return 'organization';
  if (PLACE.test(name) || new RegExp(`\\b(?:city|town|county|place|location|landmark)\\s+(?:of|named|called)?\\s*${escapeRegExp(name)}\\b`, 'i').test(text)) return 'place';
  if (/\b(?:product|project|ship|aircraft|organization|institution|website)\s+(?:named|called)\b/i.test(text)) return 'entity';
  return 'person';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizedSubjectTokens(value: string): string[] {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Preserve the most specific compatible identity already present in the user's
 * turn. A shorter semantic/parser result may enrich metadata, but it must not
 * replace a longer compatible person or entity name from the raw prompt.
 */
export function mergeCompatibleLexaraBackgroundSubjects(
  primary: LexaraBackgroundSubject | null | undefined,
  alternate: LexaraBackgroundSubject | null | undefined,
): LexaraBackgroundSubject | null {
  if (!primary) return alternate || null;
  if (!alternate) return primary;

  const primaryTokens = normalizedSubjectTokens(primary.name);
  const alternateTokens = normalizedSubjectTokens(alternate.name);
  const exact = primaryTokens.join(' ') === alternateTokens.join(' ');
  const primarySubset = primaryTokens.length >= 2
    && primaryTokens.length < alternateTokens.length
    && primaryTokens.every(token => alternateTokens.includes(token));
  const alternateSubset = alternateTokens.length >= 2
    && alternateTokens.length < primaryTokens.length
    && alternateTokens.every(token => primaryTokens.includes(token));

  // Only enrich when one normalized identity is actually contained in the
  // other. Matching first/last names with conflicting middle names is not
  // enough to fuse two subjects.
  if (!exact && !primarySubset && !alternateSubset) return primary;

  const mostSpecific = alternateTokens.length > primaryTokens.length ? alternate : primary;
  return {
    ...primary,
    name: mostSpecific.name,
    kind: mostSpecific.kind,
    location: alternate.location || primary.location,
    identifiable: primary.identifiable || alternate.identifiable,
  };
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
  const jurisdictionState = jurisdiction?.replace(/^Federal\s*\+\s*/i, '').trim();
  const commaSubjectLocation = current.match(/\b(?:of|in|from|near)\s+([A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){0,2}),\s*([A-Z]{2}|[A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){0,2})\b/u);
  const jurisdictionSubjectLocality = jurisdictionState
    ? current.match(new RegExp(`\\b(?:of|in|from|near)\\s+([A-Z][\\p{L}.'’-]+(?:\\s+[A-Z][\\p{L}.'’-]+){0,2})\\s+${escapeRegExp(jurisdictionState)}\\b`, 'u'))
    : null;
  const explicitEntity = current.match(/\b([Cc]ompany|[Bb]usiness|[Oo]rganization|[Cc]orporation|[Ff]irm|[Nn]onprofit|[Ww]ebsite|[Dd]omain|[Ee]ntity)\s+(?:(?:named|called)\s+)?["“]?([A-Z][\p{L}\p{N}.'’&-]*(?:\s+[A-Z][\p{L}\p{N}.'’&-]*){0,5})["”]?/u);
  const standaloneSubject = current.trim().match(/^[A-Z][\p{L}\p{N}.'’&-]{1,120}$/u)?.[0];
  let name = explicitEntity?.[2]
    || candidates(current)[0]
    || (standaloneSubject && !CONVERSATIONAL_LEAD.test(standaloneSubject) ? standaloneSubject : undefined)
    || (explicitPlace ? explicitPlace[1] : undefined)
    || (followsPrior ? [...previousUserTurns].reverse().flatMap(candidates)[0] : undefined);
  if (!name) return null;
  // A shorter repeat of the same person's name must retain previously supplied
  // middle names. Conflicting middle names remain separate identities.
  if (!explicitEntity && previousUserTurns.length) {
    for (const priorName of [...previousUserTurns].reverse().flatMap(candidates)) {
      const merged = mergeCompatibleLexaraBackgroundSubjects(
        { name, kind: 'person', identifiable: false },
        { name: priorName, kind: 'person', identifiable: false },
      );
      if (merged && merged.name.split(/\s+/).length > name.split(/\s+/).length) name = merged.name;
    }
  }
  const context = `${followsPrior ? previousUserTurns.slice(-2).join(' ') : ''} ${current}`;
  const kind = explicitEntity?.[2] === name
    ? /^(?:website|domain|entity)$/i.test(explicitEntity[1]) ? 'entity' : 'organization'
    : explicitPlace?.[1] === name ? 'place' : classify(name, context);
  const location = commaSubjectLocation
    ? `${commaSubjectLocation[1]}, ${commaSubjectLocation[2]}`
    : jurisdictionSubjectLocality && jurisdictionState
      ? `${jurisdictionSubjectLocality[1]}, ${jurisdictionState}`
      : jurisdiction || explicitPlace?.[2] || context.match(/\b(?:in|from|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:,\s*[A-Z]{2})?)\b/)?.[1];
  return {
    name,
    kind,
    location,
    identifiable: kind === 'organization' || kind === 'entity'
      || (kind === 'place' ? Boolean(location || name.split(/\s+/).length > 2)
        : Boolean(location || IDENTIFIER.test(context) || name.split(/\s+/).length >= 3)),
  };
}
