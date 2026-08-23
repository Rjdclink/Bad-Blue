// Admin Authentication Utilities
// Centralized admin bypass logic to avoid code duplication

export const ADMIN_BYPASS_USER_ID = 'admin-bypass';

// Admin bypass is disabled until both credentials are explicitly configured.
export function getAdminCredentials() {
  return {
    email: process.env.ADMIN_BYPASS_EMAIL?.trim().toLowerCase() || '',
    password: process.env.ADMIN_BYPASS_PASSWORD || '',
    firstName: process.env.ADMIN_BYPASS_FIRST_NAME || 'Robert',
    lastName: process.env.ADMIN_BYPASS_LAST_NAME || 'Clink',
  };
}

// Check if provided credentials match admin bypass
export function isAdminBypass(email: string, password: string): boolean {
  const adminCreds = getAdminCredentials();
  return (
    adminCreds.email.length > 0 &&
    adminCreds.password.length > 0 &&
    email.trim().toLowerCase() === adminCreds.email &&
    password === adminCreds.password
  );
}

// Create admin user object
export function createAdminUser() {
  const adminCreds = getAdminCredentials();
  return {
    id: ADMIN_BYPASS_USER_ID,
    email: adminCreds.email,
    firstName: adminCreds.firstName,
    lastName: adminCreds.lastName,
    isAdmin: true,
  };
}

// Check if user is admin
export function isAdmin(userId: string | undefined): boolean {
  return userId === ADMIN_BYPASS_USER_ID;
}
