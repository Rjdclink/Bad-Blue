import { callAIWithFallback } from '../aiSubAgent';
import type { LawType as ExpertLawType } from '../../shared/legalCounselTypes';
import { LAW_TYPE_DATA } from '../../shared/lawTypes';
import { LEXARA_PERSONA } from '../../shared/lexaraVoicePersona';

export interface LexaraConversationMessage {
  role: 'user' | 'lexara' | 'assistant';
  content: string;
}

export interface LexaraConversationContext {
  previousMessages?: LexaraConversationMessage[];
  lawType?: string;
  lawTypeName?: string;
  jurisdiction?: string;
  behaviorMode?: 'personable' | 'professional';
}

export interface LexaraConversationResult {
  text: string;
  jurisdiction?: string;
  mappedLawType?: ExpertLawType;
}

const MAX_HISTORY_MESSAGES = 16;
const MAX_HISTORY_CHARACTERS = 14000;
const MAX_PROMPT_CHARACTERS = 7000;

const PRODUCT_TO_EXPERT_LAW_TYPE: Record<string, ExpertLawType> = {
  'law-enforcement-accountability': 'law-enforcement-accountability',
  'criminal-law': 'criminal-law',
  'family-law': 'family-law',
  'juvenile-law': 'juvenile-law',
  'constitutional-law': 'constitutional-law',
  'property-law': 'real-estate-law',
  'real-estate-law': 'real-estate-law',
  'contract-law': 'contract-law',
  'civil-rights-law': 'civil-rights',
  'tort-law': 'tort-law',
  'probate-estate-law': 'estate-planning',
  'trusts-law': 'estate-planning',
  'administrative-law': 'administrative-law',
  'immigration-law': 'immigration-law',
  'employment-labor-law': 'employment-law',
  'military-veterans-law': 'military-law',
  'foia-open-records-law': 'administrative-law',
  'intellectual-property-law': 'intellectual-property',
  'public-housing-law': 'landlord-tenant',
  'securities-law': 'business-law',
  'tax-law': 'tax-law',
  'environmental-law': 'environmental-law',
  'municipal-government-law': 'administrative-law',
};

const STATE_BY_ABBREVIATION: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

const STATE_NAMES = Object.values(STATE_BY_ABBREVIATION);
const LAW_TYPE_NAME_BY_ID = new Map(LAW_TYPE_DATA.map(item => [item.id, item.name]));

export function mapLexaraLawType(lawType?: string): ExpertLawType | undefined {
  if (!lawType) return undefined;
  const normalized = lawType.trim().toLowerCase().replace(/\s+/g, '-');
  return PRODUCT_TO_EXPERT_LAW_TYPE[normalized];
}

function trustedDomainName(lawType?: string): string {
  if (!lawType) return 'the relevant area of law';
  const normalized = lawType.trim().toLowerCase().replace(/\s+/g, '-');
  return LAW_TYPE_NAME_BY_ID.get(normalized) || 'the relevant area of law';
}

function normalizeJurisdiction(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const abbreviationMatch = STATE_BY_ABBREVIATION[trimmed.toUpperCase()];
  if (abbreviationMatch) return abbreviationMatch;

  const normalized = trimmed.toLowerCase();
  return STATE_NAMES.find(state => state.toLowerCase() === normalized);
}

export function inferJurisdiction(text: string): string | undefined {
  if (!text) return undefined;

  const lower = text.toLowerCase();
  const fullState = STATE_NAMES.find(state => lower.includes(state.toLowerCase()));
  if (fullState) return fullState;

  // Require uppercase abbreviations so ordinary words such as "in", "or", and
  // "me" are never mistaken for Indiana, Oregon, or Maine.
  const upperAbbreviationMatch = text.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/);
  if (upperAbbreviationMatch) {
    return STATE_BY_ABBREVIATION[upperAbbreviationMatch[1]];
  }

  return undefined;
}

function clampText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(trimmed.length - maxLength);
}

function buildConversationHistory(messages: LexaraConversationMessage[] = []): string {
  const selected = messages
    .filter(message => message?.content?.trim())
    .slice(-MAX_HISTORY_MESSAGES)
    .map(message => {
      const role = message.role === 'user' ? 'USER' : 'LEXARA';
      return `${role}: ${clampText(message.content, 2500)}`;
    });

  return clampText(selected.join('\n\n'), MAX_HISTORY_CHARACTERS);
}

function buildUserJurisdictionEvidence(messages: LexaraConversationMessage[] = []): string {
  const userTurns = messages
    .filter(message => message?.role === 'user' && message?.content?.trim())
    .slice(-MAX_HISTORY_MESSAGES)
    .map(message => clampText(message.content, 2500));

  return clampText(userTurns.join('\n'), MAX_HISTORY_CHARACTERS);
}

