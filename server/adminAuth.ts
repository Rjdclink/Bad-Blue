// Admin Authentication Utilities
// Centralized admin bypass logic to avoid code duplication

export const ADMIN_BYPASS_USER_ID = 'admin-bypass';

// Get admin credentials from environment or use defaults
export function getAdminCredentials() {
  return {
    email: process.env.ADMIN_BYPASS_EMAIL || 'Rjdclink@outlook.com',
    password: process.env.ADMIN_BYPASS_PASSWORD || 'SARBEAR',
    firstName: process.env.ADMIN_BYPASS_FIRST_NAME || 'Robert',
    lastName: process.env.ADMIN_BYPASS_LAST_NAME || 'Clink',
  };
}

// Check if provided credentials match admin bypass
export function isAdminBypass(email: string, password: string): boolean {
  const adminCreds = getAdminCredentials();
  return (
    email.toLowerCase() === adminCreds.email.toLowerCase() &&
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
