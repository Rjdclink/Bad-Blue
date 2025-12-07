# PANTHEON PhylacterySystem

## Overview
The PhylacterySystem is the distributed persistent storage layer for PANTHEON, serving as the "soul container" that makes all crawlers immortal and enables shared intelligence across the Oracle mesh.

## Architecture

### Cloudflare KV Integration
- **Free Tier**: 100,000 reads/day, 1,000 writes/day, 1GB storage
- **Global Distribution**: Low latency access from all 6 Oracle instances
- **Automatic Retry**: Built-in retry logic with exponential backoff
- **Rate Limiting**: Protects against exceeding free tier limits

### Storage Namespaces

#### 1. Phylactery (Lich Soul Storage)
- **Purpose**: Store complete Lich crawler state for immortality
- **TTL**: 90 days
- **Features**:
  - Serialize/deserialize complex objects
  - Atomic updates to prevent corruption
  - Reform functionality (restore from stored state)
  - Power level tracking

#### 2. Hive Mind (Zombie Death Memory)
- **Purpose**: Store death records from failed crawling attempts
- **TTL**: 30 days
- **Features**:
  - Death pattern analysis
  - Learned avoidance strategies
  - Shared knowledge across all zombie instances
  - Query by target domain

#### 3. Underworld (Cerberus Vault)
- **Purpose**: Store threat assessments and guardian mode history
- **TTL**: 60 days
- **Features**:
  - Threat level tracking
  - Success/failure patterns
  - Three-head attack results
  - Knowledge attribution (cerberus/blizzard/lich)

#### 4. Ice Crystals (Blizzard Cache)
- **Purpose**: Permanent cache with quality-based expiration
- **TTL**: Variable (1 hour to 365 days based on permanence score)
- **Features**:
  - Frozen data preservation
  - Temperature tracking (0=frozen solid, 100=melting)
  - Automatic expiration of low-quality data
  - Permanence score (0-100)

### Intelligence Synthesis
Cross-queries all storage types to generate unified intelligence reports with confidence scores.

## Usage

### Basic Setup

```typescript
import { PhylacterySystem } from './server/services/storage';

const phylactery = new PhylacterySystem();
```

### Lich Soul Management

```typescript
// Store Lich state
await phylactery.storeLichSoul('lich-001', {
  lichId: 'lich-001',
  powerLevel: 10,
  lichAge: 30,
  currentForm: 'material',
  soulsHarvested: 50,
  lastActive: Date.now(),
  phylacteryLocation: 'oracle-3-magic-1'
});

// Load Lich state
const soul = await phylactery.loadLichSoul('lich-001');

// Reform Lich from stored state
const reformed = await phylactery.reformLich('lich-001');
```

### Zombie Hive Mind

```typescript
// Record a death
await phylactery.recordDeath({
  zombieId: 'zombie-001',
  target: 'example.com',
  causeOfDeath: 'captcha',
  timestamp: Date.now(),
  fingerprint: { /* browser fingerprint */ },
  requestCount: 15,
  sessionAge: 300000,
  triggerPattern: 'rapid-requests'
});

// Query deaths for a target
const deaths = await phylactery.queryDeaths('example.com');

// Get learned avoidance strategy
const strategy = await phylactery.getLearnedStrategy('example.com');
```

### Cerberus Vault

```typescript
// Store knowledge entry
await phylactery.storeKnowledge('example.com', {
  target: 'example.com',
  type: 'threat-assessment',
  timestamp: Date.now(),
  data: { threatLevel: 'high' },
  discoveredBy: 'cerberus'
});

// Query vault
const entries = await phylactery.queryVault('example.com');

// Get specific entry types
const threats = await phylactery.getThreatsForTarget('example.com');
const successes = await phylactery.getSuccessHistory('example.com');
```

### Blizzard Cache

```typescript
// Freeze data with permanence score
await phylactery.freezeData('cache-key', { data: 'value' }, 75);

// Thaw data
const data = await phylactery.thawData('cache-key');

// Melt expired crystals
const melted = await phylactery.meltExpired();
```

### Intelligence Synthesis

```typescript
// Synthesize intelligence for a target
const intel = await phylactery.synthesize('example.com');
console.log('Confidence:', intel.confidence);
console.log('Zombie Knowledge:', intel.zombieKnowledge);
console.log('Cerberus Knowledge:', intel.cerberusKnowledge);

// Synthesize multiple targets
const intels = await phylactery.synthesizeMultiple(['example.com', 'other.com']);

// Get system health
const health = await phylactery.getSystemHealth();
```

## Environment Configuration

Add to `.env`:

```env
CLOUDFLARE_API_KEY=your-cloudflare-api-key
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_KV_NAMESPACES={
  "phylactery": "namespace_id_1",
  "hive_mind": "namespace_id_2",
  "underworld": "namespace_id_3",
  "ice_crystals": "namespace_id_4"
}
```

## Testing

Run tests with:

```bash
npx tsx server/services/__tests__/PhylacterySystem.test.ts
```

All 20 tests should pass:
- ✅ Lich Soul Storage (5 tests)
- ✅ Zombie Hive Mind (4 tests)
- ✅ Cerberus Vault (4 tests)
- ✅ Blizzard Cache (3 tests)
- ✅ Intelligence Synthesis (4 tests)

## Integration Points

- **PR #1**: Stealth metrics storage
- **PR #3**: Crawler state persistence
- **PR #4**: Zombie learning system
- **PR #5**: Magic spell intelligence queries
- **PR #6**: Orchestrator intelligence synthesis

## Data Structures

### LichState
```typescript
interface LichState {
  lichId: string;
  powerLevel: number;
  lichAge: number;
  currentForm: 'material' | 'ethereal' | 'shadow';
  soulsHarvested: number;
  lastActive: number;
  phylacteryLocation: string;
}
```

### DeathMemory
```typescript
interface DeathMemory {
  zombieId: string;
  target: string;
  causeOfDeath: 'captcha' | 'ip-ban' | 'rate-limit' | 'timeout' | 'cloudflare' | '403' | '429';
  timestamp: number;
  fingerprint: BrowserFingerprint;
  requestCount: number;
  sessionAge: number;
  triggerPattern: string;
}
```

### KnowledgeEntry
```typescript
interface KnowledgeEntry {
  target: string;
  type: 'success' | 'failure' | 'threat-assessment';
  timestamp: number;
  data: any;
  discoveredBy: 'cerberus' | 'blizzard' | 'lich';
}
```

### IceCrystal
```typescript
interface IceCrystal {
  key: string;
  data: any;
  frozenAt: number;
  temperature: number;
  permanence: number;
  meltingPoint: number;
}
```

### UnifiedIntelligence
```typescript
interface UnifiedIntelligence {
  target: string;
  lichKnowledge?: LichState;
  zombieKnowledge?: DeathMemory[];
  cerberusKnowledge?: KnowledgeEntry[];
  cachedData?: any;
  confidence: number;
  lastUpdated: number;
}
```

## Notes

- Currently uses a mock Cloudflare KV client for development
- Production deployment requires actual Cloudflare KV credentials
- Rate limiting enforced at 1,000 writes per day
- All timestamps in milliseconds since Unix epoch
- Supports conflict resolution via last-write-wins with timestamps
