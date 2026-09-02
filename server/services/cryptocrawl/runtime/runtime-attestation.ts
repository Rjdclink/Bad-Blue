export type RuntimeIdentityState = 'verified' | 'partial' | 'unknown' | 'mismatch';

export interface RuntimeAttestation {
  state: RuntimeIdentityState;
  observedAt: number;
  sourceSha: string | null;
  railwayCommitSha: string | null;
  deploymentId: string | null;
  serviceId: string | null;
  serviceName: string | null;
  environmentId: string | null;
  environmentName: string | null;
  replicaId: string | null;
  region: string | null;
  buildTimestamp: string | null;
  configSchemaVersion: string;
  evidence: string[];
  mismatches: string[];
}

const CONFIG_SCHEMA_VERSION = 'cryptocrawler-runtime-v1';
// These exact property reads are replaced by esbuild and become immutable
// artifact metadata. They are independent from Railway's runtime variables.
const EMBEDDED_SOURCE_SHA = process.env.CRYPTOCRAWLER_BUILD_SOURCE_SHA;
const EMBEDDED_BUILD_TIMESTAMP = process.env.CRYPTOCRAWLER_BUNDLE_BUILD_TIMESTAMP;

function visible(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function normalizeSha(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(normalized) ? normalized : null;
}

function sameCommit(left: string, right: string): boolean {
  return left === right || left.startsWith(right) || right.startsWith(left);
}

/**
 * Builds a non-secret runtime identity record from independent source/build and
 * deployment metadata. Railway's commit SHA is never copied into sourceSha: a
 * deployment cannot verify itself. `verified` on Railway requires the immutable
 * build-embedded source SHA to agree with Railway deployment metadata. Mutable
 * legacy source aliases are fallback diagnostics only when embedded evidence is
 * unavailable and can never override or veto valid embedded artifact identity.
 */
export function getCryptoCrawlerRuntimeAttestation(): RuntimeAttestation {
  const railwayCommitSha = normalizeSha(visible('RAILWAY_GIT_COMMIT_SHA'));
  const embeddedSourceSha = normalizeSha(EMBEDDED_SOURCE_SHA || null);
  const legacySourceCandidates = [
    normalizeSha(visible('CRYPTOCRAWLER_SOURCE_SHA')),
    normalizeSha(visible('SOURCE_VERSION')),
    normalizeSha(visible('GIT_COMMIT')),
    normalizeSha(visible('COMMIT_SHA')),
  ].filter((value): value is string => Boolean(value));
  const sourceSha = embeddedSourceSha || legacySourceCandidates[0] || null;
  const evidence: string[] = [];
  const mismatches: string[] = [];

  if (railwayCommitSha) evidence.push('railway_git_commit_sha');
  if (embeddedSourceSha) evidence.push('embedded_build_source_sha');
  else if (legacySourceCandidates.length > 0) evidence.push('source_sha');

  // Legacy runtime aliases can diagnose local/older builds only when the immutable
  // build identity is unavailable. Once an embedded SHA exists, mutable aliases
  // are intentionally non-authoritative and cannot create a false mismatch.
  if (!embeddedSourceSha) {
    for (const candidate of legacySourceCandidates.slice(1)) {
      if (sourceSha && !sameCommit(sourceSha, candidate)) {
        mismatches.push('source_sha_candidates_disagree');
        break;
      }
    }
  }
  if (sourceSha && railwayCommitSha && !sameCommit(sourceSha, railwayCommitSha)) {
    mismatches.push('source_sha_does_not_match_railway_commit');
  }

  const deploymentId = visible('RAILWAY_DEPLOYMENT_ID');
  const serviceId = visible('RAILWAY_SERVICE_ID');
  const serviceName = visible('RAILWAY_SERVICE_NAME') || visible('SERVICE_NAME');
  const environmentId = visible('RAILWAY_ENVIRONMENT_ID');
  const environmentName = visible('RAILWAY_ENVIRONMENT_NAME') || visible('RAILWAY_ENVIRONMENT');
  const replicaId = visible('RAILWAY_REPLICA_ID');
  const region = visible('RAILWAY_REPLICA_REGION') || visible('RAILWAY_REGION');
  const buildTimestamp = EMBEDDED_BUILD_TIMESTAMP
    || visible('CRYPTOCRAWLER_BUILD_TIMESTAMP')
    || visible('BUILD_TIMESTAMP');

  if (deploymentId) evidence.push('railway_deployment_id');
  if (serviceId || serviceName) evidence.push('railway_service_identity');
  if (environmentId || environmentName) evidence.push('railway_environment_identity');
  if (replicaId || region) evidence.push('railway_replica_identity');
  if (buildTimestamp) evidence.push('build_timestamp');

  const state: RuntimeIdentityState = mismatches.length > 0
    ? 'mismatch'
    : embeddedSourceSha && railwayCommitSha
      ? 'verified'
      : sourceSha || railwayCommitSha || deploymentId
        ? 'partial'
        : 'unknown';

  return {
    state,
    observedAt: Date.now(),
    sourceSha,
    railwayCommitSha,
    deploymentId,
    serviceId,
    serviceName,
    environmentId,
    environmentName,
    replicaId,
    region,
    buildTimestamp,
    configSchemaVersion: CONFIG_SCHEMA_VERSION,
    evidence,
    mismatches,
  };
}

export function isRuntimeIdentitySafe(attestation = getCryptoCrawlerRuntimeAttestation()): boolean {
  const railwayRuntime = Boolean(
    attestation.railwayCommitSha
      || attestation.deploymentId
      || attestation.serviceId
      || attestation.environmentId,
  );
  // Railway is an execution environment, so non-mismatch is insufficient:
  // the independently embedded artifact SHA must agree with deployment metadata.
  // Local/non-Railway tooling may remain usable when identity is unknown/partial.
  return railwayRuntime ? attestation.state === 'verified' : attestation.state !== 'mismatch';
}

export function isRuntimeIdentityVerified(attestation = getCryptoCrawlerRuntimeAttestation()): boolean {
  return attestation.state === 'verified';
}
