# 🌐 Six Degrees Crawler - Social Graph Mapper

## Overview

The Six Degrees Crawler is a sophisticated relationship mapping system that exploits the "six degrees of separation" theory to discover hidden targets through intelligent graph traversal. It builds comprehensive relationship graphs, identifies communities, finds strategic hubs, and discovers paths between any two websites.

## Key Features

### 1. **Graph Building**
- Recursively maps connections up to 6 degrees of separation
- Breadth-first search (BFS) for systematic graph construction
- Discovers multiple connection types: links, backlinks, partners, social
- Authority scoring for node importance

### 2. **Path Finding**
- **Shortest Path**: BFS-based algorithm to find minimum degrees of separation
- **All Paths**: DFS-based discovery of all possible routes within N degrees
- Edge weighting by relationship strength
- Relationship type tracking for each connection

### 3. **Community Detection**
- Identifies densely connected clusters
- Calculates internal density metrics
- Detects common attributes (TLD, industry, location)
- Low external connectivity filtering

### 4. **Hub Identification**
- Ranks nodes by connection count
- Identifies strategic access points
- Authority-weighted scoring
- Configurable result limits

### 5. **Discovery**
- Finds hidden/low-authority sites
- Traverses up to 6 degrees from known sites
- Filters by authority scores
- Reveals unknown network members

### 6. **Crawling Strategies**
- **Path Crawling**: Traverse shortest path between two sites
- **Community Crawling**: Scrape entire cluster of related sites
- **Hub Exploitation**: Leverage central nodes to access connected sites

## Architecture

### Core Interfaces

```typescript
interface Node {
  domain: string;           // Domain name
  connections: string[];    // Connected domains
  type: string;            // Node type (website, social, etc.)
  authority: number;       // Authority score (0-1)
}

interface Edge {
  from: string;            // Source domain
  to: string;              // Target domain
  type: 'link' | 'backlink' | 'partner' | 'social';
  strength: number;        // Connection strength (0-1)
}

interface Path {
  nodes: string[];         // Ordered list of domains
  degrees: number;         // Number of hops
  relationships: Edge[];   // Connection details
}

interface Community {
  id: string;             // Unique identifier
  members: string[];      // Member domains
  commonality: string;    // Shared characteristic
  density: number;        // Internal connectivity (0-1)
}
```

### Graph Structure

- **Storage**: Map-based adjacency list for O(1) lookups
- **Nodes**: Stored in `Map<string, Node>`
- **Edges**: Stored in `Map<string, Edge[]>`
- **Visited Tracking**: Set-based for efficient duplicate detection

## Connection Types & Strengths

| Type | Strength | Description |
|------|----------|-------------|
| Direct Link | 1.0 | Outbound hyperlink from source to target |
| Backlink | 0.8 | Inbound reference detected |
| Partner | 0.85 | Business relationship indicator |
| Social | 0.7 | Social media connection |

## Authority Calculation

Authority scores are assigned based on:

- **TLD**: `.gov`/`.edu` = 0.9, `.org` = 0.7, `.com` = 0.6
- **Well-Known Domains**: google, facebook, twitter, linkedin, wikipedia = 0.95
- **Default**: 0.5 for unknown domains

## Usage Examples

### Basic Graph Building

```typescript
import { SixDegreesCrawler } from './crawlers';
import { StealthInfrastructure } from './stealth/StealthInfrastructure';
import { PhylacterySystem } from './storage/PhylacterySystem';

const stealth = new StealthInfrastructure();
const phylactery = new PhylacterySystem();
const crawler = new SixDegreesCrawler(stealth, phylactery);

// Build graph up to 4 degrees
await crawler.buildGraph('example.com', 4);

// Check stats
const stats = crawler.getGraphStats();
console.log('Mapped', stats.nodeCount, 'sites');
console.log('Found', stats.edgeCount, 'connections');
```

### Find Shortest Path

```typescript
// Find path between two domains
const path = await crawler.findPath('source.com', 'target.com');

if (path.degrees > 0) {
  console.log('Path:', path.nodes.join(' -> '));
  console.log('Degrees of separation:', path.degrees);
}
```

### Discover Communities

```typescript
// Find densely connected clusters
const communities = await crawler.findCommunities();

communities.forEach(c => {
  console.log(`Community: ${c.id}`);
  console.log(`Members: ${c.members.length}`);
  console.log(`Density: ${c.density.toFixed(2)}`);
  console.log(`Commonality: ${c.commonality}`);
});
```

