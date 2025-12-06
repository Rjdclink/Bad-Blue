/**
 * Correlation Engine Usage Examples
 * Demonstrates how to use the SpiderFoot-style correlation engine
 */

import {
  correlationEngine,
  correlationDatabase,
  correlationRulesEngine,
  createEntityGraph,
  createPatternDetectionEngine,
  enrichOfficerSearch,
  enrichPeopleSearch,
  enrichLegalResearch,
  enrichConsultation,
} from './index';
import type { EntityNode, EntityEdge, LegalIntelligenceModule } from './types';
import { publicRecordsModule } from './modules/publicRecordsModule';

/**
 * Example 1: Initialize and setup the correlation engine
 */
export async function initializeCorrelationEngine() {
  console.log('=== Example 1: Initialize Correlation Engine ===\n');
  
  // Initialize components
  await correlationDatabase.initialize();
  await correlationEngine.initialize();
  await correlationRulesEngine.initialize();
  
  console.log('✅ Correlation engine initialized');
  console.log('📊 Stats:', correlationEngine.getStats());
}

/**
 * Example 2: Create entities and relationships
 */
export async function createEntitiesAndRelationships() {
  console.log('\n=== Example 2: Create Entities and Relationships ===\n');
  
  // Create officer entity
  const officer: EntityNode = {
    id: 'officer_john_doe',
    type: 'officer',
    properties: {
      name: 'John Doe',
      badge: '1234',
      department: 'NYPD',
      rank: 'Sergeant',
    },
    confidence: 0.95,
    sources: ['roster', 'public_records'],
    discoveredAt: new Date(),
  };
  
  correlationDatabase.addEntity(officer);
  console.log('✅ Created officer entity:', officer.id);
  
  // Create lawsuit entity
  const lawsuit: EntityNode = {
    id: 'lawsuit_2024_cv_001',
    type: 'lawsuit',
    properties: {
      caseNumber: '2024-CV-001',
      plaintiff: 'Jane Smith',
      court: 'SDNY',
      filedDate: '2024-01-15',
    },
    confidence: 0.92,
    sources: ['pacer', 'court_records'],
    discoveredAt: new Date(),
  };
  
  correlationDatabase.addEntity(lawsuit);
  console.log('✅ Created lawsuit entity:', lawsuit.id);
  
  // Create relationship
  const edge: EntityEdge = {
    id: 'edge_officer_lawsuit_1',
    sourceId: officer.id,
    targetId: lawsuit.id,
    relationship: 'defendant',
    weight: 1.0,
    confidence: 0.95,
    evidenceIds: ['court_filing_123'],
    discoveredAt: new Date(),
  };
  
  correlationDatabase.addRelationship(edge);
  console.log('✅ Created relationship:', edge.relationship);
}

/**
 * Example 3: Register and use modules
 */
export async function useModules() {
  console.log('\n=== Example 3: Register and Use Modules ===\n');
  
  // Register module
  correlationEngine.registerModule(publicRecordsModule);
  console.log('✅ Registered module:', publicRecordsModule.name);
  
  // Emit event that module will handle
  await correlationEngine.emit(
    'entity.officer.discovered',
    { name: 'Test Officer', badge: '5678' },
    'TestSystem',
    'officer_test'
  );
  
  console.log('✅ Emitted event for module processing');
}

/**
 * Example 4: Build and analyze entity graph
 */
export async function analyzeEntityGraph() {
  console.log('\n=== Example 4: Build and Analyze Entity Graph ===\n');
  
  const graph = createEntityGraph();
  
  // Add multiple entities
  const entities: EntityNode[] = [
    {
      id: 'officer_alice',
      type: 'officer',
      properties: { name: 'Alice Johnson', department: 'NYPD' },
      confidence: 0.95,
      sources: ['test'],
      discoveredAt: new Date(),
    },
    {
      id: 'officer_bob',
      type: 'officer',
      properties: { name: 'Bob Smith', department: 'NYPD' },
      confidence: 0.93,
      sources: ['test'],
      discoveredAt: new Date(),
    },
    {
      id: 'dept_nypd',
      type: 'department',
      properties: { name: 'New York Police Department', city: 'New York' },
      confidence: 1.0,
      sources: ['official'],
      discoveredAt: new Date(),
    },
  ];
  
  entities.forEach(e => graph.addNode(e));
  
  // Add edges
  graph.addEdge({
    id: 'edge_alice_nypd',
    sourceId: 'officer_alice',
    targetId: 'dept_nypd',
    relationship: 'employed_by',
    weight: 1.0,
    confidence: 1.0,
    evidenceIds: ['roster'],
    discoveredAt: new Date(),
  });
  
  graph.addEdge({
    id: 'edge_bob_nypd',
    sourceId: 'officer_bob',
    targetId: 'dept_nypd',
    relationship: 'employed_by',
    weight: 1.0,
    confidence: 1.0,
    evidenceIds: ['roster'],
    discoveredAt: new Date(),
  });
  
  // Analyze graph
  const stats = graph.getStats();
  console.log('📊 Graph stats:', stats);
  
  // Find shortest path
  const path = graph.findShortestPath('officer_alice', 'officer_bob');
  console.log('🔍 Shortest path:', path);
  
  // Get central nodes
  const centralNodes = graph.findCentralNodes(3);
  console.log('⭐ Most central nodes:', centralNodes);
  
  // Detect communities
  const communities = graph.detectCommunities();
  console.log('👥 Communities detected:', communities.size);
  
  // Export for visualization
  const vizData = graph.exportForVisualization();
  console.log('📈 Visualization data ready:', vizData.nodes.length, 'nodes');
}

