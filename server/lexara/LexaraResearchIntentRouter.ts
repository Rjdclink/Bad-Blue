import { resolveLexaraBackgroundSubject } from './LexaraBackgroundSubject';
import type { LexaraSourceCategory } from './LexaraPublicSourceRegistry';

export type LexaraResearchReason =
  | 'explicit-research'
  | 'current-external-fact'
  | 'external-fact-question'
  | 'legal-authority'
  | 'research-follow-up'
  | 'none';

export type LexaraResearchObjectiveKind =
  | 'external-fact'
  | 'legal-authority'
  | 'record-lookup'
  | 'current-information'
  | 'explicit-research'
  | 'none';

export type LexaraResearchIntent = 'legal' | 'factual' | 'mixed' | 'conversation';

export type LexaraRequestedFact =
  | 'age-dob'
  | 'professional-license'
  | 'marriage-divorce'
  | 'employment'
  | 'property'
  | 'court-record'
  | 'incarceration'
  | 'business'
  | 'financial-professional'
  | 'healthcare-professional'
  | 'sanctions-discipline'
  | 'intellectual-property'
  | 'domain-web'
  | 'news-history'
  | 'identity'
  | 'contact-address'
  | 'relatives-associates'
  | 'social-online'
  | 'education'
  | 'vehicle'
  | 'criminal-arrest'
  | 'probation-parole'
  | 'warrant'
  | 'sex-offender'
  | 'bankruptcy-financial'
  | 'relationship-timeline'
  | 'general-public-record'
  | 'none';

export interface LexaraResearchDecision {
  needed: boolean;
  reason: LexaraResearchReason;
  objective: string;
  objectiveKind: LexaraResearchObjectiveKind;
  intent: LexaraResearchIntent;
  requestedFact: LexaraRequestedFact;
  sourceCategories: LexaraSourceCategory[];
  subject?: string;
  standaloneQuery: string;
  inferred: boolean;
}

// Conversation repair refers to the dialogue, never to an outside person/record.
export function isLexaraRepeatRequest(text: string): boolean {
  return /^(?:(?:sorry|please|lexara)[, ]+)*(?:(?:what (?:did|do) you (?:just )?say)|(?:can|could|would) you (?:please )?(?:repeat (?:that|your (?:last )?(?:answer|response))|say that again)|repeat (?:that|your (?:last )?(?:answer|response))|say (?:that|it) again|i (?:didn't|did not|couldn't|could not) hear (?:you|that))[?.! ]*$/i.test(text.trim());
}

export function isLexaraConversationControl(text: string): boolean {
  return isLexaraRepeatRequest(text) || /^(?:(?:please|lexara)[, ]+)*(?:what do you mean|can you explain (?:that|your answer)|explain that|could you clarify|are you (?:still )?there|can you hear me|did you hear me|are you listening|how are you|who are you|what can you do|can you help me)[?.! ]*$/i.test(text.trim());
}

