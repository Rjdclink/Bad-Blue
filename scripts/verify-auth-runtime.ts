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
const legacyLocalAuth = new URL('../server/localAuth.ts', import.meta.url);

assert.equal(existsSync(legacyLocalAuth), false, 'obsolete Passport local auth module must remain removed');
assert.doesNotMatch(authSource, /setupLocalStrategy/);
assert.doesNotMatch(routesSource, /app\.post\(["']\/api\/login\/local["']/);
assert.doesNotMatch(routesSource, /app\.post\(["']\/api\/register\/local["']/);
assert.doesNotMatch(subscriptionAuthSource, /router\.post\(["']\/signup["']/);
assert.doesNotMatch(subscriptionAuthSource, /router\.(?:get|post)\(["']\/logout["']/);

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