/**
 * Example 5: Apply correlation rules
 */
export async function applyCorrelationRules() {
  console.log('\n=== Example 5: Apply Correlation Rules ===\n');
  
  const entities: EntityNode[] = [
    {
      id: 'officer_rule_test',
      type: 'officer',
      properties: { name: 'Test Officer', lawsuitCount: 4 },
      confidence: 0.95,
      sources: ['test'],
      discoveredAt: new Date(),
    },
    {
      id: 'lawsuit_1',
      type: 'lawsuit',
      properties: { caseNumber: '2024-001' },
      confidence: 0.90,
      sources: ['test'],
      discoveredAt: new Date(),
    },
  ];
  
  const discoveredEdges = await correlationRulesEngine.applyRules(entities);
  console.log('✅ Rules applied, discovered relationships:', discoveredEdges.length);
  
  // Get rules stats
  const stats = correlationRulesEngine.getStats();
  console.log('📊 Rules stats:', stats);
}

/**
 * Example 6: Detect patterns
 */
export async function detectPatterns() {
  console.log('\n=== Example 6: Detect Patterns ===\n');
  
  const graph = createEntityGraph();
  
  // Create officer with multiple lawsuits (pattern)
  const officer: EntityNode = {
    id: 'officer_pattern',
    type: 'officer',
    properties: { name: 'Pattern Officer', lawsuitCount: 5 },
    confidence: 0.95,
    sources: ['test'],
    discoveredAt: new Date(),
  };
  
  graph.addNode(officer);
  
  // Add lawsuits
  for (let i = 0; i < 5; i++) {
    const lawsuit: EntityNode = {
      id: `lawsuit_pattern_${i}`,
      type: 'lawsuit',
      properties: { caseNumber: `2024-${i}` },
      confidence: 0.90,
      sources: ['test'],
      discoveredAt: new Date(Date.now() - i * 60 * 24 * 60 * 60 * 1000), // Spread over 2 months
    };
    
    graph.addNode(lawsuit);
    graph.addEdge({
      id: `edge_${i}`,
      sourceId: officer.id,
      targetId: lawsuit.id,
      relationship: 'defendant',
      weight: 1.0,
      confidence: 0.95,
      evidenceIds: ['court_records'],
      discoveredAt: new Date(),
    });
  }
  
  // Run pattern detection
  const patternEngine = createPatternDetectionEngine(graph);
  const patterns = await patternEngine.detectAllPatterns();
  
  console.log('🔍 Patterns detected:', patterns.length);
  patterns.forEach(p => {
    console.log(`  - ${p.type}: ${p.description} (confidence: ${p.confidence})`);
  });
}

/**
 * Example 7: Use integration helpers
 */
export async function useIntegrations() {
  console.log('\n=== Example 7: Use Integration Helpers ===\n');
  
  // Enrich officer search
  const officerEnrichment = await enrichOfficerSearch({
    officerName: 'John Doe',
    state: 'NY',
    department: 'NYPD',
  });
  
  console.log('👮 Officer search enrichment:');
  console.log(`  - Related lawsuits: ${officerEnrichment.relatedLawsuits.length}`);
  console.log(`  - Related complaints: ${officerEnrichment.relatedComplaints.length}`);
  console.log(`  - Patterns: ${officerEnrichment.patterns.length}`);
  console.log(`  - Correlation score: ${officerEnrichment.correlationScore.toFixed(2)}`);
  
  // Enrich people search
  const peopleEnrichment = await enrichPeopleSearch({
    personName: 'Jane Smith',
    email: 'jane@example.com',
  });
  
  console.log('\n👤 People search enrichment:');
  console.log(`  - Related entities: ${peopleEnrichment.relatedEntities.length}`);
  console.log(`  - Relationships: ${peopleEnrichment.relationshipMap.length}`);
  console.log(`  - Credibility score: ${peopleEnrichment.credibilityScore.toFixed(2)}`);
  
  // Enrich legal research
  const legalEnrichment = await enrichLegalResearch({
    query: 'excessive force statute of limitations',
    entities: ['NYPD', 'excessive force'],
  });
  
  console.log('\n📚 Legal research enrichment:');
  console.log(`  - Relevant entities: ${legalEnrichment.relevantEntities.length}`);
  console.log(`  - Related cases: ${legalEnrichment.relatedCases.length}`);
  console.log(`  - Context score: ${legalEnrichment.contextScore.toFixed(2)}`);
  
  // Enrich consultation
  const consultationEnrichment = await enrichConsultation({
    parties: [
      { name: 'John Doe', role: 'plaintiff' },
      { name: 'NYPD', role: 'defendant' },
    ],
    description: 'Civil rights violation case',
  });
  
  console.log('\n💼 Consultation enrichment:');
  console.log(`  - Identified entities: ${consultationEnrichment.identifiedEntities.length}`);
  console.log(`  - Suggested parties: ${consultationEnrichment.suggestedParties.length}`);
  console.log(`  - Case strength indicators: ${consultationEnrichment.caseStrengthIndicators.length}`);
}

/**
 * Run all examples
 */
export async function runAllExamples() {
  try {
    await initializeCorrelationEngine();
    await createEntitiesAndRelationships();
    await useModules();
    await analyzeEntityGraph();
    await applyCorrelationRules();
    await detectPatterns();
    await useIntegrations();
    
    console.log('\n✅ All examples completed successfully!\n');
    
    // Cleanup
    await correlationEngine.shutdown();
  } catch (error) {
    console.error('❌ Error running examples:', error);
  }
}

// Run examples if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples().then(() => process.exit(0));
}
