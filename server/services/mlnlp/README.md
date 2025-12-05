# ML/NLP Intelligence Layer

Node-compatible Machine Learning and Natural Language Processing for OSINT People Finder.

## Quick Start

```typescript
import { mlnlpIntelligenceService } from './services/mlnlp';

// Process text
const text = "John Doe works at ABC Corp. Email: john@abc.com";
const nlpResults = await mlnlpIntelligenceService.processText(text);

// Resolve entities
const records = [
  { name: 'John Doe', email: 'john@abc.com', source: 'linkedin' },
  { name: 'J. Doe', email: 'john@abc.com', source: 'twitter' },
];
const resolved = await mlnlpIntelligenceService.resolveEntities(records);

// Full pipeline
const result = await mlnlpIntelligenceService.processFullPipeline(text, records);
```

## Components

- **NLP Text Worker**: Entity extraction (people, orgs, locations, emails, phones)
- **ML Entity Resolution**: Fuzzy matching and deduplication
- **Confidence Scoring**: Multi-factor reliability assessment
- **Worker Orchestrator**: Manages ML/NLP pipeline execution

## Technology Stack

- **compromise.js**: Entity extraction
- **natural**: Tokenization and stemming  
- **fast-levenshtein**: Fuzzy string matching
- Ready for **TensorFlow.js** and **ONNX Runtime**

## Testing

Run integration tests:

```bash
npx tsx server/services/mlnlp/__tests__/integration.test.ts
```

## Documentation

See [docs/ML_NLP_INTELLIGENCE.md](../../../docs/ML_NLP_INTELLIGENCE.md) for complete documentation.

## Architecture

```
Text Input
    ↓
NLP Text Worker (entity extraction)
    ↓
ML Entity Resolution (deduplication)
    ↓
Confidence Scoring (reliability assessment)
    ↓
Enhanced OSINT Report
```
