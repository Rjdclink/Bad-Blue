import assert from 'node:assert/strict';
import {
  ACCESS_ZONES,
  createMasterSessionToken,
  verifyMasterSessionToken,
  checkMasterPassword,
  isMasterPassword,
} from '../server/masterPassword.js';
import { isAdminBypass } from '../server/adminAuth.js';
import { getPlatformUserId, normalizePlatformUser } from '../server/authIdentity.js';

const previous = {
  sessionSecret: process.env.SESSION_SECRET,
  masterEmail: process.env.MASTER_ADMIN_EMAIL,
  masterPassword: process.env.MASTER_ADMIN_PASSWORD,
  bypassEmail: process.env.ADMIN_BYPASS_EMAIL,
  bypassPassword: process.env.ADMIN_BYPASS_PASSWORD,
};

try {
  process.env.SESSION_SECRET = 'test-session-secret-that-is-longer-than-thirty-two-characters';

  // statelessLocalAuth now has a bounded PostgreSQL fallback, so load it only
  // after test configuration exists. Static ESM imports execute before this block.
  const { createLocalSessionToken, verifyLocalSessionToken } = await import('../server/statelessLocalAuth.js');

  // Master access is password-only and sourced exclusively from the deployment
  // secret. Email has no role in the credential check.
  delete process.env.MASTER_ADMIN_EMAIL;
  delete process.env.MASTER_ADMIN_PASSWORD;
  assert.equal(checkMasterPassword('test-master-password'), null);
  assert.equal(isMasterPassword('test-master-password'), false);

  process.env.MASTER_ADMIN_EMAIL = 'ignored@example.com';
  process.env.MASTER_ADMIN_PASSWORD = 'test-master-password';
  assert.equal(checkMasterPassword('test-master-password'), 'admin');
  assert.equal(checkMasterPassword('test-master-password', 'anything@example.com'), 'admin');
  assert.equal(checkMasterPassword('definitely-wrong'), null);
  assert.equal(ACCESS_ZONES.admin.route, '/welcome');
  assert.equal(ACCESS_ZONES.admin.role, 'ADMIN_ROOT');

  // Stateless master recovery tokens are signed, expire, and reject tampering.
  const issuedAt = 1_800_000_000_000;
  const masterToken = createMasterSessionToken(issuedAt);
  assert.equal(verifyMasterSessionToken(masterToken, issuedAt + 1), true);
  assert.equal(verifyMasterSessionToken(masterToken + 'x', issuedAt + 1), false);
  assert.equal(verifyMasterSessionToken(masterToken, issuedAt + 8 * 24 * 60 * 60 * 1000), false);

  // Normal local sessions use the same finite, signed-cookie invariant.
  const localToken = createLocalSessionToken({
    id: 'local-user-id',
    email: 'local@example.com',
    firstName: 'Local',
    lastName: 'User',
    status: 'active',
    hasPaidForAccess: true,
  }, issuedAt);
  const localIdentityFromToken = verifyLocalSessionToken(localToken, issuedAt + 1);
  assert.equal(localIdentityFromToken?.id, 'local-user-id');
  assert.equal(localIdentityFromToken?.email, 'local@example.com');
  assert.equal(localIdentityFromToken?.firstName, 'Local');
  assert.equal(localIdentityFromToken?.lastName, 'User');
  assert.equal(localIdentityFromToken?.status, 'active');
  assert.equal(localIdentityFromToken?.hasPaidForAccess, true);
  assert.equal(localIdentityFromToken?.sessionVersion, 2);
  assert.equal(verifyLocalSessionToken(localToken + 'x', issuedAt + 1), null);

  process.env.ADMIN_BYPASS_EMAIL = 'bypass@example.com';
  process.env.ADMIN_BYPASS_PASSWORD = 'test-only-bypass-password';
  assert.equal(isAdminBypass('bypass@example.com', 'test-only-bypass-password'), true);
  assert.equal(isAdminBypass('bypass@example.com', 'wrong'), false);

  const masterIdentity = normalizePlatformUser({
    claims: { sub: 'master-user-id' },
    isMasterBypass: true,
  });
  assert.equal(getPlatformUserId(masterIdentity), 'master-user-id');
  assert.equal(masterIdentity.id, 'master-user-id');
  assert.equal(masterIdentity.isAdmin, true);

  const localIdentity = normalizePlatformUser({ id: 'local-user-id' });
  assert.equal(getPlatformUserId(localIdentity), 'local-user-id');
  assert.equal(localIdentity.isAdmin, false);
} finally {
  if (previous.sessionSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous.sessionSecret;
  if (previous.masterEmail === undefined) delete process.env.MASTER_ADMIN_EMAIL; else process.env.MASTER_ADMIN_EMAIL = previous.masterEmail;
  if (previous.masterPassword === undefined) delete process.env.MASTER_ADMIN_PASSWORD; else process.env.MASTER_ADMIN_PASSWORD = previous.masterPassword;
  if (previous.bypassEmail === undefined) delete process.env.ADMIN_BYPASS_EMAIL; else process.env.ADMIN_BYPASS_EMAIL = previous.bypassEmail;
  if (previous.bypassPassword === undefined) delete process.env.ADMIN_BYPASS_PASSWORD; else process.env.ADMIN_BYPASS_PASSWORD = previous.bypassPassword;
}

console.log('Master/local stateless authentication verification passed');
// server/statelessLocalAuth imports the PostgreSQL fallback, whose pool monitor is
// intentionally long-lived in production. This verifier has completed all assertions,
// so terminate explicitly rather than letting that production monitor hold the build open.
process.exit(0);
