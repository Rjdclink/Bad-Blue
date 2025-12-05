/**
 * Tests for ML Orchestration Workers
 * 
 * Tests for:
 * - ML Confidence Worker
 * - ML Routing Worker
 * - ML Clustering Worker
 * - F.M.I. NLP Worker
 */

import { describe, it, expect } from '@jest/globals';
import {
  scoreModelOutputs,
  rankModelOutputs,
  analyzeConfidence,
  confidenceHealthCheck,
  type ModelOutput
} from '../mlConfidenceWorkerOrchestration';
import {
  routeTask,
  batchRoute,
  updateModelCapabilities,
  getModelCapabilities,
  routingHealthCheck,
  type Task
} from '../mlRoutingWorker';
import {
  clusterEntities,
  detectRelationships,
  performClusteringAnalysis,
  linkEntitiesAcrossSources,
  findEntityByAttributes,
  clusteringHealthCheck,
  type Entity
} from '../mlClusteringWorker';
import {
  processFMIText,
  batchProcessFMITexts,
  fmiNlpHealthCheck,
  type FMITextInput
} from '../fmiNLPWorker';

// ============================================================================
// ML CONFIDENCE WORKER TESTS
// ============================================================================

describe('ML Confidence Worker for Orchestration', () => {
  it('should score model outputs with confidence metrics', async () => {
    const outputs: ModelOutput[] = [
      {
        modelName: 'model-1',
        response: 'This is a legal analysis considering Section 1983 claims under federal law.',
        timestamp: new Date()
      },
      {
        modelName: 'model-2',
        response: 'This is a legal analysis considering Section 1983 claims under federal law.',
        timestamp: new Date()
      },
      {
        modelName: 'model-3',
        response: 'This case involves potential civil rights violations.',
        timestamp: new Date()
      }
    ];

    const scores = await scoreModelOutputs(outputs, 'legal analysis Section 1983');

    expect(scores).toHaveLength(3);
    expect(scores[0].score).toBeGreaterThanOrEqual(0);
    expect(scores[0].score).toBeLessThanOrEqual(1);
    expect(scores[0].factors).toHaveProperty('consistency');
    expect(scores[0].factors).toHaveProperty('specificity');
    expect(scores[0].factors).toHaveProperty('coherence');
    expect(scores[0].factors).toHaveProperty('relevance');
  });

  it('should rank model outputs by confidence', async () => {
    const outputs: ModelOutput[] = [
      {
        modelName: 'detailed-model',
        response: 'Comprehensive legal analysis with multiple citations including 42 U.S.C. § 1983, discussing qualified immunity, state action requirements, and relevant case law. The analysis considers constitutional violations under the Fourth Amendment.',
        timestamp: new Date()
      },
      {
        modelName: 'brief-model',
        response: 'Section 1983 claim.',
        timestamp: new Date()
      }
    ];

    const scores = await scoreModelOutputs(outputs);
    const ranked = await rankModelOutputs(outputs, scores);

    expect(ranked).toHaveLength(2);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
    expect(ranked[0].confidenceScore).toBeGreaterThan(ranked[1].confidenceScore);
    expect(ranked[0].recommendedUse).toBe('primary');
  });

  it('should analyze confidence and provide recommendations', async () => {
    const outputs: ModelOutput[] = [
      {
        modelName: 'claude',
        response: 'The plaintiff has a strong Section 1983 claim based on constitutional violations.',
        timestamp: new Date()
      },
      {
        modelName: 'gemini',
        response: 'Strong Section 1983 claim exists due to constitutional violations.',
        timestamp: new Date()
      }
    ];

    const analysis = await analyzeConfidence(outputs);

    expect(analysis.rankedOutputs).toBeDefined();
    expect(analysis.consensusScore).toBeGreaterThanOrEqual(0);
    expect(analysis.consensusScore).toBeLessThanOrEqual(1);
    expect(analysis.recommendation).toHaveProperty('primaryModel');
    expect(analysis.recommendation).toHaveProperty('reasoning');
  });

  it('should pass health check', async () => {
    const health = await confidenceHealthCheck();
    expect(health.status).toBe('healthy');
  });
});

// ============================================================================
// ML ROUTING WORKER TESTS
// ============================================================================

