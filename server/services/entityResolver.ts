import { fuzzyMatcher } from './fuzzyMatch';
import { cacheService } from './redisCache';

export interface PersonEntity {
  names: string[];
  emails: string[];
  phones: string[];
  badges: string[];
  sources: string[];
  confidence: number;
  lastUpdated: Date;
}

export class EntityResolver {
  async resolvePerson(targetName: string, records: Array<{
    name: string;
    email?: string;
    phone?: string;
    badge?: string;
    source: string;
  }>): Promise<{
    primaryName: string;
    entity: PersonEntity;
  }> {
    const cacheKey = `entity:${targetName.toLowerCase().replace(/\s+/g, '-')}`;
    const cached = await cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const matches: Array<{ record: any; score: number }> = [];

    for (const record of records) {
      const match = fuzzyMatcher.matchName(targetName, record.name);
      if (match.score >= 70) {
        matches.push({ record, score: match.score });
      }
    }

    matches.sort((a, b) => b.score - a.score);

    const entity: PersonEntity = {
      names: [],
      emails: [],
      phones: [],
      badges: [],
      sources: [],
      confidence: 0,
      lastUpdated: new Date(),
    };

    for (const { record } of matches) {
      if (!entity.names.includes(record.name)) entity.names.push(record.name);
      if (record.email && !entity.emails.includes(record.email)) entity.emails.push(record.email);
      if (record.phone && !entity.phones.includes(record.phone)) entity.phones.push(record.phone);
      if (record.badge && !entity.badges.includes(record.badge)) entity.badges.push(record.badge);
      if (!entity.sources.includes(record.source)) entity.sources.push(record.source);
    }

    entity.confidence = matches.length > 0 
      ? Math.round(matches.reduce((sum, m) => sum + m.score, 0) / matches.length)
      : 0;

    const result = {
      primaryName: matches[0]?.record.name || targetName,
      entity,
    };

    await cacheService.set(cacheKey, result, 'warm');
    return result;
  }
}

export const entityResolver = new EntityResolver();
