import type { PeopleSearchReport } from '../../peopleSearch';
import { pantheonRetrievalAdapter, type PantheonRetrievalResponse } from '../crawlers/PantheonRetrievalAdapter';
import {
  buildPantheonCategoryTargets,
  type PantheonBackgroundCategory,
} from './PantheonSovereignSourceRegistry';

export const PANTHEON_REPORT_CATEGORIES = [
  { label: 'Identity & Identity Verification', registry: ['identity','identity-resolution','false-positive'] },
  { label: 'Phone Numbers', registry: ['contacts','identity-resolution'] },
  { label: 'Email Addresses', registry: ['contacts','breach-notices'] },
  { label: 'Current Address', registry: ['residence','geography'] },
  { label: 'Address History', registry: ['residence','historical','chronology'] },
  { label: 'Relatives & Family', registry: ['relatives','family-probate'] },
  { label: 'Associates & Household Connections', registry: ['associates','relationship-graph'] },
  { label: 'Social-Media Profiles', registry: ['social','professional-web'] },
  { label: 'Usernames & Online Accounts', registry: ['usernames','domain-web'] },
  { label: 'Photos & Public Images', registry: ['internet','social'] },
  { label: 'Employment History', registry: ['employment','professional-web'] },
  { label: 'Education', registry: ['education','credentials'] },
  { label: 'Professional Licenses & Credentials', registry: ['credentials','professional-discipline'] },
  { label: 'Business Ownership & Affiliations', registry: ['business','corporate','organizations'] },
  { label: 'Property & Real Estate', registry: ['property','tax-public'] },
  { label: 'Vehicles & Transportation Records', registry: ['transportation'] },
  { label: 'Court Records', registry: ['courts','civil-litigation'] },
  { label: 'Criminal Records', registry: ['criminal','courts'] },
  { label: 'Arrest & Police Records', registry: ['arrests','criminal'] },
  { label: 'Incarceration & Corrections', registry: ['corrections'] },
  { label: 'Probation & Parole Information', registry: ['probation-parole'] },
  { label: 'Warrants & Wanted-Person Records', registry: ['warrants'] },
  { label: 'Sex-Offender Registries', registry: ['sex-offender'] },
  { label: 'Civil Litigation & Judgments', registry: ['civil-litigation','financial-public'] },
  { label: 'Bankruptcies, Liens & Financial Public Records', registry: ['bankruptcy','financial-public'] },
  { label: 'Marriage, Divorce & Vital-Record Information', registry: ['vital-records','family-probate'] },
  { label: 'News & Media Mentions', registry: ['news','adverse-media'] },
  { label: 'Internet & Web Footprint', registry: ['internet','domain-web','professional-web'] },
  { label: 'Government, Political & Public-Service Records', registry: ['government-employment','campaign-finance','lobbying','government-contracting'] },
  { label: 'Relationship & Timeline Intelligence', registry: ['relationship-graph','chronology','corroboration','contradictions','provenance'] },
] as const satisfies readonly { label: string; registry: readonly PantheonBackgroundCategory[] }[];

export type PantheonCategoryPhase = 'PENDING' | 'ACTIVE' | 'URL_WORK' | 'EVIDENCE_VALIDATION' | 'PERSISTING' | 'COMPLETE';

export interface PantheonWorkAuthorization {
  investigationId: string;
  categoryId: string;
  categoryIndex: number;
  categoryLabel: string;
  workId: string;
  canonicalUrl: string;
  capability: string;
  deadlineAt: number;
  subject: string;
  location?: string;
}

export type PantheonUrlState = 'pending'|'assigned'|'retrieving'|'retrieved'|'accepted'|'rejected'|'blocked'|'rate_limited'|'dead'|'timed_out'|'no_evidence';

