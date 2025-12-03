# Production Readiness Checklist

## ✅ Node.js Version
- [ ] Node.js 20.x installed locally (Railway requirement)
- [ ] `package.json` specifies Node 20 in engines field
- [ ] `.nvmrc` file created with "20"
- [ ] Railway deployment configured for Node 20
- [ ] Local development can use Node 24, but Railway will use Node 20

## ✅ Environment Configuration

### Database
- [ ] PostgreSQL database provisioned
- [ ] `DATABASE_URL` configured
- [ ] Database connection tested successfully
- [ ] Database migrations run successfully (`npm run migrate`)
- [ ] Autosave tables created:
  - [ ] `user_work_sessions`
  - [ ] `autosave_snapshots`
  - [ ] `consultation_history`
  - [ ] `document_drafts`
  - [ ] `law_type_definitions`
- [ ] Law type definitions seeded (9 types including law-enforcement)
- [ ] Performance indexes created
- [ ] Foreign keys and constraints verified

### Email Service (Resend)
- [ ] `RESEND_API_KEY` configured
- [ ] `DEFAULT_FROM_EMAIL` configured (e.g., noreply@yourdomain.com)
- [ ] `DEFAULT_FROM_NAME` configured (e.g., Legalizo)
- [ ] Test email sent successfully
- [ ] Email templates working correctly

### AI Providers (5 Separate APIs)

#### 1. OpenRouter (FREE - 4 models)
- [ ] `OPENROUTER_API_KEY` configured
- [ ] API key tested and working
- [ ] All 4 models verified:
  - [ ] Kimi K2 (`moonshot/kimi-k2:free`) - Moonshot AI
  - [ ] DeepSeek R1 Chimera (`deepseek/deepseek-r1t2-chimera:free`)
  - [ ] Grok Fast (`x-ai/grok-4.1-fast:free`) - xAI
  - [ ] Qwen 72B (`qwen/qwen-2.5-72b-instruct:free`) - Alibaba

#### 2. Gemini (FREE - 3 models)
- [ ] `GEMINI_API_KEY` configured
- [ ] API key tested and working
- [ ] All 3 models verified (2.5 series):
  - [ ] gemini-2.5-pro - Most capable
  - [ ] gemini-2.5-flash - Fast and powerful
  - [ ] gemini-2.5-flash-lite - Fastest (1000 RPD)

#### 3. Groq (FREE - 2 models)
- [ ] `GROQ_API_KEY` configured
- [ ] API key tested and working
- [ ] All 2 models verified:
  - [ ] llama-3.3-70b-versatile - Most capable
  - [ ] llama-3.1-8b-instant - Fastest

#### 4. Mistral (FREE - 1 model)
- [ ] `MISTRAL_API_KEY` configured
- [ ] API key tested and working
- [ ] Model verified:
  - [ ] mistral-large-latest - High performance

#### 5. Anthropic (PAID - Optional)
- [ ] `ANTHROPIC_API_KEY` configured (if using)
- [ ] API key tested and working (if using)
- [ ] Models available:
  - [ ] claude-3-5-sonnet-latest
  - [ ] claude-3-5-haiku-latest

### Payment (Square)
- [ ] `SQUARE_ACCESS_TOKEN` configured
- [ ] `SQUARE_SANDBOX_ACCESS_TOKEN` configured (for testing)
- [ ] `SQUARE_LOCATION_ID` configured
- [ ] `SQUARE_APPLICATION_ID` configured
- [ ] `SQUARE_ENVIRONMENT` set correctly (production/sandbox)
- [ ] Test payment processed successfully
- [ ] Webhook signature key configured (if using webhooks)

### Application Configuration
- [ ] `SESSION_SECRET` configured (min 32 characters)
- [ ] `NODE_ENV` set to production
- [ ] `BASE_URL` configured (or auto-detected)
- [ ] All required environment variables validated at startup
- [ ] Configuration module loads successfully

## ✅ Pre-Deployment Checks

### Code Quality
- [ ] All verification scripts pass:
  ```bash
  node scripts/verify-stage-1.cjs
  node scripts/verify-stage-2.cjs
  node scripts/verify-stage-3.cjs
  node scripts/verify-stage-4.cjs
  node scripts/verify-stage-5.cjs
  node scripts/verify-stage-6.cjs
  node scripts/verify-stage-16.cjs
  ```
- [ ] TypeScript compilation succeeds (`npm run check`)
- [ ] Build process completes (`npm run build`)
- [ ] No TypeScript errors
- [ ] No linter warnings (if applicable)

### Security
- [ ] CodeQL scan passed (no vulnerabilities)
- [ ] All API endpoints use authentication
- [ ] Database queries use parameterized statements
- [ ] Input validation on all endpoints
- [ ] Rate limiting configured
- [ ] CORS configured appropriately
- [ ] No sensitive data in logs
- [ ] No secrets committed to repository

### Testing
- [ ] Database connection tested
- [ ] All API endpoints tested
- [ ] Autosave functionality tested
- [ ] Session management tested
- [ ] Authentication flow tested
- [ ] Email sending tested
- [ ] AI provider integrations tested
- [ ] Payment processing tested (if applicable)

### Logging & Monitoring
- [ ] Winston logger configured
- [ ] Log files rotating properly
- [ ] Error logs capturing exceptions
- [ ] Rejection handlers configured
- [ ] Component-based logging working
- [ ] Log levels appropriate for production

### Performance
- [ ] Database indexes created
- [ ] Database connection pooling configured
- [ ] Autosave debouncing working (3s default)
- [ ] React Query caching working
- [ ] API response times acceptable
- [ ] No memory leaks detected

## ✅ Deployment

### Railway Setup
- [ ] Railway project created
- [ ] Node 20 runtime configured
- [ ] Environment variables configured in Railway
- [ ] Database plugin added (if using Railway DB)
- [ ] Build command configured
- [ ] Start command configured
- [ ] Health check endpoint configured (if applicable)

### Post-Deployment
- [ ] Application starts successfully
- [ ] Database migrations ran
- [ ] All environment variables loaded
- [ ] Health check passing
- [ ] API endpoints accessible
- [ ] Frontend loads correctly
- [ ] Authentication working
- [ ] Autosave working
- [ ] Email sending working
- [ ] AI providers responding
- [ ] No errors in production logs

### Monitoring
- [ ] Application metrics monitored
- [ ] Error tracking configured
- [ ] Database performance monitored
- [ ] API response times monitored
- [ ] User sessions tracked
- [ ] Autosave success rate tracked

## ✅ Documentation
- [ ] README.md updated
- [ ] Environment variables documented
- [ ] API endpoints documented
- [ ] Database schema documented
- [ ] Deployment process documented
- [ ] Troubleshooting guide created

## Notes
- **Node Version**: Railway requires Node 20.x. Local development can use Node 24.
- **AI Providers**: 4 out of 5 providers are FREE (OpenRouter, Gemini, Groq, Mistral). Anthropic is optional/paid.
- **Database**: All 5 autosave tables must be created before deployment.
- **Email**: Resend is the configured email provider (replacing GWSMTP).
- **Configuration**: Type-safe config validation happens at startup. Application will not start with invalid configuration.