const LEGAL_AUTHORITY_INTENT_PATTERN = /\b(?:versus|case\s+law|court\s+(?:case|decision|opinion|holding)|holding|precedent|statute|u\.?s\.?c\.?|cfr|code\s+section|rule\s+\d|motion|appeal|lawsuit|cause\s+of\s+action|civil\s+(?:issue|case|claim|matter)|criminal\s+(?:issue|case|charge)|constitutional|jurisdiction|legal\s+(?:issue|question|claim|case|matter|right|remedy|defense|option|analysis|advice)s?|rights?|remed(?:y|ies)|liabilit\w*|breach|contract\w*|damages|cause\s+of\s+action)\b/i;
const LOCAL_REGULATORY_LEGAL_PATTERN = /\b(?:ordinance|municipal|city\s+code|county\s+code|local\s+(?:law|rule|ordinance)|nuisance|animal\s+control|leash|dog\s+at\s+large|zoning|landlord|tenant|lease|eviction|property\s+boundary|trespass|noise\s+ordinance|traffic\s+(?:law|ordinance)|licensing|permit)\b/i;
const CASE_CAPTION_PATTERN = /\b[A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,4}\s+(?:v\.?|vs\.?|versus)\s+(?:the\s+)?[A-Z][A-Za-z.'’ -]{1,80}\b/i;
const PERSONAL_LEGAL_PROCEDURE_PATTERN = /\b(?:how\s+(?:do|can|should|would)\s+(?:i|we)|can\s+(?:i|we)|what\s+(?:forms?|rights?|remedies|options|steps|documents)\s+(?:do|can|are)|(?:i|we)\s+(?:need|want)\s+to)\b[\s\S]{0,180}\b(?:divorc\w*|custody|evict\w*|bankrupt\w*|probate|immigration|asylum|sue|appeal|file|filing|court|lease|tenant|landlord|restraining\s+order|protective\s+order)\b/i;

export function isLexaraLegalAuthorityIntent(text: string): boolean {
  const value = String(text || '').trim();
  return CASE_CAPTION_PATTERN.test(value) || LEGAL_AUTHORITY_INTENT_PATTERN.test(value)
    || PERSONAL_LEGAL_PROCEDURE_PATTERN.test(value) || LOCAL_REGULATORY_LEGAL_PATTERN.test(value);
}

function requestedFact(text: string): LexaraRequestedFact {
  const value = text.toLowerCase();
  if (/\b(?:how old|age|date of birth|birth date|birthday|dob|born)\b/.test(value)) return 'age-dob';
  if (/\b(?:(?:nurs(?:e|ing)|medical|physician|lawyer|attorney|realtor|contractor|professional)\s+)?licen[cs](?:e|es|ed|ing)|licensure|credentials?|certifications?|board certified\b/.test(value)) return 'professional-license';
  if (/\b(?:married|marriage|spouse|husband|wife|divorc(?:e|ed)|marital status)\b/.test(value)) return 'marriage-divorce';
  if (/\b(?:employ(?:er|ment|ed)|works?\s+(?:at|for)|work history|job|occupation|profession|career)\b/.test(value)) return 'employment';
  if (/\b(?:property|real estate|parcel|deed|assessor|mortgage|owns?\s+(?:a\s+)?(?:house|home|land)|home ownership)\b/.test(value)) return 'property';
  if (/\b(?:court record|court case|docket|case filing|judgment|lawsuit|litigation)\b/.test(value)) return 'court-record';
  if (/\b(?:inmate|incarcerat|prison|jail|custody|correctional|where is .+ (?:held|locked up))\b/.test(value)) return 'incarceration';
  if (/\b(?:business|company|corporation|llc|registered agent|company officer|director|ownership)\b/.test(value)) return 'business';
  if (/\b(?:broker|financial adviser|investment adviser|finra|crd|securities license)\b/.test(value)) return 'financial-professional';
  if (/\b(?:npi|healthcare provider|health care provider|medical provider|practice address)\b/.test(value)) return 'healthcare-professional';
  if (/\b(?:sanction|excluded|exclusion|disciplin(?:e|ary)|debarred|ofac|oig)\b/.test(value)) return 'sanctions-discipline';
  if (/\b(?:patent|trademark|inventor|assignee|intellectual property)\b/.test(value)) return 'intellectual-property';
  if (/\b(?:domain|website|rdap|whois|web footprint|internet footprint)\b/.test(value)) return 'domain-web';
  if (/\b(?:news|newspaper|press|media|historical|archive|former|previously)\b/.test(value)) return 'news-history';
  if (/\b(?:identity|alias|aka|real name|who is)\b/.test(value)) return 'identity';
  if (/\b(?:phone|telephone|email|address|residen(?:ce|t)|where .+ live)\b/.test(value)) return 'contact-address';
  if (/\b(?:relative|family|parent|mother|father|sibling|brother|sister|associate|household|roommate|lives with)\b/.test(value)) return 'relatives-associates';
  if (/\b(?:social media|facebook|instagram|linkedin|tiktok|twitter|x\.com|username|online account|profile)\b/.test(value)) return 'social-online';
  if (/\b(?:education|school|college|university|degree|diploma|graduat|alma mater)\b/.test(value)) return 'education';
  if (/\b(?:vehicle|car|truck|motorcycle|vin|vehicle title|vehicle registration)\b/.test(value)) return 'vehicle';
  if (/\b(?:criminal record|criminal history|conviction|charge|arrest|booking|police record|sheriff record)\b/.test(value)) return 'criminal-arrest';
  if (/\b(?:probation|parole|supervised release|community supervision)\b/.test(value)) return 'probation-parole';
  if (/\b(?:warrant|wanted|fugitive)\b/.test(value)) return 'warrant';
  if (/\b(?:sex offender|offender registry|registered offender)\b/.test(value)) return 'sex-offender';
  if (/\b(?:bankrupt|bankruptcy|lien|ucc|financial public record|judgment lien)\b/.test(value)) return 'bankruptcy-financial';
  if (/\b(?:timeline|chronology|relationship history|sequence of events|event history)\b/.test(value)) return 'relationship-timeline';
  if (/\b(?:public record|record|filing|registry|background)\b/.test(value)) return 'general-public-record';
  return 'none';
}

function sourceCategoriesForFact(fact: LexaraRequestedFact, text: string): LexaraSourceCategory[] {
  switch (fact) {
    case 'age-dob': return ['vital-records','identity','general-public-records'];
    case 'professional-license':
      return /\b(?:nurs\w*|medical|physician|health(?:care)?)\b/i.test(text)
        ? ['professional-license','healthcare-professional','sanctions-discipline']
        : ['professional-license','sanctions-discipline'];
    case 'marriage-divorce': return ['vital-records','courts','general-public-records'];
    case 'employment': return ['employment','business','professional-license','general-public-records'];
    case 'property': return ['property','general-public-records'];
    case 'court-record': return ['courts','general-public-records'];
    case 'incarceration': return ['corrections','courts','general-public-records'];
    case 'business': return ['business','government-public','general-public-records'];
    case 'financial-professional': return ['financial-professional','professional-license','sanctions-discipline','employment'];
    case 'healthcare-professional': return ['healthcare-professional','professional-license','sanctions-discipline','employment'];
    case 'sanctions-discipline': return ['sanctions-discipline','professional-license','government-public'];
    case 'intellectual-property': return ['intellectual-property','business'];
    case 'domain-web': return ['domain-web','news-history'];
    case 'news-history': return ['news-history','domain-web'];
    case 'identity': return ['identity','vital-records','general-public-records'];
    case 'contact-address': return ['contacts-addresses','identity','general-public-records'];
    case 'relatives-associates': return ['relationships','general-public-records'];
    case 'social-online': return ['social-online','domain-web','news-history'];
    case 'education': return ['education','employment','general-public-records'];
    case 'vehicle': return ['transportation','general-public-records'];
    case 'criminal-arrest': return ['criminal-records','law-enforcement','courts','general-public-records'];
    case 'probation-parole': return ['probation-parole','corrections','general-public-records'];
    case 'warrant': return ['warrants','law-enforcement','courts','general-public-records'];
    case 'sex-offender': return ['sex-offender','criminal-records','law-enforcement'];
    case 'bankruptcy-financial': return ['financial-public','courts','property','general-public-records'];
    case 'relationship-timeline': return ['relationship-timeline','relationships','news-history','general-public-records'];
    case 'general-public-record': return ['general-public-records'];
    default: return [];
  }
}

function mostRecentSubject(text: string, previousUserTurns: string[]): string | undefined {
  const direct = resolveLexaraBackgroundSubject(text, previousUserTurns)?.name;
  if (direct) return direct;
  for (const turn of [...previousUserTurns].reverse()) {
    const prior = resolveLexaraBackgroundSubject(turn, []);
    if (prior?.name) return prior.name;
  }
  return undefined;
}

function factualQuestion(text: string, fact: LexaraRequestedFact): boolean {
  if (fact === 'none') return false;
  if (/\?|^(?:what|when|where|who|which|how|is|are|was|were|does|do|did|has|have|can)\b/i.test(text)) return true;
  return /\b(?:tell\s+me|find|locate|identify|determine|show|give\s+me|need\s+to\s+know|want\s+to\s+know|check|verify)\b/i.test(text);
}

function objectiveKindForFact(fact: LexaraRequestedFact, text: string): LexaraResearchObjectiveKind {
  if (['professional-license','marriage-divorce','property','court-record','incarceration','financial-professional','sanctions-discipline','criminal-arrest','probation-parole','warrant','sex-offender','bankruptcy-financial','vehicle'].includes(fact)) return 'record-lookup';
  if (/\b(?:current|currently|latest|today|now|recent)\b/i.test(text)) return 'current-information';
  return 'external-fact';
}

function baseDecision(text: string): LexaraResearchDecision {
  return {
    needed: false,
    reason: 'none',
    objective: text,
    objectiveKind: 'none',
    intent: 'conversation',
    requestedFact: 'none',
    sourceCategories: [],
    standaloneQuery: text,
    inferred: false,
  };
}

/**
 * Single Lexara-owned research planner. Terms are fast clues, but the planner
 * also carries subject/fact context across natural spoken follow-ups and emits
 * the one authoritative research decision consumed downstream.
 */
export function decideLexaraResearchNeed(
  prompt: string,
  previousUserTurns: string[] = [],
): LexaraResearchDecision {
  const text = String(prompt || '').trim();
  if (!text) return baseDecision('');
  if (isLexaraConversationControl(text)) return baseDecision(text);

  const legal = isLexaraLegalAuthorityIntent(text);
  const fact = requestedFact(text);
  const explicitResearch = /\b(?:look\s+(?:it|this|that)\s+up|search|research|verify|find\s+out|check\s+(?:whether|if|the)|investigate)\b/i.test(text);
  const subject = mostRecentSubject(text, previousUserTurns);
  const categories = sourceCategoriesForFact(fact, text);

  const priorResearchTurn = [...previousUserTurns].reverse().find(turn => decideLexaraResearchNeed(turn, []).needed);
  const priorDecision = priorResearchTurn ? decideLexaraResearchNeed(priorResearchTurn, []) : null;
  const shortRefinement = text.split(/\s+/).length <= 8 && fact !== 'none' && Boolean(priorDecision?.needed);
  const followUp = /\b(?:try\s+again|look\s+harder|search\s+again|keep\s+looking|broaden|verify\s+that|check\s+again)\b/i.test(text);
  const contextualResearchClue = Boolean(priorDecision?.needed) && (
    /\b(?:federal|state|district|circuit|court|appeals?|appellate|supreme|docket|case\s*(?:no|number)|citation|reporter|jurisdiction|venue)\b/i.test(text)
    || /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|d\.?c\.?)\s+circuit\b/i.test(text)
    || /\b(?:19|20)\d{2}\b/.test(text)
  );

  if ((followUp || contextualResearchClue || shortRefinement) && priorDecision) {
    const inheritedFact = fact !== 'none' ? fact : priorDecision.requestedFact;
    const inheritedCategories = fact !== 'none' ? categories : priorDecision.sourceCategories;
    const inheritedSubject = subject || priorDecision.subject;
    const standaloneQuery = [inheritedSubject, text, inheritedFact !== 'none' ? inheritedFact.replace(/-/g, ' ') : '']
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return {
      needed: true,
      reason: 'research-follow-up',
      objective: standaloneQuery,
      objectiveKind: fact !== 'none' ? objectiveKindForFact(fact, text) : priorDecision.objectiveKind,
      intent: legal || priorDecision.intent === 'legal' || priorDecision.intent === 'mixed' ? 'mixed' : 'factual',
      requestedFact: inheritedFact,
      sourceCategories: inheritedCategories,
      subject: inheritedSubject,
      standaloneQuery,
      inferred: true,
    };
  }

  const factual = factualQuestion(text, fact) || (explicitResearch && (fact !== 'none' || Boolean(subject)));
  if (legal || factual || explicitResearch) {
    const intent: LexaraResearchIntent = legal && (factual || fact !== 'none') ? 'mixed' : legal ? 'legal' : 'factual';
    const effectiveFact = fact !== 'none' ? fact : factual || explicitResearch ? 'general-public-record' : 'none';
    const effectiveCategories = categories.length ? categories : sourceCategoriesForFact(effectiveFact, text);
    const standaloneQuery = [subject, text, effectiveFact !== 'none' ? effectiveFact.replace(/-/g, ' ') : '']
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return {
      needed: true,
      reason: legal ? 'legal-authority' : explicitResearch ? 'explicit-research' : 'external-fact-question',
      objective: standaloneQuery,
      objectiveKind: legal && !factual ? 'legal-authority'
        : explicitResearch && fact === 'none' ? 'explicit-research'
        : objectiveKindForFact(effectiveFact, text),
      intent,
      requestedFact: effectiveFact,
      sourceCategories: effectiveCategories,
      subject,
      standaloneQuery,
      inferred: fact !== 'none' && !new RegExp(fact.replace(/-/g, '[\\s-]*'), 'i').test(text),
    };
  }

  return baseDecision(text);
}
