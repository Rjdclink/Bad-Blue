/**
 * Breach Data Module
 * Cross-references with data breach databases
 * SpiderFoot plugin pattern
 */

import { createLogger } from '../../../logger';
import type { LegalIntelligenceModule, IntelligenceEvent } from '../types';
import { breachDetection } from '../../breachDetection';

const logger = createLogger('BreachDataModule');

class BreachDataModuleImpl implements LegalIntelligenceModule {
  name = 'BreachDataModule';
  description = 'Cross-references entities with data breach databases';
  inputTypes = ['entity.person.discovered', 'entity.officer.discovered'];
  outputTypes = ['breach.discovered', 'entity.risk.updated'];

  async setup(): Promise<void> {
    logger.info('Breach Data Module initialized');
  }

  async handleEvent(event: IntelligenceEvent): Promise<IntelligenceEvent[]> {
    const resultEvents: IntelligenceEvent[] = [];

    try {
      logger.debug(`Processing breach check event: ${event.type}`);

      const entityData = event.data;
      const email = entityData.email || entityData.properties?.email;

      if (email) {
        // Check for breaches
        const breachResult = await breachDetection.checkBreaches(email);
        
        if (breachResult.breached && breachResult.breaches.length > 0) {
          resultEvents.push({
            id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'breach.discovered',
            entityId: event.entityId,
            data: {
              email,
              breaches: breachResult.breaches,
              riskLevel: breachResult.breaches.length > 3 ? 'high' : 'medium',
            },
            sourceModule: this.name,
            timestamp: new Date(),
            processed: false,
          });
        }
      }

      logger.info(`Breach Data Module produced ${resultEvents.length} events`);
    } catch (error) {
      logger.error('Error in Breach Data Module:', error);
    }

    return resultEvents;
  }

  async enrichData(data: any): Promise<any> {
    return {
      ...data,
      breachChecked: true,
      checkedAt: new Date().toISOString(),
    };
  }

  async shutdown(): Promise<void> {
    logger.info('Breach Data Module shutdown');
  }
}

export const breachDataModule = new BreachDataModuleImpl();
