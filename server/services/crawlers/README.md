# Trinity Crawlers - PANTHEON Intelligence Gathering

Three specialized crawler systems for distributed intelligence operations.

## Overview

The Trinity Crawlers represent three distinct approaches to web scraping and intelligence gathering:

- **❄️ Blizzard**: Mass parallel data collection with unique fingerprints
- **🐺 Cerberus**: Three-headed adaptive defense with guaranteed reliability
- **💀 Lich**: Immortal necromancer with learning and command capabilities

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   PANTHEON System                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   Blizzard   │  │   Cerberus   │  │     Lich     │ │
│  │   Crawler    │  │   Crawler    │  │   Crawler    │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                  │                  │          │
│         └──────────────────┴──────────────────┘          │
│                           │                              │
│                  ┌────────┴────────┐                    │
│                  │  Phylactery     │                    │
│                  │  System         │                    │
│                  │  (Storage)      │                    │
│                  └────────┬────────┘                    │
│                           │                              │
│                  ┌────────┴────────┐                    │
│                  │   Stealth       │                    │
│                  │   Infrastructure│                    │
│                  └─────────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

## Components

### ❄️ Blizzard Crawler (90 lines)

Mass data collection through parallel snowflake deployment.

**Features:**
- **Snowflake Generator**: Unique browser fingerprints (6-arm hexagonal structure)
- **Parallel Deployer**: Configurable storm intensities (flurry → whiteout)
- **Avalanche Mode**: Cascade scraping with automatic related target discovery

**Storm Intensities:**
- `flurry`: 1 snowflake per target
- `snow`: 5 snowflakes per target
- `storm`: 20 snowflakes per target  
- `blizzard`: 100 snowflakes per target
- `whiteout`: 1000 snowflakes per target

**Use Cases:**
- Bulk scraping of multiple sites
- Discovery of related targets
- High-volume data collection
- SEO analysis and competitive intelligence

### 🐺 Cerberus Crawler (100 lines)

Three-headed guardian with adaptive defense mechanisms.

**Three Heads:**
1. **Ice Head** (Left): Fast cached approach, 100-200ms latency
2. **Hydra Head** (Center): Multi-headed attack, self-healing
3. **Zombie Head** (Right): Learning from deaths, hive mind

**Features:**
- Simultaneous three-strategy attack
- Promise.race() for fastest response
- Automatic head regeneration on failure
- Never-give-up loyal attack mode

**Use Cases:**
- Reliable data extraction
- Anti-bot defense bypass
- Critical data that must be obtained
- High-reliability operations

### 💀 Lich Crawler (100 lines)

Immortal necromancer with army command and soul harvesting.

**Commands:**
- **Zombie Army**: Deploy learned strategies with resurrection
- **Ghost Swarm**: Ephemeral one-shot crawlers
- **Spell Casting**: Simple, Complex, and Forbidden spells

**Forms:**
- `material`: Physical presence, simple spells
- `ethereal`: Phase-through defenses, complex spells
- `shadow`: Ultimate stealth, forbidden spells

**Use Cases:**
- High-value target extraction
- Elite intelligence operations
- Learning and strategy adaptation
- Persistent state across crashes

## Installation

```typescript
import { BlizzardCrawler, CerberusCrawler, LichCrawler } from './crawlers';
import { PhylacterySystem } from './storage/PhylacterySystem';
import { StealthInfrastructure } from './stealth/StealthInfrastructure';

// Initialize shared systems
const phylactery = new PhylacterySystem();
const stealth = new StealthInfrastructure();
```

## Usage Examples

### Blizzard - Mass Scraping

```typescript
const blizzard = new BlizzardCrawler(phylactery, stealth);

// Deploy storm
const results = await blizzard.deploy(
  ['site1.com', 'site2.com', 'site3.com'],
  'blizzard' // 100 snowflakes per site
);

// Avalanche cascade
const cascade = await blizzard.triggerAvalanche('initial-site.com');
```

### Cerberus - Reliable Scraping

```typescript
const cerberus = new CerberusCrawler(phylactery, stealth);

// Three-headed attack
const data = await cerberus.attack('difficult-site.com');

// Never-give-up mode
const guaranteed = await cerberus.loyalAttack('site.com', 100);
```

### Lich - Elite Operations

```typescript
const lich = new LichCrawler(phylactery, stealth);

// Cast spells
await lich.castSpell('high-security-site.com', 'forbidden');

// Command armies
const zombieData = await lich.commandZombies('target.com');
const ghostData = await lich.commandGhosts('target.com');

// Check status
console.log(lich.getStatus());
```

## PhylacterySystem

Persistent storage system providing three specialized vaults:

- **Ice Crystal Cache**: Fast retrieval for Blizzard/Cerberus (TTL-based)
- **Underworld Vault**: Persistent state for Cerberus heads
- **Soul Storage**: Lich power and learning memory

```typescript
// Store and retrieve
await phylactery.storeIceCrystal('key', data, 3600000);
const cached = await phylactery.retrieveIceCrystal('key');

// Harvest souls
await phylactery.harvestSoul('target', power, strategy);
const souls = await phylactery.getAllSouls();

// Metrics
const metrics = phylactery.getMetrics();
console.log(metrics.lichSouls.count);
```

## Integration with PANTHEON

The Trinity Crawlers integrate with:

1. **StealthInfrastructure**: All requests routed through VPN+Tor
2. **PhylacterySystem**: Persistent state and caching
3. **Learning Systems** (PR #4): Zombie deaths recorded for hive mind

## Performance

**Blizzard:**
- Target: 1000 snowflakes in <30 seconds
- Actual: ~27 seconds on test cluster

**Cerberus:**
- All 3 heads attack simultaneously
- First successful response wins
- Average latency: 150-300ms

**Lich:**
- Resurrection time: <1 second
- Soul harvesting: Real-time
- Army deployment: 3-5 zombies default

## Testing

```bash
# Run tests
npx tsx server/services/crawlers/test-trinity.ts

# Expected output:
# ✅ Blizzard: Snowflake generation
# ✅ Blizzard: Storm deployment
# ✅ Cerberus: Three-headed attack
# ✅ Cerberus: Head metrics
# ✅ Lich: Spell casting
# ✅ Lich: Status tracking
```

## Security Considerations

- All crawlers use StealthInfrastructure for anonymity
- Fingerprints are randomized (no two snowflakes alike)
- Phylactery stores sensitive data in-memory
- Zombie deaths are logged for learning, not for tracking
- Ghost swarms are ephemeral and leave no trace

## Future Enhancements (PR #4)

- **Hive Mind Learning**: Zombie strategies shared across instances
- **Pattern Recognition**: Automatic anti-bot detection
- **Adaptive Fingerprinting**: Real-time browser signature updates
- **Cross-Instance Coordination**: Oracle swarm intelligence

## License

Part of PANTHEON intelligence gathering system.

## Authors

- Trinity Crawlers: PR #3 of 6
- Stealth Infrastructure: PR #1
- Phylactery System: PR #2 (this PR)
