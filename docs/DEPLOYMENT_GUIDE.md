# Railway Deployment Guide

Complete step-by-step guide for deploying LegalWhat/Bad-Blue to Railway with Node 20.

---

## Prerequisites

### Required
- [x] Railway account (free tier available)
- [x] GitHub repository access
- [x] Node 20.x installed locally for testing
- [x] All verification scripts passing (`npm run verify:final`)

### Optional
- [ ] Custom domain (can add later)
- [ ] Railway Pro plan for additional resources

---

## Pre-Deployment Checklist

Run these commands locally first:

```bash
# 1. Verify all stages complete
bash scripts/final-verification.sh

# 2. Run Stage 20 verification
node scripts/verify-stage-20.cjs

# 3. Verify deployment readiness
bash scripts/prepare-deployment.sh

# 4. Build locally to ensure no errors
npm run build

# 5. Check TypeScript compilation
npx tsc --noEmit
```

All checks must pass before deploying.

---

## Step 1: Create Railway Project

### 1.1 Sign Up / Log In
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub (recommended) or email
3. Verify your email address

### 1.2 Create New Project
1. Click "New Project" in Railway dashboard
2. Select "Deploy from GitHub repo"
3. Authorize Railway to access your GitHub
4. Select `Rjdclink/Bad-Blue` repository
5. Select branch: `copilot/prepare-environment-dependencies` (or your main branch)

### 1.3 Project Configuration
Railway will detect:
- ✅ `railway.json` configuration file
- ✅ Node.js project (package.json)
- ✅ Build command: `npm run build`
- ✅ Start command: `npm run start`

---

## Step 2: Provision Database

### 2.1 Add PostgreSQL Plugin
1. In your Railway project, click "New"
2. Select "Database"
3. Choose "PostgreSQL"
4. Railway will provision database automatically

### 2.2 Note Database URL
Railway will create `DATABASE_URL` environment variable automatically.

**Format**: `postgresql://user:password@host:port/database`

---

## Step 3: Configure Environment Variables

### 3.1 Required Environment Variables

Go to Project → Variables tab and add these:

#### Core Configuration
```bash
NODE_ENV=production
PORT=3000
BASE_URL=https://your-app.railway.app
```

#### Database (Auto-configured)
```bash
DATABASE_URL=${POSTGRESQL_URL}  # Auto-set by Railway
```

#### Session & Security
```bash
SESSION_SECRET=<generate-64-char-random-string>
JWT_SECRET=<generate-64-char-random-string>
ENCRYPTION_KEY=<generate-32-char-random-string>
```

**Generate secrets**:
```bash
# On Mac/Linux
openssl rand -base64 48

# Or use Node.js
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

#### Email Service (Resend)
```bash
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
DEFAULT_FROM_EMAIL=noreply@yourdomain.com
DEFAULT_FROM_NAME=LegalWhat
```

Get Resend API key: [resend.com/api-keys](https://resend.com/api-keys)

#### AI Providers (Required: 4 free providers)

**1. OpenRouter (FREE - 4 models)**
```bash
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxx
```
Get key: [openrouter.ai/keys](https://openrouter.ai/keys)

Models available:
- `moonshot/kimi-k2:free`
- `deepseek/deepseek-r1t2-chimera:free`
- `x-ai/grok-4.1-fast:free`
- `qwen/qwen-2.5-72b-instruct:free`

**2. Gemini (FREE - 3 models)**
```bash
GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxx
```
Get key: [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

Models available:
- `gemini-2.5-pro`
- `gemini-2.5-flash`
- `gemini-2.5-flash-lite`

**3. Groq (FREE - 2 models)**
```bash
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
```
Get key: [console.groq.com/keys](https://console.groq.com/keys)

Models available:
- `llama-3.3-70b-versatile`
- `llama-3.1-8b-instant`

**4. Mistral (FREE - 1 model)**
```bash
MISTRAL_API_KEY=xxxxxxxxxxxxxxxxxxxx
```
Get key: [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys)

Model available:
- `mistral-large-latest`

**5. Anthropic (PAID - Optional)**
```bash
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx  # Optional
```
Get key: [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)

Models available:
- `claude-3-5-sonnet-latest`
- `claude-3-5-haiku-latest`

#### Square Payment Processing (if using payments)
```bash
SQUARE_ENVIRONMENT=sandbox  # or 'production'
SQUARE_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxx
SQUARE_SANDBOX_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxx
SQUARE_LOCATION_ID=xxxxxxxxxxxxxxxxxxxx
```

Get keys: [developer.squareup.com/apps](https://developer.squareup.com/apps)

### 3.2 Optional Environment Variables
```bash
LOG_LEVEL=info
AUTOSAVE_DEBOUNCE_MS=3000
SESSION_TIMEOUT_MS=3600000
```

---

## Step 4: Run Database Migrations

### 4.1 Add Migration Command to Railway

In Railway dashboard:
1. Go to Settings → Deploy
2. Add custom deploy command (if needed):
   ```bash
   npm run migrate && npm run start
   ```

Or run migrations manually after first deploy:
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to your project
railway link

# Run migrations
railway run npm run migrate
```

