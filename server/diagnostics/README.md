# BadBlue Diagnostic Tools Guide

This directory contains various diagnostic tools for testing and monitoring the BadBlue system. Each tool serves a specific purpose and should be used in different scenarios.

## Available Diagnostic Tools

### 1. `quickDiagnostic.ts` 
**Purpose:** Fast, lightweight system health check

**When to use:**
- Quick verification that core systems are operational
- After deployment to verify basic functionality
- As part of CI/CD health checks
- When you need results in under 10 seconds

**What it checks:**
- Database connection
- Essential environment variables
- Core table existence
- API service availability (basic ping)

**How to run:**
```bash
tsx server/quickDiagnostic.ts
# or from the diagnostics directory
tsx server/diagnostics/quickDiagnostic.ts
```

**Output:** JSON format with pass/fail status for each check

---

### 2. `systemDiagnostics.ts`
**Purpose:** Standard system diagnostic with moderate detail

**When to use:**
- Regular system health monitoring
- After making configuration changes
- Before major feature deployments
- When investigating minor issues

**What it checks:**
- Database connection and query performance
- All environment variables
- All database tables and schema
- Authentication system
- Email service connectivity
- Basic AI provider connectivity

**How to run:**
```bash
tsx server/systemDiagnostics.ts
```

**Output:** Structured report with categorized results

---

### 3. `comprehensiveDiagnostics.ts`
**Purpose:** Deep, thorough system analysis

**When to use:**
- Troubleshooting complex issues
- Pre-production verification
- After major system changes or migrations
- When you need detailed information about system state
- For generating comprehensive status reports

**What it checks:**
- Everything from `systemDiagnostics.ts` plus:
- AI provider response times and token usage
- Database table row counts and data integrity
- Worker system health and job queue status
- Cache performance metrics
- Detailed connection pool statistics
- All API endpoint availability
- Payment processing system (Square) integration
- Object storage (if configured)

**How to run:**
```bash
tsx server/comprehensiveDiagnostics.ts
```

**Output:** Detailed multi-section report with metrics and recommendations

**Warning:** This diagnostic can take 30-60 seconds to complete due to extensive checks.

---

### 4. `testDiagnostics.ts`
**Purpose:** Test-oriented diagnostic for development

**When to use:**
- During active development
- When writing or debugging tests
- When you need to verify specific subsystems
- In development environment only

**What it checks:**
- Test database connectivity
- Mock service availability
- Development-specific configurations
- Test data setup and teardown

**How to run:**
```bash
tsx server/testDiagnostics.ts
```

**Output:** Test-friendly format suitable for CI/CD integration

**Note:** Not intended for production use

---

### 5. `fullSystemTest.ts`
**Purpose:** End-to-end integration testing

**When to use:**
- Before major releases
- After significant architectural changes
- To verify entire workflow from user action to database
- For acceptance testing

**What it checks:**
- Complete user flows (signup, login, payment, etc.)
- Integration between all major components
- Data persistence across the full stack
- Error handling and recovery mechanisms

**How to run:**
```bash
tsx server/fullSystemTest.ts
```

**Output:** Step-by-step test results with pass/fail for each workflow

**Warning:** May create test data in the database. Use with caution in production.

---

### 6. `runDiagnostics.ts`
**Purpose:** Diagnostic orchestrator/runner

**When to use:**
- When you need to run multiple diagnostics in sequence
- For scheduled monitoring tasks
- To generate a comprehensive report from multiple tools

**What it does:**
- Orchestrates running multiple diagnostic tools
- Aggregates results from different diagnostics
- Provides consolidated reporting

**How to run:**
```bash
tsx server/runDiagnostics.ts
```

---

## Comparison Matrix

| Tool | Speed | Depth | Use Case | Production Safe |
|------|-------|-------|----------|-----------------|
| `quickDiagnostic` | ⚡ Fast (5-10s) | ⭐ Basic | Health checks, CI/CD | ✅ Yes |
| `systemDiagnostics` | 🔄 Medium (15-30s) | ⭐⭐ Standard | Regular monitoring | ✅ Yes |
| `comprehensiveDiagnostics` | 🐌 Slow (30-60s) | ⭐⭐⭐ Deep | Troubleshooting | ✅ Yes |
| `testDiagnostics` | ⚡ Fast | ⭐⭐ Targeted | Development/Testing | ⚠️ Dev only |
| `fullSystemTest` | 🐌 Slow (60s+) | ⭐⭐⭐ Complete | Pre-release testing | ⚠️ Caution |
| `runDiagnostics` | 🔄 Varies | ⭐⭐⭐ Orchestrated | Scheduled monitoring | ✅ Yes |

---

## Recommendations

### For Daily Monitoring
Use `quickDiagnostic.ts` on a schedule (e.g., every 5 minutes)

### For Issue Investigation
1. Start with `quickDiagnostic.ts` to identify failing systems
2. Run `systemDiagnostics.ts` for more detail on the issue
3. If needed, run `comprehensiveDiagnostics.ts` for deep analysis

### For Deployments
1. Pre-deployment: Run `systemDiagnostics.ts`
2. Post-deployment: Run `quickDiagnostic.ts` immediately
3. After 5 minutes: Run `comprehensiveDiagnostics.ts` for full verification

### For Development
Use `testDiagnostics.ts` frequently during development to catch issues early

---

## Output Locations

Diagnostic results are typically saved to:
- Console output (stdout)
- Log files in `data/` directory (if configured)
- Database tables for metrics (for `comprehensiveDiagnostics`)

Check specific diagnostic files for exact output locations.

---

## Troubleshooting

### "Database connection failed"
- Check `DATABASE_URL` environment variable
- Verify database is running and accessible
- Check firewall rules if on remote database

### "AI provider timeout"
- Check API keys in environment variables
- Verify network connectivity
- Check provider status pages

### "Table does not exist"
- Run migrations: `npm run migrate`
- Check database schema version

### "Diagnostic hangs or times out"
- Try `quickDiagnostic.ts` first
- Check for deadlocks in database
- Review recent system changes

---

## Adding New Diagnostics

When creating a new diagnostic tool:

1. Place it in `server/diagnostics/` directory
2. Follow the naming convention: `[purpose]Diagnostic.ts`
3. Include CLI usage instructions in comments
4. Update this README with the new tool
5. Add it to `runDiagnostics.ts` if appropriate

---

## See Also

- `data/FINAL_SYNOPSIS.md` - Latest diagnostic results
- `data/DIAGNOSTIC_REPORT.md` - Historical diagnostic reports
- `PRODUCTION_CHECKLIST.md` - Pre-deployment checklist
