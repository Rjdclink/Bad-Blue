# Legal Counsel System - Phase 1A Backend Infrastructure

## Overview

This implementation creates the **invisible intelligence layer** for the Legal Tools system. Phase 1A focuses exclusively on backend infrastructure with **zero visual changes** to prepare for Phase 1B UI integration.

## Architecture

### System Components

1. **Context System** - Session and conversation state management
2. **Law-Specific Expert System** - 29 specialized legal expert profiles
3. **Multi-AI Fact-Checking Engine** - 3-model consensus verification
4. **Enhanced Legal Counsel API** - RESTful endpoints for all operations
5. **Database Infrastructure** - Persistent storage for sessions, messages, and suggestions

## File Structure

```
shared/
├── legalCounselTypes.ts          # Shared type definitions (29 law types)
└── schema.ts                      # Database schema (extended)

server/
├── services/
│   ├── legalExpertSystem.ts      # Expert profile generator
│   ├── factCheckEngine.ts        # Multi-AI verification
│   └── legalCounselSessionManager.ts  # Session management
├── routes/
│   └── legalCounsel.routes.ts    # API endpoints
└── tests/
    └── validateLegalCounsel.ts   # Validation script

db/
└── migrations/
    └── 0016_add_legal_counsel_tables.sql  # Database migration
```

## Database Schema

### Tables Created

1. **legal_counsel_sessions**
   - Primary session tracking
   - Stores: userId, lawType, state, context
   - Indexes: user_id, law_type, created_at

2. **legal_counsel_messages**
   - Message history with verification
   - Stores: role, content, verified, verificationScore, citations
   - Indexes: session_id, timestamp

3. **legal_counsel_suggestions**
   - Tool and action suggestions
   - Stores: type, priority, data, status
   - Indexes: session_id, status, priority

## Law Types (29 Total)

The system supports 29 specialized law types, each with expert profiles:

- law-enforcement-accountability
- criminal-law
- family-law
- employment-law
- personal-injury
- civil-rights
- immigration-law
- real-estate-law
- business-law
- bankruptcy-law
- tax-law
- intellectual-property
- environmental-law
- healthcare-law
- education-law
- elder-law
- estate-planning
- contract-law
- tort-law
- administrative-law
- constitutional-law
- consumer-protection
- landlord-tenant
- traffic-violations
- dui-dwi
- expungement
- juvenile-law
- military-law
- whistleblower-protection

## Expert System

Each law type has a customized expert profile with:

- **Specialty**: Specific legal domain
- **Years of Experience**: 8-15 years
- **Communication Tone**: empathetic | analytical | authoritative | balanced
- **Meticulousness**: 1-10 scale (attention to detail)
- **Focus Areas**: 5 key practice areas

Example:
```typescript
{
  specialty: 'Criminal Defense',
  yearsExperience: 12,
  tone: 'analytical',
  meticulousness: 10,
  focusAreas: [
    'Constitutional rights',
    'Evidence suppression',
    'Plea negotiations',
    'Sentencing guidelines',
    'Appeal procedures'
  ]
}
```

## Multi-AI Fact-Checking

### Models Used
1. **Google Gemini** - Primary verification
2. **Groq (Llama)** - Speed and efficiency
3. **Anthropic Claude** - Deep reasoning

### Consensus Logic
- **3/3 Agreement**: High confidence (1.0)
- **2/3 Agreement**: Verified with moderate confidence (0.67)
- **1/3 Agreement**: Low confidence (0.33)
- **0/3 Agreement**: Not verified (0.0)

### Response Format
```typescript
{
  claim: string,
  verified: boolean,
  confidence: number,  // 0-1
  consensus: boolean,  // All models agree
  modelResults: [...],
  citations: [...],
  discrepancies: [...],
  recommendations: [...]
}
```

## API Endpoints

### Session Management

**POST** `/api/legal-counsel/sessions`
- Create new session
- Body: `{ lawType, state, initialContext? }`
- Returns: Session object

**GET** `/api/legal-counsel/sessions/:sessionId`
- Get session details
- Auth required, ownership verified

**GET** `/api/legal-counsel/sessions/:sessionId/full`
- Get session with all messages and suggestions
- Auth required, ownership verified

**GET** `/api/legal-counsel/sessions`
- Get user's sessions
- Query: `?limit=10`
- Auth required

**PUT** `/api/legal-counsel/sessions/:sessionId/context`
- Update or merge context
- Query: `?merge=true` for merge operation
- Body: `{ context: {...} }`

**DELETE** `/api/legal-counsel/sessions/:sessionId`
- Delete session (cascade deletes messages/suggestions)
- Auth required, ownership verified

### Messages

**POST** `/api/legal-counsel/sessions/:sessionId/messages`
- Add message to session
- Body: `{ role, content, verified?, verificationScore?, citations? }`

**GET** `/api/legal-counsel/sessions/:sessionId/messages`
- Get session messages
- Query: `?limit=50`

### Suggestions

**POST** `/api/legal-counsel/sessions/:sessionId/suggestions`
- Add suggestion
- Body: `{ type, priority, data }`

