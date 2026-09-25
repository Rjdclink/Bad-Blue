import { createHash } from 'node:crypto';
import type { PantheonCategoryOutcome } from './PantheonCategoryWorkflow';
import type { PantheonControlledQueryPlan } from './PantheonQueryPlan';

function stableId(prefix: string, ...parts: unknown[]): string {
  return `${prefix}_${createHash('sha256').update(parts.map(value => String(value || '')).join('\u0000')).digest('hex').slice(0, 24)}`;
}

function hostFor(value: unknown): string {
  try { return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, ''); } catch { return 'unknown'; }
}

function isoDate(value: unknown): string | undefined {
  const date = new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function claimFrom(source: any) {
  const data = source?.data && typeof source.data === 'object' ? source.data : {};
  const claim = data.categoryClaim && typeof data.categoryClaim === 'object' ? data.categoryClaim : {};
  const provenance = data.provenance && typeof data.provenance === 'object' ? data.provenance : {};
  return { source, data, claim, provenance };
}

export interface PantheonInvestigationIntelligence {
  schemaVersion: 'pantheon-investigation-intelligence-v1';
  generatedAt: string;
  queryPlanId: string;
  identityGraph: {
    subjectNodeId: string;
    hopLimit: number;
    nodes: Array<{ id: string; type: string; value: string; current: boolean; effectiveAt?: string; confidence: number }>;
    edges: Array<{ id: string; from: string; to: string; type: string; hop: number; citationId: string }>;
    entityMappings: Array<{ stableId: string; evidenceIds: string[]; mergeState: 'separate-until-reviewed'|'verified-same-entity' }>;
  };
  factIndexes: {
    current: Array<{ claimKey: string; value: string; effectiveAt?: string; citationId: string }>;
    historical: Array<{ claimKey: string; value: string; effectiveAt?: string; citationId: string }>;
  };
  timeline: Array<{ at: string; label: string; category: string; citationId: string }>;
  contradictions: Array<{ claimKey: string; values: string[]; citationIds: string[]; disposition: 'manual_review' }>;
  manualReview: Array<{ reason: string; category: string; sourceUrl?: string; citationId?: string }>;
  investigativeLeads: Array<{ category: string; value: string; citationId?: string; reason: string }>;
  verifiedFindings: Array<{ category: string; value: string; citationId: string; confidence: number }>;
  sourceQuality: Array<{
    host: string;
    attempts: number;
    succeeded: number;
    failed: number;
    acceptedEvidence: number;
    successRate: number;
    failureRate: number;
    completenessRate: number;
    averageConfidence: number;
    accuracyScore: number;
    freshnessHours?: number;
    latestRetrieval?: string;
  }>;
  searchScope: Array<{
    category: string;
    jurisdictions: string[];
    attemptedUrls: string[];
    successfulUrls: string[];
    failedUrls: Array<{ url: string; reason: string }>;
    negativeResult?: string;
  }>;
  negativeResultQualification: string;
  incrementalChanges: {
    added: string[];
    modified: string[];
    deleted: string[];
    correctionPropagation: 'current-report-rebuilt-from-present-accepted-evidence';
  };
  changeAlerts: Array<{ type: 'added'|'modified'|'deleted'; stableId: string }>;
}

export function buildPantheonInvestigationIntelligence(input: {
  report: any;
  categoryOutcomes: readonly PantheonCategoryOutcome[];
  queryPlan: PantheonControlledQueryPlan;
  previous?: PantheonInvestigationIntelligence;
}): PantheonInvestigationIntelligence {
  const generatedAt = new Date().toISOString();
  const subjectNodeId = stableId('subject', input.queryPlan.planId);
  const sources = (Array.isArray(input.report?.sources) ? input.report.sources : []).map(claimFrom);
  const nodes: PantheonInvestigationIntelligence['identityGraph']['nodes'] = [{
    id: subjectNodeId,
    type: input.queryPlan.primary.kind,
    value: input.queryPlan.primary.value,
    current: true,
    confidence: 1,
  }];
  const edges: PantheonInvestigationIntelligence['identityGraph']['edges'] = [];
  const mappings = new Map<string, { evidenceIds: Set<string>; sourceHosts: Set<string> }>();
  const current: PantheonInvestigationIntelligence['factIndexes']['current'] = [];
  const historical: PantheonInvestigationIntelligence['factIndexes']['historical'] = [];
  const timeline: PantheonInvestigationIntelligence['timeline'] = [];
  const verifiedFindings: PantheonInvestigationIntelligence['verifiedFindings'] = [];
  const claimGroups = new Map<string, Array<{ value: string; citationId: string }>>();

  for (const { source, data, claim, provenance } of sources) {
    const citationId = String(data.citationId || data.evidenceId || '').trim();
    const value = String(claim.claimValue || data.finding || '').trim().slice(0, 1_800);
    if (!citationId || !value) continue;
    const category = String(claim.categoryLabel || source.name || 'Evidence').split(' — ')[0];
    const claimType = String(claim.claimType || 'source_mention');
    const claimKey = String(claim.claimKey || `${subjectNodeId}:${claimType}`);
    const effectiveAt = isoDate(data.effectiveAt || provenance.lastModified || provenance.retrievedAt || source.timestamp);
    const nodeId = stableId('entity', claimType, String(claim.normalizedValue || value).toLowerCase());
    const isHistorical = /historical|former|previous|timeline/i.test(`${category} ${claimType}`);
    nodes.push({ id: nodeId, type: claimType, value: value.slice(0, 300), current: !isHistorical, ...(effectiveAt ? { effectiveAt } : {}), confidence: Math.max(0, Math.min(1, Number(source.confidence) || 0)) });
    const edgeType = /relative|family|associate|relationship|household/i.test(`${category} ${claimType}`)
      ? 'evidence-backed-relationship'
      : /historical|timeline|date|vital/i.test(`${category} ${claimType}`)
        ? 'evidence-backed-timeline'
        : 'evidence-backed-claim';
    edges.push({ id: stableId('edge', subjectNodeId, nodeId, citationId), from: subjectNodeId, to: nodeId, type: edgeType, hop: 1, citationId });
    const indexItem = { claimKey, value: value.slice(0, 500), ...(effectiveAt ? { effectiveAt } : {}), citationId };
    (isHistorical ? historical : current).push(indexItem);
    if (effectiveAt) timeline.push({ at: effectiveAt, label: value.slice(0, 300), category, citationId });
    verifiedFindings.push({ category, value: value.slice(0, 800), citationId, confidence: Math.max(0, Math.min(1, Number(source.confidence) || 0)) });
    const group = claimGroups.get(claimKey) || [];
    group.push({ value: String(claim.normalizedValue || value).toLowerCase(), citationId });
    claimGroups.set(claimKey, group);
    const mapped = mappings.get(nodeId) || { evidenceIds: new Set<string>(), sourceHosts: new Set<string>() };
    mapped.evidenceIds.add(String(data.evidenceId || citationId));
    const mappedHost = hostFor(data.url || source.url);
    if (mappedHost && mappedHost !== 'unknown') mapped.sourceHosts.add(mappedHost);
    mappings.set(nodeId, mapped);

  }

  const contradictions = [...claimGroups.entries()].flatMap(([claimKey, items]) => {
    const values = [...new Set(items.map(item => item.value))];
    return values.length > 1
      ? [{ claimKey, values, citationIds: [...new Set(items.map(item => item.citationId))], disposition: 'manual_review' as const }]
      : [];
  });
  const manualReview: PantheonInvestigationIntelligence['manualReview'] = [
    ...input.categoryOutcomes.flatMap(outcome => (outcome.reviewItems || []).map(item => ({
      reason: item.reason,
      category: outcome.label,
      ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
      ...(item.citationId ? { citationId: item.citationId } : {}),
    }))),
    ...contradictions.map(item => ({ reason: `Conflicting values for ${item.claimKey}`, category: 'Cross-category identity resolution', citationId: item.citationIds[0] })),
  ];
  const investigativeLeads = input.categoryOutcomes.flatMap(outcome => (outcome.reviewItems || [])
    .filter(item => item.reason === 'weak_evidence' || item.reason === 'subject_mismatch')
    .map(item => ({ category: outcome.label, value: item.excerpt || item.sourceUrl || 'Unverified lead', ...(item.citationId ? { citationId: item.citationId } : {}), reason: item.reason })));

  const sourceQualityMap = new Map<string, { attempts: number; succeeded: number; failed: number; acceptedEvidence: number; confidences: number[]; latest?: string }>();
  for (const outcome of input.categoryOutcomes) {
    for (const entry of outcome.urlLedger) {
      const host = hostFor(entry.url);
      const quality = sourceQualityMap.get(host) || { attempts: 0, succeeded: 0, failed: 0, acceptedEvidence: 0, confidences: [] };
      if (entry.attempts > 0) quality.attempts += 1;
      if (entry.state === 'accepted' || entry.state === 'no_evidence') quality.succeeded += 1;
      else if (entry.attempts > 0) quality.failed += 1;
      quality.acceptedEvidence += entry.evidenceIds.length;
      quality.latest = [quality.latest, entry.result?.retrievedAt].filter(Boolean).sort().at(-1);
      sourceQualityMap.set(host, quality);
    }
  }
  for (const { source, data } of sources) {
    const host = hostFor(data.url);
    const quality = sourceQualityMap.get(host) || { attempts: 0, succeeded: 0, failed: 0, acceptedEvidence: 0, confidences: [] };
    quality.confidences.push(Math.max(0, Math.min(1, Number(source.confidence) || 0)));
    sourceQualityMap.set(host, quality);
  }
  const sourceQuality = [...sourceQualityMap.entries()].map(([host, quality]) => ({
    host,
    attempts: quality.attempts,
    succeeded: quality.succeeded,
    failed: quality.failed,
    acceptedEvidence: quality.acceptedEvidence,
    successRate: quality.attempts ? quality.succeeded / quality.attempts : 0,
    failureRate: quality.attempts ? quality.failed / quality.attempts : 0,
    completenessRate: quality.attempts ? Math.min(1, quality.acceptedEvidence / quality.attempts) : 0,
    averageConfidence: quality.confidences.length ? quality.confidences.reduce((sum, value) => sum + value, 0) / quality.confidences.length : 0,
    accuracyScore: quality.confidences.length ? quality.confidences.reduce((sum, value) => sum + value, 0) / quality.confidences.length : 0,
    ...(quality.latest ? { freshnessHours: Math.max(0, (Date.now() - new Date(quality.latest).getTime()) / 3_600_000) } : {}),
    ...(quality.latest ? { latestRetrieval: quality.latest } : {}),
  })).sort((left, right) => right.acceptedEvidence - left.acceptedEvidence || left.host.localeCompare(right.host));

  const searchScope = input.categoryOutcomes.map(outcome => {
    const attempted = outcome.urlLedger.filter(entry => entry.attempts > 0);
    const successful = attempted.filter(entry => entry.state === 'accepted' || entry.state === 'no_evidence');
    return {
      category: outcome.label,
      jurisdictions: [...new Set(attempted.map(entry => entry.jurisdiction).filter(Boolean))],
      attemptedUrls: attempted.map(entry => entry.url),
      successfulUrls: successful.map(entry => entry.url),
      failedUrls: attempted.filter(entry => !successful.includes(entry)).map(entry => ({ url: entry.url, reason: entry.failureReason || entry.state })),
      ...(outcome.evidenceCount === 0 ? { negativeResult: `No accepted subject-matched evidence was returned within the listed URLs and jurisdictions; this is not proof that no record exists.` } : {}),
    };
  });

  const currentStable = new Map(nodes.map(node => [node.id, createHash('sha256').update(JSON.stringify(node)).digest('hex')]));
  const previousStable = new Map((input.previous?.identityGraph.nodes || []).map(node => [node.id, createHash('sha256').update(JSON.stringify(node)).digest('hex')]));
  const added = [...currentStable.keys()].filter(id => !previousStable.has(id));
  const deleted = [...previousStable.keys()].filter(id => !currentStable.has(id));
  const modified = [...currentStable.keys()].filter(id => previousStable.has(id) && previousStable.get(id) !== currentStable.get(id));
  const changeAlerts = [
    ...added.map(stableId => ({ type: 'added' as const, stableId })),
    ...modified.map(stableId => ({ type: 'modified' as const, stableId })),
    ...deleted.map(stableId => ({ type: 'deleted' as const, stableId })),
  ];

  return {
    schemaVersion: 'pantheon-investigation-intelligence-v1',
    generatedAt,
    queryPlanId: input.queryPlan.planId,
    identityGraph: {
      subjectNodeId,
      hopLimit: input.queryPlan.relationshipHopLimit,
      nodes: [...new Map(nodes.map(node => [node.id, node])).values()],
      edges: edges.filter(edge => edge.hop <= input.queryPlan.relationshipHopLimit),
      entityMappings: [...mappings.entries()].map(([id, mapping]) => ({
        stableId: id,
        evidenceIds: [...mapping.evidenceIds],
        mergeState: mapping.sourceHosts.size > 1 ? 'verified-same-entity' as const : 'separate-until-reviewed' as const,
      })),
    },
    factIndexes: { current, historical },
    timeline: timeline.sort((left, right) => left.at.localeCompare(right.at)),
    contradictions,
    manualReview,
    investigativeLeads,
    verifiedFindings,
    sourceQuality,
    searchScope,
    negativeResultQualification: 'No result found means only that no accepted evidence was returned from the exact listed URLs, jurisdictions, time window, and capabilities. It does not prove that no record exists.',
    incrementalChanges: { added, modified, deleted, correctionPropagation: 'current-report-rebuilt-from-present-accepted-evidence' },
    changeAlerts: input.previous ? changeAlerts : [],
  };
}
