import * as cheerio from 'cheerio';
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

export interface PantheonRegistrationProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface PantheonRegistrationAuthority {
  enabled: boolean;
  profile?: PantheonRegistrationProfile;
  allowedHosts: ReadonlySet<string>;
  unavailableReason?: string;
}

export interface PantheonRegistrationAccessResult {
  ok: boolean;
  requestHeaders?: Record<string, string>;
  reason: string;
}

const ALLOWED_PROFILE_FIELDS = new Set(['firstname', 'lastname', 'email', 'phone']);
const PROFILE_ALIASES: Record<string, keyof PantheonRegistrationProfile> = {
  firstname: 'firstName', first_name: 'firstName', givenname: 'firstName', given_name: 'firstName',
  lastname: 'lastName', last_name: 'lastName', surname: 'lastName', familyname: 'lastName', family_name: 'lastName',
  email: 'email', emailaddress: 'email', email_address: 'email',
  phone: 'phone', phonenumber: 'phone', phone_number: 'phone', mobile: 'phone', tel: 'phone', telephone: 'phone',
};
const DISALLOWED_FORM_MARKERS = /password|passcode|username|address|birth|dob|social.security|ssn|government.id|driver.?license|payment|credit.card|billing|captcha|recaptcha|hcaptcha|multi.?factor|two.?factor|verification.code|one.?time|terms.of.(?:service|use)|accept.terms/i;
const VERIFICATION_RESPONSE_MARKERS = /verify (?:your )?(?:email|phone)|verification (?:link|code)|confirmation (?:link|code)|one[- ]time (?:code|password)|enter (?:the )?code we sent/i;

function normalizeHost(value: string): string {
  return value.toLowerCase().replace(/^www\./, '');
}

function allowedHostsFromEnvironment(): Set<string> {
  return new Set(String(process.env.PANTHEON_CONTACT_ONLY_REGISTRATION_HOSTS || '')
    .split(',')
    .map(value => normalizeHost(value.trim()))
    .filter(Boolean));
}

export function createPantheonRegistrationAuthority(user?: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): PantheonRegistrationAuthority {
  const allowedHosts = allowedHostsFromEnvironment();
  if (String(process.env.PANTHEON_CONTACT_REGISTRATION_ENABLED || '').toLowerCase() !== 'true') {
    return { enabled: false, allowedHosts, unavailableReason: 'Contact-only registration is disabled.' };
  }
  const profile = {
    firstName: String(user?.firstName || process.env.PANTHEON_REGISTRATION_FIRST_NAME || '').trim(),
    lastName: String(user?.lastName || process.env.PANTHEON_REGISTRATION_LAST_NAME || '').trim(),
    email: String(user?.email || process.env.PANTHEON_REGISTRATION_EMAIL || '').trim(),
    phone: String(process.env.PANTHEON_REGISTRATION_PHONE || '').trim(),
  };
  if (!profile.firstName || !profile.lastName || !/^\S+@\S+\.\S+$/.test(profile.email) || !/^\+?[0-9() .-]{7,25}$/.test(profile.phone)) {
    return { enabled: false, allowedHosts, unavailableReason: 'The secure contact registration profile is incomplete.' };
  }
  if (!allowedHosts.size) {
    return { enabled: false, allowedHosts, unavailableReason: 'No contact-only registration hosts are approved.' };
  }
  return { enabled: true, profile, allowedHosts };
}

function canonicalRegistrationUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Registration requires a credential-free HTTPS source URL.');
  if (isPrivateAddress(url.hostname)) throw new Error('Private-network registration targets are prohibited.');
  url.hash = '';
  return url;
}

function isPrivateAddress(value: string): boolean {
  const host = value.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (isIP(host) === 4) {
    return /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
  }
  if (isIP(host) === 6) {
    return host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd')
      || /^fe[89ab]/.test(host) || host.startsWith('::ffff:127.') || host.startsWith('::ffff:10.')
      || host.startsWith('::ffff:192.168.') || /^::ffff:172\.(?:1[6-9]|2\d|3[01])\./.test(host);
  }
  return false;
}

async function assertPublicRegistrationResolution(url: URL): Promise<void> {
  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) throw new Error('Private-network registration targets are prohibited.');
    return;
  }
  const records = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => isPrivateAddress(record.address))) {
    throw new Error('Registration hostname does not resolve exclusively to public addresses.');
  }
}

