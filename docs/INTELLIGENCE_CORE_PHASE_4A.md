# PANTHEON Intelligence Core - Phase 4A: Foundation Layer

## Overview

The Intelligence Core is PANTHEON's autonomous intelligence system with a self-restructuring knowledge graph and multimodal preprocessing engine. Phase 4A establishes the foundation layer.

## Architecture

### Components

1. **Knowledge Graph Core** (`knowledgeGraph.ts`) - Graph database for entities and relationships
2. **Preprocessing Engine** (`preprocessingEngine.ts`) - Data normalization and entity extraction
3. **Graph Algorithms** (`utils/graphAlgorithms.ts`) - BFS, DFS, Dijkstra, community detection
4. **Provenance Manager** (`utils/provenanceManager.ts`) - Data source tracking

## Database Schema

### Tables

**knowledge_graph_nodes**: Entities with JSONB properties, confidence, provenance
**knowledge_graph_edges**: Relationships with FK constraints, CASCADE delete
**knowledge_graph_queries**: Query result caching

### Indexes (13 total)
- GIN index on JSONB properties
- B-tree indexes on type, confidence, relationships
- Composite indexes for graph traversal

## API Usage

### Initialization

```typescript
import { initialize, knowledgeGraph, preprocessingEngine } from './server/services/intelligenceCore';

await initialize();
```

### Knowledge Graph

```typescript
// Add node
const nodeId = await knowledgeGraph.addNode({
  type: 'person',
  properties: { name: 'John Doe' },
  confidence: 0.95,
  provenance: [ProvenanceManager.createProvenanceRecord('source', 'api', 'verified')]
});

// Add edge
const edgeId = await knowledgeGraph.addEdge({
  sourceId: personId,
  targetId: orgId,
  relationship: 'works_at',
  weight: 0.9,
  confidence: 0.85,
  evidenceIds: []
});

// Query
const nodes = await knowledgeGraph.findNodes({
  type: 'person',
  minConfidence: 0.8
});

// Graph operations
const related = await knowledgeGraph.getRelatedNodes(nodeId, 2);
const path = await knowledgeGraph.getShortestPath(sourceId, targetId);
const communities = await knowledgeGraph.detectCommunities();
```

### Preprocessing Engine

```typescript
// Normalize text
const normalized = await preprocessingEngine.normalize({
  data: 'John Doe works at ABC Corporation.',
  sourceType: 'text'
});

console.log(normalized.entities); // Extracted entities
console.log(normalized.confidence); // Confidence score
```

## Testing

```bash
# Run test suite
tsx server/tests/intelligenceCore.phase4a.test.ts
```

Test coverage:
1. Create and retrieve nodes
2. Create relationship edges
3. Extract entities from text
4. Build and query graphs
5. Entity deduplication

## Deployment

**Step 1**: Run migration
```bash
psql $DATABASE_URL -f db/migrations/0017_knowledge_graph_tables.sql
```

**Step 2**: Test
```bash
tsx server/tests/intelligenceCore.phase4a.test.ts
```

**Step 3**: Use in application (see API Usage above)

## Type Definitions

All types exported from `types.ts`:
- `GraphNode`, `GraphEdge` - Core graph structures
- `ProvenanceRecord` - Source tracking
- `TemporalData` - Time-based information
- `ExtractedEntity` - Entity extraction results
- `Community` - Community detection results

## Performance

- Configurable query limits (default 100, max 1000)
- GIN indexes for fast JSONB searches
- Connection pooling (max 8 connections)
- Query result caching

## Security

- Provenance tracking for all data
- Confidence scores (0-1) indicate reliability
- Input validation and sanitization
- Comprehensive logging

## Future Enhancements

- ML-powered entity resolution
- OCR and transcription
- Advanced graph algorithms
- Real-time updates

---

**Built Strong. Foundation Complete. 🧠**
