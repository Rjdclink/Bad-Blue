/**
 * THE 10 R.A.Z.O.R.S.
 *
 * Seed-generator “razors” (NOT per-seed fetch crawlers).
 *
 * Intent:
 * - Treat external seed sources as structured inputs
 * - Normalize + dedupe into a unified seed pool
 * - Score + select a capped batch per cycle
 * - Keep replay/audit capability via seeded RNG (no hidden randomness)
 *
 * Note:
 * - This module defines the frozen roster of 10 razors.
 * - It does NOT run continuously by itself.
 */

export type RazorSourceType =
  | 'bug_bounty_directories'
  | 'ct_logs'
  | 'public_dns_subdomain_datasets'
  | 'github_org_indexes'
  | 'github_repo_trees'
  | 'public_api_directories'
  | 'openapi_swagger_catalogs'
  | 'developer_documentation_portals'
  | 'sitemap_indexes'
  | 'archive_snapshot_services'
  | 'prime_security_txt'
  | 'prime_robots_txt';

export type SeedCandidate = {
  url: string;
  sourceType: RazorSourceType;
  discoveredAt: string; // ISO
  freshnessDays?: number;
  domainAuthorityHint?: number; // 0..1 optional
  structuralDepthHint?: number; // 0..10 optional
  notes?: string;
};

export type RazorInput = {
  /**
   * Optional “generator endpoints” (these are NOT the output seeds).
   * Example: a CT log endpoint, a bug bounty directory URL, a GitHub org listing URL, etc.
   */
  endpoints: string[];

  /**
   * Optional scoping hints.
   */
  allowHosts?: string[];
};

export type RazorOutcome = {
  razorName: string;
  sourceType: RazorSourceType;
  attempted: number;
  produced: number;
  errors: number;
  durationMs: number;
};

export type Razor = {
  name: string;
  sourceType: RazorSourceType;
  enabledByDefault: boolean;

  /**
   * One cycle of seed generation.
   * Must return *seed URLs only*.
   */
  generate(input: RazorInput): Promise<SeedCandidate[]>;
};

/**
 * Caine (overseer) — governance metadata.
 * Not a generator by itself; used by the orchestrator layer.
 */
export const CAINE_OVERSEER = {
  name: 'Caine',
  role: 'overseer',
  policy:
    'Approve/reject razor selection, enforce caps, require human gate for changes. Text-only advisor compatible.',
} as const;

/**
 * Seven-crawler initiative (ELITE) — chosen from the user-provided seed generator list.
 */
export const SEVEN_CRAWLER_INITIATIVE: readonly Razor[] = [
  {
    name: 'CTLogsRazor',
    sourceType: 'ct_logs',
    enabledByDefault: true,
    async generate() {
      return [];
    },
  },
  {
    name: 'PublicDnsSubdomainDatasetsRazor',
    sourceType: 'public_dns_subdomain_datasets',
    enabledByDefault: true,
    async generate() {
      return [];
    },
  },
  {
    name: 'GitHubOrganizationIndexesRazor',
    sourceType: 'github_org_indexes',
    enabledByDefault: true,
    async generate() {
      return [];
    },
  },
  {
    name: 'GitHubRepositoryTreesRazor',
    sourceType: 'github_repo_trees',
    enabledByDefault: true,
    async generate() {
      return [];
    },
  },
  {
    name: 'SitemapIndexesRazor',
    sourceType: 'sitemap_indexes',
    enabledByDefault: true,
    async generate() {
      return [];
    },
  },
  {
    name: 'PublicApiDirectoriesRazor',
    sourceType: 'public_api_directories',
    enabledByDefault: true,
    async generate() {
      return [];
    },
  },
  {
    name: 'ArchiveSnapshotServicesRazor',
    sourceType: 'archive_snapshot_services',
    enabledByDefault: true,
    async generate() {
      return [];
    },
  },
] as const;

/**
 * Two more prime candidates (added):
 * - security.txt discovery
 * - robots.txt discovery (sitemap pointers)
 */
export const PRIME_RAZORS: readonly Razor[] = [
  {
    name: 'SecurityTxtRazor',
    sourceType: 'prime_security_txt',
    enabledByDefault: true,
    async generate() {
      return [];
    },
  },
  {
    name: 'RobotsTxtRazor',
    sourceType: 'prime_robots_txt',
    enabledByDefault: true,
    async generate() {
      return [];
    },
  },
] as const;

/**
 * THE 10 R.A.Z.O.R.S. roster (frozen list).
 */
export const THE_10_RAZORS: readonly Razor[] = [
  ...SEVEN_CRAWLER_INITIATIVE,
  ...PRIME_RAZORS,
  {
    name: 'OpenApiSwaggerCatalogsRazor',
    sourceType: 'openapi_swagger_catalogs',
    enabledByDefault: true,
    async generate() {
      return [];
    },
  },
] as const;

if (THE_10_RAZORS.length !== 10) {
  throw new Error(`THE_10_RAZORS must contain exactly 10 entries (got ${THE_10_RAZORS.length})`);
}