### 4.2 Verify Database Tables

After migration, check tables exist:
```bash
railway run npm run db:verify
```

Expected tables:
- `user_work_sessions`
- `autosave_snapshots`
- `consultation_history`
- `document_drafts`
- `law_type_definitions`

---

## Step 5: Deploy

### 5.1 Automatic Deployment

Railway will automatically deploy when:
- You push to your connected GitHub branch
- You modify environment variables
- You manually trigger "Deploy" in dashboard

### 5.2 Monitor Deployment

1. Go to Deployments tab
2. Watch build logs in real-time
3. Build should complete in 2-5 minutes

**Expected build output**:
```
✅ Installing dependencies
✅ Building TypeScript
✅ Building client
✅ Running migrations (if configured)
✅ Starting server
```

### 5.3 Deployment URL

Railway will provide a URL:
```
https://your-app-name.up.railway.app
```

Update `BASE_URL` environment variable to match this URL.

---

## Step 6: Post-Deployment Verification

### 6.1 Health Check
```bash
curl https://your-app.railway.app/health
# Expected: {"status": "ok"}
```

### 6.2 Test Endpoints
```bash
# Test API endpoint
curl https://your-app.railway.app/api/law-types

# Should return list of 9 law types
```

### 6.3 Test Autosave (requires authentication)
1. Sign up for account on deployed app
2. Start a session
3. Verify autosave occurs every 3 seconds
4. Check browser devtools → Network tab for autosave requests

### 6.4 Test AI Providers
Test each provider from admin dashboard or API:
```bash
# Test OpenRouter
curl -X POST https://your-app.railway.app/api/ai/test \
  -H "Content-Type: application/json" \
  -d '{"provider": "openrouter", "model": "qwen/qwen-2.5-72b-instruct:free"}'

# Test Gemini
curl -X POST https://your-app.railway.app/api/ai/test \
  -H "Content-Type: application/json" \
  -d '{"provider": "gemini", "model": "gemini-2.5-flash"}'
```

---

## Step 7: Monitor & Troubleshoot

### 7.1 View Logs
```bash
# Using Railway CLI
railway logs

# Or in Railway dashboard: Deployments → View Logs
```

### 7.2 Common Issues

**Issue: Build fails**
- Check Node version (should be 20.x)
- Verify `package.json` engines field
- Check build logs for TypeScript errors

**Issue: Database connection fails**
- Verify `DATABASE_URL` is set
- Check PostgreSQL plugin is running
- Run migrations manually: `railway run npm run migrate`

**Issue: 502 Bad Gateway**
- Check PORT environment variable (should be 3000)
- Verify server is starting correctly in logs
- Check for startup errors in logs

**Issue: AI providers not working**
- Verify all 4 API keys are set correctly
- Check rate limits haven't been exceeded
- Test each provider individually
- Check logs for API key errors

---

## Step 8: Custom Domain (Optional)

