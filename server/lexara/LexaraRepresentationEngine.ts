import { generateLegalAnalysis } from '../aiProvider';
import {
  researchLegalAuthority,
  type LexaraAuthorityResearch,
  type LexaraAuthoritySource,
} from './LexaraAuthorityResearch';
import { getLexaraLegalDomainProfile } from './LexaraLegalDomainProfiles';

export type RepresentationStage =
  | 'intake'
  | 'pre-filing'
  | 'filing'
  | 'service'
  | 'discovery'
  | 'motion-practice'
  | 'hearing'
  | 'trial'
  | 'appeal'
  | 'post-judgment'
  | 'administrative-review'
  | 'closed';

export type PacketRequirement = 'mandatory' | 'conditional' | 'optional';
export type PacketCoverage = 'verified' | 'partial' | 'unverified';

export interface RepresentationPacketItem {
  id: string;
  title: string;
  formNumber?: string;
  requirement: PacketRequirement;
  reason: string;
  sourceUrl: string;
  sourceTitle: string;
  revision?: string;
  documentKind: 'official-form' | 'custom-draft' | 'supporting-document' | 'service-document' | 'evidence' | 'other';
  status: 'needed' | 'in-progress' | 'complete' | 'not-applicable';
}

export interface RepresentationPacket {
  name: string;
  proceeding: string;
  jurisdiction: string;
  courtOrAgency?: string;
  coverage: PacketCoverage;
  items: RepresentationPacketItem[];
  proceduralRequirements: Array<{
    category: 'filing' | 'service' | 'fee' | 'deadline' | 'hearing' | 'other';
    text: string;
    sourceUrl: string;
    sourceTitle: string;
  }>;
  unresolved: string[];
  verifiedAt?: string;
  completePacketSourceUrl?: string;
}

