import type { PeopleSearchReport } from '../../peopleSearch';
import type { PantheonReportCategoryLabel } from './PantheonCrawlerCapabilityMatrix';
import { pantheonRetrievalAdapter, type PantheonRetrievalResponse } from '../crawlers/PantheonRetrievalAdapter';
import { admitPantheonUrl } from '../crawlers/PublicAcquisitionInfrastructure';
import {
  assessPantheonCategoryOutcome,
  isLivePantheonCrawlerAudit,
  plannedPantheonCrawlerCapabilitiesForCategory,
  type PantheonCategoryCompletionState,
} from './PantheonInvestigationController';
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
            requiredCapabilities: plannedPantheonCrawlerCapabilitiesForCategory(categoryLabel),
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

let activeCanonicalInvestigation: string | null = null;

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
  if (!input.investigationId) throw new Error('Pantheon canonical workflow requires investigationId');
  if (activeCanonicalInvestigation && activeCanonicalInvestigation !== input.investigationId) {
    throw new Error(`Pantheon canonical workflow already active for ${activeCanonicalInvestigation}`);
  }
  activeCanonicalInvestigation = input.investigationId;
  try {
  const evidence: PantheonRetrievalResponse['evidence'] = [];
  const audits: PantheonRetrievalResponse['crawlerAudit'] = [];
  const categoryOutcomes: PantheonCategoryOutcome[] = [];
  const productiveWorkTarget = categoryProductiveWorkTarget(input.searchDepth);
  const policy = intensityPolicy(input.searchDepth);

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
    const completedBeforeCategory = categoryOutcomes.filter(item => item.completionState === 'completed').length;
    await input.onCategoryState?.({ index, label: category.label, phase: 'ACTIVE', completedCategories: completedBeforeCategory });
    await input.onCategoryStart?.({ index, label: category.label, completedCategories: completedBeforeCategory });

    const remainingCategories = PANTHEON_REPORT_CATEGORIES.length - index;
    const remainingMs = Math.max(1, input.deadlineAt - Date.now());
    const finalizationReserveMs = Math.min(15_000, Math.max(2_000, Math.floor(remainingMs * 0.08)));
    const categoryBudgetMs = Math.max(1_500, Math.floor(Math.max(1, remainingMs - finalizationReserveMs) / remainingCategories));
    // This is a hard category share, not a fresh budget for every URL. It keeps
    // early categories from consuming the entire report deadline.
    const categoryDeadlineAt = Math.min(input.deadlineAt - finalizationReserveMs, Date.now() + categoryBudgetMs);
    const expectedCapabilities = plannedPantheonCrawlerCapabilitiesForCategory(category.label);

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
    const prioritizedTargets = interleaveCategoryTargets(targetGroups, urlLedger.length);
    const activeUrls = new Set<string>();
    const retrievalEvidence: PantheonRetrievalResponse['evidence'] = [];
    const retrievalAudit: PantheonRetrievalResponse['crawlerAudit'] = [];
    let cursor = 0;
    await input.onCategoryState?.({ index, label: category.label, phase: 'URL_WORK', completedCategories: completedBeforeCategory });

    let productiveWorkUnits = 0;
    while (cursor < prioritizedTargets.length && productiveWorkUnits < productiveWorkTarget) {
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
          const independentSources = new Set(producedEvidence.map(item => canonicalUrl(item.target))).size;
          productiveWorkUnits += Math.min(policy.corroborationTarget, Math.max(1, independentSources));
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
            const parent = urlLedger.find(entry => entry.url === canonicalUrl(item.target));
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
            candidate.requiredCapabilities = plannedPantheonCrawlerCapabilitiesForCategory(category.label);
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
    const crawlersUsed = [...new Set(retrieval.crawlerAudit
      .filter(isLivePantheonCrawlerAudit)
      .map(item => item.crawler))];
    const evidenceByUrl = new Map(reportable.map((item, evidenceIndex) => [canonicalUrl(item.target), `${index}:${evidenceIndex}`]));
    const auditFailures = retrieval.crawlerAudit.filter(item => item.status === 'failed' || item.status === 'timed_out');
    for (const entry of urlLedger) {
      if (!activeUrls.has(entry.url)) continue;
      const evidenceId = evidenceByUrl.get(entry.url);
      entry.completedAt = new Date().toISOString();
      const matchingEvidence = reportable.find(item => canonicalUrl(item.target) === entry.url);
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
      findings: reportable.map(item => cleanEvidenceContent(item.content).slice(0, 1800)),
      urlsAttempted,
      urlsSuccessful,
      urlsFailed: Math.max(0, urlsAttempted - urlsSuccessful),
      crawlersUsed,
      evidenceRejected: Math.max(0, retrieval.evidence.length - reportable.length),
      urlLedger,
      cursor,
      ledgerVersion: 1,
      totalLedgerUrls: urlLedger.length,
      pendingUrls: urlLedger.filter(entry => entry.state === 'pending').length,
      expectedCapabilities: assessment.expectedCapabilities,
      completionState: assessment.state,
      completionReason: assessment.reason,
    };
    categoryOutcomes.push(outcome);
    const completedCategoryCount = categoryOutcomes.filter(item => item.completionState === 'completed').length;

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
    const partialCategoryCount = categoryOutcomes.length - completedCategoryCount;
    report.summary = partialCategoryCount === 0
      ? `PANTHEON completed ${completedCategoryCount} of ${PANTHEON_REPORT_CATEGORIES.length} categories with live source work and required crawler coverage.`
      : `PANTHEON completed ${completedCategoryCount} of ${PANTHEON_REPORT_CATEGORIES.length} categories with live source work; ${partialCategoryCount} ${partialCategoryCount === 1 ? 'category remains' : 'categories remain'} partial or unavailable and are identified in this report.`;

    await input.onCategoryState?.({ index, label: category.label, phase: 'PERSISTING', completedCategories: completedBeforeCategory });
    // Persistence is the gate. Category N cannot become COMPLETE and N+1 cannot
    // become ACTIVE until the caller has durably persisted this transaction.
    if (!input.onCategoryComplete) throw new Error('Pantheon category persistence callback is required');
    await input.onCategoryComplete({
      index,
      label: category.label,
      completedCategories: completedCategoryCount,
      outcome,
      partialReport: { ...report },
    });
    await input.onCategoryState?.({ index, label: category.label, phase: 'COMPLETE', completedCategories: completedCategoryCount });
  }

  return { report, categoryOutcomes };
  } finally {
    if (activeCanonicalInvestigation === input.investigationId) activeCanonicalInvestigation = null;
  }
}