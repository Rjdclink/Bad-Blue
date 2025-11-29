# BadBlue

Civil rights platform for police accountability, legal document generation, and citizen empowerment.

## Prerequisites

### Node.js Version

**Required: Node.js 20+** (tested up to Node.js 24)

The application requires Node.js version 20.0.0 or higher. A runtime check is performed at startup.

```bash
# Check your Node.js version
node --version

# Use nvm to install/switch to Node.js 20
nvm install 20
nvm use 20
```

An `.nvmrc` file is provided for automatic version switching with nvm.

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Core
DATABASE_URL=postgresql://...
SESSION_SECRET=your-secret-here
BASE_URL=https://your-domain.com

# AI Services
GEMINI_API_KEY=your-gemini-api-key
GROQ_API_KEY=your-groq-api-key

# Payment Processing
STRIPE_SECRET_KEY=sk_...
VITE_STRIPE_PUBLIC_KEY=pk_...

# Email
GWSMTP_USER=your-smtp-user
GWSMTP_PASS=your-smtp-password
```

## Installation

```bash
# Install dependencies
npm install

# Push database schema
npm run db:push

# Development mode
npm run dev

# Production build
npm run build
npm start
```

## Runtime Information

### Startup Checks

The application performs the following checks at startup:

1. **Node.js Version Check** - Warns if running below Node.js 20
2. **Database Connectivity** - Verified via `/api/health` endpoint
3. **AI Service Initialization** - Gemini and Groq clients configured

### Health Check Endpoint

```bash
# Check application health
curl http://localhost:5000/api/health
```

Returns:
- `200 OK` - Healthy with database connected
- `503 Service Unavailable` - Database unreachable

Response includes:
- Database connectivity status and latency
- Memory usage statistics
- Runtime information (Node.js version, platform, architecture)
- Uptime and response time

### Gemini API Test

```bash
# Test Gemini API connectivity
node test-genai.mjs
```

Tests the stable Gemini model fallback chain:
1. `gemini-2.5-flash` (primary)
2. `gemini-2.5-flash-latest` (fallback)
3. `gemini-1.5-pro-latest` (fallback)

## Architecture

### AI Services

The application uses a unified Gemini service (`server/gemini.ts`) with:
- Stable model fallback order (avoids experimental model identifiers)
- Centralized client management
- `callGemini()` for text responses
- `callGeminiJSON()` for structured JSON responses

### Background Worker

BadBlue Worker (`server/badblueWorker.ts`) handles:
- Critical monitoring (every 30 minutes)
- Database heartbeat (every 15 minutes)
- Diagnostic cycles (every 6 hours)
- Daily repair cycles
- Weekly comprehensive tests

### Rate Limiting

See `SCALABILITY.md` for rate limit configuration.

## Documentation

- `DEPLOYMENT_GUIDE.md` - Platform-independent deployment instructions
- `SCALABILITY.md` - Performance optimization and monitoring
- `PRODUCTION_DEPLOYMENT.md` - Production environment setup

## Development

```bash
# Type checking
npm run check

# Development server with hot reload
npm run dev
```

## License

MIT
