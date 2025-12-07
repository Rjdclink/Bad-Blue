# Criminal Records Aggregator - Stage 2.1

## Overview
Comprehensive criminal records aggregator that searches state courts, county courts, federal PACER, sex offender registries, warrant databases, and mugshot sites. Fuses all sources into unified criminal history report.

## Performance Targets
- **Search Time:** <20 seconds across all sources
- **Detection Risk:** <5% (public records, stealth scraping)
- **Sources:** 6+ (state courts, county courts, PACER, sex offender registry, warrants)

## Architecture

### File Structure
```
server/services/criminalRecords/
├── CriminalRecordsAggregator.ts     // Main orchestrator (120 lines)
├── types.ts                         // Core interfaces (65 lines)
├── index.ts                         // Entry point (3 lines)
├── sources/
│   ├── BaseCriminalScraper.ts       // Abstract base (28 lines)
│   ├── StateCourtScraper.ts         // State court websites (75 lines)
│   ├── CountyCourtScraper.ts        // County clerk sites (73 lines)
│   ├── PACERScraper.ts              // Federal courts (68 lines)
│   ├── SexOffenderRegistryScraper.ts // State registries (62 lines)
│   └── WarrantDatabaseScraper.ts    // Active warrants (59 lines)
├── fusion/
│   └── CriminalRecordsFusion.ts     // Merge records (94 lines)
└── cache/
    └── CriminalRecordsCache.ts      // Cache (80 lines)
```

Total: ~713 lines

## API Usage

### Endpoint
```
POST /api/criminal-records
```

### Request
```json
{
  "fullName": "John Smith",
  "dateOfBirth": "1985-03-15",  // optional
  "state": "CA",                 // optional
  "county": "Los Angeles"        // optional
}
```

### Response
```json
{
  "success": true,
  "data": {
    "fullName": "John Allen Smith",
    "dateOfBirth": "1985-03-15",
    "charges": [{
      "charge": "DUI - Driving Under Influence",
      "statute": "VC 23152(a)",
      "degree": "misdemeanor",
      "date": "2012-06-15",
      "disposition": "Guilty - Probation Completed",
      "sentence": "3 years probation, DUI school, $2000 fine"
    }],
    "convictions": [],
    "activeWarrants": [],
    "sexOffenderStatus": { "registered": false },
    "riskScore": 2.5,
    "source": "Fused from 4 sources",
    "confidence": 0.87,
    "scrapedAt": "2025-12-07T03:47:00.000Z"
  },
  "disclaimer": "For permissible purposes only. Subject to Fair Credit Reporting Act (FCRA). All data should be independently verified."
}
```

## Features

### Data Sources
1. **State Courts** - Official state court case search websites (confidence: 0.85)
2. **County Courts** - County clerk websites with detailed records (confidence: 0.90)
3. **PACER** - Federal court records system (confidence: 0.95, requires credentials)
4. **Sex Offender Registry** - National registry (confidence: 1.0 - zero false positives)
5. **Warrant Database** - Active warrants from multiple sources (confidence: 0.80)

### Stealth Measures
- ✅ Public records only - all sources are public access
- ✅ Playwright stealth mode with anti-detection
- ✅ 90-day cache - never re-query same person
- ✅ Human-like delays - 3-8 seconds between searches
- ✅ No authentication (except PACER - optional)

### Risk Scoring
Risk score (0-10 scale) based on:
- Sex offender status: 10 (maximum)
- Active warrants: +8
- Violent felonies: +3 each
- Other felonies: +2 each
- Misdemeanors: +0.5 each

### Caching
- File-based cache in `.cache/criminal-records/`
- 90-day TTL (criminal records update slowly)
- Cache key: SHA256 hash of `fullName-dateOfBirth-state`

## Configuration

### Environment Variables
```bash
# Optional: PACER credentials ($0.10 per page)
PACER_USERNAME=your_username
PACER_PASSWORD=your_password
```

### Dependencies
Uses existing dependencies:
- `playwright` - Browser automation with stealth
- `chromium` - Headless browser

## Legal Compliance

### FCRA Compliance
- Criminal records are permissible purpose under FCRA
- Must be used for employment, housing, or legal purposes
- Cannot be used for marketing/profiling
- Disclaimer included in all responses

### Public Records
✅ All sources are public records - no privacy violation

## Implementation Notes

### Placeholder Implementations
The scrapers use placeholder DOM selectors that need to be updated for production:
- State court systems vary by jurisdiction (Odyssey, Tyler, custom systems)
- County clerk websites have different structures
- PACER requires authentication setup
- Sex offender registry and warrant databases need actual selector mappings

### Production Deployment
For production use, you'll need to:
1. Map actual DOM selectors for each jurisdiction
2. Set up PACER account if federal records needed
3. Add proxy rotation for high-volume usage
4. Implement detailed error logging and monitoring
5. Add rate limiting per source to avoid detection
6. Test thoroughly with real data sources

## Example Usage

```typescript
import { criminalRecordsAggregator } from './services/criminalRecords';

const record = await criminalRecordsAggregator.search({
  fullName: "John Smith",
  dateOfBirth: "1985-03-15",
  state: "CA"
});

console.log(`Risk Score: ${record.riskScore}/10`);
console.log(`Active Warrants: ${record.activeWarrants.length}`);
console.log(`Sex Offender: ${record.sexOffenderStatus.registered}`);
```