export interface RepresentationArtifact {
  id: string;
  title: string;
  kind: 'filing-packet' | 'document' | 'evidence' | 'exhibit' | 'research' | 'correspondence';
  status: 'saved' | 'draft' | 'filed' | 'served' | 'superseded';
  storageRef?: string;
  sourceUrl?: string;
  contentSummary?: string;
  consistencyFacts?: string[];
  consistencyConflicts?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RepresentationEvidenceLink {
  artifactId: string;
  title: string;
  findings: string[];
  supportsElements: string[];
  weakensDefenses: string[];
  raisesIssues: string[];
  contradictions: string[];
  status: 'uploaded' | 'analyzed' | 'needs-corroboration';
}

export interface RepresentationMatterState {
  version: 1;
  matterId: string;
  sessionId: string;
  title: string;
  lawType?: string;
  jurisdiction?: string;
  objective: string;
  proceeding?: string;
  stage: RepresentationStage;
  courtOrAgency?: string;
  packet?: RepresentationPacket;
  knownFacts: string[];
  legalIssues: string[];
  defensesAndRisks: string[];
  missingInformation: string[];
  evidenceNeeds: string[];
  parties: string[];
  historySummary?: string;
  artifacts: RepresentationArtifact[];
  evidenceMap: RepresentationEvidenceLink[];
  deadlines: Array<{
    label: string;
    date?: string;
    sourceUrl?: string;
    basis?: string;
    status: 'unverified' | 'verified' | 'satisfied';
  }>;
  nextSteps: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SavedMatterSummary {
  matterId: string;
  sessionId: string;
  title: string;
  lawType?: string;
  jurisdiction?: string;
  proceeding?: string;
  stage: RepresentationStage;
  packetCoverage?: PacketCoverage;
  artifactCount: number;
  updatedAt: string;
}

interface AdvanceMatterInput {
  prompt: string;
  response: string;
  sessionId: string;
  lawType?: string;
  jurisdiction?: string;
  prior?: RepresentationMatterState | null;
  allowClaudeOpus?: boolean;
  signal?: AbortSignal;
}

const STAGES = new Set<RepresentationStage>([
  'intake', 'pre-filing', 'filing', 'service', 'discovery', 'motion-practice',
  'hearing', 'trial', 'appeal', 'post-judgment', 'administrative-review', 'closed',
]);

const MATTER_SIGNAL =
  /\b(?:my|me|i\s+(?:need|want|have|was|am|got|received|filed)|we\s+(?:need|want|have|were)|divorc|custod|lawsuit|sue|suing|petition|motion|complaint|appeal|charged|arrest|evict|foreclos|probate|estate|bankrupt|hearing|case|claim|benefit|discriminat|terminat|injur|accident|contract|debt|order|filing|served|summons)\b/i;

const PACKET_SIGNAL =
  /\b(?:file|filing|packet|form|forms|petition|complaint|motion|appeal|divorc|custod|bankrupt|probate|evict|application|administrative\s+review|hearing|lawsuit|sue|service|summons|proposed\s+order)\b/i;

const PACKET_BRANCH_SIGNAL =
  /\b(?:child|children|minor|custod|visitation|parenting|property|asset|debt|support|alimony|spousal|service|serve|cannot\s+(?:find|locate)|publication|waiver|fee|indigent|emergency|temporary|protective|domestic\s+violence|contested|uncontested|agreement|default|counterclaim|address|county|court|agency|hearing|appeal|evidence|representative)\b/i;

function clamp(value: unknown, max = 400): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length <= max ? text : text.slice(0, max);
}

function mergeUnique(existing: string[] = [], incoming: unknown, max = 40, maxLength = 500): string[] {
  const values = Array.isArray(incoming) ? incoming : [];
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of [...existing, ...values]) {
    const text = clamp(value, maxLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    merged.push(text);
    if (merged.length >= max) break;
  }
  return merged;
}

function safeJsonObject(value: string): Record<string, any> | null {
  const cleaned = String(value || '')
    .replace(/^\s*\x60\x60\x60(?:json)?\s*/i, '')
    .replace(/\s*\x60\x60\x60\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function normalizeSourceUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function sourceMap(research: LexaraAuthorityResearch): Map<string, LexaraAuthoritySource> {
  return new Map(
    research.sources
      .map(source => [normalizeSourceUrl(source.url), source] as const)
      .filter(([url]) => Boolean(url)),
  );
}

function inferStage(prompt: string, prior?: RepresentationMatterState | null): RepresentationStage {
  const text = prompt.toLowerCase();
  if (/\b(?:appeal|notice of appeal|appellate|reconsideration|rehearing)\b/.test(text)) return 'appeal';
  if (/\b(?:post[- ]judgment|enforce(?:ment)?|garnish|collect judgment)\b/.test(text)) return 'post-judgment';
  if (/\b(?:trial|jury trial|bench trial)\b/.test(text)) return 'trial';
  if (/\b(?:hearing|arraignment|conference)\b/.test(text)) return 'hearing';
  if (/\b(?:discovery|interrogator|request for production|deposition|admission)\b/.test(text)) return 'discovery';
  if (/\b(?:motion|summary judgment|dismiss|suppress|compel|continuance)\b/.test(text)) return 'motion-practice';
  if (/\b(?:served|service of process|proof of service|certificate of service)\b/.test(text)) return 'service';
  if (/\b(?:filed|filing|file this|submit|petition|complaint|application)\b/.test(text)) return 'filing';
  if (/\b(?:agency appeal|administrative appeal|higher-level review|supplemental claim|reconsideration)\b/.test(text)) return 'administrative-review';
  return prior?.stage || 'intake';
}

function inferProceeding(prompt: string, lawType?: string, prior?: RepresentationMatterState | null): string | undefined {
  const text = prompt.toLowerCase();
  const patterns: Array<[RegExp, string]> = [
    [/\bdivorc|dissolution\b/, 'divorce/dissolution'],
    [/\bcustod|parenting time|visitation\b/, 'child custody/parenting'],
    [/\bchild support\b/, 'child support'],
    [/\bprotective order|restraining order\b/, 'protective order'],
    [/\bbankrupt|chapter 7|chapter 11|chapter 13\b/, 'bankruptcy'],
    [/\bprobate|estate administration|will contest\b/, 'probate/estate'],
    [/\beviction|unlawful detainer\b/, 'eviction'],
    [/\bappeal|notice of appeal\b/, 'appeal'],
    [/\bhabeas|2254|2255|post[- ]conviction\b/, 'post-conviction'],
    [/\bcomplaint|lawsuit|sue|civil action\b/, 'civil action'],
    [/\bcriminal|charged|arraignment|indictment\b/, 'criminal proceeding'],
    [/\bimmigration|removal|asylum|naturalization\b/, 'immigration proceeding'],
    [/\bva |veteran|higher-level review|supplemental claim\b/, 'veterans benefits review'],
    [/\bsocial security|ssa|disability appeal\b/, 'Social Security proceeding'],
    [/\btax court|irs|deficiency\b/, 'tax proceeding'],
    [/\badministrative appeal|agency decision\b/, 'administrative review'],
  ];
  for (const [pattern, proceeding] of patterns) {
    if (pattern.test(text)) return proceeding;
  }
  if (prior?.proceeding) return prior.proceeding;
  const profile = getLexaraLegalDomainProfile(lawType);
  return profile ? profile.displayName : undefined;
}

function matterTitle(proceeding: string | undefined, jurisdiction: string | undefined, lawType: string | undefined): string {
  const profile = getLexaraLegalDomainProfile(lawType);
  const base = proceeding || profile?.displayName || 'Legal matter';
  return jurisdiction ? `${base} — ${jurisdiction}` : base;
}

function shouldOpenMatter(prompt: string, prior?: RepresentationMatterState | null): boolean {
  if (isSavedMatterListRequest(prompt)) return false;
  return Boolean(prior) || MATTER_SIGNAL.test(prompt);
}

function shouldPlanPacket(prompt: string, matter: RepresentationMatterState): boolean {
  if (!matter.jurisdiction || !matter.proceeding) return false;
  if (
    matter.packet?.coverage === 'verified'
    && !/\b(?:changed|different|new|another|update|amend|modify)\b/i.test(prompt)
    && !PACKET_BRANCH_SIGNAL.test(prompt)
  ) {
    return false;
  }
  return PACKET_SIGNAL.test(prompt);
}

function packetResearchPrompt(matter: RepresentationMatterState): string {
  return [
    `Matter objective: ${matter.objective}`,
    `Proceeding: ${matter.proceeding || 'not yet established'}`,
    `Jurisdiction: ${matter.jurisdiction || 'not yet established'}`,
    matter.courtOrAgency ? `Court/agency: ${matter.courtOrAgency}` : '',
    `Current procedural stage: ${matter.stage}`,
    `Known matter facts: ${JSON.stringify(matter.knownFacts)}`,
    `Known missing information: ${JSON.stringify(matter.missingInformation)}`,
    'Identify the COMPLETE current filing package for this exact proceeding and stage.',
    'Find every mandatory form/document and every conditional document triggered by common factual branches, including local court/agency forms, statewide/federal forms, cover sheets, summons/service papers, confidential-information forms, disclosures, financial forms, fee/fee-waiver papers, proposed orders, certificates/proofs of service, required attachments, exhibits, and supporting documents.',
    'Prefer the exact court/agency and local rules/forms over generic statewide or federal material when both exist.',
    'Verify current form titles/numbers, revision or edition information when available, and filing/service requirements from official sources.',
    'Do not infer completeness from one isolated form. Look for official packets, checklists, filing instructions, practice manuals, rules, and form libraries that identify the whole package.',
  ].filter(Boolean).join('\n');
}

async function buildPacket(
  matter: RepresentationMatterState,
  options: { allowClaudeOpus?: boolean; signal?: AbortSignal },
): Promise<RepresentationPacket> {
  const profile = getLexaraLegalDomainProfile(matter.lawType);
  const basePrompt = packetResearchPrompt(matter);
  const researchPrompts = [
    basePrompt,
    `${basePrompt}\n\nBROADENING PASS: Find the exact local court/agency forms library, official packet/checklist, local rules or standing orders, filing method, service documents, fee/fee-waiver requirements, and any required cover or confidential-information sheets.`,
    `${basePrompt}\n\nCONDITIONAL PASS: Identify branch-dependent forms and attachments triggered by the user's facts or common procedural forks, and verify current form edition/revision information. Include what changes after filing, service, response, hearing, or review when the current stage makes those documents part of this package.`,
  ];
  const researchResults = (await Promise.all(researchPrompts.map(prompt => researchLegalAuthority(prompt, {
    jurisdiction: matter.jurisdiction,
    domainName: profile?.displayName,
    researchHints: profile?.researchHints,
    preferredOfficialDomains: profile?.preferredOfficialDomains,
    forceResearch: true,
    signal: options.signal,
  })))).filter((result): result is LexaraAuthorityResearch => Boolean(result));

  const mergedSourceMap = new Map<string, LexaraAuthoritySource>();
  for (const result of researchResults) {
    for (const source of result.sources) {
      const key = normalizeSourceUrl(source.url);
      if (!key || mergedSourceMap.has(key)) continue;
      mergedSourceMap.set(key, source);
      if (mergedSourceMap.size >= 40) break;
    }
    if (mergedSourceMap.size >= 40) break;
  }
  const mergedSources = [...mergedSourceMap.values()];
  const firstResearch = researchResults[0];
  const research: LexaraAuthorityResearch | null = firstResearch && mergedSources.length ? {
    ...firstResearch,
    sources: mergedSources,
    hasPrimaryAuthority: mergedSources.some(source => source.kind === 'primary'),
    selectedCrawlers: [...new Set(researchResults.flatMap(result => result.selectedCrawlers))],
    searchedAt: researchResults.map(result => result.searchedAt).sort().at(-1) || firstResearch.searchedAt,
    summary: mergedSources.map((source, index) =>
      `${index + 1}. [${source.kind.toUpperCase()}] ${source.title} — ${source.url}${source.excerpt ? `\nEvidence excerpt: ${source.excerpt}` : ''}`
    ).join('\n'),
  } : null;

  const empty: RepresentationPacket = {
    name: `${matter.title} filing packet`,
    proceeding: matter.proceeding || matter.title,
    jurisdiction: matter.jurisdiction || '',
    courtOrAgency: matter.courtOrAgency,
    coverage: 'unverified',
    items: [],
    proceduralRequirements: [],
    unresolved: ['The complete official filing package has not yet been verified from current authoritative sources.'],
  };
  if (!research?.sources?.length) return empty;

  const allowedSources = sourceMap(research);
  const sourceDigest = research.sources.map((source, index) => (
    `${index + 1}. ${source.kind.toUpperCase()} | ${source.title} | ${source.url} | ${source.excerpt || ''}`
  )).join('\n');

  const raw = await generateLegalAnalysis('representation-packet-planning', [
    'Create a structured filing-packet plan ONLY from the application-supplied sources below.',
    'Return JSON only with keys: packetName, courtOrAgency, completeness, completePacketSourceUrl, unresolved, items, proceduralRequirements.',
    'completeness must be one of complete, partial, unverified.',
    'Each item must have: title, formNumber, requirement, reason, sourceUrl, revision, documentKind.',
    'requirement must be mandatory, conditional, or optional.',
    'documentKind must be official-form, custom-draft, supporting-document, service-document, evidence, or other.',
    'Every item MUST cite one exact sourceUrl from the supplied source list. Omit any item that cannot be tied to one of those sources.',
    'proceduralRequirements is an array of source-backed filing/service/fee/deadline/hearing requirements. Each entry must contain category, text, and one exact sourceUrl from the supplied source list. Do not include generic advice.',
    'Use complete only when an official packet/checklist/practice-manual source supports the complete package for this proceeding. Otherwise use partial.',
    'Never invent a form number, filing requirement, local rule, fee, service method, revision, deadline, or court.',
    '',
    `MATTER:\n${JSON.stringify({
      objective: matter.objective,
      proceeding: matter.proceeding,
      jurisdiction: matter.jurisdiction,
      courtOrAgency: matter.courtOrAgency,
      stage: matter.stage,
      knownFacts: matter.knownFacts,
      missingInformation: matter.missingInformation,
    })}`,
    '',
    `APPLICATION-SUPPLIED SOURCES:\n${sourceDigest}`,
  ].join('\n'), {
    providerPolicy: 'legalwhat',
    systemPrompt: 'You are a deterministic legal filing-packet compiler. You may organize only source-backed requirements supplied by the application. Return JSON only and never use model memory as authority.',
    temperature: 0,
    maxTokens: 6500,
    useJSON: true,
    allowClaudeOpus: options.allowClaudeOpus === true,
    claudeWorkload: options.allowClaudeOpus ? 'deep-legal' : 'standard',
    signal: options.signal,
  });

  const parsed = safeJsonObject(raw);
  if (!parsed) return {
    ...empty,
    unresolved: ['Authoritative sources were retrieved, but the complete packet could not be structured reliably.'],
    verifiedAt: research.searchedAt,
  };

  const items: RepresentationPacketItem[] = [];
  const incomingItems = Array.isArray(parsed.items) ? parsed.items : [];
  for (let index = 0; index < incomingItems.length && items.length < 40; index += 1) {
    const item = incomingItems[index];
    if (!item || typeof item !== 'object') continue;
    const sourceUrl = normalizeSourceUrl(item.sourceUrl);
    const source = allowedSources.get(sourceUrl);
    if (!source) continue;
    const requirement = ['mandatory', 'conditional', 'optional'].includes(item.requirement)
      ? item.requirement as PacketRequirement
      : 'conditional';
    const documentKind = [
      'official-form', 'custom-draft', 'supporting-document',
      'service-document', 'evidence', 'other',
    ].includes(item.documentKind)
      ? item.documentKind as RepresentationPacketItem['documentKind']
      : 'other';
    const title = clamp(item.title, 220);
    if (!title) continue;
    items.push({
      id: `packet-item-${index + 1}`,
      title,
      formNumber: clamp(item.formNumber, 80) || undefined,
      requirement,
      reason: clamp(item.reason, 700) || 'Required or potentially required by the cited source.',
      sourceUrl: source.url,
      sourceTitle: source.title,
      revision: clamp(item.revision, 120) || undefined,
      documentKind,
      status: 'needed',
    });
  }

  const proceduralRequirements = (Array.isArray(parsed.proceduralRequirements) ? parsed.proceduralRequirements : [])
    .slice(0, 30)
    .flatMap((requirement: any) => {
      const sourceUrl = normalizeSourceUrl(requirement?.sourceUrl);
      const source = allowedSources.get(sourceUrl);
      const text = clamp(requirement?.text, 700);
      if (!source || !text) return [];
      const category = ['filing','service','fee','deadline','hearing','other'].includes(requirement?.category)
        ? requirement.category
        : 'other';
      return [{
        category,
        text,
        sourceUrl: source.url,
        sourceTitle: source.title,
      }];
    });

  const completePacketUrl = normalizeSourceUrl(parsed.completePacketSourceUrl);
  const completeSource = completePacketUrl ? allowedSources.get(completePacketUrl) : undefined;
  const completeSourceLooksLikePacket = Boolean(
    completeSource
    && /\b(?:packet|checklist|forms?|filing|documents?|practice manual|instructions?)\b/i.test(
      `${completeSource.title} ${completeSource.excerpt || ''}`,
    ),
  );
  const requestedCompleteness = String(parsed.completeness || '').toLowerCase();
  const coverage: PacketCoverage =
    requestedCompleteness === 'complete'
    && research.hasPrimaryAuthority
    && completeSourceLooksLikePacket
    && items.length > 0
      ? 'verified'
      : items.length > 0
        ? 'partial'
        : 'unverified';

  const unresolved = Array.isArray(parsed.unresolved)
    ? parsed.unresolved.map((value: unknown) => clamp(value, 500)).filter(Boolean).slice(0, 12)
    : [];

  if (coverage !== 'verified' && !unresolved.length) {
    unresolved.push('The retrieved authority did not establish a complete filing packet with enough confidence to call it complete.');
  }

  return {
    name: clamp(parsed.packetName, 220) || `${matter.title} filing packet`,
    proceeding: matter.proceeding || matter.title,
    jurisdiction: matter.jurisdiction || '',
    courtOrAgency: clamp(parsed.courtOrAgency, 220) || matter.courtOrAgency,
    coverage,
    items,
    proceduralRequirements,
    unresolved,
    verifiedAt: research.searchedAt,
    completePacketSourceUrl: completeSourceLooksLikePacket ? completeSource?.url : undefined,
  };
}

export function sanitizeRepresentationMatter(value: unknown): RepresentationMatterState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as any;
  if (raw.version !== 1) return null;
  const matterId = clamp(raw.matterId, 128);
  const sessionId = clamp(raw.sessionId, 128);
  const title = clamp(raw.title, 220);
  const objective = clamp(raw.objective, 1200);
  if (!matterId || !sessionId || !title || !objective) return null;

  const stage = STAGES.has(raw.stage) ? raw.stage as RepresentationStage : 'intake';
  const artifacts = Array.isArray(raw.artifacts)
    ? raw.artifacts.slice(0, 100).flatMap((item: any) => {
        const id = clamp(item?.id, 160);
        const itemTitle = clamp(item?.title, 240);
        if (!id || !itemTitle) return [];
        return [{
          id,
          title: itemTitle,
          kind: ['filing-packet', 'document', 'evidence', 'exhibit', 'research', 'correspondence'].includes(item.kind)
            ? item.kind : 'document',
          status: ['saved', 'draft', 'filed', 'served', 'superseded'].includes(item.status)
            ? item.status : 'saved',
          storageRef: clamp(item.storageRef, 600) || undefined,
          sourceUrl: normalizeSourceUrl(item.sourceUrl) || undefined,
          contentSummary: clamp(item.contentSummary, 1200) || undefined,
          consistencyFacts: mergeUnique([], item.consistencyFacts, 30, 400),
          consistencyConflicts: mergeUnique([], item.consistencyConflicts, 20, 500),
          createdAt: clamp(item.createdAt, 80) || new Date().toISOString(),
          updatedAt: clamp(item.updatedAt, 80) || new Date().toISOString(),
        } as RepresentationArtifact];
      })
    : [];

  return {
    version: 1,
    matterId,
    sessionId,
    title,
    lawType: clamp(raw.lawType, 120) || undefined,
    jurisdiction: clamp(raw.jurisdiction, 120) || undefined,
    objective,
    proceeding: clamp(raw.proceeding, 220) || undefined,
    stage,
    courtOrAgency: clamp(raw.courtOrAgency, 240) || undefined,
    packet: raw.packet && typeof raw.packet === 'object' ? raw.packet as RepresentationPacket : undefined,
    knownFacts: mergeUnique([], raw.knownFacts, 60, 600),
    legalIssues: mergeUnique([], raw.legalIssues, 40, 500),
    defensesAndRisks: mergeUnique([], raw.defensesAndRisks, 40, 500),
    missingInformation: mergeUnique([], raw.missingInformation, 40, 500),
    evidenceNeeds: mergeUnique([], raw.evidenceNeeds, 40, 500),
    parties: mergeUnique([], raw.parties, 30, 240),
    historySummary: clamp(raw.historySummary, 2000) || undefined,
    artifacts,
    evidenceMap: Array.isArray(raw.evidenceMap) ? raw.evidenceMap.slice(0, 100).flatMap((entry: any) => {
      const artifactId = clamp(entry?.artifactId, 180);
      const title = clamp(entry?.title, 240);
      if (!artifactId || !title) return [];
      return [{
        artifactId,
        title,
        findings: mergeUnique([], entry?.findings, 20, 600),
        supportsElements: mergeUnique([], entry?.supportsElements, 20, 400),
        weakensDefenses: mergeUnique([], entry?.weakensDefenses, 20, 400),
        raisesIssues: mergeUnique([], entry?.raisesIssues, 20, 400),
        contradictions: mergeUnique([], entry?.contradictions, 20, 600),
        status: ['uploaded','analyzed','needs-corroboration'].includes(entry?.status) ? entry.status : 'uploaded',
      } as RepresentationEvidenceLink];
    }) : [],
    deadlines: Array.isArray(raw.deadlines) ? raw.deadlines.slice(0, 40).flatMap((deadline: any) => {
      const label = clamp(deadline?.label, 220);
      if (!label) return [];
      const status = ['unverified', 'verified', 'satisfied'].includes(deadline?.status) ? deadline.status : 'unverified';
      return [{
        label,
        date: clamp(deadline?.date, 40) || undefined,
        sourceUrl: normalizeSourceUrl(deadline?.sourceUrl) || undefined,
        basis: clamp(deadline?.basis, 600) || undefined,
        status,
      }];
    }) : [],
    nextSteps: Array.isArray(raw.nextSteps) ? raw.nextSteps.map((value: unknown) => clamp(value, 500)).filter(Boolean).slice(0, 20) : [],
    createdAt: clamp(raw.createdAt, 80) || new Date().toISOString(),
    updatedAt: clamp(raw.updatedAt, 80) || new Date().toISOString(),
  };
}

async function verifyMatterDeadlines(
  matter: RepresentationMatterState,
  signal?: AbortSignal,
): Promise<void> {
  const candidates = matter.deadlines.filter(deadline => deadline.status === 'unverified' && deadline.date);
  if (!candidates.length || !matter.jurisdiction) return;

  const profile = getLexaraLegalDomainProfile(matter.lawType);
  const research = await researchLegalAuthority([
    `Jurisdiction: ${matter.jurisdiction}.`,
    `Proceeding: ${matter.proceeding || matter.title}.`,
    `Procedural stage: ${matter.stage}.`,
    'Verify the controlling current deadline rule, the event that triggers the clock, computation method, and any weekends/holidays/service extensions that materially affect the candidate dates below.',
    'Use current primary court/government authority. Do not validate a candidate date merely because it appears plausible.',
    `KNOWN MATTER FACTS: ${JSON.stringify(matter.knownFacts)}`,
    `CANDIDATE DEADLINES: ${JSON.stringify(candidates)}`,
  ].join('\n\n'), {
    jurisdiction: matter.jurisdiction,
    domainName: profile?.displayName,
    researchHints: profile?.researchHints,
    preferredOfficialDomains: profile?.preferredOfficialDomains,
    forceResearch: true,
    signal,
  });
  if (!research?.hasPrimaryAuthority || !research.sources.length) return;

  const allowed = sourceMap(research);
  const raw = await generateLegalAnalysis('representation-deadline-verification', [
    'Verify candidate legal deadline dates using ONLY the supplied current authority excerpts and known matter facts.',
    'Return JSON only: {"verified":[{"label":"...","date":"...","sourceUrl":"...","basis":"..."}]}.',
    'Return an item only when the authority establishes the deadline period/rule and the supplied matter facts establish the triggering date well enough to support the exact candidate date.',
    'The sourceUrl must exactly match one supplied PRIMARY source. If the exact date cannot be supported, omit it.',
    `CANDIDATES:\n${JSON.stringify(candidates)}`,
    `KNOWN FACTS:\n${JSON.stringify(matter.knownFacts)}`,
    `SOURCES:\n${research.sources.map(source => `${source.kind.toUpperCase()} | ${source.title} | ${source.url} | ${source.excerpt || ''}`).join('\n')}`,
  ].join('\n\n'), {
    providerPolicy: 'legalwhat',
    systemPrompt: 'You are a deterministic legal deadline verifier. Use only supplied primary authority and facts. Return JSON only.',
    temperature: 0,
    maxTokens: 2200,
    useJSON: true,
    allowClaudeOpus: false,
    claudeWorkload: 'standard',
    signal,
  });
  const parsed = safeJsonObject(raw);
  const verified = Array.isArray(parsed?.verified) ? parsed!.verified : [];
  for (const item of verified) {
    const label = clamp(item?.label, 220);
    const date = clamp(item?.date, 40);
    const sourceUrl = normalizeSourceUrl(item?.sourceUrl);
    const source = allowed.get(sourceUrl);
    if (!label || !date || !source || source.kind !== 'primary') continue;
    const match = matter.deadlines.find(deadline =>
      deadline.status === 'unverified'
      && deadline.date === date
      && deadline.label.toLowerCase() === label.toLowerCase()
    );
    if (!match) continue;
    match.status = 'verified';
    match.sourceUrl = source.url;
    match.basis = clamp(item?.basis, 600) || `Verified from ${source.title}`;
  }
}

export async function advanceRepresentationMatter(input: AdvanceMatterInput): Promise<RepresentationMatterState | null> {
  const prior = sanitizeRepresentationMatter(input.prior);
  if (!shouldOpenMatter(input.prompt, prior)) return prior;

  const now = new Date().toISOString();
  const proceeding = inferProceeding(input.prompt, input.lawType, prior);
  const jurisdiction = input.jurisdiction || prior?.jurisdiction;
  const objective = prior?.objective || clamp(input.prompt, 1200);
  const stage = inferStage(input.prompt, prior);

  const matter: RepresentationMatterState = {
    version: 1,
    matterId: prior?.matterId || input.sessionId,
    sessionId: input.sessionId,
    title: prior?.title || matterTitle(proceeding, jurisdiction, input.lawType),
    lawType: input.lawType || prior?.lawType,
    jurisdiction,
    objective,
    proceeding,
    stage,
    courtOrAgency: prior?.courtOrAgency,
    packet: prior?.packet,
    knownFacts: prior?.knownFacts || [],
    legalIssues: prior?.legalIssues || [],
    defensesAndRisks: prior?.defensesAndRisks || [],
    missingInformation: prior?.missingInformation || [],
    evidenceNeeds: prior?.evidenceNeeds || [],
    parties: prior?.parties || [],
    historySummary: prior?.historySummary,
    artifacts: prior?.artifacts || [],
    evidenceMap: prior?.evidenceMap || [],
    deadlines: prior?.deadlines || [],
    nextSteps: prior?.nextSteps || [],
    createdAt: prior?.createdAt || now,
    updatedAt: now,
  };

  if (input.response.trim()) {
    try {
      const stateRaw = await generateLegalAnalysis('representation-state-update', [
      'Update the structured matter record from ONLY the supplied current user turn, current Lexara response, and prior matter record.',
      'Return JSON only with keys: knownFacts, legalIssues, defensesAndRisks, missingInformation, evidenceNeeds, parties, historySummary, courtOrAgency, nextSteps, deadlines.',
      'Do not invent facts, names, dates, deadlines, filings, evidence, parties, or legal conclusions.',
      'knownFacts may include only facts stated by the user or explicitly identified in the supplied response as user-provided facts.',
      'legalIssues, defensesAndRisks, missingInformation, evidenceNeeds, and nextSteps may summarize only points explicitly present in the supplied response.',
      'For deadlines, include only a deadline date explicitly present in the supplied text; every new deadline must have status "unverified" unless a source URL is explicitly present in the supplied text.',
      'Keep the historySummary under 900 characters and describe what has happened in the matter so far, not generic law.',
      `PRIOR MATTER: ${JSON.stringify(prior || {})}`,
      `CURRENT USER TURN: ${input.prompt}`,
      `CURRENT LEXARA RESPONSE: ${input.response}`,
    ].join('\n\n'), {
      providerPolicy: 'legalwhat',
      systemPrompt: 'You are a deterministic legal matter-record clerk. Extract and organize only supplied information. Return JSON only.',
      temperature: 0,
      maxTokens: 2600,
      useJSON: true,
      allowClaudeOpus: false,
      claudeWorkload: 'standard',
      signal: input.signal,
    });
    const stateUpdate = safeJsonObject(stateRaw);
    if (stateUpdate) {
      matter.knownFacts = mergeUnique(matter.knownFacts, stateUpdate.knownFacts, 60, 600);
      matter.legalIssues = mergeUnique(matter.legalIssues, stateUpdate.legalIssues, 40, 500);
      matter.defensesAndRisks = mergeUnique(matter.defensesAndRisks, stateUpdate.defensesAndRisks, 40, 500);
      matter.missingInformation = mergeUnique(matter.missingInformation, stateUpdate.missingInformation, 40, 500);
      matter.evidenceNeeds = mergeUnique(matter.evidenceNeeds, stateUpdate.evidenceNeeds, 40, 500);
      matter.parties = mergeUnique(matter.parties, stateUpdate.parties, 30, 240);
      matter.historySummary = clamp(stateUpdate.historySummary, 2000) || matter.historySummary;
      matter.courtOrAgency = clamp(stateUpdate.courtOrAgency, 240) || matter.courtOrAgency;
      matter.nextSteps = mergeUnique(matter.nextSteps, stateUpdate.nextSteps, 20, 500);
      if (Array.isArray(stateUpdate.deadlines)) {
        for (const deadline of stateUpdate.deadlines.slice(0, 20)) {
          const label = clamp(deadline?.label, 220);
          const date = clamp(deadline?.date, 40);
          if (!label || !date) continue;
          if (matter.deadlines.some(existing => existing.label.toLowerCase() === label.toLowerCase() && existing.date === date)) continue;
          matter.deadlines.push({
            label,
            date,
            status: 'unverified',
          });
        }
      }
    }
    } catch {
      // Matter persistence must never block the legal answer if structured state
      // extraction is temporarily unavailable. The deterministic core above remains.
    }
  }

  if (shouldPlanPacket(input.prompt, matter)) {
    matter.packet = await buildPacket(matter, {
      allowClaudeOpus: input.allowClaudeOpus,
      signal: input.signal,
    });
    if (!matter.artifacts.some(artifact => artifact.id === `packet:${matter.matterId}`)) {
      matter.artifacts.push({
        id: `packet:${matter.matterId}`,
        title: matter.packet.name,
        kind: 'filing-packet',
        status: 'saved',
        sourceUrl: matter.packet.completePacketSourceUrl,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  if (input.response.trim() && matter.deadlines.some(deadline => deadline.status === 'unverified' && deadline.date)) {
    await verifyMatterDeadlines(matter, input.signal).catch(() => undefined);
  }

  return matter;
}

export function summarizeMatter(matter: RepresentationMatterState): SavedMatterSummary {
  return {
    matterId: matter.matterId,
    sessionId: matter.sessionId,
    title: matter.title,
    lawType: matter.lawType,
    jurisdiction: matter.jurisdiction,
    proceeding: matter.proceeding,
    stage: matter.stage,
    packetCoverage: matter.packet?.coverage,
    artifactCount: matter.artifacts.length,
    updatedAt: matter.updatedAt,
  };
}

export function findReferencedMatter(
  prompt: string,
  matters: Array<{ state: RepresentationMatterState; summary: SavedMatterSummary }>,
): RepresentationMatterState | null {
  if (!matters.length) return null;
  const normalizedPrompt = prompt.toLowerCase();
  let best: { score: number; matter: RepresentationMatterState } | null = null;

  for (const candidate of matters) {
    const fields = [
      candidate.summary.title,
      candidate.summary.proceeding,
      candidate.summary.lawType?.replace(/-/g, ' '),
      candidate.summary.jurisdiction,
      candidate.state.packet?.name,
    ].filter(Boolean).map(value => String(value).toLowerCase());

    let score = 0;
    for (const field of fields) {
      const tokens = field.split(/[^a-z0-9]+/).filter(token => token.length >= 4);
      score += tokens.filter(token => normalizedPrompt.includes(token)).length;
      if (normalizedPrompt.includes(field)) score += 4;
    }
    if (!best || score > best.score) best = { score, matter: candidate.state };
  }

  return best && best.score > 0 ? best.matter : null;
}

export function formatRepresentationForSystem(
  current: RepresentationMatterState | null | undefined,
  savedMatters: SavedMatterSummary[] = [],
): string {
  if (!current && !savedMatters.length) return '';

  const matterText = current ? JSON.stringify({
    title: current.title,
    objective: current.objective,
    lawType: current.lawType,
    jurisdiction: current.jurisdiction,
    proceeding: current.proceeding,
    stage: current.stage,
    courtOrAgency: current.courtOrAgency,
    knownFacts: current.knownFacts,
    legalIssues: current.legalIssues,
    defensesAndRisks: current.defensesAndRisks,
    missingInformation: current.missingInformation,
    evidenceNeeds: current.evidenceNeeds,
    parties: current.parties,
    historySummary: current.historySummary,
    packet: current.packet ? {
      name: current.packet.name,
      coverage: current.packet.coverage,
      items: current.packet.items.map(item => ({
        title: item.title,
        formNumber: item.formNumber,
        requirement: item.requirement,
        status: item.status,
        sourceUrl: item.sourceUrl,
      })),
      proceduralRequirements: current.packet.proceduralRequirements,
      unresolved: current.packet.unresolved,
    } : undefined,
    artifacts: current.artifacts.map(artifact => ({
      title: artifact.title,
      kind: artifact.kind,
      status: artifact.status,
      contentSummary: artifact.contentSummary,
      consistencyFacts: artifact.consistencyFacts,
      consistencyConflicts: artifact.consistencyConflicts,
    })),
    evidenceMap: current.evidenceMap,
    deadlines: current.deadlines,
    nextSteps: current.nextSteps,
  }) : 'none';

  const indexText = savedMatters.slice(0, 20).map((matter, index) => (
    `${index + 1}. ${matter.title} | ${matter.stage} | ${matter.jurisdiction || 'jurisdiction not established'} | ${matter.artifactCount} saved item(s)`
  )).join('\n');

  return `\n\nPERSISTENT REPRESENTATION CONTEXT
The application, not the user, supplied this matter state. Treat it as the authoritative organizational record for what LEXARA has already done, while still verifying law, forms, deadlines, and filing requirements from current primary authority when those issues matter.

Current matter:
${matterText}

Saved matter index:
${indexText || 'none'}

REPRESENTATION RULES
- Continue the current matter instead of making the user reconstruct prior work.
- If the user asks what is saved, answer from this context and do not invent files or packets.
- A filing packet with coverage "verified" has an official source supporting the complete package. "partial" or "unverified" must never be described as complete.
- When the objective requires filing, determine the whole required/conditional packet, not merely the first form named by the user.
- Local court/agency forms and rules control over generic templates when applicable.
- Do not claim a deadline, fee, service method, form edition, or filing requirement is verified unless the application supplied current authoritative support.
- Keep different legal matters separate.\n`;
}

export function isSavedMatterListRequest(prompt: string): boolean {
  return /\b(?:list|show|what(?:\s+do\s+i)?\s+have|what(?:'s| is)\s+saved|saved|stored)\b[\s\S]{0,80}\b(?:matter|matters|case|cases|storage|files?|packets?)\b/i.test(prompt)
    || /\b(?:list|show)\s+(?:my\s+)?(?:legal\s+)?matters\b/i.test(prompt);
}
