/**
 * News Mentions Module
 * Searches news articles for entity mentions
 * SpiderFoot plugin pattern
 */

import { createLogger } from '../../../logger';
import type { LegalIntelligenceModule, IntelligenceEvent } from '../types';
import { unifiedSearch } from '../../../webSearchService';

const logger = createLogger('NewsMentionsModule');

class NewsMentionsModuleImpl implements LegalIntelligenceModule {
  name = 'NewsMentionsModule';
  description = 'Searches news articles and media mentions for entities';
  inputTypes = ['entity.officer.discovered', 'entity.department.discovered', 'entity.case.discovered'];
  outputTypes = ['news.mention.discovered', 'entity.enriched'];

  async setup(): Promise<void> {
    logger.info('News Mentions Module initialized');
  }

  async handleEvent(event: IntelligenceEvent): Promise<IntelligenceEvent[]> {
    const resultEvents: IntelligenceEvent[] = [];

    try {
      logger.debug(`Processing news search event: ${event.type}`);

      const entityData = event.data;
      const entityName = entityData.name || entityData.properties?.name;

      if (entityName) {
        // Search news for mentions
        const newsResults = await this.searchNews(entityName);
        
        if (newsResults.length > 0) {
          resultEvents.push({
            id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'news.mention.discovered',
            entityId: event.entityId,
            data: {
              entityName,
              mentions: newsResults,
              source: 'news_search',
            },
            sourceModule: this.name,
            timestamp: new Date(),
            processed: false,
          });
        }
      }

      logger.info(`News Mentions Module produced ${resultEvents.length} events`);
    } catch (error) {
      logger.error('Error in News Mentions Module:', error);
    }

    return resultEvents;
  }

  async enrichData(data: any): Promise<any> {
    return {
      ...data,
      newsChecked: true,
      checkedAt: new Date().toISOString(),
    };
  }

  async shutdown(): Promise<void> {
    logger.info('News Mentions Module shutdown');
  }

  /**
   * Search news for mentions of entity
   */
  private async searchNews(entityName: string): Promise<any[]> {
    try {
      const query = `"${entityName}" news`;
      const results = await unifiedSearch(query, { maxResults: 5 });
      return results.results || [];
    } catch (error) {
      logger.error('News search failed:', error);
      return [];
    }
  }
}

export const newsMentionsModule = new NewsMentionsModuleImpl();
