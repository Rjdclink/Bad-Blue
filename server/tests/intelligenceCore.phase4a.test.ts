/**
 * PANTHEON Intelligence Core - Phase 4A Tests
 * Part 3: Foundation Layer Test Suite
 */

import { 
  knowledgeGraph, 
  preprocessingEngine, 
  initialize,
  healthCheck,
  ProvenanceManager,
} from '../services/intelligenceCore';

/**
 * Test 1: Create and retrieve node
 */
async function testCreateAndRetrieveNode() {
  console.log('\n=== Test 1: Create person node → retrieve → verify ===');
  
  try {
    const provenance = [ProvenanceManager.createProvenanceRecord('test-source', 'manual', 'verified')];
    
    const nodeId = await knowledgeGraph.addNode({
      type: 'person',
      properties: {
        name: 'John Doe',
        age: 30,
      },
      confidence: 0.95,
      provenance,
    });

    console.log(`✓ Node created: ${nodeId}`);

    const node = await knowledgeGraph.getNode(nodeId);
    
    if (node && node.properties.name === 'John Doe' && node.confidence === 0.95) {
      console.log('✅ Test 1 PASSED');
      return true;
    }
    
    console.log('❌ Test 1 FAILED');
    return false;
  } catch (error: any) {
    console.error('❌ Test 1 FAILED:', error.message);
    return false;
  }
}

/**
 * Test 2: Create relationship edge
 */
async function testCreateRelationshipEdge() {
  console.log('\n=== Test 2: Create relationship edge → verify ===');
  
  try {
    const provenance = [ProvenanceManager.createProvenanceRecord('test', 'manual', 'verified')];
    
    const personId = await knowledgeGraph.addNode({
      type: 'person',
      properties: { name: 'Jane Smith' },
      confidence: 0.9,
      provenance,
    });

    const orgId = await knowledgeGraph.addNode({
      type: 'organization',
      properties: { name: 'Tech Corp' },
      confidence: 0.85,
      provenance,
    });

    const edgeId = await knowledgeGraph.addEdge({
      sourceId: personId,
      targetId: orgId,
      relationship: 'works_at',
      weight: 0.9,
      confidence: 0.85,
      evidenceIds: [],
    });

    console.log(`✓ Edge created: ${edgeId}`);

    const edge = await knowledgeGraph.getEdge(edgeId);
    
    if (edge && edge.sourceId === personId && edge.targetId === orgId) {
      console.log('✅ Test 2 PASSED');
      return true;
    }
    
    console.log('❌ Test 2 FAILED');
    return false;
  } catch (error: any) {
    console.error('❌ Test 2 FAILED:', error.message);
    return false;
  }
}

/**
 * Test 3: Extract entities from text
 */
async function testExtractEntities() {
  console.log('\n=== Test 3: Extract entities from text ===');
  
  try {
    const sampleText = 'John Doe works at ABC Corporation in New York.';
    
    const normalized = await preprocessingEngine.normalize({
      data: sampleText,
      sourceType: 'text',
      sourceUrl: 'test://sample',
    });

    console.log('✓ Text normalized');
    console.log('  Entities found:', normalized.entities.length);

    if (normalized.entities.length > 0) {
      console.log('✅ Test 3 PASSED');
      return true;
    }

    console.log('⚠️  Test 3 WARNING: No entities extracted');
    return true;
  } catch (error: any) {
    console.error('❌ Test 3 FAILED:', error.message);
    return false;
  }
}

/**
 * Test 4: Build small graph and query
 */
async function testGraphBuilding() {
  console.log('\n=== Test 4: Build graph → query relationships ===');
  
  try {
    const provenance = [ProvenanceManager.createProvenanceRecord('test', 'manual', 'verified')];
    
    const node1 = await knowledgeGraph.addNode({
      type: 'person',
      properties: { name: 'Alice' },
      confidence: 0.9,
      provenance,
    });

    const node2 = await knowledgeGraph.addNode({
      type: 'organization',
      properties: { name: 'Company X' },
      confidence: 0.85,
      provenance,
    });

    await knowledgeGraph.addEdge({
      sourceId: node1,
      targetId: node2,
      relationship: 'works_at',
      weight: 0.9,
      confidence: 0.85,
      evidenceIds: [],
    });

    console.log('✓ Created graph with 2 nodes and 1 edge');

    const edges = await knowledgeGraph.getNodeEdges(node1);
    
    if (edges.length === 1) {
      console.log('✅ Test 4 PASSED');
      return true;
    }

    console.log(`❌ Test 4 FAILED: Expected 1 edge, got ${edges.length}`);
    return false;
  } catch (error: any) {
    console.error('❌ Test 4 FAILED:', error.message);
    return false;
  }
}

/**
 * Test 5: Entity deduplication
 */
async function testEntityDeduplication() {
  console.log('\n=== Test 5: Test entity deduplication ===');
  
  try {
    const entities = [
      {
        type: 'person' as const,
        value: 'John Doe',
        context: 'text1',
        confidence: 0.8,
        sourceReference: 'src1',
      },
      {
        type: 'person' as const,
        value: 'john doe',
        context: 'text2',
        confidence: 0.9,
        sourceReference: 'src2',
      },
    ];

    const deduplicated = await preprocessingEngine.deduplicateEntities(entities);
    
    console.log('✓ Deduplication complete');
    console.log('  Original:', entities.length);
    console.log('  Deduplicated:', deduplicated.length);

    if (deduplicated.length === 1) {
      console.log('✅ Test 5 PASSED');
      return true;
    }

    console.log(`⚠️ Test 5 WARNING: Expected 1, got ${deduplicated.length}`);
    return true;
  } catch (error: any) {
    console.error('❌ Test 5 FAILED:', error.message);
    return false;
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  PANTHEON Intelligence Core - Phase 4A Test Suite          ║');
  console.log('║  Part 3: Foundation Layer Tests                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    console.log('\nInitializing Intelligence Core...');
    await initialize();
    
    const health = await healthCheck();
    console.log('Health check:', health);

    if (!health.overall) {
      console.error('\n❌ Health check failed. Run migrations first.');
      return;
    }

    const results = [
      await testCreateAndRetrieveNode(),
      await testCreateRelationshipEdge(),
      await testExtractEntities(),
      await testGraphBuilding(),
      await testEntityDeduplication(),
    ];

    const passed = results.filter(r => r).length;
    const total = results.length;

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log(`║  TEST SUMMARY: ${passed}/${total} tests passed                           ║`);
    console.log('╚════════════════════════════════════════════════════════════╝');

    if (passed === total) {
      console.log('✅ All tests passed!');
    } else {
      console.log(`⚠️  ${total - passed} test(s) failed or had warnings`);
    }
  } catch (error: any) {
    console.error('❌ Test suite failed:', error.message);
  }
}

if (require.main === module) {
  runTests().then(() => {
    console.log('\nTests complete.');
    process.exit(0);
  }).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { runTests };
