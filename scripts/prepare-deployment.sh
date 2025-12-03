#!/bin/bash

# Production Deployment Preparation Script
# Validates environment before deployment to Railway

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNINGS=0

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}  Production Deployment Preparation${NC}"
echo -e "${BLUE}  Legalizo - Railway Deployment${NC}"
echo -e "${BLUE}================================================${NC}\n"

# Check Node version
echo "📦 Checking Node.js version..."
NODE_VERSION=$(node -v)
echo "   Node version: $NODE_VERSION"
REQUIRED_MAJOR=20

# Extract major version number (e.g., v20.x.x -> 20)
CURRENT_MAJOR=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)

if [ "$CURRENT_MAJOR" -eq "$REQUIRED_MAJOR" ]; then
  echo -e "${GREEN}✅ Node $CURRENT_MAJOR matches required version (Node 20)${NC}"
  ((PASSED++))
elif [ "$CURRENT_MAJOR" -gt "$REQUIRED_MAJOR" ]; then
  echo -e "${YELLOW}⚠️  Node $CURRENT_MAJOR detected (required: Node 20)${NC}"
  echo -e "${YELLOW}   Railway requires Node 20.x${NC}"
  echo -e "${YELLOW}   Your local version is newer, but deployment will use Node 20${NC}"
  ((WARNINGS++))
else
  echo -e "${RED}❌ Node $CURRENT_MAJOR is too old (required: Node 20)${NC}"
  echo -e "${YELLOW}   Update Node.js to version 20.x${NC}"
  ((FAILED++))
fi

# Check .nvmrc file
echo -e "\n📄 Checking .nvmrc file..."
if [ -f ".nvmrc" ]; then
  NVMRC_VERSION=$(cat .nvmrc)
  if [ "$NVMRC_VERSION" = "20" ]; then
    echo -e "${GREEN}✅ .nvmrc file correctly set to Node 20${NC}"
    ((PASSED++))
  else
    echo -e "${YELLOW}⚠️  .nvmrc file exists but set to: $NVMRC_VERSION${NC}"
    ((WARNINGS++))
  fi
else
  echo -e "${RED}❌ .nvmrc file not found${NC}"
  ((FAILED++))
fi

# Check package.json engines
echo -e "\n📦 Checking package.json engines..."
if grep -q '"node": "20.x"' package.json; then
  echo -e "${GREEN}✅ package.json specifies Node 20.x${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ package.json missing Node 20.x engine specification${NC}"
  ((FAILED++))
fi

# Check railway.json
echo -e "\n🚂 Checking railway.json..."
if [ -f "railway.json" ]; then
  if grep -q '"nodeVersion": "20"' railway.json; then
    echo -e "${GREEN}✅ railway.json configured for Node 20${NC}"
    ((PASSED++))
  else
    echo -e "${YELLOW}⚠️  railway.json exists but Node version not set to 20${NC}"
    ((WARNINGS++))
  fi
else
  echo -e "${YELLOW}⚠️  railway.json not found (optional)${NC}"
  ((WARNINGS++))
fi

# Check TypeScript compilation
echo -e "\n🔨 Checking TypeScript compilation..."
if npm run check > /dev/null 2>&1; then
  echo -e "${GREEN}✅ TypeScript compilation successful${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ TypeScript compilation failed${NC}"
  echo -e "${YELLOW}   Run 'npm run check' to see errors${NC}"
  ((FAILED++))
fi

# Check critical files exist
echo -e "\n📁 Checking critical files..."
CRITICAL_FILES=(
  "server/config.ts"
  "server/logger.ts"
  "server/constants.ts"
  "server/db.ts"
  "server/index.ts"
  "PRODUCTION_CHECKLIST.md"
)

for FILE in "${CRITICAL_FILES[@]}"; do
  if [ -f "$FILE" ]; then
    echo -e "${GREEN}✅ $FILE${NC}"
    ((PASSED++))
  else
    echo -e "${RED}❌ $FILE not found${NC}"
    ((FAILED++))
  fi
done

# Check verification scripts
echo -e "\n✅ Checking verification scripts..."
VERIFY_SCRIPTS=(
  "scripts/verify-stage-1.cjs"
  "scripts/verify-stage-2.cjs"
  "scripts/verify-stage-3.cjs"
  "scripts/verify-stage-16.cjs"
)

for SCRIPT in "${VERIFY_SCRIPTS[@]}"; do
  if [ -f "$SCRIPT" ]; then
    echo -e "${GREEN}✅ $SCRIPT${NC}"
    ((PASSED++))
  else
    echo -e "${YELLOW}⚠️  $SCRIPT not found${NC}"
    ((WARNINGS++))
  fi
done

# Check environment variables (sample check)
echo -e "\n🔐 Checking critical environment variables..."
ENV_VARS=(
  "DATABASE_URL"
  "SESSION_SECRET"
  "SQUARE_ACCESS_TOKEN"
  "SQUARE_LOCATION_ID"
)

for VAR in "${ENV_VARS[@]}"; do
  if [ -n "${!VAR}" ]; then
    echo -e "${GREEN}✅ $VAR is set${NC}"
    ((PASSED++))
  else
    echo -e "${YELLOW}⚠️  $VAR not set (will need to be configured in Railway)${NC}"
    ((WARNINGS++))
  fi
done

# Check database migration files
echo -e "\n🗄️  Checking database migrations..."
if [ -d "server/migrations" ]; then
  MIGRATION_COUNT=$(find server/migrations -name "*.sql" | wc -l)
  if [ "$MIGRATION_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✅ Found $MIGRATION_COUNT SQL migration files${NC}"
    ((PASSED++))
  else
    echo -e "${YELLOW}⚠️  No SQL migration files found${NC}"
    ((WARNINGS++))
  fi
else
  echo -e "${RED}❌ server/migrations directory not found${NC}"
  ((FAILED++))
fi

# Check build output
echo -e "\n🔨 Checking build configuration..."
if grep -q '"build":' package.json; then
  echo -e "${GREEN}✅ Build script configured in package.json${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ Build script not found in package.json${NC}"
  ((FAILED++))
fi

if grep -q '"start":' package.json; then
  echo -e "${GREEN}✅ Start script configured in package.json${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ Start script not found in package.json${NC}"
  ((FAILED++))
fi

# Final summary
echo -e "\n${BLUE}================================================${NC}"
echo -e "${BLUE}  Summary${NC}"
echo -e "${BLUE}================================================${NC}"
echo -e "${GREEN}✅ Passed:   $PASSED${NC}"
echo -e "${YELLOW}⚠️  Warnings: $WARNINGS${NC}"
echo -e "${RED}❌ Failed:   $FAILED${NC}"
echo -e "${BLUE}================================================${NC}\n"

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}🎉 All critical checks passed!${NC}"
  echo -e "${GREEN}   Ready for Railway deployment${NC}\n"
  
  if [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Note: $WARNINGS warnings detected${NC}"
    echo -e "${YELLOW}   Review warnings before deploying${NC}\n"
  fi
  
  echo -e "${BLUE}Next steps:${NC}"
  echo -e "1. Review PRODUCTION_CHECKLIST.md"
  echo -e "2. Configure environment variables in Railway"
  echo -e "3. Deploy to Railway"
  echo -e "4. Run database migrations: npm run migrate"
  echo -e "5. Verify deployment health"
  
  exit 0
else
  echo -e "${RED}❌ Deployment preparation failed${NC}"
  echo -e "${RED}   Fix $FAILED critical issues before deploying${NC}\n"
  exit 1
fi
