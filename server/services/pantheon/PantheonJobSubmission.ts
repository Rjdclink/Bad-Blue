import { normalizePantheonSearchDepth, type PantheonSearchDepth } from '@shared/pantheonReportConfig';

export const PANTHEON_CONSENT_VERSION = 'pantheon-public-records-v1';

export interface ValidPantheonJobSubmission {
  name: string;
  location?: string;
  searchDepth: PantheonSearchDepth;
  idempotencyKey: string;
  consent: {
    accepted: true;
    version: typeof PANTHEON_CONSENT_VERSION;
    acceptedAt: string;
  };
}

function normalizeText(value: unknown, maximumLength: number): string {
  const normalized = String(value || '').normalize('NFKC').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (normalized.length > maximumLength) throw new Error('input_too_long');
  return normalized;
}

export function validatePantheonJobSubmission(
  body: unknown,
  idempotencyHeader?: unknown,
): ValidPantheonJobSubmission {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const name = normalizeText(input.name, 120);
  const location = normalizeText(input.location, 160);
  if (name.length < 2 || !/[\p{L}\p{N}]/u.test(name)) throw new Error('invalid_target_name');

  const rawDepth = Number(input.searchDepth);
  if (![1, 2, 3].includes(rawDepth)) throw new Error('invalid_search_depth');
  if (input.consent !== true) throw new Error('consent_required');

  const idempotencyKey = String(idempotencyHeader || input.idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new Error('invalid_idempotency_key');

  return {
    name,
    location: location || undefined,
    searchDepth: normalizePantheonSearchDepth(rawDepth),
    idempotencyKey,
    consent: {
      accepted: true,
      version: PANTHEON_CONSENT_VERSION,
      acceptedAt: new Date().toISOString(),
    },
  };
}
