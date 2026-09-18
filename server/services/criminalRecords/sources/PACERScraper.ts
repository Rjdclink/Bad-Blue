// Federal PACER/PCL API adapter.
import type { Page } from 'playwright';
import type { CriminalSearchQuery, ScraperResult } from '../types';
import { LegacyScraperAdapter } from './LegacyScraperAdapter';

type PacerEnvironment = 'production' | 'qa';

interface PacerAuthResponse {
  nextGenCSO?: string;
  loginResult?: string;
  errorDescription?: string;
}

interface PclParty {
  courtId?: string;
  caseId?: number | string;
  caseYear?: number | string;
  caseNumber?: number | string;
  caseNumberFull?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  partyRole?: string;
  jurisdictionType?: string;
  caseTitle?: string;
  caseType?: string;
  dateFiled?: string;
  effectiveDateClosed?: string;
  natureOfSuit?: string;
  courtCase?: {
    courtId?: string;
    caseId?: number | string;
    caseYear?: number | string;
    caseNumber?: number | string;
    caseNumberFull?: string;
    caseTitle?: string;
    caseType?: string;
    dateFiled?: string;
    effectiveDateClosed?: string;
    natureOfSuit?: string;
    jurisdictionType?: string;
  };
}

interface PclPartyResponse {
  content?: PclParty[];
  receipt?: {
    searchFee?: string;
    reportId?: string;
  };
  pageInfo?: {
    totalElements?: number;
  };
}

let cachedToken: { value: string; environment: PacerEnvironment; expiresAt: number } | null = null;
const PACER_TOKEN_CACHE_MS = 20 * 60_000;
const PACER_REQUEST_TIMEOUT_MS = 12_000;

function pacerEnvironment(): PacerEnvironment {
  return process.env.PACER_ENVIRONMENT?.trim().toLowerCase() === 'qa' ? 'qa' : 'production';
}

function pacerEndpoints(environment: PacerEnvironment): { auth: string; pcl: string } {
  return environment === 'qa'
    ? {
        auth: 'https://qa-login.uscourts.gov/services/cso-auth',
        pcl: 'https://qa-pcl.uscourts.gov/pcl-public-api/rest',
      }
    : {
        auth: 'https://pacer.login.uscourts.gov/services/cso-auth',
        pcl: 'https://pcl.uscourts.gov/pcl-public-api/rest',
      };
}

function splitName(fullName: string): { firstName?: string; middleName?: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const lastName = parts.pop() || fullName.trim();
  const firstName = parts.shift();
  const middleName = parts.length ? parts.join(' ') : undefined;
  return { firstName, middleName, lastName };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PACER_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function authenticatePacer(environment: PacerEnvironment): Promise<string> {
  if (
    cachedToken
    && cachedToken.environment === environment
    && cachedToken.expiresAt > Date.now()
  ) {
    return cachedToken.value;
  }

  const loginId = process.env.PACER_USERNAME?.trim();
  const password = process.env.PACER_PASSWORD?.trim();
  if (!loginId || !password) throw new Error('PACER credentials are not configured');

  const { auth } = pacerEndpoints(environment);
  const body: Record<string, string> = {
    loginId,
    password,
    redactFlag: '1',
  };
  const clientCode = process.env.PACER_CLIENT_CODE?.trim();
  const otpCode = process.env.PACER_OTP_CODE?.trim();
  if (clientCode) body.clientCode = clientCode;
  if (otpCode) body.otpCode = otpCode;

  const response = await fetchWithTimeout(auth, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`PACER authentication HTTP ${response.status}`);

  const payload = await response.json() as PacerAuthResponse;
  const token = String(payload.nextGenCSO || '').trim();
  if (payload.loginResult !== '0' || !token) {
    throw new Error(payload.errorDescription || 'PACER authentication failed');
  }

  cachedToken = {
    value: token,
    environment,
    expiresAt: Date.now() + PACER_TOKEN_CACHE_MS,
  };
  return token;
}

async function searchPacerParties(
  query: CriminalSearchQuery,
  environment: PacerEnvironment,
  allowReauth = true,
): Promise<PclPartyResponse> {
  const token = await authenticatePacer(environment);
  const { pcl } = pacerEndpoints(environment);
  const name = splitName(query.fullName);
  const body: Record<string, unknown> = {
    lastName: name.lastName,
    ...(name.firstName ? { firstName: name.firstName } : {}),
    ...(name.middleName ? { middleName: name.middleName } : {}),
  };

  const response = await fetchWithTimeout(`${pcl}/parties/find?page=0`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-NEXT-GEN-CSO': token,
    },
    body: JSON.stringify(body),
  });

  if ((response.status === 401 || response.status === 403) && allowReauth) {
    cachedToken = null;
    return searchPacerParties(query, environment, false);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`PACER PCL search HTTP ${response.status}: ${detail}`);
  }
  return response.json() as Promise<PclPartyResponse>;
}

export class PACERScraper extends LegacyScraperAdapter {
  protected sourceName = 'PACER Case Locator (Federal Courts)';
  protected baseConfidence = 0.95;

  /**
   * Uses PACER's supported Authentication and PCL REST APIs. The Page argument
   * remains only for LegacyScraperAdapter compatibility and is intentionally
   * unused; browser scraping is not part of this route.
   *
   * Production PCL searches are billable. No request is made unless PACER
   * credentials are explicitly configured.
   */
  async search(query: CriminalSearchQuery, _page: Page): Promise<ScraperResult> {
    if (!process.env.PACER_USERNAME?.trim() || !process.env.PACER_PASSWORD?.trim()) {
      return this.createResult([], false, 'PACER credentials not configured');
    }

    try {
      const environment = pacerEnvironment();
      const payload = await searchPacerParties(query, environment);
      const parties = Array.isArray(payload.content) ? payload.content : [];

      const records = parties.map(party => {
        const courtCase = party.courtCase || {};
        const caseTitle = courtCase.caseTitle || party.caseTitle;
        const caseNumber = courtCase.caseNumberFull || party.caseNumberFull;
        const courtId = courtCase.courtId || party.courtId;
        const dateFiled = courtCase.dateFiled || party.dateFiled;
        return {
          fullName: [party.firstName, party.middleName, party.lastName].filter(Boolean).join(' ') || query.fullName,
          source: this.sourceName,
          confidence: this.baseConfidence,
          scrapedAt: new Date(),
          charges: [],
          arrests: [],
          convictions: [],
          activeWarrants: [],
          incarcerationHistory: [],
          sexOffenderStatus: { registered: false },
          federalCase: {
            courtId,
            caseNumber,
            caseTitle,
            caseType: courtCase.caseType || party.caseType,
            jurisdictionType: courtCase.jurisdictionType || party.jurisdictionType,
            dateFiled,
            effectiveDateClosed: courtCase.effectiveDateClosed || party.effectiveDateClosed,
            natureOfSuit: courtCase.natureOfSuit || party.natureOfSuit,
            partyRole: party.partyRole,
          },
        };
      });

      return this.createResult(records, true);
    } catch (error) {
      return this.createResult(
        [],
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
