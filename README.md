# LegalWhat - AI Legal Platform

## ⚡ Quick Start (90 seconds)

```bash
bash scripts/instant-setup.sh
```

Open http://localhost:5000 and start using PANTHEON.

**Alternative methods:**
- `make setup` - Using Make
- Open in VS Code → "Reopen in Container"
- See [Quick Start Guide](docs/QUICK_START.md)

---

## Overview
LegalWhat is an AI-powered legal platform that empowers citizens to access legal help across 30 areas of law. The platform features Law Enforcement Accountability (formerly BadBlue) as a flagship service, providing tools for filing complaints and initiating civil rights lawsuits against police officers. It leverages AI for officer identification, legal analysis, intelligent form prefill, automated routing, and jurisdiction-specific legal document generation. The platform supports secure evidence uploads and offers services like LegalAI Consultation, Officer Search, and various legal document generations to enhance legal accessibility through affordable legal avenues.

## System Architecture
The platform utilizes a modern web stack featuring:
- **Frontend**: React 18 with TypeScript, Vite bundler, Wouter routing, Radix UI/shadcn/ui components with Tailwind CSS
- **Backend**: Node.js/Express.js RESTful API
- **Database**: PostgreSQL (Neon serverless) with Drizzle ORM
- **Authentication**: Local username/password authentication with session management
- **File Storage**: Google Cloud Storage or local filesystem fallback
- **State Management**: TanStack Query for client-side data fetching
- **Form Validation**: React Hook Form with Zod schemas

## Key Features

### 🤖 AI Providers (5 Providers, 12 Models)
**Multi-Provider AI System** with automatic failover for high availability:

| Provider | Models | Cost | Best For |
|----------|--------|------|----------|
| **OpenRouter** | 4 models (Kimi K2, DeepSeek R1, Grok Fast, Qwen 72B) | FREE | Primary consultations |
| **Gemini** | 3 models (2.5-pro, 2.5-flash, 2.5-flash-lite) | FREE | Document generation |
| **Groq** | 2 models (Llama 3.3 70B, Llama 3.1 8B) | FREE | Fast responses |
| **Mistral** | 1 model (mistral-large-latest) | FREE | EU compliance |
| **Anthropic** | 2 models (Claude 3.5 series) | PAID (optional) | Premium consultations |

**Total Cost**: $0/month with 4 free providers (10 free models)

**Features**:
- ✅ Automatic failover between providers
- ✅ Smart rate limiting and quota management
- ✅ 100+ tokens/second with Groq
- ✅ 2M token context with Gemini 2.5 Pro
- ✅ Cost tracking and analytics

See [AI_PROVIDERS.md](docs/AI_PROVIDERS.md) for complete documentation.

### 🔍 OpenRouter Web Search System
**Dedicated Free-Tier Web Search Models** for information retrieval (separate from legal consultation system):

| Model | Context | Best For |
|-------|---------|----------|
| **Meta Llama 4 Maverick** | 256K tokens | Multimodal research |
| **xAI Grok 4.1 Fast** | 2M tokens | Real-time research |
| **DeepSeek R1T2 Chimera** | 164K tokens | Reasoning-focused search |

**Features**:
- ✅ Orchestrated parallel search across all 3 models
- ✅ Result aggregation with confidence scoring
- ✅ Optional `:online` plugin for real-time web data (⚠️ may incur costs)
- ✅ Circuit breaker pattern for resilience
- ✅ Rate limiting (50 requests/day per model)

**Note**: While model inference is FREE, the optional `:online` web search plugin may incur costs. Monitor usage carefully.

### 💾 Autosave System
**Automatic Saving with 3-Second Debouncing**:
- ✅ Auto-saves every 3 seconds after changes
- ✅ Change detection (only saves what changed)
- ✅ Version tracking for rollback capability
- ✅ Session resume across devices
- ✅ Works for all 9 law types
- ✅ Saves consultations, drafts, and progress

**Database Schema**: 5 tables with full versioning  
**API**: 13 endpoints for complete autosave functionality  
**Frontend**: 4 React hooks for easy integration

See [AUTOSAVE_ARCHITECTURE.md](docs/AUTOSAVE_ARCHITECTURE.md) for technical details.

