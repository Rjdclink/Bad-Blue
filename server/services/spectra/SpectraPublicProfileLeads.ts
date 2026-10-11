import { suppliedBlueskyProfile } from './SpectraPublicAccountRecords';
import { suppliedMastodonProfile } from './SpectraPublicMastodonRecords';

/** Canonicalize profile URLs found by a search provider before direct API reads. */
export function publicProfileLeads(
  urls: readonly string[],
  platform: 'bluesky' | 'mastodon',
  excluded: readonly string[] = [],
  limit = 2,
): string[] {
  const seen = new Set(excluded);
  const profiles: string[] = [];
  for (const raw of urls.slice(0, 160)) {
    try {
      const source = new URL(raw);
      if (source.protocol !== 'https:' || source.username || source.password) continue;
      if (platform === 'bluesky' && !source.pathname.startsWith('/profile/')) continue;
      if (platform === 'mastodon' && !/^\/@[a-z0-9_]{1,30}(?:\/|$)/i.test(source.pathname)) continue;
      const candidate = platform === 'bluesky'
        ? source.hostname === 'bsky.app' ? suppliedBlueskyProfile(raw) : null
        : suppliedMastodonProfile(raw);
      if (!candidate) continue;
      const profile = new URL(candidate.url);
      if (profile.origin !== source.origin || seen.has(profile.toString())) continue;
      seen.add(profile.toString());
      profiles.push(profile.toString());
      if (profiles.length >= limit) break;
    } catch { /* Invalid search lead; continue with independent results. */ }
  }
  return profiles;
}