describe('ML Routing Worker', () => {
  it('should route tasks to appropriate models', async () => {
    const task: Task = {
      id: 'test-task-1',
      type: 'legal-consultation',
      complexity: 'high',
      priority: 'urgent',
      requirements: {
        needsLegalExpertise: true
      }
    };

    const result = await routeTask(task);

    expect(result.decision).toBeDefined();
    expect(result.decision.primaryModel).toBeDefined();
    expect(result.decision.confidence).toBeGreaterThanOrEqual(0);
    expect(result.decision.confidence).toBeLessThanOrEqual(1);
    expect(result.decision.reasoning).toBeDefined();
    expect(result.alternativeRoutes).toBeDefined();
  });

  it('should recommend parallelization for high-priority legal tasks', async () => {
    const task: Task = {
      id: 'test-task-2',
      type: 'legal-consultation',
      complexity: 'high',
      priority: 'urgent'
    };

    const result = await routeTask(task);

    expect(result.decision.shouldParallelize).toBe(true);
    expect(result.decision.parallelModels).toBeDefined();
    if (result.decision.parallelModels) {
      expect(result.decision.parallelModels.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('should select fast models for urgent tasks', async () => {
    const task: Task = {
      id: 'test-task-3',
      type: 'fact-extraction',
      complexity: 'low',
      priority: 'urgent'
    };

    const result = await routeTask(task);

    expect(result.decision.primaryModel).toBeDefined();
    expect(result.decision.estimatedTime).toBeLessThan(2000); // Fast response expected
  });

  it('should batch route multiple tasks', async () => {
    const tasks: Task[] = [
      { id: 'task-1', type: 'legal-consultation', complexity: 'high', priority: 'normal' },
      { id: 'task-2', type: 'document-generation', complexity: 'medium', priority: 'normal' },
      { id: 'task-3', type: 'fact-extraction', complexity: 'low', priority: 'low' }
    ];

    const results = await batchRoute(tasks);

    expect(results.size).toBe(3);
    expect(results.has('task-1')).toBe(true);
    expect(results.has('task-2')).toBe(true);
    expect(results.has('task-3')).toBe(true);
  });

  it('should update model capabilities', () => {
    const capabilities = getModelCapabilities();
    const initialSuccessRate = capabilities[0].successRate;

    updateModelCapabilities(capabilities[0].modelName, {
      taskType: 'legal-consultation',
      successRate: 0.95
    });

    const updated = getModelCapabilities();
    // Success rate should move toward 0.95 (moving average)
    expect(updated[0].successRate).not.toBe(initialSuccessRate);
  });

  it('should pass health check', async () => {
    const health = await routingHealthCheck();
    expect(health.status).toBe('healthy');
  });
});

// ============================================================================
// ML CLUSTERING WORKER TESTS
// ============================================================================

describe('ML Clustering Worker', () => {
  it('should cluster similar entities', async () => {
    const entities: Entity[] = [
      {
        id: 'e1',
        type: 'person',
        name: 'John Doe',
        attributes: { email: 'john@example.com' },
        source: 'osint'
      },
      {
        id: 'e2',
        type: 'person',
        name: 'John Doe',
        attributes: { phone: '555-1234' },
        source: 'public-records'
      },
      {
        id: 'e3',
        type: 'person',
        name: 'Jane Smith',
        attributes: { email: 'jane@example.com' },
        source: 'osint'
      }
    ];

    const clusters = await clusterEntities(entities);

    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters[0].primaryEntity).toBeDefined();
    expect(clusters[0].relatedEntities).toBeDefined();
    expect(clusters[0].confidence).toBeGreaterThanOrEqual(0);
  });

  it('should detect relationships between entities', async () => {
    const entities: Entity[] = [
      {
        id: 'p1',
        type: 'person',
        name: 'John Doe',
        attributes: { employer: 'ACME Corp' },
        source: 'osint'
      },
      {
        id: 'o1',
        type: 'organization',
        name: 'ACME Corp',
        attributes: {},
        source: 'osint'
      }
    ];

    const relationships = await detectRelationships(entities);

    expect(relationships.length).toBeGreaterThan(0);
    expect(relationships[0].relationshipType).toBe('works-for');
    expect(relationships[0].strength).toBeGreaterThan(0);
  });

  it('should perform complete clustering analysis', async () => {
    const entities: Entity[] = [
      { id: 'e1', type: 'person', name: 'John Doe', attributes: {}, source: 's1' },
      { id: 'e2', type: 'person', name: 'John Doe', attributes: {}, source: 's2' },
      { id: 'e3', type: 'organization', name: 'ACME', attributes: {}, source: 's1' }
    ];

    const result = await performClusteringAnalysis(entities);

    expect(result.clusters).toBeDefined();
    expect(result.relationships).toBeDefined();
    expect(result.isolatedEntities).toBeDefined();
    expect(result.statistics).toBeDefined();
    expect(result.statistics.totalEntities).toBe(3);
  });

  it('should link entities across sources', async () => {
    const entitiesBySource = new Map<string, Entity[]>([
      ['osint', [
        { id: 'e1', type: 'person', name: 'John Doe', attributes: {}, source: 'osint' }
      ]],
      ['public-records', [
        { id: 'e2', type: 'person', name: 'John Doe', attributes: {}, source: 'public-records' }
      ]]
    ]);

    const linked = await linkEntitiesAcrossSources(entitiesBySource);

    expect(linked.size).toBeGreaterThan(0);
  });

  it('should find entities by attributes', async () => {
    const entities: Entity[] = [
      { id: 'e1', type: 'person', name: 'John Doe', attributes: { email: 'john@example.com' }, source: 's1' },
      { id: 'e2', type: 'person', name: 'Jane Smith', attributes: { email: 'jane@example.com' }, source: 's1' }
    ];

    const matches = await findEntityByAttributes(
      { type: 'person', name: 'John' },
      entities,
      0.5
    );

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].name).toContain('John');
  });

  it('should pass health check', async () => {
    const health = await clusteringHealthCheck();
    expect(health.status).toBe('healthy');
  });
});

// ============================================================================
// F.M.I. NLP WORKER TESTS
// ============================================================================

describe('F.M.I. NLP Worker', () => {
  it('should extract entities from legal text', async () => {
    const input: FMITextInput = {
      text: 'On January 15, 2024, Officer John Smith of the NYPD arrested Jane Doe at 123 Main Street. She stated "I didn\'t do it" according to the police report.',
      source: 'upload'
    };

    const result = await processFMIText(input);

    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.entities.some(e => e.type === 'person')).toBe(true);
    expect(result.entities.some(e => e.type === 'date')).toBe(true);
    expect(result.entities.some(e => e.type === 'agency')).toBe(true);
  });

  it('should extract relationships from text', async () => {
    const input: FMITextInput = {
      text: 'Officer Smith arrested Jane Doe. The prosecutor charged her with assault.',
      source: 'upload'
    };

    const result = await processFMIText(input);

    expect(result.relationships.length).toBeGreaterThan(0);
    expect(result.relationships[0]).toHaveProperty('subject');
    expect(result.relationships[0]).toHaveProperty('action');
    expect(result.relationships[0]).toHaveProperty('target');
  });

  it('should build timeline from events', async () => {
    const input: FMITextInput = {
      text: 'On January 1, 2024, the incident occurred. On February 15, 2024, charges were filed. On March 1, 2024, the hearing was held.',
      source: 'upload'
    };

    const result = await processFMIText(input);

    expect(result.timeline.length).toBeGreaterThan(0);
    expect(result.timeline[0]).toHaveProperty('date');
    expect(result.timeline[0]).toHaveProperty('event');
    expect(result.timeline[0]).toHaveProperty('importance');
  });

  it('should extract keyphrases', async () => {
    const input: FMITextInput = {
      text: 'The plaintiff alleges violations of civil rights under Section 1983. The defendant denies all allegations and claims qualified immunity.',
      source: 'upload'
    };

    const result = await processFMIText(input);

    expect(result.keyphrases.length).toBeGreaterThan(0);
    expect(result.keyphrases[0]).toHaveProperty('phrase');
    expect(result.keyphrases[0]).toHaveProperty('relevance');
    expect(result.keyphrases[0]).toHaveProperty('category');
  });

  it('should tag evidentiary content', async () => {
    const input: FMITextInput = {
      text: 'He threatened to harm me. I admit I was there. The witness said something different than what the report states.',
      source: 'upload'
    };

    const result = await processFMIText(input);

    expect(result.evidentiaryTags.length).toBeGreaterThan(0);
    expect(result.evidentiaryTags.some(t => t.type === 'threat')).toBe(true);
    expect(result.evidentiaryTags.some(t => t.type === 'admission')).toBe(true);
  });

  it('should extract legal entities (statutes, courts)', async () => {
    const input: FMITextInput = {
      text: 'Pursuant to 42 U.S.C. § 1983, the plaintiff filed in the District Court for the Southern District of New York.',
      source: 'upload'
    };

    const result = await processFMIText(input);

    expect(result.entities.some(e => e.type === 'statute')).toBe(true);
    expect(result.entities.some(e => e.type === 'court')).toBe(true);
  });

  it('should extract contact information', async () => {
    const input: FMITextInput = {
      text: 'Contact John Doe at john.doe@example.com or 555-123-4567 for more information.',
      source: 'upload'
    };

    const result = await processFMIText(input);

    expect(result.entities.some(e => e.type === 'email')).toBe(true);
    expect(result.entities.some(e => e.type === 'phone')).toBe(true);
  });

  it('should batch process multiple texts', async () => {
    const inputs: FMITextInput[] = [
      { text: 'Officer Smith arrested Jane Doe on January 1, 2024.', source: 'upload' },
      { text: 'The court issued a ruling on February 15, 2024.', source: 'upload' }
    ];

    const results = await batchProcessFMITexts(inputs);

    expect(results.length).toBe(2);
    expect(results[0].entities.length).toBeGreaterThan(0);
    expect(results[1].entities.length).toBeGreaterThan(0);
  });

  it('should generate comprehensive summary', async () => {
    const input: FMITextInput = {
      text: 'On January 1, 2024, Officer Smith of NYPD arrested Jane Doe. She threatened the officer. Section 1983 claims were filed in District Court.',
      source: 'upload'
    };

    const result = await processFMIText(input);

    expect(result.summary).toBeDefined();
    expect(result.summary.totalEntities).toBeGreaterThan(0);
    expect(result.summary.keyIssues).toBeDefined();
    expect(result.summary.legalConcerns).toBeDefined();
  });

  it('should pass health check', async () => {
    const health = await fmiNlpHealthCheck();
    expect(health.status).toBe('healthy');
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('ML Workers Integration', () => {
  it('should integrate confidence scoring with routing', async () => {
    // Route a task
    const task: Task = {
      id: 'integration-test-1',
      type: 'legal-consultation',
      complexity: 'high',
      priority: 'urgent'
    };

    const routingResult = await routeTask(task);
    
    // Simulate model outputs
    const outputs: ModelOutput[] = routingResult.decision.parallelModels?.map(modelName => ({
      modelName,
      response: `Legal analysis from ${modelName}`,
      timestamp: new Date()
    })) || [];

    if (outputs.length > 0) {
      // Score and rank
      const analysis = await analyzeConfidence(outputs);
      
      expect(analysis.recommendation.primaryModel).toBeDefined();
      expect(analysis.rankedOutputs.length).toBe(outputs.length);
    }
  });

  it('should integrate NLP worker with clustering', async () => {
    // Process text with NLP
    const input: FMITextInput = {
      text: 'Officer John Smith and Officer Jane Doe both work at NYPD. Contact at 555-1234.',
      source: 'upload'
    };

    const nlpResult = await processFMIText(input);

    // Convert NLP entities to clustering entities
    const clusteringEntities: Entity[] = nlpResult.entities.map((e, i) => ({
      id: `entity-${i}`,
      type: e.type === 'person' ? 'person' : 
            e.type === 'organization' || e.type === 'agency' ? 'organization' :
            e.type === 'location' ? 'location' : 'document',
      name: e.value,
      attributes: { role: e.role },
      source: 'nlp',
      confidence: e.confidence
    }));

    // Cluster entities
    const clusters = await clusterEntities(clusteringEntities);

    expect(clusteringEntities.length).toBeGreaterThan(0);
    // We may or may not get clusters depending on similarity
  });
});