### Intelligent AI Architecture
A coordinated multi-provider system ensures resilience and cost-efficiency. Smart rate limiting with automatic failover prevents service disruption.

### AI Sub-Agent
An admin-only AI Sub-Agent provides advanced autonomous capabilities for system management, error recovery, and learning. It includes:
- Intelligent auto-repair system that analyzes errors and generates fixes
- Self-modification capabilities for autonomous code updates
- Persistent learning and performance tracking across sessions
- Enhanced security safeguards with rollback capabilities

### Background Worker System
A robust background diagnostics and maintenance system runs continuously, performing:
- 6-hour diagnostic cycles
- Daily repair operations
- Comprehensive weekly tests
- Maintenance mode for scheduled activities
- Severity-classified failure reporting

### Privacy & Security
- Automated data cleanup system (14 days post-payment for user data, 30 days for error logs)
- 4-layer security firewall to prevent vulnerabilities
- Secure evidence upload with access control
- Session-based authentication with PostgreSQL storage

## Installation

### Prerequisites
- **Node.js 20.x** (Required for Railway deployment - see Node Version section below)
- PostgreSQL database
- Google Cloud Storage account (optional, for file storage)
- Square account for payment processing
- **AI Provider API Keys** (at least 4 free providers recommended):
  - OpenRouter API key (FREE - 4 models)
  - Gemini API key (FREE - 3 models)
  - Groq API key (FREE - 2 models)
  - Mistral API key (FREE - 1 model)
  - Anthropic API key (PAID - optional)

### Node Version Requirements

**Production (Railway)**: Node 20.x  
**Development (Local)**: Node 20.x or 24.x

**Why Node 20?** Railway deployment requires Node 20.x for optimal performance and compatibility.

**Setup for Development**:
```bash
# Using nvm (Node Version Manager)
nvm install 20
nvm use 20

# Or using .nvmrc file
nvm use  # Automatically uses Node 20 from .nvmrc

# Verify version
node -v  # Should show v20.x.x
```

The project includes:
- `.nvmrc` file with Node 20
- `package.json` engines field specifying Node 20.x
- `railway.json` configured for Node 20 runtime

### Environment Variables
Create a `.env` file with the following configuration:

```bash
# Node Environment
NODE_ENV=production
PORT=3000
BASE_URL=https://your-domain.com

# Database
DATABASE_URL=postgresql://user:password@host:port/database
SUPABASE_DATABASE_URL=postgresql://... # Optional alternative

# Authentication & Security
SESSION_SECRET=your-session-secret-64-chars
JWT_SECRET=your-jwt-secret-64-chars
ENCRYPTION_KEY=your-encryption-key-32-chars

# AI Providers (Required: 4 free providers)

# 1. OpenRouter (FREE - 4 models)
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxx

# 2. Gemini (FREE - 3 models)
GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxx

# 3. Groq (FREE - 2 models)
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx

# 4. Mistral (FREE - 1 model)
MISTRAL_API_KEY=xxxxxxxxxxxxxxxxxxxx

# 5. Anthropic (PAID - Optional)
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx

# Email Service (Resend recommended)
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
DEFAULT_FROM_EMAIL=noreply@yourdomain.com
DEFAULT_FROM_NAME=LegalWhat

# Payment Processing (Square)
SQUARE_ACCESS_TOKEN=your-square-production-token
SQUARE_SANDBOX_ACCESS_TOKEN=your-square-sandbox-token
SQUARE_LOCATION_ID=your-square-location-id
SQUARE_APPLICATION_ID=your-square-app-id
SQUARE_ENVIRONMENT=production
SQUARE_WEBHOOK_SIGNATURE_KEY=your-webhook-signature-key

# File Storage (Optional)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GCS_PROJECT_ID=your-gcs-project
PRIVATE_OBJECT_DIR=private
PUBLIC_OBJECT_SEARCH_PATHS=public,assets
```