### 8.1 Add Custom Domain
1. Go to Settings → Domains
2. Click "Add Domain"
3. Enter your domain: `app.yourdomain.com`

### 8.2 Configure DNS
Add CNAME record in your DNS provider:
```
Type: CNAME
Name: app
Value: your-app.up.railway.app
TTL: 3600
```

### 8.3 SSL Certificate
Railway automatically provisions SSL certificates (Let's Encrypt).
Wait 5-10 minutes for certificate to be issued.

---

## Step 9: Scaling & Monitoring

### 9.1 Scaling
Railway automatically scales based on:
- CPU usage
- Memory usage
- Request volume

**Free Tier**: 500 hours/month, $5 credit  
**Pro Tier**: Unlimited, pay-as-you-go

### 9.2 Monitoring
Railway provides:
- CPU metrics
- Memory metrics
- Network metrics
- Deployment history
- Real-time logs

### 9.3 Alerts
Set up alerts in Railway dashboard:
- Deployment failures
- High CPU usage
- High memory usage
- High error rates

---

## Step 10: Backup & Recovery

### 10.1 Database Backups
Railway Pro provides:
- Automatic daily backups
- Point-in-time recovery
- Manual backup triggers

### 10.2 Code Backups
Your code is backed up in GitHub:
- Every commit is a backup
- Can rollback to any commit
- Railway can redeploy any commit

---

## Environment-Specific Configuration

### Development
```bash
NODE_ENV=development
LOG_LEVEL=debug
```

### Staging
```bash
NODE_ENV=staging
LOG_LEVEL=info
BASE_URL=https://staging.yourdomain.com
```

### Production
```bash
NODE_ENV=production
LOG_LEVEL=warn
BASE_URL=https://yourdomain.com
```

---

## Cost Estimation

### Free Tier
- **Included**: 500 hours/month, $5 credit
- **Cost**: $0/month
- **Suitable for**: Development, testing, low-traffic apps

### Pro Tier (Recommended for Production)
- **Base**: $20/month
- **Additional**:
  - CPU: ~$10/month
  - Memory: ~$5/month
  - Database: ~$5/month
  - Bandwidth: ~$0.10/GB
- **Total**: ~$40-60/month for small-medium traffic

### AI Provider Costs
- **Free tier usage**: 4 providers = $0/month
- **Anthropic (optional)**: Pay-as-you-go, ~$0.003/1K tokens

---

## Security Best Practices

### 1. Environment Variables
- ✅ Never commit `.env` to git
- ✅ Use Railway's environment variable management
- ✅ Rotate secrets regularly (every 90 days)

### 2. API Keys
- ✅ Use separate keys for staging/production
- ✅ Enable rate limiting on all providers
- ✅ Monitor API usage for abuse

### 3. Database
- ✅ Enable SSL connections
- ✅ Regular backups (Railway Pro)
- ✅ Use read replicas for scaling

### 4. Application
- ✅ Enable CORS properly
- ✅ Use helmet.js for security headers
- ✅ Rate limit all API endpoints
- ✅ Validate all user inputs

---

## Support

### Railway Support
- **Docs**: [docs.railway.app](https://docs.railway.app)
- **Discord**: [discord.gg/railway](https://discord.gg/railway)
- **Status**: [status.railway.app](https://status.railway.app)

### Project Support
- **Issues**: Check logs first
- **Documentation**: See docs/ directory
- **Verification**: Run `npm run verify:final`

---

## Deployment Checklist

Before going live:

- [ ] All environment variables configured
- [ ] Database migrations run successfully
- [ ] All 4 AI providers working
- [ ] Email service (Resend) working
- [ ] Health check endpoint responding
- [ ] Autosave functionality tested
- [ ] Custom domain configured (optional)
- [ ] SSL certificate active
- [ ] Monitoring and alerts set up
- [ ] Backup strategy in place
- [ ] Team has access to Railway dashboard

---

**🚀 You're ready to deploy to Railway! Follow steps 1-10 above.**

For questions, check Railway documentation or review PRODUCTION_CHECKLIST.md.
