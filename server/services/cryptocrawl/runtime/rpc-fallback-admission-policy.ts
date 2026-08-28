export interface RpcFallbackAdmissionInput {
  configuredUrl?: string | null;
  publicUrl?: string | null;
  allowAnonymousPublicFallback: boolean;
}

export interface RpcFallbackAdmission {
  httpUrl: string;
  provider: 'AnkrConfigured' | 'AnkrPublic';
  priority: number;
  provenance: 'configured' | 'explicit_public_fallback';
}

/**
 * Anonymous public RPC fallback must be an explicit operator choice. A configured
 * endpoint remains eligible by default; merely having a known public URL does not
 * authorize repeated production probes against it.
 */
export function admitAnkrFallback(input: RpcFallbackAdmissionInput): RpcFallbackAdmission | null {
  const configuredUrl = input.configuredUrl?.trim();
  if (configuredUrl) {
    return {
      httpUrl: configuredUrl,
      provider: 'AnkrConfigured',
      priority: 8,
      provenance: 'configured',
    };
  }

  const publicUrl = input.publicUrl?.trim();
  if (!input.allowAnonymousPublicFallback || !publicUrl) return null;
  return {
    httpUrl: publicUrl,
    provider: 'AnkrPublic',
    priority: 2,
    provenance: 'explicit_public_fallback',
  };
}
