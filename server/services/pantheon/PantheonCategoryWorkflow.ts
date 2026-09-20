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
  return ({ 1: 4, 2: 6, 3: 8, 4: 10 } as Record<number, number>)[depth] || 6;
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
    await input.onCategoryStart?.({ index, label: category.label, completedCategories: index });

    const remainingCategories = PANTHEON_REPORT_CATEGORIES.length - index;
    const remainingMs = Math.max(1, input.deadlineAt - Date.now());
    const finalizationReserveMs = Math.min(15_000, Math.max(2_000, Math.floor(remainingMs * 0.08)));
    const categoryBudgetMs = Math.max(1_500, Math.floor(Math.max(1, remainingMs - finalizationReserveMs) / remainingCategories));

    const targets = category.registry.flatMap(registryCategory =>
      buildPantheonCategoryTargets(registryCategory, input.name, input.location, targetLimit)
    );
    const uniqueTargets = [...new Set(targets.map(target => target.url))].slice(0, targetLimit);

    let retrieval: PantheonRetrievalResponse;
    try {
      retrieval = await pantheonRetrievalAdapter.retrieve({
        purpose: 'background_report',
        targets: uniqueTargets,
        depth: input.searchDepth,
        budgetMs: categoryBudgetMs,
        deadlineAt: Math.min(input.deadlineAt - finalizationReserveMs, Date.now() + categoryBudgetMs),
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

    evidence.push(...retrieval.evidence.map(item => ({
      ...item,
      metadata: { ...(item.metadata || {}), reportCategory: category.label, categoryIndex: index },
    })));
    audits.push(...retrieval.crawlerAudit);

    const outcome: PantheonCategoryOutcome = {
      index,
      label: category.label,
      startedAt,
      completedAt: new Date().toISOString(),
      targetCount: uniqueTargets.length,
      evidenceCount: retrieval.evidence.length,
      crawlerAudit: retrieval.crawlerAudit,
    };
    categoryOutcomes.push(outcome);

    report.onlineMentions = evidence.map(item => item.content).filter(Boolean);
    report.publicRecords = evidence.map(item => `[${String(item.metadata?.reportCategory || 'Evidence')}] ${item.target}`);
    report.sources = categoryOutcomes.map(item => ({
      name: `PANTHEON Category ${item.index + 1}: ${item.label}`,
      data: {
        targets: item.targetCount,
        evidence: item.evidenceCount,
        crawlerAudit: item.crawlerAudit,
      },
      confidence: item.evidenceCount > 0 ? 0.8 : 0,
      timestamp: new Date(item.completedAt),
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
