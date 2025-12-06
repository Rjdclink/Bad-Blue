# PANTHEON Web Search System

## Overview

PANTHEON uses a 3-tier OpenRouter model orchestration system for web searching. This provides comprehensive, real-time web research capabilities with built-in fallback mechanisms for high availability.

## Architecture

### Primary: OpenRouter 3-Model Orchestration

The web search system uses three specialized OpenRouter models executing in parallel with orchestrated aggregation:

#### 1. Meta Llama 4 Maverick
- **Model ID**: `meta-llama/llama-4-maverick:free`
- **Context Window**: 256K tokens
- **Specialization**: Multimodal research capabilities
- **Tier**: Free
- **Best For**: Complex queries requiring deep analysis and multimodal understanding

#### 2. xAI Grok 4.1 Fast
- **Model ID**: `xai/grok-4.1-fast:free`
- **Context Window**: 2M tokens
- **Specialization**: Real-time research and rapid information retrieval
- **Tier**: Free
- **Best For**: Time-sensitive queries and large-context analysis

#### 3. DeepSeek R1T2 Chimera
- **Model ID**: `tng/deepseek-r1t2-chimera:free`
- **Context Window**: 164K tokens
- **Specialization**: Reasoning-focused analysis
- **Tier**: Free
- **Best For**: Complex reasoning tasks and logical inference

### Fallback: Gemini Grounding

When OpenRouter is unavailable, the system falls back to:
- **Gemini 2.5 Flash** with Google Search grounding
- Provides web search capabilities through Gemini's built-in search tool
- Automatic circuit breaker prevents excessive API calls

## Implementation Details

### Parallel Execution

All three OpenRouter models are queried simultaneously via `server/openRouterWebSearch.ts`:

```typescript
import { orchestratedWebSearch } from './openRouterWebSearch';

const result = await orchestratedWebSearch(query, {
  useOnlinePlugin: false, // Avoid costs - use base models only
  timeout: 30000,
});
```

### Result Aggregation

Results from all models are aggregated with:
- **Confidence Scoring**: Based on model agreement and response quality
- **Source Extraction**: URLs are extracted and deduplicated from all responses
- **Content Synthesis**: Responses are combined with attribution to each model

### Rate Limiting

Each model has independent rate limiting:
- **Daily Limit**: 50 requests per model (conservative for free tier)
- **Circuit Breaker**: 3 consecutive failures trigger 5-minute cooldown
- **Automatic Reset**: Daily limits reset at UTC midnight

## Usage Examples

### Basic Web Search

```typescript
import { unifiedSearch } from './server/webSearchService';

// Automatically uses OpenRouter 3-model orchestration
const results = await unifiedSearch('police officer misconduct database', {
  limit: 10,
  category: 'officer',
});

console.log(results); // Array of EnhancedSearchResult
```

### Officer Records Search

```typescript
import { searchOfficerRecords } from './server/webSearchService';

const officerData = await searchOfficerRecords(
  'John Smith',
  'Los Angeles Police Department',
  'California'
);

console.log(officerData.sources); // URLs from web search
console.log(officerData.dataQuality); // Quality score 0-100
```

### Technical Documentation Search

```typescript
import { searchTechnicalGuidance } from './server/webSearchService';

const solutions = await searchTechnicalGuidance(
  'TypeError: Cannot read property of undefined',
  'TypeScript'
);

console.log(solutions); // Ranked by relevance score
```

## Monitoring and Health Checks

### Check Search Availability

```typescript
import { isWebSearchAvailable } from './server/webSearchService';

const status = isWebSearchAvailable();
console.log(status.openrouter); // boolean
console.log(status.gemini); // boolean
console.log(status.any); // boolean
```

### Get Model Status

```typescript
import { getWebSearchModelStatus } from './server/openRouterWebSearch';

const status = getWebSearchModelStatus();
console.log(status['meta-llama/llama-4-maverick:free']);
// { available: true, requestsRemaining: 45, error?: string }
```