### Identify Hubs

```typescript
// Find top 10 most connected nodes
const hubs = await crawler.findHubs(10);

hubs.forEach((hub, i) => {
  console.log(`${i + 1}. ${hub.domain}`);
  console.log(`   Connections: ${hub.connections.length}`);
  console.log(`   Authority: ${hub.authority}`);
});
```

### Exploit Hub

```typescript
// Leverage hub to access all connected sites
const hubData = await crawler.exploitHub('major-hub.com');
console.log('Accessed', hubData.length, 'sites via hub');
```

## Use Cases

### 1. **Competitor Intelligence**
```typescript
// Map competitor network
await crawler.buildGraph('competitor.com', 5);
const communities = await crawler.findCommunities();
// Reveals partner networks, affiliates, and business relationships
```

### 2. **Hidden Database Discovery**
```typescript
// Find path to hidden resource
const path = await crawler.findPath('known-site.com', 'hidden-db.com');
const data = await crawler.crawlPath('known-site.com', 'hidden-db.com');
// Access hidden resources through relationship chains
```

### 3. **Industry Mapping**
```typescript
// Discover entire industry network
const hidden = await crawler.discoverHidden('industry-leader.com');
const communities = await crawler.findCommunities();
// Maps interconnected industry players
```

### 4. **Strategic Access Planning**
```typescript
// Find optimal entry points
const hubs = await crawler.findHubs(20);
const hubData = await crawler.exploitHub(hubs[0].domain);
// Identify and leverage strategic access points
```

## Performance Characteristics

- **Graph Building**: O(V + E) where V = vertices, E = edges
- **Shortest Path (BFS)**: O(V + E)
- **All Paths (DFS)**: O(V^k) where k = max degrees
- **Community Detection**: O(V * E)
- **Hub Identification**: O(V log V) due to sorting

## Security Features

- **URL Validation**: All URLs validated before construction
- **Domain Sanitization**: Removes whitespace and control characters
- **Input Bounds**: maxDegrees limited to 1-10 range
- **Error Handling**: Graceful degradation on connection failures
- **Rate Limiting**: Built-in delays in crawling strategies

## Configuration

### Max Degrees
Default: 6 (the "six degrees" concept)
Range: 1-10 (validated)

```typescript
await crawler.buildGraph('seed.com', 4); // Custom depth
```

### Hub Limit
Default: 10
Configurable via parameter

```typescript
const topHubs = await crawler.findHubs(20); // Top 20 hubs
```

## Integration with Other Crawlers

The Six Degrees Crawler works seamlessly with other PANTHEON crawlers:

```typescript
// Phase 1: Map network with Six Degrees
await sixDegrees.buildGraph('target.com', 4);
const communities = await sixDegrees.findCommunities();

// Phase 2: Mass collection with Blizzard
for (const community of communities) {
  await blizzard.deploy(community.members, 'snow');
}

// Phase 3: Stealth recon with Bird of Prey
const hubs = await sixDegrees.findHubs(10);
for (const hub of hubs) {
  await birdOfPrey.hunt(hub.domain);
}
```

## Testing

Comprehensive test suite with 17 tests covering:
- Graph operations (build, clear, stats)
- Path finding (shortest, all paths)
- Community detection
- Hub identification
- Discovery features
- Crawling strategies
- Input validation
- Edge cases

Run tests:
```bash
npx tsx server/services/crawlers/__tests__/SixDegreesCrawler.test.ts
```

## Success Criteria ✅

- ✅ Build graph up to 6 degrees
- ✅ Find shortest path between any 2 sites
- ✅ Community detection with density calculation
- ✅ Hub identification by connection count
- ✅ Path-based crawling strategies
- ✅ Standalone implementation (~606 lines)
- ✅ Comprehensive test coverage (17 tests)
- ✅ Security validations in place
- ✅ Zero vulnerabilities detected

## Future Enhancements

- **Weighted Path Finding**: Incorporate edge strength in path selection
- **Temporal Analysis**: Track relationship evolution over time
- **Machine Learning**: Predict hidden connections
- **Parallel Graph Building**: Multi-threaded graph construction
- **Graph Persistence**: Save/load graph state
- **Visualization**: Generate network diagrams
- **Advanced Metrics**: PageRank, betweenness centrality

## References

- Six Degrees of Separation Theory
- Graph Theory (BFS/DFS algorithms)
- Social Network Analysis
- Web Crawling Best Practices
- PANTHEON Intelligence Framework
