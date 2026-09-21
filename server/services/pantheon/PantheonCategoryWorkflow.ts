import type { PeopleSearchReport } from '../../peopleSearch';
import {
  getPantheonCategoryCapabilities,
  PANTHEON_CRAWLER_CAPABILITY_MATRIX,
  type PantheonCapabilityId,
  type PantheonReportCategoryLabel,
} from './PantheonCrawlerCapabilityMatrix';
import { createPantheonDeadline, throwIfPantheonAborted } from './PantheonDeadline';
import { runPantheonBounded } from './PantheonBoundedScheduler';
import {
  canonicalPantheonEvidenceUrl,
  cleanPantheonEvidenceContent,
  processPantheonEvidence,
  dedupePantheonEvidence,
  requireVerifiedPantheonEvidence,
} from './PantheonEvidencePipeline';
import {
  finalizePantheonCategoryCapabilityOutcomes,
  resolveHealthyPantheonPrimaryCapabilities,
  type PantheonCapabilityHealth,
  type PantheonCapabilityOutcome,
} from './PantheonCapabilityRuntime';
import { pantheonRetrievalAdapter, type PantheonRetrievalResponse } from '../crawlers/PantheonRetrievalAdapter';
import { admitPantheonUrl } from '../crawlers/PublicAcquisitionInfrastructure';
import {
  assessPantheonCategoryOutcome,
  type PantheonCategoryCompletionState,
} from './PantheonInvestigationController';
import {
  buildPantheonCategoryTargets,
  preflightPantheonSourceTargets,
  type PantheonBackgroundCategory,
  type PantheonSourcePreflightIssue,
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
] as const satisfies readonly { label: PantheonReportCategoryLabel; registry: readonly PantheonBackgroundCategory[] }[];

export type PantheonCategoryPhase = 'PENDING' | 'ACTIVE' | 'URL_WORK' | 'EVIDENCE_VALIDATION' | 'PERSISTING' | 'COMPLETE' | 'PARTIAL';

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

export type PantheonWorkType = 'authoritative-source'|'discovery-search'|'candidate-validation'|'corroboration';

export type PantheonUrlState = 'pending'|'assigned'|'retrieving'|'retrieved'|'accepted'|'rejected'|'blocked'|'rate_limited'|'dead'|'timed_out'|'no_evidence';

export interface PantheonUrlLedgerEntry {
  url: string;
  priority: number;
  authority: 'primary'|'secondary'|'archive'|'discovery';
  registryCategory: PantheonBackgroundCategory;
  workType: PantheonWorkType;
  state: PantheonUrlState;
  attempts: number;
  evidenceIds: string[];
  failureReason?: string;
  result?: {
    status: number;
    evidenceCount: number;
    crawler?: string;
    retrievedAt?: string;
  };
  capability?: string;
  capabilityReason?: string;
  requiredCapabilities?: string[];
  transport?: 'direct-http'|'browser'|'search-provider'|'specialized-adapter'|'archive';
  transportAttempts?: Array<{ transport: NonNullable<PantheonUrlLedgerEntry['transport']>; outcome: 'pending'|'succeeded'|'failed'; reason?: string }>;
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
  ledgerVersion: 1;
  totalLedgerUrls: number;
  pendingUrls: number;
  expectedCapabilities: string[];
  completionState: PantheonCategoryCompletionState;
  completionReason: string;
  capabilityOutcomes: PantheonCapabilityOutcome[];
  sourcePreflightIssues: PantheonSourcePreflightIssue[];
}

export interface PantheonPersistedCategoryState {
  index: number;
  label: PantheonReportCategoryLabel;
  state: 'pending' | 'active' | 'completed' | 'partial';
  phase: PantheonCategoryPhase;
  protectedBudgetMs: number;
  sourcePlan: {
    registryCategories: readonly PantheonBackgroundCategory[];
    capabilities: string[];
    transports: string[];
    urls: string[];
    preflightIssues: PantheonSourcePreflightIssue[];
  };
  outcome?: PantheonCategoryOutcome;
}

