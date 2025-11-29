# BadBlue Platform Migration Guide
## 100% Platform-Independent Deployment to Railway, Heroku, or Any Host

This guide ensures BadBlue can be deployed to **any** hosting platform beyond Replit with complete functionality.

---

## ✅ **Platform Independence Status**

BadBlue is **100% platform-agnostic** and ready for deployment to:
- ✅ **Railway.app** (recommended)
- ✅ **Heroku**
- ✅ **Render.com**
- ✅ **Fly.io**
- ✅ **Any Node.js hosting platform**

---

## 🖥️ **Runtime Requirements**

### **Node.js Version**
BadBlue requires **Node.js 20 or later** (up to Node 24 for local development):

| Environment | Supported Versions |
|-------------|-------------------|
| Production  | Node.js 20.x, 22.x |
| Development | Node.js 20.x - 24.x |

**Version Enforcement:**
- `package.json` specifies `"engines": { "node": ">=20.0.0 <25" }`
- `.nvmrc` file contains `20` for nvm users
- Runtime check logs a warning on startup if version is outside supported range

**Railway Deployment Note:**
Railway automatically detects Node.js version from `.nvmrc` or `package.json` engines. No Dockerfile changes are needed.

---

## 🔧 **Required Environment Variables**

### **Core Application**
```bash
# Application Base URL (CRITICAL for platform independence)
BASE_URL=https://your-app.railway.app  # Or your-app.herokuapp.com, etc.

# Database (PostgreSQL - platform-agnostic)
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Session Secret
SESSION_SECRET=your-random-secret-here-min-32-chars

# Node Environment
NODE_ENV=production
PORT=5000
```

### **Payment Processing** (Stripe)
```bash
STRIPE_SECRET_KEY=sk_live_xxx
VITE_STRIPE_PUBLIC_KEY=pk_live_xxx

# For testing
TESTING_STRIPE_SECRET_KEY=sk_test_xxx
TESTING_VITE_STRIPE_PUBLIC_KEY=pk_test_xxx
```

### **AI Services**
```bash
# Gemini API (Google) - supports either key name
GEMINI_API_KEY=xxx
# Alternative: GOOGLE_API_KEY=xxx

# Groq API (fallback provider)
GROQ_API_KEY=xxx
```

### **Email Service** (SMTP)
```bash
GWSMTP_USER=your-smtp-username
GWSMTP_PASS=your-smtp-password
```

### **Object Storage** (Optional - gracefully degrades if unavailable)
```bash
# Only needed if using Replit Object Storage
DEFAULT_OBJECT_STORAGE_BUCKET_ID=your-bucket-id
PUBLIC_OBJECT_SEARCH_PATHS=/public
PRIVATE_OBJECT_DIR=.private
```

### **Replit OAuth** (Optional - falls back to local auth)
```bash
# Only if deploying ON Replit with OAuth
REPLIT_DOMAINS=your-repl.replit.app
REPL_ID=your-repl-id
ISSUER_URL=https://replit.com
```

---

## 📦 **Database Setup**

### **1. PostgreSQL Database**
BadBlue uses PostgreSQL (Neon serverless on Replit). For other platforms:

**Railway:**
```bash
# Railway provides PostgreSQL addon - just add it
# Copy DATABASE_URL from Railway dashboard
```

**Heroku:**
```bash
# Add Heroku Postgres addon
heroku addons:create heroku-postgresql:mini
# DATABASE_URL auto-populated
```

**Self-Hosted:**
```bash
# Install PostgreSQL 14+
DATABASE_URL=postgresql://user:pass@localhost:5432/badblue
```

### **2. Database Schema Migration**
```bash
# Install dependencies
npm install

# Push schema to database (creates all tables)
npm run db:push --force

# Verify tables created
psql $DATABASE_URL -c "\dt"
```

**Expected Tables** (36 total):
- Core: `users`, `sessions`, `auth_accounts`
- Features: `complaints`, `lawsuit_filings`, `petitions`, `foia_requests`
- AI: `ai_subagent_logs`, `trial_consultations`, `officer_profiles`
- **Migration-Ready**: `worker_failure_logs`, `ai_usage_metrics`, `ai_cache_entries`, `worker_repair_metrics`, `worker_health_metrics`, `worker_function_errors`
- Monitoring: `worker_alerts`, `admin_access_logs`

