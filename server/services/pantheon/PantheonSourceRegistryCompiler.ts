import { admitPantheonUrl } from '../crawlers/PublicAcquisitionInfrastructure';

export type PantheonSourceAccessMode =
  | 'public'
  | 'contact-registration'
  | 'excluded-api-key'
  | 'excluded-paid'
  | 'excluded-extra-registration'
  | 'excluded-unsupported-verification'
  | 'excluded-invalid';

export interface PantheonRawRegistrySource {
  id: string;
  name: string;
  url: string;
  jurisdiction: string;
  categories: readonly string[];
  authority: 'primary' | 'secondary';
  verifiedAt: string;
}

export interface PantheonCompiledRegistrySource {
  id: string;
  sourceIds: string[];
  names: string[];
  url: string;
  originalUrls: string[];
  jurisdiction: string;
  jurisdictions: string[];
  categories: string[];
  authority: 'primary' | 'secondary';
  verifiedAt: string;
  accessMode: 'public' | 'contact-registration';
  accessReason: string;
  registrationFields?: readonly ['firstName', 'lastName', 'email', 'phone'];
}

export interface PantheonSourceExclusion {
  sourceIds: string[];
  names: string[];
  originalUrls: string[];
  canonicalUrl?: string;
  jurisdictions: string[];
  categories: string[];
  accessMode: Exclude<PantheonSourceAccessMode, 'public' | 'contact-registration'>;
  reason: string;
  recordedAt: string;
}

export interface PantheonCompiledSourceRegistry {
  executable: PantheonCompiledRegistrySource[];
  exclusions: PantheonSourceExclusion[];
  diagnostics: {
    rawEntries: number;
    canonicalUrls: number;
    executableCanonicalUrls: number;
    excludedCanonicalUrls: number;
    duplicateReferences: number;
    accountedRawEntries: number;
  };
}

const API_KEY_HOSTS = new Set([
  'api.europeana.eu',
  'api.regulations.gov',
  'api.si.edu',
  'newsapi.org',
]);

const PAID_OR_SUBSCRIPTION_HOSTS = new Set([
  'ancestry.com',
  'fold3.com',
  'genealogybank.com',
  'myheritage.com',
  'newspapers.com',
  'pacer.uscourts.gov',
]);

const ACCOUNT_AND_PASSWORD_HOSTS = new Set([
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'snapchat.com',
  'tiktok.com',
  'x.com',
]);

const COMMERCIAL_VERIFICATION_HOSTS = new Set([
  'attomdata.com',
  'blackknightinc.com',
  'corelogic.com',
  'crunchbase.com',
  'dnb.com',
  'glassdoor.com',
  'zoominfo.com',
]);

const CONTACT_REGISTRATION_FIELDS = ['firstName', 'lastName', 'email', 'phone'] as const;

function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

function configuredContactOnlyHosts(): Set<string> {
  return new Set(String(process.env.PANTHEON_CONTACT_ONLY_REGISTRATION_HOSTS || '')
    .split(',')
    .map(value => value.trim().toLowerCase().replace(/^www\./, ''))
    .filter(Boolean));
}

function classifyAccess(url: URL): { mode: PantheonSourceAccessMode; reason: string } {
  const host = normalizedHost(url);
  if (API_KEY_HOSTS.has(host)) {
    return { mode: 'excluded-api-key', reason: 'Source requires an API key or access token.' };
  }
  if (PAID_OR_SUBSCRIPTION_HOSTS.has(host)) {
    return { mode: 'excluded-paid', reason: 'Source requires payment, subscription, or a paid account.' };
  }
  if (ACCOUNT_AND_PASSWORD_HOSTS.has(host)) {
    return { mode: 'excluded-extra-registration', reason: 'Source requires account credentials beyond the approved contact-only fields.' };
  }
  if (COMMERCIAL_VERIFICATION_HOSTS.has(host)) {
    return { mode: 'excluded-unsupported-verification', reason: 'Source requires unsupported commercial registration or verification.' };
  }
  if (configuredContactOnlyHosts().has(host)) {
    return { mode: 'contact-registration', reason: 'Operator-approved contact-only registration source.' };
  }
  return { mode: 'public', reason: 'Public source; runtime preflight still enforces access barriers.' };
}

function mergeAuthority(values: readonly PantheonRawRegistrySource[]): 'primary' | 'secondary' {
  return values.some(value => value.authority === 'primary') ? 'primary' : 'secondary';
}