## Configuration

### Environment Variables

```bash
# Required for OpenRouter (primary search)
OPENROUTER_API_KEY=your_openrouter_key

# Optional for Gemini fallback
GEMINI_API_KEY=your_gemini_key
GOOGLE_API_KEY=your_gemini_key  # Alternative name

# Control features
WEB_SEARCH_ENABLED=true  # Set to 'false' to disable all web search
```

### Circuit Breaker Settings

The circuit breaker protects against API failures:
- **Failure Threshold**: 3 consecutive failures
- **Cooldown Period**: 5 minutes
- **Auto-Recovery**: Automatically re-enables after cooldown

## Integration with PANTHEON

The web search system is fully integrated with PANTHEON's multi-AI orchestration:

1. **AI Sub-Agent**: Uses web search for autonomous officer data collection
2. **Legal Research**: Powers statute and case law lookups
3. **Worker Repair**: Provides technical documentation for self-healing
4. **Officer Search**: Combines web search with database queries

## Performance Characteristics

### Response Times
- **OpenRouter Parallel**: 2-5 seconds (all models execute simultaneously)
- **Gemini Fallback**: 1-3 seconds (single model query)
- **Timeout**: 30 seconds per model (configurable)

### Accuracy
- **Confidence Scoring**: 0-100% based on model agreement
- **Source Quality**: Prioritizes .gov, .edu, and verified news sources
- **Reliability Ratings**: High/Medium/Low based on source domain

### Cost Efficiency
- **OpenRouter Models**: Free tier (no inference costs)
- **Gemini Grounding**: Free with API key (subject to quotas)
- **:online plugin**: Disabled by default (would incur costs)

## Error Handling

The system implements comprehensive error handling:

1. **Model Failure**: Continue with remaining models
2. **All Models Fail**: Fall back to Gemini grounding
3. **All Services Fail**: Return empty results with error logging
4. **Rate Limits**: Circuit breaker prevents excessive retries

## Best Practices

### Query Optimization

```typescript
// Good: Specific, focused queries
await unifiedSearch('Los Angeles Police Department official website contact');

// Avoid: Overly broad queries
await unifiedSearch('police'); // Too generic
```

### Rate Limit Management

```typescript
// Check availability before batch operations
const status = isWebSearchAvailable();
if (!status.any) {
  console.log('Web search unavailable, defer batch operation');
  return;
}

// Batch searches with delays
for (const query of queries) {
  await unifiedSearch(query);
  await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay
}
```

### Fallback Handling

```typescript
const results = await unifiedSearch(query);
if (results.length === 0) {
  // Web search unavailable or no results
  // Fall back to database-only search
  const dbResults = await searchDatabase(query);
  return dbResults;
}
```

## Troubleshooting

### "OpenRouter web search not available"
- Check `OPENROUTER_API_KEY` is set in environment
- Verify API key is valid and has remaining quota

### "All models rate limited"
- Wait for daily reset (UTC midnight)
- Consider implementing result caching to reduce API calls
- Review and optimize query frequency

### "Gemini fallback not working"
- Check `GEMINI_API_KEY` or `GOOGLE_API_KEY` is set
- Verify Gemini API quota is not exceeded
- Check circuit breaker status with `getSearchStatus()`

## Security Considerations

- API keys stored securely in environment variables
- No API keys logged or exposed in responses
- Rate limiting prevents abuse
- Circuit breakers prevent excessive costs
- Source validation prioritizes trusted domains

## Future Enhancements

Planned improvements for the web search system:
- Query result caching with Redis
- Semantic search with vector embeddings
- Custom model fine-tuning for legal queries
- Enhanced source credibility scoring
- Real-time web scraping integration

---

**Status**: Production Ready ✅  
**Version**: 1.0  
**Last Updated**: December 2024
