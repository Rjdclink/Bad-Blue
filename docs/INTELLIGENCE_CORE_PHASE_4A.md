# PANTHEON Intelligence Core - Phase 4A: Foundation Layer

## Overview

The Intelligence Core is PANTHEON's autonomous intelligence system, built on a self-restructuring knowledge graph and multimodal preprocessing engine. Phase 4A establishes the foundation layer with core functionality for storing entities, relationships, and temporal data.

## Architecture

### Components

1. **Knowledge Graph Core** (`knowledgeGraph.ts`)
   - Self-restructuring graph database
   - Stores nodes (entities) and edges (relationships)
   - Temporal tracking for time-based data
   - Provenance tracking for data sources

2. **Preprocessing Engine** (`preprocessingEngine.ts`)
   - Normalizes raw multimodal inputs
   - Extracts structured data
   - Entity extraction and deduplication
   - Integration with ML/NLP services

3. **Graph Algorithms** (`utils/graphAlgorithms.ts`)
   - Breadth-First Search (BFS)
   - Depth-First Search (DFS)
   - Dijkstra's Shortest Path
   - Community Detection
   - Centrality Calculation

4. **Provenance Manager** (`utils/provenanceManager.ts`)
   - Data source tracking
   - Verification status management
   - Provenance chain retrieval

## Database Schema

### Tables

#### `knowledge_graph_nodes`
Stores entities in the knowledge graph.

```sql
CREATE TABLE knowledge_graph_nodes (
  id VARCHAR PRIMARY KEY,
  type VARCHAR NOT NULL, -- person, organization, location, event, document, concept
  properties JSONB NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  provenance JSONB NOT NULL,
  temporal JSONB,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

#### `knowledge_graph_edges`
Stores relationships between nodes.

```sql
CREATE TABLE knowledge_graph_edges (
  id VARCHAR PRIMARY KEY,
  source_id VARCHAR NOT NULL,
  target_id VARCHAR NOT NULL,
  relationship VARCHAR NOT NULL,
  weight REAL NOT NULL CHECK (weight >= 0 AND weight <= 1),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_ids TEXT[],
  temporal JSONB,
  created_at TIMESTAMP NOT NULL
);
```

#### `knowledge_graph_queries`
Caches query results for performance.

```sql
CREATE TABLE knowledge_graph_queries (
  id VARCHAR PRIMARY KEY,
  query_hash VARCHAR NOT NULL UNIQUE,
  query_params JSONB NOT NULL,
  result_node_ids TEXT[],
  computed_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP
);
```

### Indexes

The schema includes optimized indexes for:
- Type filtering
- Property searches (GIN index on JSONB)
- Confidence-based queries
- Graph traversal (source/target indexes)
- Temporal queries

## API Usage

### Initialization

```typescript
import { initialize, healthCheck } from './services/intelligenceCore';

// Initialize the Intelligence Core
await initialize();

// Check health status
const health = await healthCheck();
console.log(health); // { knowledgeGraph: true, preprocessing: true, overall: true }
```

### Knowledge Graph Operations

#### Create a Node

```typescript
import { knowledgeGraph, ProvenanceManager } from './services/intelligenceCore';

const nodeId = await knowledgeGraph.addNode({
  type: 'person',
  properties: {
    name: 'John Doe',
    age: 30,
    occupation: 'Engineer'
  },
  confidence: 0.95,
  provenance: [
    ProvenanceManager.createProvenanceRecord('linkedin', 'api', 'verified')
  ]
});
```

#### Create a Relationship

```typescript
const edgeId = await knowledgeGraph.addEdge({
  sourceId: personId,
  targetId: organizationId,
  relationship: 'works_at',
  weight: 0.9,
  confidence: 0.85,
  evidenceIds: ['doc_123']
});
```

#### Query Nodes

```typescript
// Find all verified persons
const persons = await knowledgeGraph.findNodes({
  type: 'person',
  minConfidence: 0.8
});

// Get related nodes (2 hops away)
const related = await knowledgeGraph.getRelatedNodes(nodeId, 2);

// Find shortest path between two nodes
const path = await knowledgeGraph.getShortestPath(sourceId, targetId);
```

#### Graph Intelligence

```typescript
// Detect communities
const communities = await knowledgeGraph.detectCommunities();

// Find influential nodes
const influencers = await knowledgeGraph.findInfluencers();

// Merge duplicate nodes
const mergedId = await knowledgeGraph.mergeNodes([nodeId1, nodeId2]);
```

### Preprocessing Engine

#### Normalize Text

```typescript
import { preprocessingEngine } from './services/intelligenceCore';

const normalized = await preprocessingEngine.normalize({
  data: 'John Doe works at ABC Corporation in New York.',
  sourceType: 'text',
  sourceUrl: 'https://example.com/profile'
});

console.log(normalized.entities); // Extracted entities
console.log(normalized.confidence); // Overall confidence score
```

#### Process HTML

```typescript
const normalized = await preprocessingEngine.normalize({
  data: htmlString,
  sourceType: 'html',
  sourceUrl: 'https://example.com/page'
});

console.log(normalized.structured); // Extracted structured data (JSON-LD, metadata)
console.log(normalized.text); // Clean text content
console.log(normalized.entities); // Extracted entities
```

#### Extract Entities

```typescript
const entities = await preprocessingEngine.extractEntities(text);

// Deduplicate entities
const unique = await preprocessingEngine.deduplicateEntities(entities);