function selectedContactOnlyForm(html: string, pageUrl: URL): {
  action: URL;
  fields: Array<{ name: string; value: string; profileKey?: keyof PantheonRegistrationProfile }>;
} | { error: string } {
  const $ = cheerio.load(html);
  const forms = $('form').toArray();
  for (const form of forms) {
    const element = $(form);
    if (DISALLOWED_FORM_MARKERS.test(element.text()) || DISALLOWED_FORM_MARKERS.test($.html(element))) continue;
    const method = String(element.attr('method') || 'get').toLowerCase();
    if (method !== 'post') continue;
    let action: URL;
    try {
      action = canonicalRegistrationUrl(new URL(element.attr('action') || pageUrl.toString(), pageUrl).toString());
    } catch {
      continue;
    }
    if (normalizeHost(action.hostname) !== normalizeHost(pageUrl.hostname)) continue;

    const fields: Array<{ name: string; value: string; profileKey?: keyof PantheonRegistrationProfile }> = [];
    let invalid = false;
    let recognized = 0;
    element.find('input,textarea,select').each((_, rawField) => {
      const field = $(rawField);
      const name = String(field.attr('name') || '').trim();
      if (!name) return;
      const type = String(field.attr('type') || rawField.tagName || 'text').toLowerCase();
      if (['submit', 'button', 'reset'].includes(type)) return;
      if (type === 'hidden') {
        fields.push({ name, value: String(field.attr('value') || '') });
        return;
      }
      const normalized = name.toLowerCase().replace(/[^a-z0-9_]/g, '');
      const profileKey = PROFILE_ALIASES[normalized];
      if (!profileKey || !ALLOWED_PROFILE_FIELDS.has(profileKey.toLowerCase())) {
        invalid = true;
        return;
      }
      recognized += 1;
      fields.push({ name, value: '', profileKey });
    });
    if (!invalid && recognized > 0) return { action, fields };
  }
  return { error: 'No same-origin contact-only registration form was found.' };
}

async function boundedFetch(url: URL, init: RequestInit, deadlineAt: number, signal?: AbortSignal): Promise<Response> {
  await assertPublicRegistrationResolution(url);
  const controller = new AbortController();
  const propagateAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', propagateAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Registration deadline exceeded')), Math.max(1, deadlineAt - Date.now()));
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', propagateAbort);
  }
}

function responseCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return (headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])
    .filter(Boolean)
    .map(value => value.split(';', 1)[0])
    .filter(Boolean);
}

/**
 * Executes only an explicitly enabled, same-origin, contact-only registration.
 * Passwords, OAuth, MFA, CAPTCHA, payment, extra identity fields, and email or
 * phone confirmation are rejected. Contact values and cookies are never logged
 * or persisted in Pantheon records.
 */
export async function ensurePantheonContactRegistration(input: {
  sourceUrl: string;
  authority?: PantheonRegistrationAuthority;
  deadlineAt: number;
  signal?: AbortSignal;
}): Promise<PantheonRegistrationAccessResult> {
  const authority = input.authority;
  if (!authority?.enabled || !authority.profile) {
    return { ok: false, reason: authority?.unavailableReason || 'Contact-only registration authority is unavailable.' };
  }
  let sourceUrl: URL;
  try {
    sourceUrl = canonicalRegistrationUrl(input.sourceUrl);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const host = normalizeHost(sourceUrl.hostname);
  if (!authority.allowedHosts.has(host)) return { ok: false, reason: 'Source is not approved for contact-only registration.' };
  if (input.deadlineAt <= Date.now()) return { ok: false, reason: 'Registration deadline expired.' };

  try {
    const page = await boundedFetch(sourceUrl, {
      method: 'GET',
      headers: { 'user-agent': 'LegalWhat-Pantheon/1.0 contact-registration', accept: 'text/html' },
    }, input.deadlineAt, input.signal);
    if (!page.ok || !String(page.headers.get('content-type') || '').toLowerCase().includes('html')) {
      return { ok: false, reason: `Registration page was unavailable (HTTP ${page.status}).` };
    }
    const html = (await page.text()).slice(0, 2_000_000);
    const form = selectedContactOnlyForm(html, sourceUrl);
    if ('error' in form) return { ok: false, reason: form.error };
    const pageCookies = responseCookies(page);

    const body = new URLSearchParams();
    for (const field of form.fields) {
      body.set(field.name, field.profileKey ? authority.profile[field.profileKey] : field.value);
    }
    const response = await boundedFetch(form.action, {
      method: 'POST',
      headers: {
        'user-agent': 'LegalWhat-Pantheon/1.0 contact-registration',
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'text/html',
        ...(pageCookies.length ? { cookie: pageCookies.join('; ') } : {}),
      },
      body,
    }, input.deadlineAt, input.signal);
    const responseBody = (await response.text()).slice(0, 500_000);
    if (response.status < 200 || response.status >= 400) return { ok: false, reason: `Contact-only registration failed (HTTP ${response.status}).` };
    if (VERIFICATION_RESPONSE_MARKERS.test(responseBody)) {
      return { ok: false, reason: 'Registration requires unsupported email, phone, or code verification.' };
    }
    const cookiesByName = new Map<string, string>();
    for (const cookie of [...pageCookies, ...responseCookies(response)]) {
      cookiesByName.set(cookie.split('=', 1)[0], cookie);
    }
    const cookies = [...cookiesByName.values()];
    if (!cookies.length) return { ok: false, reason: 'Registration completed without an attributable authenticated session.' };
    return { ok: true, requestHeaders: { cookie: cookies.join('; ') }, reason: 'Contact-only registration produced an in-memory source session.' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
