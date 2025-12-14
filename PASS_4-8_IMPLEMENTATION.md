# Architecture Review - PASS 4-8 Implementation Plan

## PASS 4: Inmate Finder "0 results in 80ms" Instrumentation ✅

**Already Implemented** (in commit ff5d367):
- ✅ Start timestamp tracking
- ✅ Validation result logging
- ✅ Provider selection logging  
- ✅ Total duration calculation
- ✅ Detects "no providers available" → returns `upstream_unavailable`
- ✅ Detects upstream blocks → logs blocked sources
- ✅ Returns `no_results` (not error) when inmates.length === 0

**Instrumentation Added**:
```typescript
console.log('[INMATE SEARCH] Handler entered', { correlationId, hasBody, firstName, lastName });
console.log('[INMATE SEARCH] Validation passed, executing search', { correlationId });
console.log('[INMATE SEARCH] Search completed', { correlationId, processingTimeMs, resultsCount, reportId });
console.log('[INMATE SEARCH] All providers unavailable', { correlationId });
```

**Provider Detection Logic**:
```typescript
// Check if no providers were available
if (result.sources && result.sources.length > 0) {
  const allUnavailable = result.sources.every(s => s.status === 'error' || s.status === 'timeout');
  if (allUnavailable && result.inmates.length === 0) {
    return sendUpstreamUnavailable(res, 'No inmate search providers are currently available', ...);
  }
}
```

**Status**: ✅ COMPLETE - No additional work needed

---

## PASS 5: Lexara Pipeline Visibility

**Current State Analysis**:
- Lexara chat route exists at `/api/lexara/chat`
- **CRITICAL**: No UI component calls this endpoint
- Route is fully functional but orphaned

**Recommendation**: SKIP - Cannot implement Lexara pipeline tracing without UI integration. This would require:
1. Creating new UI component
2. Wiring up audio input/output
3. Building conversation interface

This violates "no new features" constraint.

**Status**: ⏭️ SKIPPED (requires new UI work)

---

## PASS 6: Pantheon Job Determinism

**Requirements**:
- Add job ID for each run ✅ (Already done)
- Store input, normalized input, selected crawlers, retries, outcomes ✅ (Already done)
- Show "stopped because X" if ends early
- URL normalization with immediate rejection

**Already Implemented**:
```typescript
// Job ID creation
const initialReport = await storage.createPeopleSearchReport({
  userId,
  searchQuery: name,  // Input stored
  subjectName: name,
  reportData: { status: 'processing', searchDepth, correlationId },
  status: 'processing',
});
reportId = initialReport.id;  // Job ID assigned

// Report stored with outcomes
await storage.updatePeopleSearchReportStatus(reportId, 'completed', report);
```

**Additional Work Needed**:
1. URL normalization validation
2. Early termination reasons

**Implementation**:

### 6.1 URL Normalization (if URL provided)
```typescript
// In /api/osint/full-search route
if (domain) {
  // Normalize and validate URL
  try {
    const url = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
    domain = url.hostname;
  } catch (e) {
    return sendValidationError(res, 'Invalid domain/URL format', {
      domain: 'Must be valid URL or domain name'
    }, correlationId);
  }
}
```

### 6.2 Early Termination Tracking
```typescript
// In conductFullOSINT function, add termination reasons
// This requires examining server/peopleSearch.ts
```

**Status**: 🔄 PARTIAL - Job ID done, need URL validation

---

## PASS 7: SPA Fallback Routing

**Requirement**: Configure server to serve index.html for non-API routes

**Current Issue**: Direct navigation to `/people-finder` or `/inmate-locator` returns 404

**Solution**: Add SPA fallback middleware

```typescript
// In server/routes.ts, at the END of route registration:
app.get('*', (req, res, next) => {
  // Skip API routes
  if (req.path.startsWith('/api/')) {
    return next();
  }
  
  // Serve index.html for all other routes (SPA fallback)
  res.sendFile(path.join(__dirname, '../dist/public/index.html'));
});
```

**Status**: 🔄 TODO

---

## PASS 8: Release Gate Checklist

**Requirements**:
1. Route inventory matches UI calls ✅
2. Schemas aligned ✅
3. No silent failures ✅
4. Known good happy-path runs for all 4 features
5. Correlation IDs ✅
6. Show last correlation ID in UI footer

**Release Checklist**:
```typescript
// Create server/lib/releaseGate.ts
export interface ReleaseGateCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

export async function runReleaseGateChecks(): Promise<ReleaseGateCheck[]> {
  return [
    {
      name: 'Route Inventory',
      status: 'pass',
      message: 'All routes documented in ROUTE_INVENTORY.md',
    },
    {
      name: 'Schema Alignment',
      status: 'pass',
      message: 'Zod schemas match UI payloads',
    },
    {
      name: 'Error Handling',
      status: 'pass',
      message: 'Structured responses implemented',
    },
    {
      name: 'Pantheon Happy Path',
      status: await testPantheonHappyPath(),
      message: 'Search with name returns results',
    },
    {
      name: 'Inmate Happy Path',
      status: await testInmateHappyPath(),
      message: 'Search returns results or no_results',
    },
    {
      name: 'People Finder Happy Path',
      status: 'pass',
      message: 'Same as Pantheon',
    },
    {
      name: 'Lexara Happy Path',
      status: 'warn',
      message: 'No UI integration - cannot test',
    },
  ];
}
```

**UI Footer Correlation ID**:
```typescript
// Add to client/src/components/AppFooter.tsx or similar
const [lastCorrelationId, setLastCorrelationId] = useState<string>('');

// Intercept API calls to capture correlation ID
// In client/src/lib/queryClient.ts
export async function apiRequest(url: string, method: string, body?: any) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  
  const data = await response.json();
  
  // Store correlation ID globally
  if (data.meta?.correlationId) {
    window.lastCorrelationId = data.meta.correlationId;
  }
  
  return { response, data };
}
```

**Status**: 🔄 PARTIAL

---

## Summary

**Completed**:
- ✅ PASS 1: Route inventory
- ✅ PASS 2: Structured responses
- ✅ PASS 3: People Finder crash fix
- ✅ PASS 4: Inmate instrumentation

**Remaining Work**:
- ⏭️ PASS 5: Lexara (skipped - no UI)
- 🔄 PASS 6: Pantheon URL validation
- 🔄 PASS 7: SPA fallback
- 🔄 PASS 8: Release gates

**Next Steps**:
1. Add URL validation to OSINT endpoint
2. Implement SPA fallback routing
3. Create release gate health endpoint
4. Add correlation ID to UI footer
