import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { load } from 'cheerio';
import * as pdfjsModule from 'pdfjs-dist/build/pdf.js';
// Node 20 exposes this CommonJS package through its default namespace.
const { getDocument } = ((pdfjsModule as any).default || pdfjsModule) as typeof pdfjsModule;

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
const REQUEST_TIMEOUT_MS = 1_500;

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

async function textFromPdf(buffer: Buffer): Promise<string> {
  const task = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: true });
  const document = await task.promise;
  try {
    const pages: string[] = [];
    for (let page = 1; page <= Math.min(document.numPages, 20); page++) {
      const content = await (await document.getPage(page)).getTextContent();
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
      if (pages.join(' ').length >= MAX_CONTENT_CHARACTERS) break;
    }
    return pages.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CONTENT_CHARACTERS);
  } finally { await document.destroy(); }
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
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const length = Number(response.headers.get('content-length') || 0);
      if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) return null;
      const contentType = response.headers.get('content-type') || '';
      // Bound bytes while reading, including responses without Content-Length.
      if (!response.body) return null;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); return null; }
        chunks.push(value);
      }
      const buffer = Buffer.concat(chunks);
      const content = /application\/pdf/i.test(contentType) || buffer.subarray(0, 5).toString() === '%PDF-'
        ? await textFromPdf(buffer)
        : textFromResponse(buffer.toString('utf8'), contentType);
      if (!content) { console.info('[LEXARA Retrieval]', { host: current.hostname, outcome: 'no-extractable-text', contentType }); return null; }
      return {
        target,
        content,
        retrievedAt: new Date().toISOString(),
        contentType,
      };
    } catch (error) {
      console.warn('[LEXARA Retrieval]', { host: current.hostname, outcome: controller.signal.aborted ? 'cancelled-or-timeout' : 'failed', error: error instanceof Error ? error.message : String(error) });
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

