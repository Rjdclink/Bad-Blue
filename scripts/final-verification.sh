#!/bin/bash

# ==================== FINAL VERIFICATION SCRIPT ====================
# Stage 20: Comprehensive verification of all 20 stages
# Runs all verification scripts and performs final checks
# Exit 0 if deployment-ready, 1 if issues found

set -uo pipefail

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       FINAL VERIFICATION - ALL 20 STAGES            ║${NC}"
echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo ""

PASSED=0
FAILED=0
WARNINGS=0

# Track verification status
ALL_CHECKS_PASSED=true

# ==================== STAGE VERIFICATION SCRIPTS ====================
echo -e "${BLUE}📋 Running Stage Verification Scripts...${NC}"
echo ""

for stage in 1 2 3 4 5 6 16 19; do
  SCRIPT="scripts/verify-stage-${stage}.cjs"
  if [ -f "$SCRIPT" ]; then
    echo -e "${BLUE}   Stage $stage:${NC} Running verification..."
    if node "$SCRIPT" > /dev/null 2>&1; then
      echo -e "${GREEN}   ✅ Stage $stage verification passed${NC}"
      ((PASSED++))
    else
      echo -e "${RED}   ❌ Stage $stage verification failed${NC}"
      ((FAILED++))
      ALL_CHECKS_PASSED=false
    fi
  else
    echo -e "${YELLOW}   ⚠️  Stage $stage verification script not found${NC}"
    ((WARNINGS++))
  fi
done

echo ""

# ==================== TYPESCRIPT COMPILATION ====================
echo -e "${BLUE}🔧 Checking TypeScript Compilation...${NC}"
if npx tsc --noEmit > /dev/null 2>&1; then
  echo -e "${GREEN}✅ TypeScript compilation successful (0 errors)${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ TypeScript compilation has errors${NC}"
  echo -e "${YELLOW}   Run 'npx tsc --noEmit' to see details${NC}"
  ((FAILED++))
  ALL_CHECKS_PASSED=false
fi

echo ""

