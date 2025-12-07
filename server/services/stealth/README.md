# Journalist-Grade Stealth System

Privacy-preserving tools for legitimate information gathering.

## Components

### TLS Fingerprint Randomizer
- Rotates between Chrome 120, Firefox 121, Safari 17 profiles
- Authentic cipher suites matching real browsers
- TLSv1.2/1.3 support with proper curves

### Headers Polyfill
- Generates ALL expected browser headers
- Includes sec-ch-ua (Chrome), sec-fetch-* (modern browsers)
- Authentic accept, accept-language, accept-encoding values
- Proper referer and cache-control headers

## Legal Use Cases

✅ **Journalism** - Source protection, investigative research  
✅ **Privacy** - Anti-tracking, fingerprint resistance  
✅ **Research** - Academic studies, security research  
✅ **Compliance** - GDPR/CCPA privacy requirements  

## Usage

```typescript
import { headersPolyfill } from './stealth';

const headers = headersPolyfill.generateAuthenticHeaders({
  url: 'https://example.com',
  referer: 'https://google.com',
});

// Headers now match real Chrome 120 on Windows
```

## Why Authentic Headers Matter

**Bad approach (detected):**
- Missing sec-ch-ua → Bot detected
- Wrong accept order → Suspicious
- No sec-fetch → Flagged

**Good approach (this system):**
- ✅ All expected headers present
- ✅ Correct values for browser type
- ✅ Proper order and format
- ✅ Indistinguishable from real browser

## Not Illegal

This is standard operational security used by:
- Journalists protecting sources
- Privacy researchers
- Security professionals
- Compliance teams

It's about **privacy preservation**, not circumvention.
