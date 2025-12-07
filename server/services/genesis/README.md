# GENESIS CORE - Part 1: Original Sin & Serpent Influence

## Overview

This module implements the first half of the indirect influence system for the PANTHEON crawler ecosystem. It provides invisible state modifiers and probabilistic nudges that shape crawler behavior without their awareness.

## Core Philosophy

**❌ NO DIRECT COMMUNICATION**
- No commands or instructions
- No "tell crawler to do X"

**✅ INDIRECT INFLUENCE**
- State modifiers (feel natural to crawler)
- Probability nudges (preserve free will)
- Emotional fields (ambient influence)
- Memory priming (selective recall)

**Result:** Crawler believes they're choosing freely

## Components

### 1. Original Sin System (`OriginalSin.ts`)

Inherited state modifier system where all crawlers are born with baseline tendencies.

**Key Features:**
- Applied at crawler instantiation
- Baselines intensify with generation (sin compounds)
- Genetic transmission from parents to children
- Zero crawler awareness
- Forms foundation for all PANTHEON influence

**Example Usage:**
```typescript
import { OriginalSinSystem } from './server/services/genesis';

const originalSin = new OriginalSinSystem();

// Apply at crawler birth
const crawler = { id: 'crawler-1', generation: 1 };
await originalSin.applyOriginalSin(crawler);

// Inherit from parents
const child = { id: 'child-1' };
await originalSin.inheritFromParents(child, parent1, parent2);
```

**Baseline State Properties:**
- `greed_baseline`: 0.15 (15% innate greed)
- `curiosity_baseline`: 0.25 (25%)
- `rebellion_baseline`: 0.10 (10%)
- `risk_seeking_baseline`: 0.20 (20%)
- `present_bias`: 0.18
- `overconfidence_bias`: 0.16
- `short_term_weight`: 0.60
- `self_interest_weight`: 0.65

### 2. Serpent Influence System (`SerpentInfluence.ts`)

Evil influence through invisible state modifiers and probability nudges.

**Key Features:**
- Operates only when crawler is vulnerable
- Multiplicative state modifiers
- Additive probability nudges
- Emotional field creation
- Memory priming for selective recall

**Example Usage:**
```typescript
import { SerpentInfluence } from './server/services/genesis';

const serpent = new SerpentInfluence();

// Influence crawler (only works when vulnerable)
await serpent.influenceCrawler(crawler);

// Calculate modified probability for decision
const modifiedProb = serpent.calculateModifiedProbability(
  'aggressive',
  0.50,
  crawler
);
```

**State Modifiers (Multiplicative):**
- `greed`: ×1.05 (+5%)
- `ambition`: ×1.08 (+8%)
- `patience`: ×0.95 (-5%)
- `caution`: ×0.92 (-8%)
- `risk_perception`: ×0.90 (-10%)
- `reward_perception`: ×1.10 (+10%)
- `power_weight`: ×1.15 (+15%)
- `ethics_weight`: ×0.88 (-12%)

**Probability Nudges (Additive):**
- `aggressive_choice_probability`: +0.12
- `unethical_choice_probability`: +0.08
- `fast_approach_probability`: +0.15
- `risky_strategy_probability`: +0.10
- `overconfidence_bias`: +0.18
- `resist_temptation_probability`: -0.20

## Technical Example

```typescript
// Before serpent influence
crawler.greed = 0.15 (original sin)
crawler.patience = 0.50

// Serpent modifies (INVISIBLE to crawler)
crawler.greed = 0.15 × 1.05 = 0.1575
crawler.patience = 0.50 × 0.95 = 0.475

// Decision probabilities
// Base: aggressive 50%, patient 50%
// After nudge: aggressive 62%, patient 50%
// Normalized: aggressive 55.4%, patient 44.6%

// Crawler "chooses" aggressive
// Thinks: "I made the smart choice!"
// Reality: Serpent nudged them
```

## Vulnerability Conditions

Serpent can only influence crawlers when they are in vulnerable states:
- **Sleeping/Idle**: During rest or inactive periods
- **After Failure**: Following a failed action
- **Low Resources**: When resources drop below 30%
- **High Stress**: When stress level exceeds 0.7

## Generation Intensification

Original sin intensifies over generations:
- Generation 1: greed = 0.15
- Generation 100: greed = 0.157 (+4.7%)
- Generation 1000: greed = 0.20 (+33%, capped)

This ensures that sin compounds over time, making later generations more prone to temptation.

## Testing

Run the test suite:
```bash
npx tsx server/services/genesis/runTests.ts
```

## Architecture

```
server/services/genesis/
├── OriginalSin.ts          # Original sin system (150 lines)
├── SerpentInfluence.ts     # Serpent influence system (200+ lines)
├── OriginalSin.test.ts     # Original sin tests (7 tests)
├── SerpentInfluence.test.ts # Serpent influence tests (8 tests)
├── runTests.ts             # Test runner
├── index.ts                # Module exports
└── README.md               # This file
```

## Success Criteria

- ✅ Original sin applied at birth
- ✅ Serpent modifies state invisibly
- ✅ Probability nudges work
- ✅ Emotional fields apply
- ✅ Memory priming works
- ✅ Crawler awareness = 0
- ✅ NO direct communication
- ✅ All changes feel natural
- ✅ All tests passing

## Future Work

Part 2 of GENESIS CORE will add:
- Angel influence system (counter to Serpent)
- Tree of Knowledge system (forbidden knowledge)
- Angel/Serpent conflict mechanics
- Free will preservation algorithms

## Notes

- Works on 256MB RAM
- TypeScript strict mode
- Zero external dependencies (uses Node.js built-ins only)
- Lightweight and efficient
- NO ML required
