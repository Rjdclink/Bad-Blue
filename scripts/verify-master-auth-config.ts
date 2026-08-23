import assert from 'node:assert/strict';
import { checkMasterPassword, getAccessZoneConfig, isMasterPassword } from '../server/masterPassword.js';
import { isAdminBypass } from '../server/adminAuth.js';

const previous = {
  masterEmail: process.env.MASTER_ADMIN_EMAIL,
  masterPassword: process.env.MASTER_ADMIN_PASSWORD,
  bypassEmail: process.env.ADMIN_BYPASS_EMAIL,
  bypassPassword: process.env.ADMIN_BYPASS_PASSWORD,
};

try {
  delete process.env.MASTER_ADMIN_EMAIL;
  delete process.env.MASTER_ADMIN_PASSWORD;
  delete process.env.ADMIN_BYPASS_EMAIL;
  delete process.env.ADMIN_BYPASS_PASSWORD;
  assert.equal(checkMasterPassword('anything', 'admin@example.com'), null);
  assert.equal(isMasterPassword('anything'), false);
  assert.equal(isAdminBypass('admin@example.com', 'anything'), false);

  process.env.MASTER_ADMIN_EMAIL = 'master@example.com';
  process.env.MASTER_ADMIN_PASSWORD = 'test-only-master-password';
  process.env.ADMIN_BYPASS_EMAIL = 'bypass@example.com';
  process.env.ADMIN_BYPASS_PASSWORD = 'test-only-bypass-password';
  assert.equal(checkMasterPassword('test-only-master-password', 'master@example.com'), 'admin');
  assert.equal(checkMasterPassword('wrong', 'master@example.com'), null);
  assert.equal(getAccessZoneConfig('test-only-master-password', 'master@example.com')?.route, '/administrator');
  assert.equal(isAdminBypass('bypass@example.com', 'test-only-bypass-password'), true);
  assert.equal(isAdminBypass('bypass@example.com', 'wrong'), false);
} finally {
  if (previous.masterEmail === undefined) delete process.env.MASTER_ADMIN_EMAIL; else process.env.MASTER_ADMIN_EMAIL = previous.masterEmail;
  if (previous.masterPassword === undefined) delete process.env.MASTER_ADMIN_PASSWORD; else process.env.MASTER_ADMIN_PASSWORD = previous.masterPassword;
  if (previous.bypassEmail === undefined) delete process.env.ADMIN_BYPASS_EMAIL; else process.env.ADMIN_BYPASS_EMAIL = previous.bypassEmail;
  if (previous.bypassPassword === undefined) delete process.env.ADMIN_BYPASS_PASSWORD; else process.env.ADMIN_BYPASS_PASSWORD = previous.bypassPassword;
}

console.log('Master and admin environment credential verification passed');