# BadBlue - Police Accountability Platform

## Overview
BadBlue is a privacy-focused police accountability platform designed to empower citizens in filing complaints and initiating civil rights lawsuits against police officers. It leverages AI for officer identification, legal analysis, intelligent form prefill, automated routing, and jurisdiction-specific legal document generation. The platform supports secure evidence uploads and offers services like LegalAI Consultation, Officer Search, and various legal document generations to enhance police accountability through accessible legal avenues. The project aims to provide an accessible, AI-powered solution to facilitate legal action and increase transparency in policing.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
The platform utilizes a modern web stack featuring a React 18 frontend with TypeScript, Vite, Wouter for routing, and Radix UI/shadcn/ui with Tailwind CSS for styling, adhering to Material Design and civic technology UI patterns. State management is handled by TanStack Query, and form validation uses React Hook Form with Zod. The backend is a Node.js/Express.js application providing a RESTful API, with local username/password authentication and PostgreSQL for session storage. **Supabase PostgreSQL** with Drizzle ORM serves as the primary database, with filesystem storage for private evidence files (cloud storage optional).

**PLATFORM INDEPENDENCE (Nov 30, 2025)**:
-   **Database**: Uses Supabase PostgreSQL via `SUPABASE_DATABASE_URL` environment variable
-   **Deployment Target**: Railway.com (fully compatible, `railway.toml` configured)
-   **Authentication**: Local username/password (platform-agnostic, no OAuth dependencies)
-   **File Storage**: Filesystem-based with optional Google Cloud Storage fallback
-   **All Replit-specific code has been removed** - app is 100% platform-agnostic

**DATABASE CONFIGURATION (Nov 30, 2025)**:
-   **Dual-URL Architecture**: `drizzle.config.ts` uses `DATABASE_URL` (Replit internal DB, ~13 tables), while runtime uses Supabase URL (production DB, 69 tables). This is by design as `drizzle.config.ts` is a protected file.
-   **Schema Verification**: `/api/schema-verify` endpoint is the CANONICAL SOURCE OF TRUTH for database table counts
-   **Startup Verification**: Server runs automatic schema verification at startup with prominent logging
-   **Production Guard**: Production requires Supabase database - accepts multiple environment variable names (see Railway compatibility below)
-   **Railway.com Compatibility**: Accepts database URL from `SUPABASE_URL` (Railway default), `SUPABASE_DATABASE_URL`, `SUPABASE_DB_URL`, or `DATABASE_URL` (if hostname contains supabase domain)
-   **Migration Pattern**: All migrations use `db.execute(sql`...`)` from Drizzle ORM for consistency
-   **Connection Logging**: `server/db.ts` logs database connection source with warnings for fallback usage
-   **Worker Metrics Tables**: `worker_health_metrics` and `worker_repair_metrics` tables for comprehensive worker monitoring
-   **Contact Form Route**: `/api/contact` POST route forwards to `contact.badblue@gmail.com` with database persistence

**⚠️ DEPRECATED TOOLS (Nov 30, 2025)**:
-   **execute_sql_tool**: DEPRECATED - Connects to `DATABASE_URL` (Replit internal, ~13 tables), NOT production Supabase (69 tables)
-   **Alternative**: Use `/api/schema-verify` endpoint via `curl http://localhost:5000/api/schema-verify`
-   **Alternative**: Check startup logs for database verification results
-   **Why Deprecated**: Tool caused recurring confusion by returning wrong table counts from internal database

**WEB SEARCH INTEGRATION (Nov 30, 2025)**:
-   **Unified Web Search Service**: New `server/webSearchService.ts` combines Bing Search API and Gemini AI with googleSearch grounding
-   **Bing Search**: Direct API integration for web and news searches (BING_API_KEY required)
-   **Gemini Search**: AI-powered search with Google Search grounding for verified sources
-   **Integration Points**: Officer search, sub-agent autonomous collection, worker repair guidance, legal statute research
-   **Key Functions**: `unifiedSearch()`, `searchOfficerRecords()`, `searchLegalStatutes()`, `searchTechnicalGuidance()`, `batchOfficerSearch()`

