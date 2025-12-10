/**
 * 4JI System Tests
 * 
 * Comprehensive test suite for:
 * - Domain sub-agents
 * - 4JI orchestrator
 * - Crawler system
 * - Self-optimization
 * - AI model orchestration
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { promises as fs } from 'fs';

// Test configuration
const DOMAINS_DIR = path.join(process.cwd(), 'domains');
const EXPECTED_DOMAINS = 30;

describe('Domain Structure', () => {
  it('should have 30 domain folders', async () => {
    const entries = await fs.readdir(DOMAINS_DIR, { withFileTypes: true });
    const domainFolders = entries.filter(e => e.isDirectory());
    expect(domainFolders.length).toBe(EXPECTED_DOMAINS);
  });
  
  it('should have required files in each domain', async () => {
    const entries = await fs.readdir(DOMAINS_DIR, { withFileTypes: true });
    const domainFolders = entries.filter(e => e.isDirectory());
    
    for (const folder of domainFolders) {
      const domainPath = path.join(DOMAINS_DIR, folder.name);
      
      // Check knowledge_base.json
      const kbPath = path.join(domainPath, 'knowledge_base.json');
      const kbExists = await fs.access(kbPath).then(() => true).catch(() => false);
      expect(kbExists, `${folder.name} should have knowledge_base.json`).toBe(true);
      
      // Check sub_agent.ts
      const saPath = path.join(domainPath, 'sub_agent.ts');
      const saExists = await fs.access(saPath).then(() => true).catch(() => false);
      expect(saExists, `${folder.name} should have sub_agent.ts`).toBe(true);
      
      // Check ui_config.json
      const uiPath = path.join(domainPath, 'ui_config.json');
      const uiExists = await fs.access(uiPath).then(() => true).catch(() => false);
      expect(uiExists, `${folder.name} should have ui_config.json`).toBe(true);
    }
  });
  
  it('should have valid JSON in knowledge_base files', async () => {
    const entries = await fs.readdir(DOMAINS_DIR, { withFileTypes: true });
    const domainFolders = entries.filter(e => e.isDirectory());
    
    for (const folder of domainFolders) {
      const kbPath = path.join(DOMAINS_DIR, folder.name, 'knowledge_base.json');
      
      try {
        const content = await fs.readFile(kbPath, 'utf-8');
        const parsed = JSON.parse(content);
        
        expect(parsed.domain).toBe(folder.name);
        expect(parsed.cases).toBeDefined();
        expect(parsed.statutes).toBeDefined();
        expect(parsed.templates).toBeDefined();
        expect(parsed.heuristics).toBeDefined();
      } catch (error) {
        throw new Error(`Invalid JSON in ${folder.name}/knowledge_base.json: ${error}`);
      }
    }
  });
  
  it('should have valid JSON in ui_config files', async () => {
    const entries = await fs.readdir(DOMAINS_DIR, { withFileTypes: true });
    const domainFolders = entries.filter(e => e.isDirectory());
    
    for (const folder of domainFolders) {
      const uiPath = path.join(DOMAINS_DIR, folder.name, 'ui_config.json');
      
      try {
        const content = await fs.readFile(uiPath, 'utf-8');
        const parsed = JSON.parse(content);
        
        expect(parsed.domain).toBe(folder.name);
        expect(parsed.theme).toBeDefined();
        expect(parsed.layout).toBeDefined();
        expect(parsed.features).toBeDefined();
      } catch (error) {
        throw new Error(`Invalid JSON in ${folder.name}/ui_config.json: ${error}`);
      }
    }
  });
});

describe('4JI Orchestrator', () => {
  it('should export required functions', async () => {
    const orchestrator = await import('../fourJIOrchestrator');
    
    expect(orchestrator.initializeOrchestrator).toBeDefined();
    expect(orchestrator.discoverDomains).toBeDefined();
    expect(orchestrator.loadSubAgent).toBeDefined();
    expect(orchestrator.launchSubAgent).toBeDefined();
    expect(orchestrator.parallelExecution).toBeDefined();
    expect(orchestrator.synchronizeCrawlerUpdate).toBeDefined();
    expect(orchestrator.performResearch).toBeDefined();
    expect(orchestrator.generateDraft).toBeDefined();
    expect(orchestrator.detectAndFixErrors).toBeDefined();
    expect(orchestrator.optimizeVisuals).toBeDefined();
    expect(orchestrator.getOrchestratorStatus).toBeDefined();
    expect(orchestrator.getAllDomainInfo).toBeDefined();
    
    // New neural pathway functions
    expect(orchestrator.getNeuralPathwayStatus).toBeDefined();
    expect(orchestrator.performNeuralLegalAnalysis).toBeDefined();
    expect(orchestrator.performNeuralPatternAnalysis).toBeDefined();
    expect(orchestrator.shutdownNeuralPathways).toBeDefined();
  });
  
  it('should discover all 30 domains', async () => {
    const orchestrator = await import('../fourJIOrchestrator');
    const domains = await orchestrator.discoverDomains();
    
    expect(domains.length).toBe(EXPECTED_DOMAINS);
  });
  
  it('should return neural pathway status', async () => {
    const orchestrator = await import('../fourJIOrchestrator');
    const status = orchestrator.getNeuralPathwayStatus();
    
    expect(status).toBeDefined();
    expect(typeof status.initialized).toBe('boolean');
  });
});

describe('Legal Crawler', () => {
  it('should export required functions', async () => {
    const crawler = await import('../legalCrawler');
    
    expect(crawler.initializeCrawler).toBeDefined();
    expect(crawler.runCrawlCycle).toBeDefined();
    expect(crawler.addCrawlerSource).toBeDefined();
    expect(crawler.removeCrawlerSource).toBeDefined();
    expect(crawler.setCrawlerEnabled).toBeDefined();
    expect(crawler.getCrawlerStatus).toBeDefined();
    expect(crawler.getCrawlerConfig).toBeDefined();
    expect(crawler.forceCrawlSource).toBeDefined();
    expect(crawler.shutdownCrawler).toBeDefined();
  });
  
  it('should have default sources configured', async () => {
    const crawler = await import('../legalCrawler');
    const config = crawler.getCrawlerConfig();
    
    expect(config.sources.length).toBeGreaterThan(0);
    expect(config.sources.some(s => s.type === 'case_law')).toBe(true);
    expect(config.sources.some(s => s.type === 'statutes')).toBe(true);
  });
});

describe('Self-Optimization', () => {
  it('should export required functions', async () => {
    const optimization = await import('../selfOptimization');
    
    expect(optimization.initializeSelfOptimization).toBeDefined();
    expect(optimization.runOptimizationCycle).toBeDefined();
    expect(optimization.getOptimizationStatus).toBeDefined();
    expect(optimization.getOptimizationConfig).toBeDefined();
    expect(optimization.getEvolutionLog).toBeDefined();
    expect(optimization.rollbackEvolution).toBeDefined();
    expect(optimization.triggerOptimization).toBeDefined();
    expect(optimization.setOptimizationEnabled).toBeDefined();
    expect(optimization.shutdownOptimization).toBeDefined();
  });
  
  it('should return valid status', async () => {
    const optimization = await import('../selfOptimization');
    const status = optimization.getOptimizationStatus();
    
    expect(status.currentHealth).toBeGreaterThanOrEqual(0);
    expect(status.currentHealth).toBeLessThanOrEqual(100);
    expect(status.metrics).toBeDefined();
  });
});

describe('AI Model Orchestration', () => {
  it('should export required functions', async () => {
    const orchestration = await import('../aiModelOrchestration');
    
    expect(orchestration.AI_MODELS).toBeDefined();
    expect(orchestration.getModelsForRole).toBeDefined();
    expect(orchestration.getBestModelForRole).toBeDefined();
    expect(orchestration.getAvailableModels).toBeDefined();
    expect(orchestration.executeWithModel).toBeDefined();
    expect(orchestration.executeParallelRoles).toBeDefined();
    expect(orchestration.mergeOutputs).toBeDefined();
    expect(orchestration.orchestrateQuery).toBeDefined();
    expect(orchestration.getModelStatus).toBeDefined();
  });
  
  it('should have models configured', async () => {
    const orchestration = await import('../aiModelOrchestration');
    
    expect(orchestration.AI_MODELS.length).toBeGreaterThan(0);
    
    // Check model structure
    for (const model of orchestration.AI_MODELS) {
      expect(model.id).toBeDefined();
      expect(model.name).toBeDefined();
      expect(model.provider).toBeDefined();
      expect(model.roles).toBeDefined();
      expect(model.roles.length).toBeGreaterThan(0);
    }
  });
  
  it('should return model status', async () => {
    const orchestration = await import('../aiModelOrchestration');
    const status = orchestration.getModelStatus();
    
    expect(status.total).toBe(orchestration.AI_MODELS.length);
    expect(status.byProvider).toBeDefined();
    expect(status.byRole).toBeDefined();
  });
});

describe('Domain Routes', () => {
  it('should export router', async () => {
    const routes = await import('../routes/domain.routes');
    expect(routes.default).toBeDefined();
  });
});

// Integration test - requires running server
describe.skip('Integration Tests', () => {
  it('should process a consultation request', async () => {
    // This would test the full flow from API to response
    // Skipped by default as it requires a running server
  });
  
  it('should run a crawl cycle', async () => {
    // This would test the crawler end-to-end
    // Skipped by default
  });
  
  it('should run optimization cycle', async () => {
    // This would test self-optimization
    // Skipped by default
  });
});
