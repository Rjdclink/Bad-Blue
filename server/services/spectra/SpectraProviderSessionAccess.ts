interface ProviderSessionBinding {
  providerId: string;
  sessionId: string;
  tenantId?: string;
}

function normalize(value: unknown, max = 240): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function configuredBindings(): ProviderSessionBinding[] {
  const raw = String(process.env.SPECTRA_PROVIDER_SESSION_BINDINGS || '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.slice(0, 2_000).flatMap((entry: any) => {
      const providerId = normalize(entry?.providerId, 200).toLowerCase();
      const sessionId = normalize(entry?.sessionId, 200);
      const tenantId = normalize(entry?.tenantId, 240);
      if (!providerId || !sessionId) return [];
      return [{
        providerId,
        sessionId,
        tenantId: tenantId || undefined,
      }];
    });
  } catch {
    return [];
  }
}

export function providerMayWriteOwnedSpectraSession(input: {
  providerId?: string;
  sessionId: string;
  ownerTenantId: string;
}): boolean {
  const providerId = normalize(input.providerId, 200).toLowerCase();
  const sessionId = normalize(input.sessionId, 200);
  const ownerTenantId = normalize(input.ownerTenantId, 240);

  if (!providerId || !sessionId || !ownerTenantId) return false;

  return configuredBindings().some(binding =>
    binding.providerId === providerId
    && binding.sessionId === sessionId
    && (!binding.tenantId || binding.tenantId === ownerTenantId)
  );
}

export function getConfiguredSpectraProviderSessionBindings(): Array<{
  providerId: string;
  sessionId: string;
  tenantScoped: boolean;
}> {
  return configuredBindings().map(binding => ({
    providerId: binding.providerId,
    sessionId: binding.sessionId,
    tenantScoped: Boolean(binding.tenantId),
  }));
}