**COMPLAINT & LAWSUIT DRAFTING SYSTEM (Nov 30, 2025)**:
-   **Enhanced Complaint Drafting**: Professional complaint generation in `server/complaintDraftingSystem.ts` with web search for authority lookup
-   **Authority Lookup**: Automated search for Internal Affairs, oversight boards, and command staff contacts via unified web search
-   **Automatic Routing**: Complaints routed to discovered authorities with fallback to `contact.badblue@gmail.com` if no contacts found
-   **Section 1983 Lawsuit Generator**: Federal civil rights lawsuit generation in `server/section1983LawsuitGenerator.ts`
-   **District Court Rules**: Per-district formatting rules (California line numbering, font requirements, margin specs)
-   **New Database Tables**: `authority_contacts_cache`, `complaint_routing_history`, `section_1983_filings`
-   **API Endpoints**: `/api/complaint-drafting/*` and `/api/section-1983/*` routes

**FOIA ROUTING SYSTEM (Nov 30, 2025)**:
-   **FOIA Authority Lookup**: Automated search for FOIA officers, records custodians, and transparency offices via unified web search
-   **State FOIA Information**: Complete database of all 50 states + DC FOIA statutes, deadlines, and exemption references
-   **Enhanced FOIA Generation**: Professional FOIA request generation in `server/foiaRoutingSystem.ts` with state-specific statute compliance
-   **Automatic FOIA Routing**: FOIA requests routed to discovered FOIA officers/portals with fallback to `contact.badblue@gmail.com`
-   **New Database Tables**: `foia_routing_history` for tracking submission attempts and outcomes
-   **API Endpoints**: `/api/foia/lookup-authorities`, `/api/foia/state-info/:state`, `/api/foia/generate`, `/api/foia/route`, `/api/foia/all-states`

**PACKAGE UPDATES (Nov 30, 2025)**:
-   **Drizzle ORM**: Updated from 0.39.3 to 0.44.7 - latest stable version with improved PostgreSQL support
-   **Drizzle Kit**: Updated from 0.20.18 to 0.31.7 - latest schema migration tools  
-   **Drizzle Zod**: Kept at 0.7.1 (0.8.x requires Zod v4 which would be a breaking change)
-   **Email System**: Reconfigured to use Resend API exclusively (replaced Google Workspace SMTP)
-   **Google AI SDKs**: Uses both `@google/genai` (for web-grounded searches) and `@google/generative-ai` (for standard AI calls)
-   All database operations verified working with the updated packages

**RAILWAY DEPLOYMENT FIXES (Nov 30, 2025)**:
-   **IPv6/IPv4 Connectivity**: Railway's shared network doesn't support IPv6 egress. Fix: Set `NODE_OPTIONS="--dns-result-order=ipv4first"` in Railway env vars
-   **Migration Bundling**: Changed from dynamic imports to static imports for all 8 migration modules. Dynamic imports (`await import(path)`) can't be analyzed by esbuild bundler, causing `ENOENT` errors in production. Static imports are now at top of `server/index.ts` and bundled into single `dist/index.js` (~686KB)
-   **Documentation**: See `RAILWAY_DEPLOYMENT.md` for full Railway-specific configuration

**CRITICAL BUG FIXES (Nov 14, 2025)**:
-   **Groq Quota Exhaustion Prevention**: Disabled autonomous data collection system that was consuming 100% of daily Groq quotas (100,000 tokens), violating the 35% limit requirement. System now prevents quota exhaustion with autonomous functions temporarily disabled pending proper token budget implementation.
-   **Frontend Serving Fix**: Fixed critical issue where notFoundHandler middleware was catching all routes before Vite could serve the frontend, causing JSON 404 errors for all UI routes. Implemented scoped notFoundHandler only for /api routes.
-   **Authentication Flow Enhancement**: Fixed Get Started button redirect to properly open signup tab using URL parameters (/login?signup=true), improving user onboarding experience.
-   **Database Pool Reset Helper**: Fixed critical bug where `repairDatabaseConnection()` called `pool.end()` on singleton pool, leaving drizzle with dead connection. Implemented thread-safe `resetPool()` helper in `server/db.ts` that atomically swaps pool/drizzle instances using module-level `let` exports and promise locking.
-   **Auto-Repair TypeError Guard**: Fixed `attemptAutoRepair()` calling `.includes()` on undefined `issue.cause` field by adding null-safety guard `const cause = issue.cause || ''`.

