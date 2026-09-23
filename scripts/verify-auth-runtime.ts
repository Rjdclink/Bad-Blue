import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import express from 'express';

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'auth-runtime-smoke-session-secret-000000000000';
process.env.MASTER_ADMIN_PASSWORD = '__AUTH_RUNTIME_SMOKE_MASTER__';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://smoke:smoke@127.0.0.1:5432/smoke';
delete process.env.PURGE_LOCAL_TEST_USERS_BEFORE;

const authSource = readFileSync(new URL('../server/auth.ts', import.meta.url), 'utf8');
const routesSource = readFileSync(new URL('../server/routes.ts', import.meta.url), 'utf8');
const subscriptionAuthSource = readFileSync(new URL('../server/routes/auth.routes.ts', import.meta.url), 'utf8');
const legacySubscriptionMiddlewareSource = readFileSync(new URL('../server/middleware/auth.ts', import.meta.url), 'utf8');
const configSource = readFileSync(new URL('../server/config.ts', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');
const statelessLocalAuthSource = readFileSync(new URL('../server/statelessLocalAuth.ts', import.meta.url), 'utf8');
const subscriptionFlowSource = readFileSync(new URL('../server/routes/subscription.routes.ts', import.meta.url), 'utf8');
const loginPageSource = readFileSync(new URL('../client/src/pages/login.tsx', import.meta.url), 'utf8');
const subscriptionSuccessSource = readFileSync(new URL('../client/src/pages/subscription-success.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../client/src/App.tsx', import.meta.url), 'utf8');
const sampleConsultationSource = readFileSync(new URL('../client/src/components/SampleLegalConsultation.tsx', import.meta.url), 'utf8');
const inmateRoutesSource = readFileSync(new URL('../server/routes/inmateSearch.routes.ts', import.meta.url), 'utf8');
const legalCounselRoutesSource = readFileSync(new URL('../server/routes/legalCounsel.routes.ts', import.meta.url), 'utf8');
const documentRoutesSource = readFileSync(new URL('../server/routes/document.routes.ts', import.meta.url), 'utf8');
const evidenceRoutesSource = readFileSync(new URL('../server/routes/evidence.routes.ts', import.meta.url), 'utf8');
const socialRoutesSource = readFileSync(new URL('../server/routes/socialIntelligence.routes.ts', import.meta.url), 'utf8');
const locationRoutesSource = readFileSync(new URL('../server/routes/locationIntelligence.routes.ts', import.meta.url), 'utf8');
const lexaraRoutesSource = readFileSync(new URL('../server/routes/lexara.routes.ts', import.meta.url), 'utf8');
const lexaraChatRoutesSource = readFileSync(new URL('../server/routes/lexara.chat.routes.ts', import.meta.url), 'utf8');
const voiceRoutesSource = readFileSync(new URL('../server/routes/voice.routes.ts', import.meta.url), 'utf8');
const consultationRoutesSource = readFileSync(new URL('../server/routes/consultation.routes.ts', import.meta.url), 'utf8');
const verificationRoutesSource = readFileSync(new URL('../server/routes/verification.routes.ts', import.meta.url), 'utf8');
const adminRoutesSource = readFileSync(new URL('../server/routes/admin-console.routes.ts', import.meta.url), 'utf8');
const railwayEnvSource = readFileSync(new URL('../.env.railway.example', import.meta.url), 'utf8');
const deployPrepSource = readFileSync(new URL('../scripts/prepare-deployment.sh', import.meta.url), 'utf8');
const migrationReconcilerSource = readFileSync(new URL('../server/migrations/reconcileAppSchema.ts', import.meta.url), 'utf8');
const retiredFreeAccessSource = readFileSync(new URL('../server/migrations/freeAccessForAll.ts', import.meta.url), 'utf8');
const authEdgeSource = readFileSync(new URL('../supabase/functions/legalwhat-local-auth/index.ts', import.meta.url), 'utf8');
const legacyLocalAuth = new URL('../server/localAuth.ts', import.meta.url);

assert.equal(existsSync(legacyLocalAuth), false, 'obsolete Passport local auth module must remain removed');
assert.doesNotMatch(authSource, /setupLocalStrategy/);
assert.doesNotMatch(routesSource, /app\.post\(["']\/api\/login\/local["']/);
assert.doesNotMatch(routesSource, /app\.post\(["']\/api\/register\/local["']/);
assert.doesNotMatch(subscriptionAuthSource, /router\.post\(["']\/signup["']/);
assert.doesNotMatch(subscriptionAuthSource, /router\.(?:get|post)\(["']\/logout["']/);
assert.match(configSource, /SUPABASE_URL:\s*z\.string\(\)\.url\(/, 'Supabase project URL must be syntactically validated');
assert.match(configSource, /SUPABASE_URL is required in production and must be the HTTP\(S\) Supabase project API URL/, 'production must reject database URLs in SUPABASE_URL');
assert.match(configSource, /parsedSupabaseProjectUrl\.protocol\s*!==\s*'https:'/, 'production Supabase auth URL must require HTTPS');
assert.match(configSource, /SUPABASE_SECRET_KEY\s*\|\|\s*process\.env\.SUPABASE_SERVICE_ROLE_KEY/, 'direct server auth credential support must remain available');
assert.match(configSource, /LEGALWHAT_EDGE_AUTH_SECRET/, 'project-local Edge auth invocation must require the private shared secret');
assert.match(indexSource, /authStoreReady/, 'strict readiness must track the authentication store');
assert.match(indexSource, /probeLocalAuthStoreHttp/, 'startup must probe the real authentication store');
assert.doesNotMatch(indexSource, /isFullyInitialized\s*&&\s*usableDataPlane\s*&&\s*authStoreReady/, 'route-local local-auth degradation must not globally veto Railway readiness');
assert.match(indexSource, /isFullyInitialized\s*&&\s*usableDataPlane[\s\S]{0,120}!isShuttingDown[\s\S]{0,120}!startupError/, 'Railway readiness must still require a fully initialized usable application data plane');
assert.match(indexSource, /void\s*\(async\s*\(\)\s*=>\s*\{[\s\S]{0,900}probeLocalAuthStoreHttp/, 'local auth readiness must be probed in the background');
assert.match(indexSource, /stateless master recovery remains available and local login stays fail-closed/, 'degraded local auth must preserve stateless master recovery while keeping local login fail-closed');
assert.match(statelessLocalAuthSource, /SUPABASE_SECRET_KEY[\s\S]{0,180}SUPABASE_SERVICE_ROLE_KEY/, 'modern Supabase secret key must be preferred before legacy service_role');
assert.match(statelessLocalAuthSource, /candidate\.from\("users"\)[\s\S]{0,240}candidate\.from\("auth_accounts"\)/, 'server key selection must validate both authentication tables before authority is cached');
assert.match(statelessLocalAuthSource, /No configured Supabase server key can access the LegalWhat authentication store/, 'invalid server keys must fail closed');
assert.match(statelessLocalAuthSource, /type LocalAuthBackend[\s\S]{0,260}kind: "edge"[\s\S]{0,120}kind: "postgres"/, 'local auth must retain Edge and bounded PostgreSQL fallbacks');
assert.match(statelessLocalAuthSource, /AUTH_DB_QUERY_TIMEOUT_MS\s*=\s*4_000/, 'PostgreSQL auth fallback must be latency bounded');
assert.match(statelessLocalAuthSource, /resolveLocalAuthBackend/, 'local auth backend selection must be centralized');
assert.match(statelessLocalAuthSource, /project-local Supabase Edge authentication authority/, 'invalid direct Supabase credentials must fail over to the project-local Edge authority');
assert.match(statelessLocalAuthSource, /Supabase HTTP and Edge authentication unavailable; using bounded canonical PostgreSQL auth store/, 'Edge failure must retain bounded canonical PostgreSQL as the final fallback');
assert.match(statelessLocalAuthSource, /AUTH_EDGE_FUNCTION\s*=\s*"legalwhat-local-auth"/, 'Edge auth function name must remain explicit and build-locked');
assert.match(statelessLocalAuthSource, /AUTH_EDGE_TIMEOUT_MS\s*=\s*15_000/, 'Edge auth cold-start timeout must remain bounded but deployment-tolerant');
assert.match(statelessLocalAuthSource, /x-legalwhat-auth-secret[\s\S]{0,120}edgeSecret/, 'Edge invocation must use the private shared secret');
assert.doesNotMatch(statelessLocalAuthSource, /authorization:\s*\x60Bearer \$\{anonKey\}\x60/, 'legacy JWT invocation must not remain the Edge authority');
assert.match(statelessLocalAuthSource, /v:\s*2[\s\S]{0,400}hasPaidForAccess/, 'signed local session must carry safe user identity fields');
assert.match(authSource, /getLocalUserByIdHttp\(/, 'paid access must revalidate durable user state after signed identity authentication');
assert.match(authSource, /resolvePaidAccess/, 'one fresh paid-access decision must govern protected services');
assert.match(subscriptionAuthSource, /refreshRequestUser/, 'legacy auth status route must delegate durable user state to canonical auth');
assert.doesNotMatch(subscriptionAuthSource, /db\.query|subscriptions\s+s\s+JOIN\s+plans/i, 'legacy auth status route must not become an independent database subscription authority');
assert.match(legacySubscriptionMiddlewareSource, /canonicalPaidAccess/, 'legacy subscription middleware must delegate paid access to canonical auth');
assert.doesNotMatch(legacySubscriptionMiddlewareSource, /SELECT\s+status\s+FROM\s+users|SELECT\s+id\s+FROM\s+subscriptions/i, 'legacy subscription middleware must not read subscription authority directly');
assert.match(authSource, /PAID_ACCESS_CACHE_TTL_MS\s*=\s*5_000/, 'high-frequency paid services must use a tightly bounded durable-state cache');
assert.match(authSource, /invalidatePaidAccessCache/, 'subscription/admin changes must be able to invalidate cached paid state immediately');
assert.match(authSource, /typeof req\?\.isAuthenticated === "function"/, 'identity checks must guard the optional Passport request method');
assert.match(statelessLocalAuthSource, /BEGIN[\s\S]{0,2200}COMMIT[\s\S]{0,800}ROLLBACK/, 'PostgreSQL signup must remain transactional');
assert.match(statelessLocalAuthSource, /process\.env\.LEGALWHAT_AUTH_SUPABASE_URL[\s\S]{0,180}getConfig\(\)\.LEGALWHAT_AUTH_SUPABASE_URL[\s\S]{0,180}getConfig\(\)\.SUPABASE_URL/, 'configured LegalWhat auth project must be authoritative for direct and Edge auth transports');
assert.match(statelessLocalAuthSource, /'pending_payment',false/, 'new PostgreSQL accounts must remain payment-pending');
assert.match(statelessLocalAuthSource, /status:\s*"pending_payment"[\s\S]{0,120}has_paid_for_access:\s*false/, 'new Supabase accounts must remain payment-pending');
assert.match(statelessLocalAuthSource, /edgeAuthRequest\("set_subscription"/, 'subscription state must persist through the selected auth authority');
assert.match(statelessLocalAuthSource, /Paid access requires a verified active Square subscription/, 'paid access must fail closed without verified Square subscription identity');
assert.match(authSource, /app\.post\("\/api\/local-register"[\s\S]{0,900}setLocalCookie\(res, createLocalSessionToken\(user\)\)/, 'signup must establish the pending authenticated checkout session');
assert.match(authSource, /isIdentityAuthenticated[\s\S]{0,1000}SUBSCRIPTION_REQUIRED/, 'ordinary authenticated services must require verified paid access');
assert.match(subscriptionFlowSource, /isIdentityAuthenticated/, 'pending users must retain access to subscription activation routes');
assert.match(subscriptionFlowSource, /subscriptionPlanId:\s*await resolvePlanVariationId\(square\)/, 'Square hosted checkout must use the catalog-validated $9.99 monthly plan variation');
assert.match(subscriptionFlowSource, /types:\s*"ITEM,SUBSCRIPTION_PLAN"/, 'Square plan resolver must inspect both item prices and subscription plans through Catalog');
assert.match(subscriptionFlowSource, /pricing\?\.type[\s\S]{0,80}RELATIVE/, 'Square plan resolver must support item-relative monthly pricing');
assert.match(subscriptionFlowSource, /itemHas999UsdVariation/, 'relative subscription resolution must prove the eligible catalog item is $9.99 USD');
assert.match(subscriptionFlowSource, /uniqueIds\.length !== 1/, 'Square plan resolver must fail closed unless exactly one $9.99 monthly variation is found');
assert.match(subscriptionFlowSource, /paymentNote:\s*noteForUser\(id\)/, 'Square checkout must carry an application-user reconciliation key');
assert.doesNotMatch(subscriptionFlowSource, /square\.fetch\(/, 'Square v43 integration must not call a nonexistent generic client fetch method');
assert.match(subscriptionFlowSource, /square\.subscriptions\.search\(/, 'subscription reconciliation must use the Square subscriptions resource client');
assert.match(subscriptionFlowSource, /square\.orders\.get\(\{\s*orderId\s*\}/, 'checkout verification must use the Square orders resource client');
assert.match(subscriptionFlowSource, /square\.payments\.get\(\{\s*paymentId\s*\}/, 'checkout verification must use the Square payments resource client');
assert.match(subscriptionFlowSource, /planVariationId/, 'Square SDK responses must be read through camelCase model properties');
assert.match(subscriptionFlowSource, /amountMoney/, 'Square payment verification must use the v43 camelCase payment model');
assert.match(subscriptionFlowSource, /app\.post\("\/api\/subscription\/confirm"/, 'server-side Square confirmation route is missing');
assert.match(subscriptionFlowSource, /handleLegalWhatSubscriptionWebhook/, 'Square subscription webhook reconciliation is missing');
assert.match(subscriptionSuccessSource, /\/api\/subscription\/confirm/, 'Square return page must verify the subscription server-side');
assert.match(subscriptionSuccessSource, /legalwhat_pending_square_order_id/, 'Square return must recover a stored order ID if the redirect query omits it');
assert.match(subscriptionSuccessSource, /openLibraryIfDurablyActive[\s\S]{0,1200}\/api\/auth\/user/, 'Square return must recover from durable webhook activation when browser order state is unavailable');
assert.match(appSource, /isAuthenticated\s*&&\s*hasPaidAccess/, 'private LegalWhat routes must require verified paid access');
assert.match(appSource, /<Route path="\/legal-consultation" component=\{LegalConsultationPage\} \/>/, 'public LegalWhat consultation discovery route must remain available for SEO and conversion');
assert.match(appSource, /hasPaidForAccess === true[\s\S]{0,160}suspended/, 'client paid-access gate must honor explicit overrides while blocking suspended/revoked states');
assert.match(loginPageSource, /\/api\/subscription\/checkout/, 'signup/login UI must hand pending users to hosted Square checkout');
assert.match(loginPageSource, /sessionStorage\.setItem\("legalwhat_pending_square_order_id"/, 'checkout must preserve Square order identity before redirect');
assert.match(subscriptionFlowSource, /isSuspended\(current\)/, 'suspended users must be rejected before Square checkout or confirmation');
assert.match(subscriptionFlowSource, /completed-payment path binds this Square customer ID/, 'ACTIVE subscription webhook must finish activation only through the verified customer-to-user binding');
assert.match(subscriptionFlowSource, /The just-fetched customer subscription set is the authority/, 'webhook delivery status must never outrank freshly fetched Square subscription state');
assert.match(subscriptionFlowSource, /currentSubscription[\s\S]{0,500}canonicalState\(currentSubscription\.status\)/, 'stale Square events must reconcile from the current subscription object');
const osintRouteStart = routesSource.indexOf("app.post('/api/osint/full-search'");
assert.ok(osintRouteStart >= 0, 'OSINT full-search route must remain registered');
const osintAccessWindow = routesSource.slice(osintRouteStart, osintRouteStart + 4_000);
assert.match(osintAccessWindow, /resolvePaidAccess\(req,\s*res\)/, 'OSINT must enforce fresh paid access');
assert.match(osintAccessWindow, /!access\.authenticated\s*\|\|\s*!access\.authorized/, 'OSINT must reject unauthenticated or unpaid access');
assert.match(osintAccessWindow, /return\s+res\.json\(/, 'OSINT must preserve its controlled response contract for blocked access');
assert.match(inmateRoutesSource, /router\.post\('\/', isAuthenticated, apiRateLimit/, 'inmate search must require verified paid access');
assert.match(legalCounselRoutesSource, /router\.use\(isAuthenticated\)/, 'legal counsel sessions must require verified paid access');
assert.match(consultationRoutesSource, /'\/api\/legal-consultation',[\s\S]{0,80}isAuthenticated/, 'canonical legal consultation must require verified paid access');
assert.match(consultationRoutesSource, /'\/api\/enhanced-consultation',[\s\S]{0,80}isAuthenticated/, 'enhanced consultation must require verified paid access');
assert.match(documentRoutesSource, /router\.post\('\/generate', isAuthenticated/, 'legal document generation must require verified paid access');
assert.match(evidenceRoutesSource, /router\.post\('\/analyze', isAuthenticated/, 'evidence analysis must require verified paid access');
assert.match(evidenceRoutesSource, /router\.post\('\/comprehensive-report', isAuthenticated/, 'evidence reports must require verified paid access');
assert.match(socialRoutesSource, /router\.post\('\/search-username', isAuthenticated/, 'social intelligence search must require verified paid access');
assert.match(locationRoutesSource, /router\.post\('\/api\/location-intel\/analyze', isAuthenticated/, 'location intelligence analysis must require verified paid access');
assert.match(lexaraRoutesSource, /router\.use\(isAuthenticated\)/, 'LEXARA streaming/ASR services must require verified paid access');
assert.match(lexaraChatRoutesSource, /router\.use\(isAuthenticated\)/, 'LEXARA conversational services must require verified paid access');
assert.match(voiceRoutesSource, /'\/api\/lexara\/tts\/session',[\s\S]{0,80}isAuthenticated/, 'LEXARA TTS session creation must require verified paid access');
assert.match(voiceRoutesSource, /'\/api\/lexara\/speak',[\s\S]{0,80}isAuthenticated/, 'LEXARA direct speech synthesis must remain protected outside the temporary consultation path');
assert.match(voiceRoutesSource, /'\/api\/lexara\/tts\/stream',[\s\S]{0,80}isAuthenticated/, 'LEXARA buffered TTS streaming must remain protected outside the temporary consultation path');
assert.match(verificationRoutesSource, /router\.get\('\/people-search\/:reportId', isAuthenticated/, 'persisted people-search reports must require verified paid access');
assert.match(verificationRoutesSource, /router\.get\('\/lexara\/session\/:sessionId', isAuthenticated/, 'persisted LEXARA history must require verified paid access');
assert.match(verificationRoutesSource, /router\.get\('\/health', async/, 'verification health must remain independently observable');
assert.match(adminRoutesSource, /hasPaidForAccess:\s*true,[\s\S]{0,80}status:\s*'active'/, 'admin subscription override must create an immediately usable access state');
assert.match(adminRoutesSource, /invalidatePaidAccessCache\(userId\)/, 'admin subscription override changes must invalidate paid-access cache');
assert.match(statelessLocalAuthSource, /activeAdminOverride[\s\S]{0,1200}effectivePaidAccess/, 'Square revocation must preserve a live admin override without weakening suspension');
assert.match(railwayEnvSource, /SQUARE_SUBSCRIPTION_PLAN_VARIATION_ID=/, 'Railway example must document the required Square subscription plan variation');
assert.match(deployPrepSource, /"SQUARE_SUBSCRIPTION_PLAN_VARIATION_ID"/, 'deployment preflight must validate the Square subscription plan variation');
assert.match(deployPrepSource, /"SQUARE_WEBHOOK_SIGNATURE_KEY"/, 'deployment preflight must validate the Square webhook verification key');
assert.match(configSource, /SQUARE_WEBHOOK_SIGNATURE_KEY is required in production/, 'production must require the Square webhook verification key');
assert.match(subscriptionFlowSource, /SUBSCRIPTION_PRICE_CENTS\s*=\s*999/, 'canonical Square checkout and verification amount must remain $9.99');
assert.match(sampleConsultationSource, /\$9\.99\/month/, 'public subscription disclosure must match the $9.99 Square checkout price');
assert.doesNotMatch(sampleConsultationSource, /\$25\.99\/month/, 'stale $25.99 public subscription pricing must not remain');
assert.doesNotMatch(sampleConsultationSource, /\$19\.98/, 'stale public subscription pricing must not remain');
assert.doesNotMatch(migrationReconcilerSource, /runFreeAccessMigration|Free Access for All Users/, 'startup schema reconciliation must never re-grant universal paid access');
assert.doesNotMatch(retiredFreeAccessSource, /\.update\(users\)|hasPaidForAccess:\s*true/, 'retired free-access migration must remain non-mutating');
assert.match(retiredFreeAccessSource, /retired; no user access state was changed/, 'legacy free-access migration must be explicitly retired');
assert.match(authEdgeSource, /RAILWAY_AUTH_SECRET_SHA256/, 'LegalWhat Edge auth must store only a one-way verifier for the Railway caller secret');
assert.doesNotMatch(authEdgeSource, /RAILWAY_AUTH_SECRET\s*=\s*["']/, 'LegalWhat Edge auth source must never contain the plaintext Railway caller secret');
assert.match(authEdgeSource, /crypto\.subtle\.digest\("SHA-256"/, 'LegalWhat Edge auth must verify the caller secret through the one-way digest');

const { setupAuth, isIdentityAuthenticated } = await import('../server/auth.js');

const app = express();
app.use(express.json());
await setupAuth(app);
app.get('/__verify/identity', isIdentityAuthenticated, (_req, res) => res.json({ ok: true }));
app.use((_req, res) => res.status(404).json({ message: 'not found' }));

const server = createServer(app);
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve());
});

try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  const master = await fetch(`${base}/api/master-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: '__AUTH_RUNTIME_SMOKE_MASTER__' }),
  });
  assert.equal(master.status, 200, 'password-only master login must initialize and succeed');
  const masterBody = await master.json() as any;
  assert.equal(masterBody.isMasterBypass, true);
  assert.equal(masterBody.accessZone, 'admin');
  assert.match(master.headers.get('set-cookie') || '', /legalwhat_master=/);

  const anonymousState = await fetch(`${base}/api/auth/user`);
  assert.equal(anonymousState.status, 200);
  assert.equal(await anonymousState.json(), null);

  const anonymousIdentity = await fetch(`${base}/__verify/identity`);
  assert.equal(anonymousIdentity.status, 401, 'missing Passport/local identity must return 401 rather than throwing');

  const invalidRegistration = await fetch(`${base}/api/local-register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(invalidRegistration.status, 400, 'canonical registration route must initialize');

  for (const path of ['/api/login/local', '/api/register/local']) {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 404, `${path} must not remain an authentication authority`);
  }

  const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
  assert.equal(logout.status, 200);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

console.log('Canonical authentication runtime bootstrap verification passed');
process.exit(0);
