# Advanced Search Operators

## Google Dorking Operators

- `site:` - Limit to specific domain
- `filetype:` - Search for specific file types
- `inurl:` - URL must contain term
- `intitle:` - Title must contain term
- `-term` - Exclude results with term
- `"exact phrase"` - Match exact phrase
- `after:YYYY-MM-DD` - Results after date
- `before:YYYY-MM-DD` - Results before date

## Example Queries

### Find officer records
```
"Officer Name" site:*.gov filetype:pdf
```

### Find payroll data
```
"Officer Name" site:transparencyusa.org OR site:govsalaries.com
```

### Find court documents
```
"Officer Name" site:pacer.gov OR site:*.gov inurl:court
```

## Usage

### Basic Person Search

```typescript
import { advancedSearch } from './services/advancedSearch';

// Generate dorks for a person
const dorks = advancedSearch.generatePersonDorks('John Smith', {
  department: 'NYPD',
  badge: '12345',
  location: 'New York'
});

console.log(dorks);
// Output: Array of 20+ targeted search queries
```

### Query Builder

```typescript
import { queryBuilder } from './services/searchQueryBuilder';

// Build a custom query using fluent API
const query = queryBuilder
  .keyword('John Smith')
  .site('*.gov')
  .fileType('pdf')
  .inUrl('roster')
  .exclude('facebook')
  .exclude('twitter')
  .after('2024-01-01')
  .build();

console.log(query);
// Output: "John Smith" site:*.gov filetype:pdf inurl:roster -facebook -twitter after:2024-01-01
```

### Enhanced Web Search

```typescript
import { enhancedWebSearch } from './services/webSearchService';

// Search with dorks (cached for 6 hours)
const results = await enhancedWebSearch.searchWithDorks('John Smith', {
  department: 'Police Department',
  badge: '12345',
});

// Search public databases (cached for 7 days)
const dbResults = await enhancedWebSearch.searchPublicDatabases('John Smith');
console.log(dbResults.transparencyUSA);
console.log(dbResults.govSalaries);
console.log(dbResults.pacer);
```

## Search Patterns

The service provides pre-configured patterns for common OSINT searches:

```typescript
import { advancedSearch } from './services/advancedSearch';

const patterns = advancedSearch.getSearchPatterns();

// Available patterns:
// - govRecords: Government PDF records
// - courtDocs: Court documents
// - payroll: Public salary databases
// - licenses: Professional licenses
// - propertyRecords: Property ownership
// - businessRecords: Business registrations
// - voterRecords: Voter registration
// - arrestRecords: Arrest records
```

## Department-Specific Search

```typescript
import { advancedSearch } from './services/advancedSearch';

// Generate department-focused queries
const deptDorks = advancedSearch.generateDepartmentDorks('NYPD');

// Returns queries for:
// - Department rosters
// - Personnel documents
// - Payroll databases
// - Budget documents
// - Organizational charts
```

## Integration with People Search

```typescript
import { enhancedWebSearch } from './services/webSearchService';

// In your search function:
async function searchPerson(name: string, officerData: any) {
  // Get dorked results
  const dorkResults = await enhancedWebSearch.searchWithDorks(name, {
    department: officerData?.department,
    badge: officerData?.badge,
  });

  // Get public database results
  const publicDbResults = await enhancedWebSearch.searchPublicDatabases(name);

  return {
    dorkResults,
    publicDbResults,
  };
}
```

## Rate Limiting

The enhanced search service includes automatic rate limiting:

- **Rate**: 1 query per second
- **Limit**: First 10 dorks per search
- **Caching**: Results cached to minimize API calls

## Cache Strategy

- **Dork results**: 6 hours (warm cache)
- **Public databases**: 7 days (cold cache)
- **Backed by**: Redis with memory fallback

## Best Practices

1. **Use caching**: Results are automatically cached to reduce API load
2. **Be specific**: Add department, badge, or location for better results
3. **Combine sources**: Use both dorks and public databases
4. **Rate awareness**: Service handles rate limiting automatically
5. **Error handling**: Service gracefully handles failed queries

## Public Databases

The service searches these public databases:

- **transparencyusa.org**: Government salary data
- **openpayrolls.com**: Public payroll records
- **publicpay.ca.gov**: California public salaries
- **govsalaries.com**: Government employee salaries
- **pacer.gov**: Federal court records

## Advanced Operators

### Site-specific searches
```typescript
const query = advancedSearch.buildQuery({
  keywords: ['John Smith'],
  site: '*.gov',
});
```

### File type filtering
```typescript
const query = advancedSearch.buildQuery({
  keywords: ['John Smith'],
  filetype: 'pdf',
});
```

### URL pattern matching
```typescript
const query = advancedSearch.buildQuery({
  keywords: ['John Smith'],
  inurl: 'roster',
});
```

### Title matching
```typescript
const query = advancedSearch.buildQuery({
  keywords: ['John Smith'],
  intitle: 'personnel directory',
});
```

### Exclusions
```typescript
const query = advancedSearch.buildQuery({
  keywords: ['John Smith'],
  exclude: ['facebook', 'twitter', 'linkedin'],
});
```

### Date ranges
```typescript
const query = advancedSearch.buildQuery({
  keywords: ['John Smith'],
  dateAfter: '2024-01-01',
  dateBefore: '2024-12-31',
});
```

## Security Considerations

- All searches are logged
- Rate limiting prevents abuse
- Results are cached to minimize external requests
- No sensitive data is stored in queries
- Follows ethical OSINT practices