Key architectural decisions and features include:

-   **Intelligent AI Architecture**: A coordinated Gemini (primary) to Groq (fallback) system is implemented across all AI services for resilience and cost-efficiency. The AI Sub-Agent, critical for system management and autonomous operations, exclusively uses Groq. Smart rate limiting ensures proactive detection and switching to Groq before user disruption.
-   **AI Sub-Agent**: An admin-only AI Sub-Agent provides advanced autonomous capabilities for system management, error recovery, and learning. It has full application control, including file, database, and service manipulation, with enhanced security safeguards. It incorporates an intelligent auto-repair system that analyzes errors, generates fixes, and retries with corrected commands, and a self-modification system capable of autonomously updating its own code. It can implement its own recommendations with file and database access, including an undo failsafe for rollback. This sub-agent also handles autonomous data collection, persistent learning, and self-improvement by tracking capabilities, learning patterns, and performance metrics across sessions.
-   **BadBlue Worker System**: A robust background diagnostics and maintenance system runs continuously, performing aggressive 6-hour diagnostics, daily repair cycles, and comprehensive weekly tests (Sunday 2:30 UTC). This system operates with a maintenance mode for scheduled activities and provides accurate, severity-classified failure reporting. The Worker has architect-level analysis capabilities, web access for bug fixing (Stack Overflow API, GitHub Issues API, documentation links), and collaborates with the Sub-Agent for critical repairs. Features comprehensive security: protected file detection with symlink escape prevention, path traversal blocking, null byte injection prevention, and command whitelisting with deny-by-default enforcement.
-   **Sub-Agent Web Harvester**: Daily automated officer data collection (2:30 UTC) with web search integration, officer profile compilation, and database storage. Command execution is strictly limited to read-only operations (npm list/view/info, ls, cat, echo, pwd, wc, head, tail). Protected by multi-layer security: URL decoding normalization, directory traversal detection (multiple encodings), symlink escape prevention via realpath verification, command chaining/subshell blocking, and inline JS execution prevention. Admin bypass functions and payment credentials are protected by immutable safety constraints.
-   **Automated Data Cleanup System**: A privacy-focused system automatically deletes user data after 14 days post-payment and error logs after 30 days, while preserving usernames, emails, and evidence files.
-   **Security Firewall**: A 4-layer protection system is implemented to mitigate RCE vulnerabilities while preserving autonomous execution, including a network firewall, command validator, rate limiting, and a kill switch for autonomous execution.
-   **Platform Independence**: The system is designed for platform-agnostic deployment (e.g., Replit, Railway.com) using environment variables for base URLs and graceful degradation of features like object storage when unavailable.
-   **Critical Monitoring System**: A system runs every 30 minutes to monitor API rate limits (Gemini, Groq), database health, payment gateway connectivity, and email service availability, with strategic automated pausing and resuming of autonomous searches to prevent quota exhaustion.
-   **Admin Management**: An admin panel is provided for managing community-shared evidence submissions with full CRUD capabilities, bulk operations, and user attribution.

## External Dependencies
*   **Database**: Supabase PostgreSQL
*   **Payment Processing**: Stripe
*   **Email Service**: Resend API (transactional emails)
*   **AI/ML Services**: Mistral AI (50%), Groq (30-35%), Google Gemini (10%), Anthropic Claude (5-10%)
*   **Authentication**: Local username/password (platform-agnostic)
*   **File Upload Libraries**: `react-dropzone`, Uppy
*   **Date Formatting**: `date-fns`
*   **CSV Processing**: `csv-parse`, `csv-stringify`

## Deployment
*   **Target Platform**: Railway.com
*   **Database**: Supabase PostgreSQL (SUPABASE_DATABASE_URL)
*   **Configuration**: `railway.toml` for Railway deployment
*   **Health Check**: `/api/health` endpoint