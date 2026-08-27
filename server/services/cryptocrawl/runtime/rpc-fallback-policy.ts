export interface RpcFallbackAdmissionInput {
  configuredUrl?: string;
  publicUrl?: string;
  allowPublicFallback: boolean;
}

export interface RpcFallbackAdmissionDecision {
  endpoint: string | null;
  source: 'configured' | 'public_opt_in' | 'disabled';
  priority: number | null;
  detail: string;
}

/**
 * Admit optional fallback RPCs without creating a default probe/log loop.
 * Explicitly configured endpoints always win. Anonymous public fallbacks are
 * available only when the operator opts in.
 */
export function resolveRpcFallbackAdmission(input: RpcFallbackAdmissionInput): RpcFallbackAdmissionDecision {
  const configured = input.configuredUrl?.trim();
  if (configured) {
    return {
      endpoint: configured,
      source: 'configured',
      priority: 8,
      detail: 'operator-configured RPC fallback admitted',
    };
  }

  const publicUrl = input.publicUrl?.trim();
  if (input.allowPublicFallback && publicUrl) {
    return {
      endpoint: publicUrl,
      source: 'public_opt_in',
      priority: 2,
      detail: 'anonymous public RPC fallback admitted by explicit opt-in',
    };
  }

  return {
    endpoint: null,
    source: 'disabled',
    priority: null,
    detail: publicUrl
      ? 'anonymous public RPC fallback disabled by default'
      : 'no RPC fallback endpoint is available',
  };
}