# ==================== BUILD CHECK ====================
echo -e "${BLUE}🏗️  Checking Build...${NC}"
if npm run build > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Build successful${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ Build failed${NC}"
  echo -e "${YELLOW}   Run 'npm run build' to see details${NC}"
  ((FAILED++))
  ALL_CHECKS_PASSED=false
fi

echo ""

# ==================== CODE QUALITY CHECKS ====================
echo -e "${BLUE}🔍 Code Quality Checks...${NC}"
echo -e "${YELLOW}   Note: console.log and process.env warnings are informational${NC}"
echo -e "${YELLOW}   These help identify potential production issues but are not blockers${NC}"
echo ""

# Check for console.log in server code (except logger.ts and config.ts bootstrap)
echo -e "${BLUE}   Checking for console.log usage...${NC}"
CONSOLE_LOGS=$(find server -type f -name "*.ts" ! -name "logger.ts" ! -name "config.ts" -exec grep -l "console\\.log\\|console\\.error" {} \; 2>/dev/null || true)
if [ -z "$CONSOLE_LOGS" ]; then
  echo -e "${GREEN}   ✅ No console.log found in server code${NC}"
  ((PASSED++))
else
  echo -e "${YELLOW}   ⚠️  Found console.log in server files:${NC}"
  echo "$CONSOLE_LOGS" | while read line; do
    echo -e "${YELLOW}      - $line${NC}"
  done
  ((WARNINGS++))
fi

# Check for direct process.env usage (except config.ts, logger.ts, and db.ts bootstrap)
echo -e "${BLUE}   Checking for direct process.env usage...${NC}"
PROCESS_ENV=$(find server -type f -name "*.ts" ! -name "config.ts" ! -name "logger.ts" ! -name "db.ts" -exec grep -l "process\\.env\\." {} \; 2>/dev/null || true)
if [ -z "$PROCESS_ENV" ]; then
  echo -e "${GREEN}   ✅ No direct process.env usage found${NC}"
  ((PASSED++))
else
  echo -e "${YELLOW}   ⚠️  Found direct process.env usage in:${NC}"
  echo "$PROCESS_ENV" | while read line; do
    echo -e "${YELLOW}      - $line${NC}"
  done
  ((WARNINGS++))
fi

echo ""

# ==================== DOCUMENTATION CHECK ====================
echo -e "${BLUE}📚 Checking Documentation...${NC}"

REQUIRED_DOCS=(
  "README.md"
  "PRODUCTION_CHECKLIST.md"
  "CHANGELOG.md"
  "IMPLEMENTATION_COMPLETE.md"
  "docs/DEPLOYMENT_GUIDE.md"
  "docs/AI_PROVIDERS.md"
  "docs/AUTOSAVE_ARCHITECTURE.md"
)

for doc in "${REQUIRED_DOCS[@]}"; do
  if [ -f "$doc" ]; then
    echo -e "${GREEN}   ✅ $doc exists${NC}"
    ((PASSED++))
  else
    echo -e "${RED}   ❌ $doc missing${NC}"
    ((FAILED++))
    ALL_CHECKS_PASSED=false
  fi
done

echo ""

# ==================== CONFIGURATION FILES ====================
echo -e "${BLUE}⚙️  Checking Configuration Files...${NC}"

REQUIRED_CONFIG=(
  "package.json"
  ".nvmrc"
  ".gitignore"
  "tsconfig.json"
)

for config in "${REQUIRED_CONFIG[@]}"; do
  if [ -f "$config" ]; then
    echo -e "${GREEN}   ✅ $config exists${NC}"
    ((PASSED++))
  else
    echo -e "${RED}   ❌ $config missing${NC}"
    ((FAILED++))
    ALL_CHECKS_PASSED=false
  fi
done

# Railway config can be TOML (current) or JSON (legacy)
if [ -f "railway.toml" ] || [ -f "railway.json" ]; then
  echo -e "${GREEN}   ✅ Railway deployment config exists (railway.toml or railway.json)${NC}"
  ((PASSED++))
else
  echo -e "${RED}   ❌ Missing Railway deployment config (railway.toml or railway.json)${NC}"
  ((FAILED++))
  ALL_CHECKS_PASSED=false
fi

# Check package.json has engines field
if grep -q '"engines"' package.json; then
  echo -e "${GREEN}   ✅ package.json has engines field${NC}"
  ((PASSED++))
else
  echo -e "${RED}   ❌ package.json missing engines field${NC}"
  ((FAILED++))
  ALL_CHECKS_PASSED=false
fi

echo ""

# ==================== CRITICAL FILES ====================
echo -e "${BLUE}📁 Checking Critical Implementation Files...${NC}"

CRITICAL_FILES=(
  "server/config.ts"
  "server/logger.ts"
  "server/constants.ts"
  "server/db.ts"
  "server/routes/autosave.routes.ts"
  "server/routes/law-types.routes.ts"
  "server/migrations/001_autosave_tables.sql"
  "server/migrations/002_law_types_seed.sql"
  "server/migrations/runMigrations.ts"
)

for file in "${CRITICAL_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo -e "${GREEN}   ✅ $file exists${NC}"
    ((PASSED++))
  else
    echo -e "${RED}   ❌ $file missing${NC}"
    ((FAILED++))
    ALL_CHECKS_PASSED=false
  fi
done

echo ""

# ==================== SUMMARY ====================
echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                  VERIFICATION SUMMARY                ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}✅ Passed:   $PASSED${NC}"
echo -e "${RED}❌ Failed:   $FAILED${NC}"
echo -e "${YELLOW}⚠️  Warnings: $WARNINGS${NC}"
echo ""

if [ "$ALL_CHECKS_PASSED" = true ]; then
  echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║          🎉 ALL CHECKS PASSED - READY TO DEPLOY! 🎉  ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${BLUE}Next steps:${NC}"
  echo -e "  1. Review PRODUCTION_CHECKLIST.md"
  echo -e "  2. Configure environment variables on Railway"
  echo -e "  3. Run: ${GREEN}bash scripts/prepare-deployment.sh${NC}"
  echo -e "  4. Deploy to Railway"
  echo ""
  exit 0
else
  echo -e "${RED}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║     ❌ VERIFICATION FAILED - FIX ISSUES BEFORE DEPLOY ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${YELLOW}Please address the failed checks above before deploying.${NC}"
  echo ""
  exit 1
fi