export interface PantheonUrlLedgerEntry {
  url: string;
  priority: number;
  authority: 'primary'|'secondary'|'archive'|'discovery';
  registryCategory: PantheonBackgroundCategory;
  state: PantheonUrlState;
  attempts: number;
  evidenceIds: string[];
  failureReason?: string;
  capability?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PantheonCategoryOutcome {
  index: number;
  label: string;
  startedAt: string;
  completedAt: string;
  targetCount: number;
  evidenceCount: number;
  crawlerAudit: PantheonRetrievalResponse['crawlerAudit'];
  findings: string[];
  urlsAttempted: number;
  urlsSuccessful: number;
  urlsFailed: number;
  crawlersUsed: string[];
  evidenceRejected: number;
  urlLedger: PantheonUrlLedgerEntry[];
  cursor: number;
}

function mergeAudit(entries: PantheonRetrievalResponse['crawlerAudit']) {
  const merged = new Map<string, any>();
  for (const entry of entries) {
    const key = `${entry.capabilityClass}:${entry.crawler}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...entry });
      continue;
    }
    const evidenceCount = current.evidenceCount + entry.evidenceCount;
    merged.set(key, {
      ...current,
      evidenceCount,
      attempts: current.attempts + entry.attempts,
      targets: current.targets + entry.targets,
      status: evidenceCount > 0 ? 'completed_with_evidence'
        : [current.status, entry.status].includes('timed_out') ? 'timed_out'
        : [current.status, entry.status].includes('failed') ? 'failed'
        : [current.status, entry.status].includes('unavailable_no_content') ? 'unavailable_no_content'
        : 'completed_no_evidence',
      error: current.error || entry.error,
    });
  }
  return [...merged.values()];
}

function categoryTargetLimit(depth: number): number {
  // Investigation intensity controls source breadth, never crawler participation.
  // Keep the work bounded per category so all 30 categories receive time.
  return ({ 1: 40, 2: 94, 3: 150, 4: 150 } as Record<number, number>)[depth] || 40;
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value.trim();
  }
}

function cleanEvidenceContent(value: string): string {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBlockedOrDiagnosticEvidence(text: string): boolean {
  const lowered = text.toLowerCase();
  return [
    'our systems have detected unusual traffic',
    'enable javascript on your web browser',
    'captcha',
    'access denied',
    'forbidden',
    'too many requests',
    'rate limit',
    'robot check',
    'verify you are human',
    'press / to jump to the search box',
    'accessibility help',
    'quick settings',
  ].some(marker => lowered.includes(marker));
}

function isReportableEvidence(
  item: PantheonRetrievalResponse['evidence'][number],
  subject: string,
  location?: string,
): boolean {
  if (item.metadata?.entropySignature || item.metadata?.cooperativeAnalysis) return false;
  const text = cleanEvidenceContent(item.content);
  if (text.length < 40) return false;
  const lowered = text.toLowerCase();
  if (lowered.includes('<!doctype') || lowered.includes('function(') || lowered.includes('webpack')) return false;
  if (isBlockedOrDiagnosticEvidence(text)) return false;

  // Customer findings must actually mention the subject (or a strong identity
  // component), rather than merely proving that a registry/search page loaded.
  const subjectTokens = subject.toLowerCase().split(/\s+/).map(v => v.trim()).filter(v => v.length >= 2);
  const subjectMatches = subjectTokens.filter(token => lowered.includes(token)).length;
  const locationTokens = String(location || '').toLowerCase().split(/[\s,]+/).filter(v => v.length >= 3);
  const locationMatch = locationTokens.some(token => lowered.includes(token));
  return subjectTokens.length === 0
    ? false
    : subjectMatches >= Math.min(2, subjectTokens.length) || (subjectMatches >= 1 && locationMatch);
}

function sourcePriority(authority: 'primary'|'secondary'|'discovery'|'archive'): number {
  return ({ primary: 400, secondary: 300, archive: 200, discovery: 100 })[authority];
}

function buildCategoryLedger(
  groups: Array<{ registryCategory: PantheonBackgroundCategory; targets: ReturnType<typeof buildPantheonCategoryTargets> }>,
): PantheonUrlLedgerEntry[] {
  const seen = new Set<string>();
  const ledger: PantheonUrlLedgerEntry[] = [];
  for (const group of groups) {
    for (const candidate of group.targets) {
      const url = canonicalUrl(candidate.url);
      if (seen.has(url)) continue;
      seen.add(url);
      ledger.push({
        url,
        priority: sourcePriority(candidate.authority),
        authority: candidate.authority,
        registryCategory: group.registryCategory,
        state: 'pending',
        attempts: 0,
        evidenceIds: [],
      });
    }
  }
  return ledger.sort((a, b) => b.priority - a.priority || a.url.localeCompare(b.url));
}

function interleaveCategoryTargets(
  groups: Array<ReturnType<typeof buildPantheonCategoryTargets>>,
  limit: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const prioritized = groups.map(group => [...group].sort((a, b) => sourcePriority(b.authority) - sourcePriority(a.authority)));
  for (let row = 0; out.length < limit; row += 1) {
    let added = false;
    for (const group of prioritized) {
      const candidate = group[row];
      if (!candidate) continue;
      added = true;
      const url = canonicalUrl(candidate.url);
      if (!seen.has(url)) {
        seen.add(url);
        out.push(url);
        if (out.length >= limit) break;
      }
    }
    if (!added) break;
  }
  return out;
}

function dedupeEvidence(items: PantheonRetrievalResponse['evidence']) {
  const seen = new Set<string>();
  return items.filter(item => {
    const content = cleanEvidenceContent(item.content);
    const key = `${canonicalUrl(item.target)}|${content.slice(0, 500).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function conductPantheonCategoryWorkflow(input: {
  investigationId: string;
  name: string;
  location?: string;
  searchDepth: 1 | 2 | 3 | 4;
  deadlineAt: number;
  startCategoryIndex?: number;
  initialReport?: PeopleSearchReport;
  onCategoryState?: (state: { index: number; label: string; phase: PantheonCategoryPhase; completedCategories: number }) => Promise<void>;
  onCategoryStart?: (state: { index: number; label: string; completedCategories: number }) => Promise<void>;
  onCategoryComplete?: (state: { index: number; label: string; completedCategories: number; outcome: PantheonCategoryOutcome; partialReport: PeopleSearchReport }) => Promise<void>;
}): Promise<{ report: PeopleSearchReport; categoryOutcomes: PantheonCategoryOutcome[] }> {
  const evidence: PantheonRetrievalResponse['evidence'] = [];
  const audits: PantheonRetrievalResponse['crawlerAudit'] = [];
  const categoryOutcomes: PantheonCategoryOutcome[] = [];
  const targetLimit = categoryTargetLimit(input.searchDepth);

  const report: PeopleSearchReport = input.initialReport ? { ...input.initialReport } : {
    identitySummary: { name: input.name, verificationStatus: 'Public-source evidence review completed' },
    contactInformation: [],
    socialMediaPresence: [],
    employmentAndEducation: [],
    locationHistory: [],
    publicRecords: [],
    onlineMentions: [],
    riskAndReputation: [],
    summary: '',
    confidenceScore: 0,
    sources: [],
    crawlerAudit: [],
  };

  const startCategoryIndex = Math.max(0, Math.min(PANTHEON_REPORT_CATEGORIES.length - 1, input.startCategoryIndex || 0));
  for (let index = startCategoryIndex; index < PANTHEON_REPORT_CATEGORIES.length; index += 1) {
    const category = PANTHEON_REPORT_CATEGORIES[index];
    const startedAt = new Date().toISOString();
    await input.onCategoryState?.({ index, label: category.label, phase: 'ACTIVE', completedCategories: index });
    await input.onCategoryStart?.({ index, label: category.label, completedCategories: index });

    const remainingCategories = PANTHEON_REPORT_CATEGORIES.length - index;
    const remainingMs = Math.max(1, input.deadlineAt - Date.now());
    const finalizationReserveMs = Math.min(15_000, Math.max(2_000, Math.floor(remainingMs * 0.08)));
    const categoryBudgetMs = Math.max(1_500, Math.floor(Math.max(1, remainingMs - finalizationReserveMs) / remainingCategories));

    const ledgerGroups = category.registry.map(registryCategory => ({
      registryCategory,
      targets: buildPantheonCategoryTargets(registryCategory, input.name, input.location, 300),
    }));
    const urlLedger = buildCategoryLedger(ledgerGroups);
    const targetGroups = ledgerGroups.map(group => group.targets);
    // Interleave registry facets so a multi-facet category cannot be monopolized
    // by the first tag. Within each facet, direct primary authorities run first,
    // followed by secondary sources, archives, and broad discovery URLs.
    // The established 10/20/30-minute intensity levels expand URL breadth
    // through the existing 40/94/150 per-category budgets.
    const uniqueTargets = interleaveCategoryTargets(targetGroups, targetLimit);
    const activeUrls = new Set(uniqueTargets);
    for (const entry of urlLedger) {
      if (activeUrls.has(entry.url)) {
        entry.state = 'assigned';
        entry.attempts += 1;
        entry.startedAt = new Date().toISOString();
      }
    }

    await input.onCategoryState?.({ index, label: category.label, phase: 'URL_WORK', completedCategories: index });
    let retrieval: PantheonRetrievalResponse;
    try {
      retrieval = await pantheonRetrievalAdapter.retrieve({
        purpose: 'background_report',
        targets: uniqueTargets,
        depth: input.searchDepth,
        budgetMs: categoryBudgetMs,
        deadlineAt: Math.min(input.deadlineAt - finalizationReserveMs, Date.now() + categoryBudgetMs),
        subject: input.name,
        location: input.location,
        categoryLabel: category.label,
        authority: {
          investigationId: input.investigationId,
          categoryId: `${input.investigationId}:${index}`,
          categoryIndex: index,
          categoryLabel: category.label,
          deadlineAt: Math.min(input.deadlineAt - finalizationReserveMs, Date.now() + categoryBudgetMs),
          subject: input.name,
          location: input.location,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      retrieval = {
        available: false,
        reason: message,
        plan: { purpose: 'background_report', depth: input.searchDepth, crawlers: [], rationale: ['Category retrieval failed before crawler plan completed.'] } as any,
        evidence: [],
        crawlerAudit: [{
          crawler: 'category-orchestrator',
          capabilityClass: 'pantheon-secondary',
          status: 'failed',
          evidenceCount: 0,
          attempts: 1,
          targets: uniqueTargets.length,
          error: message,
        }],
      };
    }

    await input.onCategoryState?.({ index, label: category.label, phase: 'EVIDENCE_VALIDATION', completedCategories: index });
    const reportable = dedupeEvidence(
      retrieval.evidence.filter(item => isReportableEvidence(item, input.name, input.location))
    );
    evidence.push(...reportable.map(item => ({
      ...item,
      content: cleanEvidenceContent(item.content).slice(0, 1800),
      target: canonicalUrl(item.target),
      metadata: { ...(item.metadata || {}), reportCategory: category.label, categoryIndex: index },
    })));
    audits.push(...retrieval.crawlerAudit);

    const urlsAttempted = retrieval.crawlerAudit.reduce((sum, item) => sum + Number(item.targets || 0), 0);
    const urlsSuccessful = retrieval.crawlerAudit.reduce((sum, item) => sum + Number(item.evidenceCount || 0), 0);
    const crawlersUsed = [...new Set(retrieval.crawlerAudit.filter(item => Number(item.attempts || 0) > 0).map(item => item.crawler))];
    const evidenceByUrl = new Map(reportable.map((item, evidenceIndex) => [canonicalUrl(item.target), `${index}:${evidenceIndex}`]));
    for (const entry of urlLedger) {
      if (!activeUrls.has(entry.url)) continue;
      const evidenceId = evidenceByUrl.get(entry.url);
      entry.completedAt = new Date().toISOString();
      if (evidenceId) {
        entry.state = 'accepted';
        entry.evidenceIds.push(evidenceId);
      } else {
        entry.state = 'no_evidence';
      }
    }
    const outcome: PantheonCategoryOutcome = {
      index,
      label: category.label,
      startedAt,
      completedAt: new Date().toISOString(),
      targetCount: uniqueTargets.length,
      evidenceCount: reportable.length,
      crawlerAudit: retrieval.crawlerAudit,
      findings: reportable.map(item => cleanEvidenceContent(item.content).slice(0, 1800)),
      urlsAttempted,
      urlsSuccessful,
      urlsFailed: Math.max(0, urlsAttempted - urlsSuccessful),
      crawlersUsed,
      evidenceRejected: Math.max(0, retrieval.evidence.length - reportable.length),
      urlLedger,
      cursor: uniqueTargets.length,
    };
    categoryOutcomes.push(outcome);

    const uniqueEvidence = dedupeEvidence(evidence);
    const webCategory = /social|username|photo|news|internet|media/i;
    report.onlineMentions = uniqueEvidence
      .filter(item => webCategory.test(String(item.metadata?.reportCategory || '')))
      .map(item => `[${String(item.metadata?.reportCategory || 'Evidence')}] ${item.content} — Source: ${item.target}`);
    report.publicRecords = uniqueEvidence
      .filter(item => !webCategory.test(String(item.metadata?.reportCategory || '')))
      .map(item => `[${String(item.metadata?.reportCategory || 'Evidence')}] ${item.content} — Source: ${item.target}`);
    report.sources = uniqueEvidence.map(item => ({
      name: `${String(item.metadata?.reportCategory || 'PANTHEON Evidence')} — ${item.crawler}`,
      data: { url: item.target, finding: item.content },
      confidence: item.confidence,
      timestamp: new Date(item.retrievedAt),
    }));
    report.crawlerAudit = mergeAudit(audits);
    const completedWithEvidence = categoryOutcomes.filter(item => item.evidenceCount > 0).length;
    report.confidenceScore = categoryOutcomes.length ? completedWithEvidence / categoryOutcomes.length : 0;
    report.summary = `PANTHEON completed ${index + 1} of ${PANTHEON_REPORT_CATEGORIES.length} authoritative report categories. Each completed category records its crawler outcomes and provenance before advancement.`;

    await input.onCategoryState?.({ index, label: category.label, phase: 'PERSISTING', completedCategories: index });
    await input.onCategoryComplete?.({
      index,
      label: category.label,
      completedCategories: index + 1,
      outcome,
      partialReport: { ...report },
    });
    await input.onCategoryState?.({ index, label: category.label, phase: 'COMPLETE', completedCategories: index + 1 });
  }

  return { report, categoryOutcomes };
}