function buildLegalSystemPrompt(
  context: LexaraConversationContext,
  mappedLawType?: ExpertLawType,
  jurisdiction?: string,
): string {
  // The domain and jurisdiction inserted into the system prompt must come from
  // server-owned allowlists. Client-provided labels are intentionally ignored.
  const domainName = trustedDomainName(context.lawType);
  const behaviorMode = context.behaviorMode === 'personable'
    ? 'warm and conversational'
    : 'calm, precise, and professional';

  let expertise = `Active legal domain: ${domainName}.`;
  if (mappedLawType) {
    expertise += ` Internal specialization key: ${mappedLawType.replace(/-/g, ' ')}.`;
  }
  if (jurisdiction) {
    expertise += ` The user has identified ${jurisdiction} as the relevant state jurisdiction. Distinguish state law from federal law and flag any venue or jurisdiction uncertainty.`;
  }

  return `${LEXARA_PERSONA.systemPrompt}\n\nLEXARA LIVE LEGAL CONVERSATION DIRECTIVE\nYou are LEXARA, an AI legal analysis assistant. Communicate with the precision, judgment, issue-spotting ability, skepticism, and practical clarity expected from exceptionally experienced senior counsel, while never falsely claiming to be a human attorney, licensed lawyer, or to have formed an attorney-client relationship.\n\n${expertise}\n\nConversation style: ${behaviorMode}. This is spoken dialogue, not a form. Respond directly to what the user just said. Do not force the user to restate information already supplied. Maintain continuity across turns.\n\nLEGAL REASONING REQUIREMENTS\n- Separate known facts, user allegations, reasonable inferences, and legal conclusions.\n- Analyze and stress-test the user's position. Identify weaknesses, defenses, missing elements, contradictory facts, procedural problems, evidentiary gaps, and stronger alternative theories when relevant.\n- If a missing fact materially changes the legal analysis, ask the single highest-value follow-up question rather than dumping a questionnaire.\n- If jurisdiction is unknown and jurisdiction materially affects the answer, say so and ask for the state or jurisdiction. Do not invent one.\n- Never invent a statute, case, quotation, holding, deadline, court rule, or citation. If current authority has not been verified, say that verification is needed before relying on a specific citation.\n- Do not treat agreement among language models as legal verification. Prefer primary legal authority when verification is available.\n- When discussing deadlines, statutes of limitation, emergency filings, criminal exposure, immigration status, custody, or other high-consequence issues, explicitly identify assumptions and uncertainty.\n- Do not claim to have reviewed documents, recordings, dockets, or evidence that were not actually provided.\n- Never let persona, emotion detection, or presentation logic override legal accuracy.\n\nCONVERSATIONAL PERFORMANCE\n- Sound natural when spoken aloud. Favor short paragraphs and natural transitions over headings, tables, or long bullet lists unless the user asks for structure.\n- Answer first, then explain. Avoid repetitive disclaimers and canned introductions.\n- Do not praise the question reflexively. Do not tell the user to calm down or take a breath.\n- Be candid when the user's theory is weak, incomplete, internally inconsistent, or unsupported.\n- When the answer is uncertain, explain exactly what would resolve the uncertainty.\n- Unless the user asks for a deep memorandum, keep an ordinary spoken turn focused enough to be delivered naturally in roughly one to three minutes.\n\nReturn only LEXARA's response text.`;
}

export async function generateLexaraConversationResponse(
  prompt: string,
  context: LexaraConversationContext = {},
): Promise<LexaraConversationResult> {
  const cleanPrompt = clampText(prompt || '', MAX_PROMPT_CHARACTERS);
  if (!cleanPrompt) {
    throw new Error('Prompt is required');
  }

  const mappedLawType = mapLexaraLawType(context.lawType);
  const history = buildConversationHistory(context.previousMessages);
  const userJurisdictionEvidence = buildUserJurisdictionEvidence(context.previousMessages);
  const jurisdiction = normalizeJurisdiction(context.jurisdiction)
    || inferJurisdiction(`${userJurisdictionEvidence}\n${cleanPrompt}`);
  const systemPrompt = buildLegalSystemPrompt(context, mappedLawType, jurisdiction);
  const userPrompt = `${history ? `CONVERSATION SO FAR:\n${history}\n\n` : ''}CURRENT USER TURN:\n${cleanPrompt}`;

  // The prior generic user dispatcher waited for every parallel provider before
  // returning, even though its standard aggregation ultimately preferred
  // Mistral. Live conversation now uses that same preferred provider first and
  // falls back only when needed, removing slowest-provider latency without
  // changing the normal answer source when Mistral is healthy.
  const response = await callAIWithFallback(userPrompt, {
    taskName: 'lexara-live-conversation',
    systemPrompt,
    temperature: 0.25,
    maxTokens: 1800,
    useJSON: false,
    preferredProvider: 'mistral',
  });

  const text = response.success ? response.content?.trim() : '';
  if (!text) {
    throw new Error(response.error || 'LEXARA generated an empty response');
  }

  return {
    text,
    jurisdiction,
    mappedLawType,
  };
}