**Get API Keys**:
- OpenRouter: [openrouter.ai/keys](https://openrouter.ai/keys)
- Gemini: [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- Groq: [console.groq.com/keys](https://console.groq.com/keys)
- Mistral: [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys)
- Anthropic: [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
- Resend: [resend.com/api-keys](https://resend.com/api-keys)

### Setup Instructions

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/badblue.git
cd badblue
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up the database**
```bash
# Run database migrations
npm run migrate

# Or push schema changes
npm run db:push
```

4. **Verify installation**
```bash
# Run all verification scripts
npm run verify

# Or run comprehensive verification
npm run verify:final
```

4. **Verify installation**
```bash
# Run all verification scripts
npm run verify

# Or run comprehensive verification
npm run verify:final
```

5. **Build the application**
```bash
npm run build
```

6. **Start the application**
```bash
# Development
npm run dev

# Production
npm start
```

## Deployment

### Railway Deployment (Recommended)

**Complete step-by-step guide**: See [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)

**Quick Start**:

1. **Prerequisites**
   - Node 20.x installed locally
   - All environment variables configured
   - All verification scripts passing

2. **Pre-Deployment Checks**
   ```bash
   # Run comprehensive verification
   npm run verify:final
   
   # Check deployment readiness
   npm run deploy:check
   ```

3. **Deploy to Railway**
   - Create Railway project
   - Connect GitHub repository
   - Railway auto-detects `railway.json` configuration
   - Add environment variables in Railway dashboard
   - Deploy automatically on git push

4. **Post-Deployment**
   ```bash
   # Test health endpoint
   curl https://your-app.railway.app/health
   
   # Verify API
   curl https://your-app.railway.app/api/law-types
   ```

**Railway Configuration** (`railway.json`):
- ✅ Nixpacks builder
- ✅ Node 20 runtime
- ✅ Automatic build and start commands
- ✅ Restart policy configured

**Production Checklist**: See [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md)

## 🐳 Docker Deployment

### Prerequisites
- Docker 20.10+
- Docker Compose 2.0+

### Local Development with Docker

1. Build and start services:
```bash
docker-compose up --build
```

2. Access application:
```
http://localhost:5000
```

3. View logs:
```bash
docker-compose logs -f app
```

### Railway Deployment

Railway automatically detects the Dockerfile and builds the container.

1. Push changes to repository
2. Railway builds using `Dockerfile`
3. All Chromium dependencies included automatically

### Testing Puppeteer

```bash
# Inside container
docker exec -it legalwhat-app npm run docker:test

# Or manually test
docker run --rm legalwhat:latest node -e "
  const puppeteer = require('puppeteer');
  (async () => {
    const browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('✅ Puppeteer working!');
    await browser.close();
  })();
"
```

### Troubleshooting

**Issue: Chromium not found**
```bash
# Check Chromium installation
docker run --rm legalwhat:latest which chromium
```

**Issue: Sandbox errors**
```bash
# Verify sandbox flags are set
docker run --rm legalwhat:latest env | grep PUPPETEER
```

### Platform-Specific Deployment

#### Railway
The application automatically detects Railway environment using `RAILWAY_PUBLIC_DOMAIN`.

#### Heroku
Deploy using the Heroku CLI or GitHub integration. The app detects Heroku via `HEROKU_APP_NAME`.

#### AWS/Google Cloud/Azure
Deploy as a containerized application or use platform-specific Node.js services.

## Development

### Project Structure
```
badblue/
├── client/               # React frontend
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── pages/       # Route pages
│   │   ├── hooks/       # Custom React hooks
│   │   └── lib/         # Utility functions
├── server/              # Express backend
│   ├── routes.ts        # API endpoints
│   ├── storage.ts       # Database operations
│   ├── services/        # Service modules
│   │   └── mlnlp/      # ML/NLP Intelligence Layer
│   └── *.ts            # Other service modules
├── shared/              # Shared types/schemas
└── public/              # Static assets
```

### ML/NLP Intelligence Layer

The platform includes an advanced ML/NLP Intelligence Layer with two major components:

#### 1. OSINT ML/NLP (People Finder)
Enhances OSINT data quality and accuracy:
- **NLP Text Processing**: Extracts entities (people, organizations, locations, emails, phones)
- **ML Entity Resolution**: Fuzzy matching and deduplication across sources
- **Confidence Scoring**: Multi-factor assessment of data reliability
- **Worker Orchestration**: Manages ML/NLP pipeline execution

#### 2. AI Orchestration ML Layer (NEW)
Intelligently manages multi-model AI operations:
- **ML Confidence Worker**: Scores and ranks outputs from multiple AI models
- **ML Routing Worker**: Routes tasks to optimal models based on capabilities
- **ML Clustering Worker**: Clusters and links entities (people, orgs, cases, documents, evidence)
- **F.M.I. NLP Worker**: Forensic media intelligence with legal/evidentiary tagging
  - Entity extraction (people, orgs, dates, statutes, courts, agencies)
  - Relationship extraction (subject-verb-object, actor-action-target)
  - Timeline reconstruction from events
  - Evidentiary tagging (threats, admissions, inconsistencies, corroborations)

**Technology Stack:**
- **Node-Compatible ML**: TensorFlow.js, ONNX Runtime
- **NLP Libraries**: compromise.js, natural, wink-nlp
- **Similarity**: fast-levenshtein for fuzzy matching

**Integration:**
- Legal Model Orchestrator (ML-enhanced routing and consensus)
- F.M.I. Intelligence Tool (AI + NLP combined extraction)
- LEXARA consultation engine (ML-powered analysis)

See documentation:
- [ML/NLP Intelligence (OSINT)](docs/ML_NLP_INTELLIGENCE.md)
- [ML/NLP Orchestration Layer](docs/ML_NLP_ORCHESTRATION.md)

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run check` - TypeScript type checking
- `npm run db:push` - Push database schema changes
- `npm run migrate` - Run database migrations
- `npm run verify` - Run all stage verification scripts
- `npm run verify:final` - Comprehensive verification (all stages + build + TypeScript)
- `npm run deploy:check` - Deployment readiness check
- `npm run ai:analyze` - Analyze AI provider usage

## API Documentation

### Authentication Endpoints
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `GET /api/auth/logout` - User logout
- `GET /api/auth/user` - Get current user

### Core Services
- `POST /api/complaints` - File a complaint
- `POST /api/lawsuits` - Generate lawsuit documents
- `POST /api/officer-search` - Search for officer information
- `POST /api/evidence/upload` - Upload evidence files

### Autosave API (13 endpoints)
- `POST /api/autosave/sessions` - Create work session
- `GET /api/autosave/sessions` - List user sessions
- `GET /api/autosave/sessions/:id` - Get session with latest snapshot
- `PATCH /api/autosave/sessions/:id` - Update session metadata
- `DELETE /api/autosave/sessions/:id` - Delete session
- `POST /api/autosave/sessions/:id/snapshot` - Create autosave snapshot
- `POST /api/autosave/sessions/:id/consultation` - Save consultation message
- `POST /api/autosave/sessions/:id/draft` - Save document draft

### Law Types API
- `GET /api/law-types` - Get all law types (9 types)
- `POST /api/law-types/:type/start-session` - Smart session creation

See [AUTOSAVE_ARCHITECTURE.md](docs/AUTOSAVE_ARCHITECTURE.md) for API details.

## Documentation

- **[DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)** - Complete Railway deployment guide
- **[AI_PROVIDERS.md](docs/AI_PROVIDERS.md)** - All 5 AI providers with 12 models
- **[AUTOSAVE_ARCHITECTURE.md](docs/AUTOSAVE_ARCHITECTURE.md)** - Autosave system technical docs
- **[PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md)** - Pre-deployment checklist
- **[CHANGELOG.md](CHANGELOG.md)** - All 20 stages documented
- **[IMPLEMENTATION_COMPLETE.md](IMPLEMENTATION_COMPLETE.md)** - Final sign-off

## Contributing
Please read our contributing guidelines before submitting pull requests.

## License
Copyright (c) 2025 - All rights reserved.

## Support
For support inquiries, please contact support@badblue.com

## Critical Bug Fixes Log

### November 9, 2025
- **Database Pool Reset**: Fixed critical bug in database connection pooling
- **Auto-Repair Guard**: Added null-safety checks for error handling
- **API Quota Management**: Implemented tiered test coverage to prevent API exhaustion

## External Dependencies
- **Payment Processing**: Square
- **AI/ML Services**: Google Gemini API, Groq API
- **File Upload Libraries**: react-dropzone, Uppy
- **Date Formatting**: date-fns
- **CSV Processing**: csv-parse, csv-stringify