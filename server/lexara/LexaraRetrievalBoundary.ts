import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { load } from 'cheerio';

export interface LexaraRetrievalEvidence {
  target: string;
  content: string;
  retrievedAt: string;
  contentType?: string;
}

export interface LexaraRetrievalResponse {
  evidence: LexaraRetrievalEvidence[];
}

const MAX_TARGETS = 6;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_CONTENT_CHARACTERS = 120_000;
const MAX_REDIRECTS = 3;
// Public registries are often slower than search APIs. Keep this bounded, but
// avoid manufacturing false negatives with an unrealistically short fetch window.
const REQUEST_TIMEOUT_MS = 2_500;

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Lexara retrieval requires HTTP(S).');
  if (url.username || url.password) throw new Error('Lexara retrieval rejects credential-bearing URLs.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Lexara retrieval rejects local hosts.');
  }
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('Lexara retrieval rejects private network targets.');
    return url;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(result => isPrivateAddress(result.address))) {
    throw new Error('Lexara retrieval rejected a non-public resolved address.');
  }
  return url;
}

function textFromResponse(raw: string, contentType: string): string {
  const bounded = raw.slice(0, MAX_CONTENT_CHARACTERS);
  if (/html|xhtml/i.test(contentType)) {
    const $ = load(bounded);
    $('script,style,noscript,svg,canvas').remove();
    return $('body').text().replace(/\s+/g, ' ').trim().slice(0, MAX_CONTENT_CHARACTERS);
  }
  if (/json|xml|text|javascript/i.test(contentType)) {
    return bounded.replace(/\s+/g, ' ').trim();
  }
  return '';
}

async function retrieveOne(target: string, parentSignal?: AbortSignal): Promise<LexaraRetrievalEvidence | null> {
  let current = await assertPublicUrl(target);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const controller = new AbortController();
    const relayAbort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) controller.abort(parentSignal.reason);
    else parentSignal?.addEventListener('abort', relayAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Lexara retrieval timeout')), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.2',
          'user-agent': 'LegalWhat-Lexara/1.0',
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirectCount === MAX_REDIRECTS) return null;
        current = await assertPublicUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) return null;
      const length = Number(response.headers.get('content-length') || 0);
      if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) return null;
      const contentType = response.headers.get('content-type') || '';
      const raw = await response.text();
      if (raw.length > MAX_RESPONSE_BYTES) return null;
      const content = textFromResponse(raw, contentType);
      if (!content) return null;
      return {
        target,
        content,
        retrievedAt: new Date().toISOString(),
        contentType,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', relayAbort);
    }
  }
  return null;
}

export const lexaraRetrievalAdapter = {
  async retrieve(request: {
    purpose: 'lexara_legal_research';
    targets: string[];
    signal?: AbortSignal;
  }): Promise<LexaraRetrievalResponse> {
    if (request.purpose !== 'lexara_legal_research') {
      throw new Error('Lexara retrieval only serves Lexara legal research.');
    }
    const targets = [...new Set(request.targets)].slice(0, MAX_TARGETS);
    const settled = await Promise.allSettled(targets.map(target => retrieveOne(target, request.signal)));
    return {
      evidence: settled.flatMap(result =>
        result.status === 'fulfilled' && result.value ? [result.value] : []
      ),
    };
  },
};
