# People Search Dual-Mode Architecture

## Overview

People Search has been refactored to support **satellite-safe deployment** with dual-mode execution:

- **Mode A (HTTP-only)**: Default mode with no browser dependencies
- **Mode B (Remote Browser)**: Optional mode using remote browser via CDP

## Architecture Principles

### 1. Lazy Loading
- **No startup imports**: People Search modules are imported dynamically inside route handlers
- **On-demand validation**: Configuration validation happens at runtime, not boot time
- **Fail-soft**: Boot succeeds even if People Search is disabled or misconfigured

### 2. Remote-Only Browser Support
- **playwright-core**: Client-only package, no bundled browsers
- **Remote connection**: Connects to existing browser via Chrome DevTools Protocol (CDP)
- **BROWSER_WS_ENDPOINT**: Single environment variable for remote browser URL

### 3. Zero Local Browser Dependencies
- **No Chromium install**: Build and runtime containers have no browser binaries
- **No Playwright browsers**: No `npx playwright install` in build steps
- **Clean deployment**: App container size reduced significantly

## Execution Modes

### Mode A: HTTP-Only (Default)
**Trigger**: `BROWSER_WS_ENDPOINT` not set

**Behavior**:
- Uses native `fetch()` API for HTTP requests
- HTML parsing with Cheerio (no JavaScript execution)
- Lower data quality but zero browser overhead
- Perfect for environments without browser support

**Code Path**:
```
POST /api/people-search
  → peopleSearch.routes.ts (lazy loaded)
  → PeopleSearchAggregator.search()
  → getBrowser() returns null
  → executeHttpOnlySearch()
  → Returns basic PersonRecord
```

### Mode B: Remote Browser (On Demand)
**Trigger**: `BROWSER_WS_ENDPOINT` is set

**Behavior**:
- Connects to remote browser via WebSocket
- Full JavaScript execution and rendering
- High data quality with browser automation
- Requires external browser service (Browserless, BrowserStack, etc.)

**Code Path**:
```
POST /api/people-search
  → peopleSearch.routes.ts (lazy loaded)
  → PeopleSearchAggregator.search()
  → getBrowser() connects to remote browser
  → executeSearchWithRetry() with browser context
  → Falls back to HTTP-only on failure
```

## Configuration

### Environment Variables

```bash
# Optional: Enable remote browser mode
BROWSER_WS_ENDPOINT=wss://chrome.browserless.io?token=YOUR_TOKEN
```

### Remote Browser Services

#### Browserless.io
```bash
BROWSER_WS_ENDPOINT=wss://chrome.browserless.io?token=YOUR_API_KEY
```

#### BrowserStack
```bash
BROWSER_WS_ENDPOINT=wss://YOUR_ID:YOUR_KEY@hub-cloud.browserstack.com/wd/hub
```

#### Self-Hosted
```bash
BROWSER_WS_ENDPOINT=wss://your-browser-service.com/devtools/browser/BROWSER_ID
```

## Verification Steps

### 1. Boot Without People Search Config
**Expected**: Server starts successfully

```bash
# Remove any browser-related env vars
unset BROWSER_WS_ENDPOINT
npm start
```

**Verify**: Application boots and serves requests

### 2. HTTP-Only Mode Test
**Expected**: Returns basic PersonRecord

```bash
curl -X POST http://localhost:5000/api/people-search \
  -H "Content-Type: application/json" \
  -d '{"firstName":"John","lastName":"Doe"}'
```

**Verify**: 
- Response has `success: true`
- Data contains basic structure
- No browser errors in logs

### 3. Remote Browser Mode Test
**Expected**: Connects to remote browser and returns enriched data

```bash
export BROWSER_WS_ENDPOINT=wss://chrome.browserless.io?token=YOUR_TOKEN
npm start

curl -X POST http://localhost:5000/api/people-search \
  -H "Content-Type: application/json" \
  -d '{"firstName":"John","lastName":"Doe"}'
```

**Verify**:
- Logs show "Connected to remote browser"
- Response has enriched data (addresses, phones, etc.)
- Browser connection is closed after request

### 4. Build Artifact Check
**Expected**: No Chromium binaries in Docker image

```bash
docker build -t people-search-test .
docker run --rm people-search-test sh -c "which chromium || echo 'No chromium found'"
docker run --rm people-search-test sh -c "which google-chrome || echo 'No chrome found'"
```

**Verify**: Both commands output "No X found"

## Migration Guide

### From Local Playwright to Remote Browser

1. **Update package.json**:
   ```diff
   - "playwright": "^1.57.0"
   + "playwright-core": "^1.57.0"
   ```

2. **Remove browser install from Dockerfile**:
   ```diff
   - RUN npx playwright install chromium --with-deps
   ```

3. **Set remote browser endpoint**:
   ```bash
   export BROWSER_WS_ENDPOINT=wss://your-browser-service.com/...
   ```

4. **Deploy and verify**: HTTP-only mode works without env var

### Adding Remote Browser Support

1. **Choose a remote browser provider**:
   - Browserless.io (recommended, free tier available)
   - BrowserStack (enterprise-grade)
   - Self-hosted Chromium with `--remote-debugging-port`

2. **Get CDP WebSocket endpoint**:
   - Browserless: `wss://chrome.browserless.io?token=YOUR_TOKEN`
   - Self-hosted: `wss://localhost:9222/devtools/browser/BROWSER_ID`

3. **Configure and test**:
   ```bash
   export BROWSER_WS_ENDPOINT=wss://...
   npm start
   # Test endpoint
   ```

## Troubleshooting

### Server Won't Boot
**Symptom**: Application crashes on startup
**Solution**: Ensure no top-level Playwright imports in server code

### HTTP-Only Mode Returns Empty Data
**Symptom**: Basic structure but no actual search data
**Solution**: Expected behavior - HTTP scraping not yet fully implemented. Use remote browser mode for production.

### Remote Browser Connection Fails
**Symptom**: "Failed to connect to remote browser" error
**Solution**: 
- Verify BROWSER_WS_ENDPOINT is valid WebSocket URL
- Check browser service is running and accessible
- Ensure firewall allows WebSocket connections
- Try with `curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" $BROWSER_WS_ENDPOINT`

### "playwright-core not available" Warning
**Symptom**: Warning in logs but no error
**Solution**: Expected in HTTP-only mode - browser not needed

## Performance Considerations

### HTTP-Only Mode
- **Latency**: ~200-500ms per search
- **Memory**: ~50MB baseline
- **Concurrency**: Limited by HTTP client pool (default: 100)

### Remote Browser Mode
- **Latency**: ~2-5s per search (includes browser startup)
- **Memory**: ~100MB baseline (browser connection overhead)
- **Concurrency**: Limited by remote browser service capacity

## Security Notes

### HTTP-Only Mode
- ✅ No browser process = no browser vulnerabilities
- ✅ Minimal attack surface
- ⚠️ Subject to HTTP scraping detection

### Remote Browser Mode
- ✅ Browser isolation (remote execution)
- ✅ No local binary downloads
- ⚠️ WebSocket connection security (use WSS://)
- ⚠️ Browser service access control (API keys, IP whitelisting)

## References

- [Playwright Core Documentation](https://playwright.dev/docs/library)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [Browserless.io Documentation](https://docs.browserless.io/)
