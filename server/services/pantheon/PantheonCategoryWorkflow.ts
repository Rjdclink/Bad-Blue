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

export interface PantheonCategoryOutcome {
  index: number;
  label: string;
  startedAt: string;
  completedAt: string;
  targetCount: number;
  evidenceCount: number;
  crawlerAudit: PantheonRetrievalResponse['crawlerAudit'];
  findings: string[];
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

function interleaveCategoryTargets(
  groups: Array<ReturnType<typeof buildPantheonCategoryTargets>>,
  limit: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let row = 0; out.length < limit; row += 1) {
    let added = false;
    for (const group of groups) {
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
  name: string;
  location?: string;
  searchDepth: 1 | 2 | 3 | 4;
  deadlineAt: number;
  startCategoryIndex?: number;
  initialReport?: PeopleSearchReport;
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
    const remainingCategories = PANTHEON_REPORT_CATEGORIES.length - index;
    const remainingMs = input.deadlineAt - Date.now();
    if (remainingMs <= 2_000) {
      const completedAt = new Date().toISOString();
      for (let skipped = index; skipped < PANTHEON_REPORT_CATEGORIES.length; skipped += 1) {
        const skippedCategory = PANTHEON_REPORT_CATEGORIES[skipped];
        const outcome: PantheonCategoryOutcome = {
          index: skipped,
          label: skippedCategory.label,
          startedAt: completedAt,
          completedAt,
          targetCount: 0,
          evidenceCount: 0,
          crawlerAudit: [{
            crawler: 'category-orchestrator',
            capabilityClass: 'pantheon-secondary',
            status: 'timed_out',
            evidenceCount: 0,
            attempts: 0,
            targets: 0,
            error: 'Investigation deadline reached before category execution',
          }],
          findings: [],
        };
        categoryOutcomes.push(outcome);
        audits.push(...outcome.crawlerAudit);
      }
      report.crawlerAudit = mergeAudit(audits);
      report.summary = `PANTHEON reached the investigation deadline after completing ${index} of ${PANTHEON_REPORT_CATEGORIES.length} categories; remaining categories are explicitly marked timed out.`;
      break;
    }
    await input.onCategoryStart?.({ index, label: category.label, completedCategories: index });
    const finalizationReserveMs = Math.min(15_000, Math.max(2_000, Math.floor(remainingMs * 0.08)));
    const categoryBudgetMs = Math.max(1_500, Math.floor(Math.max(1, remainingMs - finalizationReserveMs) / remainingCategories));

    const targetGroups = category.registry.map(registryCategory =>
      buildPantheonCategoryTargets(registryCategory, input.name, input.location, targetLimit)
    );
    // Interleave registry facets so a multi-facet category cannot be monopolized
    // by the first tag. Source inventory remains priority ordered within each facet.
    const uniqueTargets = interleaveCategoryTargets(targetGroups, targetLimit);

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

    const outcome: PantheonCategoryOutcome = {
      index,
      label: category.label,
      startedAt,
      completedAt: new Date().toISOString(),
      targetCount: uniqueTargets.length,
      evidenceCount: reportable.length,
      crawlerAudit: retrieval.crawlerAudit,
      findings: reportable.map(item => cleanEvidenceContent(item.content).slice(0, 1800)),
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

    await input.onCategoryComplete?.({
      index,
      label: category.label,
      completedCategories: index + 1,
      outcome,
      partialReport: { ...report },
    });
  }

  return { report, categoryOutcomes };
}
