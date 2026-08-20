# AI Providers Documentation

Complete documentation for all 7 AI providers integrated into LegalWhat/Bad-Blue.

---

## Overview

**Total Providers**: 7  
**Total Models**: 37  
**Free Models**: 30  
**Paid Models**: 7 (optional, via OpenRouter)  
**Cost**: $0/month for core functionality

---

## Provider Summary

| Provider | Models | Cost | Rate Limits | Use Case |
|----------|--------|------|-------------|----------|
| **OpenRouter** | 12 | FREE + Premium | Varies by model | Multi-provider routing |
| **Gemini** | 3 | FREE | 1500 RPD | Document generation |
| **Groq** | 9 | FREE | 30 RPM | Fast responses, TTS, STT |
| **Mistral** | 1 | FREE | Varies | European data compliance |
| **Anthropic** | 2 | PAID | Pay-per-use | Premium consultations |
| **SambaNova** | 6 | FREE | 20 RPM | DeepSeek, Mistral models |
| **Hugging Face** | 4 | FREE | 30 RPM | Open source models |

**RPD** = Requests Per Day  
**RPM** = Requests Per Minute

---

## 1. OpenRouter (Primary Provider)

**Website**: [openrouter.ai](https://openrouter.ai)  
**Docs**: [openrouter.ai/docs](https://openrouter.ai/docs)  
**Cost**: FREE tier available + Premium models

### Models (12 - Best from Each Provider)

#### 1.1 Groq - Llama 3.3 70B Versatile
```typescript
model: 'groq/llama-3.3-70b-versatile'
```
- **Context**: 128K tokens
- **Strengths**: Ultra-fast inference, versatile
- **Best for**: Quick responses, general tasks
- **Rate Limit**: High throughput

#### 1.2 Google AI Studio - Gemini 2.0 Flash
```typescript
model: 'google/gemini-2.0-flash-exp:free'
```
- **Context**: 1M tokens
- **Strengths**: Multimodal, fast, web grounded
- **Best for**: Image analysis, document processing
- **Rate Limit**: Free tier

#### 1.3 NVIDIA - Nemotron 70B
```typescript
model: 'nvidia/llama-3.1-nemotron-70b-instruct:free'
```
- **Context**: 128K tokens
- **Strengths**: Code generation, reasoning
- **Best for**: Technical analysis, coding
- **Rate Limit**: Free tier

#### 1.4 OpenAI - GPT-4o Mini
```typescript
model: 'openai/gpt-4o-mini'
```
- **Context**: 128K tokens
- **Strengths**: Balanced capability, reliable
- **Best for**: General AI tasks
- **Rate Limit**: Pay-per-use

#### 1.5 Mistral - Mistral Large
```typescript
model: 'mistralai/mistral-large-2411'
```
- **Context**: 128K tokens
- **Strengths**: European compliance, reasoning
- **Best for**: Legal analysis, GDPR compliance
- **Rate Limit**: Pay-per-use

#### 1.6 DeepSeek - R1
```typescript
model: 'deepseek/deepseek-r1-0528:free'
```
- **Context**: 64K tokens
- **Strengths**: Advanced reasoning, pattern recognition
- **Best for**: Complex analysis, legal reasoning
- **Rate Limit**: Free tier

#### 1.7 Anthropic - Claude 3.5 Sonnet
```typescript
model: 'anthropic/claude-3.5-sonnet'
```
- **Context**: 200K tokens
- **Strengths**: Best reasoning, safety, legal expertise
- **Best for**: Premium legal consultations
- **Rate Limit**: Pay-per-use

#### 1.8 Perplexity - Sonar Pro
```typescript
model: 'perplexity/sonar-pro'
```
- **Context**: 128K tokens
- **Strengths**: Real-time web search, citations
- **Best for**: Current legal research
- **Rate Limit**: Pay-per-use

#### 1.9 Qwen - 2.5 72B
```typescript
model: 'qwen/qwen-2.5-72b-instruct:free'
```
- **Context**: 128K tokens
- **Strengths**: Multilingual, structured output
- **Best for**: Data extraction, international law
- **Rate Limit**: Free tier

#### 1.10 Cloudflare - Llama 3.1 70B
```typescript
model: 'cloudflare/llama-3.1-70b-instruct'
```
- **Context**: 128K tokens
- **Strengths**: Edge deployment, fast
- **Best for**: Low-latency responses
- **Rate Limit**: Generous limits

#### 1.11 SambaNova - Llama 3.1 405B
```typescript
model: 'sambanova/llama-3.1-405b-instruct'
```
- **Context**: 128K tokens
- **Strengths**: Largest model, comprehensive
- **Best for**: Complex reasoning, long documents
- **Rate Limit**: Pay-per-use

#### 1.12 Google Vertex - Gemma 2 27B
```typescript
model: 'google/gemma-2-27b-it:free'
```
- **Context**: 8K tokens
- **Strengths**: Efficient, open source
- **Best for**: Quick general tasks
- **Rate Limit**: Free tier

### Configuration

**Environment Variable**:
```bash
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxx
```

**Get API Key**:
1. Go to [openrouter.ai/keys](https://openrouter.ai/keys)
2. Sign up with GitHub or email
3. Generate API key (free tier available)
4. Add to Railway environment variables

### Usage Example
```typescript
import { getConfig } from './config';

const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${getConfig().OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'qwen/qwen-2.5-72b-instruct:free',
    messages: [
      { role: 'system', content: 'You are a legal assistant.' },
      { role: 'user', content: 'What are my rights?' }
    ]
  })
});
```

### Rate Limits & Quotas
- **Free Tier**: Varies by model
- **Monitor**: Check usage at openrouter.ai/activity
- **Failover**: Automatically switch to next available model if limit reached

---

## 2. Gemini (Google)

**Website**: [ai.google.dev](https://ai.google.dev)  
**Docs**: [ai.google.dev/docs](https://ai.google.dev/docs)  
**Cost**: FREE with generous limits

### Models (3 Free)

#### 2.1 Gemini 2.5 Pro
```typescript
model: 'gemini-2.5-pro'
```
- **Context**: 2M tokens (longest context available)
- **Strengths**: Reasoning, analysis, multimodal
- **Best for**: Complex legal document generation
- **Rate Limit**: 1500 requests/day

#### 2.2 Gemini 2.5 Flash
```typescript
model: 'gemini-2.5-flash'
```
- **Context**: 1M tokens
- **Strengths**: Speed, cost-effective
- **Best for**: Quick legal consultations
- **Rate Limit**: 1500 requests/day

#### 2.3 Gemini 2.5 Flash Lite
```typescript
model: 'gemini-2.5-flash-lite'
```
- **Context**: 1M tokens
- **Strengths**: Fastest, lowest cost
- **Best for**: Simple Q&A, form filling
- **Rate Limit**: 1000 requests/day

### Configuration

**Environment Variable**:
```bash
GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxx
```

**Get API Key**:
1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Sign in with Google account
3. Click "Create API Key"
4. Add to Railway environment variables

### Usage Example
```typescript
import { GoogleGenAI } from '@google/genai';
import { getConfig } from './config';

const genAI = new GoogleGenAI({ apiKey: getConfig().GEMINI_API_KEY });
const response = await genAI.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: 'Draft a demand letter...',
});
console.log(response.text);
```

### Rate Limits & Quotas
- **Free Tier**: 1500 requests/day for Pro and Flash
- **Flash Lite**: 1000 requests/day
- **Monitor**: Check usage at aistudio.google.com
- **Upgrade**: Pay-as-you-go available for higher limits

---

## 3. Groq

**Website**: [groq.com](https://groq.com)  
**Docs**: [console.groq.com/docs](https://console.groq.com/docs)  
**Cost**: FREE with excellent speed

### Models (9 Free)

#### 3.1 Llama 3.3 70B Versatile
```typescript
model: 'llama-3.3-70b-versatile'
```
- **Context**: 128K tokens
- **Strengths**: Versatility, speed (Groq LPU™)
- **Best for**: General legal consultations
- **Rate Limit**: 30 requests/minute

#### 3.2 Llama 3.1 8B Instant
```typescript
model: 'llama-3.1-8b-instant'
```
- **Context**: 128K tokens
- **Strengths**: Ultra-fast responses
- **Best for**: Real-time chat, quick answers
- **Rate Limit**: 30 requests/minute

#### 3.3 Llama 4 Scout (replaces decommissioned Mixtral 8x7B)
```typescript
model: 'meta-llama/llama-4-scout-17b-16e-instruct'
```
- **Context**: 128K tokens
- **Strengths**: Mixture-of-experts, long context, multimodal
- **Best for**: General purpose, code generation, long-context tasks
- **Rate Limit**: 30 requests/minute

#### 3.4 Gemma2 9B
```typescript
model: 'gemma2-9b-it'
```
- **Context**: 8K tokens
- **Strengths**: Efficient, instruction-tuned
- **Best for**: Lightweight tasks, quick responses
- **Rate Limit**: 30 requests/minute

#### 3.5 Qwen3 32B
```typescript
model: 'qwen/qwen3-32b'
```
- **Context**: 32K tokens
- **Strengths**: Strong reasoning, multilingual
- **Best for**: Complex analysis, structured outputs
- **Rate Limit**: 30 requests/minute

#### 3.6 PlayAI TTS
```typescript
model: 'playai-tts'
```
- **Strengths**: High-quality text-to-speech
- **Best for**: Voice synthesis, accessibility
- **Rate Limit**: 30 requests/minute

#### 3.7 PlayAI TTS Arabic
```typescript
model: 'playai-tts-arabic'
```
- **Strengths**: Arabic text-to-speech
- **Best for**: Arabic voice synthesis
- **Rate Limit**: 30 requests/minute

#### 3.8 Whisper Large V3
```typescript
model: 'whisper-large-v3'
```
- **Strengths**: Accurate speech-to-text
- **Best for**: Audio transcription
- **Rate Limit**: 30 requests/minute

#### 3.9 Whisper Large V3 Turbo
```typescript
model: 'whisper-large-v3-turbo'
```
- **Strengths**: Fast speech-to-text
- **Best for**: Real-time transcription
- **Rate Limit**: 30 requests/minute

### Configuration

**Environment Variable**:
```bash
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
```

**Get API Key**:
1. Go to [console.groq.com/keys](https://console.groq.com/keys)
2. Sign up with email
3. Generate API key (free tier)
4. Add to Railway environment variables

### Usage Example
```typescript
import Groq from 'groq-sdk';
import { getConfig } from './config';

const groq = new Groq({ apiKey: getConfig().GROQ_API_KEY });

const completion = await groq.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  messages: [
    { role: 'system', content: 'You are a legal assistant.' },
    { role: 'user', content: 'Explain tenant rights' }
  ]
});

console.log(completion.choices[0].message.content);
```

### Rate Limits & Quotas
- **Free Tier**: 30 requests/minute
- **Speed**: 100+ tokens/second (fastest available)
- **Monitor**: Check usage at console.groq.com
- **Upgrade**: Enterprise plans available

---

## 4. Mistral AI

**Website**: [mistral.ai](https://mistral.ai)  
**Docs**: [docs.mistral.ai](https://docs.mistral.ai)  
**Cost**: FREE tier available

### Models (1 Free)

#### 4.1 Mistral Large Latest
```typescript
model: 'mistral-large-latest'
```
- **Context**: 128K tokens
- **Strengths**: European data compliance, multilingual
- **Best for**: EU users, GDPR compliance
- **Rate Limit**: Generous free tier

### Configuration

**Environment Variable**:
```bash
MISTRAL_API_KEY=xxxxxxxxxxxxxxxxxxxx
```

**Get API Key**:
1. Go to [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys)
2. Sign up with email
3. Generate API key
4. Add to Railway environment variables

### Usage Example
```typescript
import { Mistral } from '@mistralai/mistralai';
import { getConfig } from './config';

const client = new Mistral({ apiKey: getConfig().MISTRAL_API_KEY });

const response = await client.chat.complete({
  model: 'mistral-large-latest',
  messages: [
    { role: 'system', content: 'You are a legal assistant.' },
    { role: 'user', content: 'What is GDPR?' }
  ]
});

console.log(response.choices[0].message.content);
```

### Rate Limits & Quotas
- **Free Tier**: Available with reasonable limits
- **European Servers**: Data processed in EU
- **Monitor**: Check usage at console.mistral.ai
- **Upgrade**: Pay-as-you-go available

---

## 5. Anthropic (Optional - Paid)

**Website**: [anthropic.com](https://www.anthropic.com)  
**Docs**: [docs.anthropic.com](https://docs.anthropic.com)  
**Cost**: PAID - Pay-as-you-go (~$0.003/1K tokens)

### Models (2 Paid)

#### 5.1 Claude 3.5 Sonnet (Latest)
```typescript
model: 'claude-3-5-sonnet-latest'
```
- **Context**: 200K tokens
- **Strengths**: Best reasoning, accuracy, safety
- **Best for**: Premium legal consultations
- **Cost**: $3 per million input tokens

**Note**: Anthropic pricing is subject to change. Check [anthropic.com/pricing](https://www.anthropic.com/pricing) for current rates.

#### 5.2 Claude 3.5 Haiku (Latest)
```typescript
model: 'claude-3-5-haiku-latest'
```
- **Context**: 200K tokens
- **Strengths**: Fast, cost-effective
- **Best for**: Quick premium consultations
- **Cost**: $1 per million input tokens

### Configuration

**Environment Variable** (Optional):
```bash
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx
```

**Get API Key**:
1. Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
2. Sign up and add payment method
3. Generate API key
4. Add to Railway environment variables (optional)

### Usage Example
```typescript
import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from './config';

const config = getConfig();
if (!config.ANTHROPIC_API_KEY) {
  // Fallback to free providers
  console.log('Anthropic not configured, using free alternatives');
  return;
}

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const message = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-latest',
  max_tokens: 4096,
  messages: [
    { role: 'user', content: 'Draft a complex legal brief' }
  ]
});

console.log(message.content);
```

### Rate Limits & Quotas
- **Pricing**: Pay-as-you-go
- **Free Credits**: $5 on signup
- **Monitor**: Check usage at console.anthropic.com
- **Budget**: Set spending limits in console

---

## 6. SambaNova

**Website**: [sambanova.ai](https://sambanova.ai)  
**Docs**: [docs.sambanova.ai](https://docs.sambanova.ai)  
**Cost**: FREE tier available

### Models (6 Free)

#### 6.1 Meta Llama 3.1 8B Instruct
```typescript
model: 'Meta-Llama-3.1-8B-Instruct'
```
- **Context**: 8K tokens
- **Strengths**: Fast inference, efficient
- **Best for**: Quick responses, lightweight tasks
- **Rate Limit**: 20 requests/minute

#### 6.2 Meta Llama 3.1 70B Instruct
```typescript
model: 'Meta-Llama-3.1-70B-Instruct'
```
- **Context**: 8K tokens
- **Strengths**: High-quality reasoning
- **Best for**: Complex analysis, detailed responses
- **Rate Limit**: 20 requests/minute

#### 6.3 DeepSeek V3-32K
```typescript
model: 'DeepSeek-V3-32K'
```
- **Context**: 32K tokens
- **Strengths**: Extended context, advanced reasoning
- **Best for**: Long document analysis, legal research
- **Rate Limit**: 20 requests/minute

#### 6.4 DeepSeek Chat
```typescript
model: 'DeepSeek-chat'
```
- **Context**: 32K tokens
- **Strengths**: Conversational AI, reasoning
- **Best for**: Interactive consultations
- **Rate Limit**: 20 requests/minute

#### 6.5 DeepSeek Coder
```typescript
model: 'DeepSeek-coder'
```
- **Context**: 32K tokens
- **Strengths**: Code generation, analysis
- **Best for**: Code-related tasks, technical analysis
- **Rate Limit**: 20 requests/minute

#### 6.6 Mistral Large
```typescript
model: 'Mistral-large'
```
- **Context**: 128K tokens
- **Strengths**: Multilingual, reasoning
- **Best for**: Complex tasks, European compliance
- **Rate Limit**: 20 requests/minute

### Configuration

**Environment Variable**:
```bash
SAMBANOVA_API_KEY=xxxxxxxxxxxxxxxxxxxx
```

**Get API Key**:
1. Go to [cloud.sambanova.ai](https://cloud.sambanova.ai)
2. Sign up with email
3. Generate API key (free tier)
4. Add to Railway environment variables

### Usage Example
```typescript
const response = await fetch('https://api.sambanova.ai/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.SAMBANOVA_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'DeepSeek-V3-32K',
    messages: [
      { role: 'system', content: 'You are a legal assistant.' },
      { role: 'user', content: 'Analyze this contract clause.' }
    ],
    temperature: 0.7,
    max_tokens: 2000,
  }),
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

### Rate Limits & Quotas
- **Free Tier**: 20 requests/minute, 500 requests/day
- **Speed**: High throughput on SambaNova hardware
- **Monitor**: Check usage at cloud.sambanova.ai
- **Upgrade**: Enterprise plans available

---

## 7. Hugging Face

**Website**: [huggingface.co](https://huggingface.co)  
**Docs**: [huggingface.co/docs/api-inference](https://huggingface.co/docs/api-inference)  
**Cost**: FREE tier available

### Models (4 Free - Top Selected)

#### 7.1 Meta Llama 3.1 70B Instruct
```typescript
model: 'meta-llama/Meta-Llama-3.1-70B-Instruct'
```
- **Context**: 128K tokens
- **Strengths**: Advanced reasoning, legal analysis
- **Best for**: Complex legal consultations, document analysis
- **Rate Limit**: 30 requests/minute

#### 7.2 Qwen 2.5 72B Instruct
```typescript
model: 'Qwen/Qwen2.5-72B-Instruct'
```
- **Context**: 128K tokens
- **Strengths**: Multilingual, code generation, structured output
- **Best for**: Diverse language support, technical tasks
- **Rate Limit**: 30 requests/minute

#### 7.3 Mixtral 8x22B Instruct
```typescript
model: 'mistralai/Mixtral-8x22B-Instruct-v0.1'
```
- **Context**: 64K tokens
- **Strengths**: Mixture of experts, efficient reasoning
- **Best for**: General purpose, balanced performance
- **Rate Limit**: 30 requests/minute

#### 7.4 Microsoft Phi-3 Medium
```typescript
model: 'microsoft/Phi-3-medium-4k-instruct'
```
- **Context**: 4K tokens
- **Strengths**: Fast, efficient, small footprint
- **Best for**: Quick responses, lightweight tasks
- **Rate Limit**: 30 requests/minute

### Configuration

**Environment Variable**:
```bash
HUGGINGFACE_API_KEY=hf_xxxxxxxxxxxxxxxxxxxx
```

**Get API Key**:
1. Go to [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
2. Sign up with email
3. Generate Access Token (free tier)
4. Add to Railway environment variables

### Usage Example
```typescript
const response = await fetch('https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3.1-70B-Instruct', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    inputs: 'You are a legal assistant.\n\nUser: What are my tenant rights?\n\nAssistant:',
    parameters: {
      temperature: 0.7,
      max_new_tokens: 2000,
      return_full_text: false,
    },
  }),
});

const data = await response.json();
console.log(data[0].generated_text);
```

### Rate Limits & Quotas
- **Free Tier**: 30 requests/minute, 1000 requests/day
- **Speed**: Varies by model (larger models slower)
- **Monitor**: Check usage at huggingface.co/settings
- **Upgrade**: PRO subscription available for higher limits

---

## Failover Strategy

### Priority Order
1. **Primary**: OpenRouter (Qwen 72B)
2. **Fallback 1**: Gemini 2.5 Flash
3. **Fallback 2**: Groq Llama 3.3 70B
4. **Fallback 3**: SambaNova DeepSeek V3-32K
5. **Fallback 4**: Hugging Face Llama 3.1 70B
6. **Fallback 5**: Mistral Large
7. **Premium**: Anthropic Claude 3.5 (if configured)

### Implementation
```typescript
async function getAIResponse(prompt: string) {
  const providers = [
    { name: 'openrouter', model: 'qwen/qwen-2.5-72b-instruct:free' },
    { name: 'gemini', model: 'gemini-2.5-flash' },
    { name: 'groq', model: 'llama-3.3-70b-versatile' },
    { name: 'sambanova', model: 'DeepSeek-V3-32K' },
    { name: 'huggingface', model: 'meta-llama/Meta-Llama-3.1-70B-Instruct' },
    { name: 'mistral', model: 'mistral-large-latest' },
  ];

  for (const provider of providers) {
    try {
      return await callProvider(provider, prompt);
    } catch (error) {
      console.log(`${provider.name} failed, trying next provider`);
      continue;
    }
  }

  throw new Error('All providers failed');
}
```

---

## Cost Analysis

### Free Tier (Recommended for MVP)
- **OpenRouter**: $0/month (4 models)
- **Gemini**: $0/month (3 models)
- **Groq**: $0/month (9 models)
- **Mistral**: $0/month (1 model)
- **SambaNova**: $0/month (6 models)
- **Hugging Face**: $0/month (4 models)
- **Total**: **$0/month**

### With Anthropic (Optional)
- **Anthropic**: ~$10-50/month depending on usage
- **Total with premium**: **$10-50/month**

### Scaling (10K users/month)
- **Free providers**: Still $0 within free tier limits
- **Anthropic** (if used): ~$100-500/month
- **Recommended**: Start with free providers, add Anthropic for premium users

---

## Monitoring & Analytics

### Track Usage
```typescript
// Log all AI requests
logger.info('AI request', {
  provider: 'openrouter',
  model: 'qwen-72b',
  tokens: response.usage.total_tokens,
  cost: calculateCost(response.usage),
  latency: Date.now() - startTime
});
```

### Dashboard Metrics
- Total requests per provider
- Average response time
- Error rates
- Token usage
- Cost per request
- User satisfaction ratings

---

## Best Practices

### 1. Rate Limiting
```typescript
// Client-side rate limiting
const rateLimiter = {
  openrouter: new RateLimiter({ requests: 100, per: 'minute' }),
  gemini: new RateLimiter({ requests: 1500, per: 'day' }),
  groq: new RateLimiter({ requests: 30, per: 'minute' }),
  mistral: new RateLimiter({ requests: 100, per: 'minute' }),
};
```

### 2. Caching
```typescript
// Cache common responses
const cache = new Map();

function getCachedResponse(prompt: string) {
  const cacheKey = hashPrompt(prompt);
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  // ... call AI provider
  cache.set(cacheKey, response);
  return response;
}
```

### 3. Error Handling
```typescript
try {
  return await callAIProvider(prompt);
} catch (error) {
  logger.error('AI provider error', { error, provider });
  
  // Fallback to next provider
  return await fallbackProvider(prompt);
}
```

### 4. Prompt Optimization
```typescript
// Optimize prompts for cost
function optimizePrompt(fullPrompt: string): string {
  // Remove unnecessary context
  // Use concise language
  // Reuse system prompts
  return optimized;
}
```

---

## Security Considerations

### API Key Security
- ✅ Never commit API keys to git
- ✅ Use environment variables only
- ✅ Rotate keys every 90 days
- ✅ Use separate keys for staging/production

### Data Privacy
- ✅ Don't send PII to AI providers without consent
- ✅ Anonymize user data in prompts
- ✅ Review each provider's data retention policy
- ✅ Use Mistral for EU users (GDPR compliance)

### Content Filtering
- ✅ Implement content moderation on AI responses
- ✅ Filter sensitive legal information
- ✅ Don't rely solely on AI for legal advice (disclaimer)

---

## Troubleshooting

### Provider Unavailable
**Symptom**: API returns 503 or timeout  
**Solution**: Failover automatically kicks in, check provider status pages

### Rate Limit Exceeded
**Symptom**: 429 Too Many Requests  
**Solution**: Implement exponential backoff, queue requests, upgrade tier

### Invalid API Key
**Symptom**: 401 Unauthorized  
**Solution**: Verify API key is correct, regenerate if needed

### Poor Response Quality
**Symptom**: AI responses are inaccurate  
**Solution**: Adjust system prompt, use different model, add context

---

## Provider Status Pages

Monitor outages and performance:

- **OpenRouter**: [openrouter.ai/status](https://openrouter.ai/status)
- **Gemini**: [status.cloud.google.com](https://status.cloud.google.com)
- **Groq**: [status.groq.com](https://status.groq.com)
- **Mistral**: [status.mistral.ai](https://status.mistral.ai)
- **Anthropic**: [status.anthropic.com](https://status.anthropic.com)
- **SambaNova**: [cloud.sambanova.ai](https://cloud.sambanova.ai)
- **Hugging Face**: [status.huggingface.co](https://status.huggingface.co)

---

## Summary

✅ **7 AI providers** with 29 models (27 free) = $0/month  
✅ **Automatic failover** for high availability  
✅ **Generous rate limits** for MVP and growth  
✅ **TTS and STT support** via Groq (PlayAI TTS, Whisper)  
✅ **DeepSeek models** via SambaNova for advanced reasoning  
✅ **Open source models** via Hugging Face (Llama, Qwen, Mixtral, Phi)  
✅ **Optional premium** with Anthropic for $10-50/month  
✅ **Production-ready** with monitoring and error handling  

**Recommendation**: Start with all 6 free primary providers (OpenRouter, Gemini, Groq, Mistral, SambaNova, Hugging Face), add Anthropic later for premium tier.

---

For implementation details, see `server/ai/` directory and `server/constants.ts` for model configurations.
