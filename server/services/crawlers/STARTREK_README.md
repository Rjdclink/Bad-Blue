# 🚀 Star Trek Crawler - Federation Explorer

A standalone Star Trek-themed web crawler with warp drive, transporter, sensors, and phasers.

## Features

### 🌌 Warp Drive
Jump across vast distances to discover new targets:
- **Near**: 10-100 related domains
- **Far**: 1000-10000 random domains  
- **Galactic**: Random TLD exploration

```typescript
const crawler = new StarTrekCrawler();
crawler.setWarpSpeed(7);

const nearTarget = await crawler.warpJump('near');
const farTarget = await crawler.warpJump('far');
const galacticTarget = await crawler.warpJump('galactic');
```

### 🔵 Transporter
Beam directly to deep URLs without crawling:
- Predicts common URL patterns (`/about`, `/contact`, `/team`, etc.)
- 70% success rate
- Emergency beam out for quick escape

```typescript
// Beam to deep URL
await crawler.beamTo('https://example.com');

// Emergency escape
await crawler.emergencyBeamOut();
```

### 📡 Sensors
Discover and analyze targets:
- **Long-range scan**: Discover multiple targets
- **Life sign detection**: Check if target is responsive

```typescript
const discovered = await crawler.longRangeScan();
const isAlive = await crawler.detectLifeSigns('https://example.com');
```

### ⚡ Phasers
10-level data extraction system with automatic rate limiting:

**Stun Settings (1-5):**
- Setting 1-2: 1-5 req/min (ultra gentle)
- Setting 3-4: 10-20 req/min (normal)
- Setting 5: 40 req/min (max stun)

**Kill Settings (6-10):**
- Setting 6-7: 60-120 req/min (light kill)
- Setting 8-9: 240-500 req/min (heavy kill)
- Setting 10: 10000 req/min (disintegrate)

```typescript
await crawler.setPhaserSetting(3);
const data = await crawler.firePhaser('https://example.com');
```

### 🖖 Prime Directive
Ethical constraints mode:
- When **enabled**: Max phaser setting 5 (stun only), respects robots.txt
- When **disabled**: All settings available

```typescript
crawler.setPrimeDirective(true);  // Enable ethics mode
crawler.setPrimeDirective(false); // Disable for aggressive operations
```

## Missions

### Explore Mission
Discover and extract data from multiple targets in a sector:

```typescript
const results = await crawler.explore('alpha-quadrant');
```

### Surgical Strike
Precision extraction on a specific target:

```typescript
const result = await crawler.surgicalStrike('https://example.com');
```

## Installation

```typescript
import { StarTrekCrawler } from './server/services/crawlers';

const crawler = new StarTrekCrawler();
```

## Example Usage

```typescript
import { StarTrekCrawler } from './server/services/crawlers';

async function main() {
  const crawler = new StarTrekCrawler();
  
  // Configure ship
  crawler.setWarpSpeed(5);
  crawler.setPrimeDirective(true);
  await crawler.setPhaserSetting(3);
  
  // Warp jump to discover target
  const target = await crawler.warpJump('near');
  
  // Check if target is responsive
  const alive = await crawler.detectLifeSigns(target);
  
  if (alive) {
    // Fire phaser to extract data
    const data = await crawler.firePhaser(target);
    console.log('Extracted:', data.content.substring(0, 100));
  }
  
  // Get ship status
  const status = crawler.getStatus();
  console.log('Ship status:', status);
}

main().catch(console.error);
```

## Running the Demo

```bash
npx tsx server/services/crawlers/StarTrekCrawlerExample.ts
```

## Testing

```bash
# Run tests (if Jest is configured)
npm test -- server/services/crawlers/__tests__/StarTrekCrawler.test.ts
```

## Implementation Details

- **Standalone**: ~450 lines, no external dependencies beyond built-in fetch
- **Rate Limiting**: Automatic based on phaser setting
- **Error Handling**: Graceful fallbacks for failed operations
- **Type Safe**: Full TypeScript implementation

## API Reference

### Constructor
```typescript
new StarTrekCrawler()
```

### Methods

#### Warp Drive
- `setWarpSpeed(speed: number): void` - Set warp speed (1-9)
- `warpJump(distance: WarpDistance): Promise<string>` - Jump to new location

#### Transporter
- `beamTo(target: string): Promise<void>` - Beam to deep URL
- `emergencyBeamOut(): Promise<void>` - Emergency escape

#### Sensors
- `longRangeScan(): Promise<string[]>` - Discover targets
- `detectLifeSigns(target: string): Promise<boolean>` - Check target status

#### Phasers
- `setPhaserSetting(setting: PhaserSetting): Promise<void>` - Set phaser level (1-10)
- `firePhaser(target: string): Promise<Data>` - Extract data from target

#### Prime Directive
- `setPrimeDirective(enabled: boolean): void` - Toggle ethics mode
- `getPrimeDirective(): boolean` - Get current mode

#### Missions
- `explore(sector: string): Promise<Data[]>` - Explore sector
- `surgicalStrike(target: string): Promise<Data>` - Precision extraction

#### Status
- `getStatus()` - Get current ship status

## Data Structure

```typescript
interface Data {
  content: string;      // Extracted content
  confidence: number;   // Confidence score (0-1)
  timestamp: number;    // Extraction time
  target: string;       // Target URL
  metadata?: {
    phaserSetting: number;
    warpSpeed: number;
    primeDirective: boolean;
  };
}
```

## Best Practices

1. **Always enable Prime Directive** for ethical crawling
2. **Use appropriate phaser settings** - start with low settings (1-3)
3. **Respect rate limits** - the crawler enforces them automatically
4. **Handle errors gracefully** - operations may fail
5. **Monitor ship status** - track request count and timing

## Security

- ✅ No security vulnerabilities (CodeQL verified)
- ✅ Built-in rate limiting prevents abuse
- ✅ Timeout handling for all requests
- ✅ Prime Directive mode for ethical operations

## License

Part of the Bad-Blue PANTHEON intelligence gathering system.

## 🖖 Live Long and Prosper!