---

## 🗂️ **File Storage Strategy**

### **Evidence Files** (User Uploads)
BadBlue uses a **hybrid storage** strategy:

1. **Replit Object Storage** (when available):
   - Persistent across deployments
   - Automatically detected via `DEFAULT_OBJECT_STORAGE_BUCKET_ID`

2. **Local Filesystem** (fallback):
   - Used when object storage unavailable
   - ⚠️ **WARNING**: Files lost on deployment unless using persistent volumes

**Railway/Heroku Persistent Storage:**
```bash
# Railway: Add persistent volume
# Dashboard → Project → Settings → Volumes → Add Volume
# Mount path: /app/uploads

# Heroku: Use S3 or Cloudinary addon
```

### **Application Data** (Worker Logs, Metrics, Cache)
✅ **Fully migrated to PostgreSQL** - no filesystem dependency:
- `data/system_failures.log` → `worker_failure_logs` table
- `data/ai_usage_metrics.json` → `ai_usage_metrics` table
- `data/ai_cache/*.json` → `ai_cache_entries` table
- `data/repair_metrics.json` → `worker_repair_metrics` table
- `data/worker_health_metrics.json` → `worker_health_metrics` table

---

## 🚀 **Deployment Steps**

### **Railway.app** (Recommended)

1. **Create Railway Project:**
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and init
railway login
railway init
```

2. **Add PostgreSQL Database:**
```bash
railway add postgresql
```

3. **Set Environment Variables:**
```bash
railway variables set BASE_URL=https://your-app.railway.app
railway variables set SESSION_SECRET=$(openssl rand -hex 32)
railway variables set GEMINI_API_KEY=xxx
railway variables set GROQ_API_KEY=xxx
railway variables set STRIPE_SECRET_KEY=sk_live_xxx
# ... etc
```

4. **Deploy:**
```bash
railway up
```

5. **Run Database Migration:**
```bash
railway run npm run db:push --force
```

### **Heroku**

1. **Create Heroku App:**
```bash
heroku create badblue-app
heroku addons:create heroku-postgresql:mini
```

2. **Set Environment Variables:**
```bash
heroku config:set BASE_URL=https://badblue-app.herokuapp.com
heroku config:set SESSION_SECRET=$(openssl rand -hex 32)
# ... set all required vars
```

3. **Deploy:**
```bash
git push heroku main
```

4. **Run Database Migration:**
```bash
heroku run npm run db:push --force
```

### **Render.com**

1. Connect GitHub repository
2. Select "Web Service"
3. Build Command: `npm install && npm run build`
4. Start Command: `npm start`
5. Add PostgreSQL database
6. Set all environment variables
7. Deploy

---

## 🔍 **Platform-Specific Code**

### **Base URL Abstraction**
BadBlue uses `platformConfig.ts` for platform independence:

```typescript
// ✅ Correct - platform-agnostic
import { getBaseURL } from './platformConfig';
const url = `${getBaseURL()}/api/callback`;

// ❌ Wrong - Replit-specific
const url = `https://${process.env.REPLIT_DOMAINS}/api/callback`;
```

### **Object Storage Graceful Degradation**
```typescript
import { isObjectStorageAvailable } from './platformConfig';

