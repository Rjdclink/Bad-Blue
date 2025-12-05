# ML & NLP Intelligence Layer

## Overview

The ML & NLP Intelligence Layer is a Node-compatible machine learning and natural language processing system integrated into the People Finder OSINT pipeline. It uses Node-native libraries and tools to enhance OSINT data quality, perform entity resolution, and provide confidence scoring.

## Architecture

### Components

1. **Worker Orchestrator** (`workerOrchestrator.ts`)
   - Manages execution of ML/NLP workers
   - Supports sequential and parallel execution
   - Health monitoring and error handling

2. **NLP Text Processing Worker** (`nlpTextWorker.ts`)
   - Extracts entities (people, organizations, locations, emails, phones, handles)
   - Performs keyword and topic extraction
   - Tokenization and text normalization
   - Uses: `compromise.js` and `natural`

3. **ML Entity Resolution Worker** (`mlEntityResolutionWorker.ts`)
   - Fuzzy matching and entity deduplication
   - Determines when different records refer to the same person
   - Entity clustering by organization/network
   - Uses: `fast-levenshtein` for string matching

4. **ML Confidence Scoring Worker** (`mlConfidenceScoringWorker.ts`)
   - Scores confidence for each attribute and entity
   - Multi-factor scoring (source quality, data completeness, cross-validation, freshness)
   - Risk assessment and quality metrics

5. **Intelligence Service** (`intelligenceService.ts`)
   - Main API for ML/NLP functionality
   - Full pipeline integration
   - OSINT data processing

## Node-Compatible Technology Stack

### NLP Libraries (Currently Used)

- **compromise.js**: Entity extraction (people, organizations, places, dates)
- **natural**: Tokenization, stemming, and text processing
- **Regular expressions**: Email, phone, social handle extraction

### ML Libraries (Currently Used)

- **fast-levenshtein**: Fuzzy string matching for entity resolution
- **Custom algorithms**: Confidence scoring, clustering

### Optional Future Enhancements

The following libraries are NOT currently required but can be added for advanced features:

- **@tensorflow/tfjs-node**: For training custom ML models (entity resolution, classification, anomaly detection)
- **wink-nlp**: Alternative NLP library with better NER support
- **onnxruntime-node**: For running pre-trained ML models exported from PyTorch/TensorFlow

To add these optional dependencies:
```bash
npm install @tensorflow/tfjs-node wink-nlp onnxruntime-node
```

### Future Enhancements

For advanced NLP capabilities (robust NER, dependency parsing), consider:

1. **Option A**: Upgrade to Node-native libraries with better NLP support
2. **Option B**: Deploy NLP microservices (spaCy/Stanford CoreNLP)
   - Run as separate HTTP/JSON API services
   - Node backend calls microservice for advanced NLP
   - See microservice documentation below

## Integration with People Finder

The ML/NLP Intelligence Layer integrates into the existing OSINT pipeline at the following points:

### In `peopleSearch.ts`

```typescript
// After collecting OSINT data from multiple sources
const mlnlpResults = await mlnlpIntelligenceService.processOSINTData({
  text: combinedText,
  entities: entityRecords,
  sources: osintSources,
});

// Extract entities and enhance report
if (mlnlpResults.nlpResults) {
  // Add emails, phones, locations, organizations to report
}

// Update confidence scores
if (mlnlpResults.confidenceScores) {
  // Use ML confidence scores to refine overall report confidence
}
```

### Processing Pipeline

```
OSINT Data Collection
        ↓
NLP Text Processing Worker
        ↓ (extracts entities, keywords, topics)
ML Entity Resolution Worker
        ↓ (deduplicates and merges records)
ML Confidence Scoring Worker
        ↓ (scores attribute/entity confidence)
Enhanced OSINT Report
```

## API Reference

### Main Service: `mlnlpIntelligenceService`

#### `processText(text: string, metadata?: Record<string, any>): Promise<NLPResult>`

Process text through NLP pipeline.

**Returns:**
```typescript
{
  entities: ExtractedEntity[];     // People, orgs, locations, emails, etc.
  keywords: string[];               // Key terms
  topics: string[];                 // Main topics
  tokens: string[];                 // Word tokens
  normalizedText: string;           // Cleaned text
  language: string;                 // Detected language
}
```