**GET** `/api/legal-counsel/sessions/:sessionId/suggestions`
- Get suggestions
- Query: `?status=pending|accepted|dismissed`

**PATCH** `/api/legal-counsel/suggestions/:suggestionId`
- Update suggestion status
- Body: `{ status }`

### Fact-Checking

**POST** `/api/legal-counsel/fact-check`
- Full 3-model verification (slower, higher confidence)
- Body: `{ claim, context: { lawType, state, jurisdiction? } }`

**POST** `/api/legal-counsel/quick-fact-check`
- Single model check (faster, lower confidence)
- Body: Same as above

### Expert System

**GET** `/api/legal-counsel/expert-profile/:lawType`
- Get expert profile for law type
- No auth required

**POST** `/api/legal-counsel/expert-prompt`
- Generate expert system prompt
- Body: `{ lawType, state, context? }`

### Statistics

**GET** `/api/legal-counsel/sessions/:sessionId/stats`
- Get session statistics
- Returns: message counts, verification stats, suggestion counts

## Security

- All endpoints require authentication (except expert profile lookup)
- Session ownership verified on all operations
- User can only access their own sessions
- No raw database queries exposed
- Input validation with Zod schemas
- SQL injection protection via parameterized queries

## Context System

Sessions maintain conversation context as JSON:

```typescript
{
  lawType: string,
  state: string,
  userProfile?: {
    situation?: string,
    goals?: string[],
    concerns?: string[]
  },
  caseDetails?: {
    parties?: string[],
    dates?: Record<string, Date>,
    documents?: string[]
  },
  legalIssues?: string[],
  nextSteps?: string[]
}
```

Context can be:
- **Updated**: Replace entire context
- **Merged**: Add/update specific keys

## Suggestion Types

1. **document**: Suggest document creation (petition, complaint, etc.)
2. **people-search**: Suggest running people search
3. **evidence-upload**: Suggest uploading evidence
4. **next-step**: Suggest next legal action

Each suggestion includes:
- Priority (high/medium/low)
- Custom data specific to suggestion type
- Status tracking (pending/accepted/dismissed)

## Validation

Run validation script:
```bash
npx tsx server/tests/validateLegalCounsel.ts
```

Tests:
- ✓ 29 law types configured
- ✓ All expert profiles complete
- ✓ Profile fields validated
- ✓ System prompt generation
- ✓ Tone customization
- ✓ Meticulousness ranges
- ✓ Focus areas populated
- ✓ Experience ranges

## Deployment

### Prerequisites
1. PostgreSQL database
2. AI API keys:
   - Google Gemini API key
   - Groq API key
   - Anthropic Claude API key

### Steps

1. **Run Migration**
```bash
npm run migrate
```

2. **Configure Environment**
```env
DATABASE_URL=postgresql://...
GEMINI_API_KEY=...
GROQ_API_KEY=...
CLAUDE_API_KEY=...
```

3. **Start Server**
```bash
npm run dev
```

4. **Verify Endpoints**
```bash
curl http://localhost:5000/api/legal-counsel/expert-profile/criminal-law
```

## Performance Considerations

- **Session Context**: JSON storage for flexibility
- **Message Retrieval**: Indexed by session_id and timestamp
- **Suggestions**: Indexed by status for quick filtering
- **Fact-Checking**: Parallel model queries for speed
- **Caching**: Consider Redis for frequently accessed expert profiles

## Next Steps (Phase 1B)

1. Create UI components for Legal Counsel chat
2. Integrate session management in frontend
3. Build real-time fact-checking UI
4. Add suggestion card components
5. Create tool coordination interface
6. Implement evidence upload integration
7. Connect document generation tools
8. Add people search integration

## Testing

### Manual API Testing

```bash
# Create session
curl -X POST http://localhost:5000/api/legal-counsel/sessions \
  -H "Content-Type: application/json" \
  -d '{"lawType":"criminal-law","state":"CA"}'

# Add message
curl -X POST http://localhost:5000/api/legal-counsel/sessions/{id}/messages \
  -H "Content-Type: application/json" \
  -d '{"role":"user","content":"What are my rights?"}'

# Fact-check claim
curl -X POST http://localhost:5000/api/legal-counsel/fact-check \
  -H "Content-Type: application/json" \
  -d '{"claim":"Miranda rights must be read before arrest","context":{"lawType":"criminal-law","state":"CA"}}'
```

## Monitoring

Monitor these metrics:
- Session creation rate
- Message volume per session
- Fact-check request rate
- AI model response times
- Consensus rate (how often 3 models agree)
- Verification success rate

## Troubleshooting

**Issue**: Migration fails
- Check DATABASE_URL is configured
- Verify PostgreSQL is running
- Check for migration conflicts

**Issue**: Fact-checking fails
- Verify AI API keys are configured
- Check model availability
- Review rate limits
- Check network connectivity

**Issue**: Session creation fails
- Verify user authentication
- Check database connectivity
- Validate input data format

## License

This implementation is part of the LegalWhat platform and follows the project's licensing terms.
