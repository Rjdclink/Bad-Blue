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
const configSource = readFileSync(new URL('../server/config.ts', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');
const statelessLocalAuthSource = readFileSync(new URL('../server/statelessLocalAuth.ts', import.meta.url), 'utf8');
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
assert.doesNotMatch(authSource, /getLocalUserByIdHttp\(/, 'authenticated status must not reacquire the database after a signed local login');
assert.match(statelessLocalAuthSource, /BEGIN[\s\S]{0,2200}COMMIT[\s\S]{0,800}ROLLBACK/, 'PostgreSQL signup must remain transactional');

const { setupAuth } = await import('../server/auth.js');

const app = express();
app.use(express.json());
await setupAuth(app);
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
