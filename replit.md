# BadBlue - Police Accountability Platform

## Overview
BadBlue is a privacy-focused police accountability platform designed to empower citizens in filing complaints and initiating civil rights lawsuits against police officers. It leverages AI for officer identification, legal analysis, intelligent form prefill, automated routing, and jurisdiction-specific legal document generation. The platform supports secure evidence uploads and offers services like LegalAI Consultation, Officer Search, and various legal document generations to enhance police accountability through accessible legal avenues. The project aims to provide an accessible, AI-powered solution to facilitate legal action and increase transparency in policing.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
The platform utilizes a modern web stack featuring a React 18 frontend with TypeScript, Vite, Wouter for routing, and Radix UI/shadcn/ui with Tailwind CSS for styling, adhering to Material Design and civic technology UI patterns. State management is handled by TanStack Query, and form validation uses React Hook Form with Zod. The backend is a Node.js/Express.js application providing a RESTful API, with authentication via Replit OAuth and PostgreSQL for session storage. PostgreSQL (Neon serverless) with Drizzle ORM serves as the primary database, while Replit App Storage is used for private evidence files.

**PACKAGE UPDATES (Nov 30, 2025)**:
-   **Drizzle ORM**: Updated from 0.39.3 to 0.44.7 - latest stable version with improved PostgreSQL support
-   **Drizzle Kit**: Updated from 0.20.18 to 0.31.7 - latest schema migration tools  
-   **Drizzle Zod**: Kept at 0.7.1 (0.8.x requires Zod v4 which would be a breaking change)
-   **Email System**: Reconfigured to use Resend API exclusively (replaced Google Workspace SMTP)
-   All database operations verified working with the updated packages

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
*   **Payment Processing**: Stripe
*   **Email Service**: Resend API (transactional emails)
*   **AI/ML Services**: Google Gemini API, Groq API
*   **Authentication Service**: Replit OAuth
*   **File Upload Libraries**: `react-dropzone`, Uppy
*   **Date Formatting**: `date-fns`
*   **CSV Processing**: `csv-parse`, `csv-stringify`