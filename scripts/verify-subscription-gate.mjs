import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSubscriptionGate } from '../server/subscriptionGate.ts';
import { getLegalWhatAccessState } from '../server/trialAccess.ts';
import { isSubscriptionEntryPath, isPaidAccessState } from '../shared/subscriptionPolicy.ts';

const root = resolve(new URL('..', import.meta.url).pathname);
const read = path => readFileSync(resolve(root, path), 'utf8');
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(path) : [path];
  });
}
const htmlFiles = walk(`${root}/public`).filter(path => path.endsWith('.html'));
assert.ok(htmlFiles.length >= 253, `Expected the complete static-page inventory; found ${htmlFiles.length}`);
const staticPaths = htmlFiles.flatMap(path => {
  const direct = path.slice(`${root}/public`.length);
  return direct.endsWith('/index.html') ? [direct, direct.slice(0, -10), direct.slice(0, -11) || '/'] : [direct];
});
const app = read('client/src/App.tsx');
const appPaths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map(match => match[1].replace(/:[^/]+/g, 'example'));
const sitemapPaths = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => new URL(match[1]).pathname);
const protectedPaths = [...new Set([...staticPaths, ...appPaths, ...sitemapPaths, '/blog', '/blog/example', '/new-page'])]
  .filter(path => !isSubscriptionEntryPath(path));
const states = {
  anonymous: { authenticated: false, authorized: false, accessState: 'no_access', reason: 'unauthenticated' },
  unpaid: { authenticated: true, authorized: false, accessState: 'no_access', reason: 'subscription_required' },
  trial: { authenticated: true, authorized: true, accessState: 'trial_active', reason: 'ok' },
  expired: { authenticated: true, authorized: false, accessState: 'trial_expired', reason: 'subscription_required' },
  paid: { authenticated: true, authorized: true, accessState: 'paid', reason: 'ok' },
  owner: { authenticated: true, authorized: true, accessState: 'master', reason: 'ok' },
  unavailable: { authenticated: true, authorized: false, accessState: 'no_access', reason: 'auth_store_unavailable' },
};
async function request(path, state, method = 'GET', fail = false) {
  const result = { allowed: false, headers: {}, status: null, location: null, body: null };
  const req = { path, method };
  const res = {
    setHeader(name, value) { result.headers[name] = value; return this; },
    vary(value) { result.headers.Vary = value; return this; },
    status(value) { result.status = value; return this; },
    json(value) { result.body = value; return this; },
    redirect(status, value) { result.status = status; result.location = value; return this; },
  };
  const gate = createSubscriptionGate(async () => { if (fail) throw new Error('fixture unavailable'); return state; });
  await gate(req, res, () => { result.allowed = true; });
  return result;
}

let decisions = 0;
for (const path of protectedPaths) {
  for (const [name, state] of Object.entries(states)) {
    for (const method of ['GET', 'HEAD']) {
      const result = await request(path, state, method);
      assert.equal(result.allowed, name === 'paid' || name === 'owner', `${name} ${method} ${path}`);
      assert.equal(result.headers['Cache-Control'], 'private, no-store');
      assert.equal(result.headers['X-Robots-Tag'], 'noindex, nofollow');
      if (name === 'anonymous') assert.equal(result.location, '/login');
      if (['unpaid', 'trial', 'expired'].includes(name)) assert.equal(result.location, '/subscription-required');
      if (name === 'unavailable') assert.equal(result.status, 503);
      decisions++;
    }
  }
}
for (const path of ['/api/lexara/chat', '/api/documents/generate', '/api/new-service', '/api/pulse/status/example']) {
  assert.equal((await request(path, states.anonymous, 'POST')).status, 401);
  assert.equal((await request(path, states.unpaid, 'POST')).status, 402);
  assert.equal((await request(path, states.trial, 'POST')).status, 402);
  assert.equal((await request(path, states.paid, 'POST')).allowed, true);
}
for (const path of ['/login', '/subscription-required', '/subscription-success', '/privacy', '/terms', '/contact', '/assets/app.js', '/assets/app.css', '/images/Legal%20What%20Icon.png', '/manifest.json', '/sitemap.xml']) {
  assert.equal((await request(path, states.anonymous)).allowed, true, `account resource ${path}`);
}
for (const path of ['/api/subscription/checkout', '/api/subscription/confirm', '/api/webhooks/square', '/api/blog-webhook']) {
  assert.equal((await request(path, states.unpaid, 'POST')).allowed, true, `delegates to existing handler ${path}`);
}
assert.equal((await request('/legal-consultation', states.paid, 'GET', true)).status, 503);
assert.equal(isPaidAccessState('trial_active'), false);
assert.equal(isPaidAccessState('paid'), true);
assert.equal(isPaidAccessState('master'), true);
for (const status of ['suspended', 'past_due', 'canceled', 'expired']) {
  assert.equal(isPaidAccessState(getLegalWhatAccessState({ status, hasPaidForAccess: true })), false, status);
}
assert.equal(isPaidAccessState(getLegalWhatAccessState({ status: 'active', hasPaidForAccess: true })), true);
assert.equal(isPaidAccessState(getLegalWhatAccessState({ status: 'active', hasPaidForAccess: false })), false);


// Integration placement matters: the gate must precede all content handlers.
const routes = read('server/routes.ts');
const gateIndex = routes.indexOf('app.use(createSubscriptionGate(');
assert.ok(gateIndex > routes.indexOf('await setupAuth(app)'));
assert.ok(gateIndex < routes.indexOf('app.get("/blog"'));
assert.ok(gateIndex < routes.indexOf('setupConsultationRoutes(app)'));
const index = read('server/index.ts');
assert.ok(index.indexOf('await registerRoutes(app)') < index.indexOf('app.use(express.static("public"))'));
assert.ok(index.includes('.filter((url) => isSubscriptionEntryPath(new URL(url).pathname))'));
const auth = read('server/auth.ts');
assert.ok(auth.includes('const authorized = isPaidAccessState(accessState)'));
assert.ok(!auth.includes('await activateLocalTrialHttp('));
assert.ok(app.indexOf('if (!isSubscriptionEntryPath(currentPath)') < app.indexOf('<Switch>'));
assert.ok(!app.includes('accessState === "trial_active" ||'));
assert.ok(app.includes('if (isLoading) return <AuthLoadingSkeleton />'));
console.log(JSON.stringify({ staticHtmlFiles: htmlFiles.length, protectedUrlVariants: protectedPaths.length, accessDecisions: decisions, result: 'PASS' }));
