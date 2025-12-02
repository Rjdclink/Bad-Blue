# BadBlue AI Architecture

## Overview

BadBlue implements a **7-way coordinated parallel AI system** that orchestrates multiple AI providers to complete complex tasks. The system maintains **100% free tier architecture** while providing intelligent model selection and graceful degradation.

## System Architecture

### Context Separation

The system enforces strict context separation between autonomous and user-initiated tasks:

| Context | Providers | Purpose |
|---------|-----------|---------|
| **AUTONOMOUS** | Groq + Mistral | Background tasks, worker jobs |
| **USER** | Gemini + Claude + DeepSeek + Grok + Kimi | User-facing features |

### Provider Details

#### AUTONOMOUS Providers (2-Way)

1. **Groq** (`llama-3.3-70b-versatile`)
   - **Capacity**: Unlimited for autonomous functions
   - **Strength**: Rapid analysis, fast inference
   - **Use Case**: Primary autonomous provider

2. **Mistral** (`mistral-small-latest`)
   - **Capacity**: 150k tokens/day
   - **Strength**: Balanced performance
   - **Use Case**: Autonomous fallback

#### USER Providers (5-Way)

1. **Gemini**
   - `gemini-2.5-flash-lite`: 1000 RPD, ultra-fast, lightweight tasks
   - `gemini-2.5-flash`: 50 RPD, multimodal, advanced tasks
   - **Strength**: Google Search grounding, multimodal

2. **Claude**
   - `claude-3-5-haiku`: Fast responses, verification
   - `claude-3-5-sonnet`: Advanced reasoning, legal analysis
   - **Strength**: Superior reasoning, legal expertise

3. **DeepSeek** (via OpenRouter)
   - Model: `tngtech/deepseek-r1t2-chimera:free`
   - **Capacity**: 50 RPD
   - **Strength**: 671B params, pattern recognition

4. **Grok** (via OpenRouter)
   - Model: `x-ai/grok-4.1-fast:free`
   - **Capacity**: 50 RPD
   - **Strength**: 2M context, multimodal

5. **Kimi** (via OpenRouter)
   - Model: `moonshotai/kimi-k2:free`
   - **Capacity**: 50 RPD
   - **Strength**: 1T params, structured extraction

### Total Free Capacity

- **USER**: 1,300+ requests/day
  - Gemini Flash Lite: 1000 RPD
  - Gemini Flash: 50 RPD
  - Claude: ~50 RPD
  - DeepSeek: 50 RPD
  - Grok: 50 RPD
  - Kimi: 50 RPD
- **AUTONOMOUS**: Unlimited (Groq) + 150k tokens/day (Mistral)

## Core Components

### AI Token Governor (`server/aiTokenGovernor.ts`)

Manages quota allocation and provider selection based on context and task requirements.

**Key Features:**
- Context-aware provider blocking
- Quota tracking per provider
- Intelligent fallback chains
- Connection pool optimization (single aggregated query)

**Context Enforcement:**
```typescript
// AUTONOMOUS context: Only Groq and Mistral
if (task.context === UsageContext.AUTONOMOUS) {
  // Block: GEMINI, CLAUDE, DEEPSEEK, GROK, KIMI
}

// USER context: Only Gemini, Claude, DeepSeek, Grok, Kimi
if (task.context === UsageContext.USER) {
  // Block: GROQ, MISTRAL
}
```

### AI Model Selector (`server/aiModelSelector.ts`)

Scores providers across 11+ attributes to select optimal models for each task.

**Task Attributes:**
- `needsMultimodal` - Image/video processing
- `needsLongContext` - Large document handling
- `needsMassiveContext` - 2M+ token contexts
- `needsStructuredOutput` - JSON/structured data
- `needsCodeGeneration` - Code tasks
- `needsCreativeWriting` - Creative content
- `needsReasoning` - Complex analysis
- `needsFastResponse` - Low latency
- `needsVerification` - Fact-checking
- `needsLegalAnalysis` - Legal expertise
- `needsImageAnalysis` - Image understanding
- `needsPatternRecognition` - Pattern detection
- `needsDataExtraction` - Data parsing