#### `resolveEntities(records: EntityRecord[]): Promise<ResolvedEntity[]>`

Resolve entities across multiple records.

**Input:**
```typescript
{
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  organization?: string;
  source: string;
}
```

**Returns:**
```typescript
{
  primaryId: string;
  primaryName: string;
  names: string[];                  // All name variations
  emails: string[];                 // All emails
  phones: string[];                 // All phones
  locations: string[];              // All locations
  organizations: string[];          // All organizations
  sources: string[];                // Data sources
  confidence: number;               // 0-100
  matchScore: number;               // Match quality
}
```

#### `scoreEntities(entities: any[]): Promise<EntityConfidenceScore[]>`

Score confidence for entities.

**Returns:**
```typescript
{
  entityId: string;
  overallConfidence: number;        // 0-100
  attributes: AttributeScore[];     // Per-attribute scores
  riskFactors: string[];            // Identified risks
  qualityMetrics: {
    dataRichness: number;           // 0-1
    sourceReliability: number;      // 0-1
    consistencyScore: number;       // 0-1
  };
}
```

#### `processFullPipeline(text: string, existingRecords?: EntityRecord[], options?: MLNLPProcessingOptions): Promise<MLNLPResult>`

Run complete ML/NLP pipeline.

**Options:**
```typescript
{
  enableNLP?: boolean;              // Default: true
  enableEntityResolution?: boolean; // Default: true
  enableConfidenceScoring?: boolean;// Default: true
  parallel?: boolean;               // Default: false
}
```

#### `processOSINTData(osintData): Promise<MLNLPResult>`

Process OSINT data (optimized for People Finder integration).

**Input:**
```typescript
{
  text?: string;
  entities?: EntityRecord[];
  sources?: any[];
}
```

## Usage Examples

### Basic Text Processing

```typescript
import { mlnlpIntelligenceService } from './services/mlnlp';

const text = "John Doe works at ABC Corporation in New York. Contact: john@abc.com";
const nlpResults = await mlnlpIntelligenceService.processText(text);

console.log(nlpResults.entities);
// [
//   { type: 'person', value: 'John Doe', confidence: 0.8 },
//   { type: 'org', value: 'ABC Corporation', confidence: 0.75 },
//   { type: 'location', value: 'New York', confidence: 0.7 },
//   { type: 'email', value: 'john@abc.com', confidence: 0.95 }
// ]
```

### Entity Resolution

```typescript
const records = [
  { name: 'John Doe', email: 'john@abc.com', source: 'linkedin' },
  { name: 'J. Doe', email: 'john@abc.com', source: 'twitter' },
  { name: 'John Doe', phone: '555-1234', source: 'whitepages' },
];

const resolved = await mlnlpIntelligenceService.resolveEntities(records);

console.log(resolved[0]);
// {
//   primaryName: 'John Doe',
//   emails: ['john@abc.com'],
//   phones: ['5551234'],
//   sources: ['linkedin', 'twitter', 'whitepages'],
//   confidence: 85
// }
```

### Full Pipeline

```typescript
const text = "Officer John Smith, badge #12345, works at NYPD...";
const existingRecords = [
  { name: 'John Smith', badge: '12345', source: 'roster' }
];

const result = await mlnlpIntelligenceService.processFullPipeline(
  text,
  existingRecords,
  { enableNLP: true, enableEntityResolution: true }
);

console.log(result);
// {
//   nlpResults: { entities: [...], keywords: [...] },
//   resolvedEntities: [...],
//   confidenceScores: [...],
//   processingTime: 245,
//   workersExecuted: ['nlp_text_worker', 'ml_entity_resolution_worker', ...],
//   success: true
// }
```

## Confidence Scoring

### Factors

Each attribute is scored based on multiple factors:

1. **Source Quality (40%)**: Reliability of the data source
   - Government databases: 95%
   - Court records: 90%
   - Professional networks: 75%
   - Social media: 60%
   - Web search: 50%

2. **Data Completeness (25%)**: How complete the data is
   - Complete email address: 100%
   - Full name (first + last): 100%
   - Partial phone: 60%

3. **Cross-Validation (25%)**: Multiple sources confirming same data
   - 3+ sources: 90%
   - 2 sources: 75%
   - 1 source: 60%

