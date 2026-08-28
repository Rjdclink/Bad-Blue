export type EnvironmentVisibilityState = 'NOT_EXPECTED' | 'NOT_VISIBLE' | 'INVALID_FORMAT' | 'VISIBLE';

export type ProviderRuntimeState =
  | 'NOT_EXPECTED'
  | 'NOT_VISIBLE'
  | 'INVALID_FORMAT'
  | 'AUTHENTICATION_REJECTED'
  | 'INSUFFICIENT_PERMISSION'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'NETWORK_FAILURE'
  | 'LIVE';

export interface EnvironmentResolution {
  canonicalName: string;
  state: EnvironmentVisibilityState;
  sourceName: string | null;
  visibleLength: number | null;
  aliasesChecked: string[];
}

export interface ProviderCredentialDiagnostic extends EnvironmentResolution {
  providerState: ProviderRuntimeState;
  detail: string;
}

function nonEmpty(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/**
 * Resolves one canonical variable and its supported aliases without returning or
 * logging the secret value. Visibility is deliberately not called LIVE; only an
 * authenticated provider probe is allowed to promote providerState to LIVE.
 */
export function resolveEnvironmentVariable(input: {
  canonicalName: string;
  aliases?: readonly string[];
  expected?: boolean;
  minLength?: number;
}): EnvironmentResolution {
  const aliases = [...new Set([input.canonicalName, ...(input.aliases || [])])];
  if (input.expected === false) {
    return {
      canonicalName: input.canonicalName,
      state: 'NOT_EXPECTED',
      sourceName: null,
      visibleLength: null,
      aliasesChecked: aliases,
    };
  }

  const sourceName = aliases.find(name => nonEmpty(name)) || null;
  if (!sourceName) {
    return {
      canonicalName: input.canonicalName,
      state: 'NOT_VISIBLE',
      sourceName: null,
      visibleLength: null,
      aliasesChecked: aliases,
    };
  }

  const value = nonEmpty(sourceName)!;
  const minLength = Math.max(1, input.minLength ?? 1);
  return {
    canonicalName: input.canonicalName,
    state: value.length >= minLength ? 'VISIBLE' : 'INVALID_FORMAT',
    sourceName,
    visibleLength: value.length,
    aliasesChecked: aliases,
  };
}

export const COINSTATS_ENV_ALIASES = Object.freeze([
  'COINSTATS_API_KEY_PROD',
  'COINSTATS_API_KEY_PRODUCTION',
  'COINSTATS_PROD_API_KEY',
  'COINSTATS_API_KEY_STAGING',
  'COINSTATS_API_KEY_DEV',
  'COIN_STATS_API_KEY',
  'COINSTATS_KEY',
  'COIN_STATS_KEY',
  'COINSTATS_APIKEY',
  'COIN_STATS_APIKEY',
]);

export function resolveCoinStatsEnvironment(): EnvironmentResolution {
  return resolveEnvironmentVariable({
    canonicalName: 'COINSTATS_API_KEY',
    aliases: COINSTATS_ENV_ALIASES,
    expected: true,
    minLength: 8,
  });
}

export function adoptResolvedEnvironmentVariable(resolution: EnvironmentResolution): boolean {
  if (resolution.state !== 'VISIBLE' || !resolution.sourceName) return false;
  if (process.env[resolution.canonicalName]?.trim()) return false;
  const sourceValue = process.env[resolution.sourceName]?.trim();
  if (!sourceValue) return false;
  process.env[resolution.canonicalName] = sourceValue;
  return true;
}

export function providerCredentialDiagnostic(
  resolution: EnvironmentResolution,
  providerState?: ProviderRuntimeState,
  detail?: string,
): ProviderCredentialDiagnostic {
  const inferred: ProviderRuntimeState = providerState || (
    resolution.state === 'NOT_EXPECTED'
      ? 'NOT_EXPECTED'
      : resolution.state === 'NOT_VISIBLE'
        ? 'NOT_VISIBLE'
        : resolution.state === 'INVALID_FORMAT'
          ? 'INVALID_FORMAT'
          : 'PROVIDER_UNAVAILABLE'
  );
  return {
    ...resolution,
    providerState: inferred,
    detail: detail || (resolution.state === 'VISIBLE'
      ? 'credential is visible but has not yet been authenticated by the provider'
      : `environment state is ${resolution.state}`),
  };
}
