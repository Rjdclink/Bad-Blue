import type { PeopleSearchReport } from '../../peopleSearch';
import {
  getPantheonCategoryCapabilities,
  getPantheonPrimaryCrawlerCapabilitiesForCategory,
  buildPantheonCapabilityWorkLedger,
  isPantheonExecutableWorkSchedulable,
  PANTHEON_CRAWLER_CAPABILITY_MATRIX,
  type PantheonCapabilityId,
  type PantheonExecutableWorkUnit,
  type PantheonReportCategoryLabel,
} from './PantheonCrawlerCapabilityMatrix';
import { createPantheonDeadline, throwIfPantheonAborted } from './PantheonDeadline';
import {
  PANTHEON_CATEGORY_CONCURRENCY_LIMIT,
  PANTHEON_URL_CONCURRENCY_PER_CATEGORY,
  runPantheonBounded,
  runPantheonUrlBounded,
} from './PantheonBoundedScheduler';
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

export type PantheonUrlState = 'pending'|'retryable'|'assigned'|'retrieving'|'retrieved'|'accepted'|'rejected'|'blocked'|'rate_limited'|'dead'|'timed_out'|'no_evidence'|'not_applicable';

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
  requiredWorkCount: number;
  successfulWorkCount: number;
  expectedCapabilities: string[];
  completionState: PantheonCategoryCompletionState;
  completionReason: string;
  capabilityOutcomes: PantheonCapabilityOutcome[];
  capabilityWorkLedger: PantheonExecutableWorkUnit[];
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
  const concurrency = Math.max(1, Math.min(PANTHEON_CATEGORY_CONCURRENCY_LIMIT, input.concurrency || PANTHEON_CATEGORY_CONCURRENCY_LIMIT));
  const waveCount = Math.ceil(PANTHEON_REPORT_CATEGORIES.length / concurrency);
  const finalizationReserveMs = Math.min(15_000, Math.max(2_000, Math.floor(input.budgetMs * 0.08)));
  const protectedBudgetMs = Math.max(1_500, Math.floor((input.budgetMs - finalizationReserveMs) / waveCount));
  // Keep a persisted substitution pool so blocked, dead, and rate-limited
  // sources do not silently reduce the selected productive-work depth.
  const urlLimit = Math.min(300, categoryProductiveWorkTarget(input.searchDepth) * 2);

  return PANTHEON_REPORT_CATEGORIES.map((category, index) => {
    const preflightGroups = category.registry.map(registryCategory => preflightPantheonSourceTargets(
      buildPantheonCategoryTargets(registryCategory, input.name, input.location, 300),
      registryCategory,
      input.name,
      input.location,
    ));
    const plannedUrls = interleaveCategoryTargets(
      preflightGroups.map(group => group.targets),
      urlLimit,
    );
    const targetByUrl = new Map(preflightGroups
      .flatMap(group => group.targets)
      .map(target => [target.url, target]));
    const plannedTargets = plannedUrls.flatMap(url => {
      const target = targetByUrl.get(url);
      return target ? [target] : [];
    });
    return {
      index,
      label: category.label,
      state: 'pending',
      phase: 'PENDING',
      protectedBudgetMs,
      sourcePlan: {
        registryCategories: category.registry,
        capabilities: getPantheonCategoryCapabilities(category.label),
        transports: [...new Set(plannedTargets.map(target => target.transport))],
        urls: plannedUrls,
        preflightIssues: preflightGroups.flatMap(group => group.issues),
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

export function categoryProductiveWorkTarget(depth: number): number {
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

export function sourcePriority(authority: 'primary'|'secondary'|'discovery'|'archive'): number {
  // Direct authorities are attempted before secondary/archive sources.
  // Discovery remains executable and may append separately admitted result
  // candidates, but a search navigation URL never outranks a direct source.
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

function admittedDiscoveryCandidate(raw: unknown): ReturnType<typeof admitPantheonUrl> {
  const value = String(raw || '').trim();
  let candidate = value;
  try {
    const parsed = new URL(value);
    if (/(?:^|\.)(?:google\.com|bing\.com|search\.brave\.com)$/i.test(parsed.hostname)) {
      const embedded = ['url', 'q', 'target'].map(key => parsed.searchParams.get(key)).find(item => /^https?:\/\//i.test(String(item || '')));
      if (!embedded) return { ok: false, reason: 'Search-provider navigation URL is not an attributable source result' };
      candidate = String(embedded);
    }
  } catch {
    return { ok: false, reason: 'Discovered candidate is not an absolute public URL' };
  }
  return admitPantheonUrl(candidate);
}

function buildCategoryLedger(
  categoryLabel: string,
  primaryCapabilities: string[],
  requiredCapabilities: string[],
  groups: Array<{ registryCategory: PantheonBackgroundCategory; targets: ReturnType<typeof buildPantheonCategoryTargets> }>,
): PantheonUrlLedgerEntry[] {
  const seen = new Set<string>();
  const ledger: PantheonUrlLedgerEntry[] = [];
  let assignmentIndex = 0;
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
          const assignedCapability = primaryCapabilities.length
            ? primaryCapabilities[assignmentIndex++ % primaryCapabilities.length]
            : routed.capability;
          return {
            capability: assignedCapability,
            capabilityReason: assignedCapability === routed.capability
              ? routed.reason
              : `coverage assignment for required ${assignedCapability} capability`,
            requiredCapabilities: [assignedCapability],
          };
        })(),
        transport: selectedTransport,
      });
    }
  }
  const sorted = ledger.sort((a, b) => b.priority - a.priority || a.url.localeCompare(b.url));
  if (sorted.length) {
    requiredCapabilities.forEach((capabilityId, index) => {
      const entry = sorted[index % sorted.length];
      entry.requiredCapabilities = [...new Set([...(entry.requiredCapabilities || []), capabilityId])];
    });
  }
  return sorted;
}

function interleaveCategoryTargets(
  groups: Array<ReturnType<typeof buildPantheonCategoryTargets>>,
  limit: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const authorityOrder: PantheonSourceTarget['authority'][] = ['primary', 'secondary', 'archive', 'discovery'];
  for (const authority of authorityOrder) {
    const authorityGroups = groups.map(group => group.filter(candidate => candidate.authority === authority));
    for (let row = 0; out.length < limit; row += 1) {
      let added = false;
      for (const group of authorityGroups) {
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
  }
  return out;
}

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
  initialCategoryStates?: readonly PantheonPersistedCategoryState[];
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

const PANTHEON_CAPABILITY_MAX_ATTEMPTS = 2;

function capabilityWorkForSource(
  workLedger: PantheonExecutableWorkUnit[],
  sourceUrl: string,
): PantheonExecutableWorkUnit[] {
  return workLedger.filter(unit =>
    unit.sourceUrl === sourceUrl && isPantheonExecutableWorkSchedulable(unit)
  );
}

function settleCapabilityWorkForSource(
  workLedger: PantheonExecutableWorkUnit[],
  sourceUrl: string,
  crawlerAudit: PantheonRetrievalResponse['crawlerAudit'],
  forcedError?: string,
): void {
  const canonicalSource = canonicalPantheonEvidenceUrl(sourceUrl);
  for (const unit of workLedger.filter(candidate =>
    candidate.sourceUrl === sourceUrl && candidate.state === 'running'
  )) {
    const matching = crawlerAudit.filter(audit => {
      if (audit.crawler !== unit.capabilityId) return false;
      if (!(audit.sourceOutcomes || []).length) return Number(audit.targets || 0) > 0;
      return (audit.sourceOutcomes || []).some(outcome =>
        canonicalPantheonEvidenceUrl(outcome.sourceUrl) === canonicalSource
      );
    });
    const completedWithEvidence = matching.some(audit => audit.status === 'completed_with_evidence');
    const completedNoEvidence = matching.some(audit => audit.status === 'completed_no_evidence');
    const timedOut = matching.some(audit => audit.status === 'timed_out');
    const matchingError = matching.find(audit => audit.error)?.error;

    if (completedWithEvidence || completedNoEvidence) {
      unit.state = 'completed';
      unit.outcome = completedWithEvidence ? 'completed_with_evidence' : 'completed_no_evidence';
      unit.reason = undefined;
    } else if (timedOut || /timeout|deadline|abort/i.test(forcedError || '')) {
      unit.state = 'timed_out';
      unit.outcome = 'timed_out';
      unit.reason = matchingError || forcedError || 'Capability execution timed out';
    } else {
      unit.state = 'failed';
      unit.outcome = 'failed';
      unit.reason = matchingError || forcedError || 'Capability returned no attributable execution outcome';
    }
  }
}

function reassignRetryableCapabilityWork(
  workLedger: PantheonExecutableWorkUnit[],
  urlLedger: PantheonUrlLedgerEntry[],
): void {
  const candidates = urlLedger
    .filter(entry => entry.state === 'pending' || entry.state === 'retryable')
    .sort((left, right) => right.priority - left.priority || left.url.localeCompare(right.url));
  for (const unit of workLedger) {
    if (!['failed', 'timed_out'].includes(unit.state) || unit.attempts >= PANTHEON_CAPABILITY_MAX_ATTEMPTS) continue;
    const descriptor = PANTHEON_CRAWLER_CAPABILITY_MATRIX[unit.capabilityId];
    const candidate = candidates.find(entry =>
      descriptor.transports.includes(entry.transport || 'direct-http')
      && !unit.attemptedSourceUrls.includes(entry.url)
    );
    if (!candidate) continue;
    unit.sourceUrl = candidate.url;
    unit.transport = candidate.transport || 'direct-http';
    unit.state = 'retryable';
    unit.reason = `Route-local retry assigned after ${unit.outcome || 'failed'} outcome`;
    candidate.requiredCapabilities = [...new Set([
      ...(candidate.requiredCapabilities || []),
      unit.capabilityId,
    ])];
    if (descriptor.capabilityClass === 'primary-retrieval') {
      candidate.capability = unit.capabilityId;
      candidate.capabilityReason = `coverage retry for required ${unit.capabilityId} capability`;
    }
  }
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
    const expectedCapabilities = getPantheonCategoryCapabilities(category.label);
    const executableCapabilities = capabilityRoute.selected;
    const healthByCapability = new Map(input.capabilityHealth.map(item => [item.capabilityId, item.status]));
    const runnableCapabilities = expectedCapabilities.filter(capability =>
      healthByCapability.get(capability) !== 'unavailable'
    );

    const preflightGroups = category.registry.map(registryCategory => {
      const preflight = preflightPantheonSourceTargets(
        buildPantheonCategoryTargets(registryCategory, input.name, input.location, 300),
        registryCategory,
        input.name,
        input.location,
      );
      return { registryCategory, ...preflight };
    });
    const initialState = input.initialCategoryStates?.find(state => state.index === index);
    const initialOutcome = initialState?.outcome;
    const sourcePreflightIssues = initialState?.sourcePlan.preflightIssues?.length
      ? [...initialState.sourcePlan.preflightIssues]
      : preflightGroups.flatMap(group => group.issues);
    const ledgerGroups = preflightGroups.map(group => ({
      registryCategory: group.registryCategory,
      targets: group.targets,
    }));
    const freshLedger = buildCategoryLedger(
      category.label,
      executableCapabilities,
      runnableCapabilities,
      ledgerGroups,
    );
    const targetGroups = ledgerGroups.map(group => group.targets);
    // Interleave registry facets so a multi-facet category cannot be monopolized
    // by the first tag. Direct authorities run first; discovery URLs may append
    // separately admitted result candidates to the controller-owned ledger.
    // The 10/20/30-minute intensity levels expand productive URL work depth.
    const freshPrioritizedTargets = interleaveCategoryTargets(
      targetGroups,
      input.productiveWorkTarget,
    );
    const plannedUrls = initialState?.sourcePlan.urls?.length
      ? initialState.sourcePlan.urls
      : freshPrioritizedTargets;
    const selectedFreshUrls = new Set(plannedUrls);
    const plannedUrlOrder = new Map(plannedUrls.map((url, position) => [url, position]));
    const urlLedger = initialOutcome?.urlLedger?.length
      ? initialOutcome.urlLedger.map(entry => ({
          ...entry,
          evidenceIds: [...(entry.evidenceIds || [])],
          requiredCapabilities: [...(entry.requiredCapabilities || (entry.capability ? [entry.capability] : []))],
          transportAttempts: [...(entry.transportAttempts || [])],
          ...(['assigned', 'retrieving', 'rate_limited', 'timed_out'].includes(entry.state)
            ? { state: 'retryable' as const, failureReason: undefined, startedAt: undefined, completedAt: undefined }
            : {}),
        }))
      : freshLedger
        .filter(entry => selectedFreshUrls.has(entry.url))
        .sort((left, right) =>
          Number(plannedUrlOrder.get(left.url) ?? Number.MAX_SAFE_INTEGER)
            - Number(plannedUrlOrder.get(right.url) ?? Number.MAX_SAFE_INTEGER));
    const schedulableEntries = urlLedger.filter(entry =>
      entry.state === 'pending' || entry.state === 'retryable'
    );
    const unavailableReasons = Object.fromEntries(input.capabilityHealth
      .filter(health => health.status === 'unavailable')
      .map(health => [health.capabilityId, health.reason])) as Partial<Record<PantheonCapabilityId, string>>;
    const capabilityWorkLedger = buildPantheonCapabilityWorkLedger({
      investigationId: input.investigationId,
      categoryLabel: category.label,
      sources: schedulableEntries.map(entry => ({
        sourceUrl: entry.url,
        transport: entry.transport || 'direct-http',
      })),
      unavailableReasons,
      previous: initialOutcome?.capabilityWorkLedger,
    });
    for (const entry of schedulableEntries) {
      const assignedWork = capabilityWorkLedger.filter(unit =>
        unit.sourceUrl === entry.url && isPantheonExecutableWorkSchedulable(unit)
      );
      entry.requiredCapabilities = [...new Set([
        ...(assignedWork.map(unit => unit.capabilityId)),
        ...(entry.capability ? [entry.capability] : []),
      ])];
      const assignedPrimary = assignedWork.find(unit =>
        PANTHEON_CRAWLER_CAPABILITY_MATRIX[unit.capabilityId].capabilityClass === 'primary-retrieval'
      );
      if (assignedPrimary) {
        entry.capability = assignedPrimary.capabilityId;
        entry.capabilityReason = `executable work ledger assignment for ${assignedPrimary.capabilityId}`;
      }
    }
    const prioritizedTargets = urlLedger
      .filter(entry => entry.state === 'pending' || entry.state === 'retryable')
      .sort((left, right) => left.priority === right.priority
        ? left.url.localeCompare(right.url)
        : right.priority - left.priority)
      .map(entry => entry.url);
    const activeUrls = new Set<string>(urlLedger.filter(entry => Number(entry.attempts || 0) > 0).map(entry => entry.url));
    const attemptedThisRun = new Set<string>();
    const retrievalEvidence: PantheonRetrievalResponse['evidence'] = [];
    const retrievalAudit: PantheonRetrievalResponse['crawlerAudit'] = initialOutcome?.crawlerAudit
      ? [...initialOutcome.crawlerAudit]
      : [];
    let cursor = 0;
    await input.onCategoryState?.({ index, label: category.label, phase: 'URL_WORK', completedCategories: completedBeforeCategory });

    const requiredWorkCount = Math.min(input.productiveWorkTarget, urlLedger.length);
    let productiveWorkUnits = urlLedger.filter(entry => ['accepted', 'no_evidence'].includes(entry.state)).length;
    const completedCapabilities = () => new Set(capabilityWorkLedger
      .filter(unit => unit.state === 'completed')
      .map(unit => unit.capabilityId));
    const hasExecutableCapabilityCoverage = () => runnableCapabilities.every(capability =>
      completedCapabilities().has(capability)
    );
    const hasSchedulableCapabilityWork = () => capabilityWorkLedger.some(isPantheonExecutableWorkSchedulable);
    while (cursor < prioritizedTargets.length
      && (productiveWorkUnits < requiredWorkCount
        || (!hasExecutableCapabilityCoverage() && hasSchedulableCapabilityWork()))) {
      throwIfPantheonAborted(input.signal);
      const remainingForWork = categoryDeadlineAt - Date.now();
      if (remainingForWork <= 750) break;

      const remainingProductiveWork = Math.max(0, requiredWorkCount - productiveWorkUnits);
      const waveSize = Math.min(
        PANTHEON_URL_CONCURRENCY_PER_CATEGORY,
        prioritizedTargets.length - cursor,
        Math.max(1, remainingProductiveWork || PANTHEON_URL_CONCURRENCY_PER_CATEGORY),
      );
      for (let slot = 0; slot < waveSize; slot += 1) {
        const position = cursor + slot;
        const missingWorkOffset = prioritizedTargets.slice(position).findIndex(url =>
          capabilityWorkForSource(capabilityWorkLedger, url).length > 0
        );
        if (missingWorkOffset > 0) {
          const missingWorkIndex = position + missingWorkOffset;
          [prioritizedTargets[position], prioritizedTargets[missingWorkIndex]] = [
            prioritizedTargets[missingWorkIndex],
            prioritizedTargets[position],
          ];
        }
      }

      const waveStart = cursor;
      const waveUrls = prioritizedTargets.slice(cursor, cursor + waveSize);
      cursor += waveUrls.length;
      const workByUrl = new Map<string, {
        entry?: PantheonUrlLedgerEntry;
        assignedCapabilityWork: PantheonExecutableWorkUnit[];
        authorityCapability: string;
      }>();
      for (const url of waveUrls) {
        const entry = urlLedger.find(item => item.url === url);
        const assignedCapabilityWork = capabilityWorkForSource(capabilityWorkLedger, url);
        const assignedPrimaryWork = assignedCapabilityWork.find(unit =>
          PANTHEON_CRAWLER_CAPABILITY_MATRIX[unit.capabilityId].capabilityClass === 'primary-retrieval'
        );
        const authorityCapability = assignedPrimaryWork?.capabilityId
          || (entry?.capability && PANTHEON_CRAWLER_CAPABILITY_MATRIX[entry.capability as PantheonCapabilityId]?.capabilityClass === 'primary-retrieval'
            ? entry.capability
            : executableCapabilities[0])
          || 'startrek';
        if (entry) {
          entry.capability = authorityCapability;
          entry.requiredCapabilities = [...new Set([
            authorityCapability,
            ...assignedCapabilityWork.map(unit => unit.capabilityId),
          ])];
        }
        for (const unit of assignedCapabilityWork) {
          unit.state = 'running';
          unit.attempts += 1;
          unit.attemptedSourceUrls = [...new Set([...unit.attemptedSourceUrls, url])];
        }
        activeUrls.add(url);
        attemptedThisRun.add(url);
        if (entry) {
          entry.state = 'assigned';
          entry.attempts += 1;
          entry.startedAt = new Date().toISOString();
          entry.transportAttempts = [...(entry.transportAttempts || []), { transport: entry.transport || 'direct-http', outcome: 'pending' }];
        }
        workByUrl.set(url, { entry, assignedCapabilityWork, authorityCapability });
      }

      const waveResults = await runPantheonUrlBounded(waveUrls, async (url, waveIndex) => {
        const work = workByUrl.get(url)!;
        const requestDeadlineAt = Math.min(
          input.deadlineAt - finalizationReserveMs,
          Date.now() + Math.min(18_000, Math.max(750, categoryDeadlineAt - Date.now())),
        );
        try {
          const retrieval = await pantheonRetrievalAdapter.retrieve({
            purpose: 'background_report',
            targets: [url],
            depth: input.searchDepth,
            budgetMs: Math.max(750, Math.min(18_000, categoryDeadlineAt - Date.now())),
            deadlineAt: requestDeadlineAt,
            subject: input.name,
            location: input.location,
            categoryLabel: category.label,
            capabilityHint: work.entry?.requiredCapabilities?.length
              ? work.entry.requiredCapabilities
              : work.entry?.capability ? [work.entry.capability] : [],
            transportHint: work.entry?.transport ? [work.entry.transport] : [],
            signal: input.signal,
            authority: {
              investigationId: input.investigationId,
              categoryId: `${input.investigationId}:${index}`,
              categoryIndex: index,
              categoryLabel: category.label,
              workId: `${input.investigationId}:${index}:${waveStart + waveIndex}`,
              canonicalUrl: url,
              capability: work.authorityCapability,
              deadlineAt: requestDeadlineAt,
              subject: input.name,
              location: input.location,
            },
          });
          return { url, retrieval };
        } catch (error) {
          return { url, error: error instanceof Error ? error.message : String(error) };
        }
      });

      for (const waveResult of waveResults) {
        const sourceUrl = waveResult.url;
        const work = workByUrl.get(sourceUrl)!;
        if ('retrieval' in waveResult) {
          const batchRetrieval = waveResult.retrieval;
          retrievalEvidence.push(...batchRetrieval.evidence);
          retrievalAudit.push(...batchRetrieval.crawlerAudit);
          settleCapabilityWorkForSource(
            capabilityWorkLedger,
            sourceUrl,
            batchRetrieval.crawlerAudit,
          );
          const provisionalValidation = processPantheonEvidence(batchRetrieval.evidence, input.name, input.location);
        const provisionalReportable = provisionalValidation.accepted.filter(item =>
          PANTHEON_CRAWLER_CAPABILITY_MATRIX[item.capabilityId as PantheonCapabilityId]?.reportEvidenceEligible === true
        );
        const rawReportEligible = batchRetrieval.evidence.filter(item =>
          PANTHEON_CRAWLER_CAPABILITY_MATRIX[item.capabilityId as PantheonCapabilityId]?.reportEvidenceEligible === true
        );
          const canonicalSourceUrl = canonicalPantheonEvidenceUrl(sourceUrl);
        const acceptedLiveWork = provisionalReportable.some(item =>
            canonicalPantheonEvidenceUrl(item.sourceUrl) === canonicalSourceUrl
        );
          const cleanPrimaryOutcome = batchRetrieval.crawlerAudit.some(item =>
          item.capabilityClass === 'primary'
          && Number(item.attempts || 0) > 0
          && Number(item.targets || 0) > 0
            && ['completed_with_evidence', 'completed_no_evidence'].includes(item.status)
        );
          const reportEligibleForSource = rawReportEligible.filter(item =>
            canonicalPantheonEvidenceUrl(item.sourceUrl) === canonicalSourceUrl
          );
          const rejectedForSource = provisionalValidation.rejected.filter(item =>
            canonicalPantheonEvidenceUrl(item.evidence.sourceUrl) === canonicalSourceUrl
              && PANTHEON_CRAWLER_CAPABILITY_MATRIX[item.evidence.capabilityId as PantheonCapabilityId]?.reportEvidenceEligible === true
          );
          const cleanSubjectMiss = cleanPrimaryOutcome
            && reportEligibleForSource.length > 0
            && rejectedForSource.length === reportEligibleForSource.length
            && rejectedForSource.every(item => item.reason === 'subject_mismatch');
          const explicitCleanNoEvidence = reportEligibleForSource.length === 0
            && batchRetrieval.crawlerAudit.some(item =>
              item.capabilityClass === 'primary' && item.status === 'completed_no_evidence'
            );
          const completedNoEvidence = cleanPrimaryOutcome
            && (explicitCleanNoEvidence || cleanSubjectMiss);
        // Rejected/challenge/discovery-only material is not productive work.
        // The quota advances only for evidence that already passes the subject
        // and production gates, or a clean attributable no-evidence outcome.
        if (acceptedLiveWork || completedNoEvidence) productiveWorkUnits += 1;

        // Crawler-discovered URLs are non-executable candidates. The controller
        // alone may admit them to this category's ledger and priority queue.
        for (const item of batchRetrieval.evidence) {
          const candidates = Array.isArray(item.metadata?.discoveredCandidates)
            ? item.metadata.discoveredCandidates as unknown[]
            : [];
          for (const rawCandidate of candidates) {
            const admission = admittedDiscoveryCandidate(rawCandidate);
            if (!admission.ok || urlLedger.some(entry => entry.url === admission.url)) continue;
            const parent = urlLedger.find(entry => entry.url === canonicalPantheonEvidenceUrl(item.target));
            const candidate: PantheonUrlLedgerEntry = {
              url: admission.url,
              priority: sourcePriority('secondary'),
              authority: 'secondary',
              registryCategory: parent?.registryCategory || category.registry[0],
              workType: 'candidate-validation',
              state: 'pending',
              attempts: 0,
              evidenceIds: [],
            };
            const routedCandidate = capabilityFor(category.label, candidate);
            candidate.capability = routedCandidate.capability;
            candidate.capabilityReason = routedCandidate.reason;
            candidate.requiredCapabilities = [candidate.capability];
            candidate.transport = transportFor(candidate);
            urlLedger.push(candidate);
            prioritizedTargets.push(candidate.url);
          }
        }
        } else {
        const message = waveResult.error;
        const failureStatus = /timeout|deadline|abort/i.test(message) ? 'timed_out' as const : 'failed' as const;
        const failedAt = new Date().toISOString();
          const attributableFailures: PantheonRetrievalResponse['crawlerAudit'] = work.assignedCapabilityWork.map(unit => ({
          crawler: unit.capabilityId,
          capabilityClass: PANTHEON_CRAWLER_CAPABILITY_MATRIX[unit.capabilityId].capabilityClass === 'primary-retrieval'
            ? 'primary' as const
            : unit.capabilityId.startsWith('razor:')
              ? 'razor' as const
              : 'pantheon-secondary' as const,
          status: failureStatus,
          evidenceCount: 0,
          attempts: 1,
          targets: 1,
          error: message.slice(0, 300),
          durationMs: 0,
          sourceOutcomes: [{
              sourceUrl,
            status: failureStatus,
            retrievedAt: failedAt,
            durationMs: 0,
            error: message.slice(0, 300),
          }],
        }));
        retrievalAudit.push(...attributableFailures);
          settleCapabilityWorkForSource(capabilityWorkLedger, sourceUrl, attributableFailures, message);
          const failedEntry = work.entry;
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
            targets: 1,
          error: message,
        });
        }
      }
      reassignRetryableCapabilityWork(capabilityWorkLedger, urlLedger);
      const attemptedPrefix = prioritizedTargets.slice(0, cursor);
      const remainingTargets = prioritizedTargets.slice(cursor).sort((leftUrl, rightUrl) => {
        const left = urlLedger.find(entry => entry.url === leftUrl);
        const right = urlLedger.find(entry => entry.url === rightUrl);
        return Number(right?.priority || 0) - Number(left?.priority || 0)
          || leftUrl.localeCompare(rightUrl);
      });
      prioritizedTargets.splice(0, prioritizedTargets.length, ...attemptedPrefix, ...remainingTargets);
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

    const crawlersUsed = [...new Set([
      ...(initialOutcome?.crawlersUsed || []),
      ...reportable.map(item => item.crawler).filter(Boolean),
    ])];
    const evidenceByUrl = new Map<string, string[]>();
    for (const item of reportable) {
      const sourceUrl = canonicalPantheonEvidenceUrl(item.sourceUrl);
      evidenceByUrl.set(sourceUrl, [...new Set([...(evidenceByUrl.get(sourceUrl) || []), item.evidenceId])]);
    }
    const rejectionsByUrl = new Map<string, typeof validation.rejected>();
    for (const rejected of validation.rejected) {
      const sourceUrl = canonicalPantheonEvidenceUrl(rejected.evidence.sourceUrl);
      rejectionsByUrl.set(sourceUrl, [...(rejectionsByUrl.get(sourceUrl) || []), rejected]);
    }
    for (const entry of urlLedger) {
      if (!attemptedThisRun.has(entry.url)) continue;
      const evidenceIds = evidenceByUrl.get(entry.url) || [];
      entry.completedAt = new Date().toISOString();
      const matchingEvidence = reportable.find(item => canonicalPantheonEvidenceUrl(item.target) === entry.url);
      const matchingAudits = retrieval.crawlerAudit.filter(item =>
        (item.sourceOutcomes || []).some(outcome => canonicalPantheonEvidenceUrl(outcome.sourceUrl) === entry.url)
      );
      const matchingAudit = matchingAudits.find(item => Number(item.targets || 0) > 0);
      const auditFailures = matchingAudits.filter(item => item.status === 'failed' || item.status === 'timed_out');
      const liveWorkSucceeded = matchingAudits.some(item =>
        item.capabilityClass === 'primary'
          && ['completed_with_evidence', 'completed_no_evidence'].includes(item.status)
      );
      entry.result = {
        status: liveWorkSucceeded ? 200 : 0,
        evidenceCount: evidenceIds.length,
        crawler: matchingEvidence?.crawler || matchingAudit?.crawler,
        retrievedAt: matchingEvidence?.retrievedAt || entry.completedAt,
      };
      if (evidenceIds.length > 0) {
        entry.state = 'accepted';
        entry.evidenceIds = [...new Set([...entry.evidenceIds, ...evidenceIds])];
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
      } else if (liveWorkSucceeded
        && (rejectionsByUrl.get(entry.url) || []).length > 0
        && (rejectionsByUrl.get(entry.url) || []).every(item => item.reason === 'subject_mismatch')) {
        entry.state = 'no_evidence';
        entry.failureReason = 'Live source completed cleanly and contained no evidence attributable to the subject.';
      } else if ((rejectionsByUrl.get(entry.url) || []).length > 0) {
        entry.state = 'rejected';
        entry.failureReason = 'Retrieved material did not pass evidence and subject-resolution gates.';
      } else if (liveWorkSucceeded) {
        entry.state = 'no_evidence';
      } else {
        entry.state = 'dead';
        entry.failureReason = 'No attributable primary retrieval outcome was recorded.';
      }
    }
    const successfulWorkCount = urlLedger.filter(entry => ['accepted', 'no_evidence'].includes(entry.state)).length;
    const urlsAttempted = urlLedger.filter(entry => Number(entry.attempts || 0) > 0).length;
    const urlsSuccessful = successfulWorkCount;
    const capabilityOutcomes = finalizePantheonCategoryCapabilityOutcomes({
      categoryLabel: category.label,
      health: input.capabilityHealth,
      crawlerAudit: retrieval.crawlerAudit,
      workLedger: capabilityWorkLedger,
    });
    const assessment = assessPantheonCategoryOutcome({
      label: category.label,
      targetCount: activeUrls.size,
      expectedCapabilities,
      crawlerAudit: retrieval.crawlerAudit,
      urlLedger,
      requiredWorkCount,
      successfulWorkCount: urlsSuccessful,
    });
    const outcome: PantheonCategoryOutcome = {
      index,
      label: category.label,
      startedAt,
      completedAt: new Date().toISOString(),
      targetCount: activeUrls.size,
      evidenceCount: Number(initialOutcome?.evidenceCount || 0) + reportable.length,
      crawlerAudit: retrieval.crawlerAudit,
      findings: [...new Set([
        ...(initialOutcome?.findings || []),
        ...reportable.map(item => cleanPantheonEvidenceContent(item.content).slice(0, 1800)),
      ])],
      urlsAttempted,
      urlsSuccessful,
      urlsFailed: Math.max(0, urlsAttempted - urlsSuccessful),
      crawlersUsed,
      evidenceRejected: Number(initialOutcome?.evidenceRejected || 0)
        + validation.rejected.length
        + (validation.accepted.length - reportable.length),
      urlLedger,
      cursor,
      ledgerVersion: 1,
      totalLedgerUrls: urlLedger.length,
      pendingUrls: urlLedger.filter(entry => entry.state === 'pending' || entry.state === 'retryable').length,
      requiredWorkCount,
      successfulWorkCount: urlsSuccessful,
      expectedCapabilities: assessment.expectedCapabilities,
      completionState: assessment.state,
      completionReason: assessment.reason,
      capabilityOutcomes,
      capabilityWorkLedger,
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
  report.identitySummary = {
    ...(report.identitySummary || { name: '' }),
    verificationStatus: uniqueEvidence.length > 0
      ? 'Verified live-source evidence accepted subject to cited confidence and coverage gaps'
      : 'No live-source evidence passed subject-resolution and evidence gates',
  };
  const webCategory = /social|username|photo|news|internet|media/i;
  const formatFinding = (item: typeof uniqueEvidence[number]) => {
    const citationId = String(item.metadata?.citationId || item.evidenceId);
    const claim = item.metadata?.categoryClaim as { claimType?: string; claimValue?: string } | undefined;
    const finding = claim?.claimType && claim.claimType !== 'source_mention' && claim.claimValue
      ? `${claim.claimType.replace(/_/g, ' ')}: ${claim.claimValue}`
      : item.content;
    return `[${String(item.metadata?.reportCategory || 'Evidence')}] ${finding} [${citationId}] — Source: ${item.sourceUrl}`;
  };
  const currentOnlineMentions = uniqueEvidence
    .filter(item => webCategory.test(String(item.metadata?.reportCategory || '')))
    .map(formatFinding);
  const currentPublicRecords = uniqueEvidence
    .filter(item => !webCategory.test(String(item.metadata?.reportCategory || '')))
    .map(formatFinding);
  report.onlineMentions = [...new Set([...(baseReport.onlineMentions || []), ...currentOnlineMentions])];
  report.publicRecords = [...new Set([...(baseReport.publicRecords || []), ...currentPublicRecords])];

  const findingsFor = (pattern: RegExp) => uniqueEvidence
    .filter(item => pattern.test(String(item.metadata?.reportCategory || '')))
    .map(formatFinding);
  report.contactInformation = [...new Set([
    ...(baseReport.contactInformation || []),
    ...findingsFor(/phone|email/i),
  ])];
  report.locationHistory = [...new Set([
    ...(baseReport.locationHistory || []),
    ...findingsFor(/address|property|real estate/i),
  ])];
  report.socialMediaPresence = [...new Set([
    ...(baseReport.socialMediaPresence || []),
    ...findingsFor(/social|username|online accounts|photos/i),
  ])];
  report.employmentAndEducation = [...new Set([
    ...(baseReport.employmentAndEducation || []),
    ...findingsFor(/employment|education|license|credential|business ownership/i),
  ])];
  report.riskAndReputation = [...new Set([
    ...(baseReport.riskAndReputation || []),
    ...findingsFor(/criminal|arrest|warrant|offender|court|litigation|judgment|bankrupt|lien|news|media/i),
  ])];

  const sourceMap = new Map<string, any>();
  for (const source of baseReport.sources || []) {
    const data = source.data && typeof source.data === 'object' ? source.data as Record<string, unknown> : {};
    sourceMap.set(String(data.evidenceId || data.url || source.name || sourceMap.size), source);
  }
  for (const item of uniqueEvidence) {
    const citationId = String(item.metadata?.citationId || item.evidenceId);
    sourceMap.set(citationId, {
      name: `${String(item.metadata?.reportCategory || 'PANTHEON Evidence')} — ${item.crawler}`,
      data: {
        citationId,
        evidenceId: item.evidenceId,
        url: item.sourceUrl,
        contentHash: item.contentHash,
        provenance: item.provenance,
        finding: item.content,
        categoryClaim: item.metadata?.categoryClaim,
        evidenceRank: item.metadata?.evidenceRank,
      },
      confidence: item.confidence,
      timestamp: new Date(item.retrievedAt),
    });
  }
  report.sources = [...sourceMap.values()];
  report.crawlerAudit = mergeAudit([
    ...((baseReport.crawlerAudit || []) as PantheonRetrievalResponse['crawlerAudit']),
    ...audits,
  ]);
  const completedCategoryCount = categoryOutcomes.filter(item => item.completionState === 'completed').length;
  const coverageRatio = PANTHEON_REPORT_CATEGORIES.length
    ? completedCategoryCount / PANTHEON_REPORT_CATEGORIES.length
    : 0;
  const evidenceQuality = uniqueEvidence.length
    ? uniqueEvidence.reduce((sum, item) => sum + Math.max(0, Math.min(1, item.confidence)), 0) / uniqueEvidence.length
    : 0;
  report.confidenceScore = Math.max(0, Math.min(1, coverageRatio * evidenceQuality));
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
  (report as any).categoryOutcomes = categoryOutcomes;
  report.summary = unresolved.length === 0 && categoryOutcomes.length === PANTHEON_REPORT_CATEGORIES.length
    ? `PANTHEON completed all ${PANTHEON_REPORT_CATEGORIES.length} categories with verified live-source work and required crawler coverage.`
    : `PANTHEON completed ${completedCategoryCount} of ${PANTHEON_REPORT_CATEGORIES.length} categories with verified live-source work; unresolved categories: ${[...unresolved.map(item => `${item.label} (${item.completionReason})`), ...missing.map(item => `${item.category} (${item.reason})`)].join('; ') || 'none'}.`;
}

export async function conductPantheonCategoryWorkflow(
  input: PantheonCategoryWorkflowInput,
): Promise<{ report: PeopleSearchReport; categoryOutcomes: PantheonCategoryOutcome[] }> {
  if (!input.investigationId) throw new Error('Pantheon canonical workflow requires investigationId');
  if (!input.onCategoryComplete) throw new Error('Pantheon category persistence callback is required');
  const deadline = createPantheonDeadline(input.deadlineAt, input.signal);
  try {
    const capabilityHealth = input.capabilityHealth || [];
    const report: PeopleSearchReport = input.initialReport ? { ...input.initialReport } : {
      identitySummary: { name: input.name, verificationStatus: 'Pending verified live-source evidence review' },
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
    const concurrency = Math.max(1, Math.min(
      PANTHEON_CATEGORY_CONCURRENCY_LIMIT,
      input.categoryConcurrency || PANTHEON_CATEGORY_CONCURRENCY_LIMIT,
      indexes.length || 1,
    ));
    const remainingMs = Math.max(1, input.deadlineAt - Date.now());
    const finalizationReserveMs = Math.min(15_000, Math.max(2_000, Math.floor(remainingMs * 0.08)));
    const waveCount = Math.max(1, Math.ceil(indexes.length / concurrency));
    const categoryBudgetMs = Math.max(1_500, Math.floor(Math.max(1, remainingMs - finalizationReserveMs) / waveCount));
    const completed = new Map<number, PantheonCategoryExecution>();
    let persistenceTail: Promise<void> = Promise.resolve();

    const executions = await runPantheonBounded(indexes, concurrency, async index => {
      let execution: PantheonCategoryExecution;
      try {
        // Even after the collection deadline, every scheduled category passes
        // through this worker and receives a persisted partial outcome below.
        throwIfPantheonAborted(deadline.signal);
        execution = await executePantheonCategory({
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
      } catch (error) {
        const category = PANTHEON_REPORT_CATEGORIES[index];
        const persistedState = input.initialCategoryStates?.find(state => state.index === index);
        const message = error instanceof Error ? error.message : String(error);
        const expectedCapabilities = getPantheonCategoryCapabilities(category.label);
        const primaryCapabilities = getPantheonPrimaryCrawlerCapabilitiesForCategory(category.label);
        const urls = persistedState?.sourcePlan.urls || [];
        const urlLedger: PantheonUrlLedgerEntry[] = urls.map((url, urlIndex) => ({
          url,
          priority: 0,
          authority: 'secondary',
          registryCategory: category.registry[0],
          workType: 'authoritative-source',
          state: 'pending',
          attempts: 0,
          evidenceIds: [],
          capability: primaryCapabilities[urlIndex % Math.max(1, primaryCapabilities.length)] || 'startrek',
          requiredCapabilities: expectedCapabilities.length
            ? [expectedCapabilities[urlIndex % expectedCapabilities.length]]
            : ['startrek'],
          failureReason: message.slice(0, 300),
          transport: transportFor({ url, priority: 0, authority: 'secondary', registryCategory: category.registry[0], workType: 'authoritative-source', state: 'pending', attempts: 0, evidenceIds: [] }),
        }));
        const crawlerAudit: PantheonRetrievalResponse['crawlerAudit'] = [{
          crawler: 'category-orchestrator',
          capabilityClass: 'pantheon-secondary',
          status: /timeout|deadline|abort/i.test(message) ? 'timed_out' : 'failed',
          evidenceCount: 0,
          attempts: 0,
          targets: urls.length,
          error: message.slice(0, 300),
        }];
        const unavailableReasons = Object.fromEntries(capabilityHealth
          .filter(health => health.status === 'unavailable')
          .map(health => [health.capabilityId, health.reason])) as Partial<Record<PantheonCapabilityId, string>>;
        const capabilityWorkLedger = buildPantheonCapabilityWorkLedger({
          investigationId: input.investigationId,
          categoryLabel: category.label,
          sources: urlLedger.map(entry => ({
            sourceUrl: entry.url,
            transport: entry.transport || 'direct-http',
          })),
          unavailableReasons,
          previous: persistedState?.outcome?.capabilityWorkLedger,
        });
        execution = {
          evidence: [],
          audit: crawlerAudit,
          outcome: {
            index,
            label: category.label,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            targetCount: 0,
            evidenceCount: 0,
            crawlerAudit,
            findings: [],
            urlsAttempted: 0,
            urlsSuccessful: 0,
            urlsFailed: 0,
            crawlersUsed: [],
            evidenceRejected: 0,
            urlLedger,
            cursor: 0,
            ledgerVersion: 1,
            totalLedgerUrls: urlLedger.length,
            pendingUrls: urlLedger.length,
            requiredWorkCount: Math.min(categoryProductiveWorkTarget(input.searchDepth), urlLedger.length),
            successfulWorkCount: 0,
            expectedCapabilities,
            completionState: 'partial',
            completionReason: `Category execution stopped before live-source completion: ${message.slice(0, 240)}`,
            capabilityOutcomes: finalizePantheonCategoryCapabilityOutcomes({
              categoryLabel: category.label,
              health: capabilityHealth,
              crawlerAudit,
              workLedger: capabilityWorkLedger,
            }),
            capabilityWorkLedger,
            sourcePreflightIssues: persistedState?.sourcePlan.preflightIssues || [],
          },
        };
      }

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
    }, deadline.signal, true);

    await persistenceTail;
    const ordered = executions.sort((left, right) => left.outcome.index - right.outcome.index);
    applyPantheonCategoryExecutions(report, ordered, baseReport, initialCategoryOutcomes);
    return { report, categoryOutcomes: mergePantheonCategoryOutcomes(initialCategoryOutcomes, ordered) };
  } finally {
    deadline.dispose();
  }
}
