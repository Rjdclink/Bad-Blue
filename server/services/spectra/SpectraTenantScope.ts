export interface SpectraTenantScope {
  tenantId: string;
  actorUserId: string;
  model: 'user-v1';
}

function normalizeId(value: unknown, maxLength = 240): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function createSpectraTenantScope(
  userId: string,
): SpectraTenantScope {
  const actorUserId = normalizeId(userId);
  if (!actorUserId) throw new Error('SPECTRA authenticated user ID is required.');

  // v1 intentionally treats one authenticated LegalWhat user as one isolated
  // SPECTRA tenant. Keeping the tenant concept explicit prevents accidental
  // process-global/session-only access assumptions and allows a future
  // organization resolver to change the mapping without changing route contracts.
  return {
    tenantId: actorUserId,
    actorUserId,
    model: 'user-v1',
  };
}

export function spectraTenantOwns(
  scope: SpectraTenantScope,
  storedUserId: unknown,
): boolean {
  const stored = normalizeId(storedUserId);
  return Boolean(stored) && stored === scope.tenantId;
}