export function initializePantheonCategoryPlans(input: {
  name: string;
  location?: string;
  searchDepth: 1 | 2 | 3 | 4;
  budgetMs: number;
  concurrency?: number;
}): PantheonPersistedCategoryState[] {
  const concurrency = Math.max(1, Math.min(4, input.concurrency || 4));
  const waveCount = Math.ceil(PANTHEON_REPORT_CATEGORIES.length / concurrency);
  const finalizationReserveMs = Math.min(15_000, Math.max(2_000, Math.floor(input.budgetMs * 0.08)));
  const protectedBudgetMs = Math.max(1_500, Math.floor((input.budgetMs - finalizationReserveMs) / waveCount));
  const urlLimit = Math.min(300, categoryProductiveWorkTarget(input.searchDepth) * 2);

  return PANTHEON_REPORT_CATEGORIES.map((category, index) => {
    const perRegistryLimit = Math.max(1, Math.ceil(urlLimit / category.registry.length));
    const rawTargets = category.registry.flatMap(registryCategory =>
      buildPantheonCategoryTargets(registryCategory, input.name, input.location, perRegistryLimit)
    );
    const preflight = preflightPantheonSourceTargets(
      rawTargets,
      category.registry[0],
      input.name,
      input.location,
    );
    return {
      index,
      label: category.label,
      state: 'pending',
      phase: 'PENDING',
      protectedBudgetMs,
      sourcePlan: {
        registryCategories: category.registry,
        capabilities: getPantheonCategoryCapabilities(category.label),
        transports: [...new Set(preflight.targets.map(target => target.transport))],
        urls: preflight.targets.map(target => target.url),
        preflightIssues: preflight.issues,
      },
    };
  });
}