**Model Selection Logic:**
```typescript
// Gemini selection
if (needsMultimodal || needsImageAnalysis) → gemini-2.5-flash (50 RPD)
else → gemini-2.5-flash-lite (1000 RPD)

// Claude selection
if (needsLegalAnalysis || needsCreativeWriting) → claude-3-5-sonnet
else → claude-3-5-haiku

// OpenRouter selection
if (needsMassiveContext) → Grok (2M context)
if (needsStructuredOutput) → Kimi (extraction)
if (needsPatternRecognition) → DeepSeek (reasoning)
```

### Collaboration Orchestrator (`server/aiCollaborationOrchestrator.ts`)

Coordinates multi-provider tasks with role-based assignments.

**Orchestration Strategies:**
- `legal-analysis` - Claude Sonnet primary, verification chain
- `multi-perspective` - Parallel provider queries
- `context-split` - Grok for large context processing
- `multimodal-focus` - Gemini/Grok for images
- `parallel-race` - Fastest response wins
- `verify-synthesize` - Cross-check and combine
- `extract-format` - Kimi for structured extraction

**Role Assignments:**
| Role | Best Provider | Fallback |
|------|--------------|----------|
| image-analyst | Grok/Gemini | - |
| rapid-searcher | Gemini Flash Lite | - |
| context-processor | Grok | DeepSeek |
| pattern-analyst | DeepSeek | - |
| legal-analyst | Claude Sonnet | - |
| verifier | Claude Haiku | - |
| data-formatter | Kimi | - |
| synthesizer | Best available | - |

### OpenRouter Service (`server/openRouterService.ts`)

Integrates DeepSeek, Grok, and Kimi via OpenRouter API.

**Features:**
- Circuit breakers (3 failures → 5min cooldown)
- Manual rate limit tracking (50 RPD per model)
- Exponential backoff for 429 errors
- Officer-specific search function

## Usage Examples

### Officer Search (5-Way USER)

```typescript
// Uses intelligent model selection for officer searches
const result = await searchOfficerInformation({
  officerName: "John Smith",
  state: "CA",
  city: "Los Angeles",
  includeGovernment: true,
});

// Orchestration flow:
// 1. Gemini Flash Lite → Initial data harvest
// 2. OpenRouter (DeepSeek/Grok/Kimi) → Supplemental search
// 3. Claude Haiku → Verification
// 4. Claude Sonnet → Synthesis (if legal analysis needed)
```

### Autonomous Task (2-Way)

```typescript
// Background worker task - only Groq/Mistral
const budget = await aiTokenGovernor.getBudgetForTask({
  taskName: 'daily-harvest',
  priority: TaskPriority.MEDIUM_BACKGROUND,
  complexity: TaskComplexity.MODERATE,
  context: UsageContext.AUTONOMOUS, // Forces Groq/Mistral only
});

// Always uses Groq (unlimited) or Mistral (fallback)
```

### Legal Document Generation

```typescript
// Complex legal task - Claude Sonnet + verification
const attrs: TaskAttributes = {
  needsLegalAnalysis: true,
  needsReasoning: true,
  complexity: TaskComplexity.COMPREHENSIVE,
  priority: TaskPriority.CRITICAL,
};

const result = await orchestrator.orchestrateCollaboration(
  'legal-document',
  documentPrompt,
  attrs,
  [AIProvider.CLAUDE, AIProvider.GEMINI]
);

// Uses 'legal-analysis' strategy:
// 1. Claude Sonnet → Legal analysis
// 2. DeepSeek → Pattern matching with precedents
// 3. Claude Haiku → Verification
```

## Configuration

### Environment Variables

```bash
# AUTONOMOUS providers
GROQ_API_KEY=your-groq-key
MISTRAL_API_KEY=your-mistral-key

# USER providers (core)
GEMINI_API_KEY=your-gemini-key
ANTHROPIC_API_KEY=your-anthropic-key

# USER providers (OpenRouter)
OPENROUTER_API_KEY=your-openrouter-key
```

