# BadBlue - Police Accountability Platform

## Overview
BadBlue is a privacy-focused police accountability platform that empowers citizens to file complaints and initiate civil rights lawsuits against police officers. It utilizes AI for officer identification, legal analysis, intelligent form prefill, automated routing, and jurisdiction-specific legal document generation. The platform supports secure evidence uploads and offers services like LegalAI Consultation, Officer Search, and various legal document generations to enhance police accountability through accessible legal avenues. The project aims to provide an accessible, AI-powered solution to facilitate legal action and increase transparency in policing.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
The platform features a React 18 frontend with TypeScript, Vite, Wouter for routing, and Radix UI/shadcn/ui with Tailwind CSS for styling, adhering to Material Design and civic technology UI patterns. State management uses TanStack Query, and form validation uses React Hook Form with Zod. The backend is a Node.js/Express.js application providing a RESTful API, with local username/password authentication. Supabase PostgreSQL with Drizzle ORM serves as the primary database, with filesystem storage for private evidence files (cloud storage optional).

**Key Architectural Decisions and Features:**
*   **Platform Independence**: Designed for agnostic deployment (e.g., Railway.com) using environment variables for configurations, with Railway.com as the primary deployment target.
*   **Railway-Compatible Health Checks**: The `/api/health` endpoint returns HTTP 200 immediately when the HTTP server starts listening, allowing Railway's 30-second health check window to pass while database migrations and service initialization continue in the background. The `isReady` flag tracks HTTP availability; `isFullyInitialized` tracks complete service startup. Use `/api/ready` for strict readiness probes.
*   **Database Configuration**: Uses Supabase PostgreSQL. `drizzle.config.ts` uses `DATABASE_URL` (for local development/testing), while runtime uses the Supabase URL for production. Schema verification is performed at startup, and `/api/schema-verify` is the canonical source of truth for table counts. All migrations use `db.execute(sql`...`)` from Drizzle ORM.
*   **Connection Pool Optimization**: Node.js pool max set to 8 connections (below PgBouncer limit of 10) to prevent pool exhaustion. Key optimizations:
    - **Memoized Quota Status**: `getQuotaStatus()` uses 30-second cache with mutex to prevent 11-query Promise.all fan-out
    - **Single Aggregated Query**: `getAllQuotaMetrics()` in tokenMetricsRepository replaces multiple parallel queries
    - **Relaxed Polling**: SearchSessionManager polls every 180 seconds (vs 60s) to reduce database pressure
    - **Pool Monitoring**: `getPoolStats()` in server/db.ts for diagnostics
*   **Intelligent AI Architecture**: A coordinated multi-provider AI system with context-aware routing:
    - **USER Searches**: Gemini → Mistral → Claude → Groq (Groq last resort only)
    - **AUTONOMOUS Functions**: Groq exclusively (no rate limit, unlimited capacity)
    - **Groq Policy**: Reserved for autonomous functions only. No autonomous rate limit. Only used for user searches as absolute last resort when all other providers fail.
    - Features provider-specific model validation (`getProviderModel()`) that automatically maps invalid models to provider defaults.
*   **AI Sub-Agent**: An admin-only AI Sub-Agent provides autonomous capabilities for system management, error recovery, and learning, with full application control including file, database, and service manipulation. Features:
    - **Self-Improvement Engine Integration**: Consumes training queue from `learningData.json` every 30 minutes via `consumeTrainingQueue()` and `processLearningPattern()` methods
    - **4-Way AI Collaboration**: Gemini → Groq → Mistral → Claude fallback with `callAIWithFallback()` function
    - **Intelligent Auto-Repair System**: AI-assisted remediation via `attemptAIRemediation()` before manual repair fallback
*   **BadBlue Worker System**: A robust background diagnostics and maintenance system runs continuously. Enhanced features:
    - **Repair Queue Persistence**: Saves to `data/repair_queue.json` and restores on startup
    - **AI-Assisted Remediation Flow**: Uses `attemptAIRemediation()` → `executeAIRemediationPlan()` before manual repairs
    - **MTTR Segmentation**: Tracks Mean Time To Resolution per category via `updateMttrMetrics()` and `getMttrReport()`
    - **Per-Category Success Rates**: Detailed success tracking by issue category (infrastructure, application_code, ai_service, etc.)
    - **Metrics Persistence**: Saves every 15 minutes and on shutdown
*   **Sub-Agent Harvester Module** (`server/subAgentHarvester.ts`): Dedicated officer data collection system with:
    - **Daily Scheduled Harvests**: Configurable UTC time scheduling (default 3:00 UTC)
    - **Population Priority Integration**: High (100k+) searched every 24h, Medium (25k-100k) every 72h, Low (<25k) every 168h
    - **Failover Logging**: Structured logs to `data/subagent/harvest.log` with JSON entries
    - **Search Session Management**: Integration with `searchSessionManager.ts` for adaptive delays
*   **Security Hardening**:
    - **Admin Bypass Email**: Configured via `ADMIN_BYPASS_EMAIL` environment variable (default: admin@badblue.internal)
    - **Security Alerting**: `[SECURITY ALERT]` logging when admin bypass is used
*   **Sub-Agent Web Harvester**: Daily automated officer data collection with web search integration, officer profile compilation, and database storage, with strict command execution limitations to read-only operations and multi-layer security.
*   **Automated Data Cleanup System**: A privacy-focused system automatically deletes user data after 14 days post-payment and error logs after 30 days, preserving essential user information and evidence files.
*   **Security Firewall**: A 4-layer protection system mitigates RCE vulnerabilities while preserving autonomous execution.
*   **Critical Monitoring System**: Monitors API rate limits (Gemini, Groq), database health, payment gateway connectivity, and email service availability every 30 minutes, with strategic automated pausing and resuming of autonomous searches.
*   **Admin Management**: 
    - **Bad Blue Users Panel**: Admin panel showing all registered users with their purchased services (complaints, lawsuits, petitions, FOIA requests), sign-up dates, and last login information.
    - **Corrupt Law Enforcement & Informant Hub**: Admin panel for managing community-shared corruption and informant evidence submissions with full CRUD capabilities.
*   **Web Search Integration**: A unified `server/webSearchService.ts` combines Bing Search API and Gemini AI with Google Search grounding for officer searches, legal statute research, and other data collection.
*   **Complaint & Lawsuit Drafting System**: Professional complaint generation with automated web search for authority lookup and automatic routing. Includes a Section 1983 Lawsuit Generator with per-district formatting rules.
*   **FOIA Routing System**: Automated search for FOIA officers, comprehensive database of state FOIA statutes, and professional FOIA request generation with state-specific compliance.

## External Dependencies
*   **Database**: Supabase PostgreSQL
*   **Payment Processing**: Stripe
*   **Email Service**: Resend API
*   **AI/ML Services**: Mistral AI, Groq, Google Gemini, Anthropic Claude
*   **Authentication**: Local username/password
*   **File Upload Libraries**: `react-dropzone`, Uppy
*   **Date Formatting**: `date-fns`
*   **CSV Processing**: `csv-parse`, `csv-stringify`
*   **Search APIs**: Bing Search API, Google Search (grounding via Gemini)