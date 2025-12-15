# Monte Carlo Crawler Optimization Configuration

## Overview

This document describes the Monte Carlo decision layer that continuously samples, scores, and refines crawler behavior under uncertainty using stochastic simulation.

**One-Sentence Directive:**
> "Run Monte Carlo optimization over 50 seeds using 4 specialized crawlers with 10 iterations per seed, randomizing crawler selection and crawl parameters per run, scoring outcomes, and halting when strategy rankings stabilize."

---

## Selected Crawlers

### A. STARTREK CRAWLER (40% Initial Weight)
**File:** `server/services/crawlers/StarTrekCrawler.ts`

| Attribute | Value |
|-----------|-------|
| **Class Name** | `StarTrekCrawler` |
| **Description** | Federation Explorer - Broad discovery with warp jumps |
| **Capabilities** | Warp speed (1-9), Transporter beaming, Long-range sensors, Phasers (1-10), Prime Directive mode |
| **Best For** | Initial exploration, Sitemap discovery, Link mapping, Domain reconnaissance |

### B. BLIZZARD CRAWLER (30% Initial Weight)
**File:** `server/services/crawlers/TrinityCrawlers.ts`

| Attribute | Value |
|-----------|-------|
| **Class Name** | `BlizzardCrawler` |
| **Description** | Ice Storm - Mass parallel scraping with unique fingerprints |
| **Capabilities** | Unique fingerprints (snowflakes), Storm intensity levels, Avalanche mode, Ice crystal caching |
| **Best For** | High-volume extraction, Mass data gathering, Parallel processing, Large site crawls |

### C. BIRDOFPREY CRAWLER (20% Initial Weight)
**File:** `server/services/crawlers/BirdOfPreyCrawler.ts`

| Attribute | Value |
|-----------|-------|
| **Class Name** | `BirdOfPreyCrawler` |
| **Description** | Klingon Predator - Stealth operations with perfect cloaking |
| **Capabilities** | Perfect cloaking, Fire while cloaked, Disruptors (150% power), Quantum fingerprints |
| **Best For** | Protected sites, Anti-bot bypass, Aggressive extraction, Stealth operations |

### D. HYDRA CRAWLER (10% Initial Weight)
**File:** `server/services/pantheon/crawlers/hydra.ts`

| Attribute | Value |
|-----------|-------|
| **Class Name** | `HydraCrawler` |
| **Description** | Multi-Head Explorer - Adaptive spawning with pheromone pathfinding |
| **Capabilities** | Dynamic head spawning (up to 5), Pheromone trails, Richness assessment, Auto-pruning |
| **Best For** | Complex site structures, Adaptive exploration, Content-rich discovery, Deep site navigation |

---

## Configuration Parameters

### Seeds
| Parameter | Value | Notes |
|-----------|-------|-------|
| Count | 50 | Start with signal density before explosion |
| Diversity Required | Yes | Spanning different site structures |
| Max Per Domain | 5 | Enforce diversity |

### Iterations
| Parameter | Value | Notes |
|-----------|-------|-------|
| Per Seed | 10 | Minimum for Monte Carlo convergence |
| Total Runs | 500 | 50 seeds × 10 iterations |
| Batch Size | 50 | Process and rebalance after each batch |

### Randomization (Must change ≥2 per iteration)
1. **crawlerChoice** - Which crawler to use
2. **crawlDepth** - How deep to traverse
3. **renderVsFetch** - JavaScript rendering vs direct fetch
4. **delayTiming** - Request delay variance
5. **linkFollowProbability** - Link traversal rate
6. **extractionFocus** - Content vs links vs metadata

### Scoring (Simple, Brutal)
| Metric | Weight | Notes |
|--------|--------|-------|
| Pages Discovered | 30% | Raw volume |
| Usable Content Extracted | 35% | Quality signal |
| Time to First Result | 20% | Speed matters |
| Failure Rate (inverted) | 15% | Reliability |

### Convergence Rule
> "Stop Monte Carlo when the top 2 crawler strategies remain unchanged for 3 consecutive iteration batches."

This prevents infinite burn while ensuring genuine stabilization.

---

## Scale-Up Path

| Phase | Seeds | Iterations/Seed | Total Runs |
|-------|-------|-----------------|------------|
| Phase 1 (Current) | 50 | 10 | 500 |
| Phase 2 | 100 | 15 | 1,500 |
| Phase 3 | 200 | 20 | 4,000 |

Only scale up after Phase 1 converges successfully.

---

## Implementation Files

| File | Purpose |
|------|---------|
| `server/services/monteCarlo/MonteCarloConfig.ts` | Crawler definitions and configuration |
| `server/services/monteCarlo/MonteCarloCrawlerOptimizer.ts` | Main optimization engine |
| `server/services/monteCarlo/index.ts` | Module exports |
| `server/routes/montecarlo.routes.ts` | API endpoints |

---

## Usage

```typescript
import { monteCarloCrawlerOptimizer } from './services/monteCarlo';

// Add diverse seed URLs
monteCarloCrawlerOptimizer.addSeeds([
  'https://example.com',
  'https://news.site.com',
  'https://gov.state.us',
  // ... 50 diverse URLs
]);

// Run optimization
await monteCarloCrawlerOptimizer.runOptimization();

// Get results
const results = monteCarloCrawlerOptimizer.getResults();
console.log('Top Strategy:', results.topStrategy);
console.log('Final Weights:', results.finalWeights);
console.log('Recommendation:', results.recommendation);
```

---

## Events

| Event | Payload |
|-------|---------|
| `seeds-updated` | `{ count: number }` |
| `optimization-started` | `{ seeds: number, totalRuns: number }` |
| `run-completed` | `{ runIndex, totalRuns, outcome }` |
| `batch-processed` | `{ batch, rankings, isStable }` |
| `optimization-complete` | Full results object |

---

*Last Updated: December 15, 2024*