// Find contextual links
const links = await preprocessingEngine.contextualLinking(entities);
```

## Integration Patterns

### With ML/NLP Service

The Preprocessing Engine integrates with the existing ML/NLP service:

```typescript
import { mlnlpIntelligenceService } from './services/mlnlp/intelligenceService';

// The preprocessing engine automatically uses ML/NLP for entity extraction
const normalized = await preprocessingEngine.normalize({
  data: text,
  sourceType: 'text'
});
// Entities are extracted using mlnlpIntelligenceService.processFullPipeline()
```

### Building Knowledge Graphs from Data

```typescript
// 1. Preprocess raw data
const normalized = await preprocessingEngine.normalize({
  data: htmlContent,
  sourceType: 'html',
  sourceUrl: sourceUrl
});

// 2. Create nodes for each entity
const nodeIds = [];
for (const entity of normalized.entities) {
  const nodeId = await knowledgeGraph.addNode({
    type: entity.type === 'person' ? 'person' : 'concept',
    properties: { value: entity.value },
    confidence: entity.confidence,
    provenance: [
      ProvenanceManager.createProvenanceRecord(sourceUrl, 'extraction', 'unverified')
    ]
  });
  nodeIds.push(nodeId);
}

// 3. Create relationships
const links = await preprocessingEngine.contextualLinking(normalized.entities);
for (const link of links) {
  // Map entities to nodes and create edges
  await knowledgeGraph.addEdge({
    sourceId: nodeMap.get(link.entity1.value),
    targetId: nodeMap.get(link.entity2.value),
    relationship: link.relationship,
    weight: link.confidence,
    confidence: link.confidence,
    evidenceIds: []
  });
}
```

## Type Definitions

All TypeScript types are exported from `types.ts`:

```typescript
import { 
  GraphNode, 
  GraphEdge, 
  ProvenanceRecord, 
  TemporalData,
  RawInput, 
  NormalizedData, 
  ExtractedEntity 
} from './services/intelligenceCore';
```

Key types:

- `GraphNode`: Entity in the knowledge graph
- `GraphEdge`: Relationship between entities
- `ProvenanceRecord`: Source and verification tracking
- `TemporalData`: Time-based information
- `RawInput`: Input for preprocessing
- `NormalizedData`: Output from preprocessing
- `ExtractedEntity`: Entity extracted from text

## Testing

Run the test suite:

```bash
# Run TypeScript directly
tsx server/tests/intelligenceCore.phase4a.test.ts

# Or compile and run
npm run check  # Type check
npm run build  # Build
```

Test scenarios covered:
1. Create and retrieve nodes
2. Create relationship edges with foreign keys
3. Extract entities from text
4. Build and query small graphs
5. Shortest path algorithm
6. Entity deduplication
7. Provenance chain tracking
8. Temporal timeline building

## Performance Considerations

### Indexes

The schema uses appropriate indexes for common query patterns:
- GIN index on properties for fast JSONB searches
- B-tree indexes on confidence for filtering
- Composite indexes for graph traversal

### Query Caching

The `knowledge_graph_queries` table caches expensive query results:
- Query hash for deduplication
- Expiration timestamp for freshness
- Stored result node IDs

### Connection Pooling

Uses the existing PostgreSQL connection pool from `db.ts`:
- Maximum 8 connections
- Automatic reconnection on failures
- Health monitoring

## Future Enhancements (Post Phase 4A)

### Phase 4B - Advanced Intelligence
- ML-powered entity resolution
- Automatic relationship inference
- Confidence scoring improvements
- Real-time graph updates

### Phase 4C - Media Processing
- OCR for image text extraction
- Audio transcription
- Video analysis
- Geolocation extraction

### Phase 4D - Advanced Algorithms
- PageRank for node importance
- Link prediction
- Anomaly detection
- Pattern recognition

## Troubleshooting

### Database Tables Not Created

Run migrations:
```bash
npm run migrate
```

### Health Check Fails

Check database connection:
```typescript
import { pool } from './server/db';
const result = await pool.query('SELECT 1');
```

### Entity Extraction Returns Empty

Ensure ML/NLP service is initialized:
```typescript
import { mlnlpIntelligenceService } from './services/mlnlp/intelligenceService';
await mlnlpIntelligenceService.initialize();
```

### Slow Graph Queries

1. Check index usage with `EXPLAIN ANALYZE`
2. Consider adding application-level caching
3. Limit traversal depth for large graphs

## Security Considerations

### Data Provenance

All nodes must have provenance records tracking:
- Source of data
- Acquisition method
- Verification status

### Confidence Scores

Confidence scores (0-1) indicate data reliability:
- 0.9-1.0: Verified from trusted source
- 0.7-0.9: Probable, from reliable source
- 0.5-0.7: Unverified, needs validation
- < 0.5: Low confidence, use with caution

### Input Validation

The preprocessing engine validates:
- Source types
- Data formats
- Extraction confidence

## Logging

All components use the Winston logger with component tags:

```typescript
import { createLogger } from '../../../logger';
const logger = createLogger('ComponentName');

logger.info('Operation successful');
logger.error('Operation failed', error);
```

Logs are written to:
- `logs/combined.log` - All logs
- `logs/error.log` - Errors only
- Console - Development mode

## Contributing

When extending the Intelligence Core:

1. Follow TypeScript strict mode
2. Add comprehensive tests
3. Document new APIs
4. Update this documentation
5. Include provenance tracking
6. Add appropriate logging

---

**Built Strong. Phase 4A Complete. 🧠**