function newestVerification(values: readonly PantheonRawRegistrySource[]): string {
  return values.map(value => value.verifiedAt).sort().at(-1) || '';
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Converts the authored 4,500-entry inventory into the executable source
 * registry. Every authored entry is represented by either an executable
 * canonical source or an exclusion record; duplicates retain all source IDs.
 */
export function compilePantheonSourceRegistry(
  rawInventory: readonly PantheonRawRegistrySource[],
): PantheonCompiledSourceRegistry {
  const acceptedGroups = new Map<string, PantheonRawRegistrySource[]>();
  const rejectedGroups = new Map<string, { sources: PantheonRawRegistrySource[]; mode: PantheonSourceExclusion['accessMode']; reason: string; canonicalUrl?: string }>();

  for (const source of rawInventory) {
    const admission = admitPantheonUrl(source.url);
    if (!admission.ok) {
      const key = `invalid:${source.id}`;
      rejectedGroups.set(key, {
        sources: [source],
        mode: 'excluded-invalid',
        reason: admission.reason,
      });
      continue;
    }

    const canonicalUrl = admission.url;
    const policy = classifyAccess(new URL(canonicalUrl));
    if (policy.mode !== 'public' && policy.mode !== 'contact-registration') {
      const key = `${policy.mode}:${canonicalUrl}`;
      const existing = rejectedGroups.get(key);
      if (existing) existing.sources.push(source);
      else rejectedGroups.set(key, {
        sources: [source],
        mode: policy.mode,
        reason: policy.reason,
        canonicalUrl,
      });
      continue;
    }

    const key = `${policy.mode}:${canonicalUrl}`;
    const existing = acceptedGroups.get(key);
    if (existing) existing.push(source);
    else acceptedGroups.set(key, [source]);
  }

  const executable = [...acceptedGroups.entries()].map(([key, sources]) => {
    const splitAt = key.indexOf(':');
    const accessMode = key.slice(0, splitAt) as PantheonCompiledRegistrySource['accessMode'];
    const url = key.slice(splitAt + 1);
    const access = classifyAccess(new URL(url));
    const jurisdictions = unique(sources.map(source => source.jurisdiction));
    return {
      id: sources[0].id,
      sourceIds: unique(sources.map(source => source.id)),
      names: unique(sources.map(source => source.name)),
      url,
      originalUrls: unique(sources.map(source => source.url)),
      jurisdiction: jurisdictions[0] || 'US',
      jurisdictions,
      categories: unique(sources.flatMap(source => [...source.categories])),
      authority: mergeAuthority(sources),
      verifiedAt: newestVerification(sources),
      accessMode,
      accessReason: access.reason,
      ...(accessMode === 'contact-registration' ? { registrationFields: CONTACT_REGISTRATION_FIELDS } : {}),
    } satisfies PantheonCompiledRegistrySource;
  }).sort((left, right) => left.url.localeCompare(right.url));

  const recordedAt = new Date().toISOString();
  const exclusions = [...rejectedGroups.values()].map(group => ({
    sourceIds: unique(group.sources.map(source => source.id)),
    names: unique(group.sources.map(source => source.name)),
    originalUrls: unique(group.sources.map(source => source.url)),
    ...(group.canonicalUrl ? { canonicalUrl: group.canonicalUrl } : {}),
    jurisdictions: unique(group.sources.map(source => source.jurisdiction)),
    categories: unique(group.sources.flatMap(source => [...source.categories])),
    accessMode: group.mode,
    reason: group.reason,
    recordedAt,
  })).sort((left, right) => String(left.canonicalUrl || left.originalUrls[0]).localeCompare(String(right.canonicalUrl || right.originalUrls[0])));

  const accountedRawEntries = executable.reduce((sum, source) => sum + source.sourceIds.length, 0)
    + exclusions.reduce((sum, source) => sum + source.sourceIds.length, 0);
  const canonicalUrls = executable.length + exclusions.length;
  const diagnostics = {
    rawEntries: rawInventory.length,
    canonicalUrls,
    executableCanonicalUrls: executable.length,
    excludedCanonicalUrls: exclusions.length,
    duplicateReferences: rawInventory.length - canonicalUrls,
    accountedRawEntries,
  };
  if (accountedRawEntries !== rawInventory.length) {
    throw new Error(`Pantheon source compiler lost registry entries: accounted ${accountedRawEntries} of ${rawInventory.length}`);
  }
  return { executable, exclusions, diagnostics };
}

export function pantheonSourceExclusionsForCategory(
  exclusions: readonly PantheonSourceExclusion[],
  category: string,
): PantheonSourceExclusion[] {
  return exclusions.filter(exclusion => exclusion.categories.includes(category));
}
