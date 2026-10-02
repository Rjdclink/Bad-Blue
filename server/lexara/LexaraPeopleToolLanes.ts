import type { LexaraBackgroundSubject } from './LexaraBackgroundSubject';
import type { LexaraRequestedFact, LexaraResearchDecision } from './LexaraResearchIntentRouter';
import type { LexaraSourceCategory } from './LexaraPublicSourceRegistry';
import type { LexaraAuthoritativeEvidence } from './LexaraAuthoritativeLookup';
import type { LegalMeshCandidate } from './LegalProviderMesh';

export interface LexaraPeopleToolLaneResult {
  candidates: LegalMeshCandidate[];
  evidence: LexaraAuthoritativeEvidence[];
  lanesAttempted: string[];
}

interface WhatsMyNameSite {
  name?: string;
  uri_check?: string;
  uri_pretty?: string;
  e_code?: number;
  e_string?: string;
  m_string?: string;
  post_body?: unknown;
}

interface WhatsMyNamePayload {
  sites?: WhatsMyNameSite[];
}

const FAST_FETCH_TIMEOUT_MS = 2_200;
const WHATS_MY_NAME_TIMEOUT_MS = 1_800;
const DEEP_ADAPTER_TIMEOUT_MS = 12_000;
const SHERLOCK_SITE_TIMEOUT_MS = 1_500;
const SHERLOCK_MAX_SITES = 24;
const WHATS_MY_NAME_MAX_SITES = 24;
const WHATS_MY_NAME_DATA_URL =
  'https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json';
const DEEP_PROMPT = /\b(?:deep|thorough|recursive|broaden|look harder|full background|comprehensive)\b/i;
const USERNAME_CUE = /(?:^|\s)@([A-Za-z0-9_.-]{2,64})\b|\b(?:username|user name|handle)\s*(?:is|=|:)?\s*["']?([A-Za-z0-9_.-]{2,64})["']?/i;
const EMAIL_CUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const DOMAIN_CUE = /\b(?:domain|website|site|company\s+domain)\s*(?:is|=|:)?\s*(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})\b/i;

let whatsMyNameCache: { expiresAt: number; sites: WhatsMyNameSite[] } | null = null;

function isPublicHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.local')) return false;
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return false;
    if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host) || /^0\./.test(host)) return false;
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    if (/^192\.168\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function uniqueCandidates(items: readonly LegalMeshCandidate[]): LegalMeshCandidate[] {
  const seen = new Set<string>();
  const output: LegalMeshCandidate[] = [];
  for (const item of items) {
    const url = String(item.url || '').trim();
    if (!isPublicHttpUrl(url) || seen.has(url)) continue;
    seen.add(url);
    output.push(item);
  }
  return output;
}

function uniqueEvidence(items: readonly LexaraAuthoritativeEvidence[]): LexaraAuthoritativeEvidence[] {
  const seen = new Set<string>();
  const output: LexaraAuthoritativeEvidence[] = [];
  for (const item of items) {
    const key = `${item.provider}:${item.url}:${item.content.slice(0, 160)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function extractUsername(prompt: string): string | undefined {
  const match = USERNAME_CUE.exec(String(prompt || ''));
  return (match?.[1] || match?.[2] || '').trim() || undefined;
}

function extractEmail(prompt: string): string | undefined {
  return EMAIL_CUE.exec(String(prompt || ''))?.[0]?.trim();
}

function extractDomain(prompt: string, email?: string): string | undefined {
  if (email?.includes('@')) return email.split('@')[1]?.toLowerCase();
  const cue = DOMAIN_CUE.exec(String(prompt || ''))?.[1]?.toLowerCase();
  if (cue) return cue;
  const urlHost = String(prompt || '').match(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/i)?.[1];
  return urlHost?.toLowerCase();
}

function configuredUrl(name: string): string | undefined {
  const value = String(process.env[name] || '').trim();
  if (!value || !/^https?:\/\//i.test(value)) return undefined;
  return value;
}

async function fetchWithDeadline(
  url: string,
  init: RequestInit = {},
  timeoutMs = FAST_FETCH_TIMEOUT_MS,
  parentSignal?: AbortSignal,
): Promise<Response | null> {
  const controller = new AbortController();
  const relay = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) controller.abort(parentSignal.reason);
  else parentSignal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('lexara_people_lane_timeout')), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response.ok ? response : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', relay);
  }
}

function requestedFactMatches(
  fact: LexaraRequestedFact,
  categories: readonly LexaraSourceCategory[],
  wantedFacts: readonly LexaraRequestedFact[],
  wantedCategories: readonly LexaraSourceCategory[],
): boolean {
  return wantedFacts.includes(fact) || wantedCategories.some(category => categories.includes(category));
}

function selectSherlockPlatforms(platforms: readonly string[]): string[] {
  const priority = [
    'github', 'reddit', 'linkedin', 'instagram', 'facebook', 'tiktok', 'youtube',
    'twitter', 'mastodon', 'medium', 'pinterest', 'tumblr', 'flickr', 'keybase',
    'deviantart', 'soundcloud', 'steam', 'twitch', 'vimeo', 'telegram',
  ];
  const ranked = platforms
    .map(platform => ({
      platform,
      score: priority.findIndex(name => platform.toLowerCase().includes(name)),
    }))
    .filter(item => item.score >= 0)
    .sort((a, b) => a.score - b.score)
    .map(item => item.platform);
  return [...new Set(ranked)].slice(0, SHERLOCK_MAX_SITES);
}

async function runSherlock(
  username: string,
  signal?: AbortSignal,
): Promise<LegalMeshCandidate[]> {
  if (signal?.aborted) return [];
  try {
    const { sherlockEngine } = await import('../services/socialIntelligence/sherlockEngine');
    const platforms = selectSherlockPlatforms(sherlockEngine.getSupportedPlatforms());
    if (!platforms.length) return [];
    const results = await sherlockEngine.searchUsername(username, {
      platforms,
      concurrency: 12,
      timeout: SHERLOCK_SITE_TIMEOUT_MS,
      includeProfileData: false,
      stealth: false,
      retries: 0,
    });
    if (signal?.aborted) return [];
    return results
      .filter(result => result.exists && /^https?:\/\//i.test(result.url))
      .map(result => ({
        url: result.url,
        title: `${result.platform} profile candidate for @${username}`,
        excerpt: `Public username check found @${username} on ${result.platform}. Treat this as an account lead until the profile content matches the researched person.`,
        tier: 3 as const,
        provider: 'sherlock',
      }));
  } catch {
    return [];
  }
}

async function loadWhatsMyNameSites(signal?: AbortSignal): Promise<WhatsMyNameSite[]> {
  if (whatsMyNameCache && whatsMyNameCache.expiresAt > Date.now()) return whatsMyNameCache.sites;
  const response = await fetchWithDeadline(
    WHATS_MY_NAME_DATA_URL,
    { headers: { accept: 'application/json', 'user-agent': 'LegalWhat-Lexara/1.0' } },
    FAST_FETCH_TIMEOUT_MS,
    signal,
  );
  if (!response) return [];
  try {
    const payload = await response.json() as WhatsMyNamePayload;
    const sites = Array.isArray(payload?.sites) ? payload.sites : [];
    whatsMyNameCache = { expiresAt: Date.now() + 6 * 60 * 60_000, sites };
    return sites;
  } catch {
    return [];
  }
}

function rankWhatsMyNameSites(sites: readonly WhatsMyNameSite[]): WhatsMyNameSite[] {
  const preferred = /github|reddit|linkedin|instagram|facebook|tiktok|youtube|twitter|mastodon|medium|pinterest|tumblr|flickr|keybase|deviantart|soundcloud|steam|twitch|vimeo/i;
  return sites
    .filter(site => site.uri_check && !site.post_body)
    .sort((left, right) => Number(preferred.test(String(right.name || ''))) - Number(preferred.test(String(left.name || ''))))
    .slice(0, WHATS_MY_NAME_MAX_SITES);
}

async function checkWhatsMyNameSite(
  site: WhatsMyNameSite,
  username: string,
  signal?: AbortSignal,
): Promise<LegalMeshCandidate | null> {
  if (!site.uri_check) return null;
  const url = site.uri_check.replace(/\{account\}/g, encodeURIComponent(username));
  if (!isPublicHttpUrl(url)) return null;
  const response = await fetchWithDeadline(
    url,
    { headers: { 'user-agent': 'LegalWhat-Lexara/1.0', accept: 'text/html,application/json;q=0.9,*/*;q=0.8' } },
    WHATS_MY_NAME_TIMEOUT_MS,
    signal,
  );
  if (!response) return null;
  if (Number.isFinite(site.e_code) && response.status !== Number(site.e_code)) return null;
  try {
    const body = (await response.text()).slice(0, 250_000);
    if (site.m_string && body.includes(site.m_string)) return null;
    if (site.e_string && !body.includes(site.e_string)) return null;
    const pretty = site.uri_pretty?.replace(/\{account\}/g, encodeURIComponent(username)) || url;
    return {
      url: pretty,
      title: `${site.name || 'Public site'} username candidate for @${username}`,
      excerpt: `WhatsMyName detection rules found a public account candidate for @${username}. Treat this as a lead until the profile content matches the researched person.`,
      tier: 3,
      provider: 'whatsmyname',
    };
  } catch {
    return null;
  }
}

async function runWhatsMyName(
  username: string,
  signal?: AbortSignal,
): Promise<LegalMeshCandidate[]> {
  const sites = rankWhatsMyNameSites(await loadWhatsMyNameSites(signal));
  if (!sites.length) return [];
  const settled = await Promise.allSettled(sites.map(site => checkWhatsMyNameSite(site, username, signal)));
  return settled.flatMap(result =>
    result.status === 'fulfilled' && result.value ? [result.value] : []
  );
}

function splitPersonName(name: string): { first: string; last: string } | null {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts[parts.length - 1] };
}

async function runHunter(
  subject: LexaraBackgroundSubject,
  domain: string,
  signal?: AbortSignal,
): Promise<{ candidates: LegalMeshCandidate[]; evidence: LexaraAuthoritativeEvidence[] }> {
  const apiKey = String(process.env.HUNTER_API_KEY || '').trim();
  const name = splitPersonName(subject.name);
  if (!apiKey || !name || !domain) return { candidates: [], evidence: [] };

  const url = new URL('https://api.hunter.io/v2/email-finder');
  url.searchParams.set('domain', domain);
  url.searchParams.set('first_name', name.first);
  url.searchParams.set('last_name', name.last);
  url.searchParams.set('api_key', apiKey);
  const response = await fetchWithDeadline(url.toString(), { headers: { accept: 'application/json' } }, FAST_FETCH_TIMEOUT_MS, signal);
  if (!response) return { candidates: [], evidence: [] };

  try {
    const payload: any = await response.json();
    const email = String(payload?.data?.email || '').trim();
    if (!email) return { candidates: [], evidence: [] };
    const score = Number(payload?.data?.score);
    const sourceRows = Array.isArray(payload?.data?.sources) ? payload.data.sources : [];
    const sourceUrls = sourceRows
      .map((item: any) => String(item?.uri || item?.url || '').trim())
      .filter((value: string) => isPublicHttpUrl(value))
      .slice(0, 6);
    const candidates: LegalMeshCandidate[] = sourceUrls.map(sourceUrl => ({
      url: sourceUrl,
      title: `Public source supporting professional email for ${subject.name}`,
      excerpt: `Hunter reported ${email} for ${subject.name} at ${domain}; retrieve the source page before treating the address as independently verified.`,
      tier: 3,
      provider: 'hunter',
    }));
    const evidence: LexaraAuthoritativeEvidence[] = [{
      url: sourceUrls[0] || 'https://hunter.io/',
      content: `Hunter Email Finder reports ${email} for ${subject.name} at ${domain}. Confidence score: ${Number.isFinite(score) ? score : 'not supplied'}. ${sourceUrls.length ? `Public supporting source URLs were supplied: ${sourceUrls.join(', ')}.` : 'No public supporting source URL was supplied in this response.'}`,
      retrievedAt: new Date().toISOString(),
      provider: 'hunter',
    }];
    return { candidates, evidence };
  } catch {
    return { candidates: [], evidence: [] };
  }
}

async function callJsonAdapter(
  endpoint: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<any | null> {
  const response = await fetchWithDeadline(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  }, DEEP_ADAPTER_TIMEOUT_MS, signal);
  if (!response) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function collectUrls(value: unknown, output = new Set<string>(), depth = 0): Set<string> {
  if (depth > 6 || output.size >= 40) return output;
  if (typeof value === 'string') {
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
      const candidate = match[0].replace(/[),.;]+$/g, '');
      if (isPublicHttpUrl(candidate)) output.add(candidate);
      if (output.size >= 40) break;
    }
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, output, depth + 1);
    return output;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectUrls(item, output, depth + 1);
  }
  return output;
}

async function runMaigretAdapter(
  endpoint: string,
  username: string,
  signal?: AbortSignal,
): Promise<LegalMeshCandidate[]> {
  const payload = await callJsonAdapter(endpoint, { username, topSites: 100, recursive: false }, signal);
  if (!payload) return [];
  return [...collectUrls(payload)].slice(0, 30).map(url => ({
    url,
    title: `Maigret account candidate for @${username}`,
    excerpt: `Maigret returned this URL while checking the supplied username @${username}. Treat it as a lead until profile content matches the researched person.`,
    tier: 3,
    provider: 'maigret',
  }));
}

async function runHoleheAdapter(
  endpoint: string,
  email: string,
  subject: LexaraBackgroundSubject,
  signal?: AbortSignal,
): Promise<LexaraAuthoritativeEvidence[]> {
  const payload = await callJsonAdapter(endpoint, { email }, signal);
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.results) ? payload.results : [];
  const positives = rows
    .filter((item: any) => item?.exists === true && item?.rateLimit !== true)
    .slice(0, 20);
  if (!positives.length) return [];
  const services = positives
    .map((item: any) => String(item?.domain || item?.name || '').trim())
    .filter(Boolean);
  return [{
    url: 'https://github.com/megadose/holehe',
    content: `For the user-supplied email ${email} associated in this query with ${subject.name}, Holehe returned public account-registration signals on: ${services.join(', ')}. These signals do not by themselves prove that ${subject.name} controls those accounts.`,
    retrievedAt: new Date().toISOString(),
    provider: 'holehe',
  }];
}

async function runSpiderFootDeep(
  seed: string,
  signal?: AbortSignal,
): Promise<LegalMeshCandidate[]> {
  if (!process.env.SPIDERFOOT_URL?.trim() || signal?.aborted) return [];
  try {
    const { spiderfootClient } = await import('../services/spiderfootClient');
    const scanId = await spiderfootClient.startScan(seed);
    await spiderfootClient.waitForScanCompletion(scanId, { timeoutMs: 20_000, pollIntervalMs: 1_000 });
    if (signal?.aborted) return [];
    const payload = await spiderfootClient.getScanResults(scanId);
    return [...collectUrls(payload)].slice(0, 30).map(url => ({
      url,
      title: `SpiderFoot public-source candidate for ${seed}`,
      excerpt: 'SpiderFoot returned this URL during a deep public-source scan. Treat it as discovery only until Lexara retrieves and subject-matches the source.',
      tier: 3,
      provider: 'spiderfoot',
    }));
  } catch {
    return [];
  }
}

/**
 * Specialized people-tool lanes. They are strictly additive to Lexara's native
 * public-source and Claude lanes:
 * - Fast username tools run only when the user supplied a username/handle.
 * - Hunter runs only when the user supplied a company/domain clue.
 * - Maigret, Holehe, and SpiderFoot are deep-only and require explicit service
 *   configuration, so ordinary live answers never wait for heavy OSINT scans.
 * - Returned account URLs remain discovery candidates until Lexara's existing
 *   subject/evidence checks accept them.
 */
export async function runLexaraPeopleToolLanes(input: {
  prompt: string;
  subject: LexaraBackgroundSubject;
  decision: LexaraResearchDecision;
  categories: readonly LexaraSourceCategory[];
  signal?: AbortSignal;
  deep?: boolean;
}): Promise<LexaraPeopleToolLaneResult> {
  const username = extractUsername(input.prompt);
  const email = extractEmail(input.prompt);
  const domain = extractDomain(input.prompt, email);
  const deep = input.deep === true || DEEP_PROMPT.test(input.prompt);
  const wantsSocial = Boolean(username && deep) || requestedFactMatches(
    input.decision.requestedFact,
    input.categories,
    ['social-online'],
    ['social-online'],
  );
  const wantsContact = Boolean((email || domain) && deep) || requestedFactMatches(
    input.decision.requestedFact,
    input.categories,
    ['contact-address', 'employment'],
    ['contacts-addresses', 'employment'],
  );

  const jobs: Array<Promise<LexaraPeopleToolLaneResult>> = [];

  if (username && wantsSocial) {
    jobs.push((async () => ({
      candidates: await runSherlock(username, input.signal),
      evidence: [],
      lanesAttempted: ['sherlock'],
    }))());
    jobs.push((async () => ({
      candidates: await runWhatsMyName(username, input.signal),
      evidence: [],
      lanesAttempted: ['whatsmyname'],
    }))());

    const maigretUrl = deep ? configuredUrl('MAIGRET_SEARCH_URL') : undefined;
    if (maigretUrl) {
      jobs.push((async () => ({
        candidates: await runMaigretAdapter(maigretUrl, username, input.signal),
        evidence: [],
        lanesAttempted: ['maigret'],
      }))());
    }
  }

  if (!email && domain && wantsContact && input.subject.kind === 'person') {
    jobs.push((async () => {
      const hunter = await runHunter(input.subject, domain, input.signal);
      return {
        candidates: hunter.candidates,
        evidence: hunter.evidence,
        lanesAttempted: process.env.HUNTER_API_KEY?.trim() ? ['hunter'] : [],
      };
    })());
  }

  const holeheUrl = deep && email ? configuredUrl('HOLEHE_SEARCH_URL') : undefined;
  if (holeheUrl && (wantsContact || wantsSocial)) {
    jobs.push((async () => ({
      candidates: [],
      evidence: await runHoleheAdapter(holeheUrl, email, input.subject, input.signal),
      lanesAttempted: ['holehe'],
    }))());
  }

  const spiderFootSeed = deep ? email || username : undefined;
  if (spiderFootSeed && process.env.SPIDERFOOT_URL?.trim()) {
    jobs.push((async () => ({
      candidates: await runSpiderFootDeep(spiderFootSeed, input.signal),
      evidence: [],
      lanesAttempted: ['spiderfoot'],
    }))());
  }

  if (!jobs.length) return { candidates: [], evidence: [], lanesAttempted: [] };
  const settled = await Promise.allSettled(jobs);
  const completed = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  return {
    candidates: uniqueCandidates(completed.flatMap(result => result.candidates)),
    evidence: uniqueEvidence(completed.flatMap(result => result.evidence)),
    lanesAttempted: [...new Set(completed.flatMap(result => result.lanesAttempted))],
  };
}
