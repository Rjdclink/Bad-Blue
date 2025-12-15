# Inmate Search Service

## Production Status: ✅ READY

This service is **production-ready** and **real-world operations capable**.

### Key Features

- ✅ **Real BOP API Integration**: Direct calls to Bureau of Prisons public API
- ✅ **No Demo Fallbacks**: All demo/dev-lite modes removed
- ✅ **Fail-Hard Configuration**: Throws immediately if misconfigured
- ✅ **Production Validation**: Configuration validated on module load
- ✅ **LRU Caching**: Performance optimization with smart cache eviction
- ✅ **Rate Limiting**: Prevents upstream provider blocking
- ✅ **Parallel Execution**: Searches multiple sources simultaneously
- ✅ **Offense Classification**: Automatic VIOLENT/SEXUAL badge detection

### Architecture

```
┌─────────────────────────────────────────┐
│  Inmate Search Route                    │
│  /api/inmate-search                     │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Configuration Validation               │
│  - validateBOPConfig()                  │
│  - validateStateDOCConfig()             │
│  - validateVINEConfig()                 │
│  FAIL HARD if misconfigured             │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  InmateSearchAggregator                 │
│  - Cache check (LRU)                    │
│  - Provider selection                   │
│  - Parallel execution                   │
│  - Result deduplication                 │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Data Source Adapters                   │
│  ┌────────────────────────────────────┐ │
│  │ BOP Adapter (✅ Implemented)       │ │
│  │ - Real API calls                   │ │
│  │ - Error handling                   │ │
│  │ - Rate limiting                    │ │
│  └────────────────────────────────────┘ │
│  ┌────────────────────────────────────┐ │
│  │ State DOC Adapter (⏳ Pending)     │ │
│  │ - State-specific scrapers needed   │ │
│  └────────────────────────────────────┘ │
│  ┌────────────────────────────────────┐ │
│  │ VINE Adapter (⏳ Pending)          │ │
│  │ - VINELink integration needed      │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### Configuration

#### Environment Variables

```bash
# BOP (Bureau of Prisons) - Federal inmate search
INMATE_ENABLE_BOP=true  # Must be true (default: enabled)

# State DOC - State corrections (not yet implemented)
INMATE_ENABLE_STATE_DOC=false  # Default: disabled

# VINE - Victim notification (not yet implemented)
INMATE_ENABLE_VINE=false  # Default: disabled
```

#### Validation

Configuration is validated automatically when the module loads:

```typescript
// config.ts
export function validateInmateSearchConfig(): void {
  validateBOPConfig();      // Ensures BOP not disabled
  validateStateDOCConfig(); // Warns if enabled but not configured
  validateVINEConfig();     // Warns if enabled but not configured
}
```

If validation fails, the service throws a FATAL error and prevents server startup:

```
FATAL: BOP inmate search is disabled (INMATE_ENABLE_BOP=false). 
Inmate search requires at least one provider. Set INMATE_ENABLE_BOP=true 
or configure alternative providers.
```

### API Usage

#### Search Endpoint

```http
POST /api/inmate-search
Content-Type: application/json

{
  "firstName": "John",
  "lastName": "Doe",
  "state": "CA",           // Optional
  "dateOfBirth": "1990-01-01",  // Optional (YYYY-MM-DD)
  "inmateId": "12345-678",      // Optional
  "searchScope": "all"          // all|federal|state|county
}
```

#### Response

```json
{
  "type": "success",
  "success": true,
  "data": {
    "query": {
      "firstName": "John",
      "lastName": "Doe",
      "searchScope": "all"
    },
    "totalResults": 1,
    "inmates": [
      {
        "id": "bop-doe-0-1234567890",
        "source": "BOP",
        "firstName": "JOHN",
        "lastName": "DOE",
        "inmateNumber": "12345-678",
        "facilityName": "FCI Terminal Island",
        "facilityType": "Federal Prison",
        "facilityLocation": {
          "state": "Federal"
        },
        "custodyStatus": "In Custody",
        "releaseDate": "2025-12-31",
        "age": 34,
        "sex": "Male",
        "race": "White",
        "charges": ["Bank Robbery", "Firearm Possession"],
        "chargeDetails": [
          {
            "description": "Bank Robbery",
            "classification": "VIOLENT"
          },
          {
            "description": "Firearm Possession",
            "classification": "OTHER"
          }
        ],
        "isViolentOffender": true,
        "isSexualOffender": false,
        "offenseClassifications": ["VIOLENT", "OTHER"],
        "confidence": 95,
        "lastUpdated": "2024-01-15T10:30:00.000Z",
        "sourceUrl": "https://www.bop.gov/inmateloc/"
      }
    ],
    "sources": [
      {
        "source": "BOP",
        "searched": true,
        "resultsCount": 1,
        "status": "completed",
        "searchTimeMs": 850
      }
    ],
    "searchDuration": 875,
    "cached": false,
    "partial": false,
    "disclaimer": "This search accesses publicly available inmate information from official government sources. Information may not be current or complete. Always verify with the appropriate correctional facility."
  },
  "meta": {
    "correlationId": "abc123...",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "processingTimeMs": 875,
    "jobId": "job_123",
    "jobCompleted": true,
    "jobStatus": "completed"
  }
}
```

### Implementation Status

| Provider | Status | Implementation |
|----------|--------|---------------|
| BOP (Federal) | ✅ Complete | Real API integration with error handling |
| State DOC | ⏳ Pending | Requires state-specific scrapers |
| VINE | ⏳ Pending | Requires VINELink integration |

### BOP Integration Details

The BOP adapter makes direct API calls to the Bureau of Prisons public endpoint:

```typescript
POST https://www.bop.gov/PublicInfo/execute/inmateloc
Content-Type: application/x-www-form-urlencoded

