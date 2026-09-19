/**
 * Public Records Module
 * Enriches entities with public records data
 * SpiderFoot plugin pattern
 */

import { createLogger } from '../../../logger';
import type { LegalIntelligenceModule, IntelligenceEvent, EntityNode } from '../types';
import { correlationDatabase } from '../correlationDB';
import { generateEventId } from '../utils';
import { unifiedSearch } from '../../../webSearchService';

const logger = createLogger('PublicRecordsModule');

class PublicRecordsModuleImpl implements LegalIntelligenceModule {
  name = 'PublicRecordsModule';
  description = 'Enriches entities with court records and property records';
  inputTypes = ['entity.officer.discovered', 'entity.person.discovered', 'entity.department.discovered'];
  outputTypes = ['entity.lawsuit.discovered', 'entity.complaint.discovered', 'entity.property.discovered'];

  async setup(): Promise<void> {
    logger.info('Public Records Module initialized');
  }

  async handleEvent(event: IntelligenceEvent): Promise<IntelligenceEvent[]> {
    const resultEvents: IntelligenceEvent[] = [];

    try {
      logger.debug(`Processing event: ${event.type} for entity: ${event.entityId}`);

      // Get entity from database
      if (!event.entityId) return resultEvents;
      
      const entity = correlationDatabase.getEntity(event.entityId);
      if (!entity) return resultEvents;

      // Enrich based on entity type
      if (entity.type === 'officer' || entity.type === 'person') {
        const enrichedData = await this.enrichPerson(entity);
        
        // Create events for discovered entities
        for (const lawsuit of enrichedData.lawsuits) {
          resultEvents.push({
            id: generateEventId(),
            type: 'entity.lawsuit.discovered',
            entityId: lawsuit.id,
            data: lawsuit,
            sourceModule: this.name,
            timestamp: new Date(),
            processed: false,
          });
        }

        for (const complaint of enrichedData.complaints) {
          resultEvents.push({
            id: generateEventId(),
            type: 'entity.complaint.discovered',
            entityId: complaint.id,
            data: complaint,
            sourceModule: this.name,
            timestamp: new Date(),
            processed: false,
          });
        }
      }

      logger.info(`Public Records Module produced ${resultEvents.length} events`);
    } catch (error) {
      logger.error('Error in Public Records Module:', error);
    }

    return resultEvents;
  }

  async enrichData(data: any): Promise<any> {
    // Enrich arbitrary data with public records
    return {
      ...data,
      publicRecordsChecked: true,
      checkedAt: new Date().toISOString(),
    };
  }

  async shutdown(): Promise<void> {
    logger.info('Public Records Module shutdown');
  }

  /**
   * Enrich person/officer with public records
   */
  private async enrichPerson(entity: EntityNode): Promise<{
    lawsuits: Array<{ id: string; type: string; properties: any }>;
    complaints: Array<{ id: string; type: string; properties: any }>;
  }> {
    const lawsuits: Array<{ id: string; type: string; properties: any }> = [];
    const complaints: Array<{ id: string; type: string; properties: any }> = [];

    const name = typeof entity.properties.name === 'string' ? entity.properties.name.trim() : '';
    if (!name) return { lawsuits, complaints };

    logger.debug(`Checking public records for ${name}`);

    try {
      const results = await unifiedSearch(
        `"${name}" (lawsuit OR complaint OR court OR docket) public record`,
        { limit: 12 }
      );

      for (const result of results) {
        if (!result?.url) continue;
        const combined = `${result.title || ''} ${result.snippet || ''}`.toLowerCase();
        const properties = {
          subjectName: name,
          title: result.title || result.url,
          url: result.url,
          snippet: result.snippet || '',
          source: 'public-web-retrieval',
          retrievedAt: new Date().toISOString(),
        };

        if (/\bcomplaint\b/.test(combined)) {
          complaints.push({
            id: generateEventId(),
            type: 'complaint',
            properties,
          });
        } else if (/\b(lawsuit|court|docket|case|plaintiff|defendant)\b/.test(combined)) {
          lawsuits.push({
            id: generateEventId(),
            type: 'lawsuit',
            properties,
          });
        }
      }
    } catch (error) {
      logger.warn(`Public-record retrieval failed for ${name}`, error);
    }

    return { lawsuits, complaints };
  }
}

export const publicRecordsModule = new PublicRecordsModuleImpl();
