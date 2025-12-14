# Route Inventory - Truth Map

## Pantheon (OSINT Full Search)

**UI Page**: `/pantheon`  
**Component**: `client/src/pages/pantheon.tsx` → `client/src/components/PeopleFinderSearch.tsx`  
**API Endpoint**: `POST /api/osint/full-search`  
**Request Body**:
```typescript
{
  name: string,
  location?: string,
  searchDepth: number (1-4)
}
```
**Handler**: `server/routes.ts` line 3576  
**Service**: `conductFullOSINT()` from `server/peopleSearch.ts`  
**Response**:
```typescript
{
  identitySummary: {...},
  contactInformation: string[],
  socialMediaPresence: string[],
  ...
  jobId: string,
  jobCompleted: boolean,
  jobStatus: string
}
```

## People Finder

**UI Page**: `/people-finder`  
**Component**: `client/src/pages/people-finder.tsx` → `client/src/components/PeopleFinderSearch.tsx`  
**API Endpoint**: `POST /api/osint/full-search` (SAME AS PANTHEON)  
**Request Body**: Same as Pantheon  
**Handler**: Same as Pantheon  
**Service**: Same as Pantheon  
**Response**: Same as Pantheon  

**Note**: People Finder and Pantheon use the SAME endpoint

## Inmate Finder

**UI Page**: `/inmate-locator` or `/inmate-locator-v2`  
**Component**: `client/src/components/InmateSearch.tsx`  
**API Endpoint**: `POST /api/inmate-search`  
**Request Body**:
```typescript
{
  firstName?: string,
  lastName?: string,
  middleName?: string,
  dateOfBirth?: string,  // YYYY-MM-DD
  state?: string,        // 2 chars
  inmateId?: string,
  searchScope?: 'federal' | 'state' | 'county' | 'all'
}
```
**Handler**: `server/routes/inmateSearch.routes.ts` router.post('/')  
**Mount**: `/api/inmate-search` in `server/routes.ts` line 880  
**Service**: `searchInmates()` from `server/services/inmateSearch`  
**Response**:
```typescript
{
  success: boolean,
  data: {
    inmates: InmateRecord[],
    sources: SourceSearchStatus[],
    totalResults: number,
    searchedAt: Date,
    cached: boolean,
    disclaimer: string
  },
  jobId: string,
  jobCompleted: boolean,
  jobStatus: string
}
```

## Lexara

**UI Page**: Various (legal-consultation, landing, etc.)  
**Component**: `client/src/components/LexaraConsultation.tsx` (but calls /api/legal-consultation, not Lexara)  
**API Endpoint**: `POST /api/lexara/chat`  
**Request Body**:
```typescript
{
  prompt: string,
  context?: {
    previousMessages?: Array<{role: string, content: string}>,
    sessionId?: string,
    behaviorMode?: string
  },
  systemPrompt?: string,
  includeAudio?: boolean
}
```
**Handler**: `server/routes/lexara.chat.routes.ts` router.post('/chat')  
**Mount**: `/api/lexara` in `server/routes.ts` line 897  
**Service**: `callAIWithFallback()` + `synthesizeLexaraSpeech()`  
**Response**:
```typescript
{
  success: boolean,
  response: string,
  model: string,
  audio?: {
    audioBase64: string,
    mimeType: string,
    durationMs: number
  },
  conversationId: string,
  persistenceSuccess: boolean,
  jobCompleted: boolean,
  jobStatus: string
}
```

**⚠️ CRITICAL ISSUE**: No UI component found that calls `/api/lexara/chat`

## Route Mounting Map

### Current Server Mounts (server/routes.ts)

1. Line 826: `app.use(peopleSearchRoutes)` → NO PREFIX  
   - Contains: `POST /api/people-search` (UNUSED BY UI)

2. Line 880: `app.use('/api/inmate-search', inmateSearchRoutes.default)`  
   - Contains: `POST /` → Full path: `POST /api/inmate-search` ✅

3. Line 893: `app.use('/api/lexara', lexaraRoutes.default)`  
   - Contains: Streaming routes

4. Line 897: `app.use('/api/lexara', lexaraChatRoutes.default)`  
   - Contains: `POST /chat` → Full path: `POST /api/lexara/chat` ✅

5. Line 3576: `app.post('/api/osint/full-search', ...)`  
   - Direct registration → `POST /api/osint/full-search` ✅

### Duplicate Prefix Issues

❌ **ISSUE FOUND**: `peopleSearchRoutes` contains `router.post('/api/people-search', ...)` which means the route internally hardcodes `/api/people-search`. Since it's mounted with `app.use(peopleSearchRoutes)` with NO prefix, this is CORRECT. However, this route is UNUSED by the UI.

## Summary

| Feature | UI Page | API Endpoint | Status |
|---------|---------|--------------|--------|
| Pantheon | `/pantheon` | `POST /api/osint/full-search` | ✅ Working |
| People Finder | `/people-finder` | `POST /api/osint/full-search` | ✅ Working |
| Inmate Finder | `/inmate-locator` | `POST /api/inmate-search` | ✅ Working |
| Lexara Chat | ❌ None found | `POST /api/lexara/chat` | ⚠️ Route exists but no UI |
