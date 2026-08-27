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
 * Builds a non-secret runtime identity record from deployment metadata already
 * exposed by the process environment. The attestation never invents a source
 * SHA: when build/runtime identity is unavailable it reports partial/unknown.
 */
export function getCryptoCrawlerRuntimeAttestation(): RuntimeAttestation {
  const railwayCommitSha = normalizeSha(visible('RAILWAY_GIT_COMMIT_SHA'));
  const sourceCandidates = [
    normalizeSha(visible('CRYPTOCRAWLER_SOURCE_SHA')),
    normalizeSha(visible('SOURCE_VERSION')),
    normalizeSha(visible('GIT_COMMIT')),
    normalizeSha(visible('COMMIT_SHA')),
  ].filter((value): value is string => Boolean(value));
  const sourceSha = sourceCandidates[0] || railwayCommitSha;
  const evidence: string[] = [];
  const mismatches: string[] = [];

  if (railwayCommitSha) evidence.push('railway_git_commit_sha');
  if (sourceCandidates.length > 0) evidence.push('source_sha');

  for (const candidate of sourceCandidates.slice(1)) {
    if (sourceSha && !sameCommit(sourceSha, candidate)) {
      mismatches.push('source_sha_candidates_disagree');
      break;
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
  const buildTimestamp = visible('CRYPTOCRAWLER_BUILD_TIMESTAMP') || visible('BUILD_TIMESTAMP');

  if (deploymentId) evidence.push('railway_deployment_id');
  if (serviceId || serviceName) evidence.push('railway_service_identity');
  if (environmentId || environmentName) evidence.push('railway_environment_identity');
  if (replicaId || region) evidence.push('railway_replica_identity');
  if (buildTimestamp) evidence.push('build_timestamp');

  const state: RuntimeIdentityState = mismatches.length > 0
    ? 'mismatch'
    : sourceSha && railwayCommitSha
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
  return attestation.state !== 'mismatch';
}