4. **Freshness (10%)**: How recent the data is
   - < 30 days: 100%
   - < 90 days: 90%
   - < 1 year: 60%
   - > 2 years: 20%

### Quality Metrics

- **Data Richness**: How many attributes are populated
- **Source Reliability**: Average reliability of sources
- **Consistency Score**: How consistent data is across sources

## Advanced NLP Microservice (Optional)

For advanced NLP capabilities beyond Node-native libraries, you can deploy separate microservices.

### Architecture

```
┌─────────────────┐
│   Node Backend  │
│  (LegalWhat)    │
└────────┬────────┘
         │ HTTP/JSON
         ↓
┌─────────────────┐
│  NLP Microservice│
│  (Python/spaCy) │
│  or             │
│  (Java/CoreNLP) │
└─────────────────┘
```

### Example: spaCy Microservice

#### `nlp-microservice.py`

```python
from flask import Flask, request, jsonify
import spacy

app = Flask(__name__)
nlp = spacy.load("en_core_web_lg")

@app.route('/analyze', methods=['POST'])
def analyze():
    text = request.json['text']
    doc = nlp(text)
    
    entities = []
    for ent in doc.ents:
        entities.append({
            'text': ent.text,
            'type': ent.label_,
            'start': ent.start_char,
            'end': ent.end_char
        })
    
    return jsonify({
        'entities': entities,
        'tokens': [token.text for token in doc]
    })

if __name__ == '__main__':
    app.run(port=5001)
```

#### Node Integration

```typescript
// In nlpTextWorker.ts - optional microservice fallback
async function callNLPMicroservice(text: string) {
  const response = await fetch('http://localhost:5001/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  return response.json();
}
```

### Deployment

1. Deploy microservice separately (Docker, separate server)
2. Configure Node backend to call microservice
3. Implement fallback to Node-native NLP if microservice unavailable
4. Add health checks and circuit breakers

## Performance Considerations

### Processing Times (Approximate)

- NLP Text Processing: 50-200ms for typical OSINT text
- Entity Resolution: 10-50ms for 10-50 records
- Confidence Scoring: 5-20ms per entity

### Optimization Tips

1. **Batch Processing**: Process multiple texts in parallel
2. **Caching**: Cache NLP results for repeated queries
3. **Selective Processing**: Only run ML/NLP when needed
4. **Worker Parallel Execution**: Use `executeParallel()` when possible

## Testing

### Health Checks

```typescript
const health = await mlnlpIntelligenceService.getHealthStatus();
console.log(health);
// {
//   healthy: true,
//   workers: {
//     nlp_text_worker: true,
//     ml_entity_resolution_worker: true,
//     ml_confidence_scoring_worker: true
//   }
// }
```

### Unit Tests

See `server/services/mlnlp/__tests__/` for comprehensive test suite.

## Security Considerations

1. **Data Privacy**: All processing happens in-memory, no persistent storage
2. **Input Validation**: Sanitize text inputs to prevent injection
3. **Rate Limiting**: Implement rate limits for ML/NLP operations
4. **Resource Limits**: Set timeouts and memory limits for processing

## Troubleshooting

### Common Issues

1. **Worker initialization failure**
   - Check that all npm packages are installed
   - Verify Node version compatibility (20.x)

2. **Low confidence scores**
   - Insufficient data sources
   - Poor quality source data
   - Review source reliability mappings

3. **Entity resolution mismatches**
   - Adjust `NAME_MATCH_THRESHOLD` in `mlEntityResolutionWorker.ts`
   - Improve normalization functions

## Future Enhancements

1. **TensorFlow.js Integration**
   - Train custom NER models
   - Document classification
   - Anomaly detection

2. **ONNX Runtime**
   - Load pre-trained PyTorch/TensorFlow models
   - Run in Node via ONNX Runtime

3. **Advanced Clustering**
   - Network analysis and relationship mapping
   - Community detection algorithms

4. **Active Learning**
   - User feedback loop for improving models
   - Adaptive confidence thresholds

## References

- [compromise.js Documentation](https://github.com/spencermountain/compromise)
- [natural Documentation](https://github.com/NaturalNode/natural)
- [TensorFlow.js Documentation](https://www.tensorflow.org/js)
- [ONNX Runtime](https://onnxruntime.ai/)