function mergeAudit(entries: PantheonRetrievalResponse['crawlerAudit']) {
  const merged = new Map<string, any>();
  for (const entry of entries) {
    const key = `${entry.capabilityClass}:${entry.crawler}:${entry.route || 'primary'}:${entry.fallbackFor || ''}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, {
        ...entry,
        sourceOutcomes: [...(entry.sourceOutcomes || [])],
      });
      continue;
    }
    const evidenceCount = current.evidenceCount + entry.evidenceCount;
    merged.set(key, {
      ...current,
      evidenceCount,
      attempts: current.attempts + entry.attempts,
      targets: current.targets + entry.targets,
      durationMs: Number(current.durationMs || 0) + Number(entry.durationMs || 0),
      sourceOutcomes: [...(current.sourceOutcomes || []), ...(entry.sourceOutcomes || [])],
      status: evidenceCount > 0 ? 'completed_with_evidence'
        : [current.status, entry.status].includes('timed_out') ? 'timed_out'
        : [current.status, entry.status].includes('failed') ? 'failed'
        : [current.status, entry.status].includes('unavailable_no_content') ? 'unavailable_no_content'
        : [current.status, entry.status].includes('not_applicable') ? 'not_applicable'
        : 'completed_no_evidence',
      error: current.error || entry.error,
    });
  }
  return [...merged.values()];
}

function categoryProductiveWorkTarget(depth: number): number {
  // Intensity is a productive-work target, not an initial URL batch size.
  // Failed/blocked/dead URLs are substituted and do not consume this target.
  return ({ 1: 40, 2: 94, 3: 150, 4: 150 } as Record<number, number>)[depth] || 40;
}

function intensityPolicy(depth: number) {
  return ({
    1: { corroborationTarget: 1, discoveryExpansion: 1, fallbackDepth: 1 },
    2: { corroborationTarget: 2, discoveryExpansion: 2, fallbackDepth: 2 },
    3: { corroborationTarget: 3, discoveryExpansion: 3, fallbackDepth: 3 },
    4: { corroborationTarget: 3, discoveryExpansion: 4, fallbackDepth: 4 },
  } as Record<number, { corroborationTarget: number; discoveryExpansion: number; fallbackDepth: number }>)[depth] ||
    { corroborationTarget: 1, discoveryExpansion: 1, fallbackDepth: 1 };
}

function sourcePriority(authority: 'primary'|'secondary'|'discovery'|'archive'): number {
  return ({ primary: 400, secondary: 300, archive: 200, discovery: 100 })[authority];
}

function capabilityFor(categoryLabel: string, entry: PantheonUrlLedgerEntry): { capability: string; reason: string } {
  const value = `${categoryLabel} ${entry.registryCategory} ${entry.url}`.toLowerCase();
  if (/relationship|associate|family|relative|social|username/.test(value)) return { capability: 'sixdegrees', reason: 'relationship-social-identity graph source' };
  if (/court|criminal|arrest|warrant|offender|correction|probation|parole|government/.test(value)) return { capability: 'cerberus', reason: 'government-legal-record source' };
  if (/news|media|business|property|employment|education|credential/.test(value)) return { capability: 'blizzard', reason: 'broad public-web corroboration source' };
  if (/timeline|corroboration|contradiction/.test(value)) return { capability: 'lich', reason: 'timeline-corroboration analysis source' };
  return { capability: 'startrek', reason: 'general authoritative public-source retrieval' };
}

function workTypeFor(authority: PantheonUrlLedgerEntry['authority'], transport: PantheonUrlLedgerEntry['transport']): PantheonWorkType {
  if (authority === 'discovery' || transport === 'search-provider') return 'discovery-search';
  return 'authoritative-source';
}

function transportFor(entry: PantheonUrlLedgerEntry): PantheonUrlLedgerEntry['transport'] {
  const url = entry.url.toLowerCase();
  if (/google\.com\/search|bing\.com\/search|duckduckgo\.com/.test(url)) return 'search-provider';
  if (/archive\.org|web\.archive\.org/.test(url)) return 'archive';
  if (/linkedin|facebook|instagram|tiktok|x\.com/.test(url)) return 'browser';
  if (/api\.|\/api\/|\.json(?:$|\?)/.test(url)) return 'specialized-adapter';
  return 'direct-http';
}

function buildCategoryLedger(
  categoryLabel: string,
  requiredCapabilities: string[],
  groups: Array<{ registryCategory: PantheonBackgroundCategory; targets: ReturnType<typeof buildPantheonCategoryTargets> }>,
): PantheonUrlLedgerEntry[] {
  const seen = new Set<string>();
  const ledger: PantheonUrlLedgerEntry[] = [];
  for (const group of groups) {
    for (const candidate of group.targets) {
      const admission = admitPantheonUrl(candidate.url);
      if (!admission.ok) continue;
      const url = admission.url;
      if (seen.has(url)) continue;
      seen.add(url);
      const selectedTransport = candidate.transport || transportFor({ url, priority: sourcePriority(candidate.authority), authority: candidate.authority, registryCategory: group.registryCategory, workType: 'authoritative-source', state: 'pending', attempts: 0, evidenceIds: [] });
      ledger.push({
        url,
        priority: sourcePriority(candidate.authority),
        authority: candidate.authority,
        registryCategory: group.registryCategory,
        workType: workTypeFor(candidate.authority, selectedTransport),
        state: 'pending',
        attempts: 0,
        evidenceIds: [],
        ...(() => {
          const routed = capabilityFor(group.registryCategory, { url, priority: sourcePriority(candidate.authority), authority: candidate.authority, registryCategory: group.registryCategory, workType: 'authoritative-source', state: 'pending', attempts: 0, evidenceIds: [] });
          return {
            capability: routed.capability,
            capabilityReason: routed.reason,
            requiredCapabilities,
          };
        })(),
        transport: selectedTransport,
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
      const admission = admitPantheonUrl(candidate.url);
      if (!admission.ok) continue;
      const url = admission.url;
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

let activeCanonicalInvestigation: string | null = null;


export interface PantheonCategoryWorkflowInput {
  investigationId: string;
  name: string;
  location?: string;
  searchDepth: 1 | 2 | 3 | 4;
  deadlineAt: number;
  startCategoryIndex?: number;
  categoryIndexes?: readonly number[];
  initialReport?: PeopleSearchReport;
  initialCategoryOutcomes?: readonly PantheonCategoryOutcome[];
  capabilityHealth?: readonly PantheonCapabilityHealth[];
  signal?: AbortSignal;
  categoryConcurrency?: number;
  onCategoryState?: (state: { index: number; label: string; phase: PantheonCategoryPhase; completedCategories: number }) => Promise<void>;
  onCategoryStart?: (state: { index: number; label: string; completedCategories: number }) => Promise<void>;
  onCategoryComplete?: (state: { index: number; label: string; completedCategories: number; outcome: PantheonCategoryOutcome; partialReport: PeopleSearchReport }) => Promise<void>;
}

interface PantheonCategoryExecution {
  outcome: PantheonCategoryOutcome;
  evidence: PantheonRetrievalResponse['evidence'];
  audit: PantheonRetrievalResponse['crawlerAudit'];
}

interface PantheonCategoryExecutionInput extends PantheonCategoryWorkflowInput {
  index: number;
  capabilityHealth: readonly PantheonCapabilityHealth[];
  categoryDeadlineAt: number;
  finalizationReserveMs: number;
  productiveWorkTarget: number;
  policy: ReturnType<typeof intensityPolicy>;
  signal: AbortSignal;
  completedCount: () => number;
}

async function executePantheonCategory(input: PantheonCategoryExecutionInput): Promise<PantheonCategoryExecution> {
  const index = input.index;
    const category = PANTHEON_REPORT_CATEGORIES[index];
    const startedAt = new Date().toISOString();
    const completedBeforeCategory = input.completedCount();
    await input.onCategoryState?.({ index, label: category.label, phase: 'ACTIVE', completedCategories: completedBeforeCategory });
    await input.onCategoryStart?.({ index, label: category.label, completedCategories: completedBeforeCategory });

    const finalizationReserveMs = input.finalizationReserveMs;
    const categoryDeadlineAt = input.categoryDeadlineAt;
    const capabilityRoute = resolveHealthyPantheonPrimaryCapabilities(category.label, input.capabilityHealth);
    const expectedCapabilities = capabilityRoute.requested;
    const executableCapabilities = capabilityRoute.selected;

    const preflightGroups = category.registry.map(registryCategory => {
      const preflight = preflightPantheonSourceTargets(
        buildPantheonCategoryTargets(registryCategory, input.name, input.location, 300),
        registryCategory,
        input.name,
        input.location,
      );
      return { registryCategory, ...preflight };
    });
    const sourcePreflightIssues = preflightGroups.flatMap(group => group.issues);
    const ledgerGroups = preflightGroups.map(group => ({
      registryCategory: group.registryCategory,
      targets: group.targets,
    }));
    const urlLedger = buildCategoryLedger(category.label, executableCapabilities, ledgerGroups);
    const targetGroups = ledgerGroups.map(group => group.targets);
    // Interleave registry facets so a multi-facet category cannot be monopolized
    // by the first tag. Within each facet, direct primary authorities run first,
    // followed by secondary sources, archives, and broad discovery URLs.
    // The established 10/20/30-minute intensity levels expand URL breadth
    // through the existing 40/94/150 per-category budgets.
    const prioritizedTargets = interleaveCategoryTargets(targetGroups, urlLedger.length);
    const activeUrls = new Set<string>();
    const retrievalEvidence: PantheonRetrievalResponse['evidence'] = [];
    const retrievalAudit: PantheonRetrievalResponse['crawlerAudit'] = [];
    let cursor = 0;
    await input.onCategoryState?.({ index, label: category.label, phase: 'URL_WORK', completedCategories: completedBeforeCategory });

    let productiveWorkUnits = 0;
    while (cursor < prioritizedTargets.length && productiveWorkUnits < input.productiveWorkTarget) {
      throwIfPantheonAborted(input.signal);
      const remainingForWork = categoryDeadlineAt - Date.now();
      if (remainingForWork <= 750) break;

      // A work authorization is URL-scoped. Controlled parallelism may be
      // layered above this later, but each executable unit has one canonical URL.
      const batch: string[] = [prioritizedTargets[cursor]];
      cursor += 1;
      const firstUrl = batch[0];
      const firstEntry = urlLedger.find(item => item.url === firstUrl);
      for (const url of batch) {
        activeUrls.add(url);
        const entry = urlLedger.find(item => item.url === url);
        if (entry) {
          entry.state = 'assigned';
          entry.attempts += 1;
          entry.startedAt = new Date().toISOString();
          entry.transportAttempts = [...(entry.transportAttempts || []), { transport: entry.transport || 'direct-http', outcome: 'pending' }];
        }
      }

      try {
        const batchRetrieval = await pantheonRetrievalAdapter.retrieve({
          purpose: 'background_report',
          targets: batch,
          depth: input.searchDepth,
          budgetMs: Math.max(750, remainingForWork),
          deadlineAt: Math.min(input.deadlineAt - finalizationReserveMs, Date.now() + remainingForWork),
          subject: input.name,
          location: input.location,
          categoryLabel: category.label,
          capabilityHint: batch.flatMap(url => {
            const entry = urlLedger.find(item => item.url === url);
            return entry?.requiredCapabilities?.length
              ? entry.requiredCapabilities
              : entry?.capability ? [entry.capability] : [];
          }),
          transportHint: batch.map(url => urlLedger.find(item => item.url === url)?.transport).filter(Boolean) as string[],
          signal: input.signal,
          authority: {
            investigationId: input.investigationId,
            categoryId: `${input.investigationId}:${index}`,
            categoryIndex: index,
            categoryLabel: category.label,
            workId: `${input.investigationId}:${index}:${cursor - 1}`,
            canonicalUrl: firstUrl,
            capability: firstEntry?.capability || 'startrek',
            deadlineAt: Math.min(input.deadlineAt - finalizationReserveMs, Date.now() + remainingForWork),
            subject: input.name,
            location: input.location,
          },
        });
        retrievalEvidence.push(...batchRetrieval.evidence);
        retrievalAudit.push(...batchRetrieval.crawlerAudit);
        const producedEvidence = batchRetrieval.evidence.filter(item => item.content.trim() && item.confidence > 0);
        if (producedEvidence.length > 0) {
          const independentSources = new Set(producedEvidence.map(item => canonicalPantheonEvidenceUrl(item.target))).size;
          productiveWorkUnits += Math.min(input.policy.corroborationTarget, Math.max(1, independentSources));
        }

        // Crawler-discovered URLs are non-executable candidates. The controller
        // alone may admit them to this category's ledger and priority queue.
        for (const item of batchRetrieval.evidence) {
          const candidates = Array.isArray(item.metadata?.discoveredCandidates)
            ? item.metadata.discoveredCandidates as unknown[]
            : [];
          for (const rawCandidate of candidates) {
            const admission = admitPantheonUrl(String(rawCandidate || ''));
            if (!admission.ok || urlLedger.some(entry => entry.url === admission.url)) continue;
            const parent = urlLedger.find(entry => entry.url === canonicalPantheonEvidenceUrl(item.target));
            const candidate: PantheonUrlLedgerEntry = {
              url: admission.url,
              priority: Math.max(50, (parent?.priority || 100) - 25),
              authority: 'discovery',
              registryCategory: parent?.registryCategory || category.registry[0],
              workType: 'candidate-validation',
              state: 'pending',
              attempts: 0,
              evidenceIds: [],
            };
            const routedCandidate = capabilityFor(category.label, candidate);
            candidate.capability = routedCandidate.capability;
            candidate.capabilityReason = routedCandidate.reason;
            candidate.requiredCapabilities = executableCapabilities;
            candidate.transport = transportFor(candidate);
            urlLedger.push(candidate);
            prioritizedTargets.push(candidate.url);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failedEntry = urlLedger.find(item => item.url === firstUrl);
        if (failedEntry) {
          failedEntry.completedAt = new Date().toISOString();
          failedEntry.failureReason = message.slice(0, 300);
          failedEntry.state = /429|rate/i.test(message) ? 'rate_limited'
            : /timeout|deadline/i.test(message) ? 'timed_out'
            : /403|forbidden/i.test(message) ? 'blocked'
            : 'dead';
          failedEntry.result = { status: 0, evidenceCount: 0, retrievedAt: failedEntry.completedAt };
        }
        retrievalAudit.push({
          crawler: 'category-orchestrator',
          capabilityClass: 'pantheon-secondary',
          status: 'failed',
          evidenceCount: 0,
          attempts: 1,
          targets: batch.length,
          error: message,
        });
      }
    }

    const retrieval: PantheonRetrievalResponse = {
      available: true,
      plan: { purpose: 'background_report', depth: input.searchDepth, crawlers: [], rationale: ['Live priority cursor executed category URL ledger.'] } as any,
      evidence: retrievalEvidence,
      crawlerAudit: retrievalAudit,
    };

    await input.onCategoryState?.({ index, label: category.label, phase: 'EVIDENCE_VALIDATION', completedCategories: completedBeforeCategory });
    const validation = processPantheonEvidence(retrieval.evidence, input.name, input.location);
    const reportable = validation.accepted.filter(item =>
      PANTHEON_CRAWLER_CAPABILITY_MATRIX[item.capabilityId as PantheonCapabilityId]?.reportEvidenceEligible === true
    );
    const acceptedEvidence = reportable.map(item => ({
      ...item,
      metadata: { ...(item.metadata || {}), reportCategory: category.label, categoryIndex: index },
    }));

    const urlsAttempted = urlLedger.filter(entry => activeUrls.has(entry.url)).length;
    const successfulUrls = new Set(reportable.map(item => canonicalPantheonEvidenceUrl(item.sourceUrl)));
    const urlsSuccessful = [...activeUrls].filter(url => successfulUrls.has(canonicalPantheonEvidenceUrl(url))).length;
    const crawlersUsed = [...new Set(reportable.map(item => item.crawler).filter(Boolean))];
    const evidenceByUrl = new Map(reportable.map(item => [canonicalPantheonEvidenceUrl(item.sourceUrl), item.evidenceId]));
    const auditFailures = retrieval.crawlerAudit.filter(item => item.status === 'failed' || item.status === 'timed_out');
    for (const entry of urlLedger) {
      if (!activeUrls.has(entry.url)) continue;
      const evidenceId = evidenceByUrl.get(entry.url);
      entry.completedAt = new Date().toISOString();
      const matchingEvidence = reportable.find(item => canonicalPantheonEvidenceUrl(item.target) === entry.url);
      const matchingAudit = retrieval.crawlerAudit.find(item => Number(item.targets || 0) > 0);
      entry.result = {
        status: evidenceId ? 200 : 0,
        evidenceCount: evidenceId ? 1 : 0,
        crawler: matchingEvidence?.crawler || matchingAudit?.crawler,
        retrievedAt: matchingEvidence?.retrievedAt || entry.completedAt,
      };
      if (evidenceId) {
        entry.state = 'accepted';
        entry.evidenceIds.push(evidenceId);
        const lastTransport = entry.transportAttempts?.[entry.transportAttempts.length - 1];
        if (lastTransport) lastTransport.outcome = 'succeeded';
      } else if (auditFailures.some(item => /429|rate/i.test(String(item.error || '')))) {
        const lastTransport = entry.transportAttempts?.[entry.transportAttempts.length - 1];
        if (lastTransport) { lastTransport.outcome = 'failed'; lastTransport.reason = 'rate_limited'; }
        entry.state = 'rate_limited';
        entry.failureReason = 'rate_limited';
      } else if (auditFailures.some(item => item.status === 'timed_out')) {
        entry.state = 'timed_out';
        entry.failureReason = 'timed_out';
      } else if (auditFailures.length > 0) {
        entry.state = 'dead';
        entry.failureReason = auditFailures[0]?.error || 'retrieval_failed';
      } else {
        entry.state = 'no_evidence';
      }
    }
    const capabilityOutcomes = finalizePantheonCategoryCapabilityOutcomes({
      categoryLabel: category.label,
      health: input.capabilityHealth,
      crawlerAudit: retrieval.crawlerAudit,
    });
    const assessment = assessPantheonCategoryOutcome({
      label: category.label,
      targetCount: activeUrls.size,
      expectedCapabilities,
      crawlerAudit: retrieval.crawlerAudit,
      urlLedger,
    });
    const outcome: PantheonCategoryOutcome = {
      index,
      label: category.label,
      startedAt,
      completedAt: new Date().toISOString(),
      targetCount: activeUrls.size,
      evidenceCount: reportable.length,
      crawlerAudit: retrieval.crawlerAudit,
      findings: reportable.map(item => cleanPantheonEvidenceContent(item.content).slice(0, 1800)),
      urlsAttempted,
      urlsSuccessful,
      urlsFailed: Math.max(0, urlsAttempted - urlsSuccessful),
      crawlersUsed,
      evidenceRejected: validation.rejected.length + (validation.accepted.length - reportable.length),
      urlLedger,
      cursor,
      ledgerVersion: 1,
      totalLedgerUrls: urlLedger.length,
      pendingUrls: urlLedger.filter(entry => entry.state === 'pending').length,
      expectedCapabilities: assessment.expectedCapabilities,
      completionState: assessment.state,
      completionReason: assessment.reason,
      capabilityOutcomes,
      sourcePreflightIssues,
    };

  return { outcome, evidence: acceptedEvidence, audit: retrieval.crawlerAudit };
}

function mergePantheonCategoryOutcomes(
  initialOutcomes: readonly PantheonCategoryOutcome[],
  executions: readonly PantheonCategoryExecution[],
): PantheonCategoryOutcome[] {
  const byIndex = new Map<number, PantheonCategoryOutcome>();
  for (const outcome of initialOutcomes) byIndex.set(outcome.index, outcome);
  for (const execution of executions) byIndex.set(execution.outcome.index, execution.outcome);
  return [...byIndex.values()].sort((left, right) => left.index - right.index);
}

function applyPantheonCategoryExecutions(
  report: PeopleSearchReport,
  executions: readonly PantheonCategoryExecution[],
  baseReport: PeopleSearchReport,
  initialOutcomes: readonly PantheonCategoryOutcome[] = [],
): void {
  const evidence = requireVerifiedPantheonEvidence(executions.flatMap(item => item.evidence));
  const audits = executions.flatMap(item => item.audit);
  const categoryOutcomes = mergePantheonCategoryOutcomes(initialOutcomes, executions);
  const uniqueEvidence = dedupePantheonEvidence(evidence);
  const webCategory = /social|username|photo|news|internet|media/i;
  const currentOnlineMentions = uniqueEvidence
    .filter(item => webCategory.test(String(item.metadata?.reportCategory || '')))
    .map(item => `[${String(item.metadata?.reportCategory || 'Evidence')}] ${item.content} — Source: ${item.sourceUrl}`);
  const currentPublicRecords = uniqueEvidence
    .filter(item => !webCategory.test(String(item.metadata?.reportCategory || '')))
    .map(item => `[${String(item.metadata?.reportCategory || 'Evidence')}] ${item.content} — Source: ${item.sourceUrl}`);
  report.onlineMentions = [...new Set([...(baseReport.onlineMentions || []), ...currentOnlineMentions])];
  report.publicRecords = [...new Set([...(baseReport.publicRecords || []), ...currentPublicRecords])];

  const sourceMap = new Map<string, any>();
  for (const source of baseReport.sources || []) {
    const data = source.data && typeof source.data === 'object' ? source.data as Record<string, unknown> : {};
    sourceMap.set(String(data.evidenceId || data.url || source.name || sourceMap.size), source);
  }
  for (const item of uniqueEvidence) {
    sourceMap.set(item.evidenceId, {
      name: `${String(item.metadata?.reportCategory || 'PANTHEON Evidence')} — ${item.crawler}`,
      data: {
        citationId: item.evidenceId,
        evidenceId: item.evidenceId,
        url: item.sourceUrl,
        contentHash: item.contentHash,
        provenance: item.provenance,
        finding: item.content,
      },
      confidence: item.confidence,
      timestamp: new Date(item.retrievedAt),
    });
  }
  report.sources = [...sourceMap.values()];
  report.crawlerAudit = mergeAudit([...(baseReport.crawlerAudit || []), ...audits]);
  const completedCategoryCount = categoryOutcomes.filter(item => item.completionState === 'completed').length;
  const completedWithEvidence = categoryOutcomes.filter(item => item.evidenceCount > 0).length;
  report.confidenceScore = PANTHEON_REPORT_CATEGORIES.length
    ? completedWithEvidence / PANTHEON_REPORT_CATEGORIES.length
    : 0;
  const unresolved = categoryOutcomes.filter(item => item.completionState !== 'completed');
  const missing = PANTHEON_REPORT_CATEGORIES
    .filter((_, index) => !categoryOutcomes.some(outcome => outcome.index === index))
    .map(category => ({
      category: category.label,
      state: 'pending',
      reason: 'Category has not completed persisted retrieval work.',
      pendingUrls: 0,
      missingCapabilities: getPantheonCategoryCapabilities(category.label),
    }));
  (report as any).coverageGaps = [
    ...unresolved.map(item => ({
      category: item.label,
      state: item.completionState,
      reason: item.completionReason,
      pendingUrls: item.pendingUrls,
      missingCapabilities: item.capabilityOutcomes
        .filter(capability => capability.applicable && !['completed_with_evidence', 'completed_no_evidence'].includes(capability.status))
        .map(capability => capability.capabilityId),
    })),
    ...missing,
  ];
  (report as any).reportCompleteness = unresolved.length === 0 && categoryOutcomes.length === PANTHEON_REPORT_CATEGORIES.length ? 'complete' : 'partial';
  report.summary = unresolved.length === 0 && categoryOutcomes.length === PANTHEON_REPORT_CATEGORIES.length
    ? `PANTHEON completed all ${PANTHEON_REPORT_CATEGORIES.length} categories with verified live-source work and required crawler coverage.`
    : `PANTHEON completed ${completedCategoryCount} of ${PANTHEON_REPORT_CATEGORIES.length} categories with verified live-source work; unresolved categories: ${[...unresolved.map(item => `${item.label} (${item.completionReason})`), ...missing.map(item => `${item.category} (${item.reason})`)].join('; ') || 'none'}.`;
}

export async function conductPantheonCategoryWorkflow(
  input: PantheonCategoryWorkflowInput,
): Promise<{ report: PeopleSearchReport; categoryOutcomes: PantheonCategoryOutcome[] }> {
  if (!input.investigationId) throw new Error('Pantheon canonical workflow requires investigationId');
  if (!input.onCategoryComplete) throw new Error('Pantheon category persistence callback is required');
  if (activeCanonicalInvestigation && activeCanonicalInvestigation !== input.investigationId) {
    throw new Error(`Pantheon canonical workflow already active for ${activeCanonicalInvestigation}`);
  }
  activeCanonicalInvestigation = input.investigationId;
  const deadline = createPantheonDeadline(input.deadlineAt, input.signal);
  try {
    const capabilityHealth = input.capabilityHealth || [];
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

    const baseReport: PeopleSearchReport = {
      ...report,
      onlineMentions: [...(report.onlineMentions || [])],
      publicRecords: [...(report.publicRecords || [])],
      sources: [...(report.sources || [])],
      crawlerAudit: [...(report.crawlerAudit || [])],
    };
    const initialCategoryOutcomes = [...(input.initialCategoryOutcomes || [])]
      .filter(outcome => Number.isInteger(outcome.index) && outcome.index >= 0 && outcome.index < PANTHEON_REPORT_CATEGORIES.length)
      .sort((left, right) => left.index - right.index);
    if (input.initialReport) {
      const persistedLabels = new Set(initialCategoryOutcomes.map(outcome => outcome.label));
      const belongsToPersistedCategory = (value: unknown) => {
        const text = String(value || '');
        return [...persistedLabels].some(label => text.startsWith(`[${label}]`) || text.startsWith(`${label} —`));
      };
      baseReport.onlineMentions = (baseReport.onlineMentions || []).filter(belongsToPersistedCategory);
      baseReport.publicRecords = (baseReport.publicRecords || []).filter(belongsToPersistedCategory);
      baseReport.sources = (baseReport.sources || []).filter(source => belongsToPersistedCategory(source.name));
      baseReport.crawlerAudit = mergeAudit(initialCategoryOutcomes.flatMap(outcome => outcome.crawlerAudit));
    }
    const startCategoryIndex = Math.max(0, Math.min(PANTHEON_REPORT_CATEGORIES.length - 1, input.startCategoryIndex || 0));
    const indexes = input.categoryIndexes
      ? [...new Set(input.categoryIndexes)]
        .filter(index => Number.isInteger(index) && index >= 0 && index < PANTHEON_REPORT_CATEGORIES.length)
        .sort((left, right) => left - right)
      : Array.from(
        { length: PANTHEON_REPORT_CATEGORIES.length - startCategoryIndex },
        (_, offset) => startCategoryIndex + offset,
      );
    const concurrency = Math.max(1, Math.min(4, input.categoryConcurrency || 4, indexes.length || 1));
    const remainingMs = Math.max(1, input.deadlineAt - Date.now());
    const finalizationReserveMs = Math.min(15_000, Math.max(2_000, Math.floor(remainingMs * 0.08)));
    const waveCount = Math.max(1, Math.ceil(indexes.length / concurrency));
    const categoryBudgetMs = Math.max(1_500, Math.floor(Math.max(1, remainingMs - finalizationReserveMs) / waveCount));
    const completed = new Map<number, PantheonCategoryExecution>();
    let persistenceTail: Promise<void> = Promise.resolve();

    const executions = await runPantheonBounded(indexes, concurrency, async index => {
      const execution = await executePantheonCategory({
        ...input,
        index,
        capabilityHealth,
        finalizationReserveMs,
        categoryDeadlineAt: Math.min(input.deadlineAt - finalizationReserveMs, Date.now() + categoryBudgetMs),
        productiveWorkTarget: categoryProductiveWorkTarget(input.searchDepth),
        policy: intensityPolicy(input.searchDepth),
        signal: deadline.signal,
        completedCount: () => initialCategoryOutcomes.filter(item => item.completionState === 'completed').length
          + [...completed.values()].filter(item => item.outcome.completionState === 'completed').length,
      });

      const persist = persistenceTail.then(async () => {
        completed.set(index, execution);
        const ordered = [...completed.values()].sort((left, right) => left.outcome.index - right.outcome.index);
        applyPantheonCategoryExecutions(report, ordered, baseReport, initialCategoryOutcomes);
        const completedCategories = mergePantheonCategoryOutcomes(initialCategoryOutcomes, ordered)
          .filter(item => item.completionState === 'completed').length;
        await input.onCategoryState?.({ index, label: execution.outcome.label, phase: 'PERSISTING', completedCategories });
        await input.onCategoryComplete!({
          index,
          label: execution.outcome.label,
          completedCategories,
          outcome: execution.outcome,
          partialReport: { ...report },
        });
        await input.onCategoryState?.({
          index,
          label: execution.outcome.label,
          phase: execution.outcome.completionState === 'completed' ? 'COMPLETE' : 'PARTIAL',
          completedCategories,
        });
      });
      persistenceTail = persist.catch(() => undefined);
      await persist;
      return execution;
    }, deadline.signal);

    await persistenceTail;
    const ordered = executions.sort((left, right) => left.outcome.index - right.outcome.index);
    applyPantheonCategoryExecutions(report, ordered, baseReport, initialCategoryOutcomes);
    return { report, categoryOutcomes: mergePantheonCategoryOutcomes(initialCategoryOutcomes, ordered) };
  } finally {
    deadline.dispose();
    if (activeCanonicalInvestigation === input.investigationId) activeCanonicalInvestigation = null;
  }
}