todo=query&output=json&nameFirst=John&nameLast=Doe
```

**Error Handling**:
- ✅ Timeout protection (20 seconds)
- ✅ CAPTCHA detection (fails hard if CAPTCHA required)
- ✅ Rate limit handling
- ✅ Network error recovery

**Data Transformation**:
- ✅ Normalizes BOP response to standard InmateRecord format
- ✅ Extracts facility information
- ✅ Determines custody status from release codes
- ✅ Calculates confidence scores

### Testing

```bash
# Unit tests
npm test server/services/inmateSearch

# Integration test (requires network)
curl -X POST http://localhost:5000/api/inmate-search \
  -H "Content-Type: application/json" \
  -d '{"firstName":"John","lastName":"Doe"}'

# Validate configuration
node -e "require('./server/services/inmateSearch/config.js').validateInmateSearchConfig()"
```

### Monitoring

#### Metrics to Monitor

1. **BOP API Performance**
   - Response times (expect 500-2000ms)
   - Success rate (expect >95%)
   - Timeout rate (expect <5%)

2. **Cache Performance**
   - Hit rate (expect >40% in production)
   - Cache size (max 1000 entries)
   - Eviction rate

3. **Search Quality**
   - Results per search (varies)
   - Confidence scores
   - Classification accuracy

#### Health Check

```bash
curl http://localhost:5000/api/health
```

Look for:
```json
{
  "services": {
    "inmateSearch": {
      "configured": true,
      "providers": ["BOP"],
      "cacheSize": 150
    }
  }
}
```

### Future Enhancements

1. **State DOC Integration**
   - Implement state-specific scrapers
   - California DOC (CDCR)
   - Texas DOC (TDCJ)
   - Florida DOC (FDOC)
   - Etc.

2. **VINE Integration**
   - VINELink API integration
   - County jail searches
   - Victim notification enrollment

3. **Enhanced Features**
   - Mugshot retrieval
   - Court docket links
   - Parole hearing dates
   - Facility transfer history

### Troubleshooting

#### "BOP search is disabled"

**Cause**: `INMATE_ENABLE_BOP=false` in environment

**Fix**: Set `INMATE_ENABLE_BOP=true` or remove the variable

#### "BOP search requires CAPTCHA"

**Cause**: BOP detected automated access and requires CAPTCHA

**Fix**: 
- Wait and retry (temporary block)
- Add delay between requests
- Use residential proxy (advanced)

#### "No inmates found"

**Cause**: Name/ID doesn't match any records

**Fix**: 
- Verify spelling
- Try with/without middle name
- Use inmate ID if available
- Check multiple states

### Security Notes

1. **Public Data Only**: Only accesses publicly available data
2. **No Authentication Required**: BOP API is public
3. **Rate Limiting**: Respects upstream rate limits
4. **No Data Storage**: Results cached temporarily, not persisted
5. **Audit Trail**: All searches logged with correlation IDs

### Support

For production issues:
1. Check server logs for "INMATE SEARCH" entries
2. Verify `INMATE_ENABLE_BOP=true` in environment
3. Test BOP API directly: https://www.bop.gov/inmateloc/
4. Check cache stats: `GET /api/inmate-search/cache-stats`