### Provider Availability Check

On startup, the system logs provider availability:

```
[AI Token Governor] Provider availability (7-way system):
  AUTONOMOUS providers (2-way):
    - Groq: ✓ Available
    - Mistral: ✓ Available
  USER providers (5-way):
    - Gemini: ✓ Available
    - Claude: ✓ Available
    - DeepSeek: ✓ Available
    - Grok: ✓ Available
    - Kimi: ✓ Available
```

## Error Handling

### Circuit Breakers

Each provider has independent circuit breakers:
- **Trigger**: 3 consecutive failures
- **Cooldown**: 5 minutes
- **Reset**: Automatic after successful request

### Graceful Degradation

1. **Primary provider fails** → Try next in priority order
2. **All providers in context fail** → Return error with reason
3. **Partial dependency failure** → Continue with available data

### Rate Limit Handling

- OpenRouter: Manual tracking (50 RPD limit)
- Gemini: Adaptive cooldown with exponential backoff
- Claude: Token-based quota tracking

## Best Practices

### Task Classification

1. **Always specify context** - Ensures correct provider pool
2. **Set appropriate complexity** - Affects model selection
3. **Include task attributes** - Enables intelligent routing

### Performance Optimization

1. **Use Flash Lite for high-volume** - 1000 RPD vs 50 RPD
2. **Batch similar requests** - Reduce API calls
3. **Cache results** - 24-hour TTL for officer searches

### Security Considerations

1. **Context separation is enforced** - Cannot bypass programmatically
2. **No sensitive data in prompts** - Redact before sending
3. **Rate limits prevent abuse** - Per-provider tracking

## Migration Notes

### Deprecated: Bing Search API

Bing Web Search API functions are deprecated due to HTTP 402 payment requirements:
- `bingSearch()` → Returns empty, logs warning
- `bingNewsSearch()` → Returns empty, logs warning

**Replacement**: Use OpenRouter models or Gemini Search grounding.

### Model Updates

- Gemini default changed from `gemini-2.5-flash` to `gemini-2.5-flash-lite`
- Pro model (`gemini-2.5-pro`) removed from default rotation due to 2-5 RPM limit

## Troubleshooting

### Common Issues

1. **"No providers available for USER context"**
   - Check: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`
   
2. **"AUTONOMOUS_BLOCK" error**
   - Task is trying to use USER provider in autonomous context
   - Fix: Ensure correct `context` in task metadata

3. **Rate limit errors**
   - Wait for cooldown period (30s-5min)
   - Switch to alternative provider

4. **OpenRouter 429 errors**
   - Daily limit reached (50 RPD per model)
   - Wait for midnight UTC reset

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     AI Token Governor                        │
│  ┌─────────────────┐         ┌─────────────────┐           │
│  │   AUTONOMOUS    │         │      USER       │           │
│  │  ┌───────────┐  │         │  ┌───────────┐  │           │
│  │  │   Groq    │  │         │  │  Gemini   │  │           │
│  │  └───────────┘  │         │  └───────────┘  │           │
│  │  ┌───────────┐  │         │  ┌───────────┐  │           │
│  │  │  Mistral  │  │         │  │  Claude   │  │           │
│  │  └───────────┘  │         │  └───────────┘  │           │
│  └─────────────────┘         │  ┌───────────┐  │           │
│                              │  │ DeepSeek  │  │           │
│                              │  └───────────┘  │           │
│                              │  ┌───────────┐  │           │
│                              │  │   Grok    │  │           │
│                              │  └───────────┘  │           │
│                              │  ┌───────────┐  │           │
│                              │  │   Kimi    │  │           │
│                              │  └───────────┘  │           │
│                              └─────────────────┘           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Model Selector                            │
│  • Scores 9 models across 11+ attributes                    │
│  • Context-aware selection                                  │
│  • Intelligent fallback chains                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                Collaboration Orchestrator                    │
│  • Role-based task assignment                               │
│  • Dependency management                                     │
│  • Result synthesis                                          │
└─────────────────────────────────────────────────────────────┘
```