if (isObjectStorageAvailable()) {
  // Use Replit Object Storage
  await uploadToObjectStorage(file);
} else {
  // Fallback to filesystem or S3
  await uploadToFilesystem(file);
}
```

### **Authentication Fallback**
```typescript
// Automatically falls back to local username/password auth
// when Replit OAuth unavailable
if (!isReplitPlatform()) {
  console.log('Using local authentication (Replit OAuth disabled)');
}
```

---

## 🧪 **Post-Deployment Verification**

### **1. Health Check**
```bash
curl https://your-app.railway.app/api/maintenance-status
# Expected: {"maintenanceMode":false}
```

### **2. Database Connectivity**
```bash
curl https://your-app.railway.app/api/auth/user
# Should return user session or 401
```

### **3. Worker Status**
Check logs for:
```
[BadBlue Worker] ✓ Background worker system active
[BadBlue Worker] - Critical monitoring: Every 30 minutes
```

### **4. AI Services**
```bash
# Test legal consultation (requires payment)
# Should not see "API key not configured" errors in logs
```

---

## 📊 **Data Retention & Cleanup**

### **Automatic Cleanup Jobs**

1. **User Data** (Privacy Compliance):
   - Deleted 14 days after payment
   - Preserves: username, email, evidence files

2. **Error Logs**:
   - Deleted after 30 days

3. **AI Cache**:
   - Auto-expires based on TTL (default: 60 minutes)
   - Cleanup query: `DELETE FROM ai_cache_entries WHERE expiresAt < now()`

4. **Metrics** (Recommended Retention):
   - AI Usage Metrics: 90 days
   - Worker Health Metrics: 180 days
   - Worker Repair Metrics: 365 days

### **Manual Cleanup** (if needed):
```sql
-- Clean old AI usage metrics (>90 days)
DELETE FROM ai_usage_metrics WHERE timestamp < now() - interval '90 days';

-- Clean old health metrics (>180 days)
DELETE FROM worker_health_metrics WHERE timestamp < now() - interval '180 days';

-- Clean expired cache entries
DELETE FROM ai_cache_entries WHERE "expiresAt" < now();
```

---

## 🛡️ **Security Checklist**

- ✅ All secrets in environment variables (never in code)
- ✅ SESSION_SECRET is strong (32+ characters)
- ✅ Database uses SSL/TLS connections
- ✅ Stripe keys use live mode in production
- ✅ AI Sub-Agent has 4-layer security firewall
- ✅ Rate limiting implemented (Gemini: 50 req/day, Groq: 100k tokens/day)
- ✅ CSRF protection via session tokens
- ✅ Admin access logged in `admin_access_logs` table

---

## 🐛 **Troubleshooting**

### **"Object Storage not available"**
✅ **Expected behavior** - app gracefully degrades to filesystem storage.
Fix: Set `DEFAULT_OBJECT_STORAGE_BUCKET_ID` env var (Replit only).

### **"Database connection failed"**
Check:
```bash
psql $DATABASE_URL -c "SELECT 1"
```
Ensure `DATABASE_URL` format: `postgresql://user:pass@host:5432/dbname`

### **"Replit OAuth disabled"**
✅ **Expected behavior** on non-Replit platforms.
Users can still sign up/login with username/password.

### **Worker not running**
Check logs for:
```
[BadBlue Worker] Initializing background worker system...
```
If missing, Worker failed to start - check for missing env vars.

### **AI quota exhausted**
Check:
```sql
SELECT provider, SUM("tokensUsed") as total
FROM ai_usage_metrics
WHERE timestamp > now() - interval '1 day'
GROUP BY provider;
```
Gemini limit: ~50 requests/day
Groq limit: 100,000 tokens/day

---

## 📞 **Support**

For deployment issues:
1. Check logs: `railway logs` or `heroku logs --tail`
2. Verify all required env vars are set
3. Confirm database migration completed: `npm run db:push --force`
4. Test health endpoint: `/api/maintenance-status`

---

## 🎯 **Migration Checklist**

Before deploying to production:

- [ ] PostgreSQL database provisioned
- [ ] All required environment variables set
- [ ] `BASE_URL` set to deployment URL
- [ ] Database schema migrated (`npm run db:push --force`)
- [ ] Health check passes (`/api/maintenance-status`)
- [ ] Worker system initializes (check logs)
- [ ] AI services configured (Gemini + Groq API keys)
- [ ] Stripe payment processing tested
- [ ] Email service tested (SMTP credentials)
- [ ] User registration/login tested
- [ ] File uploads tested (evidence storage)
- [ ] Backup strategy defined (database + files)

**BadBlue is 100% ready for platform-independent deployment! 🚀**
